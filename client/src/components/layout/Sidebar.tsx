/**
 * Primary navigation.
 *
 * Items declare the permission they need; anything the signed-in role cannot
 * use is not rendered at all. A Viewer therefore never sees a "Users & Roles"
 * link that would only refuse them - the navigation tells the truth about what
 * this person can do.
 */
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, UserPlus, UserX, ClipboardCheck, CalendarCheck, History,
  BellRing, PhoneCall, ClipboardList, Cake, Building2, Boxes, FileBarChart,
  Bell, ShieldCheck, Settings, ScrollText, ChevronDown, X,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/context/AuthContext';

interface NavItem {
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
  permission?: string;
  end?: boolean;
}

interface NavGroup {
  label: string;
  icon: typeof LayoutDashboard;
  permission?: string;
  basePath: string;
  children: NavItem[];
}

type NavEntry = NavItem | NavGroup;

const isGroup = (entry: NavEntry): entry is NavGroup => 'children' in entry;

const NAVIGATION: NavEntry[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, permission: 'dashboard:read', end: true },
  {
    label: 'Members',
    icon: Users,
    permission: 'members:read',
    basePath: '/members',
    children: [
      { label: 'All Members', to: '/members', icon: Users, end: true },
      { label: 'Add Member', to: '/members/new', icon: UserPlus, permission: 'members:create' },
      { label: 'Inactive Members', to: '/members?status=inactive', icon: UserX },
    ],
  },
  {
    label: 'Attendance',
    icon: ClipboardCheck,
    permission: 'attendance:read',
    basePath: '/attendance',
    children: [
      { label: 'Record Attendance', to: '/attendance/record', icon: CalendarCheck, permission: 'attendance:record' },
      { label: 'Attendance History', to: '/attendance', icon: History, end: true },
    ],
  },
  {
    label: 'Follow-Up',
    icon: PhoneCall,
    permission: 'followups:read',
    basePath: '/follow-ups',
    children: [
      { label: 'Alerts', to: '/follow-ups/alerts', icon: BellRing },
      { label: 'Pending', to: '/follow-ups?scope=open', icon: ClipboardList, end: true },
      { label: 'Follow-Up History', to: '/follow-ups?scope=all', icon: History },
    ],
  },
  { label: 'Birthdays', to: '/birthdays', icon: Cake, permission: 'birthdays:read' },
  { label: 'Departments', to: '/departments', icon: Building2, permission: 'departments:read' },
  { label: 'Groups', to: '/groups', icon: Boxes, permission: 'groups:read' },
  { label: 'Reports', to: '/reports', icon: FileBarChart, permission: 'reports:read' },
  { label: 'Notifications', to: '/notifications', icon: Bell, permission: 'notifications:read' },
  { label: 'Users & Roles', to: '/users', icon: ShieldCheck, permission: 'users:read' },
  { label: 'Settings', to: '/settings', icon: Settings, permission: 'settings:read' },
  { label: 'Audit Logs', to: '/audit-logs', icon: ScrollText, permission: 'audit:read' },
];

export function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { can, user } = useAuth();
  const location = useLocation();

  // Groups start expanded when the current route is inside them.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const entry of NAVIGATION) {
      if (isGroup(entry)) initial[entry.label] = location.pathname.startsWith(entry.basePath);
    }
    return initial;
  });

  const visible = NAVIGATION.filter((entry) => !entry.permission || can(entry.permission));

  return (
    <>
      {/* Mobile scrim */}
      <div
        className={clsx(
          'fixed inset-0 z-30 bg-navy-950/50 backdrop-blur-sm transition-opacity lg:hidden',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden
      />

      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-navy-900 transition-transform duration-200',
          'lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Main navigation"
      >
        {/* Brand */}
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-navy-800 px-4">
          <NavLink to="/" className="flex min-w-0 items-center gap-2.5" onClick={onClose}>
            <img src="/logo.svg" alt="" className="h-9 w-9 shrink-0 rounded-lg" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold tracking-wide text-white">
                RT AG CONNECT
              </span>
              <span className="block truncate text-2xs text-navy-300">Membership &amp; Follow-Up</span>
            </span>
          </NavLink>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-navy-300 hover:bg-navy-800 hover:text-white lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* Links */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          {visible.map((entry) => {
            if (!isGroup(entry)) {
              return <SidebarLink key={entry.to} item={entry} onNavigate={onClose} />;
            }

            const children = entry.children.filter((child) => !child.permission || can(child.permission));
            if (children.length === 0) return null;

            const isOpenGroup = expanded[entry.label] ?? false;
            const isActiveGroup = location.pathname.startsWith(entry.basePath);
            const Icon = entry.icon;

            return (
              <div key={entry.label}>
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => ({ ...prev, [entry.label]: !prev[entry.label] }))}
                  aria-expanded={isOpenGroup}
                  className={clsx(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                    isActiveGroup ? 'text-white' : 'text-navy-200 hover:bg-navy-800 hover:text-white',
                  )}
                >
                  <Icon className="shrink-0" style={{ width: 18, height: 18 }} aria-hidden />
                  <span className="flex-1 text-left">{entry.label}</span>
                  <ChevronDown
                    className={clsx('h-4 w-4 shrink-0 transition-transform', isOpenGroup && 'rotate-180')}
                    aria-hidden
                  />
                </button>

                {isOpenGroup && (
                  <div className="ml-4 mt-0.5 space-y-0.5 border-l border-navy-800 pl-3">
                    {children.map((child) => (
                      <SidebarLink key={child.to} item={child} onNavigate={onClose} nested />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Signed-in role */}
        <div className="shrink-0 border-t border-navy-800 px-4 py-3">
          <p className="truncate text-xs font-medium text-white">{user?.fullName}</p>
          <p className="truncate text-2xs text-navy-300">{user?.roleLabel}</p>
        </div>
      </aside>
    </>
  );
}

function SidebarLink({
  item,
  onNavigate,
  nested = false,
}: {
  item: NavItem;
  onNavigate: () => void;
  nested?: boolean;
}) {
  const Icon = item.icon;
  const location = useLocation();

  // NavLink alone cannot distinguish "/members?status=inactive" from
  // "/members", so query-bearing links compare the full location.
  const [path, search] = item.to.split('?');
  const matchesQuery = search
    ? location.pathname === path && location.search.includes(search)
    : undefined;

  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) => {
        const active = matchesQuery ?? (isActive && (!search ? !location.search.includes('status=inactive') : true));
        return clsx(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
          nested ? 'py-1.5 text-xs' : 'font-medium',
          active
            ? 'bg-navy-800 text-white shadow-sm ring-1 ring-inset ring-navy-700'
            : 'text-navy-200 hover:bg-navy-800/60 hover:text-white',
        );
      }}
    >
      <Icon style={{ width: nested ? 15 : 18, height: nested ? 15 : 18 }} className="shrink-0" aria-hidden />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}
