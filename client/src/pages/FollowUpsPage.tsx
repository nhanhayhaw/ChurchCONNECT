/**
 * Follow-up case list and case detail.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PhoneCall, ChevronRight, ArrowLeft, MessageSquarePlus, Phone, Clock, CheckCircle2,
} from 'lucide-react';
import clsx from 'clsx';
import { api, buildQuery, ApiError } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  PageHeader, Card, CardHeader, Button, Select, Input, Textarea, Avatar, Badge,
  LevelBadge, FollowUpStatusBadge, DataTable, Pagination, EmptyState, ErrorState,
  TableSkeleton, LoadingState, Modal, type Column,
} from '@/components/ui';
import { formatDate, formatDateShort, formatDateTime, formatRelative, formatNumber, titleCase, todayIso, addDaysIso } from '@/utils/format';
import type { FollowUp, FollowUpNote, Paginated } from '@/types';

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'responded', label: 'Responded' },
  { value: 'needs_further_follow_up', label: 'Needs Further Follow-Up' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'unable_to_reach', label: 'Unable to Reach' },
];

const CONTACT_METHODS = [
  { value: 'phone', label: 'Phone call' },
  { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'visit', label: 'Home visit' },
  { value: 'in_person', label: 'Spoke in person' },
  { value: 'email', label: 'Email' },
  { value: 'other', label: 'Other' },
];

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export default function FollowUpsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const filters = useMemo(
    () => ({
      scope: params.get('scope') ?? 'open',
      status: params.get('status') ?? '',
      level: params.get('level') ?? '',
      page: Number(params.get('page') ?? 1),
      pageSize: Number(params.get('pageSize') ?? 20),
    }),
    [params],
  );

  const setParam = (key: string, value: string | number) => {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, String(value));
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const queryString = buildQuery(filters);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['follow-ups', queryString],
    queryFn: () => api.get<Paginated<FollowUp>>(`/api/follow-ups${queryString}`),
    placeholderData: (previous) => previous,
  });

  const summary = useQuery({
    queryKey: ['follow-up-summary'],
    queryFn: () => api.get('/api/follow-ups/summary'),
  });

  const columns: Column<FollowUp>[] = [
    {
      key: 'member',
      header: 'Member',
      render: (f) => (
        <div className="flex items-center gap-3">
          <Avatar src={f.photoUrl} name={f.memberName} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900 dark:text-slate-100">{f.memberName}</p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {f.memberCode}
              {f.departmentName ? ` - ${f.departmentName}` : ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'lastAttendance',
      header: 'Last attendance',
      hideBelow: 'lg',
      render: (f) =>
        f.lastAttendanceDate ? (
          <span className="tabular whitespace-nowrap">{formatDateShort(f.lastAttendanceDate)}</span>
        ) : (
          <span className="text-slate-400">Never</span>
        ),
    },
    { key: 'weeks', header: 'Weeks absent', className: 'tabular', hideBelow: 'md', render: (f) => f.weeksAbsent },
    { key: 'level', header: 'Level', render: (f) => <LevelBadge level={f.level} showLabel={false} /> },
    {
      key: 'assigned',
      header: 'Assigned to',
      hideBelow: 'lg',
      render: (f) => f.assignedToName ?? <span className="text-slate-400">Unassigned</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (f) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <FollowUpStatusBadge status={f.status} label={f.statusLabel} />
          {f.isOverdue && <Badge tone="red" icon={<Clock className="h-3 w-3" aria-hidden />}>Overdue</Badge>}
        </div>
      ),
    },
    {
      key: 'next',
      header: 'Next contact',
      hideBelow: 'xl',
      render: (f) =>
        f.nextFollowUpDate ? (
          <span className="tabular whitespace-nowrap">{formatDateShort(f.nextFollowUpDate)}</span>
        ) : (
          <span className="text-slate-400">-</span>
        ),
    },
    { key: 'chevron', header: '', className: 'w-px', render: () => <ChevronRight className="h-4 w-4 text-slate-300" aria-hidden /> },
  ];

  return (
    <>
      <PageHeader
        title="Follow-up management"
        description={data ? `${formatNumber(data.total)} case(s) in this view.` : 'Loading follow-up cases...'}
        actions={
          <Button variant="outline" onClick={() => navigate('/follow-ups/alerts')} leftIcon={<PhoneCall className="h-4 w-4" />}>
            Attendance alerts
          </Button>
        }
      />

      {summary.data && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <MiniStat label="Open" value={summary.data.followUps.open} onClick={() => setParam('scope', 'open')} />
          <MiniStat label="Pending" value={summary.data.followUps.pending} onClick={() => setParam('status', 'pending')} />
          <MiniStat label="Contacted" value={summary.data.followUps.contacted} onClick={() => setParam('status', 'contacted')} />
          <MiniStat label="Overdue" value={summary.data.followUps.overdue} tone="text-red-600 dark:text-red-400" onClick={() => setParam('scope', 'overdue')} />
          <MiniStat label="Resolved" value={summary.data.followUps.resolved} tone="text-emerald-600 dark:text-emerald-400" onClick={() => setParam('status', 'resolved')} />
        </div>
      )}

      <Card>
        <div className="grid gap-3 border-b border-slate-200 p-4 dark:border-navy-800 sm:grid-cols-3">
          <Select
            label="View"
            value={filters.scope}
            onChange={(e) => {
              setParam('status', '');
              setParam('scope', e.target.value);
            }}
            options={[
              { value: 'open', label: 'Open cases' },
              { value: 'overdue', label: 'Overdue only' },
              { value: 'all', label: 'All cases' },
            ]}
          />
          <Select
            label="Status"
            value={filters.status}
            onChange={(e) => setParam('status', e.target.value)}
            placeholder="Any status"
            options={STATUS_OPTIONS}
          />
          <Select
            label="Level"
            value={filters.level}
            onChange={(e) => setParam('level', e.target.value)}
            placeholder="Any level"
            options={[
              { value: '1', label: 'Level 1 - Reminder' },
              { value: '2', label: 'Level 2 - Urgent' },
              { value: '3', label: 'Level 3 - Pastoral' },
            ]}
          />
        </div>

        {isError ? (
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : (
          <div className={isFetching && !isLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            <DataTable<FollowUp>
              columns={columns}
              rows={data?.data ?? []}
              rowKey={(f) => f.id}
              isLoading={isLoading}
              loadingState={<TableSkeleton rows={6} columns={6} />}
              onRowClick={(f) => navigate(`/follow-ups/${f.id}`)}
              renderMobileCard={(f) => (
                <Link to={`/follow-ups/${f.id}`} className="block">
                  <div className="flex items-center gap-3">
                    <Avatar src={f.photoUrl} name={f.memberName} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900 dark:text-slate-100">{f.memberName}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {f.weeksAbsent} week(s) absent - {f.assignedToName ?? 'unassigned'}
                      </p>
                    </div>
                    <LevelBadge level={f.level} showLabel={false} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <FollowUpStatusBadge status={f.status} label={f.statusLabel} />
                    {f.isOverdue && <Badge tone="red">Overdue</Badge>}
                  </div>
                </Link>
              )}
              emptyState={
                <EmptyState
                  icon={<CheckCircle2 className="h-6 w-6 text-emerald-500" aria-hidden />}
                  title="No follow-up cases in this view"
                  description="Cases are opened automatically when a member crosses an absence threshold, or by hand from the alerts screen."
                  action={<Button variant="outline" onClick={() => navigate('/follow-ups/alerts')}>View attendance alerts</Button>}
                />
              }
            />

            {data && (
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                totalPages={data.totalPages}
                onPageChange={(page) => setParam('page', page)}
                onPageSizeChange={(size) => setParam('pageSize', size)}
              />
            )}
          </div>
        )}
      </Card>
    </>
  );
}

function MiniStat({
  label,
  value,
  tone = 'text-slate-900 dark:text-white',
  onClick,
}: {
  label: string;
  value: number;
  tone?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="cc-card p-3 text-left transition hover:shadow-card-hover">
      <p className="text-2xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={clsx('tabular mt-1 text-xl font-semibold', tone)}>{formatNumber(value)}</p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export function FollowUpDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [isNoteOpen, setIsNoteOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['follow-up', id],
    queryFn: () => api.get<{ followUp: FollowUp; notes: FollowUpNote[] }>(`/api/follow-ups/${id}`),
    enabled: Boolean(id),
  });

  const { data: officers } = useQuery({
    queryKey: ['followup-officers'],
    queryFn: () => api.get('/api/follow-ups/officers'),
    staleTime: 300_000,
  });

  const update = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.patch(`/api/follow-ups/${id}`, payload),
    onSuccess: (response) => {
      toast.success(response.message ?? 'Follow-up updated.');
      queryClient.invalidateQueries({ queryKey: ['follow-up', id] });
      queryClient.invalidateQueries({ queryKey: ['follow-ups'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => toast.error('Could not update the follow-up', err instanceof ApiError ? err.message : undefined),
  });

  if (isLoading) return <LoadingState label="Loading the follow-up..." />;
  if (isError || !data) {
    return (
      <Card>
        <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
      </Card>
    );
  }

  const { followUp, notes } = data;
  const canManage = can('followups:manage');

  return (
    <>
      <PageHeader
        breadcrumb={
          <nav className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400" aria-label="Breadcrumb">
            <Link to="/follow-ups" className="hover:underline">Follow-Up</Link>
            <ChevronRight className="h-3 w-3" aria-hidden />
            <span className="truncate">{followUp.memberName}</span>
          </nav>
        }
        title={`Follow-up: ${followUp.memberName}`}
        description={followUp.levelLabel}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate('/follow-ups')} leftIcon={<ArrowLeft className="h-4 w-4" />}>
              Back
            </Button>
            {canManage && (
              <Button onClick={() => setIsNoteOpen(true)} leftIcon={<MessageSquarePlus className="h-4 w-4" />}>
                Record contact
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* --- Case summary -------------------------------------------------- */}
        <Card className="lg:col-span-1">
          <div className="p-5">
            <div className="flex items-center gap-3">
              <Avatar src={followUp.photoUrl} name={followUp.memberName} size="lg" />
              <div className="min-w-0">
                <Link
                  to={`/members/${followUp.memberId}`}
                  className="block truncate font-semibold text-slate-900 hover:underline dark:text-slate-100"
                >
                  {followUp.memberName}
                </Link>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{followUp.memberCode}</p>
                {followUp.memberPhone && (
                  <a
                    href={`tel:${followUp.memberPhone.replace(/\s/g, '')}`}
                    className="mt-1 inline-flex items-center gap-1 text-xs text-navy-700 hover:underline dark:text-navy-300"
                  >
                    <Phone className="h-3 w-3" aria-hidden />
                    {followUp.memberPhone}
                  </a>
                )}
              </div>
            </div>

            <dl className="mt-5 space-y-0">
              <Row label="Level" value={<LevelBadge level={followUp.level} />} />
              <Row label="Status" value={<FollowUpStatusBadge status={followUp.status} label={followUp.statusLabel} />} />
              <Row label="Weeks absent" value={followUp.weeksAbsent} />
              <Row label="Last attendance" value={followUp.lastAttendanceDate ? formatDate(followUp.lastAttendanceDate) : 'Never recorded'} />
              <Row label="Opened" value={`${formatDateShort(followUp.createdAt)} (${followUp.source === 'auto' ? 'automatic' : 'manual'})`} />
              <Row label="Assigned to" value={followUp.assignedToName ?? 'Unassigned'} />
              <Row label="Last contact" value={followUp.lastContactAt ? formatRelative(followUp.lastContactAt) : 'No contact yet'} />
              <Row
                label="Next contact"
                value={
                  followUp.nextFollowUpDate ? (
                    <span className={followUp.isOverdue ? 'text-red-600 dark:text-red-400' : undefined}>
                      {formatDate(followUp.nextFollowUpDate)}
                      {followUp.isOverdue && ' (overdue)'}
                    </span>
                  ) : (
                    'Not scheduled'
                  )
                }
              />
              {followUp.resolvedAt && <Row label="Closed" value={formatDateTime(followUp.resolvedAt)} />}
            </dl>

            {canManage && (
              <div className="mt-5 space-y-3 border-t border-slate-100 pt-4 dark:border-navy-800">
                <Select
                  label="Status"
                  value={followUp.status}
                  onChange={(e) => update.mutate({ status: e.target.value })}
                  options={STATUS_OPTIONS}
                />
                <Select
                  label="Assigned officer"
                  value={followUp.assignedToId ? String(followUp.assignedToId) : ''}
                  onChange={(e) => update.mutate({ assignedTo: e.target.value ? Number(e.target.value) : null })}
                  placeholder="Unassigned"
                  options={(officers?.officers ?? []).map((o: any) => ({ value: o.id, label: o.fullName }))}
                />
                <Input
                  label="Next contact by"
                  type="date"
                  value={followUp.nextFollowUpDate ?? ''}
                  onChange={(e) => update.mutate({ nextFollowUpDate: e.target.value || null })}
                />
              </div>
            )}
          </div>
        </Card>

        {/* --- Notes --------------------------------------------------------- */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Contact history"
            description="Every conversation about this member, newest first."
            action={
              canManage && (
                <Button size="sm" variant="outline" onClick={() => setIsNoteOpen(true)} leftIcon={<MessageSquarePlus className="h-4 w-4" />}>
                  Add note
                </Button>
              )
            }
          />

          {notes.length === 0 ? (
            <EmptyState
              icon={<MessageSquarePlus className="h-6 w-6" aria-hidden />}
              title="No contact recorded yet"
              description="Once someone reaches out, record what was said here so the next worker knows where things stand."
              action={canManage && <Button onClick={() => setIsNoteOpen(true)}>Record the first contact</Button>}
            />
          ) : (
            <ol className="divide-y divide-slate-100 dark:divide-navy-800">
              {notes.map((note) => (
                <li key={note.id} className="p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {note.author ?? 'System'}
                    </span>
                    {note.contactMethod && <Badge tone="slate">{titleCase(note.contactMethod)}</Badge>}
                    {note.statusAtTime && <FollowUpStatusBadge status={note.statusAtTime} />}
                    <span className="ml-auto text-xs text-slate-400">{formatDateTime(note.createdAt)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{note.note}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <AddNoteDialog
        isOpen={isNoteOpen}
        onClose={() => setIsNoteOpen(false)}
        followUpId={Number(id)}
        currentStatus={followUp.status}
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2.5 last:border-b-0 dark:border-navy-800">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-sm font-medium text-slate-900 dark:text-slate-100">{value}</dd>
    </div>
  );
}

function AddNoteDialog({
  isOpen,
  onClose,
  followUpId,
  currentStatus,
}: {
  isOpen: boolean;
  onClose: () => void;
  followUpId: number;
  currentStatus: string;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [note, setNote] = useState('');
  const [contactMethod, setContactMethod] = useState('phone');
  const [newStatus, setNewStatus] = useState(currentStatus);
  const [nextDate, setNextDate] = useState(addDaysIso(todayIso(), 7));
  const [error, setError] = useState('');

  const submit = useMutation({
    mutationFn: () =>
      api.post(`/api/follow-ups/${followUpId}/notes`, {
        note: note.trim(),
        contactMethod,
        newStatus,
        nextFollowUpDate: ['resolved', 'unable_to_reach'].includes(newStatus) ? null : nextDate || null,
      }),
    onSuccess: (response) => {
      toast.success(response.message ?? 'Note saved.');
      queryClient.invalidateQueries({ queryKey: ['follow-up', String(followUpId)] });
      queryClient.invalidateQueries({ queryKey: ['follow-ups'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setNote('');
      onClose();
    },
    onError: (err) => toast.error('Could not save the note', err instanceof ApiError ? err.message : undefined),
  });

  const onSubmit = () => {
    if (note.trim().length < 3) {
      setError('Please write a short note about what happened.');
      return;
    }
    setError('');
    submit.mutate();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Record a contact"
      description="What happened when you reached out?"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submit.isPending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} isLoading={submit.isPending}>
            Save note
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Textarea
          label="What happened?"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            if (error) setError('');
          }}
          error={error}
          rows={4}
          required
          data-autofocus
          placeholder="e.g. Member was contacted and stated that he travelled for work. Expected to return next Sunday."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="How did you make contact?"
            value={contactMethod}
            onChange={(e) => setContactMethod(e.target.value)}
            options={CONTACT_METHODS}
          />
          <Select
            label="Update status to"
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value)}
            options={STATUS_OPTIONS}
          />
        </div>

        {!['resolved', 'unable_to_reach'].includes(newStatus) && (
          <Input
            label="Next contact by"
            type="date"
            value={nextDate}
            onChange={(e) => setNextDate(e.target.value)}
            hint="Leave as-is to keep this case on the radar."
          />
        )}
      </div>
    </Modal>
  );
}
