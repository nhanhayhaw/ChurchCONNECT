/**
 * Shared API types.
 *
 * These mirror the JSON the server returns. They are hand-written rather than
 * generated so the client can stay decoupled from server internals, but the
 * field names match exactly - the server does the camelCase mapping.
 */

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type Gender = 'male' | 'female';
export type MembershipStatus = 'active' | 'inactive' | 'transferred' | 'deceased';
export type AttendanceStatus = 'present' | 'absent' | 'excused';
export type FollowUpStatus =
  | 'pending' | 'contacted' | 'responded' | 'needs_further_follow_up' | 'resolved' | 'unable_to_reach';

export interface AuthUser {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  roleId: number;
  roleName: string;
  roleLabel: string;
  permissions: string[];
  departmentId: number | null;
  departmentName: string | null;
  memberId: number | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

export interface MemberListItem {
  id: number;
  memberCode: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  fullName: string;
  gender: Gender;
  dateOfBirth: string | null;
  phone: string | null;
  email: string | null;
  membershipStatus: MembershipStatus;
  membershipCategory: string;
  dateJoined: string;
  departmentId: number | null;
  departmentName: string | null;
  groupId: number | null;
  groupName: string | null;
  photoUrl: string | null;
  age: number | null;
  lastAttendanceDate: string | null;
}

export interface MemberDetail extends MemberListItem {
  maritalStatus: string | null;
  nationality: string | null;
  altPhone: string | null;
  address: string | null;
  baptismStatus: string;
  communionStatus: string;
  ministry: string | null;
  emergencyName: string | null;
  emergencyRelationship: string | null;
  emergencyPhone: string | null;
  notes: string | null;
  daysToBirthday: number | null;
  createdByName: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceSummary {
  id: number;
  serviceDate: string;
  serviceType: string;
  serviceTypeLabel: string;
  title: string | null;
  departmentId: number | null;
  departmentName: string | null;
  groupId: number | null;
  groupName: string | null;
  isFinalized: boolean;
  present: number;
  absent: number;
  excused: number;
  totalRecorded: number;
  attendanceRate: number;
  recordedByName: string | null;
  createdAt: string;
}

export interface RegisterEntry {
  memberId: number;
  memberCode: string;
  fullName: string;
  gender: Gender;
  departmentName: string | null;
  photoUrl: string | null;
  status: AttendanceStatus | null;
  note: string | null;
}

export interface AbsenceAlert {
  memberId: number;
  memberCode: string;
  fullName: string;
  phone: string | null;
  departmentId: number | null;
  departmentName: string | null;
  consecutiveMissed: number;
  level: 1 | 2 | 3;
  levelLabel: string;
  lastAttendanceDate: string | null;
  weeksAbsent: number;
  openFollowUpId: number | null;
  openFollowUpStatus: string | null;
}

export interface FollowUp {
  id: number;
  memberId: number;
  memberCode: string;
  memberName: string;
  memberPhone: string | null;
  photoUrl: string | null;
  departmentName: string | null;
  level: number;
  levelLabel: string;
  weeksAbsent: number;
  lastAttendanceDate: string | null;
  status: FollowUpStatus;
  statusLabel: string;
  source: 'auto' | 'manual';
  assignedToId: number | null;
  assignedToName: string | null;
  assignedAt: string | null;
  lastContactAt: string | null;
  nextFollowUpDate: string | null;
  resolvedAt: string | null;
  noteCount: number;
  isOverdue: boolean;
  createdAt: string;
}

export interface FollowUpNote {
  id: number;
  note: string;
  contactMethod: string | null;
  statusAtTime: string | null;
  author: string | null;
  createdAt: string;
}

export interface Birthday {
  memberId: number;
  memberCode: string;
  fullName: string;
  photoUrl: string | null;
  dateOfBirth: string;
  nextBirthday: string;
  birthdayLabel: string;
  daysAway: number;
  turningAge: number | null;
  currentAge: number | null;
  departmentName: string | null;
  groupName: string | null;
  phone: string | null;
  isToday: boolean;
}

export interface Department {
  id: number;
  name: string;
  description: string | null;
  meetingDay: string | null;
  meetingTime: string | null;
  isActive: boolean;
  leaderMemberId: number | null;
  leaderName: string | null;
  leaderPhone: string | null;
  memberCount: number;
  maleCount: number;
  femaleCount: number;
}

export interface Group {
  id: number;
  name: string;
  groupType: string;
  groupTypeLabel: string;
  description: string | null;
  meetingDay: string | null;
  meetingTime: string | null;
  meetingLocation: string | null;
  isActive: boolean;
  leaderMemberId: number | null;
  leaderName: string | null;
  leaderPhone: string | null;
  memberCount: number;
}

export interface AppNotification {
  id: number;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string | null;
  link: string | null;
  entityType: string | null;
  entityId: number | null;
  isRead: boolean;
  createdAt: string;
}

export interface DashboardData {
  generatedAt: string;
  membership: {
    total: number; active: number; inactive: number;
    male: number; female: number; newThisMonth: number; newLast90Days: number;
  };
  attendance: {
    today: { present: number; recorded: number; rate: number };
    thisWeek: { present: number; recorded: number; rate: number };
    thisMonth: { present: number; recorded: number; rate: number };
  };
  absence: { absentTwoWeeks: number; absentThreeWeeks: number; absentOneMonth: number; totalFlagged: number };
  followUps: {
    pending: number; contacted: number; responded: number; needsFurther: number;
    resolved: number; unableToReach: number; open: number; overdue: number;
  };
  birthdays: { today: number; thisWeek: number; thisMonth: number; upcoming: Birthday[] };
  charts: {
    attendanceTrend: { date: string; present: number; absent: number; excused: number; total: number }[];
    membershipGrowth: { month: string; newMembers: number; totalMembers: number }[];
    genderDistribution: { name: string; value: number }[];
    departmentDistribution: { name: string; value: number }[];
    ageDistribution: { bucket: string; value: number }[];
    attendanceComparison: { serviceType: string; label: string; present: number; absent: number; excused: number }[];
  };
  recentServices: {
    id: number; serviceDate: string; serviceType: string; title: string | null;
    isFinalized: boolean; present: number; recorded: number;
  }[];
}

export interface AdminUser {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  isLocked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roleId: number;
  roleName: string;
  roleLabel: string;
  departmentId: number | null;
  departmentName: string | null;
  /** An invitation has been sent and not yet used. */
  invitePending: boolean;
  /** The account has never been signed in to. */
  neverSignedIn: boolean;
}

export interface AuditEntry {
  id: number;
  userId: number | null;
  userName: string;
  userEmail: string | null;
  userRole: string | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  description: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
