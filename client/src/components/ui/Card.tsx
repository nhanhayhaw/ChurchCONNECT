/**
 * Card, section header and the dashboard statistic tile.
 */
import type { ReactNode } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import clsx from 'clsx';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('cc-card', className)}>{children}</div>;
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-navy-800',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('p-5', className)}>{children}</div>;
}

type StatTone = 'navy' | 'gold' | 'emerald' | 'amber' | 'red' | 'slate';

const TONE_STYLES: Record<StatTone, { icon: string; value: string }> = {
  navy: { icon: 'bg-navy-50 text-navy-700 dark:bg-navy-800 dark:text-navy-200', value: 'text-slate-900 dark:text-white' },
  gold: { icon: 'bg-gold-50 text-gold-700 dark:bg-gold-900/30 dark:text-gold-300', value: 'text-slate-900 dark:text-white' },
  emerald: { icon: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', value: 'text-slate-900 dark:text-white' },
  amber: { icon: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', value: 'text-slate-900 dark:text-white' },
  red: { icon: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300', value: 'text-slate-900 dark:text-white' },
  slate: { icon: 'bg-slate-100 text-slate-600 dark:bg-navy-800 dark:text-slate-300', value: 'text-slate-900 dark:text-white' },
};

export interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  tone?: StatTone;
  hint?: string;
  /** Percentage change against the previous period, if known. */
  trend?: number | null;
  onClick?: () => void;
}

export function StatCard({ label, value, icon, tone = 'navy', hint, trend, onClick }: StatCardProps) {
  const styles = TONE_STYLES[tone];
  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={clsx(
        'cc-card w-full p-4 text-left transition',
        onClick && 'hover:shadow-card-hover hover:border-navy-300 dark:hover:border-navy-600 cursor-pointer',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p className={clsx('tabular mt-2 text-2xl font-semibold', styles.value)}>{value}</p>
          {hint && <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
        </div>
        {icon && (
          <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', styles.icon)}>
            {icon}
          </span>
        )}
      </div>

      {trend != null && (
        <div className="mt-3 flex items-center gap-1 text-xs">
          {trend > 0 ? (
            <TrendingUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          ) : trend < 0 ? (
            <TrendingDown className="h-3.5 w-3.5 text-red-600 dark:text-red-400" aria-hidden />
          ) : (
            <Minus className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          )}
          <span
            className={clsx(
              'font-medium',
              trend > 0 ? 'text-emerald-600 dark:text-emerald-400' : trend < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500',
            )}
          >
            {trend > 0 ? '+' : ''}
            {trend}%
          </span>
          <span className="text-slate-400 dark:text-slate-500">vs last period</span>
        </div>
      )}
    </Wrapper>
  );
}

/** Page title block used at the top of every screen. */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {breadcrumb && <div className="mb-2">{breadcrumb}</div>}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white sm:text-2xl">{title}</h1>
          {description && (
            <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">{description}</p>
          )}
        </div>
        {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
