/**
 * System settings.
 *
 * The absence thresholds on this page are the ones the detection engine reads,
 * so the copy explains exactly what changing them does. Nothing here sends a
 * message to a member - the notification toggle only controls whether church
 * workers are alerted.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Church, Cake, BellRing, PhoneCall, Info, RefreshCw } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  PageHeader, Card, CardHeader, Button, Input, Textarea, Select, Checkbox,
  LoadingState, ErrorState, Tabs,
} from '@/components/ui';

const REMINDER_CHOICES = [0, 1, 2, 3, 5, 7, 14, 30];

export default function SettingsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState('church');
  const [draft, setDraft] = useState<Record<string, any>>({});

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get('/api/settings'),
  });

  useEffect(() => {
    if (data?.settings) setDraft(data.settings);
  }, [data]);

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.patch('/api/settings', payload),
    onSuccess: (response) => {
      toast.success(response.message ?? 'Settings saved.');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['absence-alerts'] });
    },
    onError: (err) => toast.error('Could not save the settings', err instanceof ApiError ? err.message : undefined),
  });

  const runBirthdayJob = useMutation({
    mutationFn: () => api.post('/api/birthdays/reminders/generate'),
    onSuccess: (response) => toast.success('Birthday job complete', response.message),
    onError: (err) => toast.error('The job could not run', err instanceof ApiError ? err.message : undefined),
  });

  const canManage = can('settings:manage');
  const set = (key: string, value: unknown) => setDraft((d) => ({ ...d, [key]: value }));

  const saveSection = (keys: string[]) => {
    const payload: Record<string, unknown> = {};
    for (const key of keys) payload[key] = draft[key];
    save.mutate(payload);
  };

  if (isLoading) return <LoadingState label="Loading settings..." />;
  if (isError) {
    return (
      <Card>
        <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
      </Card>
    );
  }

  const reminderDays: number[] = Array.isArray(draft.birthday_reminder_days) ? draft.birthday_reminder_days : [];

  return (
    <>
      <PageHeader
        title="Settings"
        description="Church details, absence thresholds and reminder behaviour."
      />

      <Card>
        <Tabs
          tabs={[
            { id: 'church', label: 'Church profile', icon: <Church className="h-4 w-4" aria-hidden /> },
            { id: 'absence', label: 'Absence monitoring', icon: <BellRing className="h-4 w-4" aria-hidden /> },
            { id: 'birthdays', label: 'Birthdays', icon: <Cake className="h-4 w-4" aria-hidden /> },
            { id: 'followups', label: 'Follow-ups', icon: <PhoneCall className="h-4 w-4" aria-hidden /> },
          ]}
          active={tab}
          onChange={setTab}
          className="px-2"
        />

        <div className="p-5">
          {/* --- Church profile --------------------------------------------- */}
          {tab === 'church' && (
            <div className="max-w-2xl space-y-4">
              <Input label="Church name" value={draft.church_name ?? ''} onChange={(e) => set('church_name', e.target.value)} disabled={!canManage} hint="Appears on the login screen, report headers and exports." />
              <Input label="Tagline" value={draft.church_tagline ?? ''} onChange={(e) => set('church_tagline', e.target.value)} disabled={!canManage} />
              <Textarea label="Postal address" value={draft.church_address ?? ''} onChange={(e) => set('church_address', e.target.value)} rows={2} disabled={!canManage} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Telephone" value={draft.church_phone ?? ''} onChange={(e) => set('church_phone', e.target.value)} disabled={!canManage} />
                <Input label="Email address" type="email" value={draft.church_email ?? ''} onChange={(e) => set('church_email', e.target.value)} disabled={!canManage} />
              </div>
              <Input label="Logo URL" value={draft.church_logo_url ?? ''} onChange={(e) => set('church_logo_url', e.target.value)} disabled={!canManage} hint="Optional. Leave blank to use the built-in RT AG Connect mark." />

              {canManage && (
                <Button
                  onClick={() => saveSection(['church_name', 'church_tagline', 'church_address', 'church_phone', 'church_email', 'church_logo_url'])}
                  isLoading={save.isPending}
                  leftIcon={<Save className="h-4 w-4" />}
                >
                  Save church profile
                </Button>
              )}
            </div>
          )}

          {/* --- Absence ------------------------------------------------------ */}
          {tab === 'absence' && (
            <div className="max-w-2xl space-y-5">
              <div className="flex gap-2 rounded-lg bg-navy-50 p-3.5 text-sm text-navy-900 dark:bg-navy-800/50 dark:text-navy-100">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p>
                  These thresholds count <strong>consecutive missed services</strong> among finalised,
                  congregation-wide services of the tracked types. The system never concludes that a member has left -
                  it only raises an alert for a church worker to act on.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Input
                  label="Level 1 threshold"
                  type="number"
                  min={1}
                  max={20}
                  value={draft.absence_level_1_services ?? 2}
                  onChange={(e) => set('absence_level_1_services', Number(e.target.value))}
                  disabled={!canManage}
                  hint="Follow-Up Reminder"
                />
                <Input
                  label="Level 2 threshold"
                  type="number"
                  min={1}
                  max={30}
                  value={draft.absence_level_2_services ?? 3}
                  onChange={(e) => set('absence_level_2_services', Number(e.target.value))}
                  disabled={!canManage}
                  hint="Urgent Follow-Up"
                />
                <Input
                  label="Level 3 threshold"
                  type="number"
                  min={1}
                  max={52}
                  value={draft.absence_level_3_services ?? 4}
                  onChange={(e) => set('absence_level_3_services', Number(e.target.value))}
                  disabled={!canManage}
                  hint="Pastoral Follow-Up"
                />
              </div>

              <fieldset>
                <legend className="cc-label">Services tracked for absence</legend>
                <p className="cc-hint mb-2">
                  Only these count towards a streak. Most churches track the main Sunday service only.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(data.serviceTypes ?? []).map((type: any) => {
                    const tracked: string[] = draft.absence_tracked_service_types ?? [];
                    return (
                      <Checkbox
                        key={type.value}
                        label={type.label}
                        checked={tracked.includes(type.value)}
                        disabled={!canManage}
                        onChange={(e) =>
                          set(
                            'absence_tracked_service_types',
                            e.target.checked
                              ? [...tracked, type.value]
                              : tracked.filter((t) => t !== type.value),
                          )
                        }
                      />
                    );
                  })}
                </div>
              </fieldset>

              <Checkbox
                label="Count excused absences towards the streak"
                description="Off by default. A member who told the church they would be away is usually not a pastoral concern."
                checked={Boolean(draft.absence_excused_counts)}
                disabled={!canManage}
                onChange={(e) => set('absence_excused_counts', e.target.checked)}
              />

              <Checkbox
                label="Open follow-up cases automatically"
                description="When on, crossing a threshold opens a pending case. When off, only an alert is raised and a worker opens the case by hand."
                checked={Boolean(draft.absence_auto_create_followups)}
                disabled={!canManage}
                onChange={(e) => set('absence_auto_create_followups', e.target.checked)}
              />

              {canManage && (
                <Button
                  onClick={() =>
                    saveSection([
                      'absence_level_1_services',
                      'absence_level_2_services',
                      'absence_level_3_services',
                      'absence_tracked_service_types',
                      'absence_excused_counts',
                      'absence_auto_create_followups',
                    ])
                  }
                  isLoading={save.isPending}
                  leftIcon={<Save className="h-4 w-4" />}
                >
                  Save absence settings
                </Button>
              )}
            </div>
          )}

          {/* --- Birthdays ---------------------------------------------------- */}
          {tab === 'birthdays' && (
            <div className="max-w-2xl space-y-5">
              <fieldset>
                <legend className="cc-label">Generate reminders this many days before a birthday</legend>
                <p className="cc-hint mb-2">Zero means a reminder on the day itself.</p>
                <div className="flex flex-wrap gap-2">
                  {REMINDER_CHOICES.map((days) => {
                    const selected = reminderDays.includes(days);
                    return (
                      <button
                        key={days}
                        type="button"
                        disabled={!canManage}
                        aria-pressed={selected}
                        onClick={() =>
                          set(
                            'birthday_reminder_days',
                            selected ? reminderDays.filter((d) => d !== days) : [...reminderDays, days].sort((a, b) => b - a),
                          )
                        }
                        className={
                          selected
                            ? 'rounded-lg border border-navy-700 bg-navy-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60'
                            : 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-navy-700 dark:bg-navy-900 dark:text-slate-400'
                        }
                      >
                        {days === 0 ? 'On the day' : `${days} day${days === 1 ? '' : 's'} before`}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <Checkbox
                label="Raise notifications for birthdays"
                description="Off by default. When on, church workers are notified. Nothing is ever sent to the member - outbound SMS and email are not implemented."
                checked={Boolean(draft.birthday_notifications_enabled)}
                disabled={!canManage}
                onChange={(e) => set('birthday_notifications_enabled', e.target.checked)}
              />

              <div className="flex flex-wrap gap-2">
                {canManage && (
                  <Button
                    onClick={() => saveSection(['birthday_reminder_days', 'birthday_notifications_enabled'])}
                    isLoading={save.isPending}
                    leftIcon={<Save className="h-4 w-4" />}
                  >
                    Save birthday settings
                  </Button>
                )}
                {canManage && (
                  <Button
                    variant="outline"
                    onClick={() => runBirthdayJob.mutate()}
                    isLoading={runBirthdayJob.isPending}
                    leftIcon={<RefreshCw className="h-4 w-4" />}
                  >
                    Run the reminder job now
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* --- Follow-ups --------------------------------------------------- */}
          {tab === 'followups' && (
            <div className="max-w-2xl space-y-5">
              <Input
                label="Days before a follow-up is flagged overdue"
                type="number"
                min={1}
                max={90}
                value={draft.followup_overdue_days ?? 7}
                onChange={(e) => set('followup_overdue_days', Number(e.target.value))}
                disabled={!canManage}
                hint="Applied from the scheduled next-contact date, or from when the case was opened if none is set."
              />

              {canManage && (
                <Button onClick={() => saveSection(['followup_overdue_days'])} isLoading={save.isPending} leftIcon={<Save className="h-4 w-4" />}>
                  Save follow-up settings
                </Button>
              )}
            </div>
          )}

          {!canManage && (
            <p className="mt-6 rounded-lg bg-slate-50 p-3.5 text-sm text-slate-600 dark:bg-navy-950/50 dark:text-slate-400">
              You have read-only access to settings. Ask a Super Administrator to make changes.
            </p>
          )}
        </div>
      </Card>
    </>
  );
}
