/**
 * Audit log viewer.
 *
 * Read-only by design. There is no endpoint anywhere in the application that
 * edits or deletes an audit entry.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ScrollText, Search, Monitor } from 'lucide-react';
import { api, buildQuery } from '@/api/client';
import { useDebounced } from '@/hooks/useDebounced';
import {
  PageHeader, Card, Input, Select, Badge, Pagination, EmptyState, ErrorState, TableSkeleton,
} from '@/components/ui';
import { formatDateTime, formatNumber, titleCase } from '@/utils/format';
import type { AuditEntry, Paginated } from '@/types';

/** Colour by what the action does, not by which module it came from. */
function actionTone(action: string): 'emerald' | 'amber' | 'red' | 'slate' | 'navy' {
  if (action.includes('delete')) return 'red';
  if (action.includes('create') || action.includes('login') && !action.includes('failed')) return 'emerald';
  if (action.includes('failed')) return 'red';
  if (action.includes('update') || action.includes('role_change')) return 'amber';
  if (action.startsWith('job.')) return 'slate';
  return 'navy';
}

export default function AuditLogsPage() {
  const [params, setParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(params.get('search') ?? '');
  const search = useDebounced(searchInput, 300);

  const filters = useMemo(
    () => ({
      search: search || undefined,
      action: params.get('action') ?? '',
      userId: params.get('userId') ?? '',
      from: params.get('from') ?? '',
      to: params.get('to') ?? '',
      page: Number(params.get('page') ?? 1),
      pageSize: Number(params.get('pageSize') ?? 30),
    }),
    [params, search],
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
    queryKey: ['audit-logs', queryString],
    queryFn: () => api.get<Paginated<AuditEntry>>(`/api/audit-logs${queryString}`),
    placeholderData: (previous) => previous,
  });

  const { data: filterOptions } = useQuery({
    queryKey: ['audit-filters'],
    queryFn: () => api.get('/api/audit-logs/filters'),
    staleTime: 300_000,
  });

  return (
    <>
      <PageHeader
        title="Audit logs"
        description={
          data
            ? `${formatNumber(data.total)} recorded action(s). Entries are permanent and cannot be edited or deleted.`
            : 'Loading the audit trail...'
        }
      />

      <Card>
        <div className="grid gap-3 border-b border-slate-200 p-4 dark:border-navy-800 lg:grid-cols-5">
          <div className="relative lg:col-span-2">
            <label htmlFor="audit-search" className="cc-label">Search</label>
            <Search className="pointer-events-none absolute left-3 top-[2.15rem] h-4 w-4 text-slate-400" aria-hidden />
            <input
              id="audit-search"
              type="search"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setParam('search', e.target.value);
              }}
              placeholder="Description or user email"
              className="cc-input pl-9"
            />
          </div>
          <Select
            label="Action"
            value={filters.action}
            onChange={(e) => setParam('action', e.target.value)}
            placeholder="All actions"
            options={(filterOptions?.actions ?? []).map((a: string) => ({ value: a, label: a }))}
          />
          <Input label="From" type="date" value={filters.from} onChange={(e) => setParam('from', e.target.value)} />
          <Input label="To" type="date" value={filters.to} onChange={(e) => setParam('to', e.target.value)} />
        </div>

        {isError ? (
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : isLoading ? (
          <TableSkeleton rows={10} columns={5} />
        ) : (data?.data.length ?? 0) === 0 ? (
          <EmptyState
            icon={<ScrollText className="h-6 w-6" aria-hidden />}
            title="No matching entries"
            description="Adjust the filters, or widen the date range."
          />
        ) : (
          <div className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            <div className="overflow-x-auto">
              <table className="cc-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Action</th>
                    <th>What happened</th>
                    <th className="hidden xl:table-cell">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.data.map((entry) => (
                    <tr key={entry.id}>
                      <td className="tabular whitespace-nowrap text-xs">{formatDateTime(entry.createdAt)}</td>
                      <td>
                        <p className="truncate font-medium text-slate-900 dark:text-slate-100">{entry.userName}</p>
                        {entry.userRole && (
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                            {titleCase(entry.userRole)}
                          </p>
                        )}
                      </td>
                      <td>
                        <Badge tone={actionTone(entry.action)}>{entry.action}</Badge>
                      </td>
                      <td className="max-w-md">
                        <p className="text-slate-700 dark:text-slate-300">{entry.description}</p>
                        {entry.entityType && (
                          <p className="mt-0.5 text-xs text-slate-400">
                            {entry.entityType}
                            {entry.entityId ? ` #${entry.entityId}` : ''}
                          </p>
                        )}
                      </td>
                      <td className="hidden xl:table-cell">
                        {entry.ipAddress ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                            <Monitor className="h-3.5 w-3.5" aria-hidden />
                            {entry.ipAddress}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">system</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={data!.page}
              pageSize={data!.pageSize}
              total={data!.total}
              totalPages={data!.totalPages}
              onPageChange={(page) => setParam('page', page)}
              onPageSizeChange={(size) => setParam('pageSize', size)}
            />
          </div>
        )}
      </Card>
    </>
  );
}
