/**
 * Member data access.
 *
 * All SQL lives here; the route layer only translates HTTP into calls on these
 * functions. Every statement is parameterised, and the only place a caller can
 * influence the *shape* of a query is through the whitelisted sort map.
 */
import { query, queryOne, tx } from '../../config/db.js';
import { notFound, badRequest } from '../../utils/errors.js';
import { safeSort, paginate, type Paginated } from '../../utils/http.js';
import { ageOn, daysUntilBirthday, today } from '../../utils/dates.js';
import type { MemberCreateInput, MemberUpdateInput, MemberListQuery } from './members.schema.js';

export interface MemberListRow {
  id: number;
  memberCode: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  fullName: string;
  gender: 'male' | 'female';
  dateOfBirth: string | null;
  phone: string | null;
  email: string | null;
  membershipStatus: string;
  membershipCategory: string;
  dateJoined: string;
  departmentId: number | null;
  departmentName: string | null;
  groupId: number | null;
  groupName: string | null;
  photoUrl: string | null;
  age: number | null;
  lastAttendanceDate: string | null;
}

const SORT_COLUMNS: Record<string, string> = {
  name: 'm.last_name',
  memberCode: 'm.member_code',
  dateJoined: 'm.date_joined',
  department: 'd.name',
  status: 'm.membership_status',
  age: 'm.date_of_birth',
};

/** Public URL for a stored photo. Null when the member has none. */
function photoUrl(photoId: number | null): string | null {
  return photoId ? `/api/members/photos/${photoId}` : null;
}

/**
 * Generate the next member code, e.g. CC-2026-0042.
 * Runs inside the caller's transaction and takes an advisory lock so two
 * simultaneous registrations cannot claim the same number.
 */
async function nextMemberCode(client: { query: Function }): Promise<string> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['member_code_seq']);
  const year = new Date().getFullYear();
  const prefix = `CC-${year}-`;
  // Only codes whose suffix is purely numeric take part, and the maximum is
  // taken numerically rather than by string order. Both matter: a manually
  // typed code such as CC-2026-TEMP would otherwise sort first and produce
  // "CC-2026-NaN" for every registration that follows, and after 9999 members
  // "CC-2026-10000" would sort below "CC-2026-9999" and be reissued.
  // `$2::int` is essential: without the cast PostgreSQL resolves the untyped
  // parameter to SUBSTRING(text FROM text) - the regular-expression form - and
  // the "position" becomes a pattern.
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(SUBSTRING(member_code FROM $2::int)::int), 0) AS last
       FROM members
      WHERE member_code ~ $1`,
    [`^${prefix.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}[0-9]+$`, prefix.length + 1],
  );
  const next = Number(rows[0]?.last ?? 0) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listMembers(
  q: MemberListQuery,
  opts: { page: number; pageSize: number; offset: number; scopeDepartmentId?: number | null },
): Promise<Paginated<MemberListRow>> {
  const where: string[] = ['m.deleted_at IS NULL'];
  const params: unknown[] = [];

  const status = q.status ?? 'active';
  if (status !== 'all') {
    params.push(status);
    where.push(`m.membership_status = $${params.length}`);
  }

  if (q.gender && q.gender !== 'all') {
    params.push(q.gender);
    where.push(`m.gender = $${params.length}`);
  }

  // Department Leaders are scoped to their own department at the SQL level.
  const deptFilter = opts.scopeDepartmentId ?? q.departmentId;
  if (deptFilter) {
    params.push(deptFilter);
    where.push(`m.department_id = $${params.length}`);
  }

  if (q.groupId) {
    params.push(q.groupId);
    where.push(`m.group_id = $${params.length}`);
  }

  if (q.category) {
    params.push(q.category);
    where.push(`m.membership_category = $${params.length}`);
  }

  if (q.joinedFrom) {
    params.push(q.joinedFrom);
    where.push(`m.date_joined >= $${params.length}`);
  }
  if (q.joinedTo) {
    params.push(q.joinedTo);
    where.push(`m.date_joined <= $${params.length}`);
  }

  if (q.search) {
    params.push(`%${q.search.toLowerCase()}%`);
    const i = params.length;
    where.push(`(
      LOWER(m.first_name || ' ' || COALESCE(m.middle_name || ' ', '') || m.last_name) LIKE $${i}
      OR LOWER(m.member_code) LIKE $${i}
      OR LOWER(COALESCE(m.email, '')) LIKE $${i}
      OR REPLACE(COALESCE(m.phone, ''), ' ', '') LIKE REPLACE($${i}, ' ', '')
    )`);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const orderSql = safeSort(q.sortBy, SORT_COLUMNS, 'name', q.sortDir ?? 'asc');

  const countRow = await queryOne<{ total: number }>(
    `SELECT COUNT(*)::int AS total
       FROM members m
       LEFT JOIN departments d ON d.id = m.department_id
       ${whereSql}`,
    params,
  );

  const { rows } = await query<any>(
    `SELECT m.id, m.member_code, m.first_name, m.middle_name, m.last_name, m.gender,
            m.date_of_birth, m.phone, m.email, m.membership_status, m.membership_category,
            m.date_joined, m.department_id, d.name AS department_name,
            m.group_id, g.name AS group_name, m.photo_id,
            (SELECT MAX(s.service_date)
               FROM attendance a
               JOIN attendance_services s ON s.id = a.service_id
              WHERE a.member_id = m.id AND a.status = 'present') AS last_attendance_date
       FROM members m
       LEFT JOIN departments d ON d.id = m.department_id
       LEFT JOIN groups g ON g.id = m.group_id
       ${whereSql}
       ORDER BY ${orderSql}, m.first_name ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, opts.pageSize, opts.offset],
  );

  const data: MemberListRow[] = rows.map((r) => ({
    id: r.id,
    memberCode: r.member_code,
    firstName: r.first_name,
    middleName: r.middle_name,
    lastName: r.last_name,
    fullName: [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' '),
    gender: r.gender,
    dateOfBirth: r.date_of_birth,
    phone: r.phone,
    email: r.email,
    membershipStatus: r.membership_status,
    membershipCategory: r.membership_category,
    dateJoined: r.date_joined,
    departmentId: r.department_id,
    departmentName: r.department_name,
    groupId: r.group_id,
    groupName: r.group_name,
    photoUrl: photoUrl(r.photo_id),
    age: ageOn(r.date_of_birth),
    lastAttendanceDate: r.last_attendance_date,
  }));

  return paginate(data, countRow?.total ?? 0, opts.page, opts.pageSize);
}

