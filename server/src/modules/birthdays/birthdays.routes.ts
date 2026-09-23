/**
 * Birthday routes.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/http.js';
import { validateQuery, validateParams } from '../../middleware/validate.js';
import { authenticate, requireAuth } from '../../middleware/auth.js';
import { requirePermission, departmentScope } from '../../middleware/rbac.js';
import { recordAudit } from '../../services/audit.service.js';
import * as service from './birthdays.service.js';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  requirePermission('birthdays:read'),
  validateQuery(
    z.object({
      range: z.enum(['today', 'week', 'month', 'upcoming']).optional(),
      windowDays: z.coerce.number().int().min(1).max(366).optional(),
      month: z.coerce.number().int().min(1).max(12).optional(),
      departmentId: z.coerce.number().int().positive().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const q = req.query as any;
    const scope = departmentScope(req, 'm.department_id');
    const birthdays = await service.listBirthdays(q.range ?? 'upcoming', {
      windowDays: q.windowDays,
      month: q.month,
      departmentId: scope ? scope.value : q.departmentId,
    });
    res.json({ birthdays, count: birthdays.length });
  }),
);

router.get(
  '/summary',
  requirePermission('birthdays:read'),
  asyncHandler(async (_req, res) => {
    res.json(await service.birthdaySummary());
  }),
);

router.get(
  '/reminders',
  requirePermission('birthdays:read'),
  asyncHandler(async (_req, res) => {
    res.json({ reminders: await service.dueReminders() });
  }),
);

router.post(
  '/reminders/:id/dismiss',
  requirePermission('birthdays:read'),
  validateParams(z.object({ id: z.coerce.number().int().positive() })),
  asyncHandler(async (req, res) => {
    await service.dismissReminder(Number(req.params.id));
    res.json({ ok: true, message: 'Reminder dismissed.' });
  }),
);

/** Manual trigger for the daily birthday reminder job. */
router.post(
  '/reminders/generate',
  requirePermission('settings:manage'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const result = await service.generateBirthdayReminders();
    await recordAudit(req, {
      action: 'job.birthday_scan',
      description: `${auth.fullName} ran the birthday reminder job manually.`,
      metadata: result,
    });
    res.json({ ...result, message: `${result.created} reminder(s) generated.` });
  }),
);

export default router;
