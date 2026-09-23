/**
 * Audit log viewer. Read-only by design - there is no endpoint that edits or
 * deletes an audit entry, in this module or anywhere else.
 */
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../../config/db.js';
import { asyncHandler, readPagination, paginate } from '../../utils/http.js';
import { validateQuery } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  requirePermission('audit:read'),
  validateQuery(
    z.object({
      page: z.coerce.number().int().positive().optional(),
      pageSize: z.coerce.number().int().positive().max(200).optional(),
      action: z.string().max(60).optional(),
      entityType: z.string().max(40).optional(),
      userId: z.coerce.number().int().positive().optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      search: z.string().trim().max(120).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = readPagination(req, 30, 200);
    const q = req.query as any;

    const where: string[] = [];
    const params: unknown[] = [];

    if (q.action) {
      params.push(q.action);
      where.push(`a.action = $${params.length}`);
    }
    if (q.entityType) {
      params.push(q.entityType);
      where.push(`a.entity_type = $${params.length}`);
    }
    if (q.userId) {
      params.push(q.userId);
      where.push(`a.user_id = $${params.length}`);
    }
    if (q.from) {
      params.push(q.from);
      where.push(`a.created_at >= $${params.length}::date`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(`a.created_at < ($${params.length}::date + interval '1 day')`);
    }
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`);
      where.push(`(LOWER(a.description) LIKE $${params.length} OR LOWER(COALESCE(a.user_email,'')) LIKE $${params.length})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRow = await queryOne<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM audit_logs a ${whereSql}`,
      params,
    );

    const { rows } = await query<any>(
      `SELECT a.id, a.user_id, a.user_email, a.user_role, a.action, a.entity_type, a.entity_id,
              a.description, a.ip_address, a.user_agent, a.metadata, a.created_at,
              u.full_name AS user_name
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         ${whereSql}
        ORDER BY a.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );

    res.json(
      paginate(
        rows.map((r) => ({
          id: r.id,
          userId: r.user_id,
          userName: r.user_name ?? r.user_email ?? 'System',
          userEmail: r.user_email,
          userRole: r.user_role,
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          description: r.description,
          ipAddress: r.ip_address,
          userAgent: r.user_agent,
          metadata: r.metadata,
          createdAt: r.created_at,
        })),
        countRow?.total ?? 0,
        page,
        pageSize,
      ),
    );
  }),
);

/** Distinct actions and users, for the filter dropdowns. */
router.get(
  '/filters',
  requirePermission('audit:read'),
  asyncHandler(async (_req, res) => {
    const [actions, users] = await Promise.all([
      query<{ action: string }>(`SELECT DISTINCT action FROM audit_logs ORDER BY action`),
      query<any>(
        `SELECT DISTINCT u.id, u.full_name FROM audit_logs a
           JOIN users u ON u.id = a.user_id ORDER BY u.full_name`,
      ),
    ]);
    res.json({
      actions: actions.rows.map((r) => r.action),
      users: users.rows.map((r) => ({ id: r.id, fullName: r.full_name })),
    });
  }),
);

export default router;
