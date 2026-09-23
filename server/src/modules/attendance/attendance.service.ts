/**
 * Attendance services and registers.
 *
 * A "service" is the gathering; "attendance" rows are the register for it.
 * Marking a register is a single upsert per member inside one transaction, so
 * a half-saved register is impossible - either the whole register lands or
 * none of it does.
 */
import { query, queryOne, tx } from '../../config/db.js';
import { notFound, badRequest, forbidden } from '../../utils/errors.js';
import { paginate, type Paginated } from '../../utils/http.js';
import { today, startOfWeek, startOfMonth } from '../../utils/dates.js';
import { getMembersForRegister } from '../members/members.service.js';

export const SERVICE_TYPES = [
  { value: 'sunday_service', label: 'Sunday Service' },
  { value: 'midweek_service', label: 'Midweek Service' },
  { value: 'bible_study', label: 'Bible Study' },
  { value: 'prayer_meeting', label: 'Prayer Meeting' },
  { value: 'youth_service', label: 'Youth Service' },
  { value: 'womens_ministry', label: "Women's Ministry" },
  { value: 'mens_ministry', label: "Men's Ministry" },
  { value: 'special_programme', label: 'Special Programme' },
] as const;

export function serviceTypeLabel(value: string): string {
  return SERVICE_TYPES.find((t) => t.value === value)?.label ?? value.replace(/_/g, ' ');
}

export interface ServiceSummary {
  id: number;
  serviceDate: string;
  serviceType: string;
  serviceTypeLabel: string;
  title: string | null;
  departmentId: number | null;
  departmentName: string | null;
  groupId: number | null;
  groupName: string | null;
  isFinalized: boolean;
  present: number;
  absent: number;
  excused: number;
  totalRecorded: number;
  attendanceRate: number;
  recordedByName: string | null;
  createdAt: string;
}

const SERVICE_SELECT = `
  SELECT s.id, s.service_date, s.service_type, s.title, s.notes, s.is_finalized, s.created_at,
         s.department_id, d.name AS department_name,
         s.group_id, g.name AS group_name,
         u.full_name AS recorded_by_name,
         COUNT(a.id) FILTER (WHERE a.status = 'present')::int AS present,
         COUNT(a.id) FILTER (WHERE a.status = 'absent')::int  AS absent,
         COUNT(a.id) FILTER (WHERE a.status = 'excused')::int AS excused
    FROM attendance_services s
    LEFT JOIN departments d ON d.id = s.department_id
    LEFT JOIN groups g      ON g.id = s.group_id
    LEFT JOIN users u       ON u.id = s.recorded_by
    LEFT JOIN attendance a  ON a.service_id = s.id
`;

function mapService(r: any): ServiceSummary {
  const totalRecorded = r.present + r.absent + r.excused;
  return {
    id: r.id,
    serviceDate: r.service_date,
    serviceType: r.service_type,
    serviceTypeLabel: serviceTypeLabel(r.service_type),
    title: r.title,
    departmentId: r.department_id,
    departmentName: r.department_name,
    groupId: r.group_id,
    groupName: r.group_name,
    isFinalized: r.is_finalized,
    present: r.present,
    absent: r.absent,
    excused: r.excused,
    totalRecorded,
    attendanceRate: totalRecorded > 0 ? Math.round((r.present / totalRecorded) * 100) : 0,
    recordedByName: r.recorded_by_name,
    createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export async function listServices(
  filters: { from?: string; to?: string; serviceType?: string; departmentId?: number },
  opts: { page: number; pageSize: number; offset: number },
): Promise<Paginated<ServiceSummary>> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.from) {
    params.push(filters.from);
    where.push(`s.service_date >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    where.push(`s.service_date <= $${params.length}`);
  }
  if (filters.serviceType) {
    params.push(filters.serviceType);
    where.push(`s.service_type = $${params.length}`);
  }
  if (filters.departmentId) {
    params.push(filters.departmentId);
    where.push(`s.department_id = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRow = await queryOne<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM attendance_services s ${whereSql}`,
    params,
  );

  const { rows } = await query<any>(
    `${SERVICE_SELECT} ${whereSql}
     GROUP BY s.id, d.name, g.name, u.full_name
     ORDER BY s.service_date DESC, s.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, opts.pageSize, opts.offset],
  );

  return paginate(rows.map(mapService), countRow?.total ?? 0, opts.page, opts.pageSize);
}

