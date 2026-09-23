/**
 * Authentication service.
 *
 * Security decisions, and why:
 *  - Argon2id for password hashing. Memory-hard, so a leaked hash dump is far
 *    more expensive to attack than with bcrypt at comparable cost settings.
 *  - Short-lived access token (15 min) + long-lived rotating refresh token.
 *    The refresh token is stored only as a SHA-256 hash, and is *rotated* on
 *    every use; presenting an already-used token revokes the whole family,
 *    which is the standard detection for a stolen refresh token.
 *  - Login failures are counted and the account is locked temporarily. The
 *    response text is identical for "no such user" and "wrong password" so the
 *    endpoint cannot be used to enumerate church staff email addresses.
 */
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { query, queryOne, tx } from '../../config/db.js';
import { unauthorized, forbidden, badRequest, notFound } from '../../utils/errors.js';
import { isEmailConfigured, sendInBackground } from '../../services/email/email.service.js';
import { passwordResetEmail, passwordChangedEmail } from '../../services/email/templates.js';
import { getPublicBranding } from '../../services/settings.service.js';

const ARGON_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB - OWASP baseline
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export interface AuthenticatedUser {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  roleId: number;
  roleName: string;
  roleLabel: string;
  permissions: string[];
  departmentId: number | null;
  departmentName: string | null;
  memberId: number | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

interface UserRecord extends AuthenticatedUser {
  passwordHash: string;
  isActive: boolean;
  failedAttempts: number;
  lockedUntil: string | null;
}

const USER_SELECT = `
  SELECT u.id, u.email, u.full_name AS "fullName", u.phone, u.password_hash AS "passwordHash",
         u.is_active AS "isActive", u.must_change_password AS "mustChangePassword",
         u.failed_login_attempts AS "failedAttempts", u.locked_until AS "lockedUntil",
         u.last_login_at AS "lastLoginAt", u.member_id AS "memberId",
         u.department_id AS "departmentId", d.name AS "departmentName",
         r.id AS "roleId", r.name AS "roleName", r.label AS "roleLabel", r.permissions
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN departments d ON d.id = u.department_id
`;

function stripSecrets(u: UserRecord): AuthenticatedUser {
  const { passwordHash, isActive, failedAttempts, lockedUntil, ...safe } = u;
  return safe;
}

export function signAccessToken(user: { id: number; email: string; roleName: string }): string {
  return jwt.sign({ sub: user.id, email: user.email, role: user.roleName }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
    issuer: 'churchconnect',
    audience: 'churchconnect-client',
  } as jwt.SignOptions);
}

/** Creates a refresh token, stores its hash, returns the raw value. */
async function issueRefreshToken(userId: number, userAgent?: string, ip?: string): Promise<string> {
  const raw = crypto.randomBytes(48).toString('hex');
  const expires = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, sha256(raw), userAgent?.slice(0, 300) ?? null, ip?.slice(0, 60) ?? null, expires],
  );
  return raw;
}

export interface LoginResult {
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
}

export async function login(
  email: string,
  password: string,
  meta: { userAgent?: string; ip?: string },
): Promise<LoginResult> {
  // Deliberately identical error for every failure mode below.
  const GENERIC = 'Incorrect email address or password.';

  const user = await queryOne<UserRecord>(`${USER_SELECT} WHERE LOWER(u.email) = LOWER($1)`, [email]);

  if (!user) {
    // Spend comparable time to a real verify so response timing does not
    // reveal whether the address exists.
    await argon2.hash(password, ARGON_OPTIONS).catch(() => undefined);
    throw unauthorized(GENERIC);
  }

  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    const minutes = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60_000);
    throw forbidden(`Too many failed attempts. Please try again in ${minutes} minute(s).`);
  }

  const ok = await verifyPassword(user.passwordHash, password);

  if (!ok) {
    const attempts = user.failedAttempts + 1;
    const lock = attempts >= env.MAX_LOGIN_ATTEMPTS;
    await query(
      `UPDATE users SET failed_login_attempts = $2,
              locked_until = CASE WHEN $3 THEN NOW() + ($4 || ' minutes')::interval ELSE locked_until END
        WHERE id = $1`,
      [user.id, lock ? 0 : attempts, lock, String(env.LOCKOUT_MINUTES)],
    );
    throw unauthorized(GENERIC);
  }

  if (!user.isActive) {
    throw forbidden('This account has been deactivated. Please contact a Super Administrator.');
  }

  await query(
    `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1`,
    [user.id],
  );

  return {
    user: stripSecrets(user),
    accessToken: signAccessToken({ id: user.id, email: user.email, roleName: user.roleName }),
    refreshToken: await issueRefreshToken(user.id, meta.userAgent, meta.ip),
  };
}

