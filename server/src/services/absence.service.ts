/**
 * Automatic absence monitoring - the pastoral heart of RT AG Connect.
 *
 * WHAT IT DOES
 * For every active member it counts how many *consecutive* tracked services
 * (by default Sunday Services) they have most recently missed, and raises a
 * graded alert:
 *
 *    2 consecutive misses  -> Level 1  Follow-Up Reminder
 *    3 consecutive misses  -> Level 2  Urgent Follow-Up
 *    4 consecutive misses  -> Level 3  Pastoral Follow-Up
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It never changes a member's status, never marks anyone as having left, and
 * never contacts anyone. Absence has many innocent explanations - travel,
 * illness, a new baby, a work posting. The engine's only output is an alert
 * addressed to a church worker, who decides what it means.
 *
 * THE COUNTING RULES, and the reasoning behind each
 *  1. Only FINALISED services count. A register someone started and left
 *     half-finished must never make the congregation look absent.
 *  2. Only services the member could plausibly have attended count: services
 *     on or after their date_joined.
 *  3. A missing attendance row is "not recorded", NOT "absent". Only an
 *     explicit 'absent' mark breaks a streak upward. This is the single most
 *     important rule here - it is what stops a church that records only
 *     attendees (a very common practice) from alerting on everybody.
 *     Churches that DO mark everyone get full-strength detection; churches
 *     that only tick attendees get detection via rule 4 below.
 *  4. For churches that only record who came, an explicit 'present' mark on a
 *     finalised service is the positive signal. Any finalised tracked service
 *     with NO present mark for that member counts as a miss, provided the
 *     register was reasonably complete (>= 40% of active members marked). The
 *     completeness guard is what distinguishes "nobody recorded this week"
 *     from "this person genuinely did not come".
 *  5. 'excused' breaks the streak by default (absence_excused_counts = false).
 *     Someone who told the church they would be away is not a pastoral
 *     concern. A church can flip the setting if it wants excused absences to
 *     accumulate too.
 *
 * DUPLICATE SUPPRESSION
 * A member may have at most one OPEN follow-up (enforced by a partial unique
 * index in the schema). If a case is already open the engine only *escalates*
 * its level and week count; it never opens a second. Notifications carry a
 * dedupe_key of `absence:<memberId>:<level>` with a unique index, so the same
 * alert is announced once and only once no matter how often the scan runs.
 */
import { query, queryOne, tx } from '../config/db.js';
import { getSetting } from './settings.service.js';
import { recordSystemAudit } from './audit.service.js';
import { formatLongDate } from '../utils/dates.js';
import { ROLE_NAMES } from '../config/permissions.js';

export interface AbsenceCandidate {
  memberId: number;
  memberCode: string;
  fullName: string;
  phone: string | null;
  departmentId: number | null;
  departmentName: string | null;
  consecutiveMissed: number;
  level: 1 | 2 | 3;
  lastAttendanceDate: string | null;
  weeksAbsent: number;
}

export interface ScanResult {
  scannedServices: number;
  candidates: AbsenceCandidate[];
  alertsCreated: number;
  followUpsCreated: number;
  followUpsEscalated: number;
}

/** The finalised tracked services, newest first, with register completeness. */
async function loadTrackedServices(trackedTypes: string[], limit = 12) {
  const { rows } = await query<any>(
    `WITH active_count AS (
       SELECT COUNT(*)::int AS n FROM members
        WHERE deleted_at IS NULL AND membership_status = 'active'
     )
     SELECT s.id, s.service_date,
            COUNT(a.id)::int AS marked,
            (SELECT n FROM active_count) AS active_members
       FROM attendance_services s
       LEFT JOIN attendance a ON a.service_id = s.id
      WHERE s.is_finalized = TRUE
        AND s.service_type = ANY($1)
        AND s.department_id IS NULL
        AND s.group_id IS NULL
      GROUP BY s.id, s.service_date
      ORDER BY s.service_date DESC
      LIMIT $2`,
    [trackedTypes, limit],
  );

  return rows.map((r) => ({
    id: r.id as number,
    date: r.service_date as string,
    marked: r.marked as number,
    // Rule 4's completeness guard: a register covering under 40% of the
    // active roll is treated as informational only.
    isComplete: r.active_members > 0 ? r.marked / r.active_members >= 0.4 : false,
  }));
}