export async function getService(id: number): Promise<ServiceSummary> {
  const row = await queryOne<any>(
    `${SERVICE_SELECT} WHERE s.id = $1 GROUP BY s.id, d.name, g.name, u.full_name`,
    [id],
  );
  if (!row) throw notFound('That service could not be found.');
  return mapService(row);
}

export interface CreateServiceInput {
  serviceDate: string;
  serviceType: string;
  title?: string | null;
  departmentId?: number | null;
  groupId?: number | null;
  notes?: string | null;
}

export async function createService(input: CreateServiceInput, userId: number): Promise<number> {
  if (input.serviceDate > today()) {
    throw badRequest('Attendance cannot be recorded for a future date.');
  }
  const { rows } = await query<{ id: number }>(
    `INSERT INTO attendance_services (service_date, service_type, title, department_id, group_id, notes, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      input.serviceDate,
      input.serviceType,
      input.title ?? null,
      input.departmentId ?? null,
      input.groupId ?? null,
      input.notes ?? null,
      userId,
    ],
  );
  return rows[0]!.id;
}

/**
 * Find an existing service for the same date/type/scope, or create one.
 * Used by "Record Attendance", where the administrator picks a date and type
 * and expects to continue an in-progress register rather than get a conflict.
 */
export async function findOrCreateService(input: CreateServiceInput, userId: number): Promise<number> {
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM attendance_services
      WHERE service_date = $1 AND service_type = $2
        AND COALESCE(department_id, 0) = COALESCE($3, 0)
        AND COALESCE(group_id, 0) = COALESCE($4, 0)`,
    [input.serviceDate, input.serviceType, input.departmentId ?? null, input.groupId ?? null],
  );
  return existing ? existing.id : createService(input, userId);
}

export async function deleteService(id: number): Promise<void> {
  const { rowCount } = await query(`DELETE FROM attendance_services WHERE id = $1`, [id]);
  if (rowCount === 0) throw notFound('That service could not be found.');
}

export async function finalizeService(id: number, finalized: boolean): Promise<void> {
  const { rowCount } = await query(`UPDATE attendance_services SET is_finalized = $2 WHERE id = $1`, [id, finalized]);
  if (rowCount === 0) throw notFound('That service could not be found.');
}

// ---------------------------------------------------------------------------
// Registers
// ---------------------------------------------------------------------------

export interface RegisterEntry {
  memberId: number;
  memberCode: string;
  fullName: string;
  gender: string;
  departmentName: string | null;
  photoUrl: string | null;
  status: 'present' | 'absent' | 'excused' | null;
  note: string | null;
}

/**
 * The full register for a service: every eligible active member, with their
 * current mark (null when not yet recorded). Returning unmarked members as
 * null - rather than defaulting them to absent - is what keeps a partially
 * completed register from generating false absence alerts.
 */
