/**
 * Users and roles - Super Administrator territory.
 */
import { useState } from 'react';
import clsx from 'clsx';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck, Plus, Pencil, Trash2, KeyRound, Unlock, UserCheck, UserX, Send, MailWarning,
} from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  PageHeader, Card, CardHeader, Button, Input, Select, Checkbox, Badge, Avatar,
  Modal, ConfirmDialog, EmptyState, ErrorState, LoadingState, Tabs,
} from '@/components/ui';
import { formatDateTime, formatRelative, titleCase } from '@/utils/format';
import type { AdminUser } from '@/types';

export default function UsersPage() {
  const { user: currentUser, can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState('users');
  const [editing, setEditing] = useState<AdminUser | null | 'new'>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);

  const users = useQuery({
    queryKey: ['users'],
    queryFn: () =>
      api.get<{ users: AdminUser[]; emailEnabled: boolean; inviteExpiryDays: number }>('/api/users'),
  });

  const emailEnabled = users.data?.emailEnabled ?? false;

  const resendInvite = useMutation({
    mutationFn: (id: number) => api.post(`/api/users/${id}/resend-invite`),
    onSuccess: (response) => {
      toast.success('Invitation sent', response.message);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) => toast.error('Could not send the invitation', err instanceof ApiError ? err.message : undefined),
  });

  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get('/api/users/roles'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/users/${id}`),
    onSuccess: (response) => {
      toast.success(response.message ?? 'Account deleted.');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error('Could not delete the account', err instanceof ApiError ? err.message : undefined);
      setDeleteTarget(null);
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => api.put(`/api/users/${id}`, { isActive }),
    onSuccess: () => {
      toast.success('Account updated.');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) => toast.error('Could not update the account', err instanceof ApiError ? err.message : undefined),
  });

  const unlock = useMutation({
    mutationFn: (id: number) => api.post(`/api/users/${id}/unlock`),
    onSuccess: () => {
      toast.success('Account unlocked.');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const canManage = can('users:manage');

  return (
    <>
      <PageHeader
        title="Users &amp; roles"
        description="Who can sign in, and what each role is allowed to do."
        actions={
          canManage &&
          tab === 'users' && (
            <Button onClick={() => setEditing('new')} leftIcon={<Plus className="h-4 w-4" />}>
              New user
            </Button>
          )
        }
      />

      <Card>
        <Tabs
          tabs={[
            { id: 'users', label: 'User accounts', count: users.data?.users.length },
            { id: 'roles', label: 'Roles & permissions', count: roles.data?.roles.length },
          ]}
          active={tab}
          onChange={setTab}
          className="px-2"
        />

        {tab === 'users' &&
          (users.isLoading ? (
            <LoadingState label="Loading accounts..." />
          ) : users.isError ? (
            <ErrorState onRetry={() => users.refetch()} />
          ) : (
            <div className="overflow-x-auto">
              <table className="cc-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th className="hidden lg:table-cell">Department</th>
                    <th className="hidden md:table-cell">Last sign-in</th>
                    <th>Status</th>
                    {canManage && <th className="w-px" />}
                  </tr>
                </thead>
                <tbody>
                  {users.data!.users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <Avatar name={u.fullName} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                              {u.fullName}
                              {u.id === currentUser?.id && (
                                <span className="ml-1.5 text-xs font-normal text-slate-400">(you)</span>
                              )}
                            </p>
                            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Badge tone={u.roleName === 'super_admin' ? 'gold' : 'navy'}>{u.roleLabel}</Badge>
                      </td>
                      <td className="hidden lg:table-cell">
                        {u.departmentName ?? <span className="text-slate-400">-</span>}
                      </td>
                      <td className="hidden md:table-cell">
                        {u.lastLoginAt ? (
                          <span title={formatDateTime(u.lastLoginAt)}>{formatRelative(u.lastLoginAt)}</span>
                        ) : (
                          <span className="text-slate-400">Never</span>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge tone={u.isActive ? 'emerald' : 'slate'}>{u.isActive ? 'Active' : 'Deactivated'}</Badge>
                          {u.isLocked && <Badge tone="red">Locked</Badge>}
                          {u.invitePending && <Badge tone="sky">Invitation sent</Badge>}
                          {!u.invitePending && u.neverSignedIn && u.isActive && (
                            <Badge tone="amber">Never signed in</Badge>
                          )}
                          {u.mustChangePassword && <Badge tone="amber">Must reset</Badge>}
                        </div>
                      </td>
                      {canManage && (
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            {u.isLocked && (
                              <IconButton label={`Unlock ${u.fullName}`} onClick={() => unlock.mutate(u.id)}>
                                <Unlock className="h-4 w-4" aria-hidden />
                              </IconButton>
                            )}
                            {emailEnabled && u.isActive && u.neverSignedIn && (
                              <IconButton
                                label={
                                  u.invitePending
                                    ? `Resend the invitation to ${u.fullName}`
                                    : `Send an invitation to ${u.fullName}`
                                }
                                onClick={() => resendInvite.mutate(u.id)}
                              >
                                <Send className="h-4 w-4" aria-hidden />
                              </IconButton>
                            )}
                            <IconButton label={`Reset password for ${u.fullName}`} onClick={() => setResetTarget(u)}>
                              <KeyRound className="h-4 w-4" aria-hidden />
                            </IconButton>
                            <IconButton label={`Edit ${u.fullName}`} onClick={() => setEditing(u)}>
                              <Pencil className="h-4 w-4" aria-hidden />
                            </IconButton>
                            {u.id !== currentUser?.id && (
                              <>
                                <IconButton
                                  label={u.isActive ? `Deactivate ${u.fullName}` : `Activate ${u.fullName}`}
                                  onClick={() => toggleActive.mutate({ id: u.id, isActive: !u.isActive })}
                                >
                                  {u.isActive ? <UserX className="h-4 w-4" aria-hidden /> : <UserCheck className="h-4 w-4" aria-hidden />}
                                </IconButton>
                                <IconButton label={`Delete ${u.fullName}`} danger onClick={() => setDeleteTarget(u)}>
                                  <Trash2 className="h-4 w-4" aria-hidden />
                                </IconButton>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {tab === 'roles' &&
          (roles.isLoading ? (
            <LoadingState label="Loading roles..." />
          ) : roles.isError ? (
            <ErrorState onRetry={() => roles.refetch()} />
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-navy-800">
              {roles.data.roles.map((role: any) => (
                <div key={role.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                        <ShieldCheck className="h-4 w-4 text-slate-400" aria-hidden />
                        {role.label}
                      </h3>
                      <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">{role.description}</p>
                    </div>
                    <Badge tone="slate">{role.userCount} user(s)</Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {role.permissions.includes('*') ? (
                      <Badge tone="gold">Full access to everything</Badge>
                    ) : (
                      role.permissions.map((p: string) => (
                        <span
                          key={p}
                          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-2xs text-slate-600 dark:bg-navy-800 dark:text-slate-400"
                        >
                          {p}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              ))}
              <p className="p-5 text-xs text-slate-500 dark:text-slate-400">
                Roles are seeded with sensible defaults. Editing a role's permission list is supported by the API
                (<code className="font-mono">PUT /api/users/roles/:id</code>) for future use; the Super Administrator's
                full access cannot be reduced.
              </p>
            </div>
          ))}
      </Card>

      {editing !== null && (
        <UserDialog
          user={editing === 'new' ? null : editing}
          roles={roles.data?.roles ?? []}
          emailEnabled={emailEnabled}
          inviteExpiryDays={users.data?.inviteExpiryDays ?? 7}
          onClose={() => setEditing(null)}
        />
      )}

      {resetTarget && <ResetPasswordDialog user={resetTarget} onClose={() => setResetTarget(null)} />}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
        isLoading={remove.isPending}
        title={`Delete ${deleteTarget?.fullName}'s account?`}
        confirmLabel="Delete account"
        message={
          <>
            <p>
              This permanently removes the sign-in account for <strong>{deleteTarget?.email}</strong>.
            </p>
            <p className="mt-2 text-xs">
              Their entries in the audit log are kept, attributed to their email address. Consider deactivating the
              account instead if you may need it again.
            </p>
          </>
        }
      />
    </>
  );
}

function IconButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        danger
          ? 'rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20'
          : 'rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-navy-700 dark:hover:bg-navy-800'
      }
    >
      {children}
    </button>
  );
}

function UserDialog({
  user,
  roles,
  emailEnabled,
  inviteExpiryDays,
  onClose,
}: {
  user: AdminUser | null;
  roles: any[];
  emailEnabled: boolean;
  inviteExpiryDays: number;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const isEdit = user !== null;

  // Invitation is the better path whenever it is available: the administrator
  // never learns the password, and there is no temporary secret to pass along
  // by phone or WhatsApp. It is only offered when the server can actually send.
  const [useInvite, setUseInvite] = useState(emailEnabled);

  const [form, setForm] = useState({
    fullName: user?.fullName ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    password: '',
    roleId: user?.roleId ? String(user.roleId) : '',
    departmentId: user?.departmentId ? String(user.departmentId) : '',
    isActive: user?.isActive ?? true,
    mustChangePassword: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: options } = useQuery({
    queryKey: ['member-form-options'],
    queryFn: () => api.get('/api/members/form-options'),
    staleTime: 300_000,
  });

  const selectedRole = roles.find((r) => String(r.id) === form.roleId);
  const needsDepartment = selectedRole?.name === 'department_leader';

  const save = useMutation({
    mutationFn: () => {
      const base = {
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone || null,
        roleId: Number(form.roleId),
        departmentId: form.departmentId ? Number(form.departmentId) : null,
      };
      if (isEdit) return api.put(`/api/users/${user!.id}`, { ...base, isActive: form.isActive });

      return api.post('/api/users', {
        ...base,
        ...(useInvite
          ? { sendInvite: true }
          : { password: form.password, mustChangePassword: form.mustChangePassword }),
      });
    },
    onSuccess: (response) => {
      toast.success(response.message ?? 'Account saved.');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error('Could not save the account', err instanceof ApiError ? err.message : undefined);
    },
  });

  const onSubmit = () => {
    const next: Record<string, string> = {};
    if (form.fullName.trim().length < 3) next.fullName = 'Please enter the full name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email)) next.email = 'Please enter a valid email address.';
    if (!form.roleId) next.roleId = 'Please choose a role.';
    if (needsDepartment && !form.departmentId) next.departmentId = 'A Department Leader must be assigned a department.';
    if (!isEdit && !useInvite) {
      if (form.password.length < 10) next.password = 'Password must be at least 10 characters long.';
      else if (!(/[a-z]/.test(form.password) && /[A-Z]/.test(form.password) && /[0-9]/.test(form.password))) {
        next.password = 'Include upper case, lower case and a number.';
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    save.mutate();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? `Edit ${user!.fullName}` : 'New user account'}
      description="A user account is a sign-in. It is separate from a member record."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            isLoading={save.isPending}
            leftIcon={!isEdit && useInvite ? <Send className="h-4 w-4" aria-hidden /> : undefined}
          >
            {isEdit ? 'Save changes' : useInvite ? 'Create and send invitation' : 'Create account'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Full name"
          value={form.fullName}
          onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
          error={errors.fullName}
          required
          data-autofocus
        />
        <Input
          label="Email address"
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          error={errors.email}
          required
          hint="Used to sign in."
        />
        <Input
          label="Phone"
          type="tel"
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
        />
        <Select
          label="Role"
          value={form.roleId}
          onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}
          error={errors.roleId}
          placeholder="Choose a role"
          options={roles.map((r) => ({ value: r.id, label: r.label }))}
          hint={selectedRole?.description}
          required
        />
        {needsDepartment && (
          <Select
            label="Department"
            value={form.departmentId}
            onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
            error={errors.departmentId}
            placeholder="Choose a department"
            options={(options?.departments ?? []).map((d: any) => ({ value: d.id, label: d.name }))}
            hint="A Department Leader only sees members of this department."
            required
          />
        )}

        {!isEdit && (
          <div className="rounded-lg border border-slate-200 p-4 dark:border-navy-800">
            <p className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">How will they get in?</p>

            {!emailEnabled && (
              <p className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                <MailWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                This system cannot send email yet, so invitations are unavailable. See docs/EMAIL.md to enable them.
              </p>
            )}

            <div className="space-y-2">
              <label
                className={clsx(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition',
                  useInvite
                    ? 'border-navy-400 bg-navy-50/60 dark:border-navy-600 dark:bg-navy-800/50'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-navy-800 dark:hover:bg-navy-800/40',
                  !emailEnabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <input
                  type="radio"
                  name="access-method"
                  className="mt-0.5 h-4 w-4 shrink-0 border-slate-300 text-navy-700 focus:ring-navy-500"
                  checked={useInvite}
                  disabled={!emailEnabled}
                  onChange={() => setUseInvite(true)}
                />
                <span>
                  <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                    Email them an invitation
                    <span className="ml-1.5 text-xs font-normal text-emerald-700 dark:text-emerald-400">
                      recommended
                    </span>
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    They choose their own password. You never see it, and there is nothing to pass on by phone. The
                    link is valid for {inviteExpiryDays} day{inviteExpiryDays === 1 ? '' : 's'}.
                  </span>
                </span>
              </label>

              <label
                className={clsx(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition',
                  !useInvite
                    ? 'border-navy-400 bg-navy-50/60 dark:border-navy-600 dark:bg-navy-800/50'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-navy-800 dark:hover:bg-navy-800/40',
                )}
              >
                <input
                  type="radio"
                  name="access-method"
                  className="mt-0.5 h-4 w-4 shrink-0 border-slate-300 text-navy-700 focus:ring-navy-500"
                  checked={!useInvite}
                  onChange={() => setUseInvite(false)}
                />
                <span>
                  <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                    Set a temporary password
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    For someone without email, or when you are sitting beside them.
                  </span>
                </span>
              </label>
            </div>

            {!useInvite && (
              <div className="mt-4 space-y-4 border-t border-slate-100 pt-4 dark:border-navy-800">
                <Input
                  label="Temporary password"
                  type="text"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  error={errors.password}
                  required
                  hint="At least 10 characters with upper case, lower case and a number. Share it securely — never by SMS or WhatsApp."
                />
                <Checkbox
                  label="Require a password change at first sign-in"
                  description="Strongly recommended when you have chosen the password on their behalf."
                  checked={form.mustChangePassword}
                  onChange={(e) => setForm((f) => ({ ...f, mustChangePassword: e.target.checked }))}
                />
              </div>
            )}
          </div>
        )}

        {isEdit && (
          <Checkbox
            label="Account is active"
            description="Deactivating signs the user out everywhere immediately."
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
          />
        )}
      </div>
    </Modal>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const reset = useMutation({
    mutationFn: () => api.post(`/api/users/${user.id}/reset-password`, { newPassword: password }),
    onSuccess: (response) => {
      toast.success(response.message ?? 'Password reset.');
      onClose();
    },
    onError: (err) => toast.error('Could not reset the password', err instanceof ApiError ? err.message : undefined),
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Reset password for ${user.fullName}`}
      description="The user is signed out everywhere and must change this password at their next sign-in."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={reset.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (password.length < 10) {
                setError('Password must be at least 10 characters long.');
                return;
              }
              setError('');
              reset.mutate();
            }}
            isLoading={reset.isPending}
          >
            Reset password
          </Button>
        </>
      }
    >
      <Input
        label="New temporary password"
        type="text"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          if (error) setError('');
        }}
        error={error}
        data-autofocus
        hint="Share this with the user through a channel you trust, not by email."
      />
    </Modal>
  );
}
