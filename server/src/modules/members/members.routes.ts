/**
 * Member routes.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, readPagination } from '../../utils/http.js';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate.js';
import { authenticate, requireAuth } from '../../middleware/auth.js';
import { requirePermission, departmentScope } from '../../middleware/rbac.js';
import { assertMemberInScope } from '../../middleware/scope.js';
import { recordAudit } from '../../services/audit.service.js';
import { photoUpload, storeMemberPhoto, deleteStoredPhoto, readStoredPhoto } from '../../services/storage.service.js';
import { notFound, forbidden } from '../../utils/errors.js';
import { memberCreateSchema, memberUpdateSchema, memberListQuerySchema } from './members.schema.js';
import * as service from './members.service.js';
import { membersToWorkbook, membersToPdf } from '../reports/export.service.js';

const router = Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });

router.use(authenticate);

/**
 * Department Leaders only ever see their own department. Returning the scope
 * as a value (rather than mutating the query) keeps the restriction explicit
 * at each call site.
 */
function scopeFor(req: any): number | null {
  const scope = departmentScope(req, 'm.department_id');
  return scope ? scope.value : null;
}

// --- list ------------------------------------------------------------------

router.get(
  '/',
  requirePermission('members:read'),
  validateQuery(memberListQuerySchema),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = readPagination(req, 20, 200);
    const result = await service.listMembers(req.query as any, {
      page,
      pageSize,
      offset,
      scopeDepartmentId: scopeFor(req),
    });
    res.json(result);
  }),
);

// --- register options (departments + groups for the form) -------------------

router.get(
  '/form-options',
  requirePermission('members:read'),
  asyncHandler(async (_req, res) => {
    const { query } = await import('../../config/db.js');
    const [departments, groups] = await Promise.all([
      query(`SELECT id, name FROM departments WHERE is_active ORDER BY name`),
      query(`SELECT id, name, group_type FROM groups WHERE is_active ORDER BY name`),
    ]);
    res.json({
      departments: departments.rows,
      groups: groups.rows.map((g: any) => ({ id: g.id, name: g.name, type: g.group_type })),
    });
  }),
);

// --- photo streaming --------------------------------------------------------

/**
 * Photos are streamed through the API rather than served statically so that
 * (a) they require a valid session and (b) the Content-Type is pinned to a
 * known-good value regardless of what is on disk.
 */
router.get(
  '/photos/:id',
  validateParams(idParam),
  requirePermission('members:read'),
  asyncHandler(async (req, res) => {
    const record = await service.getPhotoRecord(Number(req.params.id));
    if (!record) throw notFound('Photo not found.');

    // Null when the file is gone - e.g. a row written while photos still lived
    // on a disk that has since been wiped. The client falls back to initials.
    const bytes = await readStoredPhoto(record.storage_path);
    if (!bytes) throw notFound('Photo not found.');

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(bytes);
  }),
);

// --- exports (before /:id so "export" is not read as an id) ------------------

