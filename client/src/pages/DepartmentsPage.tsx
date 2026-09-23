/**
 * Departments: list, create/edit, and the detail view with its roster.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Plus, Pencil, Trash2, Users, ChevronRight, ArrowLeft, UserCog, CalendarClock,
} from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  PageHeader, Card, CardHeader, Button, Input, Textarea, Select, Checkbox, Avatar,
  Badge, MembershipBadge, Modal, ConfirmDialog, EmptyState, ErrorState, LoadingState,
} from '@/components/ui';
import { formatNumber, titleCase } from '@/utils/format';
import type { Department } from '@/types';

export default function DepartmentsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [editing, setEditing] = useState<Department | null | 'new'>(null);
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get<{ departments: Department[] }>('/api/departments'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/departments/${id}`),
    onSuccess: (response) => {
      toast.success(response.message ?? 'Department deleted.');
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error('Could not delete the department', err instanceof ApiError ? err.message : undefined);
      setDeleteTarget(null);
    },
  });

  const departments = data?.departments ?? [];
  const totalAssigned = departments.reduce((sum, d) => sum + d.memberCount, 0);

  return (
    <>
      <PageHeader
        title="Departments"
        description={`${departments.length} department(s) with ${formatNumber(totalAssigned)} assigned member(s).`}
        actions={
          can('departments:manage') && (
            <Button onClick={() => setEditing('new')} leftIcon={<Plus className="h-4 w-4" />}>
              New department
            </Button>
          )
        }
      />

      {isLoading ? (
        <LoadingState label="Loading departments..." />
      ) : isError ? (
        <Card>
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        </Card>
      ) : departments.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-6 w-6" aria-hidden />}
            title="No departments yet"
            description="Departments group members by what they do - choir, ushering, media, and so on."
            action={can('departments:manage') && <Button onClick={() => setEditing('new')}>Create the first department</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {departments.map((department) => (
            <article key={department.id} className="cc-card flex flex-col p-5 transition hover:shadow-card-hover">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    to={`/departments/${department.id}`}
                    className="block truncate text-base font-semibold text-slate-900 hover:underline dark:text-slate-100"
                  >
                    {department.name}
                  </Link>
                  {!department.isActive && <Badge tone="slate" className="mt-1">Inactive</Badge>}
                </div>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-700 dark:bg-navy-800 dark:text-navy-200">
                  <Building2 className="h-5 w-5" aria-hidden />
                </span>
              </div>

              {department.description && (
                <p className="mt-2 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{department.description}</p>
              )}

              <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center dark:border-navy-800">
                <div>
                  <dt className="text-2xs uppercase tracking-wide text-slate-400">Members</dt>
                  <dd className="tabular mt-0.5 text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {formatNumber(department.memberCount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-2xs uppercase tracking-wide text-slate-400">Male</dt>
                  <dd className="tabular mt-0.5 text-lg font-semibold text-slate-600 dark:text-slate-300">
                    {formatNumber(department.maleCount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-2xs uppercase tracking-wide text-slate-400">Female</dt>
                  <dd className="tabular mt-0.5 text-lg font-semibold text-slate-600 dark:text-slate-300">
                    {formatNumber(department.femaleCount)}
                  </dd>
                </div>
              </dl>

              <div className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                <p className="flex items-center gap-1.5">
                  <UserCog className="h-3.5 w-3.5" aria-hidden />
                  {department.leaderName ?? 'No leader assigned'}
                </p>
                {department.meetingDay && (
                  <p className="flex items-center gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                    {department.meetingDay}
                    {department.meetingTime ? ` at ${department.meetingTime}` : ''}
                  </p>
                )}
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-navy-800">
                <Button variant="ghost" size="sm" onClick={() => navigate(`/departments/${department.id}`)} rightIcon={<ChevronRight className="h-4 w-4" />}>
                  View roster
                </Button>
                {can('departments:manage') && (
                  <div className="ml-auto flex gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(department)}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-navy-700 dark:hover:bg-navy-800"
                      aria-label={`Edit ${department.name}`}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(department)}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                      aria-label={`Delete ${department.name}`}
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
        <DepartmentDialog department={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
        isLoading={remove.isPending}
        title={`Delete ${deleteTarget?.name}?`}
        confirmLabel="Delete department"
        message={
          <>
            <p>This removes the department permanently.</p>
            {(deleteTarget?.memberCount ?? 0) > 0 && (
              <p className="mt-2 font-medium">
                {deleteTarget?.memberCount} member(s) are still assigned. The system will refuse the deletion - reassign
                them first, or mark the department inactive instead.
              </p>
            )}
          </>
        }
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function DepartmentDialog({ department, onClose }: { department: Department | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const isEdit = department !== null;

  const [form, setForm] = useState({
    name: department?.name ?? '',
    description: department?.description ?? '',
    leaderMemberId: department?.leaderMemberId ? String(department.leaderMemberId) : '',
    meetingDay: department?.meetingDay ?? '',
    meetingTime: department?.meetingTime ?? '',
    isActive: department?.isActive ?? true,
  });
  const [error, setError] = useState('');

  // Leaders are picked from the members already in that department when
  // editing, or from everyone when creating.
  const { data: detail } = useQuery({
    queryKey: ['department', department?.id],
    queryFn: () => api.get(`/api/departments/${department!.id}`),
    enabled: isEdit,
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        description: form.description || null,
        leaderMemberId: form.leaderMemberId ? Number(form.leaderMemberId) : null,
        meetingDay: form.meetingDay || null,
        meetingTime: form.meetingTime || null,
        isActive: form.isActive,
      };
      return isEdit ? api.put(`/api/departments/${department!.id}`, payload) : api.post('/api/departments', payload);
    },
    onSuccess: (response) => {
      toast.success(response.message ?? 'Department saved.');
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      queryClient.invalidateQueries({ queryKey: ['member-form-options'] });
      onClose();
    },
    onError: (err) => toast.error('Could not save the department', err instanceof ApiError ? err.message : undefined),
  });

  const onSubmit = () => {
    if (form.name.trim().length < 2) {
      setError('Please enter a department name.');
      return;
    }
    setError('');
    save.mutate();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? `Edit ${department!.name}` : 'New department'}
      description="Departments group members by the ministry they serve in."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} isLoading={save.isPending}>
            {isEdit ? 'Save changes' : 'Create department'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Department name"
          value={form.name}
          onChange={(e) => {
            setForm((f) => ({ ...f, name: e.target.value }));
            if (error) setError('');
          }}
          error={error}
          required
          data-autofocus
          placeholder="e.g. Choir"
        />
        <Textarea
          label="Description"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          rows={2}
          placeholder="What this department does."
        />
        {isEdit && (
          <Select
            label="Department leader"
            value={form.leaderMemberId}
            onChange={(e) => setForm((f) => ({ ...f, leaderMemberId: e.target.value }))}
            placeholder="No leader assigned"
            options={(detail?.members ?? []).map((m: any) => ({ value: m.id, label: m.fullName }))}
            hint="Chosen from the members currently in this department."
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Meeting day"
            value={form.meetingDay}
            onChange={(e) => setForm((f) => ({ ...f, meetingDay: e.target.value }))}
            placeholder="Not scheduled"
            options={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d) => ({
              value: d,
              label: d,
            }))}
          />
          <Input
            label="Meeting time"
            type="time"
            value={form.meetingTime}
            onChange={(e) => setForm((f) => ({ ...f, meetingTime: e.target.value }))}
          />
        </div>
        <Checkbox
          label="Active"
          description="Inactive departments are hidden from the member registration form."
          checked={form.isActive}
          onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
        />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

export function DepartmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['department', id],
    queryFn: () => api.get(`/api/departments/${id}`),
    enabled: Boolean(id),
  });

  if (isLoading) return <LoadingState label="Loading department..." />;
  if (isError || !data) {
    return (
      <Card>
        <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
      </Card>
    );
  }

  const { department, members, attendance } = data;

  return (
    <>
      <PageHeader
        breadcrumb={
          <nav className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400" aria-label="Breadcrumb">
            <Link to="/departments" className="hover:underline">Departments</Link>
            <ChevronRight className="h-3 w-3" aria-hidden />
            <span>{department.name}</span>
          </nav>
        }
        title={department.name}
        description={department.description ?? undefined}
        actions={
          <Button variant="outline" onClick={() => navigate('/departments')} leftIcon={<ArrowLeft className="h-4 w-4" />}>
            All departments
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatBox label="Members" value={formatNumber(members.length)} />
        <StatBox label="Leader" value={department.leaderName ?? 'Not assigned'} small />
        <StatBox label="Meets" value={department.meetingDay ? `${department.meetingDay}${department.meetingTime ? ` ${department.meetingTime}` : ''}` : 'Not scheduled'} small />
        <StatBox label="Attendance (90 days)" value={`${attendance.rate}%`} />
      </div>

      <Card>
        <CardHeader title="Department roster" description={`${members.length} member(s) assigned.`} />
        {members.length === 0 ? (
          <EmptyState
            icon={<Users className="h-6 w-6" aria-hidden />}
            title="No members assigned"
            description="Assign members to this department from their profile, or when registering them."
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
                      {member.phone ? ` - ${member.phone}` : ''}
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

function StatBox({ label, value, small = false }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="cc-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-2 font-semibold text-slate-900 dark:text-white ${small ? 'truncate text-sm' : 'tabular text-2xl'}`}>
        {value}
      </p>
    </div>
  );
}
