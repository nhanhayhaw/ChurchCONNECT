/**
 * Notification centre.
 *
 * A notification is addressed either to one user or to a whole role. Read
 * state is per user (notification_reads), so a pastor marking a role-wide
 * alert as read does not hide it from the administrator.
 */
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../../config/db.js';
import { asyncHandler } from '../../utils/http.js';
import { validateQuery, validateParams } from '../../middleware/validate.js';
import { authenticate, requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';

const router = Router();
router.use(authenticate);

/** Notifications visible to this user: theirs personally, plus their role's. */
const VISIBLE_SQL = `
  FROM notifications n
  LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = $1
  WHERE (n.user_id = $1 OR n.role_id = $2)
`;

router.get(
  '/',
  requirePermission('notifications:read'),
  validateQuery(
    z.object({
      unreadOnly: z.enum(['true', 'false']).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      type: z.string().max(40).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const q = req.query as any;
    const params: unknown[] = [auth.userId, auth.roleId];
    const extra: string[] = [];

    if (q.unreadOnly === 'true') extra.push('nr.notification_id IS NULL');
    if (q.type) {
      params.push(q.type);
      extra.push(`n.type = $${params.length}`);
    }
    params.push(q.limit ?? 30);

    const { rows } = await query<any>(
      `SELECT n.id, n.type, n.severity, n.title, n.body, n.link, n.entity_type, n.entity_id,
              n.created_at, (nr.notification_id IS NOT NULL) AS is_read
       ${VISIBLE_SQL} ${extra.length ? `AND ${extra.join(' AND ')}` : ''}
       ORDER BY n.created_at DESC
       LIMIT $${params.length}`,
      params,
    );

    const unread = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n ${VISIBLE_SQL} AND nr.notification_id IS NULL`,
      [auth.userId, auth.roleId],
    );

    res.json({
      notifications: rows.map((r) => ({
        id: r.id,
        type: r.type,
        severity: r.severity,
        title: r.title,
        body: r.body,
        link: r.link,
        entityType: r.entity_type,
        entityId: r.entity_id,
        isRead: r.is_read,
        createdAt: r.created_at,
      })),
      unreadCount: unread?.n ?? 0,
    });
  }),
);

router.get(
  '/unread-count',
  requirePermission('notifications:read'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const row = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n ${VISIBLE_SQL} AND nr.notification_id IS NULL`,
      [auth.userId, auth.roleId],
    );
    res.json({ unreadCount: row?.n ?? 0 });
  }),
);

router.post(
  '/:id/read',
  requirePermission('notifications:read'),
  validateParams(z.object({ id: z.coerce.number().int().positive() })),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    await query(
      `INSERT INTO notification_reads (notification_id, user_id) VALUES ($1, $2)
       ON CONFLICT (notification_id, user_id) DO NOTHING`,
      [Number(req.params.id), auth.userId],
    );
    res.json({ ok: true });
  }),
);

router.post(
  '/read-all',
  requirePermission('notifications:read'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { rowCount } = await query(
      `INSERT INTO notification_reads (notification_id, user_id)
       SELECT n.id, $1 FROM notifications n
        WHERE (n.user_id = $1 OR n.role_id = $2)
       ON CONFLICT (notification_id, user_id) DO NOTHING`,
      [auth.userId, auth.roleId],
    );
    res.json({ ok: true, marked: rowCount, message: 'All notifications marked as read.' });
  }),
);

export default router;
