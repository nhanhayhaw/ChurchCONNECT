/**
 * Department management.
 *
 * Service and routes live in one file here because the module is small and
 * the queries are simple - splitting it would add indirection without adding
 * clarity. The larger modules (members, attendance, follow-ups) keep the
 * service/route split.
 */
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../../config/db.js';
import { asyncHandler } from '../../utils/http.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { scopeDepartmentId } from '../../middleware/scope.js';
import { recordAudit } from '../../services/audit.service.js';
import { notFound, conflict, forbidden } from '../../utils/errors.js';

const router = Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });

const departmentSchema = z.object({
  name: z.string().trim().min(2, 'Please enter a department name.').max(120),
  description: z.string().trim().max(1000).optional().nullable(),
  leaderMemberId: z.coerce.number().int().positive().optional().nullable(),
  meetingDay: z.string().trim().max(20).optional().nullable(),
  meetingTime: z.string().trim().max(20).optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

router.use(authenticate);

/** List with live member counts and a gender split per department. */
router.get(
  '/',
  requirePermission('departments:read'),
  asyncHandler(async (_req, res) => {
    const { rows } = await query<any>(
      `SELECT d.id, d.name, d.description, d.meeting_day, d.meeting_time, d.is_active,
              d.leader_member_id,
              CASE WHEN lm.id IS NULL THEN NULL
                   ELSE lm.first_name || ' ' || lm.last_name END AS leader_name,
              lm.phone AS leader_phone,
              COUNT(m.id) FILTER (WHERE m.deleted_at IS NULL AND m.membership_status = 'active')::int AS member_count,
              COUNT(m.id) FILTER (WHERE m.deleted_at IS NULL AND m.membership_status = 'active'
                                    AND m.gender = 'male')::int AS male_count,
              COUNT(m.id) FILTER (WHERE m.deleted_at IS NULL AND m.membership_status = 'active'
                                    AND m.gender = 'female')::int AS female_count
         FROM departments d
         LEFT JOIN members lm ON lm.id = d.leader_member_id
         LEFT JOIN members m  ON m.department_id = d.id
        GROUP BY d.id, lm.id
        ORDER BY d.name`,
    );

    res.json({
      departments: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        meetingDay: r.meeting_day,
        meetingTime: r.meeting_time,
        isActive: r.is_active,
        leaderMemberId: r.leader_member_id,
        leaderName: r.leader_name,
        leaderPhone: r.leader_phone,
        memberCount: r.member_count,
        maleCount: r.male_count,
        femaleCount: r.female_count,
      })),
    });
  }),
);

/** Detail view including attendance performance over the last 90 days. */
router.get(
  '/:id',
  requirePermission('departments:read'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    // The list shows every department's headline counts; the roster (names and
    // phone numbers) is only a leader's own.
    const scope = scopeDepartmentId(req);
    if (scope !== null && scope !== id) throw forbidden('You can only view the roster of your own department.');
    const department = await queryOne<any>(
      `SELECT d.*, CASE WHEN lm.id IS NULL THEN NULL ELSE lm.first_name || ' ' || lm.last_name END AS leader_name
         FROM departments d LEFT JOIN members lm ON lm.id = d.leader_member_id
        WHERE d.id = $1`,
      [id],
    );
    if (!department) throw notFound('That department could not be found.');

    const { rows: members } = await query<any>(
      `SELECT m.id, m.member_code, m.first_name || ' ' || m.last_name AS full_name,
              m.gender, m.phone, m.membership_status, m.photo_id
         FROM members m
        WHERE m.department_id = $1 AND m.deleted_at IS NULL
        ORDER BY m.last_name, m.first_name`,
      [id],
    );

    const stats = await queryOne<any>(
      `SELECT COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
              COUNT(a.id)::int AS recorded
         FROM attendance a
         JOIN attendance_services s ON s.id = a.service_id
         JOIN members m ON m.id = a.member_id
        WHERE m.department_id = $1 AND s.service_date >= CURRENT_DATE - interval '90 days'`,
      [id],
    );

    res.json({
      department: {
        id: department.id,
        name: department.name,
        description: department.description,
        meetingDay: department.meeting_day,
        meetingTime: department.meeting_time,
        isActive: department.is_active,
        leaderMemberId: department.leader_member_id,
        leaderName: department.leader_name,
      },
      members: members.map((m) => ({
        id: m.id,
        memberCode: m.member_code,
        fullName: m.full_name,
        gender: m.gender,
        phone: m.phone,
        membershipStatus: m.membership_status,
        photoUrl: m.photo_id ? `/api/members/photos/${m.photo_id}` : null,
      })),
      attendance: {
        present: stats?.present ?? 0,
        recorded: stats?.recorded ?? 0,
        rate: stats?.recorded > 0 ? Math.round((stats.present / stats.recorded) * 100) : 0,
      },
    });
  }),
);

