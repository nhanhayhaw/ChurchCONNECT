/**
 * Member register.
 *
 * Filters live in the URL, so a filtered view can be bookmarked, shared with
 * another worker, or reached from a dashboard tile - which is exactly how the
 * sidebar's "Inactive Members" entry works.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, Filter, X, UserPlus, FileSpreadsheet, FileText, Eye, Pencil, Trash2,
  ClipboardCheck, PhoneCall, Users, MoreVertical,
} from 'lucide-react';
import { api, buildQuery, downloadFile, ApiError } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useDebounced } from '@/hooks/useDebounced';
import {
  PageHeader, Card, Button, Input, Select, Avatar, MembershipBadge, Badge,
  DataTable, Pagination, EmptyState, ErrorState, TableSkeleton, ConfirmDialog,
  type Column, type SortState,
} from '@/components/ui';
import { formatDateShort, formatNumber, titleCase, todayIso } from '@/utils/format';
import type { MemberListItem, Paginated } from '@/types';

export default function MembersPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState(params.get('search') ?? '');
  const [showFilters, setShowFilters] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MemberListItem | null>(null);
  const debouncedSearch = useDebounced(searchInput, 300);

  // --- URL-driven state ---------------------------------------------------
  const filters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      status: params.get('status') ?? 'active',
      gender: params.get('gender') ?? 'all',
      departmentId: params.get('departmentId') ?? '',
      groupId: params.get('groupId') ?? '',
      page: Number(params.get('page') ?? 1),
      pageSize: Number(params.get('pageSize') ?? 20),
      sortBy: params.get('sortBy') ?? 'name',
      sortDir: (params.get('sortDir') ?? 'asc') as 'asc' | 'desc',
    }),
    [params, debouncedSearch],
  );

  const setParam = (key: string, value: string | number | undefined) => {
    const next = new URLSearchParams(params);
    if (value === undefined || value === '' || value === 'all') next.delete(key);
    else next.set(key, String(value));
    // Any filter change returns to page one; staying on page 7 of a new
    // result set is the classic way to show an empty table by accident.
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const clearFilters = () => {
    setSearchInput('');
    setParams(new URLSearchParams(), { replace: true });
  };

  const activeFilterCount = ['status', 'gender', 'departmentId', 'groupId'].filter((key) => {
    const value = params.get(key);
    return value && value !== 'all' && !(key === 'status' && value === 'active');
  }).length;

  // --- data ---------------------------------------------------------------
  const queryString = buildQuery(filters);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['members', queryString],
    queryFn: () => api.get<Paginated<MemberListItem>>(`/api/members${queryString}`),
    placeholderData: (previous) => previous, // hold the last render on refetch
  });

  const { data: options } = useQuery({
    queryKey: ['member-form-options'],
    queryFn: () => api.get('/api/members/form-options'),
    staleTime: 300_000,
  });

  const deleteMember = useMutation({
    mutationFn: (id: number) => api.delete(`/api/members/${id}`),
    onSuccess: (response) => {
      toast.success(response.message ?? 'Member removed.');
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error('Could not remove the member', err instanceof ApiError ? err.message : undefined);
    },
  });

  const exportFile = async (format: 'excel' | 'pdf') => {
    try {
      const extension = format === 'excel' ? 'xlsx' : 'pdf';
      await downloadFile(`/api/members/export/${format}${queryString}`, `members-${todayIso()}.${extension}`);
      toast.success(`Export started`, `The ${extension.toUpperCase()} file is downloading.`);
    } catch (err) {
      toast.error('Export failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  // --- columns ------------------------------------------------------------
  const columns: Column<MemberListItem>[] = [
    {
      key: 'member',
      header: 'Member',
      sortable: true,
      render: (m) => (
        <div className="flex items-center gap-3">
          <Avatar src={m.photoUrl} name={m.fullName} size="sm" />
          <div className="min-w-0">
            <Link
              to={`/members/${m.id}`}
              className="block truncate font-medium text-slate-900 hover:underline dark:text-slate-100"
              onClick={(e) => e.stopPropagation()}
            >
              {m.fullName}
            </Link>
            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{m.memberCode}</span>
          </div>
        </div>
      ),
    },
    { key: 'gender', header: 'Gender', hideBelow: 'xl', render: (m) => titleCase(m.gender) },
    {
      key: 'phone',
      header: 'Phone',
      hideBelow: 'lg',
      render: (m) =>
        m.phone ? (
          <a href={`tel:${m.phone.replace(/\s/g, '')}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
            {m.phone}
          </a>
        ) : (
          <span className="text-slate-400">-</span>
        ),
    },
    {
      key: 'department',
      header: 'Department',
      sortable: true,
      hideBelow: 'lg',
      render: (m) => m.departmentName ?? <span className="text-slate-400">Unassigned</span>,
    },
    {
      key: 'group',
      header: 'Group',
      hideBelow: 'xl',
      render: (m) => m.groupName ?? <span className="text-slate-400">-</span>,
    },
    { key: 'status', header: 'Status', sortable: true, render: (m) => <MembershipBadge status={m.membershipStatus} /> },
    {
      key: 'dateJoined',
      header: 'Joined',
      sortable: true,
      hideBelow: 'xl',
      render: (m) => <span className="tabular">{formatDateShort(m.dateJoined)}</span>,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-px whitespace-nowrap',
      render: (m) => <RowActions member={m} onDelete={() => setDeleteTarget(m)} canDelete={can('members:delete')} canEdit={can('members:update')} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Members"
        description={data ? `${formatNumber(data.total)} member record(s) matching the current view.` : 'Loading members...'}
        actions={
          <>
            {can('members:export') && (
              <>
                <Button variant="outline" size="md" onClick={() => exportFile('excel')} leftIcon={<FileSpreadsheet className="h-4 w-4" />}>
                  <span className="hidden sm:inline">Excel</span>
                </Button>
                <Button variant="outline" size="md" onClick={() => exportFile('pdf')} leftIcon={<FileText className="h-4 w-4" />}>
                  <span className="hidden sm:inline">PDF</span>
                </Button>
              </>
            )}
            {can('members:create') && (
              <Button onClick={() => navigate('/members/new')} leftIcon={<UserPlus className="h-4 w-4" />}>
                Add member
              </Button>
            )}
          </>
        }
      />

      <Card>
        {/* One filter row above everything it scopes. */}
        <div className="border-b border-slate-200 p-4 dark:border-navy-800">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  setParam('search', e.target.value);
                }}
                placeholder="Search by name, Member ID, phone or email"
                className="cc-input pl-9"
                aria-label="Search members"
              />
            </div>

            <Button
              variant="outline"
              onClick={() => setShowFilters((v) => !v)}
              leftIcon={<Filter className="h-4 w-4" />}
              aria-expanded={showFilters}
            >
              Filters
              {activeFilterCount > 0 && (
                <Badge tone="navy" className="ml-1">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>

            {(activeFilterCount > 0 || searchInput) && (
              <Button variant="ghost" onClick={clearFilters} leftIcon={<X className="h-4 w-4" />}>
                Clear
              </Button>
            )}
          </div>

          {showFilters && (
            <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 dark:border-navy-800 sm:grid-cols-2 lg:grid-cols-4">
              <Select
                label="Status"
                value={filters.status}
                onChange={(e) => setParam('status', e.target.value)}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Inactive' },
                  { value: 'transferred', label: 'Transferred' },
                  { value: 'all', label: 'All statuses' },
                ]}
              />
              <Select
                label="Gender"
                value={filters.gender}
                onChange={(e) => setParam('gender', e.target.value)}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'male', label: 'Male' },
                  { value: 'female', label: 'Female' },
                ]}
              />
              <Select
                label="Department"
                value={filters.departmentId}
                onChange={(e) => setParam('departmentId', e.target.value)}
                placeholder="All departments"
                options={(options?.departments ?? []).map((d: any) => ({ value: d.id, label: d.name }))}
              />
              <Select
                label="Group"
                value={filters.groupId}
                onChange={(e) => setParam('groupId', e.target.value)}
                placeholder="All groups"
                options={(options?.groups ?? []).map((g: any) => ({ value: g.id, label: g.name }))}
              />
            </div>
          )}
        </div>

        {isError ? (
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : (
          <div className={isFetching && !isLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            <DataTable<MemberListItem>
              columns={columns}
              rows={data?.data ?? []}
              rowKey={(m) => m.id}
              isLoading={isLoading}
              loadingState={<TableSkeleton rows={8} columns={6} />}
              // The API calls it "name"; the column is keyed "member". Map so the
              // sort arrow lands on the right header.
              sort={{ by: filters.sortBy === 'name' ? 'member' : filters.sortBy, dir: filters.sortDir }}
              onSortChange={(next: SortState) => {
                setParam('sortBy', next.by === 'member' ? 'name' : next.by);
                setParam('sortDir', next.dir);
              }}
              onRowClick={(m) => navigate(`/members/${m.id}`)}
              renderMobileCard={(m) => (
                <Link to={`/members/${m.id}`} className="flex items-center gap-3">
                  <Avatar src={m.photoUrl} name={m.fullName} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900 dark:text-slate-100">{m.fullName}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {m.memberCode}
                      {m.departmentName ? ` - ${m.departmentName}` : ''}
                    </p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">{m.phone ?? 'No phone number'}</p>
                  </div>
                  <MembershipBadge status={m.membershipStatus} />
                </Link>
              )}
              emptyState={
                <EmptyState
                  icon={<Users className="h-6 w-6" aria-hidden />}
                  title={searchInput || activeFilterCount > 0 ? 'No members match this view' : 'No members yet'}
                  description={
                    searchInput || activeFilterCount > 0
                      ? 'Try a different spelling, or clear the filters to see everyone.'
                      : 'Register your first member to begin building the church register.'
                  }
                  action={
                    searchInput || activeFilterCount > 0 ? (
                      <Button variant="outline" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    ) : can('members:create') ? (
                      <Button onClick={() => navigate('/members/new')} leftIcon={<UserPlus className="h-4 w-4" />}>
                        Add the first member
                      </Button>
                    ) : undefined
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
        onConfirm={() => deleteTarget && deleteMember.mutate(deleteTarget.id)}
        isLoading={deleteMember.isPending}
        title="Remove this member?"
        confirmLabel="Remove member"
        message={
          <>
            <p>
              <strong>{deleteTarget?.fullName}</strong> ({deleteTarget?.memberCode}) will be removed from the active
              register and will no longer appear in lists, reports or attendance sheets.
            </p>
            <p className="mt-2 text-xs">
              Their attendance history and any follow-up records are kept, and a Super Administrator can restore the
              record later. Any open follow-up will be closed.
            </p>
          </>
        }
      />
    </>
  );
}

/** Row action menu - kept out of the main component to keep it readable. */
function RowActions({
  member,
  onDelete,
  canEdit,
  canDelete,
}: {
  member: MemberListItem;
  onDelete: () => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      <Link
        to={`/members/${member.id}`}
        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-navy-700 dark:hover:bg-navy-800"
        aria-label={`View ${member.fullName}`}
        title="View profile"
      >
        <Eye className="h-4 w-4" aria-hidden />
      </Link>

      {canEdit && (
        <Link
          to={`/members/${member.id}/edit`}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-navy-700 dark:hover:bg-navy-800"
          aria-label={`Edit ${member.fullName}`}
          title="Edit"
        >
          <Pencil className="h-4 w-4" aria-hidden />
        </Link>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 dark:hover:bg-navy-800"
        aria-label={`More actions for ${member.fullName}`}
        aria-expanded={isOpen}
      >
        <MoreVertical className="h-4 w-4" aria-hidden />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} aria-hidden />
          <div className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-panel dark:border-navy-700 dark:bg-navy-900">
            <Link
              to={`/members/${member.id}?tab=attendance`}
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-navy-800"
            >
              <ClipboardCheck className="h-4 w-4" aria-hidden /> View attendance
            </Link>
            <Link
              to={`/members/${member.id}?tab=followup`}
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-navy-800"
            >
              <PhoneCall className="h-4 w-4" aria-hidden /> Follow-up history
            </Link>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                window.open(`/members/${member.id}?print=1`, '_blank');
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-navy-800"
            >
              <FileText className="h-4 w-4" aria-hidden /> Print profile
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onDelete();
                }}
                className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:border-navy-800 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <Trash2 className="h-4 w-4" aria-hidden /> Remove member
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
