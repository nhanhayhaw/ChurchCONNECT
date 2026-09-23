/**
 * User and role administration. Super Administrator territory.
 *
 * Two guard rails worth noting:
 *  - A user can never change their own role or deactivate themselves. That is
 *    what stops the last administrator locking the church out of its own system.
 *  - Passwords are never returned, never logged, and never accepted in a query
 *    string.
 */
import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { query, queryOne } from '../../config/db.js';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/http.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { authenticate, requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { recordAudit } from '../../services/audit.service.js';
import { hashPassword, logoutEverywhere, createInvitation } from '../auth/auth.service.js';
import { isEmailConfigured, sendInBackground } from '../../services/email/email.service.js';
import { invitationEmail } from '../../services/email/templates.js';
import { getPublicBranding } from '../../services/settings.service.js';
import { notFound, badRequest, conflict } from '../../utils/errors.js';
import { PERMISSIONS, ROLE_NAMES } from '../../config/permissions.js';

const router = Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });

const passwordRules = z
  .string()
  .min(10, 'Password must be at least 10 characters long.')
  .max(128)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v), {
    message: 'Password must include upper case, lower case and a number.',
  });

router.use(authenticate);

// --- roles ------------------------------------------------------------------

router.get(
  '/roles',
  requirePermission('users:read'),
  asyncHandler(async (_req, res) => {
    const { rows } = await query<any>(
      `SELECT r.id, r.name, r.label, r.description, r.permissions, r.is_system,
              COUNT(u.id)::int AS user_count
         FROM roles r LEFT JOIN users u ON u.role_id = r.id
        GROUP BY r.id ORDER BY r.id`,
    );
    res.json({
      roles: rows.map((r) => ({
        id: r.id,
        name: r.name,
        label: r.label,
        description: r.description,
        permissions: r.permissions,
        isSystem: r.is_system,
        userCount: r.user_count,
      })),
      catalogue: PERMISSIONS,
    });
  }),
);

