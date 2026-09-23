/**
 * Follow-up case management.
 *
 * A follow-up is a *conversation*, not a database flag. The status field
 * records where that conversation stands, and every change is accompanied by a
 * note so the next worker to pick the case up knows what was said.
 */
import { query, queryOne, tx } from '../../config/db.js';
import { notFound, badRequest } from '../../utils/errors.js';
import { paginate, safeSort, type Paginated } from '../../utils/http.js';
import { getSetting } from '../../services/settings.service.js';
import { today, addDays } from '../../utils/dates.js';

export const FOLLOW_UP_STATUSES = [
  { value: 'pending', label: 'Pending', tone: 'warning' },
  { value: 'contacted', label: 'Contacted', tone: 'info' },
  { value: 'responded', label: 'Responded', tone: 'success' },
  { value: 'needs_further_follow_up', label: 'Needs Further Follow-Up', tone: 'warning' },
  { value: 'resolved', label: 'Resolved', tone: 'success' },
  { value: 'unable_to_reach', label: 'Unable to Reach', tone: 'danger' },
] as const;

export const LEVEL_LABELS: Record<number, string> = {
  1: 'Level 1 - Follow-Up Reminder',
  2: 'Level 2 - Urgent Follow-Up',
  3: 'Level 3 - Pastoral Follow-Up',
};

const OPEN_STATUSES = "('pending','contacted','responded','needs_further_follow_up')";

export interface FollowUpRow {
  id: number;
  memberId: number;
  memberCode: string;
  memberName: string;
  memberPhone: string | null;
  photoUrl: string | null;
  departmentName: string | null;
  level: number;
  levelLabel: string;
  weeksAbsent: number;
  lastAttendanceDate: string | null;
  status: string;
  statusLabel: string;
  source: string;
  assignedToId: number | null;
  assignedToName: string | null;
  assignedAt: string | null;
  lastContactAt: string | null;
  nextFollowUpDate: string | null;
  resolvedAt: string | null;
  noteCount: number;
  isOverdue: boolean;
  createdAt: string;
}

const SORT_COLUMNS: Record<string, string> = {
  level: 'f.level',
  status: 'f.status',
  member: 'm.last_name',
  created: 'f.created_at',
  nextDate: 'f.next_follow_up_date',
  weeks: 'f.weeks_absent',
};

function mapRow(r: any, overdueDays: number): FollowUpRow {
  const statusLabel = FOLLOW_UP_STATUSES.find((s) => s.value === r.status)?.label ?? r.status;
  const isOpen = !['resolved', 'unable_to_reach'].includes(r.status);
  const reference = r.next_follow_up_date ?? r.created_at;
  const overdue =
    isOpen &&
    (r.next_follow_up_date
      ? r.next_follow_up_date < today()
      : Date.now() - Date.parse(reference) > overdueDays * 86_400_000);

  return {
    id: r.id,
    memberId: r.member_id,
    memberCode: r.member_code,
    memberName: [r.first_name, r.last_name].filter(Boolean).join(' '),
    memberPhone: r.phone,
    photoUrl: r.photo_id ? `/api/members/photos/${r.photo_id}` : null,
    departmentName: r.department_name,
    level: r.level,
    levelLabel: LEVEL_LABELS[r.level] ?? `Level ${r.level}`,
    weeksAbsent: r.weeks_absent,
    lastAttendanceDate: r.last_attendance_date,
    status: r.status,
    statusLabel,
    source: r.source,
    assignedToId: r.assigned_to,
    assignedToName: r.assigned_to_name,
    assignedAt: r.assigned_at,
    lastContactAt: r.last_contact_at,
    nextFollowUpDate: r.next_follow_up_date,
    resolvedAt: r.resolved_at,
    noteCount: r.note_count,
    isOverdue: overdue,
    createdAt: r.created_at,
  };
}

const BASE_SELECT = `
  SELECT f.*, m.member_code, m.first_name, m.last_name, m.phone, m.photo_id, m.department_id,
         d.name AS department_name, u.full_name AS assigned_to_name,
         (SELECT COUNT(*)::int FROM follow_up_notes n WHERE n.follow_up_id = f.id) AS note_count
    FROM follow_ups f
    JOIN members m ON m.id = f.member_id
    LEFT JOIN departments d ON d.id = m.department_id
    LEFT JOIN users u ON u.id = f.assigned_to
`;

