/**
 * System settings access with a short-lived in-process cache.
 *
 * Settings are read on nearly every absence scan and dashboard load but change
 * a few times a year, so a 60-second cache removes almost all of that traffic
 * while still letting a Settings save take effect promptly.
 */
import { query, queryOne } from '../config/db.js';

export interface SettingRow {
  key: string;
  value: unknown;
  category: string;
  label: string;
  description: string | null;
  updated_at: string;
}

const CACHE_TTL_MS = 60_000;
let cache: Map<string, unknown> | null = null;
let cachedAt = 0;

/** Defaults used when a key has not been seeded or has been deleted. */
export const SETTING_DEFAULTS = {
  church_name: 'RT AG Connect Assembly',
  church_tagline: 'Connecting People. Strengthening the Church.',
  church_address: 'P.O. Box 1204, Accra, Ghana',
  church_phone: '+233 30 000 0000',
  church_email: 'info@churchconnect.org',
  church_logo_url: '',

  /** Days before a birthday on which reminders are generated. */
  birthday_reminder_days: [7, 3, 1, 0],
  birthday_notifications_enabled: false,

  /** Consecutive missed services that trigger each follow-up level. */
  absence_level_1_services: 2,
  absence_level_2_services: 3,
  absence_level_3_services: 4,
  /** Should an "excused" absence break the streak? Default: yes, it breaks. */
  absence_excused_counts: false,
  /** Only these service types feed the absence streak calculation. */
  absence_tracked_service_types: ['sunday_service'],
  /** Auto-open a follow-up case when an alert fires (vs. alert only). */
  absence_auto_create_followups: true,

  /** Days after which a pending follow-up is flagged overdue. */
  followup_overdue_days: 7,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

async function load(): Promise<Map<string, unknown>> {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;
  const { rows } = await query<{ key: string; value: unknown }>('SELECT key, value FROM system_settings');
  cache = new Map(rows.map((r) => [r.key, r.value]));
  cachedAt = Date.now();
  return cache;
}

export function invalidateSettingsCache(): void {
  cache = null;
}

export async function getSetting<K extends SettingKey>(key: K): Promise<(typeof SETTING_DEFAULTS)[K]> {
  const map = await load();
  const value = map.get(key);
  return (value === undefined || value === null ? SETTING_DEFAULTS[key] : value) as (typeof SETTING_DEFAULTS)[K];
}

/** All settings merged over the defaults - what the Settings page renders. */
export async function getAllSettings(): Promise<Record<string, unknown>> {
  const map = await load();
  return { ...SETTING_DEFAULTS, ...Object.fromEntries(map) };
}

export async function getSettingRows(): Promise<SettingRow[]> {
  const { rows } = await query<SettingRow>(
    `SELECT key, value, category, label, description, updated_at
       FROM system_settings ORDER BY category, label`,
  );
  return rows;
}

/** Upsert a setting. Unknown keys are rejected by the route, not here. */
export async function setSetting(key: string, value: unknown, userId: number): Promise<void> {
  await query(
    `INSERT INTO system_settings (key, value, category, label, updated_by)
     VALUES ($1, $2::jsonb, 'general', $1, $3)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [key, JSON.stringify(value), userId],
  );
  invalidateSettingsCache();
}

export async function getChurchProfile() {
  const s = await getAllSettings();
  return {
    name: String(s.church_name ?? SETTING_DEFAULTS.church_name),
    tagline: String(s.church_tagline ?? SETTING_DEFAULTS.church_tagline),
    address: String(s.church_address ?? ''),
    phone: String(s.church_phone ?? ''),
    email: String(s.church_email ?? ''),
    logoUrl: String(s.church_logo_url ?? ''),
  };
}

/** Used by the public part of the login page - no auth required. */
export async function getPublicBranding() {
  const row = await queryOne<{ value: string }>(
    `SELECT value #>> '{}' AS value FROM system_settings WHERE key = 'church_name'`,
  );
  const tagline = await queryOne<{ value: string }>(
    `SELECT value #>> '{}' AS value FROM system_settings WHERE key = 'church_tagline'`,
  );
  return {
    churchName: row?.value ?? SETTING_DEFAULTS.church_name,
    tagline: tagline?.value ?? SETTING_DEFAULTS.church_tagline,
  };
}
