/**
 * Follow-up routes, including the absence alert feed.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, readPagination } from '../../utils/http.js';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate.js';
import { authenticate, requireAuth } from '../../middleware/auth.js';
import { requirePermission, departmentScope } from '../../middleware/rbac.js';
import { assertMemberInScope, assertFollowUpInScope } from '../../middleware/scope.js';
import { recordAudit } from '../../services/audit.service.js';
import { getAbsenceAlerts, runAbsenceScan, absenceSummary } from '../../services/absence.service.js';
import * as service from './followups.service.js';

const router = Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Please choose a valid date.');
const statusEnum = z.enum([
  'pending', 'contacted', 'responded', 'needs_further_follow_up', 'resolved', 'unable_to_reach',
]);

router.use(authenticate);

router.get('/meta', requirePermission('followups:read'), (_req, res) => {
  res.json({ statuses: service.FOLLOW_UP_STATUSES, levels: service.LEVEL_LABELS });
});

router.get(
  '/officers',
  requirePermission('followups:read'),
  asyncHandler(async (_req, res) => {
    res.json({ officers: await service.assignableOfficers() });
  }),
);

// --- absence alerts ---------------------------------------------------------

/**
 * The live alert feed. Computed on read rather than stored, so it always
 * reflects the attendance data as it stands right now.
 */
router.get(
  '/alerts',
  requirePermission('followups:read'),
  asyncHandler(async (req, res) => {
    const scope = departmentScope(req, 'm.department_id');
    res.json({ alerts: await getAbsenceAlerts(scope ? scope.value : null) });
  }),
);

/** Manual "Run now" for the nightly absence scan. */
router.post(
  '/alerts/scan',
  requirePermission('followups:manage'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const result = await runAbsenceScan({ triggeredBy: auth.userId });
    await recordAudit(req, {
      action: 'job.absence_scan',
      description: `Ran the absence scan manually: ${result.candidates.length} member(s) flagged.`,
      metadata: { alertsCreated: result.alertsCreated, followUpsCreated: result.followUpsCreated },
    });
    res.json({
      ...result,
      message:
        `Scan complete. ${result.candidates.length} member(s) over threshold, ` +
        `${result.followUpsCreated} new follow-up(s) opened.`,
    });
  }),
);

router.get(
  '/summary',
  requirePermission('followups:read'),
  asyncHandler(async (_req, res) => {
    const [absence, followUps] = await Promise.all([absenceSummary(), service.followUpSummary()]);
    res.json({ absence, followUps });
  }),
);

// --- cases ------------------------------------------------------------------

router.get(
  '/',
  requirePermission('followups:read'),
  validateQuery(
    z.object({
      page: z.coerce.number().int().positive().optional(),
      pageSize: z.coerce.number().int().positive().max(100).optional(),
      status: statusEnum.optional(),
      level: z.coerce.number().int().min(1).max(3).optional(),
      assignedTo: z.coerce.number().int().positive().optional(),
      scope: z.enum(['open', 'overdue', 'all']).optional(),
      search: z.string().trim().max(120).optional(),
      sortBy: z.enum(['level', 'status', 'member', 'created', 'nextDate', 'weeks']).optional(),
      sortDir: z.enum(['asc', 'desc']).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = readPagination(req, 20, 100);
    const scope = departmentScope(req, 'm.department_id');
    res.json(
      await service.listFollowUps(req.query as any, {
        page,
        pageSize,
        offset,
        scopeDepartmentId: scope ? scope.value : null,
      }),
    );
  }),
);

router.get(
  '/:id',
  requirePermission('followups:read'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await assertFollowUpInScope(req, id);
    res.json(await service.getFollowUp(id));
  }),
);

router.post(
  '/',
  requirePermission('followups:manage'),
  validateBody(
    z.object({
      memberId: z.coerce.number().int().positive(),
      level: z.coerce.number().int().min(1).max(3).optional(),
      assignedTo: z.coerce.number().int().positive().optional().nullable(),
      nextFollowUpDate: isoDate.optional().nullable(),
      note: z.string().trim().max(2000).optional().nullable(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    await assertMemberInScope(req, Number(req.body.memberId));
    const id = await service.createFollowUp(req.body, auth.userId);
    const detail = await service.getFollowUp(id);
    await recordAudit(req, {
      action: 'followup.create',
      description: `Started a ${detail.followUp.levelLabel} for ${detail.followUp.memberName}.`,
      entityType: 'follow_up',
      entityId: id,
      metadata: { memberId: req.body.memberId },
    });
    res.status(201).json({ ...detail, message: `Follow-up started for ${detail.followUp.memberName}.` });
  }),
);

router.patch(
  '/:id',
  requirePermission('followups:manage'),
  validateParams(idParam),
  validateBody(
    z.object({
      status: statusEnum.optional(),
      assignedTo: z.coerce.number().int().positive().optional().nullable(),
      nextFollowUpDate: isoDate.optional().nullable(),
      level: z.coerce.number().int().min(1).max(3).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const id = Number(req.params.id);
    await assertFollowUpInScope(req, id);
    await service.updateFollowUp(id, req.body, auth.userId);
    const detail = await service.getFollowUp(id);
    await recordAudit(req, {
      action: req.body.status && ['resolved', 'unable_to_reach'].includes(req.body.status)
        ? 'followup.resolve'
        : 'followup.update',
      description: `Updated the follow-up for ${detail.followUp.memberName} (now ${detail.followUp.statusLabel}).`,
      entityType: 'follow_up',
      entityId: id,
      metadata: req.body,
    });
    res.json({ ...detail, message: 'Follow-up updated.' });
  }),
);

router.post(
  '/:id/notes',
  requirePermission('followups:manage'),
  validateParams(idParam),
  validateBody(
    z.object({
      note: z.string().trim().min(3, 'Please write a short note about the contact.').max(2000),
      contactMethod: z.enum(['phone', 'sms', 'whatsapp', 'visit', 'email', 'in_person', 'other']).optional().nullable(),
      newStatus: statusEnum.optional().nullable(),
      nextFollowUpDate: isoDate.optional().nullable(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const id = Number(req.params.id);
    await assertFollowUpInScope(req, id);
    await service.addNote(id, req.body, auth.userId);
    const detail = await service.getFollowUp(id);
    await recordAudit(req, {
      action: 'followup.note',
      description: `Added a follow-up note for ${detail.followUp.memberName}.`,
      entityType: 'follow_up',
      entityId: id,
    });
    res.status(201).json({ ...detail, message: 'Note saved.' });
  }),
);

export default router;
