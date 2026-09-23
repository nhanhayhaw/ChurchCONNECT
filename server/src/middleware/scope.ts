/**
 * Row-level scope checks for Department Leaders.
 *
 * `departmentScope()` in rbac.ts restricts LIST queries in SQL. These helpers
 * close the other half: any route that takes a member or follow-up id in the
 * URL must confirm the record belongs to the leader's department before
 * reading or writing it, or the id becomes a key to the whole congregation.
 *
 * Every helper is a no-op for roles that are not department-scoped.
 */
import type { Request } from 'express';
import { queryOne } from '../config/db.js';
import { forbidden, notFound } from '../utils/errors.js';
import { departmentScope } from './rbac.js';

const OUTSIDE = 'You can only work with members of your own department.';

/** The department a leader is confined to, or null when the caller is unscoped. */
export function scopeDepartmentId(req: Request): number | null {
  const scope = departmentScope(req, 'm.department_id');
  return scope ? scope.value : null;
}

export async function assertMemberInScope(req: Request, memberId: number): Promise<void> {
  const scope = scopeDepartmentId(req);
  if (scope === null) return;
  const row = await queryOne<{ department_id: number | null }>(
    `SELECT department_id FROM members WHERE id = $1 AND deleted_at IS NULL`,
    [memberId],
  );
  if (!row) throw notFound('That member record could not be found.');
  if (row.department_id !== scope) throw forbidden(OUTSIDE);
}

/** Every id must belong to the leader's department; one outsider fails the whole request. */
export async function assertMembersInScope(req: Request, memberIds: number[]): Promise<void> {
  const scope = scopeDepartmentId(req);
  if (scope === null || memberIds.length === 0) return;
  const row = await queryOne<{ outside: number }>(
    `SELECT COUNT(*)::int AS outside FROM members
      WHERE id = ANY($1) AND deleted_at IS NULL AND department_id IS DISTINCT FROM $2`,
    [memberIds, scope],
  );
  if ((row?.outside ?? 0) > 0) throw forbidden(OUTSIDE);
}

export async function assertFollowUpInScope(req: Request, followUpId: number): Promise<void> {
  const scope = scopeDepartmentId(req);
  if (scope === null) return;
  const row = await queryOne<{ department_id: number | null }>(
    `SELECT m.department_id FROM follow_ups f JOIN members m ON m.id = f.member_id WHERE f.id = $1`,
    [followUpId],
  );
  if (!row) throw notFound('That follow-up could not be found.');
  if (row.department_id !== scope) throw forbidden(OUTSIDE);
}

/**
 * A leader may only open registers for their own department. A congregation-
 * wide service (no department) is not theirs to create, and a service for
 * another department certainly is not.
 */
export function assertServiceScopeAllowed(req: Request, serviceDepartmentId: number | null | undefined): void {
  const scope = scopeDepartmentId(req);
  if (scope === null) return;
  if (serviceDepartmentId !== scope) {
    throw forbidden('You can only record attendance for your own department\'s meetings.');
  }
}
