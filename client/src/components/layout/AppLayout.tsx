/**
 * Authenticated application shell and route guards.
 */
import { useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { LoadingState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';

export function AppLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-navy-950">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col lg:ml-64">
        <Topbar onOpenSidebar={() => setIsSidebarOpen(true)} />
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-6 lg:py-8">
          <Outlet />
        </main>
        <footer className="no-print border-t border-slate-200 px-4 py-4 text-center text-xs text-slate-400 dark:border-navy-800 lg:px-6">
          RT AG Connect - Connecting People. Strengthening the Church.
        </footer>
      </div>
    </div>
  );
}

/** Blocks unauthenticated access and preserves the intended destination. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-navy-950">
        <LoadingState label="Restoring your session..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

/**
 * Permission guard for a whole page.
 *
 * The navigation already hides links a role cannot use; this catches the case
 * where someone types or bookmarks the URL directly.
 */
export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAuth();

  if (!can(permission)) {
    return (
      <div className="cc-card">
        <EmptyState
          icon={<ShieldAlert className="h-6 w-6" aria-hidden />}
          title="You do not have access to this page"
          description="Your role does not include this permission. If you believe you should have access, ask a Super Administrator to review your role."
          action={
            <Button variant="outline" onClick={() => window.history.back()}>
              Go back
            </Button>
          }
        />
      </div>
    );
  }

  return <>{children}</>;
}
