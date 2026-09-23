/**
 * Authentication routes.
 *
 * The refresh token travels in an httpOnly, SameSite=Strict cookie so that
 * client-side JavaScript (and therefore any XSS payload) cannot read it. The
 * short-lived access token lives in memory on the client only.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/http.js';
import { validateBody } from '../../middleware/validate.js';
import { authenticate, requireAuth } from '../../middleware/auth.js';
import { recordAudit, clientIp } from '../../services/audit.service.js';
import { getPublicBranding } from '../../services/settings.service.js';
import { isEmailConfigured } from '../../services/email/email.service.js';
import * as authService from './auth.service.js';

const router = Router();

const REFRESH_COOKIE = 'cc_refresh';

const cookieOptions = {
  httpOnly: true as const,
  secure: env.isProd,
  sameSite: 'strict' as const,
  path: '/api/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
};

/**
 * Rate limits on the credential endpoints.
 *
 * These are keyed by IP address. A church office typically sits behind ONE
 * public IP, so every member of staff shares a bucket - which is why the limits
 * below are shaped by what fails rather than by what happens.
 *
 * The primary defence against a targeted brute-force attack is not here: it is
 * the per-ACCOUNT lockout in auth.service (5 failures, then 15 minutes). These
 * limiters are defence in depth against broad, untargeted attempts.
 */

/**
 * Sign-in. `skipSuccessfulRequests` is the important part: a successful sign-in
 * costs nothing, so twenty ushers signing in on a Sunday morning from one
 * office never trip it. Only failures count toward the budget.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many failed sign-in attempts from this location. Please wait a few minutes and try again.',
    },
  },
});

/**
 * Requesting a reset link. Kept tight: the abuse here is not guessing a
 * password, it is flooding somebody's inbox with reset emails.
 */
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many password reset requests. Please wait an hour, or ask a church administrator to reset it for you.',
    },
  },
});

/**
 * Using a reset link. More generous than the request limit, because a user who
 * keeps failing the password rules is a confused member, not an attacker - and
 * the token itself is single-use and short-lived.
 */
const resetPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many attempts. Please wait a while, or request a new reset link.',
    },
  },
});

// --- schemas ----------------------------------------------------------------

const passwordRules = z
  .string()
  .min(10, 'Password must be at least 10 characters long.')
  .max(128, 'Password is too long.')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v), {
    message: 'Password must include upper case, lower case and a number.',
  });

const loginSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address.'),
  password: z.string().min(1, 'Please enter your password.'),
  rememberMe: z.boolean().optional().default(false),
});

// --- routes -----------------------------------------------------------------

/** Public branding for the login screen (church name + tagline). */
router.get(
  '/branding',
  asyncHandler(async (_req, res) => {
    res.json(await getPublicBranding());
  }),
);

router.post(
  '/login',
  loginLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password, rememberMe } = req.body as z.infer<typeof loginSchema>;

    try {
      const result = await authService.login(email, password, {
        userAgent: req.headers['user-agent'],
        ip: clientIp(req) ?? undefined,
      });

      // "Remember me" only extends the cookie lifetime; a session cookie
      // otherwise disappears when the browser closes.
      res.cookie(REFRESH_COOKIE, result.refreshToken, {
        ...cookieOptions,
        ...(rememberMe ? {} : { maxAge: undefined }),
      });

      req.auth = {
        userId: result.user.id,
        email: result.user.email,
        fullName: result.user.fullName,
        roleId: result.user.roleId,
        roleName: result.user.roleName,
        permissions: result.user.permissions,
        departmentId: result.user.departmentId,
        memberId: result.user.memberId,
      };
      await recordAudit(req, {
        action: 'auth.login',
        description: `${result.user.fullName} signed in.`,
        entityType: 'user',
        entityId: result.user.id,
      });

      res.json({ user: result.user, accessToken: result.accessToken });
    } catch (err) {
      await recordAudit(req, {
        action: 'auth.login_failed',
        description: `Failed sign-in attempt for ${email}.`,
        entityType: 'user',
        metadata: { email },
      });
      throw err;
    }
  }),
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Please sign in to continue.' } });
      return;
    }
    const result = await authService.refresh(raw, {
      userAgent: req.headers['user-agent'],
      ip: clientIp(req) ?? undefined,
    });
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
    res.json({ user: result.user, accessToken: result.accessToken });
  }),
);

router.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    await authService.logout(req.cookies?.[REFRESH_COOKIE], auth.userId);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    await recordAudit(req, {
      action: 'auth.logout',
      description: `${auth.fullName} signed out.`,
      entityType: 'user',
      entityId: auth.userId,
    });
    res.json({ ok: true });
  }),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ user: await authService.getCurrentUser(requireAuth(req).userId) });
  }),
);

router.post(
  '/change-password',
  authenticate,
  validateBody(
    z.object({
      currentPassword: z.string().min(1, 'Please enter your current password.'),
      newPassword: passwordRules,
    }),
  ),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    await authService.changePassword(auth.userId, req.body.currentPassword, req.body.newPassword, {
      ipAddress: clientIp(req),
    });
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    await recordAudit(req, {
      action: 'auth.password_changed',
      description: `${auth.fullName} changed their password.`,
      entityType: 'user',
      entityId: auth.userId,
    });
    res.json({ ok: true, message: 'Password updated. Please sign in again.' });
  }),
);

router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validateBody(z.object({ email: z.string().trim().email('Please enter a valid email address.') })),
  asyncHandler(async (req, res) => {
    const result = await authService.requestPasswordReset(req.body.email, { ipAddress: clientIp(req) });
    // Always the same response, whether or not the address is registered.
    res.json({
      ok: true,
      message: 'If that email address belongs to an account, a reset link has been sent.',
      // Tells the UI whether to say "check your inbox" or "ask an administrator".
      // It is a property of the server, not of the address, so it leaks nothing.
      emailEnabled: isEmailConfigured(),
      ...(result.token ? { devToken: result.token } : {}),
    });
  }),
);

/**
 * Describe a reset or invitation token, so the landing page can greet the right
 * person and use the right wording. POST rather than GET so the token does not
 * end up in server access logs or browser history.
 */
router.post(
  '/token-info',
  resetPasswordLimiter,
  validateBody(z.object({ token: z.string().min(10).max(200) })),
  asyncHandler(async (req, res) => {
    res.json(await authService.getTokenInfo(req.body.token));
  }),
);

router.post(
  '/reset-password',
  resetPasswordLimiter,
  validateBody(z.object({ token: z.string().min(10), newPassword: passwordRules })),
  asyncHandler(async (req, res) => {
    const { purpose } = await authService.completePasswordReset(req.body.token, req.body.newPassword, {
      ipAddress: clientIp(req),
    });

    const isInvite = purpose === 'invite';
    await recordAudit(req, {
      action: 'auth.password_reset',
      description: isInvite
        ? 'A new user accepted an invitation and set their password.'
        : 'A password was reset via reset link.',
      metadata: { purpose },
    });

    res.json({
      ok: true,
      purpose,
      message: isInvite
        ? 'Your password has been set. You can now sign in.'
        : 'Your password has been reset. You can now sign in.',
    });
  }),
);

export default router;
