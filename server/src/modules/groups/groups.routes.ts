/**
 * Cell / prayer / Bible-study group management.
 *
 * Structurally a sibling of departments: a member belongs to at most one
 * department (what they *do*) and at most one group (where they *belong*).
 */
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../../config/db.js';
import { asyncHandler } from '../../utils/http.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { recordAudit } from '../../services/audit.service.js';
import { notFound, conflict } from '../../utils/errors.js';

const router = Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });

export const GROUP_TYPES = [
  { value: 'cell', label: 'Cell Group' },
  { value: 'prayer', label: 'Prayer Group' },
  { value: 'bible_study', label: 'Bible Study Group' },
  { value: 'zone', label: 'Zone' },
  { value: 'fellowship', label: 'Fellowship' },
] as const;

const groupSchema = z.object({
  name: z.string().trim().min(2, 'Please enter a group name.').max(120),
  groupType: z.enum(['cell', 'prayer', 'bible_study', 'zone', 'fellowship']).default('cell'),
  description: z.string().trim().max(1000).optional().nullable(),
  leaderMemberId: z.coerce.number().int().positive().optional().nullable(),
  meetingDay: z.string().trim().max(20).optional().nullable(),
  meetingTime: z.string().trim().max(20).optional().nullable(),
  meetingLocation: z.string().trim().max(200).optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

router.use(authenticate);

router.get('/types', requirePermission('groups:read'), (_req, res) => {
  res.json({ types: GROUP_TYPES });
});

router.get(
  '/',
  requirePermission('groups:read'),
  asyncHandler(async (_req, res) => {
    const { rows } = await query<any>(
      `SELECT g.id, g.name, g.group_type, g.description, g.meeting_day, g.meeting_time,
              g.meeting_location, g.is_active, g.leader_member_id,
              CASE WHEN lm.id IS NULL THEN NULL ELSE lm.first_name || ' ' || lm.last_name END AS leader_name,
              lm.phone AS leader_phone,
              COUNT(m.id) FILTER (WHERE m.deleted_at IS NULL AND m.membership_status = 'active')::int AS member_count
         FROM groups g
         LEFT JOIN members lm ON lm.id = g.leader_member_id
         LEFT JOIN members m  ON m.group_id = g.id
        GROUP BY g.id, lm.id
        ORDER BY g.name`,
    );

    res.json({
      groups: rows.map((r) => ({
        id: r.id,
        name: r.name,
        groupType: r.group_type,
        groupTypeLabel: GROUP_TYPES.find((t) => t.value === r.group_type)?.label ?? r.group_type,
        description: r.description,
        meetingDay: r.meeting_day,
        meetingTime: r.meeting_time,
        meetingLocation: r.meeting_location,
        isActive: r.is_active,
        leaderMemberId: r.leader_member_id,
        leaderName: r.leader_name,
        leaderPhone: r.leader_phone,
        memberCount: r.member_count,
      })),
    });
  }),
);

router.get(
  '/:id',
  requirePermission('groups:read'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const group = await queryOne<any>(
      `SELECT g.*, CASE WHEN lm.id IS NULL THEN NULL ELSE lm.first_name || ' ' || lm.last_name END AS leader_name
         FROM groups g LEFT JOIN members lm ON lm.id = g.leader_member_id WHERE g.id = $1`,
      [id],
    );
    if (!group) throw notFound('That group could not be found.');

    const { rows: members } = await query<any>(
      `SELECT m.id, m.member_code, m.first_name || ' ' || m.last_name AS full_name,
              m.gender, m.phone, m.membership_status, m.photo_id, d.name AS department_name
         FROM members m
         LEFT JOIN departments d ON d.id = m.department_id
        WHERE m.group_id = $1 AND m.deleted_at IS NULL
        ORDER BY m.last_name, m.first_name`,
      [id],
    );

    res.json({
      group: {
        id: group.id,
        name: group.name,
        groupType: group.group_type,
        groupTypeLabel: GROUP_TYPES.find((t) => t.value === group.group_type)?.label ?? group.group_type,
        description: group.description,
        meetingDay: group.meeting_day,
        meetingTime: group.meeting_time,
        meetingLocation: group.meeting_location,
        isActive: group.is_active,
        leaderMemberId: group.leader_member_id,
        leaderName: group.leader_name,
      },
      members: members.map((m) => ({
        id: m.id,
        memberCode: m.member_code,
        fullName: m.full_name,
        gender: m.gender,
        phone: m.phone,
        membershipStatus: m.membership_status,
        departmentName: m.department_name,
        photoUrl: m.photo_id ? `/api/members/photos/${m.photo_id}` : null,
      })),
    });
  }),
);

router.post(
  '/',
  requirePermission('groups:manage'),
  validateBody(groupSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof groupSchema>;
    const { rows } = await query<{ id: number }>(
      `INSERT INTO groups (name, group_type, description, leader_member_id, meeting_day, meeting_time,
                           meeting_location, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        b.name, b.groupType, b.description ?? null, b.leaderMemberId ?? null,
        b.meetingDay ?? null, b.meetingTime ?? null, b.meetingLocation ?? null, b.isActive,
      ],
    );
    await recordAudit(req, {
      action: 'group.create',
      description: `Created the ${b.name} group.`,
      entityType: 'group',
      entityId: rows[0]!.id,
    });
    res.status(201).json({ id: rows[0]!.id, message: `${b.name} created.` });
  }),
);

router.put(
  '/:id',
  requirePermission('groups:manage'),
  validateParams(idParam),
  validateBody(groupSchema.partial()),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const map: Record<string, string> = {
      name: 'name',
      groupType: 'group_type',
      description: 'description',
      leaderMemberId: 'leader_member_id',
      meetingDay: 'meeting_day',
      meetingTime: 'meeting_time',
      meetingLocation: 'meeting_location',
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
    const { rowCount } = await query(`UPDATE groups SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    if (rowCount === 0) throw notFound('That group could not be found.');

    await recordAudit(req, {
      action: 'group.update',
      description: `Updated group #${id}.`,
      entityType: 'group',
      entityId: id,
    });
    res.json({ ok: true, message: 'Group updated.' });
  }),
);

router.delete(
  '/:id',
  requirePermission('groups:manage'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const group = await queryOne<{ name: string }>(`SELECT name FROM groups WHERE id = $1`, [id]);
    if (!group) throw notFound('That group could not be found.');

    const count = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM members WHERE group_id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if ((count?.n ?? 0) > 0) {
      throw conflict(
        `${group.name} still has ${count!.n} member(s). Move them to another group first, ` +
          'or deactivate this group instead of deleting it.',
      );
    }

    await query(`DELETE FROM groups WHERE id = $1`, [id]);
    await recordAudit(req, {
      action: 'group.delete',
      description: `Deleted the ${group.name} group.`,
      entityType: 'group',
      entityId: id,
    });
    res.json({ ok: true, message: `${group.name} deleted.` });
  }),
);

router.post(
  '/:id/members',
  requirePermission('groups:manage'),
  validateParams(idParam),
  validateBody(z.object({ memberIds: z.array(z.coerce.number().int().positive()).min(1).max(2000) })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { rowCount } = await query(`UPDATE members SET group_id = $1 WHERE id = ANY($2) AND deleted_at IS NULL`, [
      id,
      req.body.memberIds,
    ]);
    await recordAudit(req, {
      action: 'group.update',
      description: `Assigned ${rowCount} member(s) to group #${id}.`,
      entityType: 'group',
      entityId: id,
    });
    res.json({ ok: true, assigned: rowCount, message: `${rowCount} member(s) assigned.` });
  }),
);

export default router;