export async function listFollowUps(
  filters: {
    status?: string;
    level?: number;
    assignedTo?: number;
    scope?: 'open' | 'overdue' | 'all';
    search?: string;
    sortBy?: string;
    sortDir?: string;
  },
  opts: { page: number; pageSize: number; offset: number; scopeDepartmentId?: number | null },
): Promise<Paginated<FollowUpRow>> {
  const overdueDays = Number(await getSetting('followup_overdue_days'));
  const where: string[] = ['m.deleted_at IS NULL'];
  const params: unknown[] = [];

  if (filters.status) {
    params.push(filters.status);
    where.push(`f.status = $${params.length}`);
  } else if (filters.scope === 'open' || !filters.scope) {
    where.push(`f.status IN ${OPEN_STATUSES}`);
  }

  if (filters.scope === 'overdue') {
    params.push(addDays(today(), -overdueDays));
    where.push(
      `f.status IN ${OPEN_STATUSES} AND (
         (f.next_follow_up_date IS NOT NULL AND f.next_follow_up_date < CURRENT_DATE)
         OR (f.next_follow_up_date IS NULL AND f.created_at::date < $${params.length})
       )`,
    );
  }

  if (filters.level) {
    params.push(filters.level);
    where.push(`f.level = $${params.length}`);
  }

  if (filters.assignedTo) {
    params.push(filters.assignedTo);
    where.push(`f.assigned_to = $${params.length}`);
  }

  if (opts.scopeDepartmentId) {
    params.push(opts.scopeDepartmentId);
    where.push(`m.department_id = $${params.length}`);
  }

  if (filters.search) {
    params.push(`%${filters.search.toLowerCase()}%`);
    where.push(`(LOWER(m.first_name || ' ' || m.last_name) LIKE $${params.length}
                 OR LOWER(m.member_code) LIKE $${params.length})`);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const orderSql = safeSort(filters.sortBy, SORT_COLUMNS, 'level', filters.sortDir ?? 'desc');

  const countRow = await queryOne<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM follow_ups f
       JOIN members m ON m.id = f.member_id ${whereSql}`,
    params,
  );

  const { rows } = await query<any>(
    `${BASE_SELECT} ${whereSql}
     ORDER BY ${orderSql}, f.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, opts.pageSize, opts.offset],
  );

  return paginate(rows.map((r) => mapRow(r, overdueDays)), countRow?.total ?? 0, opts.page, opts.pageSize);
}

export async function getFollowUp(id: number) {
  const overdueDays = Number(await getSetting('followup_overdue_days'));
  const row = await queryOne<any>(`${BASE_SELECT} WHERE f.id = $1`, [id]);
  if (!row) throw notFound('That follow-up could not be found.');

  const { rows: notes } = await query<any>(
    `SELECT n.id, n.note, n.contact_method, n.status_at_time, n.created_at, u.full_name AS author
       FROM follow_up_notes n
       LEFT JOIN users u ON u.id = n.author_user_id
      WHERE n.follow_up_id = $1
      ORDER BY n.created_at DESC`,
    [id],
  );

  return {
    followUp: mapRow(row, overdueDays),
    notes: notes.map((n) => ({
      id: n.id,
      note: n.note,
      contactMethod: n.contact_method,
      statusAtTime: n.status_at_time,
      author: n.author,
      createdAt: n.created_at,
    })),
  };
}

export interface CreateFollowUpInput {
  memberId: number;
  level?: number;
  assignedTo?: number | null;
  nextFollowUpDate?: string | null;
  note?: string | null;
}

/**
 * Open a case by hand, typically from the "Start Follow-Up" button on an
 * absence alert. Pre-fills level and weeks absent from the live streak so the
 * worker does not retype what the system already knows.
 */
export async function createFollowUp(input: CreateFollowUpInput, userId: number): Promise<number> {
  const member = await queryOne<{ id: number }>(
    `SELECT id FROM members WHERE id = $1 AND deleted_at IS NULL`,
    [input.memberId],
  );
  if (!member) throw notFound('That member could not be found.');

  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM follow_ups WHERE member_id = $1 AND status IN ${OPEN_STATUSES}`,
    [input.memberId],
  );
  if (existing) {
    throw badRequest('This member already has an open follow-up. Open that case instead of starting a new one.');
  }

  // Derive absence facts rather than trusting the client.
  const { computeAbsenceStreaks } = await import('../../services/absence.service.js');
  const streak = (await computeAbsenceStreaks()).find((c) => c.memberId === input.memberId);

  const lastAttendance = await queryOne<{ d: string | null }>(
    `SELECT MAX(s.service_date) AS d FROM attendance a
       JOIN attendance_services s ON s.id = a.service_id
      WHERE a.member_id = $1 AND a.status = 'present'`,
    [input.memberId],
  );

  return tx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO follow_ups
         (member_id, level, weeks_absent, last_attendance_date, status, source,
          assigned_to, assigned_at, next_follow_up_date, created_by)
       VALUES ($1,$2,$3,$4,'pending','manual',$5,$6,$7,$8)
       RETURNING id`,
      [
        input.memberId,
        input.level ?? streak?.level ?? 1,
        streak?.weeksAbsent ?? 0,
        lastAttendance?.d ?? null,
        input.assignedTo ?? userId,
        new Date(),
        input.nextFollowUpDate ?? addDays(today(), 3),
        userId,
      ],
    );
    const id = rows[0].id as number;

    if (input.note) {
      await client.query(
        `INSERT INTO follow_up_notes (follow_up_id, author_user_id, note, status_at_time)
         VALUES ($1,$2,$3,'pending')`,
        [id, userId, input.note],
      );
    }
    return id;
  });
}

