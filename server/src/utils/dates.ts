/**
 * Calendar-date helpers.
 *
 * Everything here works on `YYYY-MM-DD` strings rather than Date objects.
 * A birthday or a service date is a calendar fact, not an instant in time;
 * keeping them as strings removes an entire class of off-by-one-day timezone
 * bugs (the DATE type parser in config/db.ts is the other half of that rule).
 */

export type IsoDate = string; // YYYY-MM-DD

export function toIsoDate(d: Date): IsoDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today(): IsoDate {
  return toIsoDate(new Date());
}

export function parseIso(date: IsoDate): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = parseIso(date);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = parseIso(from).getTime();
  const b = parseIso(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Monday of the week containing `date` (ISO weeks start Monday). */
export function startOfWeek(date: IsoDate = today()): IsoDate {
  const d = parseIso(date);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return toIsoDate(d);
}

export function startOfMonth(date: IsoDate = today()): IsoDate {
  const d = parseIso(date);
  return toIsoDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function endOfMonth(date: IsoDate = today()): IsoDate {
  const d = parseIso(date);
  return toIsoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** Age in whole years on `on` (default today). Null when dob is missing. */
export function ageOn(dob: IsoDate | null | undefined, on: IsoDate = today()): number | null {
  if (!dob) return null;
  const b = parseIso(dob);
  const t = parseIso(on);
  let age = t.getFullYear() - b.getFullYear();
  const beforeBirthday =
    t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}

/**
 * The next occurrence of a birthday on or after `from`.
 *
 * 29 February is folded onto 28 February in non-leap years, which is the
 * convention most Ghanaian churches use for celebrating in the same month.
 */
export function nextBirthday(dob: IsoDate, from: IsoDate = today()): IsoDate {
  const b = parseIso(dob);
  const f = parseIso(from);
  const month = b.getMonth();
  const day = b.getDate();

  const build = (year: number): IsoDate => {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const d = month === 1 && day === 29 && !isLeap ? 28 : day;
    return toIsoDate(new Date(year, month, d));
  };

  const thisYear = build(f.getFullYear());
  return daysBetween(from, thisYear) >= 0 ? thisYear : build(f.getFullYear() + 1);
}

/** Days until the next occurrence of a birthday. 0 means "today". */
export function daysUntilBirthday(dob: IsoDate, from: IsoDate = today()): number {
  return daysBetween(from, nextBirthday(dob, from));
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "August 15" - used in birthday cards and alert copy. */
export function formatDayMonth(date: IsoDate): string {
  const d = parseIso(date);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "August 15, 2026" */
export function formatLongDate(date: IsoDate): string {
  const d = parseIso(date);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
