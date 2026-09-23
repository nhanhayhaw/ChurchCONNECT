/**
 * Birthday tracking and reminders.
 *
 * The "next birthday" is computed in SQL so that filtering and ordering happen
 * in the database rather than by loading the whole membership into Node. The
 * expression handles the year rollover (a birthday in January is "upcoming"
 * when today is in December) and folds 29 February onto 28 February in
 * non-leap years.
 */
import { query, queryOne } from '../../config/db.js';
import { getSetting } from '../../services/settings.service.js';
import { recordSystemAudit } from '../../services/audit.service.js';
import { ageOn, today, formatDayMonth } from '../../utils/dates.js';
import { ROLE_NAMES } from '../../config/permissions.js';

/**
 * SQL expression yielding the next occurrence of a member's birthday as a DATE.
 *
 *   1. Build the birthday in the current year (leap-day safe via make_date on
 *      a clamped day number).
 *   2. If that date has already passed, add a year.
 */
const NEXT_BIRTHDAY_SQL = `
  CASE
    WHEN make_date(
           EXTRACT(YEAR FROM CURRENT_DATE)::int,
           EXTRACT(MONTH FROM m.date_of_birth)::int,
           LEAST(
             EXTRACT(DAY FROM m.date_of_birth)::int,
             EXTRACT(DAY FROM (
               make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, EXTRACT(MONTH FROM m.date_of_birth)::int, 1)
               + interval '1 month - 1 day'
             ))::int
           )
         ) >= CURRENT_DATE
    THEN make_date(
           EXTRACT(YEAR FROM CURRENT_DATE)::int,
           EXTRACT(MONTH FROM m.date_of_birth)::int,
           LEAST(
             EXTRACT(DAY FROM m.date_of_birth)::int,
             EXTRACT(DAY FROM (
               make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, EXTRACT(MONTH FROM m.date_of_birth)::int, 1)
               + interval '1 month - 1 day'
             ))::int
           )
         )
    ELSE make_date(
           EXTRACT(YEAR FROM CURRENT_DATE)::int + 1,
           EXTRACT(MONTH FROM m.date_of_birth)::int,
           LEAST(
             EXTRACT(DAY FROM m.date_of_birth)::int,
             EXTRACT(DAY FROM (
               make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int + 1, EXTRACT(MONTH FROM m.date_of_birth)::int, 1)
               + interval '1 month - 1 day'
             ))::int
           )
         )
  END
`;

export interface BirthdayRow {
  memberId: number;
  memberCode: string;
  fullName: string;
  photoUrl: string | null;
  dateOfBirth: string;
  nextBirthday: string;
  birthdayLabel: string;
  daysAway: number;
  turningAge: number | null;
  currentAge: number | null;
  departmentName: string | null;
  groupName: string | null;
  phone: string | null;
  isToday: boolean;
}

function mapBirthday(r: any): BirthdayRow {
  const daysAway = Number(r.days_away);
  const currentAge = ageOn(r.date_of_birth);
  return {
    memberId: r.id,
    memberCode: r.member_code,
    fullName: [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' '),
    photoUrl: r.photo_id ? `/api/members/photos/${r.photo_id}` : null,
    dateOfBirth: r.date_of_birth,
    nextBirthday: r.next_birthday,
    birthdayLabel: formatDayMonth(r.date_of_birth),
    daysAway,
    // On the day itself they have already turned the new age.
    turningAge: currentAge == null ? null : daysAway === 0 ? currentAge : currentAge + 1,
    currentAge,
    departmentName: r.department_name,
    groupName: r.group_name,
    phone: r.phone,
    isToday: daysAway === 0,
  };
}

export type BirthdayRange = 'today' | 'week' | 'month' | 'upcoming';

/**
 * Birthdays within a range.
 *  today    - exactly today
 *  week     - the next 7 days inclusive of today
 *  month    - the remainder of the current calendar month
 *  upcoming - the next `windowDays` days (default 30)
 */
