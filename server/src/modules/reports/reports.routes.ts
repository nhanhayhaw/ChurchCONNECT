/**
 * Reporting.
 *
 * Every report is defined once as { title, columns, fetch } and then rendered
 * three ways - JSON for the screen, XLSX and PDF for download. Adding a report
 * means adding one entry to REPORTS, not three parallel endpoints.
 */
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db.js';
import { asyncHandler } from '../../utils/http.js';
import { validateQuery, validateParams } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { scopeDepartmentId } from '../../middleware/scope.js';
import { recordAudit } from '../../services/audit.service.js';
import { notFound } from '../../utils/errors.js';
import { startOfMonth, today, addDays } from '../../utils/dates.js';
import { genericToWorkbook, genericToPdf, type PdfTableColumn } from './export.service.js';
import { getAbsenceAlerts } from '../../services/absence.service.js';
import { lowAttendanceMembers, attendanceByDepartment } from '../attendance/attendance.service.js';
import { listBirthdays } from '../birthdays/birthdays.service.js';

const router = Router();
router.use(authenticate);

interface ReportColumn {
  header: string;
  key: string;
  width: number;
  pdfWidth: number;
}

interface ReportDefinition {
  key: string;
  title: string;
  category: 'membership' | 'attendance' | 'absentee' | 'birthday';
  description: string;
  columns: ReportColumn[];
  /**
   * `scope` is the caller's department when they are a Department Leader,
   * otherwise null. Row-level reports must honour it; the aggregate reports
   * (counts per department, age bands) reveal nothing personal and ignore it.
   */
  fetch: (params: Record<string, any>, scope: number | null) => Promise<any[]>;
}

