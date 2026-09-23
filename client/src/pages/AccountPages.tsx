/**
 * Account self-service: change password, forgot password, and the 404 page.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, ArrowLeft, MailCheck, Compass, ShieldCheck } from 'lucide-react';
import { api, request, ApiError } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader, Card, CardHeader, Button, Input, EmptyState } from '@/components/ui';

// ---------------------------------------------------------------------------

export function ChangePasswordPage() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const change = useMutation({
    mutationFn: () =>
      api.post('/api/auth/change-password', { currentPassword: form.current, newPassword: form.next }),
    onSuccess: async (response) => {
      toast.success('Password updated', response.message);
      // The server revokes every session, so sign out locally and start again.
      await logout();
      navigate('/login', { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.fields) setErrors(err.fields);
        toast.error('Could not change the password', err.message);
      }
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};

    if (!form.current) next.current = 'Please enter your current password.';
    if (form.next.length < 10) next.next = 'New password must be at least 10 characters long.';
    else if (!(/[a-z]/.test(form.next) && /[A-Z]/.test(form.next) && /[0-9]/.test(form.next))) {
      next.next = 'Include an upper case letter, a lower case letter and a number.';
    }
    if (form.next !== form.confirm) next.confirm = 'The two passwords do not match.';

    setErrors(next);
    if (Object.keys(next).length > 0) return;
    change.mutate();
  };

  return (
    <>
      <PageHeader
        title="Change your password"
        description={
          user?.mustChangePassword
            ? 'Your account requires a new password before you continue.'
            : 'Choose something you do not use anywhere else.'
        }
      />

      <Card className="max-w-lg">
        <CardHeader title="New password" description="You will be signed out of every device afterwards." />
        <form onSubmit={onSubmit} className="space-y-4 p-5" noValidate>
          <Input
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={form.current}
            onChange={(e) => setForm((f) => ({ ...f, current: e.target.value }))}
            error={errors.current}
            required
            autoFocus
          />
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            value={form.next}
            onChange={(e) => setForm((f) => ({ ...f, next: e.target.value }))}
            error={errors.next ?? errors.newPassword}
            hint="At least 10 characters, with upper case, lower case and a number."
            required
          />
          <Input
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
            error={errors.confirm}
            required
          />

          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" isLoading={change.isPending} leftIcon={<KeyRound className="h-4 w-4" />}>
              Update password
            </Button>
            {!user?.mustChangePassword && (
              <Button variant="outline" onClick={() => navigate(-1)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  // Whether the SERVER can send mail. This is a property of the deployment, not
  // of the address entered, so exposing it reveals nothing about who has an
  // account - it only lets the page give accurate instructions.
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [error, setError] = useState('');

  const submit = useMutation({
    mutationFn: () =>
      request('/api/auth/forgot-password', { method: 'POST', body: { email: email.trim() }, skipAuthRetry: true }),
    onSuccess: (response: any) => {
      setSent(true);
      setEmailEnabled(response.emailEnabled !== false);
      // Outside production the API returns the token, so the flow can be
      // completed before any SMTP server exists. Never returned in production.
      if (response.devToken) setDevToken(response.devToken);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not reach the server.'),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12 dark:bg-navy-950">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <img src="/logo.svg" alt="" className="h-11 w-11 rounded-xl" aria-hidden />
          <div>
            <p className="text-sm font-semibold tracking-widest text-navy-900 dark:text-white">RT AG CONNECT</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Password recovery</p>
          </div>
        </div>

        <Card>
          {sent ? (
            <div className="p-6 text-center">
              <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
                <MailCheck className="h-6 w-6" aria-hidden />
              </span>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                {emailEnabled ? 'Check your inbox' : 'Ask your administrator'}
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                {emailEnabled ? (
                  <>
                    If that email address belongs to an account, a reset link is on its way. It expires shortly, so
                    use it soon. <strong>Check your spam folder</strong> if it has not arrived in a few minutes.
                  </>
                ) : (
                  <>
                    If that email address belongs to an account, a reset has been prepared. This system is not set up
                    to send email yet, so ask a Super Administrator to complete the reset for you from Users &amp;
                    Roles.
                  </>
                )}
              </p>

              {devToken && (
                <div className="mt-4 rounded-lg bg-amber-50 p-3 text-left text-xs dark:bg-amber-900/20">
                  <p className="font-medium text-amber-900 dark:text-amber-200">Development mode</p>
                  <p className="mt-1 text-amber-800 dark:text-amber-300">
                    Email delivery is bypassed. Use this link directly:
                  </p>
                  <a
                    href={`/reset-password?token=${devToken}`}
                    className="mt-1 block break-all font-mono text-amber-900 underline dark:text-amber-200"
                  >
                    /reset-password?token={devToken}
                  </a>
                </div>
              )}

              <Link
                to="/login"
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-navy-700 hover:underline dark:text-navy-300"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden /> Back to sign in
              </Link>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
                  setError('Please enter a valid email address.');
                  return;
                }
                setError('');
                submit.mutate();
              }}
              className="p-6"
              noValidate
            >
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">Forgot your password?</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Enter the email address on your account and we will prepare a reset.
              </p>

              <Input
                label="Email address"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError('');
                }}
                error={error}
                containerClassName="mt-5"
                required
                autoFocus
              />

              <Button type="submit" fullWidth size="lg" className="mt-4" isLoading={submit.isPending}>
                Send reset instructions
              </Button>

              <Link
                to="/login"
                className="mt-5 flex items-center justify-center gap-1.5 text-sm font-medium text-navy-700 hover:underline dark:text-navy-300"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden /> Back to sign in
              </Link>
            </form>
          )}
        </Card>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          We never reveal whether an email address is registered.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Card>
      <EmptyState
        icon={<Compass className="h-6 w-6" aria-hidden />}
        title="That page does not exist"
        description="The link may be out of date, or the record may have been removed."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(-1)}>
              Go back
            </Button>
            <Button onClick={() => navigate('/')}>Back to dashboard</Button>
          </div>
        }
      />
    </Card>
  );
}