export async function getRegister(
  serviceId: number,
  opts: { scopeDepartmentId?: number | null } = {},
): Promise<{ service: ServiceSummary; entries: RegisterEntry[] }> {
  const service = await getService(serviceId);

  // A Department Leader sees their own people on a congregation-wide register
  // and nothing at all of another department's meeting.
  const scope = opts.scopeDepartmentId ?? null;
  if (scope !== null && service.departmentId !== null && service.departmentId !== scope) {
    throw forbidden("You can only view registers for your own department's meetings.");
  }

  const members = await getMembersForRegister({
    departmentId: service.departmentId ?? scope,
    groupId: service.groupId,
  });

  const { rows } = await query<any>(
    `SELECT member_id, status, note FROM attendance WHERE service_id = $1`,
    [serviceId],
  );
  const marks = new Map<number, { status: string; note: string | null }>(
    rows.map((r) => [r.member_id, { status: r.status, note: r.note }]),
  );

  const entries: RegisterEntry[] = members.map((m) => {
    const mark = marks.get(m.id);
    return {
      memberId: m.id,
      memberCode: m.memberCode,
      fullName: m.fullName,
      gender: m.gender,
      departmentName: m.departmentName,
      photoUrl: m.photoUrl,
      status: (mark?.status as RegisterEntry['status']) ?? null,
      note: mark?.note ?? null,
    };
  });

  return { service, entries };
}

export interface AttendanceMark {
  memberId: number;
  status: 'present' | 'absent' | 'excused';
  note?: string | null;
}

/**
 * Save a batch of marks. Upserts so re-submitting a register corrects it
 * rather than failing on the unique constraint.
 */
export async function saveRegister(
  serviceId: number,
  marks: AttendanceMark[],
  userId: number,
): Promise<{ saved: number }> {
  if (marks.length === 0) throw badRequest('No attendance marks were submitted.');

  const exists = await queryOne<{ id: number }>(`SELECT id FROM attendance_services WHERE id = $1`, [serviceId]);
  if (!exists) throw notFound('That service could not be found.');

  // One row per member, last mark wins. PostgreSQL refuses to touch the same
  // row twice inside a single INSERT ... ON CONFLICT ("cannot affect row a
  // second time"), and a register submitted from two open tabs can easily
  // contain a member twice.
  const byMember = new Map<number, AttendanceMark>();
  for (const m of marks) byMember.set(m.memberId, m);
  marks = [...byMember.values()];

  await tx(async (client) => {
    // Build one multi-row INSERT ... ON CONFLICT rather than N round trips.
    const values: unknown[] = [];
    const tuples = marks.map((m, i) => {
      const base = i * 5;
      values.push(serviceId, m.memberId, m.status, m.note ?? null, userId);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    });

    await client.query(
      `INSERT INTO attendance (service_id, member_id, status, note, recorded_by)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (service_id, member_id) DO UPDATE
         SET status = EXCLUDED.status,
             note = EXCLUDED.note,
             recorded_by = EXCLUDED.recorded_by,
             updated_at = NOW()`,
      values,
    );
  });

  return { saved: marks.length };
}

export async function clearMark(serviceId: number, memberId: number): Promise<void> {
  await query(`DELETE FROM attendance WHERE service_id = $1 AND member_id = $2`, [serviceId, memberId]);
}

// ---------------------------------------------------------------------------
// Statistics used by the dashboard and reports
// ---------------------------------------------------------------------------

export async function attendanceSnapshot() {
  const [todayRow, weekRow, monthRow] = await Promise.all([
    queryOne<any>(
      `SELECT COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
              COUNT(a.id)::int AS recorded
         FROM attendance a JOIN attendance_services s ON s.id = a.service_id
        WHERE s.service_date = $1`,
      [today()],
    ),
    queryOne<any>(
      `SELECT COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
              COUNT(a.id)::int AS recorded
         FROM attendance a JOIN attendance_services s ON s.id = a.service_id
        WHERE s.service_date >= $1`,
      [startOfWeek()],
    ),
    queryOne<any>(
      `SELECT COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
              COUNT(a.id)::int AS recorded
         FROM attendance a JOIN attendance_services s ON s.id = a.service_id
        WHERE s.service_date >= $1`,
      [startOfMonth()],
    ),
  ]);

  const rate = (r: any) => (r?.recorded > 0 ? Math.round((r.present / r.recorded) * 100) : 0);

  return {
    today: { present: todayRow?.present ?? 0, recorded: todayRow?.recorded ?? 0, rate: rate(todayRow) },
    thisWeek: { present: weekRow?.present ?? 0, recorded: weekRow?.recorded ?? 0, rate: rate(weekRow) },
    thisMonth: { present: monthRow?.present ?? 0, recorded: monthRow?.recorded ?? 0, rate: rate(monthRow) },
  };
}

