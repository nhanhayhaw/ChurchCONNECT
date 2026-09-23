/**
 * Attendance history - every register taken, newest first.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams, useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, ClipboardList, Trash2, ChevronRight, ArrowLeft } from 'lucide-react';
import { api, buildQuery, ApiError } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  PageHeader, Card, Button, Select, Input, Badge, DataTable, Pagination,
  EmptyState, ErrorState, TableSkeleton, ConfirmDialog, type Column,
} from '@/components/ui';
import { AttendanceRegister } from '@/components/attendance/AttendanceRegister';
import { formatDateShort, formatNumber } from '@/utils/format';
import type { Paginated, ServiceSummary } from '@/types';

export default function AttendancePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<ServiceSummary | null>(null);

  const filters = useMemo(
    () => ({
      from: params.get('from') ?? '',
      to: params.get('to') ?? '',
      serviceType: params.get('serviceType') ?? '',
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
    queryKey: ['services', queryString],
    queryFn: () => api.get<Paginated<ServiceSummary>>(`/api/attendance/services${queryString}`),
    placeholderData: (previous) => previous,
  });

  const { data: meta } = useQuery({
    queryKey: ['service-types'],
    queryFn: () => api.get('/api/attendance/service-types'),
    staleTime: Infinity,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/attendance/services/${id}`),
    onSuccess: (response) => {
      toast.success(response.message ?? 'Register deleted.');
      queryClient.invalidateQueries({ queryKey: ['services'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setDeleteTarget(null);
    },
    onError: (err) => toast.error('Could not delete the register', err instanceof ApiError ? err.message : undefined),
  });

  const columns: Column<ServiceSummary>[] = [
    {
      key: 'date',
      header: 'Date',
      render: (s) => <span className="tabular whitespace-nowrap font-medium text-slate-900 dark:text-slate-100">{formatDateShort(s.serviceDate)}</span>,
    },
    {
      key: 'service',
      header: 'Service',
      render: (s) => (
        <div className="min-w-0">
          <p className="truncate">{s.title ?? s.serviceTypeLabel}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {s.serviceTypeLabel}
            {s.departmentName ? ` - ${s.departmentName}` : ''}
            {s.groupName ? ` - ${s.groupName}` : ''}
          </p>
        </div>
      ),
    },
    { key: 'present', header: 'Present', className: 'tabular', render: (s) => formatNumber(s.present) },
    { key: 'absent', header: 'Absent', className: 'tabular', hideBelow: 'md', render: (s) => formatNumber(s.absent) },
    { key: 'excused', header: 'Excused', className: 'tabular', hideBelow: 'lg', render: (s) => formatNumber(s.excused) },
    {
      key: 'rate',
      header: 'Rate',
      className: 'tabular',
      hideBelow: 'md',
      render: (s) => (s.totalRecorded > 0 ? `${s.attendanceRate}%` : <span className="text-slate-400">-</span>),
    },
    {
      key: 'status',
      header: 'Status',
      render: (s) => <Badge tone={s.isFinalized ? 'emerald' : 'amber'}>{s.isFinalized ? 'Finalised' : 'In progress'}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-px whitespace-nowrap',
      render: (s) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {can('attendance:delete') && (
            <button
              type="button"
              onClick={() => setDeleteTarget(s)}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
              aria-label={`Delete the ${s.serviceTypeLabel} register for ${s.serviceDate}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          )}
          <ChevronRight className="h-4 w-4 text-slate-300" aria-hidden />
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Attendance history"
        description={data ? `${formatNumber(data.total)} register(s) recorded.` : 'Loading registers...'}
        actions={
          can('attendance:record') && (
            <Button onClick={() => navigate('/attendance/record')} leftIcon={<CalendarCheck className="h-4 w-4" />}>
              Record attendance
            </Button>
          )
        }
      />

      <Card>
        <div className="grid gap-3 border-b border-slate-200 p-4 dark:border-navy-800 sm:grid-cols-3">
          <Input label="From" type="date" value={filters.from} onChange={(e) => setParam('from', e.target.value)} />
          <Input label="To" type="date" value={filters.to} onChange={(e) => setParam('to', e.target.value)} />
          <Select
            label="Service type"
            value={filters.serviceType}
            onChange={(e) => setParam('serviceType', e.target.value)}
            placeholder="All service types"
            options={(meta?.serviceTypes ?? []).map((t: any) => ({ value: t.value, label: t.label }))}
          />
        </div>

        {isError ? (
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : (
          <div className={isFetching && !isLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            <DataTable<ServiceSummary>
              columns={columns}
              rows={data?.data ?? []}
              rowKey={(s) => s.id}
              isLoading={isLoading}
              loadingState={<TableSkeleton rows={8} columns={6} />}
              onRowClick={(s) => navigate(`/attendance/services/${s.id}`)}
              renderMobileCard={(s) => (
                <Link to={`/attendance/services/${s.id}`} className="block">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                        {s.title ?? s.serviceTypeLabel}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{formatDateShort(s.serviceDate)}</p>
                    </div>
                    <Badge tone={s.isFinalized ? 'emerald' : 'amber'}>{s.isFinalized ? 'Finalised' : 'In progress'}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {formatNumber(s.present)} present, {formatNumber(s.absent)} absent, {formatNumber(s.excused)} excused
                  </p>
                </Link>
              )}
              emptyState={
                <EmptyState
                  icon={<ClipboardList className="h-6 w-6" aria-hidden />}
                  title="No registers found"
                  description="Nothing matches these dates. Adjust the filters, or record a new register."
                  action={
                    can('attendance:record') && (
                      <Button onClick={() => navigate('/attendance/record')}>Record attendance</Button>
                    )
                  }
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

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
        isLoading={remove.isPending}
        title="Delete this register?"
        confirmLabel="Delete register"
        message={
          <>
            <p>
              The {deleteTarget?.serviceTypeLabel} register for {deleteTarget && formatDateShort(deleteTarget.serviceDate)}{' '}
              and all <strong>{deleteTarget?.totalRecorded}</strong> attendance mark(s) on it will be permanently deleted.
            </p>
            <p className="mt-2 text-xs">
              This changes absence calculations for every member on the register. It cannot be undone.
            </p>
          </>
        }
      />
    </>
  );
}

/** Register view for one existing service. */
export function ServiceRegisterPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        breadcrumb={
          <nav className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400" aria-label="Breadcrumb">
            <Link to="/attendance" className="hover:underline">Attendance</Link>
            <ChevronRight className="h-3 w-3" aria-hidden />
            <span>Register</span>
          </nav>
        }
        title="Attendance register"
        actions={
          <Button variant="outline" onClick={() => navigate('/attendance')} leftIcon={<ArrowLeft className="h-4 w-4" />}>
            Back to history
          </Button>
        }
      />
      {id && <AttendanceRegister serviceId={Number(id)} />}
    </>
  );
}