export interface UpdateFollowUpInput {
  status?: string;
  assignedTo?: number | null;
  nextFollowUpDate?: string | null;
  level?: number;
}

export async function updateFollowUp(id: number, input: UpdateFollowUpInput, userId: number): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.status !== undefined) {
    params.push(input.status);
    sets.push(`status = $${params.length}`);
    // Reaching a terminal status stamps resolved_at; reopening clears it.
    if (['resolved', 'unable_to_reach'].includes(input.status)) {
      sets.push(`resolved_at = NOW()`);
    } else {
      sets.push(`resolved_at = NULL`);
    }
    if (input.status === 'contacted') sets.push(`last_contact_at = NOW()`);
  }

  if (input.assignedTo !== undefined) {
    params.push(input.assignedTo);
    sets.push(`assigned_to = $${params.length}`);
    sets.push(`assigned_at = NOW()`);
  }

  if (input.nextFollowUpDate !== undefined) {
    params.push(input.nextFollowUpDate);
    sets.push(`next_follow_up_date = $${params.length}`);
  }

  if (input.level !== undefined) {
    params.push(input.level);
    sets.push(`level = $${params.length}`);
  }

  if (sets.length === 0) throw badRequest('There is nothing to update.');

  params.push(id);
  const { rowCount } = await query(`UPDATE follow_ups SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  if (rowCount === 0) throw notFound('That follow-up could not be found.');
}

export async function addNote(
  followUpId: number,
  input: { note: string; contactMethod?: string | null; newStatus?: string | null; nextFollowUpDate?: string | null },
  userId: number,
): Promise<void> {
  await tx(async (client) => {
    const { rows } = await client.query(`SELECT status FROM follow_ups WHERE id = $1 FOR UPDATE`, [followUpId]);
    if (!rows[0]) throw notFound('That follow-up could not be found.');

    await client.query(
      `INSERT INTO follow_up_notes (follow_up_id, author_user_id, note, contact_method, status_at_time)
       VALUES ($1,$2,$3,$4,$5)`,
      [followUpId, userId, input.note, input.contactMethod ?? null, input.newStatus ?? rows[0].status],
    );

    const sets = ['last_contact_at = NOW()'];
    const params: unknown[] = [];

    if (input.newStatus) {
      params.push(input.newStatus);
      sets.push(`status = $${params.length}`);
      if (['resolved', 'unable_to_reach'].includes(input.newStatus)) sets.push('resolved_at = NOW()');
    }
    if (input.nextFollowUpDate) {
      params.push(input.nextFollowUpDate);
      sets.push(`next_follow_up_date = $${params.length}`);
    }

    params.push(followUpId);
    await client.query(`UPDATE follow_ups SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  });
}

/** Dashboard tiles. */
export async function followUpSummary() {
  const overdueDays = Number(await getSetting('followup_overdue_days'));
  const row = await queryOne<any>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending')::int   AS pending,
       COUNT(*) FILTER (WHERE status = 'contacted')::int AS contacted,
       COUNT(*) FILTER (WHERE status = 'responded')::int AS responded,
       COUNT(*) FILTER (WHERE status = 'needs_further_follow_up')::int AS needs_further,
       COUNT(*) FILTER (WHERE status = 'resolved')::int  AS resolved,
       COUNT(*) FILTER (WHERE status = 'unable_to_reach')::int AS unable,
       COUNT(*) FILTER (WHERE status IN ${OPEN_STATUSES})::int AS open,
       COUNT(*) FILTER (
         WHERE status IN ${OPEN_STATUSES}
           AND ((next_follow_up_date IS NOT NULL AND next_follow_up_date < CURRENT_DATE)
             OR (next_follow_up_date IS NULL AND created_at < NOW() - ($1 || ' days')::interval))
       )::int AS overdue
     FROM follow_ups`,
    [String(overdueDays)],
  );

  return {
    pending: row?.pending ?? 0,
    contacted: row?.contacted ?? 0,
    responded: row?.responded ?? 0,
    needsFurther: row?.needs_further ?? 0,
    resolved: row?.resolved ?? 0,
    unableToReach: row?.unable ?? 0,
    open: row?.open ?? 0,
    overdue: row?.overdue ?? 0,
  };
}

/** Users who can be assigned a follow-up. */
export async function assignableOfficers() {
  const { rows } = await query<any>(
    `SELECT u.id, u.full_name, r.label AS role_label
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.is_active
        AND r.name IN ('super_admin','pastor','church_admin','department_leader')
      ORDER BY u.full_name`,
  );
  return rows.map((r) => ({ id: r.id, fullName: r.full_name, roleLabel: r.role_label }));
}