/**
 * Compute the current consecutive-miss streak for every active member.
 * One query loads the marks; the walk itself is done in memory because it is
 * a small, ordered scan (members x 12 services) and far clearer than the
 * equivalent window-function SQL.
 */
export async function computeAbsenceStreaks(): Promise<AbsenceCandidate[]> {
  const [l1, l2, l3, excusedCounts, trackedTypes] = await Promise.all([
    getSetting('absence_level_1_services'),
    getSetting('absence_level_2_services'),
    getSetting('absence_level_3_services'),
    getSetting('absence_excused_counts'),
    getSetting('absence_tracked_service_types'),
  ]);

  const types = Array.isArray(trackedTypes) ? trackedTypes : ['sunday_service'];
  const services = await loadTrackedServices(types, Math.max(Number(l3) + 4, 12));
  if (services.length === 0) return [];

  const serviceIds = services.map((s) => s.id);

  const { rows: members } = await query<any>(
    `SELECT m.id, m.member_code, m.first_name, m.middle_name, m.last_name, m.phone,
            m.date_joined, m.department_id, d.name AS department_name
       FROM members m
       LEFT JOIN departments d ON d.id = m.department_id
      WHERE m.deleted_at IS NULL AND m.membership_status = 'active'`,
  );

  const { rows: marks } = await query<any>(
    `SELECT member_id, service_id, status FROM attendance WHERE service_id = ANY($1)`,
    [serviceIds],
  );

  // memberId -> serviceId -> status
  const markIndex = new Map<number, Map<number, string>>();
  for (const m of marks) {
    let inner = markIndex.get(m.member_id);
    if (!inner) {
      inner = new Map();
      markIndex.set(m.member_id, inner);
    }
    inner.set(m.service_id, m.status);
  }

  const candidates: AbsenceCandidate[] = [];

  for (const member of members) {
    const memberMarks = markIndex.get(member.id) ?? new Map<number, string>();

    let streak = 0;
    let lastAttendanceDate: string | null = null;
    let firstMissedDate: string | null = null;

    // Walk newest -> oldest, stopping at the first service they attended.
    for (const svc of services) {
      // Rule 2 - services before they joined are not their absences.
      if (svc.date < member.date_joined) break;

      const status = memberMarks.get(svc.id);

      if (status === 'present') {
        lastAttendanceDate = svc.date;
        break;
      }

      if (status === 'excused' && !excusedCounts) {
        // Rule 5 - an excused absence breaks the streak without counting.
        break;
      }

      if (status === 'absent' || status === 'excused') {
        streak += 1;
        firstMissedDate = svc.date;
        continue;
      }

      // No mark at all (Rule 3 / 4).
      if (svc.isComplete) {
        streak += 1;
        firstMissedDate = svc.date;
        continue;
      }
      // Incomplete register - skip it entirely rather than guess.
    }

    if (streak < Number(l1)) continue;

    // If we never found a 'present' inside the scanned window, fall back to the
    // member's all-time last attendance so the alert copy is still accurate.
    if (!lastAttendanceDate) {
      const row = await queryOne<{ d: string | null }>(
        `SELECT MAX(s.service_date) AS d
           FROM attendance a JOIN attendance_services s ON s.id = a.service_id
          WHERE a.member_id = $1 AND a.status = 'present'`,
        [member.id],
      );
      lastAttendanceDate = row?.d ?? null;
    }

    const level: 1 | 2 | 3 = streak >= Number(l3) ? 3 : streak >= Number(l2) ? 2 : 1;

    // Weeks absent is derived from the calendar gap when we know the last
    // attendance, otherwise from the streak itself (tracked services are weekly).
    const weeksAbsent = lastAttendanceDate
      ? Math.max(streak, Math.floor((Date.parse(services[0]!.date) - Date.parse(lastAttendanceDate)) / 604_800_000))
      : streak;

    candidates.push({
      memberId: member.id,
      memberCode: member.member_code,
      fullName: [member.first_name, member.middle_name, member.last_name].filter(Boolean).join(' '),
      phone: member.phone,
      departmentId: member.department_id,
      departmentName: member.department_name,
      consecutiveMissed: streak,
      level,
      lastAttendanceDate,
      weeksAbsent,
    });
  }

  // Most serious first - that is the order a pastor wants to work through.
  candidates.sort((a, b) => b.consecutiveMissed - a.consecutiveMissed || a.fullName.localeCompare(b.fullName));
  return candidates;
}

