/**
 * Member profile with tabbed detail.
 *
 * The active tab is kept in the URL so a link can point straight at, say, a
 * member's follow-up history - which the members list and the alert feed both
 * rely on.
 */
import { useEffect } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronRight, Pencil, Printer, Phone, Mail, MapPin, Cake, CalendarDays,
  User, ClipboardCheck, PhoneCall, Building2, FileText, Activity, ArrowLeft,
  ShieldCheck, Droplets, Users as UsersIcon,
} from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import {
  PageHeader, Card, CardHeader, Button, Avatar, Badge, MembershipBadge,
  AttendanceBadge, FollowUpStatusBadge, LevelBadge, Tabs, EmptyState, ErrorState,
  LoadingState, type TabItem,
} from '@/components/ui';
import { formatDate, formatDateShort, formatDateTime, formatRelative, formatCountdown, titleCase } from '@/utils/format';
import type { MemberDetail, FollowUp } from '@/types';

const TABS: (TabItem & { permission?: string })[] = [
  { id: 'overview', label: 'Overview', icon: <User className="h-4 w-4" aria-hidden /> },
  { id: 'attendance', label: 'Attendance', icon: <ClipboardCheck className="h-4 w-4" aria-hidden />, permission: 'attendance:read' },
  { id: 'followup', label: 'Follow-Up', icon: <PhoneCall className="h-4 w-4" aria-hidden />, permission: 'followups:read' },
  { id: 'activities', label: 'Church Activities', icon: <Building2 className="h-4 w-4" aria-hidden /> },
  { id: 'documents', label: 'Documents', icon: <FileText className="h-4 w-4" aria-hidden /> },
  { id: 'timeline', label: 'Activity Timeline', icon: <Activity className="h-4 w-4" aria-hidden /> },
];

