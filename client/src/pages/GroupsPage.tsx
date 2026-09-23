/**
 * Cell groups, prayer groups, Bible study groups, zones and fellowships.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Boxes, Plus, Pencil, Trash2, Users, ChevronRight, ArrowLeft, MapPin, UserCog, CalendarClock,
} from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  PageHeader, Card, CardHeader, Button, Input, Textarea, Select, Checkbox, Avatar,
  Badge, MembershipBadge, Modal, ConfirmDialog, EmptyState, ErrorState, LoadingState,
} from '@/components/ui';
import { formatNumber, titleCase } from '@/utils/format';
import type { Group } from '@/types';

export default function GroupsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [editing, setEditing] = useState<Group | null | 'new'>(null);
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null);
  const [typeFilter, setTypeFilter] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['groups'],
    queryFn: () => api.get<{ groups: Group[] }>('/api/groups'),
  });

  const { data: types } = useQuery({
    queryKey: ['group-types'],
    queryFn: () => api.get('/api/groups/types'),
    staleTime: Infinity,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/groups/${id}`),
    onSuccess: (response) => {
      toast.success(response.message ?? 'Group deleted.');
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error('Could not delete the group', err instanceof ApiError ? err.message : undefined);
      setDeleteTarget(null);
    },
  });

  const groups = (data?.groups ?? []).filter((g) => !typeFilter || g.groupType === typeFilter);

  return (
    <>
      <PageHeader
        title="Groups &amp; cells"
        description="Small groups are where members are actually known. Every member belongs to at most one."
        actions={
          can('groups:manage') && (
            <Button onClick={() => setEditing('new')} leftIcon={<Plus className="h-4 w-4" />}>
              New group
            </Button>
          )
        }
      />

      <div className="mb-5 max-w-xs">
        <Select
          label="Filter by type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          placeholder="All group types"
          options={(types?.types ?? []).map((t: any) => ({ value: t.value, label: t.label }))}
        />
      </div>

      {isLoading ? (
        <LoadingState label="Loading groups..." />
      ) : isError ? (
        <Card>
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Boxes className="h-6 w-6" aria-hidden />}
            title={typeFilter ? 'No groups of that type' : 'No groups yet'}
            description="Create cell groups, prayer groups, zones or fellowships so members can be shepherded in smaller circles."
            action={can('groups:manage') && <Button onClick={() => setEditing('new')}>Create the first group</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <article key={group.id} className="cc-card flex flex-col p-5 transition hover:shadow-card-hover">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    to={`/groups/${group.id}`}
                    className="block truncate text-base font-semibold text-slate-900 hover:underline dark:text-slate-100"
                  >
                    {group.name}
                  </Link>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone="navy">{group.groupTypeLabel}</Badge>
                    {!group.isActive && <Badge tone="slate">Inactive</Badge>}
                  </div>
                </div>
                <span className="tabular flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gold-50 text-sm font-semibold text-gold-700 dark:bg-gold-900/30 dark:text-gold-300">
                  {group.memberCount}
                </span>
              </div>

              {group.description && (
                <p className="mt-2 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{group.description}</p>
              )}

              <div className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                <p className="flex items-center gap-1.5">
                  <UserCog className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {group.leaderName ?? 'No leader assigned'}
                </p>
                {group.meetingDay && (
                  <p className="flex items-center gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {group.meetingDay}
                    {group.meetingTime ? ` at ${group.meetingTime}` : ''}
                  </p>
                )}
                {group.meetingLocation && (
                  <p className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{group.meetingLocation}</span>
                  </p>
                )}
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-navy-800">
                <Button variant="ghost" size="sm" onClick={() => navigate(`/groups/${group.id}`)} rightIcon={<ChevronRight className="h-4 w-4" />}>
                  View members
                </Button>
                {can('groups:manage') && (
                  <div className="ml-auto flex gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(group)}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-navy-700 dark:hover:bg-navy-800"
                      aria-label={`Edit ${group.name}`}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(group)}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                      aria-label={`Delete ${group.name}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {editing !== null && (
        <GroupDialog
          group={editing === 'new' ? null : editing}
          types={types?.types ?? []}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
        isLoading={remove.isPending}
        title={`Delete ${deleteTarget?.name}?`}
        confirmLabel="Delete group"
        message={
          <>
            <p>This removes the group permanently.</p>
            {(deleteTarget?.memberCount ?? 0) > 0 && (
              <p className="mt-2 font-medium">
                {deleteTarget?.memberCount} member(s) still belong to it. The system will refuse the deletion - move them
                first, or mark the group inactive instead.
              </p>
            )}
          </>
        }
      />
    </>
  );
}

function GroupDialog({ group, types, onClose }: { group: Group | null; types: any[]; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const isEdit = group !== null;

  const [form, setForm] = useState({
    name: group?.name ?? '',
    groupType: group?.groupType ?? 'cell',
    description: group?.description ?? '',
    leaderMemberId: group?.leaderMemberId ? String(group.leaderMemberId) : '',
    meetingDay: group?.meetingDay ?? '',
    meetingTime: group?.meetingTime ?? '',
    meetingLocation: group?.meetingLocation ?? '',
    isActive: group?.isActive ?? true,
  });
  const [error, setError] = useState('');

  const { data: detail } = useQuery({
    queryKey: ['group', group?.id],
    queryFn: () => api.get(`/api/groups/${group!.id}`),
    enabled: isEdit,
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        groupType: form.groupType,
        description: form.description || null,
        leaderMemberId: form.leaderMemberId ? Number(form.leaderMemberId) : null,
        meetingDay: form.meetingDay || null,
        meetingTime: form.meetingTime || null,
        meetingLocation: form.meetingLocation || null,
        isActive: form.isActive,
      };
      return isEdit ? api.put(`/api/groups/${group!.id}`, payload) : api.post('/api/groups', payload);
    },
    onSuccess: (response) => {
      toast.success(response.message ?? 'Group saved.');
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['member-form-options'] });
      onClose();
    },
    onError: (err) => toast.error('Could not save the group', err instanceof ApiError ? err.message : undefined),
  });

  const onSubmit = () => {
    if (form.name.trim().length < 2) {
      setError('Please enter a group name.');
      return;
    }
    setError('');
    save.mutate();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? `Edit ${group!.name}` : 'New group'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} isLoading={save.isPending}>
            {isEdit ? 'Save changes' : 'Create group'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Group name"
          value={form.name}
          onChange={(e) => {
            setForm((f) => ({ ...f, name: e.target.value }));
            if (error) setError('');
          }}
          error={error}
          required
          data-autofocus
          placeholder="e.g. Bethel Cell"
        />
        <Select
          label="Group type"
          value={form.groupType}
          onChange={(e) => setForm((f) => ({ ...f, groupType: e.target.value }))}
          options={types.map((t) => ({ value: t.value, label: t.label }))}
        />
        <Textarea
          label="Description"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          rows={2}
        />
        {isEdit && (
          <Select
            label="Group leader"
            value={form.leaderMemberId}
            onChange={(e) => setForm((f) => ({ ...f, leaderMemberId: e.target.value }))}
            placeholder="No leader assigned"
            options={(detail?.members ?? []).map((m: any) => ({ value: m.id, label: m.fullName }))}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Meeting day"
            value={form.meetingDay}
            onChange={(e) => setForm((f) => ({ ...f, meetingDay: e.target.value }))}
            placeholder="Not scheduled"
            options={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d) => ({ value: d, label: d }))}
          />
          <Input
            label="Meeting time"
            type="time"
            value={form.meetingTime}
            onChange={(e) => setForm((f) => ({ ...f, meetingTime: e.target.value }))}
          />
        </div>
        <Input
          label="Meeting location"
          value={form.meetingLocation}
          onChange={(e) => setForm((f) => ({ ...f, meetingLocation: e.target.value }))}
          placeholder="e.g. Adenta, House No. 12 Blk C"
        />
        <Checkbox
          label="Active"
          description="Inactive groups are hidden from the member registration form."
          checked={form.isActive}
          onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
        />
      </div>
    </Modal>
  );
}

export function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['group', id],
    queryFn: () => api.get(`/api/groups/${id}`),
    enabled: Boolean(id),
  });

  if (isLoading) return <LoadingState label="Loading group..." />;
  if (isError || !data) {
    return (
      <Card>
        <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
      </Card>
    );
  }

  const { group, members } = data;

  return (
    <>
      <PageHeader
        breadcrumb={
          <nav className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400" aria-label="Breadcrumb">
            <Link to="/groups" className="hover:underline">Groups</Link>
            <ChevronRight className="h-3 w-3" aria-hidden />
            <span>{group.name}</span>
          </nav>
        }
        title={group.name}
        description={group.description ?? group.groupTypeLabel}
        actions={
          <Button variant="outline" onClick={() => navigate('/groups')} leftIcon={<ArrowLeft className="h-4 w-4" />}>
            All groups
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <InfoBox label="Type" value={group.groupTypeLabel} />
        <InfoBox label="Members" value={formatNumber(members.length)} />
        <InfoBox label="Leader" value={group.leaderName ?? 'Not assigned'} />
        <InfoBox label="Meets" value={group.meetingDay ? `${group.meetingDay}${group.meetingTime ? ` ${group.meetingTime}` : ''}` : 'Not scheduled'} />
      </div>

      <Card>
        <CardHeader title="Group members" description={group.meetingLocation ? `Meets at ${group.meetingLocation}.` : undefined} />
        {members.length === 0 ? (
          <EmptyState
            icon={<Users className="h-6 w-6" aria-hidden />}
            title="No members in this group"
            description="Assign members to this group from their profile."
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-navy-800">
            {members.map((member: any) => (
              <li key={member.id}>
                <Link
                  to={`/members/${member.id}`}
                  className="flex items-center gap-3 px-5 py-3 transition hover:bg-slate-50 dark:hover:bg-navy-800/50"
                >
                  <Avatar src={member.photoUrl} name={member.fullName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{member.fullName}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {member.memberCode} - {titleCase(member.gender)}
                      {member.departmentName ? ` - ${member.departmentName}` : ''}
                    </p>
                  </div>
                  <MembershipBadge status={member.membershipStatus} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="cc-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 truncate text-sm font-semibold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}