/**
 * Exchange a refresh token for a new pair, rotating the old one.
 * Re-use of an already-revoked token revokes every session for that user.
 */
/**
 * A replay inside this window after rotation is treated as a race between two
 * tabs of the same browser (both refreshed at once; one lost), not as theft.
 * The loser gets a 401 and signs in again; the winner's session survives.
 * Outside the window a replay can only be a copied token.
 */
const REPLAY_GRACE_MS = 10_000;

export async function refresh(rawToken: string, meta: { userAgent?: string; ip?: string }): Promise<LoginResult> {
  const hash = sha256(rawToken);

  // The replay decision is returned from the transaction rather than thrown
  // inside it. tx() rolls back on a throw, which would also undo the
  // revoke-everything statement below - so it must run after the commit.
  const outcome = await tx(async (client): Promise<{ replay: { userId: number; recent: boolean } } | { result: LoginResult }> => {
    const { rows } = await client.query(
      `SELECT id, user_id, revoked_at, expires_at FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [hash],
    );
    const token = rows[0];
    if (!token) throw unauthorized('Your session is no longer valid. Please sign in again.');

    if (token.revoked_at) {
      const recent = Date.now() - new Date(token.revoked_at).getTime() < REPLAY_GRACE_MS;
      return { replay: { userId: token.user_id, recent } };
    }

    if (new Date(token.expires_at) < new Date()) {
      throw unauthorized('Your session has expired. Please sign in again.');
    }

    await client.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`, [token.id]);

    const { rows: userRows } = await client.query(`${USER_SELECT} WHERE u.id = $1`, [token.user_id]);
    const user = userRows[0] as UserRecord | undefined;
    if (!user || !user.isActive) throw forbidden('This account is no longer active.');

    const raw = crypto.randomBytes(48).toString('hex');
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        user.id,
        sha256(raw),
        meta.userAgent?.slice(0, 300) ?? null,
        meta.ip?.slice(0, 60) ?? null,
        new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      ],
    );

    return {
      result: {
        user: stripSecrets(user),
        accessToken: signAccessToken({ id: user.id, email: user.email, roleName: user.roleName }),
        refreshToken: raw,
      },
    };
  });

  if ('replay' in outcome) {
    if (!outcome.replay.recent) {
      // Token replay well after rotation - assume compromise and drop every
      // session for the user. Runs outside the transaction so it persists.
      await logoutEverywhere(outcome.replay.userId);
      throw unauthorized('Your session was ended for security reasons. Please sign in again.');
    }
    throw unauthorized('Your session was refreshed in another tab. Please sign in again here.');
  }

  return outcome.result;
}

/**
 * Housekeeping for the token tables. Revoked and expired rows are kept for 30
 * days (they are what replay detection and incident review look at), then
 * dropped so the tables do not grow by one row per user per 15 minutes forever.
 */
export async function pruneAuthTokens(): Promise<{ refreshTokens: number; passwordResets: number }> {
  const rt = await query(
    `DELETE FROM refresh_tokens
      WHERE expires_at < NOW() - interval '30 days'
         OR (revoked_at IS NOT NULL AND revoked_at < NOW() - interval '30 days')`,
  );
  const pr = await query(`DELETE FROM password_resets WHERE expires_at < NOW() - interval '30 days'`);
  return { refreshTokens: rt.rowCount, passwordResets: pr.rowCount };
}