export default function MemberProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const activeTab = params.get('tab') ?? 'overview';
  const shouldPrint = params.get('print') === '1';

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['member', id],
    queryFn: () => api.get<{ member: MemberDetail }>(`/api/members/${id}`),
    enabled: Boolean(id),
  });

  const attendance = useQuery({
    queryKey: ['member-attendance', id],
    queryFn: () => api.get(`/api/members/${id}/attendance`),
    enabled: Boolean(id) && activeTab === 'attendance' && can('attendance:read'),
  });

  const followUps = useQuery({
    queryKey: ['member-followups', id],
    queryFn: () => api.get<{ followUps: FollowUp[] }>(`/api/members/${id}/follow-ups`),
    enabled: Boolean(id) && activeTab === 'followup' && can('followups:read'),
  });

  const timeline = useQuery({
    queryKey: ['member-timeline', id],
    queryFn: () => api.get(`/api/members/${id}/timeline`),
    enabled: Boolean(id) && activeTab === 'timeline',
  });

  // "Print profile" opens this page with ?print=1 and triggers the dialog once
  // the record has loaded.
  useEffect(() => {
    if (shouldPrint && data) {
      const timer = window.setTimeout(() => window.print(), 400);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [shouldPrint, data]);

  if (isLoading) return <LoadingState label="Loading member profile..." />;
  if (isError || !data) {
    return (
      <Card>
        <ErrorState
          title="Member not found"
          message={(error as Error)?.message ?? 'That member record does not exist or has been removed.'}
          onRetry={() => refetch()}
        />
        <div className="flex justify-center pb-8">
          <Button variant="outline" onClick={() => navigate('/members')} leftIcon={<ArrowLeft className="h-4 w-4" />}>
            Back to members
          </Button>
        </div>
      </Card>
    );
  }

  const member = data.member;
  const visibleTabs = TABS.filter((tab) => !tab.permission || can(tab.permission));

  return (
    <>
      <PageHeader
        breadcrumb={
          <nav className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400" aria-label="Breadcrumb">
            <Link to="/members" className="hover:underline">Members</Link>
            <ChevronRight className="h-3 w-3" aria-hidden />
            <span className="truncate">{member.fullName}</span>
          </nav>
        }
        title="Member profile"
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()} leftIcon={<Printer className="h-4 w-4" />}>
              Print
            </Button>
            {can('members:update') && (
              <Button onClick={() => navigate(`/members/${member.id}/edit`)} leftIcon={<Pencil className="h-4 w-4" />}>
                Edit profile
              </Button>
            )}
          </>
        }
      />

      {/* --- Identity header ------------------------------------------------
          Only the AVATAR overlaps the navy banner. The name and badges sit
          entirely below it, on the card background.

          A previous version pulled the whole row up with a negative margin, so
          the name block - which is taller than the pull - rendered on top of
          the navy strip. Near-black heading text on deep navy is effectively
          unreadable, which is exactly how it looked. Keeping the offset on the
          avatar alone means the text can never collide with the banner,
          whatever length the name, member code or badge row turns out to be. */}
      <Card className="mb-5 overflow-hidden">
        {/* Distinct in dark mode too: the card is navy-900, so a navy-900
            banner would be invisible there. */}
        <div className="h-20 bg-navy-900 dark:bg-navy-800" aria-hidden />
        <div className="px-5 pb-5">
          <div className="flex flex-wrap items-start gap-4">
            <Avatar
              src={member.photoUrl}
              name={member.fullName}
              size="xl"
              ring
              className="-mt-14 shadow-card"
            />
            <div className="min-w-0 flex-1 pt-3">
              <h2 className="truncate text-xl font-semibold text-slate-900 dark:text-white sm:text-2xl">
                {member.fullName}
              </h2>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{member.memberCode}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <MembershipBadge status={member.membershipStatus} />
                <Badge tone="slate">{titleCase(member.membershipCategory)}</Badge>
                {member.departmentName && <Badge tone="navy">{member.departmentName}</Badge>}
                {member.daysToBirthday != null && member.daysToBirthday <= 30 && (
                  <Badge tone="gold" icon={<Cake className="h-3 w-3" aria-hidden />}>
                    Birthday {formatCountdown(member.daysToBirthday).toLowerCase()}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Quick contact row */}
          <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4 dark:border-navy-800 sm:grid-cols-2 lg:grid-cols-4">
            <QuickFact icon={<Phone className="h-4 w-4" aria-hidden />} label="Phone">
              {member.phone ? <a href={`tel:${member.phone.replace(/\s/g, '')}`} className="hover:underline">{member.phone}</a> : '-'}
            </QuickFact>
            <QuickFact icon={<Mail className="h-4 w-4" aria-hidden />} label="Email">
              {member.email ? <a href={`mailto:${member.email}`} className="break-all hover:underline">{member.email}</a> : '-'}
            </QuickFact>
            <QuickFact icon={<CalendarDays className="h-4 w-4" aria-hidden />} label="Date joined">
              {formatDate(member.dateJoined)}
            </QuickFact>
            <QuickFact icon={<Cake className="h-4 w-4" aria-hidden />} label="Date of birth">
              {member.dateOfBirth ? `${formatDate(member.dateOfBirth)}${member.age != null ? ` (${member.age})` : ''}` : '-'}
            </QuickFact>
          </div>
        </div>
      </Card>

      {/* --- Tabs ------------------------------------------------------------ */}
      <Card>
        <Tabs
          tabs={visibleTabs}
          active={activeTab}
          onChange={(tab) => {
            const next = new URLSearchParams(params);
            next.set('tab', tab);
            next.delete('print');
            setParams(next, { replace: true });
          }}
          className="px-2"
        />

        <div className="p-5">
          {activeTab === 'overview' && <OverviewTab member={member} />}

          {activeTab === 'attendance' && (
            <AttendanceTab query={attendance} />
          )}

          {activeTab === 'followup' && (
            <FollowUpTab query={followUps} memberName={member.fullName} />
          )}

          {activeTab === 'activities' && <ActivitiesTab member={member} />}

          {activeTab === 'documents' && (
            <EmptyState
              icon={<FileText className="h-6 w-6" aria-hidden />}
              title="No documents attached"
              description="Document storage for baptism certificates, transfer letters and consent forms is prepared in the data model but not yet enabled. See docs/ARCHITECTURE.md for the implementation path."
            />
          )}

          {activeTab === 'timeline' && <TimelineTab query={timeline} />}
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------

function QuickFact({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <div className="min-w-0">
        <p className="text-2xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p className="mt-0.5 truncate text-sm text-slate-800 dark:text-slate-200">{children}</p>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2.5 last:border-b-0 dark:border-navy-800">
      <dt className="text-sm text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-sm font-medium text-slate-900 dark:text-slate-100">{value ?? '-'}</dd>
    </div>
  );
}

function OverviewTab({ member }: { member: MemberDetail }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <User className="h-4 w-4 text-slate-400" aria-hidden /> Personal
        </h3>
        <dl>
          <DetailRow label="Full name" value={member.fullName} />
          <DetailRow label="Gender" value={titleCase(member.gender)} />
          <DetailRow label="Date of birth" value={member.dateOfBirth ? formatDate(member.dateOfBirth) : '-'} />
          <DetailRow label="Age" value={member.age != null ? `${member.age} years` : '-'} />
          <DetailRow label="Marital status" value={member.maritalStatus ? titleCase(member.maritalStatus) : '-'} />
          <DetailRow label="Nationality" value={member.nationality ?? '-'} />
        </dl>

        <h3 className="mb-2 mt-6 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <MapPin className="h-4 w-4 text-slate-400" aria-hidden /> Contact
        </h3>
        <dl>
          <DetailRow label="Phone" value={member.phone ?? '-'} />
          <DetailRow label="Alternative phone" value={member.altPhone ?? '-'} />
          <DetailRow label="Email" value={member.email ?? '-'} />
          <DetailRow label="Address" value={member.address ?? '-'} />
        </dl>
      </div>

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <ShieldCheck className="h-4 w-4 text-slate-400" aria-hidden /> Church standing
        </h3>
        <dl>
          <DetailRow label="Member ID" value={member.memberCode} />
          <DetailRow label="Date joined" value={formatDate(member.dateJoined)} />
          <DetailRow label="Membership status" value={<MembershipBadge status={member.membershipStatus} />} />
          <DetailRow label="Category" value={titleCase(member.membershipCategory)} />
          <DetailRow
            label="Baptism"
            value={
              <span className="inline-flex items-center gap-1.5">
                <Droplets className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                {titleCase(member.baptismStatus)}
              </span>
            }
          />
          <DetailRow label="Holy Communion" value={titleCase(member.communionStatus)} />
          <DetailRow label="Last attendance" value={member.lastAttendanceDate ? formatDate(member.lastAttendanceDate) : 'Not recorded'} />
        </dl>

        <h3 className="mb-2 mt-6 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <Phone className="h-4 w-4 text-slate-400" aria-hidden /> Emergency contact
        </h3>
        <dl>
          <DetailRow label="Name" value={member.emergencyName ?? '-'} />
          <DetailRow label="Relationship" value={member.emergencyRelationship ?? '-'} />
          <DetailRow label="Phone" value={member.emergencyPhone ?? '-'} />
        </dl>

        {member.notes && (
          <>
            <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-900 dark:text-slate-100">Notes</h3>
            <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700 dark:bg-navy-950/50 dark:text-slate-300">
              {member.notes}
            </p>
          </>
        )}

        <p className="mt-6 text-xs text-slate-400">
          Registered by {member.createdByName ?? 'system'} on {formatDateTime(member.createdAt)}.
          {member.updatedByName && ` Last updated by ${member.updatedByName} ${formatRelative(member.updatedAt)}.`}
        </p>
      </div>
    </div>
  );
}

function AttendanceTab({ query }: { query: any }) {
  if (query.isLoading) return <LoadingState label="Loading attendance history..." />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;

  const { records = [], summary } = query.data ?? {};

  if (records.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardCheck className="h-6 w-6" aria-hidden />}
        title="No attendance recorded"
        description="This member has not appeared on any register yet."
      />
    );
  }

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Present" value={summary.present} tone="text-emerald-600 dark:text-emerald-400" />
        <SummaryTile label="Absent" value={summary.absent} tone="text-red-600 dark:text-red-400" />
        <SummaryTile label="Excused" value={summary.excused} tone="text-amber-600 dark:text-amber-400" />
        <SummaryTile label="Attendance rate" value={`${summary.rate}%`} tone="text-navy-700 dark:text-navy-200" />
      </div>

      <div className="overflow-x-auto">
        <table className="cc-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Service</th>
              <th>Status</th>
              <th className="hidden sm:table-cell">Note</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record: any) => (
              <tr key={record.id}>
                <td className="tabular whitespace-nowrap">{formatDateShort(record.serviceDate)}</td>
                <td>{record.title ?? titleCase(record.serviceType)}</td>
                <td><AttendanceBadge status={record.status} /></td>
                <td className="hidden text-slate-500 sm:table-cell">{record.note ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: React.ReactNode; tone: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-navy-800">
      <p className="text-2xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`tabular mt-1 text-xl font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function FollowUpTab({ query, memberName }: { query: any; memberName: string }) {
  if (query.isLoading) return <LoadingState label="Loading follow-up history..." />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;

  const followUps: FollowUp[] = query.data?.followUps ?? [];

  if (followUps.length === 0) {
    return (
      <EmptyState
        icon={<PhoneCall className="h-6 w-6" aria-hidden />}
        title="No follow-ups on record"
        description={`${memberName} has never been flagged for absence follow-up. That is good news.`}
      />
    );
  }

  return (
    <ul className="space-y-3">
      {followUps.map((f) => (
        <li key={f.id}>
          <Link
            to={`/follow-ups/${f.id}`}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-4 transition hover:border-navy-300 hover:bg-slate-50 dark:border-navy-800 dark:hover:border-navy-600 dark:hover:bg-navy-800/50"
          >
            <LevelBadge level={f.level} />
            <FollowUpStatusBadge status={f.status} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-700 dark:text-slate-300">
                Absent {f.weeksAbsent} week(s).
                {f.lastAttendanceDate ? ` Last seen ${formatDateShort(f.lastAttendanceDate)}.` : ' No attendance on record.'}
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Opened {formatRelative(f.createdAt)}
                {f.assignedToName ? ` - assigned to ${f.assignedToName}` : ' - unassigned'}
                {f.noteCount > 0 ? ` - ${f.noteCount} note(s)` : ''}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ActivitiesTab({ member }: { member: MemberDetail }) {
  const items = [
    { label: 'Department', value: member.departmentName, icon: <Building2 className="h-4 w-4" aria-hidden />, to: member.departmentId ? `/departments/${member.departmentId}` : undefined },
    { label: 'Group / cell', value: member.groupName, icon: <UsersIcon className="h-4 w-4" aria-hidden />, to: member.groupId ? `/groups/${member.groupId}` : undefined },
    { label: 'Ministry', value: member.ministry, icon: <ShieldCheck className="h-4 w-4" aria-hidden /> },
  ];

  if (items.every((item) => !item.value)) {
    return (
      <EmptyState
        icon={<Building2 className="h-6 w-6" aria-hidden />}
        title="Not assigned to any department or group"
        description="Edit the profile to place this member in a department, cell group or ministry."
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const content = (
          <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-4 dark:border-navy-800">
            <span className="mt-0.5 text-slate-400">{item.icon}</span>
            <div className="min-w-0">
              <p className="text-2xs font-medium uppercase tracking-wide text-slate-400">{item.label}</p>
              <p className="mt-0.5 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                {item.value ?? 'Not assigned'}
              </p>
            </div>
          </div>
        );
        return item.to && item.value ? (
          <Link key={item.label} to={item.to} className="transition hover:opacity-80">
            {content}
          </Link>
        ) : (
          <div key={item.label}>{content}</div>
        );
      })}
    </div>
  );
}

function TimelineTab({ query }: { query: any }) {
  if (query.isLoading) return <LoadingState label="Loading activity..." />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;

  const timeline = query.data?.timeline ?? [];

  if (timeline.length === 0) {
    return <EmptyState icon={<Activity className="h-6 w-6" aria-hidden />} title="No recorded activity yet" />;
  }

  return (
    <ol className="relative space-y-5 border-l border-slate-200 pl-6 dark:border-navy-800">
      {timeline.map((event: any, index: number) => (
        <li key={index} className="relative">
          <span
            className="absolute -left-[1.9rem] top-1 h-2.5 w-2.5 rounded-full bg-navy-600 ring-4 ring-white dark:bg-navy-400 dark:ring-navy-900"
            aria-hidden
          />
          <p className="text-sm text-slate-800 dark:text-slate-200">{event.text}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {formatDateTime(event.at)}
            {event.actor ? ` - ${event.actor}` : ''}
          </p>
        </li>
      ))}
    </ol>
  );
}
