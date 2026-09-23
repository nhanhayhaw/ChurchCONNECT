/**
 * Dashboard - the landing page after sign-in.
 *
 * Ordered by pastoral urgency rather than by data availability: who needs
 * attention first (follow-ups), then how the congregation is doing
 * (membership, attendance), then what is coming up (birthdays).
 */
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Users, UserCheck, UserX, UserPlus, CalendarCheck, Percent, AlertTriangle,
  PhoneCall, Cake, ArrowRight, ClipboardList, CircleAlert,
} from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { PageHeader, StatCard, Card, CardHeader, CardSkeleton } from '@/components/ui';
import { Button, Badge, Avatar, EmptyState, ErrorState } from '@/components/ui';
import {
  AttendanceTrendChart, MembershipGrowthChart, GenderDonutChart,
  DepartmentDistributionChart, AttendanceComparisonChart, AgeDistributionChart,
} from '@/components/charts';
import { formatNumber, formatDateShort, formatCountdown, titleCase } from '@/utils/format';
import type { DashboardData } from '@/types';

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/api/dashboard'),
    staleTime: 60_000,
  });

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  if (isError) {
    return (
      <Card>
        <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
      </Card>
    );
  }

  return (
    <div className={isFetching && !isLoading ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
      <PageHeader
        title={`${greeting}, ${user?.fullName.split(' ')[0] ?? 'friend'}`}
        description={
          data
            ? `Here is where the church stands today, ${formatDateShort(data.generatedAt)}.`
            : 'Loading the latest figures...'
        }
        actions={
          <>
            <Button variant="outline" onClick={() => navigate('/attendance/record')} leftIcon={<CalendarCheck className="h-4 w-4" />}>
              Record attendance
            </Button>
            <Button onClick={() => navigate('/members/new')} leftIcon={<UserPlus className="h-4 w-4" />}>
              Add member
            </Button>
          </>
        }
      />

      {/* --- Attention first ------------------------------------------------ */}
      {data && (data.absence.totalFlagged > 0 || data.followUps.overdue > 0) && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/60 dark:bg-amber-900/20">
          <div className="flex flex-wrap items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
              <AlertTriangle className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Needs your attention</p>
              <p className="mt-0.5 text-sm text-amber-800 dark:text-amber-300">
                {data.absence.totalFlagged > 0 && (
                  <>
                    <strong>{data.absence.totalFlagged}</strong> member(s) are over an absence threshold
                    {data.absence.absentOneMonth > 0 && (
                      <>, including <strong>{data.absence.absentOneMonth}</strong> absent for about a month</>
                    )}
                    .{' '}
                  </>
                )}
                {data.followUps.overdue > 0 && (
                  <>
                    <strong>{data.followUps.overdue}</strong> follow-up(s) are overdue.
                  </>
                )}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => navigate('/follow-ups/alerts')} rightIcon={<ArrowRight className="h-4 w-4" />}>
              Review alerts
            </Button>
          </div>
        </div>
      )}

      {/* --- Membership ----------------------------------------------------- */}
      <section className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Membership
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {isLoading ? (
            <CardSkeleton count={6} />
          ) : (
            <>
              <StatCard label="Total members" value={formatNumber(data!.membership.total)} icon={<Users className="h-5 w-5" />} tone="navy" onClick={() => navigate('/members?status=all')} />
              <StatCard label="Active" value={formatNumber(data!.membership.active)} icon={<UserCheck className="h-5 w-5" />} tone="emerald" onClick={() => navigate('/members?status=active')} />
              <StatCard label="Inactive" value={formatNumber(data!.membership.inactive)} icon={<UserX className="h-5 w-5" />} tone="slate" onClick={() => navigate('/members?status=inactive')} />
              <StatCard label="New this month" value={formatNumber(data!.membership.newThisMonth)} icon={<UserPlus className="h-5 w-5" />} tone="gold" hint={`${formatNumber(data!.membership.newLast90Days)} in 90 days`} />
              <StatCard label="Male" value={formatNumber(data!.membership.male)} tone="navy" />
              <StatCard label="Female" value={formatNumber(data!.membership.female)} tone="navy" />
            </>
          )}
        </div>
      </section>

      {/* --- Attendance ----------------------------------------------------- */}
      <section className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Attendance
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {isLoading ? (
            <CardSkeleton count={4} />
          ) : (
            <>
              <StatCard label="Today" value={formatNumber(data!.attendance.today.present)} icon={<CalendarCheck className="h-5 w-5" />} tone="navy" hint={`${data!.attendance.today.recorded} recorded`} />
              <StatCard label="This week" value={formatNumber(data!.attendance.thisWeek.present)} tone="navy" hint={`${data!.attendance.thisWeek.recorded} recorded`} />
              <StatCard label="This month" value={formatNumber(data!.attendance.thisMonth.present)} tone="navy" hint={`${data!.attendance.thisMonth.recorded} recorded`} />
              <StatCard label="Attendance rate" value={`${data!.attendance.thisMonth.rate}%`} icon={<Percent className="h-5 w-5" />} tone={data!.attendance.thisMonth.rate >= 70 ? 'emerald' : data!.attendance.thisMonth.rate >= 50 ? 'amber' : 'red'} hint="This month" />
            </>
          )}
        </div>
      </section>

      {/* --- Follow-up ------------------------------------------------------ */}
      <section className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Follow-up
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {isLoading ? (
            <CardSkeleton count={6} />
          ) : (
            <>
              <StatCard label="Absent 2 weeks" value={formatNumber(data!.absence.absentTwoWeeks)} tone="amber" icon={<CircleAlert className="h-5 w-5" />} onClick={() => navigate('/follow-ups/alerts')} />
              <StatCard label="Absent 3 weeks" value={formatNumber(data!.absence.absentThreeWeeks)} tone="amber" onClick={() => navigate('/follow-ups/alerts')} />
              <StatCard label="Absent 1 month" value={formatNumber(data!.absence.absentOneMonth)} tone="red" onClick={() => navigate('/follow-ups/alerts')} />
              <StatCard label="Pending follow-ups" value={formatNumber(data!.followUps.pending)} tone="amber" icon={<PhoneCall className="h-5 w-5" />} onClick={() => navigate('/follow-ups?status=pending')} />
              <StatCard label="Overdue" value={formatNumber(data!.followUps.overdue)} tone="red" onClick={() => navigate('/follow-ups?scope=overdue')} />
              <StatCard label="Resolved" value={formatNumber(data!.followUps.resolved)} tone="emerald" onClick={() => navigate('/follow-ups?status=resolved')} />
            </>
          )}
        </div>
      </section>

      {/* --- Birthdays ------------------------------------------------------ */}
      <section className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Birthdays
        </h2>
        <div className="grid gap-4 lg:grid-cols-4">
          {isLoading ? (
            <CardSkeleton count={3} />
          ) : (
            <>
              <StatCard label="Today" value={formatNumber(data!.birthdays.today)} icon={<Cake className="h-5 w-5" />} tone="gold" onClick={() => navigate('/birthdays?range=today')} />
              <StatCard label="This week" value={formatNumber(data!.birthdays.thisWeek)} tone="gold" onClick={() => navigate('/birthdays?range=week')} />
              <StatCard label="This month" value={formatNumber(data!.birthdays.thisMonth)} tone="gold" onClick={() => navigate('/birthdays?range=month')} />

              <Card className="lg:col-span-1">
                <div className="flex h-full flex-col justify-center p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Coming up
                  </p>
                  {data!.birthdays.upcoming.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                      No birthdays in the next fortnight.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {data!.birthdays.upcoming.slice(0, 3).map((b) => (
                        <li key={b.memberId}>
                          <Link to={`/members/${b.memberId}`} className="flex items-center gap-2 group">
                            <Avatar src={b.photoUrl} name={b.fullName} size="xs" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium text-slate-800 group-hover:underline dark:text-slate-200">
                                {b.fullName}
                              </span>
                              <span className="block text-2xs text-slate-500 dark:text-slate-400">
                                {b.birthdayLabel} - {formatCountdown(b.daysAway)}
                              </span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link
                    to="/birthdays"
                    className="mt-3 text-xs font-medium text-navy-700 hover:underline dark:text-navy-300"
                  >
                    View all birthdays
                  </Link>
                </div>
              </Card>
            </>
          )}
        </div>
      </section>

      {/* --- Charts --------------------------------------------------------- */}
      {data && (
        <section className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Trends
          </h2>

          <AttendanceTrendChart data={data.charts.attendanceTrend} />

          <div className="grid gap-4 xl:grid-cols-2">
            <MembershipGrowthChart data={data.charts.membershipGrowth} />
            <GenderDonutChart data={data.charts.genderDistribution} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <DepartmentDistributionChart data={data.charts.departmentDistribution} />
            <div className="space-y-4">
              <AttendanceComparisonChart data={data.charts.attendanceComparison} />
              <AgeDistributionChart data={data.charts.ageDistribution} />
            </div>
          </div>
        </section>
      )}

      {/* --- Recent registers ------------------------------------------------ */}
      {data && (
        <section className="mt-6">
          <Card>
            <CardHeader
              title="Recent services"
              description="The last five registers taken"
              action={
                <Link to="/attendance" className="text-xs font-medium text-navy-700 hover:underline dark:text-navy-300">
                  View all
                </Link>
              }
            />
            {data.recentServices.length === 0 ? (
              <EmptyState
                icon={<ClipboardList className="h-6 w-6" aria-hidden />}
                title="No attendance recorded yet"
                description="Open Record Attendance to take your first register."
                action={<Button onClick={() => navigate('/attendance/record')}>Record attendance</Button>}
              />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-navy-800">
                {data.recentServices.map((service) => (
                  <li key={service.id}>
                    <Link
                      to={`/attendance/services/${service.id}`}
                      className="flex flex-wrap items-center gap-3 px-5 py-3 transition hover:bg-slate-50 dark:hover:bg-navy-800/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {service.title ?? titleCase(service.serviceType)}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {formatDateShort(service.serviceDate)}
                        </p>
                      </div>
                      <span className="tabular text-sm text-slate-600 dark:text-slate-300">
                        {formatNumber(service.present)}
                        <span className="text-slate-400"> / {formatNumber(service.recorded)} present</span>
                      </span>
                      <Badge tone={service.isFinalized ? 'emerald' : 'amber'}>
                        {service.isFinalized ? 'Finalised' : 'In progress'}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}
    </div>
  );
}
