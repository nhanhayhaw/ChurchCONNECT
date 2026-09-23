/**
 * Audit logging.
 *
 * Called explicitly from the handlers that change or read sensitive data,
 * rather than blanket-logging every request - an audit trail that records
 * 40,000 dashboard polls a day is one nobody reads.
 *
 * Writes are fire-and-forget: a failure to log must never fail the user's
 * actual operation, but it is reported to the server console.
 */
import type { Request } from 'express';
import { query } from '../config/db.js';

export type AuditAction =
  | 'auth.login' | 'auth.login_failed' | 'auth.logout' | 'auth.password_reset' | 'auth.password_changed'
  | 'member.create' | 'member.update' | 'member.delete' | 'member.restore' | 'member.photo_upload'
  | 'member.photo_delete' | 'member.export' | 'member.view'
  | 'attendance.service_create' | 'attendance.record' | 'attendance.finalize' | 'attendance.delete'
  | 'followup.create' | 'followup.update' | 'followup.note' | 'followup.resolve'
  | 'department.create' | 'department.update' | 'department.delete'
  | 'group.create' | 'group.update' | 'group.delete'
  | 'user.create' | 'user.update' | 'user.delete' | 'user.role_change'
  | 'role.update'
  | 'settings.update'
  | 'report.view' | 'report.export'
  | 'job.absence_scan' | 'job.birthday_scan';

interface AuditInput {
  action: AuditAction;
  description: string;
  entityType?: string;
  entityId?: number | null;
  metadata?: Record<string, unknown>;
}

/**
 * Client IP as Express resolves it under the app's `trust proxy` setting.
 *
 * Deliberately NOT read from X-Forwarded-For by hand: that header is supplied
 * by whoever sends the request, so parsing it directly lets any visitor write
 * an address of their choosing into the audit trail and session records. With
 * `trust proxy` configured for exactly one hop, req.ip is the address the
 * reverse proxy saw, and nothing the visitor sends can change it.
 */
export function clientIp(req: Request): string | null {
  return (req.ip ?? req.socket.remoteAddress ?? null)?.slice(0, 60) ?? null;
}

export async function recordAudit(req: Request, input: AuditInput): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs
         (user_id, user_email, user_role, action, entity_type, entity_id,
          description, ip_address, user_agent, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        req.auth?.userId ?? null,
        req.auth?.email ?? null,
        req.auth?.roleName ?? null,
        input.action,
        input.entityType ?? null,
        input.entityId ?? null,
        input.description,
        clientIp(req),
        (req.headers['user-agent'] ?? '').toString().slice(0, 300) || null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    );
  } catch (err) {
    console.error('[audit] failed to write entry:', (err as Error).message);
  }
}

/** Audit entry written by a scheduled job, where there is no request. */
export async function recordSystemAudit(input: AuditInput): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (user_email, user_role, action, entity_type, entity_id, description, metadata)
       VALUES ('system@churchconnect', 'system', $1, $2, $3, $4, $5)`,
      [
        input.action,
        input.entityType ?? null,
        input.entityId ?? null,
        input.description,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    );
  } catch (err) {
    console.error('[audit] failed to write system entry:', (err as Error).message);
  }
}
