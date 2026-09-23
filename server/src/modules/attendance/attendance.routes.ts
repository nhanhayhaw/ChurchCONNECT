/**
 * Attendance routes.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, readPagination } from '../../utils/http.js';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate.js';
import { authenticate, requireAuth } from '../../middleware/auth.js';
import { requirePermission, departmentScope } from '../../middleware/rbac.js';
import { scopeDepartmentId, assertMemberInScope, assertMembersInScope, assertServiceScopeAllowed } from '../../middleware/scope.js';
import { forbidden } from '../../utils/errors.js';
import { recordAudit } from '../../services/audit.service.js';
import { runAbsenceScan } from '../../services/absence.service.js';
import { startOfMonth, today } from '../../utils/dates.js';
import * as service from './attendance.service.js';

const router = Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Please choose a valid date.');
const serviceTypeEnum = z.enum([
  'sunday_service', 'midweek_service', 'bible_study', 'prayer_meeting',
  'youth_service', 'womens_ministry', 'mens_ministry', 'special_programme',
]);

router.use(authenticate);

router.get('/service-types', (_req, res) => {
  res.json({ serviceTypes: service.SERVICE_TYPES });
});

// --- services ---------------------------------------------------------------

router.get(
  '/services',
  requirePermission('attendance:read'),
  validateQuery(
    z.object({
      page: z.coerce.number().int().positive().optional(),
      pageSize: z.coerce.number().int().positive().max(100).optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
      serviceType: serviceTypeEnum.optional(),
      departmentId: z.coerce.number().int().positive().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = readPagination(req, 20, 100);
    const scope = departmentScope(req, 's.department_id');
    const q = req.query as any;
    res.json(
      await service.listServices(
        {
          from: q.from,
          to: q.to,
          serviceType: q.serviceType,
          departmentId: scope ? scope.value : q.departmentId,
        },
        { page, pageSize, offset },
      ),
    );
  }),
);

router.post(
  '/services',
  requirePermission('attendance:record'),
  validateBody(
    z.object({
      serviceDate: isoDate,
      serviceType: serviceTypeEnum,
      title: z.string().trim().max(160).optional().nullable(),
      departmentId: z.coerce.number().int().positive().optional().nullable(),
      groupId: z.coerce.number().int().positive().optional().nullable(),
      notes: z.string().trim().max(1000).optional().nullable(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    // A leader opens registers for their own department's meetings only -
    // never a congregation-wide service, whose finalisation drives the
    // absence engine for the whole church.
    assertServiceScopeAllowed(req, req.body.departmentId ?? null);
    const id = await service.findOrCreateService(req.body, auth.userId);
    const created = await service.getService(id);
    await recordAudit(req, {
      action: 'attendance.service_create',
      description: `Opened register for ${created.serviceTypeLabel} on ${created.serviceDate}.`,
      entityType: 'service',
      entityId: id,
    });
    res.status(201).json({ service: created });
  }),
);

router.get(
  '/services/:id',
  requirePermission('attendance:read'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    res.json({ service: await service.getService(Number(req.params.id)) });
  }),
);

router.delete(
  '/services/:id',
  requirePermission('attendance:delete'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const target = await service.getService(id);
    await service.deleteService(id);
    await recordAudit(req, {
      action: 'attendance.delete',
      description: `Deleted the ${target.serviceTypeLabel} register for ${target.serviceDate} (${target.totalRecorded} marks).`,
      entityType: 'service',
      entityId: id,
    });
    res.json({ ok: true, message: 'Service and its attendance register were deleted.' });
  }),
);

// --- register ---------------------------------------------------------------

router.get(
  '/services/:id/register',
  requirePermission('attendance:read'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    res.json(await service.getRegister(Number(req.params.id), { scopeDepartmentId: scopeDepartmentId(req) }));
  }),
);

router.post(
  '/services/:id/register',
  requirePermission('attendance:record'),
  validateParams(idParam),
  validateBody(
    z.object({
      marks: z
        .array(
          z.object({
            memberId: z.coerce.number().int().positive(),
            status: z.enum(['present', 'absent', 'excused']),
            note: z.string().trim().max(300).optional().nullable(),
          }),
        )
        .min(1, 'Mark at least one member before saving.')
        .max(5000),
      finalize: z.boolean().optional().default(false),
    }),
  ),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const id = Number(req.params.id);
    const { marks, finalize } = req.body as { marks: service.AttendanceMark[]; finalize: boolean };

    // Department Leaders: only their own meetings, or their own people on a
    // congregation-wide register - and never the finalisation of the latter,
    // which triggers the church-wide absence scan.
    const scope = scopeDepartmentId(req);
    if (scope !== null) {
      const target = await service.getService(id);
      if (target.departmentId !== null) assertServiceScopeAllowed(req, target.departmentId);
      else if (finalize) throw forbidden('Only a church administrator can finalise a congregation-wide register.');
      await assertMembersInScope(req, marks.map((m) => m.memberId));
    }

    const result = await service.saveRegister(id, marks, auth.userId);
    if (finalize) await service.finalizeService(id, true);

    const saved = await service.getService(id);
    await recordAudit(req, {
      action: finalize ? 'attendance.finalize' : 'attendance.record',
      description:
        `${finalize ? 'Finalised' : 'Saved'} attendance for ${saved.serviceTypeLabel} on ${saved.serviceDate}: ` +
        `${saved.present} present, ${saved.absent} absent, ${saved.excused} excused.`,
      entityType: 'service',
      entityId: id,
      metadata: { marks: result.saved, finalized: finalize },
    });

    // Finalising a register is the moment absence streaks can change, so the
    // scan runs immediately rather than waiting for the nightly job.
    let alerts = 0;
    if (finalize) {
      const scan = await runAbsenceScan({ triggeredBy: auth.userId });
      alerts = scan.alertsCreated;
    }

    res.json({
      service: saved,
      saved: result.saved,
      alertsCreated: alerts,
      message: finalize
        ? `Register finalised. ${saved.present} present out of ${saved.totalRecorded} recorded.`
        : `Saved ${result.saved} attendance mark(s).`,
    });
  }),
);

router.post(
  '/services/:id/reopen',
  requirePermission('attendance:record'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (scopeDepartmentId(req) !== null) {
      const target = await service.getService(id);
      if (target.departmentId === null) throw forbidden('Only a church administrator can reopen a congregation-wide register.');
      assertServiceScopeAllowed(req, target.departmentId);
    }
    await service.finalizeService(id, false);
    res.json({ ok: true, message: 'Register reopened for editing.' });
  }),
);

router.delete(
  '/services/:id/register/:memberId',
  requirePermission('attendance:record'),
  validateParams(z.object({ id: z.coerce.number().int().positive(), memberId: z.coerce.number().int().positive() })),
  asyncHandler(async (req, res) => {
    const memberId = Number(req.params.memberId);
    await assertMemberInScope(req, memberId);
    await service.clearMark(Number(req.params.id), memberId);
    res.json({ ok: true, message: 'Mark cleared.' });
  }),
);

// --- statistics -------------------------------------------------------------

router.get(
  '/stats/snapshot',
  requirePermission('attendance:read'),
  asyncHandler(async (_req, res) => {
    res.json(await service.attendanceSnapshot());
  }),
);

router.get(
  '/stats/trend',
  requirePermission('attendance:read'),
  validateQuery(z.object({ weeks: z.coerce.number().int().min(4).max(52).optional() })),
  asyncHandler(async (req, res) => {
    res.json({ trend: await service.attendanceTrend(Number((req.query as any).weeks ?? 12)) });
  }),
);

router.get(
  '/stats/by-department',
  requirePermission('attendance:read'),
  validateQuery(z.object({ from: isoDate.optional(), to: isoDate.optional() })),
  asyncHandler(async (req, res) => {
    const q = req.query as any;
    res.json({ departments: await service.attendanceByDepartment(q.from ?? startOfMonth(), q.to ?? today()) });
  }),
);

router.get(
  '/stats/low-attendance',
  requirePermission('attendance:read'),
  validateQuery(z.object({ threshold: z.coerce.number().min(1).max(99).optional(), from: isoDate.optional() })),
  asyncHandler(async (req, res) => {
    const q = req.query as any;
    res.json({ members: await service.lowAttendanceMembers(q.threshold ?? 50, q.from) });
  }),
);

export default router;