/** Attendance for the last `weeks` Sunday services - the dashboard trend line. */
export async function attendanceTrend(weeks = 12) {
  const { rows } = await query<any>(
    `SELECT s.service_date,
            COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
            COUNT(*) FILTER (WHERE a.status = 'absent')::int  AS absent,
            COUNT(*) FILTER (WHERE a.status = 'excused')::int AS excused
       FROM attendance_services s
       LEFT JOIN attendance a ON a.service_id = s.id
      WHERE s.service_type = 'sunday_service'
      GROUP BY s.id, s.service_date
      ORDER BY s.service_date DESC
      LIMIT $1`,
    [weeks],
  );

  return rows
    .reverse()
    .map((r) => ({
      date: r.service_date,
      present: r.present,
      absent: r.absent,
      excused: r.excused,
      total: r.present + r.absent + r.excused,
    }));
}

/** Present/absent/excused totals per department for the comparison chart. */
export async function attendanceByDepartment(from: string, to: string) {
  const { rows } = await query<any>(
    `SELECT COALESCE(d.name, 'Unassigned') AS department,
            COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
            COUNT(*) FILTER (WHERE a.status = 'absent')::int  AS absent,
            COUNT(*) FILTER (WHERE a.status = 'excused')::int AS excused
       FROM attendance a
       JOIN attendance_services s ON s.id = a.service_id
       JOIN members m ON m.id = a.member_id
       LEFT JOIN departments d ON d.id = m.department_id
      WHERE s.service_date BETWEEN $1 AND $2
      GROUP BY d.name
      ORDER BY present DESC`,
    [from, to],
  );
  return rows.map((r) => ({
    department: r.department,
    present: r.present,
    absent: r.absent,
    excused: r.excused,
    rate: r.present + r.absent + r.excused > 0
      ? Math.round((r.present / (r.present + r.absent + r.excused)) * 100)
      : 0,
  }));
}

/** Members whose attendance rate falls below `threshold` percent. */
export async function lowAttendanceMembers(threshold = 50, from?: string, departmentId?: number | null) {
  const params: unknown[] = [threshold];
  let dateFilter = '';
  if (from) {
    params.push(from);
    dateFilter = ` AND s.service_date >= $${params.length}`;
  }
  let deptFilter = '';
  if (departmentId) {
    params.push(departmentId);
    deptFilter = ` AND m.department_id = $${params.length}`;
  }

  const { rows } = await query<any>(
    `SELECT m.id, m.member_code, m.first_name || ' ' || m.last_name AS full_name,
            m.phone, d.name AS department_name,
            COUNT(a.id)::int AS recorded,
            COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
            MAX(s.service_date) FILTER (WHERE a.status = 'present') AS last_present
       FROM members m
       JOIN attendance a ON a.member_id = m.id
       JOIN attendance_services s ON s.id = a.service_id${dateFilter}
       LEFT JOIN departments d ON d.id = m.department_id
      WHERE m.deleted_at IS NULL AND m.membership_status = 'active'${deptFilter}
      GROUP BY m.id, d.name
     HAVING COUNT(a.id) >= 3
        AND (COUNT(*) FILTER (WHERE a.status = 'present')::numeric / COUNT(a.id)) * 100 < $1
      ORDER BY (COUNT(*) FILTER (WHERE a.status = 'present')::numeric / COUNT(a.id)) ASC
      LIMIT 200`,
    params,
  );

  return rows.map((r) => ({
    memberId: r.id,
    memberCode: r.member_code,
    fullName: r.full_name,
    phone: r.phone,
    departmentName: r.department_name,
    recorded: r.recorded,
    present: r.present,
    rate: Math.round((r.present / r.recorded) * 100),
    lastPresent: r.last_present,
  }));
}