export async function listBirthdays(
  range: BirthdayRange = 'upcoming',
  opts: { windowDays?: number; departmentId?: number | null; month?: number } = {},
): Promise<BirthdayRow[]> {
  const params: unknown[] = [];
  const conditions: string[] = ['m.deleted_at IS NULL', "m.membership_status = 'active'", 'm.date_of_birth IS NOT NULL'];

  if (opts.departmentId) {
    params.push(opts.departmentId);
    conditions.push(`m.department_id = $${params.length}`);
  }

  let havingSql = '';
  if (opts.month) {
    // Explicit month filter (used by the "Monthly birthdays" report) ignores
    // the rolling window entirely.
    params.push(opts.month);
    conditions.push(`EXTRACT(MONTH FROM m.date_of_birth)::int = $${params.length}`);
  } else {
    switch (range) {
      case 'today':
        havingSql = 'WHERE days_away = 0';
        break;
      case 'week':
        havingSql = 'WHERE days_away BETWEEN 0 AND 6';
        break;
      case 'month':
        havingSql = `WHERE EXTRACT(MONTH FROM next_birthday) = EXTRACT(MONTH FROM CURRENT_DATE)
                       AND EXTRACT(YEAR FROM next_birthday) = EXTRACT(YEAR FROM CURRENT_DATE)`;
        break;
      default: {
        params.push(opts.windowDays ?? 30);
        havingSql = `WHERE days_away BETWEEN 0 AND $${params.length}`;
      }
    }
  }

  const { rows } = await query<any>(
    `SELECT * FROM (
       SELECT m.id, m.member_code, m.first_name, m.middle_name, m.last_name, m.phone,
              m.date_of_birth, m.photo_id,
              d.name AS department_name, g.name AS group_name,
              (${NEXT_BIRTHDAY_SQL}) AS next_birthday,
              ((${NEXT_BIRTHDAY_SQL}) - CURRENT_DATE) AS days_away
         FROM members m
         LEFT JOIN departments d ON d.id = m.department_id
         LEFT JOIN groups g      ON g.id = m.group_id
        WHERE ${conditions.join(' AND ')}
     ) b
     ${havingSql}
     ORDER BY ${opts.month ? 'EXTRACT(DAY FROM date_of_birth)' : 'days_away'} ASC, last_name ASC`,
    params,
  );

  return rows.map(mapBirthday);
}

/** Dashboard tiles. */
export async function birthdaySummary() {
  const row = await queryOne<any>(
    `SELECT
       COUNT(*) FILTER (WHERE days_away = 0)::int              AS today,
       COUNT(*) FILTER (WHERE days_away BETWEEN 0 AND 6)::int  AS this_week,
       COUNT(*) FILTER (WHERE EXTRACT(MONTH FROM next_birthday) = EXTRACT(MONTH FROM CURRENT_DATE)
                          AND EXTRACT(YEAR FROM next_birthday) = EXTRACT(YEAR FROM CURRENT_DATE))::int AS this_month
     FROM (
       SELECT (${NEXT_BIRTHDAY_SQL}) AS next_birthday,
              ((${NEXT_BIRTHDAY_SQL}) - CURRENT_DATE) AS days_away
         FROM members m
        WHERE m.deleted_at IS NULL AND m.membership_status = 'active' AND m.date_of_birth IS NOT NULL
     ) b`,
  );

  return {
    today: row?.today ?? 0,
    thisWeek: row?.this_week ?? 0,
    thisMonth: row?.this_month ?? 0,
  };
}

/**
 * Daily reminder generation.
 *
 * For each configured offset (7, 3, 1, 0 days by default), find every member
 * whose birthday falls exactly that many days from today and record a reminder
 * row. The UNIQUE(member_id, birthday_date, days_before) constraint makes the
 * whole job idempotent, so running it twice in a day changes nothing.
 *
 * Reminders are recorded regardless of the notification setting; what the
 * setting controls is whether a *notification* is raised for church workers.
 * Nothing is ever sent to the member.
 */