const titleCase = (v: unknown): string =>
  String(v ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const REPORTS: ReportDefinition[] = [
  // --- Membership ---------------------------------------------------------
  {
    key: 'membership-summary',
    title: 'Membership Summary',
    category: 'membership',
    description: 'Headline counts by status, gender and category.',
    columns: [
      { header: 'Metric', key: 'metric', width: 34, pdfWidth: 30 },
      { header: 'Count', key: 'count', width: 14, pdfWidth: 12 },
    ],
    fetch: async () => {
      const { rows } = await query<any>(
        `SELECT 'Total members' AS metric, COUNT(*)::int AS count FROM members WHERE deleted_at IS NULL
         UNION ALL SELECT 'Active members', COUNT(*)::int FROM members WHERE deleted_at IS NULL AND membership_status='active'
         UNION ALL SELECT 'Inactive members', COUNT(*)::int FROM members WHERE deleted_at IS NULL AND membership_status='inactive'
         UNION ALL SELECT 'Transferred', COUNT(*)::int FROM members WHERE deleted_at IS NULL AND membership_status='transferred'
         UNION ALL SELECT 'Male (active)', COUNT(*)::int FROM members WHERE deleted_at IS NULL AND membership_status='active' AND gender='male'
         UNION ALL SELECT 'Female (active)', COUNT(*)::int FROM members WHERE deleted_at IS NULL AND membership_status='active' AND gender='female'
         UNION ALL SELECT 'Baptised', COUNT(*)::int FROM members WHERE deleted_at IS NULL AND baptism_status='baptised'
         UNION ALL SELECT 'Communicants', COUNT(*)::int FROM members WHERE deleted_at IS NULL AND communion_status='communicant'
         UNION ALL SELECT 'Joined this month', COUNT(*)::int FROM members WHERE deleted_at IS NULL AND date_joined >= date_trunc('month', CURRENT_DATE)
         UNION ALL SELECT 'Joined this year', COUNT(*)::int FROM members WHERE deleted_at IS NULL AND date_joined >= date_trunc('year', CURRENT_DATE)`,
      );
      return rows;
    },
  },
  {
    key: 'new-members',
    title: 'New Members',
    category: 'membership',
    description: 'Members who joined within the selected period.',
    columns: [
      { header: 'Member ID', key: 'memberCode', width: 14, pdfWidth: 12 },
      { header: 'Full Name', key: 'fullName', width: 28, pdfWidth: 24 },
      { header: 'Gender', key: 'gender', width: 10, pdfWidth: 8 },
      { header: 'Phone', key: 'phone', width: 16, pdfWidth: 14 },
      { header: 'Department', key: 'departmentName', width: 20, pdfWidth: 16 },
      { header: 'Date Joined', key: 'dateJoined', width: 14, pdfWidth: 12 },
    ],
    fetch: async (p, scope) => {
      const { rows } = await query<any>(
        `SELECT m.member_code, m.first_name || ' ' || m.last_name AS full_name, m.gender, m.phone,
                d.name AS department_name, m.date_joined
           FROM members m LEFT JOIN departments d ON d.id = m.department_id
          WHERE m.deleted_at IS NULL AND m.date_joined BETWEEN $1 AND $2
            AND ($3::bigint IS NULL OR m.department_id = $3)
          ORDER BY m.date_joined DESC`,
        [p.from ?? startOfMonth(), p.to ?? today(), scope],
      );
      return rows.map((r) => ({
        memberCode: r.member_code,
        fullName: r.full_name,
        gender: titleCase(r.gender),
        phone: r.phone ?? '',
        departmentName: r.department_name ?? '-',
        dateJoined: r.date_joined,
      }));
    },
  },
  {
    key: 'members-by-department',
    title: 'Members by Department',
    category: 'membership',
    description: 'Active membership counts and gender split per department.',
    columns: [
      { header: 'Department', key: 'department', width: 28, pdfWidth: 26 },
      { header: 'Leader', key: 'leader', width: 24, pdfWidth: 22 },
      { header: 'Members', key: 'members', width: 12, pdfWidth: 10 },
      { header: 'Male', key: 'male', width: 10, pdfWidth: 9 },
      { header: 'Female', key: 'female', width: 10, pdfWidth: 9 },
    ],
    fetch: async () => {
      const { rows } = await query<any>(
        `SELECT COALESCE(d.name,'Unassigned') AS department,
                CASE WHEN lm.id IS NULL THEN '-' ELSE lm.first_name || ' ' || lm.last_name END AS leader,
                COUNT(m.id)::int AS members,
                COUNT(m.id) FILTER (WHERE m.gender='male')::int AS male,
                COUNT(m.id) FILTER (WHERE m.gender='female')::int AS female
           FROM members m
           LEFT JOIN departments d ON d.id = m.department_id
           LEFT JOIN members lm ON lm.id = d.leader_member_id
          WHERE m.deleted_at IS NULL AND m.membership_status='active'
          GROUP BY d.name, lm.id
          ORDER BY members DESC`,
      );
      return rows;
    },
  },
  {
    key: 'members-by-age',
    title: 'Members by Age Group',
    category: 'membership',
    description: 'Active membership grouped into pastoral age bands.',
    columns: [
      { header: 'Age Group', key: 'bucket', width: 18, pdfWidth: 16 },
      { header: 'Members', key: 'value', width: 12, pdfWidth: 10 },
      { header: 'Male', key: 'male', width: 10, pdfWidth: 9 },
      { header: 'Female', key: 'female', width: 10, pdfWidth: 9 },
    ],
    fetch: async () => {
      const { rows } = await query<any>(
        `SELECT bucket, COUNT(*)::int AS value,
                COUNT(*) FILTER (WHERE gender='male')::int AS male,
                COUNT(*) FILTER (WHERE gender='female')::int AS female
           FROM (
             SELECT gender, CASE
               WHEN date_of_birth IS NULL THEN 'Unknown'
               WHEN AGE(date_of_birth) < interval '13 years' THEN '0-12'
               WHEN AGE(date_of_birth) < interval '20 years' THEN '13-19'
               WHEN AGE(date_of_birth) < interval '31 years' THEN '20-30'
               WHEN AGE(date_of_birth) < interval '46 years' THEN '31-45'
               WHEN AGE(date_of_birth) < interval '61 years' THEN '46-60'
               ELSE '60+' END AS bucket
             FROM members WHERE deleted_at IS NULL AND membership_status='active'
           ) t GROUP BY bucket
           ORDER BY CASE bucket WHEN '0-12' THEN 1 WHEN '13-19' THEN 2 WHEN '20-30' THEN 3
                                WHEN '31-45' THEN 4 WHEN '46-60' THEN 5 WHEN '60+' THEN 6 ELSE 7 END`,
      );
      return rows;
    },
  },

  // --- Attendance ---------------------------------------------------------
  {
    key: 'attendance-by-service',
    title: 'Attendance by Service',
    category: 'attendance',
    description: 'Every register in the period with its present/absent split.',
    columns: [
      { header: 'Date', key: 'serviceDate', width: 14, pdfWidth: 12 },
      { header: 'Service', key: 'serviceType', width: 22, pdfWidth: 20 },
      { header: 'Present', key: 'present', width: 11, pdfWidth: 10 },
      { header: 'Absent', key: 'absent', width: 11, pdfWidth: 10 },
      { header: 'Excused', key: 'excused', width: 11, pdfWidth: 10 },
      { header: 'Rate %', key: 'rate', width: 10, pdfWidth: 9 },
    ],
    fetch: async (p) => {
      const { rows } = await query<any>(
        `SELECT s.service_date, s.service_type,
                COUNT(a.id) FILTER (WHERE a.status='present')::int AS present,
                COUNT(a.id) FILTER (WHERE a.status='absent')::int  AS absent,
                COUNT(a.id) FILTER (WHERE a.status='excused')::int AS excused
           FROM attendance_services s
           LEFT JOIN attendance a ON a.service_id = s.id
          WHERE s.service_date BETWEEN $1 AND $2
          GROUP BY s.id ORDER BY s.service_date DESC`,
        [p.from ?? addDays(today(), -90), p.to ?? today()],
      );
      return rows.map((r) => {
        const total = r.present + r.absent + r.excused;
        return {
          serviceDate: r.service_date,
          serviceType: titleCase(r.service_type),
          present: r.present,
          absent: r.absent,
          excused: r.excused,
          rate: total > 0 ? Math.round((r.present / total) * 100) : 0,
        };
      });
    },
  },
  {
    key: 'attendance-by-department',
    title: 'Attendance by Department',
    category: 'attendance',
    description: 'How faithfully each department attends.',
    columns: [
      { header: 'Department', key: 'department', width: 28, pdfWidth: 26 },
      { header: 'Present', key: 'present', width: 12, pdfWidth: 10 },
      { header: 'Absent', key: 'absent', width: 12, pdfWidth: 10 },
      { header: 'Excused', key: 'excused', width: 12, pdfWidth: 10 },
      { header: 'Rate %', key: 'rate', width: 10, pdfWidth: 9 },
    ],
    fetch: (p) => attendanceByDepartment(p.from ?? addDays(today(), -90), p.to ?? today()),
  },
  {
    key: 'low-attendance',
    title: 'Members with Low Attendance',
    category: 'attendance',
    description: 'Active members attending less than half the services recorded for them.',
    columns: [
      { header: 'Member ID', key: 'memberCode', width: 14, pdfWidth: 12 },
      { header: 'Full Name', key: 'fullName', width: 28, pdfWidth: 24 },
      { header: 'Phone', key: 'phone', width: 16, pdfWidth: 14 },
      { header: 'Department', key: 'departmentName', width: 20, pdfWidth: 18 },
      { header: 'Present', key: 'present', width: 10, pdfWidth: 9 },
      { header: 'Recorded', key: 'recorded', width: 11, pdfWidth: 10 },
      { header: 'Rate %', key: 'rate', width: 10, pdfWidth: 9 },
      { header: 'Last Present', key: 'lastPresent', width: 14, pdfWidth: 12 },
    ],
    fetch: async (p, scope) => {
      const rows = await lowAttendanceMembers(Number(p.threshold ?? 50), p.from, scope);
      return rows.map((r) => ({ ...r, departmentName: r.departmentName ?? '-', phone: r.phone ?? '' }));
    },
  },

  // --- Absentees ----------------------------------------------------------
  {
    key: 'absentees',
    title: 'Absentee Alert Register',
    category: 'absentee',
    description: 'Every member currently over an absence threshold, with the alert level.',
    columns: [
      { header: 'Member ID', key: 'memberCode', width: 14, pdfWidth: 12 },
      { header: 'Full Name', key: 'fullName', width: 26, pdfWidth: 22 },
      { header: 'Phone', key: 'phone', width: 16, pdfWidth: 14 },
      { header: 'Department', key: 'departmentName', width: 18, pdfWidth: 16 },
      { header: 'Services Missed', key: 'consecutiveMissed', width: 15, pdfWidth: 12 },
      { header: 'Level', key: 'levelLabel', width: 26, pdfWidth: 22 },
      { header: 'Last Attendance', key: 'lastAttendanceDate', width: 16, pdfWidth: 14 },
    ],
    fetch: async (_p, scope) => {
      const alerts = await getAbsenceAlerts(scope);
      return alerts.map((a) => ({
        memberCode: a.memberCode,
        fullName: a.fullName,
        phone: a.phone ?? '',
        departmentName: a.departmentName ?? '-',
        consecutiveMissed: a.consecutiveMissed,
        levelLabel: a.levelLabel,
        lastAttendanceDate: a.lastAttendanceDate ?? 'Never recorded',
      }));
    },
  },
  {
    key: 'follow-ups',
    title: 'Follow-Up Register',
    category: 'absentee',
    description: 'All follow-up cases with status, officer and outcome.',
    columns: [
      { header: 'Member', key: 'memberName', width: 26, pdfWidth: 22 },
      { header: 'Level', key: 'level', width: 10, pdfWidth: 8 },
      { header: 'Status', key: 'status', width: 22, pdfWidth: 18 },
      { header: 'Assigned To', key: 'assignedTo', width: 22, pdfWidth: 18 },
      { header: 'Weeks Absent', key: 'weeksAbsent', width: 14, pdfWidth: 11 },
      { header: 'Opened', key: 'opened', width: 14, pdfWidth: 12 },
      { header: 'Next Contact', key: 'nextDate', width: 14, pdfWidth: 12 },
      { header: 'Notes', key: 'noteCount', width: 9, pdfWidth: 8 },
    ],
    fetch: async (p, scope) => {
      const params: unknown[] = [];
      const where: string[] = [];
      if (p.status) {
        params.push(p.status);
        where.push(`f.status = $${params.length}`);
      }
      if (scope !== null) {
        params.push(scope);
        where.push(`m.department_id = $${params.length}`);
      }
      const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const { rows } = await query<any>(
        `SELECT m.first_name || ' ' || m.last_name AS member_name, f.level, f.status, f.weeks_absent,
                f.created_at::date AS opened, f.next_follow_up_date, u.full_name AS assigned_to,
                (SELECT COUNT(*)::int FROM follow_up_notes n WHERE n.follow_up_id = f.id) AS note_count
           FROM follow_ups f
           JOIN members m ON m.id = f.member_id
           LEFT JOIN users u ON u.id = f.assigned_to
           ${filter}
          ORDER BY f.level DESC, f.created_at DESC`,
        params,
      );
      return rows.map((r) => ({
        memberName: r.member_name,
        level: `Level ${r.level}`,
        status: titleCase(r.status),
        assignedTo: r.assigned_to ?? 'Unassigned',
        weeksAbsent: r.weeks_absent,
        opened: r.opened,
        nextDate: r.next_follow_up_date ?? '-',
        noteCount: r.note_count,
      }));
    },
  },

  // --- Birthdays ----------------------------------------------------------
  {
    key: 'birthdays',
    title: 'Birthday Register',
    category: 'birthday',
    description: 'Upcoming birthdays, or a whole month when a month is supplied.',
    columns: [
      { header: 'Member ID', key: 'memberCode', width: 14, pdfWidth: 12 },
      { header: 'Full Name', key: 'fullName', width: 28, pdfWidth: 24 },
      { header: 'Birthday', key: 'birthdayLabel', width: 16, pdfWidth: 14 },
      { header: 'Turning', key: 'turningAge', width: 10, pdfWidth: 9 },
      { header: 'Days Away', key: 'daysAway', width: 12, pdfWidth: 10 },
      { header: 'Department', key: 'departmentName', width: 20, pdfWidth: 18 },
      { header: 'Phone', key: 'phone', width: 16, pdfWidth: 14 },
    ],
    fetch: async (p, scope) => {
      const rows = await listBirthdays(p.month ? 'upcoming' : (p.range ?? 'month'), {
        month: p.month ? Number(p.month) : undefined,
        windowDays: p.windowDays ? Number(p.windowDays) : 30,
        departmentId: scope,
      });
      return rows.map((r) => ({
        memberCode: r.memberCode,
        fullName: r.fullName,
        birthdayLabel: r.birthdayLabel,
        turningAge: r.turningAge ?? '-',
        daysAway: r.daysAway,
        departmentName: r.departmentName ?? '-',
        phone: r.phone ?? '',
      }));
    },
  },
];

function findReport(key: string): ReportDefinition {
  const report = REPORTS.find((r) => r.key === key);
  if (!report) throw notFound('That report does not exist.');
  return report;
}

const reportQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  range: z.enum(['today', 'week', 'month', 'upcoming']).optional(),
  windowDays: z.coerce.number().int().min(1).max(366).optional(),
  threshold: z.coerce.number().int().min(1).max(99).optional(),
  status: z.string().max(40).optional(),
});

