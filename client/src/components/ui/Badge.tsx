/**
 * Status badges.
 *
 * The tone is derived from the value rather than passed in at every call site,
 * so a membership status or follow-up level renders identically everywhere it
 * appears - list, profile, report, alert.
 */
import type { ReactNode } from 'react';
import clsx from 'clsx';
import { titleCase } from '@/utils/format';

type Tone = 'navy' | 'emerald' | 'amber' | 'red' | 'slate' | 'gold' | 'sky';

const TONES: Record<Tone, string> = {
  navy: 'bg-navy-50 text-navy-800 ring-navy-200 dark:bg-navy-800 dark:text-navy-100 dark:ring-navy-700',
  emerald: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800',
  red: 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800',
  slate: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-navy-800 dark:text-slate-300 dark:ring-navy-700',
  gold: 'bg-gold-50 text-gold-800 ring-gold-200 dark:bg-gold-900/30 dark:text-gold-300 dark:ring-gold-800',
  sky: 'bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-800',
};

export function Badge({
  children,
  tone = 'slate',
  className,
  icon,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

const MEMBERSHIP_TONES: Record<string, Tone> = {
  active: 'emerald',
  inactive: 'slate',
  transferred: 'sky',
  deceased: 'slate',
};

export function MembershipBadge({ status }: { status: string }) {
  return <Badge tone={MEMBERSHIP_TONES[status] ?? 'slate'}>{titleCase(status)}</Badge>;
}

const ATTENDANCE_TONES: Record<string, Tone> = {
  present: 'emerald',
  absent: 'red',
  excused: 'amber',
};

export function AttendanceBadge({ status }: { status: string | null }) {
  if (!status) return <Badge tone="slate">Not recorded</Badge>;
  return <Badge tone={ATTENDANCE_TONES[status] ?? 'slate'}>{titleCase(status)}</Badge>;
}

const FOLLOWUP_TONES: Record<string, Tone> = {
  pending: 'amber',
  contacted: 'sky',
  responded: 'emerald',
  needs_further_follow_up: 'amber',
  resolved: 'emerald',
  unable_to_reach: 'red',
};

export function FollowUpStatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={FOLLOWUP_TONES[status] ?? 'slate'}>{label ?? titleCase(status)}</Badge>;
}

/** Absence level 1/2/3 - the visual escalation is the whole point. */
export function LevelBadge({ level, showLabel = true }: { level: number; showLabel?: boolean }) {
  const tone: Tone = level >= 3 ? 'red' : level === 2 ? 'amber' : 'sky';
  const label = level >= 3 ? 'Pastoral' : level === 2 ? 'Urgent' : 'Reminder';
  return (
    <Badge tone={tone}>
      Level {level}
      {showLabel && <span className="hidden sm:inline"> - {label}</span>}
    </Badge>
  );
}
