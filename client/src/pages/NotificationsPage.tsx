/**
 * Notification centre - the full history behind the bell in the top bar.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, CheckCheck, AlertTriangle, Cake, UserPlus, Info } from 'lucide-react';
import clsx from 'clsx';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import {
  PageHeader, Card, Button, Select, Badge, EmptyState, ErrorState, LoadingState,
} from '@/components/ui';
import { formatDateTime, formatRelative } from '@/utils/format';
import type { AppNotification } from '@/types';

const TYPE_ICONS: Record<string, typeof Bell> = {
  absence_alert: AlertTriangle,
  followup_due: AlertTriangle,
  followup_overdue: AlertTriangle,
  birthday: Cake,
  new_member: UserPlus,
  system: Info,
  attendance_missing: Info,
};

const TYPE_OPTIONS = [
  { value: 'absence_alert', label: 'Absence alerts' },
  { value: 'birthday', label: 'Birthdays' },
  { value: 'followup_overdue', label: 'Overdue follow-ups' },
  { value: 'system', label: 'System' },
];

export default function NotificationsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [type, setType] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['notifications', 'all', unreadOnly, type],
    queryFn: () =>
      api.get<{ notifications: AppNotification[]; unreadCount: number }>(
        `/api/notifications?limit=100${unreadOnly ? '&unreadOnly=true' : ''}${type ? `&type=${type}` : ''}`,
      ),
  });

  const markRead = useMutation({
    mutationFn: (id: number) => api.post(`/api/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAll = useMutation({
    mutationFn: () => api.post('/api/notifications/read-all'),
    onSuccess: (response) => {
      toast.success(response.message ?? 'All notifications marked as read.');
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const notifications = data?.notifications ?? [];

  return (
    <>
      <PageHeader
        title="Notifications"
        description={
          data ? `${data.unreadCount} unread of ${notifications.length} shown.` : 'Loading notifications...'
        }
        actions={
          (data?.unreadCount ?? 0) > 0 && (
            <Button
              variant="outline"
              onClick={() => markAll.mutate()}
              isLoading={markAll.isPending}
              leftIcon={<CheckCheck className="h-4 w-4" />}
            >
              Mark all as read
            </Button>
          )
        }
      />

      <Card>
        <div className="grid gap-3 border-b border-slate-200 p-4 dark:border-navy-800 sm:grid-cols-2">
          <Select
            label="Type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="All notification types"
            options={TYPE_OPTIONS}
          />
          <Select
            label="Show"
            value={unreadOnly ? 'unread' : 'all'}
            onChange={(e) => setUnreadOnly(e.target.value === 'unread')}
            options={[
              { value: 'all', label: 'Everything' },
              { value: 'unread', label: 'Unread only' },
            ]}
          />
        </div>

        {isLoading ? (
          <LoadingState label="Loading notifications..." />
        ) : isError ? (
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : notifications.length === 0 ? (
          <EmptyState
            icon={<BellOff className="h-6 w-6" aria-hidden />}
            title={unreadOnly ? 'Nothing unread' : 'No notifications yet'}
            description={
              unreadOnly
                ? 'You have read everything. Switch to "Everything" to see the history.'
                : 'Absence alerts and birthday reminders appear here as they are generated.'
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-navy-800">
            {notifications.map((n) => {
              const Icon = TYPE_ICONS[n.type] ?? Bell;
              const inner = (
                <>
                  <span
                    className={clsx(
                      'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                      n.severity === 'critical'
                        ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                        : n.severity === 'warning'
                          ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                          : 'bg-navy-50 text-navy-600 dark:bg-navy-800 dark:text-navy-300',
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{n.title}</span>
                      {!n.isRead && <Badge tone="navy">New</Badge>}
                    </span>
                    {n.body && (
                      <span className="mt-1 block text-sm text-slate-600 dark:text-slate-400">{n.body}</span>
                    )}
                    <span className="mt-1 block text-xs text-slate-400">
                      {formatDateTime(n.createdAt)} - {formatRelative(n.createdAt)}
                    </span>
                  </span>
                </>
              );

              const className = clsx(
                'flex w-full gap-3 px-5 py-4 text-left transition hover:bg-slate-50 dark:hover:bg-navy-800/50',
                !n.isRead && 'bg-navy-50/40 dark:bg-navy-800/30',
              );

              return (
                <li key={n.id}>
                  {n.link ? (
                    <Link to={n.link} className={className} onClick={() => !n.isRead && markRead.mutate(n.id)}>
                      {inner}
                    </Link>
                  ) : (
                    <button type="button" className={className} onClick={() => !n.isRead && markRead.mutate(n.id)}>
                      {inner}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