/** Catalogue for the Reports page sidebar. */
router.get('/', requirePermission('reports:read'), (_req, res) => {
  res.json({
    reports: REPORTS.map((r) => ({
      key: r.key,
      title: r.title,
      category: r.category,
      description: r.description,
      columns: r.columns.map((c) => ({ header: c.header, key: c.key })),
    })),
  });
});

router.get(
  '/:key',
  requirePermission('reports:read'),
  validateParams(z.object({ key: z.string().max(60) })),
  validateQuery(reportQuery),
  asyncHandler(async (req, res) => {
    const report = findReport(req.params.key);
    const rows = await report.fetch(req.query as any, scopeDepartmentId(req));
    await recordAudit(req, {
      action: 'report.view',
      description: `Viewed the "${report.title}" report (${rows.length} row(s)).`,
      entityType: 'report',
      metadata: { report: report.key },
    });
    res.json({
      key: report.key,
      title: report.title,
      description: report.description,
      columns: report.columns.map((c) => ({ header: c.header, key: c.key })),
      rows,
      generatedAt: today(),
    });
  }),
);

router.get(
  '/:key/excel',
  requirePermission('reports:export'),
  validateParams(z.object({ key: z.string().max(60) })),
  validateQuery(reportQuery),
  asyncHandler(async (req, res) => {
    const report = findReport(req.params.key);
    const rows = await report.fetch(req.query as any, scopeDepartmentId(req));
    await recordAudit(req, {
      action: 'report.export',
      description: `Exported "${report.title}" to Excel (${rows.length} row(s)).`,
      entityType: 'report',
      metadata: { report: report.key, format: 'xlsx' },
    });

    const workbook = await genericToWorkbook(
      report.title,
      report.columns.map((c) => ({ header: c.header, key: c.key, width: c.width })),
      rows,
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${report.key}-${today()}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  }),
);

router.get(
  '/:key/pdf',
  requirePermission('reports:export'),
  validateParams(z.object({ key: z.string().max(60) })),
  validateQuery(reportQuery),
  asyncHandler(async (req, res) => {
    const report = findReport(req.params.key);
    const rows = await report.fetch(req.query as any, scopeDepartmentId(req));
    await recordAudit(req, {
      action: 'report.export',
      description: `Exported "${report.title}" to PDF (${rows.length} row(s)).`,
      entityType: 'report',
      metadata: { report: report.key, format: 'pdf' },
    });

    const columns: PdfTableColumn[] = report.columns.map((c) => ({
      header: c.header,
      width: c.pdfWidth,
      get: (row: any) => String(row[c.key] ?? ''),
    }));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${report.key}-${today()}.pdf"`);
    await genericToPdf(res, {
      title: report.title,
      subtitle: `${report.description}  -  ${rows.length} row(s)`,
      columns,
      rows,
    });
  }),
);

export default router;