const LEVEL_LABEL: Record<number, string> = {
  1: 'Level 1 - Follow-Up Reminder',
  2: 'Level 2 - Urgent Follow-Up',
  3: 'Level 3 - Pastoral Follow-Up',
};

const LEVEL_SEVERITY: Record<number, 'info' | 'warning' | 'critical'> = {
  1: 'info',
  2: 'warning',
  3: 'critical',
};

/**
 * Run a full scan: compute streaks, raise notifications, and (if enabled)
 * open or escalate follow-up cases.
 *
 * Idempotent. Running it ten times in a row produces the same database state
 * as running it once, which is what makes it safe to trigger both nightly and
 * on every register finalisation.
 */
export async function runAbsenceScan(opts: { triggeredBy?: number } = {}): Promise<ScanResult> {
  const autoCreate = await getSetting('absence_auto_create_followups');
  const candidates = await computeAbsenceStreaks();

  let alertsCreated = 0;
  let followUpsCreated = 0;
  let followUpsEscalated = 0;

  // Absence alerts go to everyone with a pastoral-care responsibility, not just
  // administrators - a pastor must be able to see them without being handed an
  // admin account. Notifications are addressed per role, so one row per role.
  const { rows: alertRoles } = await query<{ id: number }>(
    `SELECT id FROM roles WHERE name = ANY($1)`,
    [[ROLE_NAMES.SUPER_ADMIN, ROLE_NAMES.PASTOR, ROLE_NAMES.CHURCH_ADMIN]],
  );

  for (const c of candidates) {
    await tx(async (client) => {
      // --- 1. Notification, deduped per (member, level, role) ---------------
      const lastSeen = c.lastAttendanceDate
        ? `Last attendance: ${formatLongDate(c.lastAttendanceDate)}.`
        : 'No attendance has been recorded for this member yet.';

      let raisedForThisMember = false;

      for (const role of alertRoles) {
        // The dedupe index is PARTIAL (`WHERE dedupe_key IS NOT NULL`), so the
        // ON CONFLICT clause must repeat that predicate for PostgreSQL to infer
        // the index. Without it the statement fails with "no unique or exclusion
        // constraint matching the ON CONFLICT specification".
        // The key names the EPISODE as well as the level: a member's last
        // attendance date only changes when they come back, so a fresh absence
        // after a return produces a new key and is announced again, while the
        // nightly re-scan of an ongoing absence still collapses to one row.
        // Without the episode part the key was permanent, and nobody was ever
        // told about a member's second lapse.
        const notif = await client.query(
          `INSERT INTO notifications (role_id, type, severity, title, body, link, entity_type, entity_id, dedupe_key)
           VALUES ($1, 'absence_alert', $2, $3, $4, $5, 'member', $6, $7)
           ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
           RETURNING id`,
          [
            role.id,
            LEVEL_SEVERITY[c.level],
            `${c.fullName} - absent for ${c.consecutiveMissed} consecutive service(s)`,
            `${LEVEL_LABEL[c.level]}. ${lastSeen} Start a follow-up to record what is happening.`,
            `/members/${c.memberId}`,
            c.memberId,
            `absence:${c.memberId}:${c.level}:${role.id}:${c.lastAttendanceDate ?? 'never'}`,
          ],
        );
        if (notif.rowCount && notif.rowCount > 0) raisedForThisMember = true;
      }

      // Count one alert per member, however many roles were told about it.
      if (raisedForThisMember) alertsCreated += 1;

      if (!autoCreate) return;

      // --- 2. Open or escalate the follow-up case ---------------------------
      const { rows: open } = await client.query(
        `SELECT id, level FROM follow_ups
          WHERE member_id = $1 AND status NOT IN ('resolved','unable_to_reach')
          FOR UPDATE`,
        [c.memberId],
      );

      if (open[0]) {
        // Escalate only. Never downgrade - a case that reached Level 3 stays
        // visible at Level 3 until a worker resolves it.
        if (c.level > open[0].level) {
          await client.query(
            `UPDATE follow_ups
                SET level = $2, weeks_absent = $3, last_attendance_date = $4, updated_at = NOW()
              WHERE id = $1`,
            [open[0].id, c.level, c.weeksAbsent, c.lastAttendanceDate],
          );
          followUpsEscalated += 1;
        } else {
          await client.query(`UPDATE follow_ups SET weeks_absent = $2 WHERE id = $1`, [open[0].id, c.weeksAbsent]);
        }
        return;
      }

      await client.query(
        `INSERT INTO follow_ups (member_id, level, weeks_absent, last_attendance_date, status, source, created_by)
         VALUES ($1,$2,$3,$4,'pending','auto',$5)
         ON CONFLICT DO NOTHING`,
        [c.memberId, c.level, c.weeksAbsent, c.lastAttendanceDate, opts.triggeredBy ?? null],
      );
      followUpsCreated += 1;
    });
  }

  // The default is a readonly tuple; copy it so the value is a mutable string[].
  const services = await loadTrackedServices(
    [...((await getSetting('absence_tracked_service_types')) as readonly string[])],
    12,
  );

  await recordSystemAudit({
    action: 'job.absence_scan',
    description:
      `Absence scan complete: ${candidates.length} member(s) over threshold, ` +
      `${alertsCreated} new alert(s), ${followUpsCreated} follow-up(s) opened, ` +
      `${followUpsEscalated} escalated.`,
    metadata: { candidates: candidates.length, alertsCreated, followUpsCreated, followUpsEscalated },
  });

  return {
    scannedServices: services.length,
    candidates,
    alertsCreated,
    followUpsCreated,
    followUpsEscalated,
  };
}

