/**
 * Display formatting helpers.
 *
 * Dates arrive from the API as plain `YYYY-MM-DD` strings. They are parsed
 * into local Date objects explicitly rather than via `new Date(string)`, which
 * treats a bare date as UTC and can show yesterday's date to anyone west of
 * Greenwich.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const datePart = value.slice(0, 10);
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** "15 August 2026" */
export function formatDate(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return '-';
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "15 Aug 2026" - for table cells where width matters. */
export function formatDateShort(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return '-';
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

/** "August 15" - birthdays, where the year is meaningless. */
export function formatDayMonth(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return '-';
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** "15 Aug 2026, 14:32" - timestamps in audit logs and notes. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}, ${time}`;
}

/** "3 days ago", "in 5 days", "just now". */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  const diffMs = date.getTime() - Date.now();
  const past = diffMs < 0;
  const abs = Math.abs(diffMs);

  const minutes = Math.round(abs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return past ? `${minutes} min ago` : `in ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return past ? `${hours} hour${hours === 1 ? '' : 's'} ago` : `in ${hours} hour${hours === 1 ? '' : 's'}`;

  const days = Math.round(hours / 24);
  if (days < 30) return past ? `${days} day${days === 1 ? '' : 's'} ago` : `in ${days} day${days === 1 ? '' : 's'}`;

  const months = Math.round(days / 30);
  if (months < 12) return past ? `${months} month${months === 1 ? '' : 's'} ago` : `in ${months} month${months === 1 ? '' : 's'}`;

  const years = Math.round(months / 12);
  return past ? `${years} year${years === 1 ? '' : 's'} ago` : `in ${years} year${years === 1 ? '' : 's'}`;
}

/** "5 days remaining", "Today", "Tomorrow" - birthday cards. */
export function formatCountdown(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `${days} days remaining`;
}

/** snake_case / kebab-case -> "Title Case" */
export function titleCase(value: string | null | undefined): string {
  if (!value) return '-';
  return value.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Initials for the avatar fallback. Always at most two letters. */
export function initials(fullName: string | null | undefined): string {
  if (!fullName) return '?';
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null) return '0';
  return value.toLocaleString('en-GB');
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return '0%';
  return `${Math.round(value)}%`;
}

/** Today as YYYY-MM-DD in the browser's own timezone. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysIso(iso: string, days: number): string {
  const date = parseDate(iso) ?? new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
