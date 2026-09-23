/**
 * Authentication middleware.
 *
 * Verifies the Bearer access token, then loads the *current* role and
 * permissions from the database rather than trusting the token payload. That
 * costs one indexed query per request but means revoking a permission or
 * deactivating an account takes effect immediately, instead of whenever the
 * user's 15-minute token happens to expire.
 */
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { queryOne } from '../config/db.js';
import { unauthorized, forbidden } from '../utils/errors.js';

export interface AccessTokenPayload {
  sub: number;
  email: string;
  role: string;
}

interface UserRow {
  id: number;
  email: string;
  full_name: string;
  is_active: boolean;
  role_id: number;
  role_name: string;
  permissions: string[];
  department_id: number | null;
  member_id: number | null;
}

function extractToken(req: Request): string | null {
  // Header only. Tokens in a query string end up in access logs, browser
  // history and Referer headers; the client fetches downloads into a blob with
  // the Authorization header instead, so no caller needs the query form.
  const header = req.headers.authorization;
  if (header && /^bearer\s+/i.test(header)) return header.replace(/^bearer\s+/i, '').trim() || null;
  return null;
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) throw unauthorized('Your session has expired. Please sign in again.');

    let payload: AccessTokenPayload;
    try {
      // jwt.verify is typed as string | JwtPayload; the shape is guaranteed by
      // signAccessToken, and the database lookup below is what actually
      // establishes trust in the subject.
      payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
        issuer: 'churchconnect',
        audience: 'churchconnect-client',
      }) as unknown as AccessTokenPayload;
    } catch {
      throw unauthorized('Your session has expired. Please sign in again.');
    }

    const user = await queryOne<UserRow>(
      `SELECT u.id, u.email, u.full_name, u.is_active, u.department_id, u.member_id,
              r.id AS role_id, r.name AS role_name, r.permissions
         FROM users u
         JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1`,
      [payload.sub],
    );

    if (!user) throw unauthorized('This account no longer exists.');
    if (!user.is_active) throw forbidden('This account has been deactivated. Contact an administrator.');

    req.auth = {
      userId: user.id,
      email: user.email,
      fullName: user.full_name,
      roleId: user.role_id,
      roleName: user.role_name,
      permissions: Array.isArray(user.permissions) ? user.permissions : [],
      departmentId: user.department_id,
      memberId: user.member_id,
    };

    next();
  } catch (err) {
    next(err);
  }
}

/** Throws if called on a request that somehow reached a handler unauthenticated. */
export function requireAuth(req: Request): Express.AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
