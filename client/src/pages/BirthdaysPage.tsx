/**
 * Birthday management.
 *
 * Cards rather than a table: this is the one screen where the point is to
 * recognise a face and pick up the phone, not to scan a column of dates.
 */
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Cake, Phone, Gift, CalendarHeart } from 'lucide-react';
import clsx from 'clsx';
import { api } from '@/api/client';
import {
  PageHeader, Card, CardHeader, Avatar, Badge, Button, EmptyState, ErrorState,
  LoadingState, Skeleton,
} from '@/components/ui';
import { formatDayMonth, formatCountdown, formatNumber } from '@/utils/format';
import type { Birthday } from '@/types';

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'upcoming', label: 'Next 30 days' },
] as const;

export default function BirthdaysPage() {
  const [params, setParams] = useSearchParams();
  const range = (params.get('range') ?? 'month') as (typeof RANGES)[number]['value'];

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['birthdays', range],
    queryFn: () => api.get<{ birthdays: Birthday[]; count: number }>(`/api/birthdays?range=${range}`),
  });

  const summary = useQuery({
    queryKey: ['birthday-summary'],
    queryFn: () => api.get('/api/birthdays/summary'),
  });

  const setRange = (next: string) => {
    const params = new URLSearchParams();
    params.set('range', next);
    setParams(params, { replace: true });
  };

  const birthdays = data?.birthdays ?? [];
  const todayList = birthdays.filter((b) => b.isToday);
  const upcomingList = birthdays.filter((b) => !b.isToday);

  return (
    <>
      <PageHeader
        title="Birthdays"
        description="Who to celebrate, and when. Reminders are generated automatically each morning."
      />

      {/* Summary tiles double as the range filter. */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {summary.isLoading ? (
          <>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="cc-card p-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-3 h-7 w-12" />
              </div>
            ))}
          </>
        ) : (
          RANGES.map((option) => {
            const value =
              option.value === 'today'
                ? summary.data?.today
                : option.value === 'week'
                  ? summary.data?.thisWeek
                  : option.value === 'month'
                    ? summary.data?.thisMonth
                    : data?.count;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setRange(option.value)}
                aria-pressed={range === option.value}
                className={clsx(
                  'cc-card p-4 text-left transition',
                  range === option.value
                    ? 'border-gold-400 ring-1 ring-gold-400 dark:border-gold-600 dark:ring-gold-600'
                    : 'hover:shadow-card-hover',
                )}
              >
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {option.label}
                </p>
                <p className="tabular mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
                  {value != null ? formatNumber(value) : '-'}
                </p>
              </button>
            );
          })
        )}
      </div>

      {isLoading ? (
        <LoadingState label="Looking up birthdays..." />
      ) : isError ? (
        <Card>
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        </Card>
      ) : birthdays.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Cake className="h-6 w-6" aria-hidden />}
            title="No birthdays in this period"
            description="Try a wider range, or add dates of birth to member records so they appear here."
            action={
              range !== 'upcoming' && (
                <Button variant="outline" onClick={() => setRange('upcoming')}>
                  Show the next 30 days
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {todayList.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Gift className="h-4 w-4 text-gold-600" aria-hidden />
                Celebrating today
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {todayList.map((b) => (
                  <BirthdayCard key={b.memberId} birthday={b} highlight />
                ))}
              </div>
            </section>
          )}

          {upcomingList.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <CalendarHeart className="h-4 w-4 text-slate-400" aria-hidden />
                Coming up
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {upcomingList.map((b) => (
                  <BirthdayCard key={b.memberId} birthday={b} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}

function BirthdayCard({ birthday, highlight = false }: { birthday: Birthday; highlight?: boolean }) {
  return (
    <article
      className={clsx(
        'cc-card p-4 transition hover:shadow-card-hover',
        highlight && 'border-gold-300 bg-gold-50/40 dark:border-gold-700/60 dark:bg-gold-900/10',
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar src={birthday.photoUrl} name={birthday.fullName} size="lg" />
        <div className="min-w-0 flex-1">
          <Link
            to={`/members/${birthday.memberId}`}
            className="block truncate font-semibold text-slate-900 hover:underline dark:text-slate-100"
          >
            {birthday.fullName}
          </Link>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400">
            <Cake className="h-3.5 w-3.5 text-gold-600" aria-hidden />
            {formatDayMonth(birthday.dateOfBirth)}
          </p>
          <p className="mt-1">
            <Badge tone={birthday.isToday ? 'gold' : 'slate'}>{formatCountdown(birthday.daysAway)}</Badge>
          </p>
        </div>
      </div>

      <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs dark:border-navy-800">
        {birthday.turningAge != null && (
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500 dark:text-slate-400">{birthday.isToday ? 'Turns' : 'Turning'}</dt>
            <dd className="font-medium text-slate-800 dark:text-slate-200">{birthday.turningAge}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500 dark:text-slate-400">Department</dt>
          <dd className="truncate font-medium text-slate-800 dark:text-slate-200">
            {birthday.departmentName ?? 'Unassigned'}
          </dd>
        </div>
        {birthday.phone && (
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500 dark:text-slate-400">Phone</dt>
            <dd>
              <a
                href={`tel:${birthday.phone.replace(/\s/g, '')}`}
                className="inline-flex items-center gap-1 font-medium text-navy-700 hover:underline dark:text-navy-300"
              >
                <Phone className="h-3 w-3" aria-hidden />
                {birthday.phone}
              </a>
            </dd>
          </div>
        )}
      </dl>
    </article>
  );
}