router.post(
  '/',
  requirePermission('departments:manage'),
  validateBody(departmentSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof departmentSchema>;
    const { rows } = await query<{ id: number }>(
      `INSERT INTO departments (name, description, leader_member_id, meeting_day, meeting_time, is_active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [b.name, b.description ?? null, b.leaderMemberId ?? null, b.meetingDay ?? null, b.meetingTime ?? null, b.isActive],
    );
    await recordAudit(req, {
      action: 'department.create',
      description: `Created the ${b.name} department.`,
      entityType: 'department',
      entityId: rows[0]!.id,
    });
    res.status(201).json({ id: rows[0]!.id, message: `${b.name} department created.` });
  }),
);

router.put(
  '/:id',
  requirePermission('departments:manage'),
  validateParams(idParam),
  validateBody(departmentSchema.partial()),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const map: Record<string, string> = {
      name: 'name',
      description: 'description',
      leaderMemberId: 'leader_member_id',
      meetingDay: 'meeting_day',
      meetingTime: 'meeting_time',
      isActive: 'is_active',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [field, column] of Object.entries(map)) {
      const value = (req.body as any)[field];
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    if (sets.length === 0) {
      res.json({ ok: true, message: 'Nothing to update.' });
      return;
    }
    params.push(id);
    const { rowCount } = await query(`UPDATE departments SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    if (rowCount === 0) throw notFound('That department could not be found.');

    await recordAudit(req, {
      action: 'department.update',
      description: `Updated department #${id}.`,
      entityType: 'department',
      entityId: id,
      metadata: { fields: Object.keys(req.body) },
    });
    res.json({ ok: true, message: 'Department updated.' });
  }),
);

/**
 * Deleting a department must not silently orphan its members, so the endpoint
 * refuses while anyone is still assigned and tells the caller how many.
 */
router.delete(
  '/:id',
  requirePermission('departments:manage'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const department = await queryOne<{ name: string }>(`SELECT name FROM departments WHERE id = $1`, [id]);
    if (!department) throw notFound('That department could not be found.');

    const count = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM members WHERE department_id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if ((count?.n ?? 0) > 0) {
      throw conflict(
        `${department.name} still has ${count!.n} member(s) assigned. ` +
          'Reassign them to another department first, or deactivate this one instead of deleting it.',
      );
    }

    await query(`DELETE FROM departments WHERE id = $1`, [id]);
    await recordAudit(req, {
      action: 'department.delete',
      description: `Deleted the ${department.name} department.`,
      entityType: 'department',
      entityId: id,
    });
    res.json({ ok: true, message: `${department.name} department deleted.` });
  }),
);

/** Bulk-assign members to a department from the department detail screen. */
router.post(
  '/:id/members',
  requirePermission('departments:manage'),
  validateParams(idParam),
  validateBody(z.object({ memberIds: z.array(z.coerce.number().int().positive()).min(1).max(2000) })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { rowCount } = await query(
      `UPDATE members SET department_id = $1 WHERE id = ANY($2) AND deleted_at IS NULL`,
      [id, req.body.memberIds],
    );
    await recordAudit(req, {
      action: 'department.update',
      description: `Assigned ${rowCount} member(s) to department #${id}.`,
      entityType: 'department',
      entityId: id,
    });
    res.json({ ok: true, assigned: rowCount, message: `${rowCount} member(s) assigned.` });
  }),
);

export default router;
