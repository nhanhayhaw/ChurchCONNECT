/**
 * System settings.
 *
 * Only keys present in SETTING_DEFAULTS can be written. That allow-list is
 * what stops a malformed request from injecting arbitrary keys into the
 * settings table (and, downstream, into the absence and birthday engines).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/http.js';
import { validateBody } from '../../middleware/validate.js';
import { authenticate, requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { recordAudit } from '../../services/audit.service.js';
import { badRequest } from '../../utils/errors.js';
import {
  getAllSettings,
  getSettingRows,
  setSetting,
  SETTING_DEFAULTS,
} from '../../services/settings.service.js';
import { SERVICE_TYPES } from '../attendance/attendance.service.js';

const router = Router();
router.use(authenticate);

const ALLOWED_KEYS = new Set(Object.keys(SETTING_DEFAULTS));

/**
 * Per-key validators. A setting that drives automation (absence thresholds,
 * reminder offsets) gets a real schema rather than being accepted as-is.
 */
const VALIDATORS: Record<string, z.ZodTypeAny> = {
  church_name: z.string().trim().min(2, 'Please enter the church name.').max(160),
  church_tagline: z.string().trim().max(200),
  church_address: z.string().trim().max(400),
  church_phone: z.string().trim().max(40),
  church_email: z.string().trim().email('Please enter a valid email address.').or(z.literal('')),
  church_logo_url: z.string().trim().max(500),

  birthday_reminder_days: z
    .array(z.number().int().min(0).max(60))
    .min(1, 'Choose at least one reminder day.')
    .max(6, 'Six reminder points is the maximum.'),
  birthday_notifications_enabled: z.boolean(),

  absence_level_1_services: z.number().int().min(1).max(20),
  absence_level_2_services: z.number().int().min(1).max(30),
  absence_level_3_services: z.number().int().min(1).max(52),
  absence_excused_counts: z.boolean(),
  absence_tracked_service_types: z
    .array(z.enum(SERVICE_TYPES.map((t) => t.value) as [string, ...string[]]))
    .min(1, 'At least one service type must be tracked for absence monitoring.'),
  absence_auto_create_followups: z.boolean(),

  followup_overdue_days: z.number().int().min(1).max(90),
};

router.get(
  '/',
  requirePermission('settings:read'),
  asyncHandler(async (_req, res) => {
    const [values, rows] = await Promise.all([getAllSettings(), getSettingRows()]);
    res.json({
      settings: values,
      meta: rows,
      serviceTypes: SERVICE_TYPES,
      defaults: SETTING_DEFAULTS,
    });
  }),
);

/**
 * Patch one or more settings at once. Cross-field consistency is checked here
 * because the three absence levels only make sense in ascending order.
 */
router.patch(
  '/',
  requirePermission('settings:manage'),
  validateBody(z.record(z.string(), z.unknown())),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const updates = req.body as Record<string, unknown>;

    const keys = Object.keys(updates);
    if (keys.length === 0) throw badRequest('No settings were supplied.');

    const unknownKeys = keys.filter((k) => !ALLOWED_KEYS.has(k));
    if (unknownKeys.length > 0) throw badRequest(`Unknown setting(s): ${unknownKeys.join(', ')}.`);

    // Validate each value against its own schema.
    const cleaned: Record<string, unknown> = {};
    for (const key of keys) {
      const validator = VALIDATORS[key];
      if (!validator) {
        cleaned[key] = updates[key];
        continue;
      }
      const parsed = validator.safeParse(updates[key]);
      if (!parsed.success) {
        throw badRequest(`${key}: ${parsed.error.issues[0]?.message ?? 'invalid value'}`);
      }
      cleaned[key] = parsed.data;
    }

    // Absence levels must escalate, or the engine would classify nonsensically.
    const current = await getAllSettings();
    const l1 = Number(cleaned.absence_level_1_services ?? current.absence_level_1_services);
    const l2 = Number(cleaned.absence_level_2_services ?? current.absence_level_2_services);
    const l3 = Number(cleaned.absence_level_3_services ?? current.absence_level_3_services);
    if (!(l1 < l2 && l2 < l3)) {
      throw badRequest(
        'Absence thresholds must increase: Level 1 must be smaller than Level 2, and Level 2 smaller than Level 3.',
      );
    }

    for (const [key, value] of Object.entries(cleaned)) {
      await setSetting(key, value, auth.userId);
    }

    await recordAudit(req, {
      action: 'settings.update',
      description: `Updated system settings: ${keys.join(', ')}.`,
      entityType: 'settings',
      metadata: { keys },
    });

    res.json({ ok: true, settings: await getAllSettings(), message: 'Settings saved.' });
  }),
);

export default router;
