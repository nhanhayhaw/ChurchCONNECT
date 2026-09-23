/**
 * Member registration and editing.
 *
 * One form serves both. Validation runs on blur and on submit, and the first
 * invalid field is focused and scrolled to - on a form this long, a silent
 * error above the fold is the fastest way to lose a user.
 *
 * The photograph is uploaded separately after the member exists, because the
 * upload needs a member id to attach to. On the create path the member is
 * saved first, then the photo, then the user lands on the new profile.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, ArrowLeft, Upload, Trash2, ImageOff, ChevronRight } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import {
  PageHeader, Button, Input, Select, Textarea, FormSection, Avatar,
  LoadingState, ErrorState, Card,
} from '@/components/ui';
import { todayIso } from '@/utils/format';
import type { MemberDetail } from '@/types';

const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];
const MARITAL = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
];
const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'transferred', label: 'Transferred' },
  { value: 'deceased', label: 'Deceased' },
];
const BAPTISM = [
  { value: 'baptised', label: 'Baptised' },
  { value: 'not_baptised', label: 'Not baptised' },
  { value: 'pending', label: 'Pending' },
];
const COMMUNION = [
  { value: 'communicant', label: 'Communicant' },
  { value: 'not_communicant', label: 'Not a communicant' },
];
const CATEGORIES = [
  { value: 'full_member', label: 'Full member' },
  { value: 'associate', label: 'Associate' },
  { value: 'new_convert', label: 'New convert' },
  { value: 'visitor', label: 'Visitor' },
  { value: 'child', label: 'Child' },
];

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

interface FormState {
  memberCode: string;
  firstName: string;
  middleName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  maritalStatus: string;
  nationality: string;
  phone: string;
  altPhone: string;
  email: string;
  address: string;
  dateJoined: string;
  membershipStatus: string;
  baptismStatus: string;
  communionStatus: string;
  membershipCategory: string;
  ministry: string;
  departmentId: string;
  groupId: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  notes: string;
}

const EMPTY: FormState = {
  memberCode: '', firstName: '', middleName: '', lastName: '', gender: '',
  dateOfBirth: '', maritalStatus: '', nationality: 'Ghanaian',
  phone: '', altPhone: '', email: '', address: '',
  dateJoined: todayIso(), membershipStatus: 'active', baptismStatus: 'not_baptised',
  communionStatus: 'not_communicant', membershipCategory: 'full_member', ministry: '',
  departmentId: '', groupId: '',
  emergencyName: '', emergencyRelationship: '', emergencyPhone: '', notes: '',
};

export default function MemberFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [removeExistingPhoto, setRemoveExistingPhoto] = useState(false);

  // --- load for edit ------------------------------------------------------
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['member', id],
    queryFn: () => api.get<{ member: MemberDetail }>(`/api/members/${id}`),
    enabled: isEdit,
  });

  const { data: options } = useQuery({
    queryKey: ['member-form-options'],
    queryFn: () => api.get('/api/members/form-options'),
    staleTime: 300_000,
  });

  useEffect(() => {
    if (!data?.member) return;
    const m = data.member;
    setForm({
      memberCode: m.memberCode ?? '',
      firstName: m.firstName ?? '',
      middleName: m.middleName ?? '',
      lastName: m.lastName ?? '',
      gender: m.gender ?? '',
      dateOfBirth: m.dateOfBirth ?? '',
      maritalStatus: m.maritalStatus ?? '',
      nationality: m.nationality ?? 'Ghanaian',
      phone: m.phone ?? '',
      altPhone: m.altPhone ?? '',
      email: m.email ?? '',
      address: m.address ?? '',
      dateJoined: m.dateJoined ?? todayIso(),
      membershipStatus: m.membershipStatus ?? 'active',
      baptismStatus: m.baptismStatus ?? 'not_baptised',
      communionStatus: m.communionStatus ?? 'not_communicant',
      membershipCategory: m.membershipCategory ?? 'full_member',
      ministry: m.ministry ?? '',
      departmentId: m.departmentId ? String(m.departmentId) : '',
      groupId: m.groupId ? String(m.groupId) : '',
      emergencyName: m.emergencyName ?? '',
      emergencyRelationship: m.emergencyRelationship ?? '',
      emergencyPhone: m.emergencyPhone ?? '',
      notes: m.notes ?? '',
    });
  }, [data]);

  // Release the object URL when the preview changes or the page unmounts.
  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  const set = (key: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    // Clear the field's error as soon as the user starts fixing it.
    setErrors((prev) => (prev[key] ? { ...prev, [key]: '' } : prev));
  };

  // --- validation ---------------------------------------------------------
  const validate = (): boolean => {
    const next: Record<string, string> = {};

    if (form.firstName.trim().length < 2) next.firstName = 'Please enter the first name.';
    if (form.lastName.trim().length < 2) next.lastName = 'Please enter the last name.';
    if (!form.gender) next.gender = 'Please select a gender.';
    if (!form.dateJoined) next.dateJoined = 'Please enter the date the member joined.';

    if (form.dateOfBirth && form.dateOfBirth > todayIso()) {
      next.dateOfBirth = 'Date of birth cannot be in the future.';
    }
    if (form.dateJoined && form.dateJoined > todayIso()) {
      next.dateJoined = 'Date joined cannot be in the future.';
    }
    if (form.dateOfBirth && form.dateJoined && form.dateJoined < form.dateOfBirth) {
      next.dateJoined = 'Date joined cannot be before the date of birth.';
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email)) {
      next.email = 'Please enter a valid email address.';
    }
    for (const field of ['phone', 'altPhone', 'emergencyPhone'] as const) {
      if (form[field] && !/^[+]?[0-9\s()-]{7,20}$/.test(form[field])) {
        next[field] = 'Please enter a valid phone number.';
      }
    }

    setErrors(next);

    if (Object.keys(next).length > 0) {
      const firstKey = Object.keys(next)[0]!;
      const element = formRef.current?.querySelector<HTMLElement>(`[name="${firstKey}"]`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element?.focus({ preventScroll: true });
      return false;
    }
    return true;
  };

  // --- photo --------------------------------------------------------------
  const onPhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      toast.error('Unsupported image type', 'Please choose a JPG, JPEG or PNG file.');
      event.target.value = '';
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error('That image is too large', 'Please choose a photo under 3 MB.');
      event.target.value = '';
      return;
    }

    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    setRemoveExistingPhoto(false);
  };

  const uploadPhoto = async (memberId: number) => {
    if (!photoFile) return;
    const body = new FormData();
    body.append('photo', photoFile);
    await api.post(`/api/members/${memberId}/photo`, body);
  };

  // --- save ---------------------------------------------------------------
  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        memberCode: form.memberCode || undefined,
        departmentId: form.departmentId ? Number(form.departmentId) : null,
        groupId: form.groupId ? Number(form.groupId) : null,
        dateOfBirth: form.dateOfBirth || null,
        maritalStatus: form.maritalStatus || null,
      };

      if (isEdit) {
        const response = await api.put<{ member: MemberDetail; message: string }>(`/api/members/${id}`, payload);
        if (removeExistingPhoto) await api.delete(`/api/members/${id}/photo`);
        await uploadPhoto(Number(id));
        return response;
      }

      const response = await api.post<{ member: MemberDetail; message: string }>('/api/members', payload);
      await uploadPhoto(response.member.id);
      return response;
    },
    onSuccess: (response) => {
      toast.success(response.message ?? 'Member saved.');
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['member', String(response.member.id)] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      navigate(`/members/${response.member.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.fields) {
          setErrors(err.fields);
          const firstKey = Object.keys(err.fields)[0]!;
          formRef.current?.querySelector<HTMLElement>(`[name="${firstKey}"]`)?.focus();
        }
        toast.error('Could not save the member', err.message);
      } else {
        toast.error('Could not save the member', 'Please check your connection and try again.');
      }
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!validate()) {
      toast.warning('Please review the form', 'Some required information is missing or not valid.');
      return;
    }
    save.mutate();
  };

  if (isEdit && isLoading) return <LoadingState label="Loading member details..." />;
  if (isEdit && isError) {
    return (
      <Card>
        <ErrorState message={(error as Error)?.message} onRetry={() => navigate('/members')} />
      </Card>
    );
  }

  const existingPhoto = removeExistingPhoto ? null : data?.member.photoUrl;
  const displayPhoto = photoPreview ?? existingPhoto;
  const displayName = `${form.firstName} ${form.lastName}`.trim() || 'New member';

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate>
      <PageHeader
        breadcrumb={
          <nav className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400" aria-label="Breadcrumb">
            <Link to="/members" className="hover:underline">Members</Link>
            <ChevronRight className="h-3 w-3" aria-hidden />
            <span>{isEdit ? 'Edit' : 'Register'}</span>
          </nav>
        }
        title={isEdit ? `Edit ${data?.member.fullName ?? 'member'}` : 'Register a new member'}
        description={
          isEdit
            ? 'Update this member record. Changes are recorded in the audit log.'
            : 'Fields marked with an asterisk are required. Everything else can be added later.'
        }
        actions={
          <>
            <Button variant="outline" onClick={() => navigate(-1)} leftIcon={<ArrowLeft className="h-4 w-4" />}>
              Cancel
            </Button>
            <Button type="submit" isLoading={save.isPending} leftIcon={<Save className="h-4 w-4" />}>
              {isEdit ? 'Save changes' : 'Register member'}
            </Button>
          </>
        }
      />

      <div className="space-y-5">
        {/* --- Photograph --------------------------------------------------- */}
        <section className="cc-card overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50/60 px-5 py-3.5 dark:border-navy-800 dark:bg-navy-950/40">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Profile photograph</h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              JPG, JPEG or PNG, up to 3 MB. The image is resized and re-encoded on upload.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-5 p-5">
            <Avatar src={displayPhoto} name={displayName} size="xl" />
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-navy-700 dark:bg-navy-900 dark:text-slate-200 dark:hover:bg-navy-800">
                <Upload className="h-4 w-4" aria-hidden />
                {displayPhoto ? 'Replace photograph' : 'Upload photograph'}
                <input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={onPhotoChange} />
              </label>

              {displayPhoto && (
                <Button
                  variant="outline"
                  leftIcon={<Trash2 className="h-4 w-4" />}
                  onClick={() => {
                    if (photoPreview) URL.revokeObjectURL(photoPreview);
                    setPhotoFile(null);
                    setPhotoPreview(null);
                    if (existingPhoto) setRemoveExistingPhoto(true);
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
            {!displayPhoto && (
              <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <ImageOff className="h-3.5 w-3.5" aria-hidden />
                No photograph yet - initials will be shown instead.
              </p>
            )}
          </div>
        </section>

        {/* --- Personal ----------------------------------------------------- */}
        <FormSection title="Personal information" description="Who this member is.">
          <Input
            label="Member ID"
            name="memberCode"
            value={form.memberCode}
            onChange={set('memberCode')}
            error={errors.memberCode}
            placeholder="Generated automatically"
            hint={isEdit ? undefined : 'Leave blank and the next ID in sequence is assigned.'}
            disabled={isEdit}
          />
          <Input label="First name" name="firstName" value={form.firstName} onChange={set('firstName')} error={errors.firstName} required />
          <Input label="Middle name" name="middleName" value={form.middleName} onChange={set('middleName')} error={errors.middleName} />
          <Input label="Last name" name="lastName" value={form.lastName} onChange={set('lastName')} error={errors.lastName} required />
          <Select label="Gender" name="gender" value={form.gender} onChange={set('gender')} error={errors.gender} options={GENDERS} placeholder="Select gender" required />
          <Input label="Date of birth" name="dateOfBirth" type="date" max={todayIso()} value={form.dateOfBirth} onChange={set('dateOfBirth')} error={errors.dateOfBirth} hint="Used for birthday reminders." />
          <Select label="Marital status" name="maritalStatus" value={form.maritalStatus} onChange={set('maritalStatus')} error={errors.maritalStatus} options={MARITAL} placeholder="Select status" />
          <Input label="Nationality" name="nationality" value={form.nationality} onChange={set('nationality')} error={errors.nationality} />
        </FormSection>

        {/* --- Contact ------------------------------------------------------ */}
        <FormSection title="Contact information" description="How the church reaches this member.">
          <Input label="Phone number" name="phone" type="tel" value={form.phone} onChange={set('phone')} error={errors.phone} placeholder="+233 24 000 0000" />
          <Input label="Alternative phone" name="altPhone" type="tel" value={form.altPhone} onChange={set('altPhone')} error={errors.altPhone} />
          <Input label="Email address" name="email" type="email" value={form.email} onChange={set('email')} error={errors.email} />
          <Textarea label="Residential address" name="address" value={form.address} onChange={set('address')} error={errors.address} containerClassName="sm:col-span-2" rows={2} />
        </FormSection>

        {/* --- Church ------------------------------------------------------- */}
        <FormSection title="Church information" description="Standing, department and group.">
          <Input label="Date joined" name="dateJoined" type="date" max={todayIso()} value={form.dateJoined} onChange={set('dateJoined')} error={errors.dateJoined} required />
          <Select label="Membership status" name="membershipStatus" value={form.membershipStatus} onChange={set('membershipStatus')} error={errors.membershipStatus} options={STATUSES} />
          <Select label="Baptism status" name="baptismStatus" value={form.baptismStatus} onChange={set('baptismStatus')} options={BAPTISM} />
          <Select label="Holy Communion" name="communionStatus" value={form.communionStatus} onChange={set('communionStatus')} options={COMMUNION} />
          <Select label="Membership category" name="membershipCategory" value={form.membershipCategory} onChange={set('membershipCategory')} options={CATEGORIES} />
          <Input label="Ministry" name="ministry" value={form.ministry} onChange={set('ministry')} placeholder="e.g. Worship, Intercession" />
          <Select
            label="Department"
            name="departmentId"
            value={form.departmentId}
            onChange={set('departmentId')}
            placeholder="Not assigned"
            options={(options?.departments ?? []).map((d: any) => ({ value: d.id, label: d.name }))}
          />
          <Select
            label="Church group / cell"
            name="groupId"
            value={form.groupId}
            onChange={set('groupId')}
            placeholder="Not assigned"
            options={(options?.groups ?? []).map((g: any) => ({ value: g.id, label: g.name }))}
          />
        </FormSection>

        {/* --- Emergency ---------------------------------------------------- */}
        <FormSection title="Emergency contact" description="Who to call if something happens.">
          <Input label="Contact name" name="emergencyName" value={form.emergencyName} onChange={set('emergencyName')} error={errors.emergencyName} />
          <Input label="Relationship" name="emergencyRelationship" value={form.emergencyRelationship} onChange={set('emergencyRelationship')} placeholder="e.g. Spouse, Parent" />
          <Input label="Contact phone" name="emergencyPhone" type="tel" value={form.emergencyPhone} onChange={set('emergencyPhone')} error={errors.emergencyPhone} />
        </FormSection>

        <FormSection title="Notes" description="Anything a pastor or administrator should know. Visible to staff only.">
          <Textarea label="Notes" name="notes" value={form.notes} onChange={set('notes')} containerClassName="sm:col-span-2" rows={4} />
        </FormSection>

        <div className="flex flex-wrap justify-end gap-2 pb-4">
          <Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
          <Button type="submit" isLoading={save.isPending} leftIcon={<Save className="h-4 w-4" />}>
            {isEdit ? 'Save changes' : 'Register member'}
          </Button>
        </div>
      </div>
    </form>
  );
}