// ---------------------------------------------------------------------------
// Read one
// ---------------------------------------------------------------------------

export async function getMember(id: number) {
  const row = await queryOne<any>(
    `SELECT m.*, d.name AS department_name, g.name AS group_name,
            cu.full_name AS created_by_name, uu.full_name AS updated_by_name
       FROM members m
       LEFT JOIN departments d ON d.id = m.department_id
       LEFT JOIN groups g      ON g.id = m.group_id
       LEFT JOIN users cu      ON cu.id = m.created_by
       LEFT JOIN users uu      ON uu.id = m.updated_by
      WHERE m.id = $1 AND m.deleted_at IS NULL`,
    [id],
  );
  if (!row) throw notFound('That member record could not be found.');

  return {
    id: row.id,
    memberCode: row.member_code,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    fullName: [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' '),
    gender: row.gender,
    dateOfBirth: row.date_of_birth,
    age: ageOn(row.date_of_birth),
    daysToBirthday: row.date_of_birth ? daysUntilBirthday(row.date_of_birth) : null,
    maritalStatus: row.marital_status,
    nationality: row.nationality,
    phone: row.phone,
    altPhone: row.alt_phone,
    email: row.email,
    address: row.address,
    dateJoined: row.date_joined,
    membershipStatus: row.membership_status,
    baptismStatus: row.baptism_status,
    communionStatus: row.communion_status,
    membershipCategory: row.membership_category,
    ministry: row.ministry,
    departmentId: row.department_id,
    departmentName: row.department_name,
    groupId: row.group_id,
    groupName: row.group_name,
    emergencyName: row.emergency_name,
    emergencyRelationship: row.emergency_relationship,
    emergencyPhone: row.emergency_phone,
    notes: row.notes,
    photoUrl: photoUrl(row.photo_id),
    createdByName: row.created_by_name,
    updatedByName: row.updated_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type MemberDetail = Awaited<ReturnType<typeof getMember>>;

// ---------------------------------------------------------------------------
// Create / update / delete
// ---------------------------------------------------------------------------

const INSERT_COLUMNS = [
  'member_code', 'first_name', 'middle_name', 'last_name', 'gender', 'date_of_birth',
  'marital_status', 'nationality', 'phone', 'alt_phone', 'email', 'address',
  'date_joined', 'membership_status', 'baptism_status', 'communion_status',
  'membership_category', 'ministry', 'department_id', 'group_id',
  'emergency_name', 'emergency_relationship', 'emergency_phone', 'notes', 'created_by',
];

export async function createMember(input: MemberCreateInput, userId: number): Promise<number> {
  return tx(async (client) => {
    const code = input.memberCode ?? (await nextMemberCode(client));

    const values = [
      code, input.firstName, input.middleName, input.lastName, input.gender, input.dateOfBirth ?? null,
      input.maritalStatus ?? null, input.nationality ?? 'Ghanaian', input.phone, input.altPhone, input.email,
      input.address, input.dateJoined, input.membershipStatus, input.baptismStatus, input.communionStatus,
      input.membershipCategory, input.ministry, input.departmentId ?? null, input.groupId ?? null,
      input.emergencyName, input.emergencyRelationship, input.emergencyPhone, input.notes, userId,
    ];

    const placeholders = INSERT_COLUMNS.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await client.query(
      `INSERT INTO members (${INSERT_COLUMNS.join(', ')}) VALUES (${placeholders}) RETURNING id`,
      values,
    );
    return rows[0].id as number;
  });
}

/** Map of API field -> column, used to build a partial UPDATE safely. */
const UPDATE_MAP: Record<keyof MemberUpdateInput, string> = {
  memberCode: 'member_code',
  firstName: 'first_name',
  middleName: 'middle_name',
  lastName: 'last_name',
  gender: 'gender',
  dateOfBirth: 'date_of_birth',
  maritalStatus: 'marital_status',
  nationality: 'nationality',
  phone: 'phone',
  altPhone: 'alt_phone',
  email: 'email',
  address: 'address',
  dateJoined: 'date_joined',
  membershipStatus: 'membership_status',
  baptismStatus: 'baptism_status',
  communionStatus: 'communion_status',
  membershipCategory: 'membership_category',
  ministry: 'ministry',
  departmentId: 'department_id',
  groupId: 'group_id',
  emergencyName: 'emergency_name',
  emergencyRelationship: 'emergency_relationship',
  emergencyPhone: 'emergency_phone',
  notes: 'notes',
};

export async function updateMember(id: number, input: MemberUpdateInput, userId: number): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];

  for (const [field, column] of Object.entries(UPDATE_MAP)) {
    const value = (input as any)[field];
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }

  if (sets.length === 0) throw badRequest('There is nothing to update.');

  params.push(userId);
  sets.push(`updated_by = $${params.length}`);
  params.push(id);

  const { rowCount } = await query(
    `UPDATE members SET ${sets.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL`,
    params,
  );
  if (rowCount === 0) throw notFound('That member record could not be found.');
}