export async function logout(rawToken: string | undefined, userId: number): Promise<void> {
  if (rawToken) {
    await query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND user_id = $2`, [
      sha256(rawToken),
      userId,
    ]);
  }
}

export async function logoutEverywhere(userId: number): Promise<void> {
  await query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
}

export async function getCurrentUser(userId: number): Promise<AuthenticatedUser> {
  const user = await queryOne<UserRecord>(`${USER_SELECT} WHERE u.id = $1`, [userId]);
  if (!user) throw notFound('Account not found.');
  return stripSecrets(user);
}

export async function changePassword(
  userId: number,
  current: string,
  next: string,
  meta: { ipAddress?: string | null } = {},
): Promise<void> {
  const row = await queryOne<{ passwordHash: string }>(
    `SELECT password_hash AS "passwordHash" FROM users WHERE id = $1`,
    [userId],
  );
  if (!row) throw notFound('Account not found.');
  if (!(await verifyPassword(row.passwordHash, current))) {
    throw badRequest('Your current password is not correct.');
  }
  await query(
    `UPDATE users SET password_hash = $2, must_change_password = FALSE WHERE id = $1`,
    [userId, await hashPassword(next)],
  );
  // Force every other device to sign in again with the new password.
  await logoutEverywhere(userId);
  await notifyPasswordChanged(userId, meta.ipAddress ?? null);
}

/**
 * Begin a password reset.
 *
 * Always resolves, whether or not the address exists, so the endpoint cannot
 * confirm which emails are registered. Three details keep that guarantee:
 *
 *  1. The same value is returned in both cases.
 *  2. The email is dispatched in the BACKGROUND (sendInBackground), so the
 *     response time does not differ measurably between a hit and a miss.
 *  3. Nothing about delivery success reaches the caller.
 *
 * The raw token is returned only outside production, so the flow can be
 * completed locally before any SMTP server exists.
 */
export async function requestPasswordReset(
  email: string,
  meta: { ipAddress?: string | null } = {},
): Promise<{ token?: string }> {
  const user = await queryOne<{ id: number; full_name: string; email: string }>(
    `SELECT id, full_name, email FROM users WHERE LOWER(email) = LOWER($1) AND is_active`,
    [email],
  );
  if (!user) return {};

  const raw = crypto.randomBytes(32).toString('hex');

  await tx(async (client) => {
    // Invalidate any earlier unused links. Without this, every request a
    // confused user makes leaves another working key to their account lying in
    // their inbox.
    await client.query(
      `UPDATE password_resets SET used_at = NOW()
        WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [user.id],
    );
    await client.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)`,
      [user.id, sha256(raw), String(env.RESET_TOKEN_TTL_MINUTES)],
    );
  });

  const resetUrl = `${env.publicUrl}/reset-password?token=${raw}`;
  const branding = await getPublicBranding();

  if (isEmailConfigured()) {
    const message = passwordResetEmail({
      branding: { churchName: branding.churchName, tagline: branding.tagline },
      fullName: user.full_name,
      resetUrl,
      expiryMinutes: env.RESET_TOKEN_TTL_MINUTES,
    });
    sendInBackground({ to: user.email, ...message }, 'password reset');
  } else {
    // No mail server. Put the link where an administrator can find it rather
    // than failing silently - this is what keeps the system usable before SMTP
    // is set up, and during an outage of the mail provider.
    console.warn(
      `\n[auth] SMTP is not configured. Password reset link for ${user.email}:\n` +
        `       ${resetUrl}\n` +
        `       (valid for ${env.RESET_TOKEN_TTL_MINUTES} minutes)\n`,
    );
  }

  return env.isProd ? {} : { token: raw };
}

/**
 * Set a password from a reset or invitation token.
 *
 * Returns which it was, so the caller can word the response correctly - telling
 * a brand-new volunteer their password has been "reset" is confusing when they
 * have never had one.
 */
export async function completePasswordReset(
  rawToken: string,
  newPassword: string,
  meta: { ipAddress?: string | null } = {},
): Promise<{ purpose: 'reset' | 'invite' }> {
  const hash = sha256(rawToken);
  const row = await queryOne<{ id: number; user_id: number; purpose: 'reset' | 'invite' }>(
    `SELECT id, user_id, purpose FROM password_resets
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
    [hash],
  );
  if (!row) throw badRequest('This link is invalid or has expired.');

  await tx(async (client) => {
    await client.query(`UPDATE password_resets SET used_at = NOW() WHERE id = $1`, [row.id]);
    await client.query(`UPDATE users SET password_hash = $2, must_change_password = FALSE WHERE id = $1`, [
      row.user_id,
      await hashPassword(newPassword),
    ]);
    await client.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [
      row.user_id,
    ]);
  });

  // Only warn on a RESET. Telling somebody their password "was changed" seconds
  // after they set it for the first time is confusing, and the security value
  // of the notice - alerting the owner to a change they did not make - does not
  // apply to an account nobody has used yet.
  if (row.purpose === 'reset') {
    await notifyPasswordChanged(row.user_id, meta.ipAddress ?? null);
  }

  return { purpose: row.purpose };
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

