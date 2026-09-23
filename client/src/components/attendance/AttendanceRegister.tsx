/**
 * The attendance register.
 *
 * Speed is the whole design brief here: an usher marking 400 people before the
 * service starts cannot afford a round trip per person. So marks are held in
 * local state and saved in one request, "Mark all present" sets the common case
 * in one click, and a search box filters the list without losing marks already
 * made.
 *
 * Unmarked members are sent as nothing at all - never as "absent". The absence
 * engine treats a missing row as "not recorded", and quietly defaulting people
 * to absent here would manufacture false pastoral alerts.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, CheckCheck, Save, Lock, Unlock, Users, RotateCcw, X, AlertTriangle,
} from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  Card, Button, Avatar, Badge, EmptyState, ErrorState, LoadingState, ConfirmDialog,
} from '@/components/ui';
import { formatDate, formatNumber } from '@/utils/format';
import type { AttendanceStatus, RegisterEntry, ServiceSummary } from '@/types';

type Marks = Record<number, AttendanceStatus>;

const STATUS_OPTIONS: { value: AttendanceStatus; label: string; active: string }[] = [
  { value: 'present', label: 'Present', active: 'bg-emerald-600 text-white border-emerald-600' },
  { value: 'absent', label: 'Absent', active: 'bg-red-600 text-white border-red-600' },
  { value: 'excused', label: 'Excused', active: 'bg-amber-500 text-white border-amber-500' },
];

export function AttendanceRegister({ serviceId }: { serviceId: number }) {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [marks, setMarks] = useState<Marks>({});
  const [search, setSearch] = useState('');
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const canRecord = can('attendance:record');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['register', serviceId],
    queryFn: () => api.get<{ service: ServiceSummary; entries: RegisterEntry[] }>(`/api/attendance/services/${serviceId}/register`),
  });

  // Marks already saved on the server, merged with unsaved local edits.
  const effective: Marks = useMemo(() => {
    const base: Marks = {};
    for (const entry of data?.entries ?? []) {
      if (entry.status) base[entry.memberId] = entry.status;
    }
    return { ...base, ...marks };
  }, [data, marks]);

  const filtered = useMemo(() => {
    const entries = data?.entries ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return entries;
    return entries.filter(
      (e) => e.fullName.toLowerCase().includes(term) || e.memberCode.toLowerCase().includes(term),
    );
  }, [data, search]);

  const counts = useMemo(() => {
    // Clearing a mark leaves the key present with an undefined value, so those
    // must be filtered out or "unmarked" would be undercounted.
    const values = Object.values(effective).filter(Boolean);
    return {
      present: values.filter((v) => v === 'present').length,
      absent: values.filter((v) => v === 'absent').length,
      excused: values.filter((v) => v === 'excused').length,
      marked: values.length,
      total: data?.entries.length ?? 0,
    };
  }, [effective, data]);

  const setMark = (memberId: number, status: AttendanceStatus) => {
    setMarks((prev) => {
      // Clicking the current status again clears it back to "not recorded".
      const next = { ...prev };
      if (effective[memberId] === status) next[memberId] = undefined as any;
      else next[memberId] = status;
      return next;
    });
    setIsDirty(true);
  };

  const markAllPresent = () => {
    const next: Marks = { ...marks };
    // Only the currently visible (filtered) members, which is what the label
    // promises when a search is active.
    for (const entry of filtered) next[entry.memberId] = 'present';
    setMarks(next);
    setIsDirty(true);
    toast.info(`${filtered.length} member(s) marked present`, 'Adjust individuals below, then save.');
  };

  const clearAll = () => {
    setMarks({});
    setIsDirty(false);
  };

  const save = useMutation({
    mutationFn: async (finalize: boolean) => {
      const payload = Object.entries(effective)
        .filter(([, status]) => Boolean(status))
        .map(([memberId, status]) => ({ memberId: Number(memberId), status }));

      if (payload.length === 0) {
        throw new ApiError(400, 'Mark at least one member before saving.', 'bad_request');
      }

      return api.post(`/api/attendance/services/${serviceId}/register`, { marks: payload, finalize });
    },
    onSuccess: (response) => {
      toast.success(response.message);
      if (response.alertsCreated > 0) {
        toast.warning(
          `${response.alertsCreated} absence alert(s) raised`,
          'Open Follow-Up > Alerts to see who needs contact.',
        );
      }
      setMarks({});
      setIsDirty(false);
      setConfirmFinalize(false);
      queryClient.invalidateQueries({ queryKey: ['register', serviceId] });
      queryClient.invalidateQueries({ queryKey: ['services'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['absence-alerts'] });
    },
    onError: (err) => {
      toast.error('Could not save the register', err instanceof ApiError ? err.message : undefined);
      setConfirmFinalize(false);
    },
  });

  const reopen = useMutation({
    mutationFn: () => api.post(`/api/attendance/services/${serviceId}/reopen`),
    onSuccess: () => {
      toast.success('Register reopened', 'You can edit the marks again.');
      queryClient.invalidateQueries({ queryKey: ['register', serviceId] });
    },
  });

  if (isLoading) return <LoadingState label="Loading the register..." />;
  if (isError || !data) {
    return (
      <Card>
        <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
      </Card>
    );
  }

  const { service } = data;
  const isLocked = service.isFinalized;

  return (
    <>
      {/* --- Service header ------------------------------------------------- */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                {service.title ?? service.serviceTypeLabel}
              </h2>
              <Badge tone={isLocked ? 'emerald' : 'amber'} icon={isLocked ? <Lock className="h-3 w-3" aria-hidden /> : undefined}>
                {isLocked ? 'Finalised' : 'In progress'}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {formatDate(service.serviceDate)} - {service.serviceTypeLabel}
              {service.departmentName ? ` - ${service.departmentName}` : ''}
              {service.groupName ? ` - ${service.groupName}` : ''}
            </p>
          </div>

          <div className="grid grid-cols-4 gap-3 text-center">
            <Tally label="Present" value={counts.present} tone="text-emerald-600 dark:text-emerald-400" />
            <Tally label="Absent" value={counts.absent} tone="text-red-600 dark:text-red-400" />
            <Tally label="Excused" value={counts.excused} tone="text-amber-600 dark:text-amber-400" />
            <Tally label="Unmarked" value={counts.total - counts.marked} tone="text-slate-400" />
          </div>
        </div>

        {isLocked && (
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 bg-emerald-50/60 px-5 py-3 dark:border-navy-800 dark:bg-emerald-900/10">
            <p className="min-w-0 flex-1 text-sm text-emerald-800 dark:text-emerald-300">
              This register is finalised and is being used for absence monitoring.
            </p>
            {canRecord && (
              <Button variant="outline" size="sm" onClick={() => reopen.mutate()} isLoading={reopen.isPending} leftIcon={<Unlock className="h-4 w-4" />}>
                Reopen for editing
              </Button>
            )}
          </div>
        )}
      </Card>

      {/* --- Toolbar --------------------------------------------------------- */}
      {canRecord && !isLocked && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a member..."
              className="cc-input pl-9"
              aria-label="Filter the register"
            />
          </div>

          <Button variant="outline" onClick={markAllPresent} leftIcon={<CheckCheck className="h-4 w-4" />}>
            Mark all present{search && ` (${filtered.length})`}
          </Button>

          {isDirty && (
            <Button variant="ghost" onClick={clearAll} leftIcon={<RotateCcw className="h-4 w-4" />}>
              Discard changes
            </Button>
          )}

          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => save.mutate(false)} isLoading={save.isPending && !confirmFinalize} leftIcon={<Save className="h-4 w-4" />}>
              Save
            </Button>
            <Button onClick={() => setConfirmFinalize(true)} leftIcon={<Lock className="h-4 w-4" />}>
              Save &amp; finalise
            </Button>
          </div>
        </div>
      )}

      {isDirty && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          You have unsaved marks. They are lost if you leave this page.
        </div>
      )}

      {/* --- Register -------------------------------------------------------- */}
      <Card>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Users className="h-6 w-6" aria-hidden />}
            title={search ? 'No member matches that search' : 'No members on this register'}
            description={
              search
                ? 'Check the spelling, or clear the search to see everyone.'
                : 'This service is scoped to a department or group that currently has no active members.'
            }
            action={search ? <Button variant="outline" onClick={() => setSearch('')} leftIcon={<X className="h-4 w-4" />}>Clear search</Button> : undefined}
          />
        ) : (
          <>
            <div className="hidden border-b border-slate-200 px-4 py-2.5 text-2xs font-semibold uppercase tracking-wider text-slate-500 dark:border-navy-800 dark:text-slate-400 sm:flex">
              <span className="flex-1">Member</span>
              <span className="w-72 text-center">Attendance</span>
            </div>

            <ul className="divide-y divide-slate-100 dark:divide-navy-800">
              {filtered.map((entry) => {
                const status = effective[entry.memberId] ?? null;
                return (
                  <li
                    key={entry.memberId}
                    className={clsx(
                      'flex flex-wrap items-center gap-3 px-4 py-2.5 transition',
                      status === 'present' && 'bg-emerald-50/40 dark:bg-emerald-900/10',
                      status === 'absent' && 'bg-red-50/40 dark:bg-red-900/10',
                      status === 'excused' && 'bg-amber-50/40 dark:bg-amber-900/10',
                    )}
                  >
                    <Avatar src={entry.photoUrl} name={entry.fullName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{entry.fullName}</p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {entry.memberCode}
                        {entry.departmentName ? ` - ${entry.departmentName}` : ''}
                      </p>
                    </div>

                    {/* Segmented control: three big targets, no dropdown. */}
                    <div
                      role="radiogroup"
                      aria-label={`Attendance for ${entry.fullName}`}
                      className="flex w-full gap-1 sm:w-72"
                    >
                      {STATUS_OPTIONS.map((option) => {
                        const isActive = status === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={isActive}
                            disabled={!canRecord || isLocked}
                            onClick={() => setMark(entry.memberId, option.value)}
                            className={clsx(
                              'h-9 flex-1 rounded-lg border text-xs font-medium transition',
                              'disabled:cursor-not-allowed disabled:opacity-60',
                              isActive
                                ? option.active
                                : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50 dark:border-navy-700 dark:bg-navy-900 dark:text-slate-400 dark:hover:bg-navy-800',
                            )}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-navy-800 dark:text-slate-400">
              {formatNumber(counts.marked)} of {formatNumber(counts.total)} members marked
              {search && ` - showing ${filtered.length} matching "${search}"`}
            </div>
          </>
        )}
      </Card>

      <ConfirmDialog
        isOpen={confirmFinalize}
        onClose={() => setConfirmFinalize(false)}
        onConfirm={() => save.mutate(true)}
        isLoading={save.isPending}
        tone="primary"
        title="Finalise this register?"
        confirmLabel="Save and finalise"
        message={
          <>
            <p>
              {formatNumber(counts.present)} present, {formatNumber(counts.absent)} absent and{' '}
              {formatNumber(counts.excused)} excused will be saved.
            </p>
            {counts.total - counts.marked > 0 && (
              <p className="mt-2">
                <strong>{formatNumber(counts.total - counts.marked)} member(s) are still unmarked.</strong> They will be
                left as &ldquo;not recorded&rdquo; rather than absent, so they will not be treated as having missed the service.
              </p>
            )}
            <p className="mt-2 text-xs">
              Finalising makes this register count towards absence monitoring and runs the absence scan straight away.
              You can reopen it afterwards if you need to correct something.
            </p>
          </>
        }
      />
    </>
  );
}

function Tally({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <p className={`tabular text-lg font-semibold ${tone}`}>{value}</p>
      <p className="text-2xs uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  );
}