router.put(
  '/roles/:id',
  requirePermission('users:manage'),
  validateParams(idParam),
  validateBody(
    z.object({
      label: z.string().trim().min(2).max(100).optional(),
      description: z.string().trim().max(500).optional().nullable(),
      permissions: z.array(z.string()).max(60).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const role = await queryOne<any>(`SELECT name, is_system FROM roles WHERE id = $1`, [id]);
    if (!role) throw notFound('That role could not be found.');

    // The Super Administrator's wildcard must stay intact, or an admin could
    // accidentally strip their own ability to restore it.
    if (role.name === ROLE_NAMES.SUPER_ADMIN && req.body.permissions) {
      throw badRequest('The Super Administrator role always has full access and cannot be restricted.');
    }

    if (req.body.permissions) {
      const invalid = req.body.permissions.filter((p: string) => !PERMISSIONS.includes(p as any));
      if (invalid.length > 0) throw badRequest(`Unknown permission(s): ${invalid.join(', ')}.`);
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (req.body.label !== undefined) {
      params.push(req.body.label);
      sets.push(`label = $${params.length}`);
    }
    if (req.body.description !== undefined) {
      params.push(req.body.description);
      sets.push(`description = $${params.length}`);
    }
    if (req.body.permissions !== undefined) {
      params.push(JSON.stringify(req.body.permissions));
      sets.push(`permissions = $${params.length}::jsonb`);
    }
    if (sets.length === 0) {
      res.json({ ok: true, message: 'Nothing to update.' });
      return;
    }
    params.push(id);
    await query(`UPDATE roles SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

    await recordAudit(req, {
      action: 'role.update',
      description: `Updated the ${role.name} role.`,
      entityType: 'role',
      entityId: id,
      metadata: { fields: Object.keys(req.body) },
    });
    res.json({ ok: true, message: 'Role updated. Affected users see the change on their next request.' });
  }),
);

// --- users ------------------------------------------------------------------

router.get(
  '/',
  requirePermission('users:read'),
  asyncHandler(async (_req, res) => {
    const { rows } = await query<any>(
      `SELECT u.id, u.full_name, u.email, u.phone, u.is_active, u.last_login_at, u.created_at,
              u.must_change_password, u.locked_until,
              r.id AS role_id, r.name AS role_name, r.label AS role_label,
              d.id AS department_id, d.name AS department_name,
              EXISTS (
                SELECT 1 FROM password_resets pr
                 WHERE pr.user_id = u.id AND pr.purpose = 'invite'
                   AND pr.used_at IS NULL AND pr.expires_at > NOW()
              ) AS invite_pending
         FROM users u
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN departments d ON d.id = u.department_id
        ORDER BY u.full_name`,
    );
    res.json({
      users: rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        email: r.email,
        phone: r.phone,
        isActive: r.is_active,
        mustChangePassword: r.must_change_password,
        isLocked: r.locked_until ? new Date(r.locked_until) > new Date() : false,
        lastLoginAt: r.last_login_at,
        createdAt: r.created_at,
        roleId: r.role_id,
        roleName: r.role_name,
        roleLabel: r.role_label,
        departmentId: r.department_id,
        departmentName: r.department_name,
        invitePending: r.invite_pending,
        /** Never signed in - so an invitation is still the right remedy. */
        neverSignedIn: r.last_login_at === null,
      })),
      // Lets the UI offer "send an invitation" only when it would actually work.
      // A property of the deployment, not of any user.
      emailEnabled: isEmailConfigured(),
      inviteExpiryDays: env.INVITE_TOKEN_TTL_DAYS,
    });
  }),
);

router.post(
  '/',
  requirePermission('users:manage'),
  validateBody(
    z
      .object({
        fullName: z.string().trim().min(3, 'Please enter the full name.').max(150),
        email: z.string().trim().email('Please enter a valid email address.'),
        phone: z.string().trim().max(30).optional().nullable(),
        // Optional now: omitted when the account is created by invitation.
        password: passwordRules.optional(),
        roleId: z.coerce.number().int().positive(),
        departmentId: z.coerce.number().int().positive().optional().nullable(),
        memberId: z.coerce.number().int().positive().optional().nullable(),
        mustChangePassword: z.boolean().optional().default(true),
        /** Email an invitation instead of setting a password by hand. */
        sendInvite: z.boolean().optional().default(false),
      })
      .refine((d) => d.sendInvite || Boolean(d.password), {
        message: 'Either set a temporary password or choose to send an invitation.',
        path: ['password'],
      }),
  ),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const b = req.body as {
      fullName: string; email: string; phone?: string | null; password?: string;
      roleId: number; departmentId?: number | null; memberId?: number | null;
      mustChangePassword: boolean; sendInvite: boolean;
    };

    const role = await queryOne<{ name: string; label: string }>(
      `SELECT name, label FROM roles WHERE id = $1`,
      [b.roleId],
    );
    if (!role) throw badRequest('Please choose a valid role.');

    // A Department Leader without a department would see nothing at all.
    if (role.name === ROLE_NAMES.DEPARTMENT_LEADER && !b.departmentId) {
      throw badRequest('A Department Leader must be assigned to a department.');
    }

    if (b.sendInvite && !isEmailConfigured()) {
      throw badRequest(
        'This system cannot send email yet, so an invitation cannot be delivered. ' +
          'Set a temporary password instead, or configure email first (see docs/EMAIL.md).',
      );
    }

    // An invited account still needs a password_hash - the column is NOT NULL.
    // Generate one nobody will ever know: the account is unusable until the
    // invitation link is followed, which is exactly the intent.
    const initialPassword = b.password ?? crypto.randomBytes(32).toString('hex');

    const { rows } = await query<{ id: number }>(
      `INSERT INTO users (full_name, email, phone, password_hash, role_id, department_id, member_id, must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        b.fullName,
        b.email.toLowerCase(),
        b.phone ?? null,
        await hashPassword(initialPassword),
        b.roleId,
        b.departmentId ?? null,
        b.memberId ?? null,
        // An invited user chooses their own password, so there is nothing to
        // force them to change afterwards.
        b.sendInvite ? false : b.mustChangePassword,
      ],
    );
    const userId = rows[0]!.id;

    let invited = false;
    if (b.sendInvite) {
      const token = await createInvitation(userId, auth.userId);
      const branding = await getPublicBranding();
      const message = invitationEmail({
        branding: { churchName: branding.churchName, tagline: branding.tagline },
        fullName: b.fullName,
        roleLabel: role.label,
        invitedByName: auth.fullName,
        inviteUrl: `${env.publicUrl}/reset-password?token=${token}`,
        expiryDays: env.INVITE_TOKEN_TTL_DAYS,
      });
      sendInBackground({ to: b.email.toLowerCase(), ...message }, 'invitation');
      invited = true;
    }

    await recordAudit(req, {
      action: 'user.create',
      description:
        `Created the ${role.name.replace(/_/g, ' ')} account for ${b.fullName}` +
        (invited ? ' and sent an invitation.' : ' with a temporary password.'),
      entityType: 'user',
      entityId: userId,
      metadata: { invited },
    });

    res.status(201).json({
      id: userId,
      invited,
      message: invited
        ? `Account created. An invitation has been sent to ${b.email}.`
        : `Account created for ${b.fullName}.`,
    });
  }),
);

/**
 * Resend an invitation.
 *
 * Also usable on an account created with a temporary password that the person
 * never used - it simply supersedes whatever was there and lets them choose
 * their own.
 */
router.post(
  '/:id/resend-invite',
  requirePermission('users:manage'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const id = Number(req.params.id);

    if (!isEmailConfigured()) {
      throw badRequest(
        'This system cannot send email yet. Reset the password by hand instead, or configure email first.',
      );
    }

    const user = await queryOne<{
      full_name: string; email: string; is_active: boolean; last_login_at: string | null; role_label: string;
    }>(
      `SELECT u.full_name, u.email, u.is_active, u.last_login_at, r.label AS role_label
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [id],
    );
    if (!user) throw notFound('That user account could not be found.');
    if (!user.is_active) throw badRequest('This account is deactivated. Reactivate it before sending an invitation.');

    const token = await createInvitation(id, auth.userId);
    const branding = await getPublicBranding();
    const message = invitationEmail({
      branding: { churchName: branding.churchName, tagline: branding.tagline },
      fullName: user.full_name,
      roleLabel: user.role_label,
      invitedByName: auth.fullName,
      inviteUrl: `${env.publicUrl}/reset-password?token=${token}`,
      expiryDays: env.INVITE_TOKEN_TTL_DAYS,
    });
    sendInBackground({ to: user.email, ...message }, 'invitation (resend)');

    await recordAudit(req, {
      action: 'user.update',
      description: `Sent a new invitation to ${user.full_name}.`,
      entityType: 'user',
      entityId: id,
    });

    res.json({
      ok: true,
      message: `Invitation sent to ${user.email}. It is valid for ${env.INVITE_TOKEN_TTL_DAYS} day(s).`,
    });
  }),
);

router.put(
  '/:id',
  requirePermission('users:manage'),
  validateParams(idParam),
  validateBody(
    z.object({
      fullName: z.string().trim().min(3).max(150).optional(),
      email: z.string().trim().email().optional(),
      phone: z.string().trim().max(30).optional().nullable(),
      roleId: z.coerce.number().int().positive().optional(),
      departmentId: z.coerce.number().int().positive().optional().nullable(),
      isActive: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const id = Number(req.params.id);

    const target = await queryOne<any>(
      `SELECT u.full_name, u.role_id, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [id],
    );
    if (!target) throw notFound('That user account could not be found.');

    // Self-protection: no privilege changes or self-deactivation.
    if (id === auth.userId) {
      if (req.body.roleId !== undefined && req.body.roleId !== target.role_id) {
        throw conflict('You cannot change your own role. Ask another Super Administrator to do it.');
      }
      if (req.body.isActive === false) {
        throw conflict('You cannot deactivate your own account.');
      }
    }

    // Never leave the church without a working Super Administrator.
    if (target.role_name === ROLE_NAMES.SUPER_ADMIN && (req.body.isActive === false || req.body.roleId)) {
      const remaining = await queryOne<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM users u JOIN roles r ON r.id = u.role_id
          WHERE r.name = $1 AND u.is_active AND u.id <> $2`,
        [ROLE_NAMES.SUPER_ADMIN, id],
      );
      if ((remaining?.n ?? 0) === 0) {
        throw conflict('This is the last active Super Administrator. Promote another account first.');
      }
    }

    const map: Record<string, string> = {
      fullName: 'full_name',
      email: 'email',
      phone: 'phone',
      roleId: 'role_id',
      departmentId: 'department_id',
      isActive: 'is_active',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [field, column] of Object.entries(map)) {
      const value = (req.body as any)[field];
      if (value === undefined) continue;
      params.push(field === 'email' ? String(value).toLowerCase() : value);
      sets.push(`${column} = $${params.length}`);
    }
    if (sets.length === 0) {
      res.json({ ok: true, message: 'Nothing to update.' });
      return;
    }
    params.push(id);
    await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

    // A role change or deactivation must invalidate live sessions immediately.
    if (req.body.roleId !== undefined || req.body.isActive === false) {
      await logoutEverywhere(id);
    }

    await recordAudit(req, {
      action: req.body.roleId !== undefined ? 'user.role_change' : 'user.update',
      description: `Updated the account for ${target.full_name}.`,
      entityType: 'user',
      entityId: id,
      metadata: { fields: Object.keys(req.body) },
    });
    res.json({ ok: true, message: 'Account updated.' });
  }),
);

router.post(
  '/:id/reset-password',
  requirePermission('users:manage'),
  validateParams(idParam),
  validateBody(z.object({ newPassword: passwordRules })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const target = await queryOne<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [id]);
    if (!target) throw notFound('That user account could not be found.');

    await query(
      `UPDATE users SET password_hash = $2, must_change_password = TRUE,
              failed_login_attempts = 0, locked_until = NULL
        WHERE id = $1`,
      [id, await hashPassword(req.body.newPassword)],
    );
    await logoutEverywhere(id);

    await recordAudit(req, {
      action: 'user.update',
      description: `Reset the password for ${target.full_name}.`,
      entityType: 'user',
      entityId: id,
    });
    res.json({ ok: true, message: `Password reset. ${target.full_name} must change it at next sign-in.` });
  }),
);

router.post(
  '/:id/unlock',
  requirePermission('users:manage'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await query(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`, [id]);
    await recordAudit(req, {
      action: 'user.update',
      description: `Unlocked user account #${id}.`,
      entityType: 'user',
      entityId: id,
    });
    res.json({ ok: true, message: 'Account unlocked.' });
  }),
);

router.delete(
  '/:id',
  requirePermission('users:manage'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const id = Number(req.params.id);
    if (id === auth.userId) throw conflict('You cannot delete your own account.');

    const target = await queryOne<any>(
      `SELECT u.full_name, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [id],
    );
    if (!target) throw notFound('That user account could not be found.');

    if (target.role_name === ROLE_NAMES.SUPER_ADMIN) {
      const remaining = await queryOne<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM users u JOIN roles r ON r.id = u.role_id
          WHERE r.name = $1 AND u.is_active AND u.id <> $2`,
        [ROLE_NAMES.SUPER_ADMIN, id],
      );
      if ((remaining?.n ?? 0) === 0) {
        throw conflict('This is the last Super Administrator and cannot be deleted.');
      }
    }

    await query(`DELETE FROM users WHERE id = $1`, [id]);
    await recordAudit(req, {
      action: 'user.delete',
      description: `Deleted the account for ${target.full_name}.`,
      entityType: 'user',
      entityId: id,
    });
    res.json({ ok: true, message: `${target.full_name}'s account was deleted.` });
  }),
);

export default router;