export async function generateBirthdayReminders(): Promise<{ created: number; notified: number }> {
  const offsets = (await getSetting('birthday_reminder_days')) as unknown as number[];
  const notifyEnabled = Boolean(await getSetting('birthday_notifications_enabled'));
  const days = Array.isArray(offsets) && offsets.length > 0 ? offsets : [7, 3, 1, 0];

  let created = 0;
  let notified = 0;

  const { rows: alertRoles } = await query<{ id: number }>(`SELECT id FROM roles WHERE name = ANY($1)`, [
    [ROLE_NAMES.SUPER_ADMIN, ROLE_NAMES.PASTOR, ROLE_NAMES.CHURCH_ADMIN],
  ]);

  for (const offset of days) {
    const { rows } = await query<{ id: number; next_birthday: string; full_name: string }>(
      `SELECT m.id, (${NEXT_BIRTHDAY_SQL}) AS next_birthday,
              m.first_name || ' ' || m.last_name AS full_name
         FROM members m
        WHERE m.deleted_at IS NULL AND m.membership_status = 'active' AND m.date_of_birth IS NOT NULL
          AND ((${NEXT_BIRTHDAY_SQL}) - CURRENT_DATE) = $1`,
      [offset],
    );

    for (const member of rows) {
      const inserted = await query(
        `INSERT INTO birthday_reminders (member_id, birthday_date, days_before, remind_on)
         VALUES ($1, $2, $3, CURRENT_DATE)
         ON CONFLICT (member_id, birthday_date, days_before) DO NOTHING
         RETURNING id`,
        [member.id, member.next_birthday, offset],
      );

      if (inserted.rowCount === 0) continue;
      created += 1;

      if (!notifyEnabled) continue;

      for (const role of alertRoles) {
        const n = await query(
          `INSERT INTO notifications (role_id, type, severity, title, body, link, entity_type, entity_id, dedupe_key)
           VALUES ($1, 'birthday', 'info', $2, $3, $4, 'member', $5, $6)
           ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
           RETURNING id`,
          [
            role.id,
            offset === 0
              ? `${member.full_name} celebrates a birthday today`
              : `${member.full_name}'s birthday is in ${offset} day(s)`,
            `Birthday on ${member.next_birthday}. Consider sending greetings from the church.`,
            `/members/${member.id}`,
            member.id,
            `birthday:${member.id}:${member.next_birthday}:${offset}:${role.id}`,
          ],
        );
        if (n.rowCount && n.rowCount > 0) notified += 1;
      }
    }
  }

  await recordSystemAudit({
    action: 'job.birthday_scan',
    description: `Birthday scan complete: ${created} reminder(s) generated, ${notified} notification(s) raised.`,
    metadata: { created, notified, offsets: days, notifyEnabled },
  });

  return { created, notified };
}

/** Reminders due today, for the dashboard reminder strip. */
export async function dueReminders() {
  const { rows } = await query<any>(
    `SELECT br.id, br.days_before, br.birthday_date, br.status,
            m.id AS member_id, m.first_name || ' ' || m.last_name AS full_name, m.photo_id, m.phone,
            d.name AS department_name
       FROM birthday_reminders br
       JOIN members m ON m.id = br.member_id
       LEFT JOIN departments d ON d.id = m.department_id
      WHERE br.remind_on = CURRENT_DATE AND br.status <> 'dismissed' AND m.deleted_at IS NULL
      ORDER BY br.days_before ASC, m.last_name`,
  );

  return rows.map((r) => ({
    id: r.id,
    memberId: r.member_id,
    fullName: r.full_name,
    photoUrl: r.photo_id ? `/api/members/photos/${r.photo_id}` : null,
    phone: r.phone,
    departmentName: r.department_name,
    birthdayDate: r.birthday_date,
    daysBefore: r.days_before,
    status: r.status,
  }));
}

export async function dismissReminder(id: number): Promise<void> {
  await query(`UPDATE birthday_reminders SET status = 'dismissed' WHERE id = $1`, [id]);
}

export { today };