/**
 * Read-only view of current alerts for the Follow-Up > Alerts screen.
 * Annotates each candidate with whether a case is already open, so the UI can
 * show "Start Follow-Up" or "View Follow-Up" correctly.
 */
export async function getAbsenceAlerts(scopeDepartmentId?: number | null) {
  const candidates = await computeAbsenceStreaks();
  const scoped = scopeDepartmentId
    ? candidates.filter((c) => c.departmentId === scopeDepartmentId)
    : candidates;

  if (scoped.length === 0) return [];

  const { rows } = await query<{ member_id: number; id: number; status: string; level: number }>(
    `SELECT member_id, id, status, level FROM follow_ups
      WHERE member_id = ANY($1) AND status NOT IN ('resolved','unable_to_reach')`,
    [scoped.map((c) => c.memberId)],
  );
  const openCases = new Map(rows.map((r) => [r.member_id, r]));

  return scoped.map((c) => {
    const open = openCases.get(c.memberId);
    return {
      ...c,
      levelLabel: LEVEL_LABEL[c.level],
      openFollowUpId: open?.id ?? null,
      openFollowUpStatus: open?.status ?? null,
    };
  });
}

/** Counts used by the dashboard's follow-up statistics tiles. */
export async function absenceSummary() {
  const candidates = await computeAbsenceStreaks();
  const [l1, l2, l3] = await Promise.all([
    getSetting('absence_level_1_services'),
    getSetting('absence_level_2_services'),
    getSetting('absence_level_3_services'),
  ]);

  return {
    absentTwoWeeks: candidates.filter((c) => c.consecutiveMissed >= Number(l1) && c.consecutiveMissed < Number(l2)).length,
    absentThreeWeeks: candidates.filter((c) => c.consecutiveMissed >= Number(l2) && c.consecutiveMissed < Number(l3)).length,
    absentOneMonth: candidates.filter((c) => c.consecutiveMissed >= Number(l3)).length,
    totalFlagged: candidates.length,
  };
}
