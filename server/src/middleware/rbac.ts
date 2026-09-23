/**
 * Role-based access control.
 *
 * Usage on a route:
 *   router.post('/', authenticate, requirePermission('members:create'), handler)
 *
 * Department Leaders additionally get *row* scoping: `departmentScope()` gives
 * a SQL fragment restricting results to their own department. Permission alone
 * is not enough for that role - a leader holds `members:read`, but must only
 * see their own people.
 */
import type { Request, Response, NextFunction } from 'express';
import { forbidden } from '../utils/errors.js';
import { hasPermission, ROLE_NAMES } from '../config/permissions.js';

export function requirePermission(...required: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.auth;
    if (!auth) return next(forbidden('You do not have permission to perform this action.'));

    const ok = required.every((p) => hasPermission(auth.permissions, p));
    if (!ok) {
      return next(
        forbidden(
          `Your role (${auth.roleName.replace(/_/g, ' ')}) does not allow this action. ` +
            'Contact a Super Administrator if you believe this is a mistake.',
        ),
      );
    }
    next();
  };
}

/** Any one of the listed permissions is enough. */
export function requireAnyPermission(...required: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.auth;
    if (!auth) return next(forbidden());
    if (!required.some((p) => hasPermission(auth.permissions, p))) {
      return next(forbidden('You do not have permission to perform this action.'));
    }
    next();
  };
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth || !roles.includes(req.auth.roleName)) {
      return next(forbidden('This area is restricted.'));
    }
    next();
  };
}

/**
 * Row-level scope for Department Leaders.
 *
 * Returns a SQL fragment plus the parameter to bind, or null when the caller
 * may see everything. Callers append the fragment to their WHERE clause:
 *
 *   const scope = departmentScope(req, 'm.department_id');
 *   if (scope) { where.push(scope.sql(params.length + 1)); params.push(scope.value); }
 */
export function departmentScope(
  req: Request,
  column: string,
): { sql: (index: number) => string; value: number } | null {
  const auth = req.auth;
  if (!auth) return null;
  if (auth.roleName !== ROLE_NAMES.DEPARTMENT_LEADER) return null;
  // A leader with no department assigned sees nothing rather than everything.
  const deptId = auth.departmentId ?? -1;
  return { sql: (i: number) => `${column} = $${i}`, value: deptId };
}
