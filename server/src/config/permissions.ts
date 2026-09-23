/**
 * Permission catalogue and the default role -> permission mapping.
 *
 * Permissions are plain "resource:action" strings. Routes declare what they
 * need (see middleware/rbac.ts); roles carry a list of what they hold. Adding
 * a capability therefore means touching two places, never a chain of if/else.
 *
 * The wildcard "*" is honoured only for the Super Administrator.
 */

export const PERMISSIONS = [
  // Members
  'members:read',
  'members:create',
  'members:update',
  'members:delete',
  'members:export',
  // Attendance
  'attendance:read',
  'attendance:record',
  'attendance:delete',
  // Follow-ups
  'followups:read',
  'followups:manage',
  // Birthdays
  'birthdays:read',
  // Departments & groups
  'departments:read',
  'departments:manage',
  'groups:read',
  'groups:manage',
  // Reports & dashboard
  'reports:read',
  'reports:export',
  'dashboard:read',
  // Administration
  'users:read',
  'users:manage',
  'settings:read',
  'settings:manage',
  'audit:read',
  'notifications:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_NAMES = {
  SUPER_ADMIN: 'super_admin',
  PASTOR: 'pastor',
  CHURCH_ADMIN: 'church_admin',
  DEPARTMENT_LEADER: 'department_leader',
  VIEWER: 'viewer',
} as const;

export type RoleName = (typeof ROLE_NAMES)[keyof typeof ROLE_NAMES];

interface RoleDefinition {
  name: RoleName;
  label: string;
  description: string;
  permissions: string[];
}

/**
 * Default roles seeded into the `roles` table. A Super Administrator may edit
 * the permission array of any non-system role afterwards from Settings.
 */
export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    name: ROLE_NAMES.SUPER_ADMIN,
    label: 'Super Administrator',
    description: 'Unrestricted access, including user management, settings and audit logs.',
    permissions: ['*'],
  },
  {
    name: ROLE_NAMES.PASTOR,
    label: 'Pastor',
    description: 'Full visibility of members, attendance, follow-ups and reports. Read-only on records.',
    permissions: [
      'members:read',
      'attendance:read',
      'followups:read',
      'followups:manage', // a pastor closes their own pastoral visits
      'birthdays:read',
      'departments:read',
      'groups:read',
      'reports:read',
      'reports:export',
      'dashboard:read',
      'notifications:read',
    ],
  },
  {
    name: ROLE_NAMES.CHURCH_ADMIN,
    label: 'Church Administrator',
    description: 'Day-to-day administration: registration, attendance, departments, groups and follow-ups.',
    permissions: [
      'members:read',
      'members:create',
      'members:update',
      'members:export',
      'attendance:read',
      'attendance:record',
      'attendance:delete',
      'followups:read',
      'followups:manage',
      'birthdays:read',
      'departments:read',
      'departments:manage',
      'groups:read',
      'groups:manage',
      'reports:read',
      'reports:export',
      'dashboard:read',
      'notifications:read',
    ],
  },
  {
    name: ROLE_NAMES.DEPARTMENT_LEADER,
    label: 'Department Leader',
    description: 'Sees and follows up members of their own department only.',
    permissions: [
      'members:read',
      'attendance:read',
      'attendance:record',
      'followups:read',
      'followups:manage',
      'birthdays:read',
      'departments:read',
      'groups:read',
      'reports:read',
      'dashboard:read',
      'notifications:read',
    ],
  },
  {
    name: ROLE_NAMES.VIEWER,
    label: 'Viewer',
    description: 'Read-only access to members, attendance and reports.',
    permissions: [
      'members:read',
      'attendance:read',
      'followups:read',
      'birthdays:read',
      'departments:read',
      'groups:read',
      'reports:read',
      'dashboard:read',
      'notifications:read',
    ],
  },
];

/** True when a permission list satisfies the required permission. */
export function hasPermission(held: string[], required: string): boolean {
  return held.includes('*') || held.includes(required);
}
