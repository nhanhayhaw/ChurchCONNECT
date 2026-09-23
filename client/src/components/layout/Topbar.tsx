/**
 * Application top bar: global search, notification centre, theme switch and
 * the account menu.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  Menu, Search, Bell, Sun, Moon, LogOut, KeyRound, ChevronDown, Loader2, X,
  UserCircle2, AlertTriangle, Cake, Info,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useDebounced } from '@/hooks/useDebounced';
import { Avatar } from '@/components/ui/Avatar';
import { formatRelative } from '@/utils/format';
import type { AppNotification } from '@/types';

export function Topbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const { user, logout } = useAuth();
  const { isDark, toggle } = useTheme();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur dark:border-navy-800 dark:bg-navy-900/95 lg:px-6">
      <button
        type="button"
        onClick={onOpenSidebar}
        className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-navy-800 lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>

      <GlobalSearch />

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={toggle}
          className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-navy-800"
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun className="h-5 w-5" aria-hidden /> : <Moon className="h-5 w-5" aria-hidden />}
        </button>

        <NotificationBell />

        <AccountMenu
          name={user?.fullName ?? ''}
          role={user?.roleLabel ?? ''}
          onSignOut={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
        />
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Global search
// ---------------------------------------------------------------------------

function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const debounced = useDebounced(term, 250);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get(`/api/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.trim().length >= 2,
    staleTime: 30_000,
  });

  // Close on outside click.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // "/" focuses search, the way every admin tool the user already knows does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
      if (event.key === '/' && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const go = (path: string) => {
    setIsOpen(false);
    setTerm('');
    navigate(path);
  };

  const hasResults = data && data.total > 0;

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <label htmlFor="global-search" className="sr-only">
        Search members, departments and groups
      </label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
      <input
        id="global-search"
        ref={inputRef}
        type="search"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        placeholder="Search members, departments, groups..."
        className="cc-input h-10 pl-9 pr-9"
        autoComplete="off"
      />
      {term && (
        <button
          type="button"
          onClick={() => {
            setTerm('');
            inputRef.current?.focus();
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}

      {isOpen && debounced.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-panel dark:border-navy-700 dark:bg-navy-900">
          {isFetching && (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Searching...
            </div>
          )}

          {!isFetching && !hasResults && (
            <p className="px-3 py-4 text-sm text-slate-500 dark:text-slate-400">
              Nothing matched &ldquo;{debounced}&rdquo;. Try a member name, Member ID or phone number.
            </p>
          )}

          {hasResults && (
            <>
              {data.members.length > 0 && (
                <SearchSection label="Members">
                  {data.members.map((m: any) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => go(`/members/${m.id}`)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-navy-800"
                    >
                      <Avatar src={m.photoUrl} name={m.fullName} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {m.fullName}
                        </span>
                        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                          {m.memberCode}
                          {m.departmentName ? ` - ${m.departmentName}` : ''}
                          {m.phone ? ` - ${m.phone}` : ''}
                        </span>
                      </span>
                    </button>
                  ))}
                </SearchSection>
              )}

              {data.departments.length > 0 && (
                <SearchSection label="Departments">
                  {data.departments.map((d: any) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => go(`/departments/${d.id}`)}
                      className="block w-full rounded-lg px-2 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-navy-800"
                    >
                      {d.name}
                    </button>
                  ))}
                </SearchSection>
              )}

              {data.groups.length > 0 && (
                <SearchSection label="Groups">
                  {data.groups.map((g: any) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => go(`/groups/${g.id}`)}
                      className="block w-full rounded-lg px-2 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-navy-800"
                    >
                      {g.name}
                    </button>
                  ))}
                </SearchSection>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SearchSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1 last:mb-0">
      <p className="px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

const NOTIFICATION_ICONS: Record<string, typeof Bell> = {
  absence_alert: AlertTriangle,
  followup_due: AlertTriangle,
  followup_overdue: AlertTriangle,
  birthday: Cake,
  new_member: UserCircle2,
  system: Info,
};

function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => api.get<{ notifications: AppNotification[]; unreadCount: number }>('/api/notifications?limit=12'),
    // Alerts are generated by a nightly job, so a slow poll is plenty.
    refetchInterval: 120_000,
  });

  const markRead = useMutation({
    mutationFn: (id: number) => api.post(`/api/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAll = useMutation({
    mutationFn: () => api.post('/api/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const unread = data?.unreadCount ?? 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="relative rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-navy-800"
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}
        aria-expanded={isOpen}
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-2xs font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel dark:border-navy-700 dark:bg-navy-900">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-navy-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Notifications</h3>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markAll.mutate()}
                className="text-xs font-medium text-navy-700 hover:underline dark:text-navy-300"
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {!data?.notifications.length && (
              <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                You are all caught up.
              </p>
            )}

            {data?.notifications.map((n) => {
              const Icon = NOTIFICATION_ICONS[n.type] ?? Bell;
              const body = (
                <>
                  <span
                    className={clsx(
                      'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
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
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{n.title}</span>
                    {n.body && (
                      <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{n.body}</span>
                    )}
                    <span className="mt-1 block text-2xs text-slate-400">{formatRelative(n.createdAt)}</span>
                  </span>
                  {!n.isRead && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-navy-600" aria-label="Unread" />}
                </>
              );

              const className = clsx(
                'flex w-full gap-3 border-b border-slate-100 px-4 py-3 text-left transition last:border-b-0',
                'hover:bg-slate-50 dark:border-navy-800 dark:hover:bg-navy-800/60',
                !n.isRead && 'bg-navy-50/40 dark:bg-navy-800/30',
              );

              return n.link ? (
                <Link
                  key={n.id}
                  to={n.link}
                  className={className}
                  onClick={() => {
                    if (!n.isRead) markRead.mutate(n.id);
                    setIsOpen(false);
                  }}
                >
                  {body}
                </Link>
              ) : (
                <button
                  key={n.id}
                  type="button"
                  className={className}
                  onClick={() => !n.isRead && markRead.mutate(n.id)}
                >
                  {body}
                </button>
              );
            })}
          </div>

          <Link
            to="/notifications"
            onClick={() => setIsOpen(false)}
            className="block border-t border-slate-200 px-4 py-2.5 text-center text-xs font-medium text-navy-700 transition hover:bg-slate-50 dark:border-navy-800 dark:text-navy-300 dark:hover:bg-navy-800"
          >
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account menu
// ---------------------------------------------------------------------------

function AccountMenu({ name, role, onSignOut }: { name: string; role: string; onSignOut: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={containerRef} className="relative ml-1">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition hover:bg-slate-100 dark:hover:bg-navy-800"
        aria-expanded={isOpen}
        aria-label="Account menu"
      >
        <Avatar name={name} size="sm" />
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block max-w-32 truncate text-xs font-medium text-slate-900 dark:text-slate-100">
            {name}
          </span>
          <span className="block max-w-32 truncate text-2xs text-slate-500 dark:text-slate-400">{role}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-panel dark:border-navy-700 dark:bg-navy-900">
          <div className="border-b border-slate-100 px-4 py-3 dark:border-navy-800">
            <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{name}</p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{role}</p>
          </div>
          <Link
            to="/change-password"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-navy-800"
          >
            <KeyRound className="h-4 w-4" aria-hidden /> Change password
          </Link>
          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
