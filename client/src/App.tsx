/**
 * Application routes.
 *
 * Heavy screens are lazily loaded so the initial bundle stays small - a church
 * office on a slow connection should not download the charting library just to
 * sign in.
 *
 * Every protected route carries the permission it needs. The sidebar hides
 * links a role cannot use; RequirePermission is the backstop for a typed or
 * bookmarked URL.
 */
import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import { AppLayout, RequireAuth, RequirePermission } from '@/components/layout/AppLayout';
import { LoadingState } from '@/components/ui/States';
import { ApiError } from '@/api/client';

import LoginPage from '@/pages/LoginPage';
import { ChangePasswordPage, ForgotPasswordPage, NotFoundPage } from '@/pages/AccountPages';

const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const MembersPage = lazy(() => import('@/pages/MembersPage'));
const MemberFormPage = lazy(() => import('@/pages/MemberFormPage'));
const MemberProfilePage = lazy(() => import('@/pages/MemberProfilePage'));
const AttendancePage = lazy(() => import('@/pages/AttendancePage'));
const ServiceRegisterPage = lazy(() =>
  import('@/pages/AttendancePage').then((m) => ({ default: m.ServiceRegisterPage })),
);
const RecordAttendancePage = lazy(() => import('@/pages/RecordAttendancePage'));
const AbsenceAlertsPage = lazy(() => import('@/pages/AbsenceAlertsPage'));
const FollowUpsPage = lazy(() => import('@/pages/FollowUpsPage'));
const FollowUpDetailPage = lazy(() =>
  import('@/pages/FollowUpsPage').then((m) => ({ default: m.FollowUpDetailPage })),
);
const BirthdaysPage = lazy(() => import('@/pages/BirthdaysPage'));
const DepartmentsPage = lazy(() => import('@/pages/DepartmentsPage'));
const DepartmentDetailPage = lazy(() =>
  import('@/pages/DepartmentsPage').then((m) => ({ default: m.DepartmentDetailPage })),
);
const GroupsPage = lazy(() => import('@/pages/GroupsPage'));
const GroupDetailPage = lazy(() => import('@/pages/GroupsPage').then((m) => ({ default: m.GroupDetailPage })));
const ReportsPage = lazy(() => import('@/pages/ReportsPage'));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'));
const UsersPage = lazy(() => import('@/pages/UsersPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const AuditLogsPage = lazy(() => import('@/pages/AuditLogsPage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Church data changes on the order of hours, not seconds.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Never retry an auth or permission failure - it will not get better,
        // and retrying a 401 fights with the token refresh in api/client.ts.
        if (error instanceof ApiError && [401, 403, 404, 422].includes(error.status)) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

/** Wraps a lazily loaded page in its permission guard and a suspense fallback. */
function Protected({ permission, children }: { permission: string; children: React.ReactNode }) {
  return (
    <RequirePermission permission={permission}>
      <Suspense fallback={<LoadingState />}>{children}</Suspense>
    </RequirePermission>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              {/* Public */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              {/* Public by design: the token in the query string is the credential. */}
              <Route
                path="/reset-password"
                element={
                  <Suspense fallback={<LoadingState />}>
                    <ResetPasswordPage />
                  </Suspense>
                }
              />

              {/* Authenticated */}
              <Route
                element={
                  <RequireAuth>
                    <AppLayout />
                  </RequireAuth>
                }
              >
                <Route index element={<Protected permission="dashboard:read"><DashboardPage /></Protected>} />

                <Route path="members">
                  <Route index element={<Protected permission="members:read"><MembersPage /></Protected>} />
                  <Route path="new" element={<Protected permission="members:create"><MemberFormPage /></Protected>} />
                  <Route path=":id" element={<Protected permission="members:read"><MemberProfilePage /></Protected>} />
                  <Route path=":id/edit" element={<Protected permission="members:update"><MemberFormPage /></Protected>} />
                </Route>

                <Route path="attendance">
                  <Route index element={<Protected permission="attendance:read"><AttendancePage /></Protected>} />
                  <Route path="record" element={<Protected permission="attendance:record"><RecordAttendancePage /></Protected>} />
                  <Route path="services/:id" element={<Protected permission="attendance:read"><ServiceRegisterPage /></Protected>} />
                </Route>

                <Route path="follow-ups">
                  <Route index element={<Protected permission="followups:read"><FollowUpsPage /></Protected>} />
                  <Route path="alerts" element={<Protected permission="followups:read"><AbsenceAlertsPage /></Protected>} />
                  <Route path=":id" element={<Protected permission="followups:read"><FollowUpDetailPage /></Protected>} />
                </Route>

                <Route path="birthdays" element={<Protected permission="birthdays:read"><BirthdaysPage /></Protected>} />

                <Route path="departments">
                  <Route index element={<Protected permission="departments:read"><DepartmentsPage /></Protected>} />
                  <Route path=":id" element={<Protected permission="departments:read"><DepartmentDetailPage /></Protected>} />
                </Route>

                <Route path="groups">
                  <Route index element={<Protected permission="groups:read"><GroupsPage /></Protected>} />
                  <Route path=":id" element={<Protected permission="groups:read"><GroupDetailPage /></Protected>} />
                </Route>

                <Route path="reports" element={<Protected permission="reports:read"><ReportsPage /></Protected>} />
                <Route path="notifications" element={<Protected permission="notifications:read"><NotificationsPage /></Protected>} />
                <Route path="users" element={<Protected permission="users:read"><UsersPage /></Protected>} />
                <Route path="settings" element={<Protected permission="settings:read"><SettingsPage /></Protected>} />
                <Route path="audit-logs" element={<Protected permission="audit:read"><AuditLogsPage /></Protected>} />

                <Route path="change-password" element={<ChangePasswordPage />} />
                <Route path="404" element={<NotFoundPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>

              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
