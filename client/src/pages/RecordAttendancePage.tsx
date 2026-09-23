/**
 * Record attendance.
 *
 * Two steps: choose the gathering, then mark the register. The chooser
 * pre-fills the most recent Sunday and "Sunday Service" because that is the
 * overwhelmingly common case - most sessions should need one click.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { CalendarCheck, ArrowLeft, ClipboardList } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { PageHeader, Card, CardHeader, Button, Input, Select, Textarea } from '@/components/ui';
import { AttendanceRegister } from '@/components/attendance/AttendanceRegister';
import { todayIso } from '@/utils/format';
import type { ServiceSummary } from '@/types';

/** The most recent Sunday on or before today. */
function lastSundayIso(): string {
  const date = new Date();
  date.setDate(date.getDate() - date.getDay());
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function RecordAttendancePage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [serviceId, setServiceId] = useState<number | null>(null);
  const [form, setForm] = useState({
    serviceDate: lastSundayIso(),
    serviceType: 'sunday_service',
    title: '',
    departmentId: '',
    groupId: '',
    notes: '',
  });

  const { data: meta } = useQuery({
    queryKey: ['service-types'],
    queryFn: () => api.get('/api/attendance/service-types'),
    staleTime: Infinity,
  });

  const { data: options } = useQuery({
    queryKey: ['member-form-options'],
    queryFn: () => api.get('/api/members/form-options'),
    staleTime: 300_000,
  });

  const openRegister = useMutation({
    mutationFn: () =>
      api.post<{ service: ServiceSummary }>('/api/attendance/services', {
        serviceDate: form.serviceDate,
        serviceType: form.serviceType,
        title: form.title || null,
        departmentId: form.departmentId ? Number(form.departmentId) : null,
        groupId: form.groupId ? Number(form.groupId) : null,
        notes: form.notes || null,
      }),
    onSuccess: (response) => {
      setServiceId(response.service.id);
      if (response.service.totalRecorded > 0) {
        toast.info(
          'Continuing an existing register',
          `${response.service.totalRecorded} member(s) were already marked for this service.`,
        );
      }
    },
    onError: (err) => {
      toast.error('Could not open the register', err instanceof ApiError ? err.message : undefined);
    },
  });

  if (serviceId) {
    return (
      <>
        <PageHeader
          title="Record attendance"
          description="Mark each member, then save. Unmarked members stay as 'not recorded'."
          actions={
            <Button variant="outline" onClick={() => setServiceId(null)} leftIcon={<ArrowLeft className="h-4 w-4" />}>
              Choose another service
            </Button>
          }
        />
        <AttendanceRegister serviceId={serviceId} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Record attendance"
        description="Choose the service you are taking attendance for."
        actions={
          <Button variant="outline" onClick={() => navigate('/attendance')} leftIcon={<ClipboardList className="h-4 w-4" />}>
            Attendance history
          </Button>
        }
      />

      <Card className="mx-auto max-w-2xl">
        <CardHeader
          title="Which gathering?"
          description="If a register already exists for this date and type, you will continue it rather than start a new one."
        />
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            openRegister.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Service date"
              type="date"
              max={todayIso()}
              value={form.serviceDate}
              onChange={(e) => setForm((f) => ({ ...f, serviceDate: e.target.value }))}
              required
            />
            <Select
              label="Service type"
              value={form.serviceType}
              onChange={(e) => setForm((f) => ({ ...f, serviceType: e.target.value }))}
              options={(meta?.serviceTypes ?? []).map((t: any) => ({ value: t.value, label: t.label }))}
              required
            />
          </div>

          <Input
            label="Service title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="e.g. Sunday Celebration Service"
            hint="Optional. Helps distinguish special programmes in reports."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Department"
              value={form.departmentId}
              onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value, groupId: '' }))}
              placeholder="Whole congregation"
              options={(options?.departments ?? []).map((d: any) => ({ value: d.id, label: d.name }))}
              hint="Leave blank for a congregation-wide service."
            />
            <Select
              label="Group / cell"
              value={form.groupId}
              onChange={(e) => setForm((f) => ({ ...f, groupId: e.target.value, departmentId: '' }))}
              placeholder="Whole congregation"
              options={(options?.groups ?? []).map((g: any) => ({ value: g.id, label: g.name }))}
            />
          </div>

          <Textarea
            label="Notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={2}
            placeholder="Guest minister, special offering, anything worth remembering."
          />

          <div className="rounded-lg bg-slate-50 p-3.5 text-xs text-slate-600 dark:bg-navy-950/50 dark:text-slate-400">
            Only congregation-wide services of a tracked type (Sunday Service by default) count towards absence
            monitoring. Department and group registers are recorded but do not raise absence alerts.
          </div>

          <Button
            type="submit"
            fullWidth
            size="lg"
            isLoading={openRegister.isPending}
            leftIcon={<CalendarCheck className="h-4 w-4" />}
          >
            Open register
          </Button>
        </form>
      </Card>
    </>
  );
}
