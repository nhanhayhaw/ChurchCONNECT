/**
 * Dashboard aggregation.
 *
 * One endpoint returns every tile and chart series the dashboard needs. That
 * is deliberate: eight parallel round trips from the browser on every page
 * load is slower and harder to reason about than one server-side Promise.all
 * over indexed queries.
 */
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../../config/db.js';
import { asyncHandler } from '../../utils/http.js';
import { validateQuery } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { absenceSummary } from '../../services/absence.service.js';
import { followUpSummary } from '../followups/followups.service.js';
import { birthdaySummary, listBirthdays } from '../birthdays/birthdays.service.js';
import { attendanceSnapshot, attendanceTrend } from '../attendance/attendance.service.js';
import { startOfMonth, today } from '../../utils/dates.js';

const router = Router();
router.use(authenticate);

async function membershipStats() {
  const row = await queryOne<any>(
    `SELECT
       COUNT(*)::int                                              AS total,
       COUNT(*) FILTER (WHERE membership_status = 'active')::int   AS active,
       COUNT(*) FILTER (WHERE membership_status = 'inactive')::int AS inactive,
       COUNT(*) FILTER (WHERE gender = 'male'   AND membership_status = 'active')::int AS male,
       COUNT(*) FILTER (WHERE gender = 'female' AND membership_status = 'active')::int AS female,
       COUNT(*) FILTER (WHERE date_joined >= date_trunc('month', CURRENT_DATE))::int   AS new_this_month,
       COUNT(*) FILTER (WHERE date_joined >= CURRENT_DATE - interval '90 days')::int   AS new_last_90_days
     FROM members WHERE deleted_at IS NULL`,
  );
  return {
    total: row?.total ?? 0,
    active: row?.active ?? 0,
    inactive: row?.inactive ?? 0,
    male: row?.male ?? 0,
    female: row?.female ?? 0,
    newThisMonth: row?.new_this_month ?? 0,
    newLast90Days: row?.new_last_90_days ?? 0,
  };
}

/** New members per month for the growth chart. */
async function membershipGrowth(months = 12) {
  const { rows } = await query<any>(
    `WITH series AS (
       SELECT generate_series(
         date_trunc('month', CURRENT_DATE) - ($1::int - 1) * interval '1 month',
         date_trunc('month', CURRENT_DATE),
         interval '1 month'
       )::date AS month_start
     )
     SELECT s.month_start,
            COUNT(m.id)::int AS new_members
       FROM series s
       LEFT JOIN members m
              ON date_trunc('month', m.date_joined) = s.month_start
             AND m.deleted_at IS NULL
      GROUP BY s.month_start
      ORDER BY s.month_start`,
    [months],
  );

  // Running total gives the cumulative membership line on the same chart.
  let cumulative = 0;
  const baseline = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM members
      WHERE deleted_at IS NULL
        AND date_joined < date_trunc('month', CURRENT_DATE) - ($1::int - 1) * interval '1 month'`,
    [months],
  );
  cumulative = baseline?.n ?? 0;

  return rows.map((r) => {
    cumulative += r.new_members;
    return { month: r.month_start, newMembers: r.new_members, totalMembers: cumulative };
  });
}

async function departmentDistribution() {
  const { rows } = await query<any>(
    `SELECT COALESCE(d.name, 'Unassigned') AS name, COUNT(m.id)::int AS value
       FROM members m
       LEFT JOIN departments d ON d.id = m.department_id
      WHERE m.deleted_at IS NULL AND m.membership_status = 'active'
      GROUP BY d.name
      ORDER BY value DESC`,
  );
  return rows;
}

async function ageDistribution() {
  const { rows } = await query<any>(
    `SELECT bucket, COUNT(*)::int AS value FROM (
       SELECT CASE
         WHEN date_of_birth IS NULL THEN 'Unknown'
         WHEN AGE(date_of_birth) < interval '13 years' THEN '0-12'
         WHEN AGE(date_of_birth) < interval '20 years' THEN '13-19'
         WHEN AGE(date_of_birth) < interval '31 years' THEN '20-30'
         WHEN AGE(date_of_birth) < interval '46 years' THEN '31-45'
         WHEN AGE(date_of_birth) < interval '61 years' THEN '46-60'
         ELSE '60+'
       END AS bucket
       FROM members WHERE deleted_at IS NULL AND membership_status = 'active'
     ) t
     GROUP BY bucket
     ORDER BY CASE bucket
       WHEN '0-12' THEN 1 WHEN '13-19' THEN 2 WHEN '20-30' THEN 3
       WHEN '31-45' THEN 4 WHEN '46-60' THEN 5 WHEN '60+' THEN 6 ELSE 7 END`,
  );
  return rows;
}

/** Present / absent / excused totals this month, for the comparison chart. */
async function attendanceComparison() {
  const { rows } = await query<any>(
    `SELECT s.service_type,
            COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
            COUNT(*) FILTER (WHERE a.status = 'absent')::int  AS absent,
            COUNT(*) FILTER (WHERE a.status = 'excused')::int AS excused
       FROM attendance a
       JOIN attendance_services s ON s.id = a.service_id
      WHERE s.service_date >= $1
      GROUP BY s.service_type
      ORDER BY present DESC`,
    [startOfMonth()],
  );
  return rows.map((r) => ({
    serviceType: r.service_type,
    label: r.service_type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
    present: r.present,
    absent: r.absent,
    excused: r.excused,
  }));
}

router.get(
  '/',
  requirePermission('dashboard:read'),
  validateQuery(z.object({ weeks: z.coerce.number().int().min(4).max(52).optional() })),
  asyncHandler(async (req, res) => {
    const weeks = Number((req.query as any).weeks ?? 12);

    const [
      membership,
      attendance,
      trend,
      absence,
      followUps,
      birthdays,
      upcomingBirthdays,
      growth,
      byDepartment,
      byAge,
      comparison,
      recentServices,
    ] = await Promise.all([
      membershipStats(),
      attendanceSnapshot(),
      attendanceTrend(weeks),
      absenceSummary(),
      followUpSummary(),
      birthdaySummary(),
      listBirthdays('upcoming', { windowDays: 14 }),
      membershipGrowth(12),
      departmentDistribution(),
      ageDistribution(),
      attendanceComparison(),
      query<any>(
        `SELECT s.id, s.service_date, s.service_type, s.title, s.is_finalized,
                COUNT(a.id) FILTER (WHERE a.status = 'present')::int AS present,
                COUNT(a.id)::int AS recorded
           FROM attendance_services s
           LEFT JOIN attendance a ON a.service_id = s.id
          GROUP BY s.id
          ORDER BY s.service_date DESC, s.id DESC
          LIMIT 5`,
      ),
    ]);

    res.json({
      generatedAt: today(),
      membership,
      attendance,
      absence,
      followUps,
      birthdays: { ...birthdays, upcoming: upcomingBirthdays.slice(0, 8) },
      charts: {
        attendanceTrend: trend,
        membershipGrowth: growth,
        genderDistribution: [
          { name: 'Male', value: membership.male },
          { name: 'Female', value: membership.female },
        ],
        departmentDistribution: byDepartment,
        ageDistribution: byAge,
        attendanceComparison: comparison,
      },
      recentServices: recentServices.rows.map((r) => ({
        id: r.id,
        serviceDate: r.service_date,
        serviceType: r.service_type,
        title: r.title,
        isFinalized: r.is_finalized,
        present: r.present,
        recorded: r.recorded,
      })),
    });
  }),
);

export default router;
