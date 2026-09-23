/**
 * Absence alerts.
 *
 * This is the screen the whole absence engine exists to fill. Each row is a
 * member the system believes has quietly stopped coming - phrased as a prompt
 * to a human being, never as a conclusion about the member.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BellRing, RefreshCw, PhoneCall, Phone, ArrowRight, CheckCircle2, Info,
} from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  PageHeader, Card, CardHeader, Button, Avatar, Badge, LevelBadge, Modal,
  Textarea, Select, Input, EmptyState, ErrorState, LoadingState,
} from '@/components/ui';
import { formatDate, formatNumber, addDaysIso, todayIso } from '@/utils/format';
import type { AbsenceAlert } from '@/types';

export default function AbsenceAlertsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [startTarget, setStartTarget] = useState<AbsenceAlert | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['absence-alerts'],
    queryFn: () => api.get<{ alerts: AbsenceAlert[] }>('/api/follow-ups/alerts'),
  });

  const scan = useMutation({
    mutationFn: () => api.post('/api/follow-ups/alerts/scan'),
    onSuccess: (response) => {
      toast.success('Absence scan complete', response.message);
      queryClient.invalidateQueries({ queryKey: ['absence-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['follow-ups'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err) => toast.error('The scan could not run', err instanceof ApiError ? err.message : undefined),
  });

  const alerts = data?.alerts ?? [];
  const byLevel = {
    3: alerts.filter((a) => a.level === 3),
    2: alerts.filter((a) => a.level === 2),
    1: alerts.filter((a) => a.level === 1),
  };

  return (
    <>
      <PageHeader
        title="Attendance alerts"
        description="Members whose recent attendance suggests someone should reach out. Absence has many innocent explanations - these are prompts to make contact, not conclusions."
        actions={
          can('followups:manage') && (
            <Button
              variant="outline"
              onClick={() => scan.mutate()}
              isLoading={scan.isPending}
              leftIcon={<RefreshCw className="h-4 w-4" />}
            >
              Run absence scan
            </Button>
          )
        }
      />

      {isLoading ? (
        <LoadingState label="Checking attendance patterns..." />
      ) : isError ? (
        <Card>
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        </Card>
      ) : alerts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 className="h-6 w-6 text-emerald-500" aria-hidden />}
            title="Nobody is over an absence threshold"
            description="Every active member has attended recently enough not to raise a flag. Alerts appear here automatically as registers are finalised."
            action={
              <Button variant="outline" onClick={() => navigate('/attendance/record')}>
                Record attendance
              </Button>
            }
          />
        </Card>
      ) : (
        <div className={clsx('space-y-5', isFetching && 'opacity-70 transition-opacity')}>
          <div className="flex flex-wrap gap-3">
            <SummaryPill label="Pastoral (Level 3)" count={byLevel[3].length} tone="red" />
            <SummaryPill label="Urgent (Level 2)" count={byLevel[2].length} tone="amber" />
            <SummaryPill label="Reminder (Level 1)" count={byLevel[1].length} tone="sky" />
          </div>

          {([3, 2, 1] as const).map((level) =>
            byLevel[level].length === 0 ? null : (
              <Card key={level}>
                <CardHeader
                  title={
                    level === 3
                      ? 'Level 3 - Pastoral Follow-Up'
                      : level === 2
                        ? 'Level 2 - Urgent Follow-Up'
                        : 'Level 1 - Follow-Up Reminder'
                  }
                  description={
                    level === 3
                      ? 'Absent for around a month. A pastoral visit or call is appropriate.'
                      : level === 2
                        ? 'Three consecutive services missed. Worth a personal call this week.'
                        : 'Two consecutive services missed. A friendly check-in is enough.'
                  }
                  action={<Badge tone={level === 3 ? 'red' : level === 2 ? 'amber' : 'sky'}>{byLevel[level].length}</Badge>}
                />
                <ul className="divide-y divide-slate-100 dark:divide-navy-800">
                  {byLevel[level].map((alert) => (
                    <li key={alert.memberId} className="flex flex-wrap items-center gap-4 p-4">
                      <Avatar src={null} name={alert.fullName} size="md" />

                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/members/${alert.memberId}`}
                          className="text-sm font-semibold text-slate-900 hover:underline dark:text-slate-100"
                        >
                          {alert.fullName}
                        </Link>
                        <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
                          Absent for <strong>{alert.consecutiveMissed}</strong> consecutive service(s).{' '}
                          {alert.lastAttendanceDate
                            ? `Last attendance: ${formatDate(alert.lastAttendanceDate)}.`
                            : 'No attendance recorded yet.'}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                          <span>{alert.memberCode}</span>
                          {alert.departmentName && <span>{alert.departmentName}</span>}
                          {alert.phone && (
                            <a href={`tel:${alert.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1 hover:underline">
                              <Phone className="h-3 w-3" aria-hidden />
                              {alert.phone}
                            </a>
                          )}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <LevelBadge level={alert.level} showLabel={false} />
                        {alert.openFollowUpId ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => navigate(`/follow-ups/${alert.openFollowUpId}`)}
                            rightIcon={<ArrowRight className="h-4 w-4" />}
                          >
                            View follow-up
                          </Button>
                        ) : can('followups:manage') ? (
                          <Button size="sm" onClick={() => setStartTarget(alert)} leftIcon={<PhoneCall className="h-4 w-4" />}>
                            Start follow-up
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            ),
          )}

          <p className="flex items-start gap-2 px-1 text-xs text-slate-500 dark:text-slate-400">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            This list is recalculated every time you open it, and the thresholds can be changed in Settings. Only
            finalised, congregation-wide services of a tracked type are counted, and an excused absence resets the run.
          </p>
        </div>
      )}

      <StartFollowUpDialog alert={startTarget} onClose={() => setStartTarget(null)} />
    </>
  );
}

function SummaryPill({ label, count, tone }: { label: string; count: number; tone: 'red' | 'amber' | 'sky' }) {
  const styles = {
    red: 'border-red-200 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-300',
    amber: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-300',
    sky: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/60 dark:bg-sky-900/20 dark:text-sky-300',
  }[tone];

  return (
    <div className={clsx('flex items-center gap-3 rounded-xl border px-4 py-2.5', styles)}>
      <BellRing className="h-4 w-4" aria-hidden />
      <span className="text-sm font-medium">{label}</span>
      <span className="tabular text-lg font-semibold">{formatNumber(count)}</span>
    </div>
  );
}

/** Opens a case, optionally with the first note already written. */
function StartFollowUpDialog({ alert, onClose }: { alert: AbsenceAlert | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [assignedTo, setAssignedTo] = useState('');
  const [nextDate, setNextDate] = useState(addDaysIso(todayIso(), 3));
  const [note, setNote] = useState('');

  const { data: officers } = useQuery({
    queryKey: ['followup-officers'],
    queryFn: () => api.get('/api/follow-ups/officers'),
    enabled: alert !== null,
    staleTime: 300_000,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/api/follow-ups', {
        memberId: alert!.memberId,
        level: alert!.level,
        assignedTo: assignedTo ? Number(assignedTo) : null,
        nextFollowUpDate: nextDate || null,
        note: note || null,
      }),
    onSuccess: (response) => {
      toast.success(response.message ?? 'Follow-up started.');
      queryClient.invalidateQueries({ queryKey: ['absence-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['follow-ups'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
      navigate(`/follow-ups/${response.followUp.id}`);
    },
    onError: (err) => toast.error('Could not start the follow-up', err instanceof ApiError ? err.message : undefined),
  });

  if (!alert) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Start a follow-up for ${alert.fullName}`}
      description={`${alert.levelLabel}. Absent for ${alert.consecutiveMissed} consecutive service(s).`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} isLoading={create.isPending} leftIcon={<PhoneCall className="h-4 w-4" />}>
            Start follow-up
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 p-3.5 text-sm dark:bg-navy-950/50">
          <p className="text-slate-700 dark:text-slate-300">
            {alert.lastAttendanceDate
              ? `Last seen at church on ${formatDate(alert.lastAttendanceDate)}.`
              : 'No attendance has ever been recorded for this member.'}
          </p>
          {alert.phone && (
            <p className="mt-1 text-slate-600 dark:text-slate-400">
              Phone: <a href={`tel:${alert.phone.replace(/\s/g, '')}`} className="hover:underline">{alert.phone}</a>
            </p>
          )}
        </div>

        <Select
          label="Assign to"
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
          placeholder="Assign to me"
          options={(officers?.officers ?? []).map((o: any) => ({ value: o.id, label: `${o.fullName} (${o.roleLabel})` }))}
        />

        <Input
          label="Next contact by"
          type="date"
          value={nextDate}
          onChange={(e) => setNextDate(e.target.value)}
          hint="The case is flagged overdue if nothing is recorded by this date."
        />

        <Textarea
          label="Opening note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="e.g. Will call this evening to check on the family."
          hint="Optional. Anything the next worker to pick this up should know."
        />
      </div>
    </Modal>
  );
}