/**
 * Soft delete. The record disappears from every list and report but remains
 * joinable from attendance history and audit logs, so past registers stay
 * intelligible. A Super Administrator can restore it.
 */
export async function deleteMember(id: number, userId: number): Promise<void> {
  const { rowCount } = await query(
    `UPDATE members SET deleted_at = NOW(), updated_by = $2 WHERE id = $1 AND deleted_at IS NULL`,
    [id, userId],
  );
  if (rowCount === 0) throw notFound('That member record could not be found.');
  // Close any open follow-up so it does not linger in the pending queue.
  await query(
    `UPDATE follow_ups SET status = 'resolved', resolved_at = NOW()
      WHERE member_id = $1 AND status NOT IN ('resolved','unable_to_reach')`,
    [id],
  );
}

export async function restoreMember(id: number): Promise<void> {
  const { rowCount } = await query(`UPDATE members SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL`, [id]);
  if (rowCount === 0) throw notFound('No deleted member with that reference was found.');
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export async function attachPhoto(
  memberId: number,
  photo: { fileName: string; storagePath: string; mimeType: string; sizeBytes: number },
  userId: number,
): Promise<{ photoId: number; replaced: { id: number; storagePath: string } | null }> {
  return tx(async (client) => {
    const { rows: existing } = await client.query(
      `SELECT p.id, p.storage_path FROM members m
         JOIN member_photos p ON p.id = m.photo_id
        WHERE m.id = $1`,
      [memberId],
    );

    const { rows } = await client.query(
      `INSERT INTO member_photos (member_id, file_name, storage_path, mime_type, size_bytes, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [memberId, photo.fileName, photo.storagePath, photo.mimeType, photo.sizeBytes, userId],
    );
    const photoId = rows[0].id as number;

    await client.query(`UPDATE members SET photo_id = $2, updated_by = $3 WHERE id = $1`, [memberId, photoId, userId]);

    if (existing[0]) {
      await client.query(`DELETE FROM member_photos WHERE id = $1`, [existing[0].id]);
    }

    return {
      photoId,
      replaced: existing[0] ? { id: existing[0].id, storagePath: existing[0].storage_path } : null,
    };
  });
}

export async function getPhotoRecord(photoId: number) {
  return queryOne<{ id: number; storage_path: string; mime_type: string; member_id: number }>(
    `SELECT id, storage_path, mime_type, member_id FROM member_photos WHERE id = $1`,
    [photoId],
  );
}

export async function removePhoto(memberId: number, userId: number): Promise<string | null> {
  return tx(async (client) => {
    const { rows } = await client.query(
      `SELECT p.id, p.storage_path FROM members m JOIN member_photos p ON p.id = m.photo_id WHERE m.id = $1`,
      [memberId],
    );
    if (!rows[0]) return null;
    await client.query(`UPDATE members SET photo_id = NULL, updated_by = $2 WHERE id = $1`, [memberId, userId]);
    await client.query(`DELETE FROM member_photos WHERE id = $1`, [rows[0].id]);
    return rows[0].storage_path as string;
  });
}

// ---------------------------------------------------------------------------
// Related data used by the member profile tabs
// ---------------------------------------------------------------------------

export async function getMemberAttendance(memberId: number, limit = 60) {
  const { rows } = await query<any>(
    `SELECT a.id, a.status, a.note, s.service_date, s.service_type, s.title
       FROM attendance a
       JOIN attendance_services s ON s.id = a.service_id
      WHERE a.member_id = $1
      ORDER BY s.service_date DESC, s.id DESC
      LIMIT $2`,
    [memberId, limit],
  );

  const summary = await queryOne<any>(
    `SELECT
        COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
        COUNT(*) FILTER (WHERE a.status = 'absent')::int  AS absent,
        COUNT(*) FILTER (WHERE a.status = 'excused')::int AS excused,
        MAX(s.service_date) FILTER (WHERE a.status = 'present') AS last_present
       FROM attendance a
       JOIN attendance_services s ON s.id = a.service_id
      WHERE a.member_id = $1`,
    [memberId],
  );

  const recorded = (summary?.present ?? 0) + (summary?.absent ?? 0) + (summary?.excused ?? 0);
  return {
    records: rows.map((r) => ({
      id: r.id,
      status: r.status,
      note: r.note,
      serviceDate: r.service_date,
      serviceType: r.service_type,
      title: r.title,
    })),
    summary: {
      present: summary?.present ?? 0,
      absent: summary?.absent ?? 0,
      excused: summary?.excused ?? 0,
      totalRecorded: recorded,
      rate: recorded > 0 ? Math.round(((summary?.present ?? 0) / recorded) * 100) : 0,
      lastPresent: summary?.last_present ?? null,
    },
  };
}

export async function getMemberFollowUps(memberId: number) {
  const { rows } = await query<any>(
    `SELECT f.id, f.level, f.status, f.weeks_absent, f.last_attendance_date, f.next_follow_up_date,
            f.created_at, f.resolved_at, f.source, u.full_name AS assigned_to_name,
            (SELECT COUNT(*)::int FROM follow_up_notes n WHERE n.follow_up_id = f.id) AS note_count
       FROM follow_ups f
       LEFT JOIN users u ON u.id = f.assigned_to
      WHERE f.member_id = $1
      ORDER BY f.created_at DESC`,
    [memberId],
  );
  return rows.map((r) => ({
    id: r.id,
    level: r.level,
    status: r.status,
    weeksAbsent: r.weeks_absent,
    lastAttendanceDate: r.last_attendance_date,
    nextFollowUpDate: r.next_follow_up_date,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    source: r.source,
    assignedToName: r.assigned_to_name,
    noteCount: r.note_count,
  }));
}

/**
 * Activity timeline assembled from audit logs plus the events that matter
 * pastorally (attendance marks, follow-up notes). Union in SQL so the rows can
 * be ordered and limited by the database rather than in memory.
 */
export async function getMemberTimeline(memberId: number, limit = 40) {
  const { rows } = await query<any>(
    `(
       SELECT 'audit' AS kind, a.created_at AS at, a.action AS code, a.description AS text,
              a.user_email AS actor
         FROM audit_logs a
        WHERE a.entity_type = 'member' AND a.entity_id = $1
     )
     UNION ALL
     (
       SELECT 'attendance', s.created_at, 'attendance.' || att.status,
              CASE att.status
                WHEN 'present' THEN 'Marked present at ' || COALESCE(s.title, REPLACE(s.service_type,'_',' '))
                WHEN 'excused' THEN 'Marked excused for ' || COALESCE(s.title, REPLACE(s.service_type,'_',' '))
                ELSE 'Marked absent from ' || COALESCE(s.title, REPLACE(s.service_type,'_',' '))
              END || ' on ' || TO_CHAR(s.service_date, 'FMMonth FMDD, YYYY'),
              NULL
         FROM attendance att
         JOIN attendance_services s ON s.id = att.service_id
        WHERE att.member_id = $1
     )
     UNION ALL
     (
       SELECT 'followup', n.created_at, 'followup.note',
              'Follow-up note: ' || LEFT(n.note, 160), u.full_name
         FROM follow_up_notes n
         JOIN follow_ups f ON f.id = n.follow_up_id
         LEFT JOIN users u ON u.id = n.author_user_id
        WHERE f.member_id = $1
     )
     ORDER BY at DESC
     LIMIT $2`,
    [memberId, limit],
  );
  return rows.map((r) => ({ kind: r.kind, at: r.at, code: r.code, text: r.text, actor: r.actor }));
}

/** Rows for Excel/PDF export - respects the same filters as the list. */
export async function exportMembers(q: MemberListQuery, scopeDepartmentId?: number | null) {
  const result = await listMembers(q, { page: 1, pageSize: 5000, offset: 0, scopeDepartmentId });
  return result.data;
}

export async function countMembersInDepartment(departmentId: number): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM members WHERE department_id = $1 AND deleted_at IS NULL`,
    [departmentId],
  );
  return row?.n ?? 0;
}

/** Minimal member rows used to build an attendance register. */
export async function getMembersForRegister(opts: {
  departmentId?: number | null;
  groupId?: number | null;
}) {
  const where: string[] = [`m.deleted_at IS NULL`, `m.membership_status = 'active'`];
  const params: unknown[] = [];
  if (opts.departmentId) {
    params.push(opts.departmentId);
    where.push(`m.department_id = $${params.length}`);
  }
  if (opts.groupId) {
    params.push(opts.groupId);
    where.push(`m.group_id = $${params.length}`);
  }
  const { rows } = await query<any>(
    `SELECT m.id, m.member_code, m.first_name, m.middle_name, m.last_name, m.gender,
            m.photo_id, d.name AS department_name
       FROM members m
       LEFT JOIN departments d ON d.id = m.department_id
      WHERE ${where.join(' AND ')}
      ORDER BY m.last_name, m.first_name`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    memberCode: r.member_code,
    fullName: [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' '),
    gender: r.gender,
    departmentName: r.department_name,
    photoUrl: photoUrl(r.photo_id),
  }));
}

/** Global search across members - used by the header search box. */
export async function searchMembers(term: string, limit = 8, scopeDepartmentId?: number | null) {
  const params: unknown[] = [`%${term.toLowerCase()}%`];
  let scope = '';
  if (scopeDepartmentId) {
    params.push(scopeDepartmentId);
    scope = ` AND m.department_id = $${params.length}`;
  }
  params.push(limit);

  const { rows } = await query<any>(
    `SELECT m.id, m.member_code, m.first_name, m.middle_name, m.last_name,
            m.phone, m.membership_status, m.photo_id, d.name AS department_name
       FROM members m
       LEFT JOIN departments d ON d.id = m.department_id
      WHERE m.deleted_at IS NULL${scope}
        AND (
          LOWER(m.first_name || ' ' || COALESCE(m.middle_name || ' ','') || m.last_name) LIKE $1
          OR LOWER(m.member_code) LIKE $1
          OR LOWER(COALESCE(m.email,'')) LIKE $1
          OR REPLACE(COALESCE(m.phone,''),' ','') LIKE REPLACE($1,' ','')
        )
      ORDER BY m.last_name
      LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    memberCode: r.member_code,
    fullName: [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' '),
    phone: r.phone,
    membershipStatus: r.membership_status,
    departmentName: r.department_name,
    photoUrl: photoUrl(r.photo_id),
  }));
}

export { photoUrl, today };