/**
 * Issue an invitation so a new user can set their own password.
 *
 * Deliberately the same token machinery as a password reset - single use,
 * stored only as a SHA-256 hash, expiring - because it authorises exactly the
 * same thing. Only the wording and the lifetime differ.
 *
 * Returns the raw token so the caller can build a link. Sending is the caller's
 * job, because users.routes needs the inviter's name for the message.
 */
export async function createInvitation(userId: number, invitedByUserId: number | null): Promise<string> {
  const raw = crypto.randomBytes(32).toString('hex');

  await tx(async (client) => {
    // Supersede any outstanding invitation. Resending must not leave two
    // working links to the same account in circulation.
    await client.query(
      `UPDATE password_resets SET used_at = NOW()
        WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [userId],
    );
    await client.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at, purpose, created_by)
       VALUES ($1, $2, NOW() + ($3 || ' days')::interval, 'invite', $4)`,
      [userId, sha256(raw), String(env.INVITE_TOKEN_TTL_DAYS), invitedByUserId],
    );
  });

  return raw;
}

export interface TokenInfo {
  valid: boolean;
  purpose?: 'reset' | 'invite';
  fullName?: string;
  email?: string;
  roleLabel?: string;
  churchName?: string;
}

/**
 * Describe a token so the landing page can greet the right person with the
 * right wording, and fail clearly when the link is dead.
 *
 * Revealing a name to whoever holds the token is acceptable: the token IS the
 * credential, and a 32-byte random value is not guessable. This is the same
 * trade every invitation system makes, and it is what stops a new user staring
 * at an unexplained password form.
 */
export async function getTokenInfo(rawToken: string): Promise<TokenInfo> {
  const row = await queryOne<{
    purpose: 'reset' | 'invite';
    full_name: string;
    email: string;
    role_label: string;
  }>(
    `SELECT pr.purpose, u.full_name, u.email, r.label AS role_label
       FROM password_resets pr
       JOIN users u ON u.id = pr.user_id
       JOIN roles r ON r.id = u.role_id
      WHERE pr.token_hash = $1 AND pr.used_at IS NULL AND pr.expires_at > NOW() AND u.is_active`,
    [sha256(rawToken)],
  );

  if (!row) return { valid: false };

  const branding = await getPublicBranding();
  return {
    valid: true,
    purpose: row.purpose,
    fullName: row.full_name,
    email: row.email,
    roleLabel: row.role_label,
    churchName: branding.churchName,
  };
}

/**
 * Tell the account owner their password changed.
 *
 * This is a security control, not a courtesy: if an attacker resets a password,
 * this message is how the real owner finds out. It is sent on both reset paths -
 * the emailed link and a signed-in change.
 */
export async function notifyPasswordChanged(userId: number, ipAddress: string | null): Promise<void> {
  if (!isEmailConfigured()) return;

  try {
    const user = await queryOne<{ full_name: string; email: string }>(
      `SELECT full_name, email FROM users WHERE id = $1`,
      [userId],
    );
    if (!user) return;

    const branding = await getPublicBranding();
    const message = passwordChangedEmail({
      branding: { churchName: branding.churchName, tagline: branding.tagline },
      fullName: user.full_name,
      changedAt: new Date(),
      ipAddress,
    });
    sendInBackground({ to: user.email, ...message }, 'password changed notice');
  } catch (err) {
    // Never let a notification failure undo a completed password change.
    console.error('[auth] could not queue password-changed notice:', (err as Error).message);
  }
}