router.get(
  '/export/excel',
  requirePermission('members:export'),
  validateQuery(memberListQuerySchema),
  asyncHandler(async (req, res) => {
    const rows = await service.exportMembers(req.query as any, scopeFor(req));
    await recordAudit(req, {
      action: 'member.export',
      description: `Exported ${rows.length} member record(s) to Excel.`,
      entityType: 'member',
    });
    const workbook = await membersToWorkbook(rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="members-${service.today()}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  }),
);

router.get(
  '/export/pdf',
  requirePermission('members:export'),
  validateQuery(memberListQuerySchema),
  asyncHandler(async (req, res) => {
    const rows = await service.exportMembers(req.query as any, scopeFor(req));
    await recordAudit(req, {
      action: 'member.export',
      description: `Exported ${rows.length} member record(s) to PDF.`,
      entityType: 'member',
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="members-${service.today()}.pdf"`);
    await membersToPdf(rows, res);
  }),
);

// --- single member ----------------------------------------------------------

router.get(
  '/:id',
  requirePermission('members:read'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const member = await service.getMember(Number(req.params.id));
    const scope = scopeFor(req);
    if (scope && member.departmentId !== scope) {
      throw forbidden('You can only view members of your own department.');
    }
    res.json({ member });
  }),
);

// The three profile tabs carry the same scope check as the profile itself: a
// Department Leader must not be able to read another department's attendance
// history, cases or notes by typing a member id into the URL.
router.get(
  '/:id/attendance',
  requirePermission('attendance:read'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await assertMemberInScope(req, id);
    res.json(await service.getMemberAttendance(id));
  }),
);

router.get(
  '/:id/follow-ups',
  requirePermission('followups:read'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await assertMemberInScope(req, id);
    res.json({ followUps: await service.getMemberFollowUps(id) });
  }),
);

router.get(
  '/:id/timeline',
  requirePermission('members:read'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await assertMemberInScope(req, id);
    res.json({ timeline: await service.getMemberTimeline(id) });
  }),
);

// --- create / update / delete ----------------------------------------------

router.post(
  '/',
  requirePermission('members:create'),
  validateBody(memberCreateSchema),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const id = await service.createMember(req.body, auth.userId);
    const member = await service.getMember(id);
    await recordAudit(req, {
      action: 'member.create',
      description: `Registered new member ${member.fullName} (${member.memberCode}).`,
      entityType: 'member',
      entityId: id,
    });
    res.status(201).json({ member, message: `${member.firstName} has been registered successfully.` });
  }),
);

router.put(
  '/:id',
  requirePermission('members:update'),
  validateParams(idParam),
  validateBody(memberUpdateSchema),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const id = Number(req.params.id);
    await service.updateMember(id, req.body, auth.userId);
    const member = await service.getMember(id);
    await recordAudit(req, {
      action: 'member.update',
      description: `Updated member profile for ${member.fullName} (${member.memberCode}).`,
      entityType: 'member',
      entityId: id,
      metadata: { fields: Object.keys(req.body) },
    });
    res.json({ member, message: 'Member details saved.' });
  }),
);

router.delete(
  '/:id',
  requirePermission('members:delete'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const id = Number(req.params.id);
    const member = await service.getMember(id);
    await service.deleteMember(id, auth.userId);
    await recordAudit(req, {
      action: 'member.delete',
      description: `Removed member ${member.fullName} (${member.memberCode}) from active records.`,
      entityType: 'member',
      entityId: id,
    });
    res.json({ ok: true, message: `${member.fullName} has been removed from active records.` });
  }),
);

router.post(
  '/:id/restore',
  requirePermission('members:delete'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await service.restoreMember(id);
    await recordAudit(req, {
      action: 'member.restore',
      description: `Restored member record #${id}.`,
      entityType: 'member',
      entityId: id,
    });
    res.json({ ok: true, message: 'Member record restored.' });
  }),
);

// --- photo upload / delete --------------------------------------------------

router.post(
  '/:id/photo',
  requirePermission('members:update'),
  validateParams(idParam),
  photoUpload.single('photo'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const id = Number(req.params.id);
    if (!req.file) throw notFound('No image was received. Please choose a JPG or PNG file.');

    // Confirms the member exists (and is not soft-deleted) before writing.
    const member = await service.getMember(id);

    const stored = await storeMemberPhoto(req.file.buffer, req.file.mimetype);
    const { photoId, replaced } = await service.attachPhoto(id, stored, auth.userId);
    if (replaced) await deleteStoredPhoto(replaced.storagePath);

    await recordAudit(req, {
      action: 'member.photo_upload',
      description: `Uploaded a profile photograph for ${member.fullName}.`,
      entityType: 'member',
      entityId: id,
    });

    res.status(201).json({ photoUrl: `/api/members/photos/${photoId}`, message: 'Photograph updated.' });
  }),
);

router.delete(
  '/:id/photo',
  requirePermission('members:update'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const id = Number(req.params.id);
    const path = await service.removePhoto(id, auth.userId);
    if (path) await deleteStoredPhoto(path);
    await recordAudit(req, {
      action: 'member.photo_delete',
      description: `Removed the profile photograph for member #${id}.`,
      entityType: 'member',
      entityId: id,
    });
    res.json({ ok: true, message: 'Photograph removed.' });
  }),
);

export default router;
