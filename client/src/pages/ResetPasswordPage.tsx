/**
 * Set a new password from an emailed link.
 *
 * Reached at /reset-password?token=... — the destination of the link in the
 * password reset email. This page is deliberately public: the token in the URL
 * is the credential.
 *
 * The token is read once on mount and then removed from the address bar with
 * history.replaceState, so it does not sit in browser history, get copied into
 * a shared screenshot, or leak through a Referer header if the user clicks a
 * link from this page.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { KeyRound, ArrowLeft, CheckCircle2, AlertTriangle, Eye, EyeOff, ShieldCheck, PartyPopper } from 'lucide-react';
import { request, ApiError } from '@/api/client';
import { Card, Button, Input, LoadingState } from '@/components/ui';

interface TokenInfo {
  valid: boolean;
  purpose?: 'reset' | 'invite';
  fullName?: string;
  email?: string;
  roleLabel?: string;
  churchName?: string;
}

/** Mirrors the server's rule, so the user is told before a round trip. */
function describePassword(value: string) {
  return {
    length: value.length >= 10,
    lower: /[a-z]/.test(value),
    upper: /[A-Z]/.test(value),
    digit: /[0-9]/.test(value),
  };
}

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  // Capture the token, then scrub it from the URL.
  useEffect(() => {
    const fromUrl = params.get('token');
    if (fromUrl) {
      setToken(fromUrl);
      window.history.replaceState({}, '', '/reset-password');
    }
    // params is intentionally not a dependency: this must run once, before the
    // replaceState above changes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Ask the server what this token is for. The same page serves a password
   * reset and a first-time invitation, and greeting a new volunteer with
   * "Choose a new password" when they have never had one is confusing.
   */
  const info = useQuery({
    queryKey: ['token-info', token],
    queryFn: () =>
      request<TokenInfo>('/api/auth/token-info', {
        method: 'POST',
        body: { token },
        skipAuthRetry: true,
      }),
    enabled: Boolean(token),
    retry: false,
  });

  const isInvite = info.data?.purpose === 'invite';

  const submit = useMutation({
    mutationFn: () =>
      request('/api/auth/reset-password', {
        method: 'POST',
        body: { token, newPassword: password },
        skipAuthRetry: true,
      }),
    onSuccess: () => setDone(true),
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.fields) setErrors(err.fields);
        setErrors((prev) => ({ ...prev, form: err.message }));
      } else {
        setErrors({ form: 'Could not reach the server. Please check your connection and try again.' });
      }
    },
  });

  const rules = describePassword(password);
  const allRulesMet = Object.values(rules).every(Boolean);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};

    if (!allRulesMet) next.password = 'Please meet all four requirements below.';
    if (password !== confirm) next.confirm = 'The two passwords do not match.';

    setErrors(next);
    if (Object.keys(next).length > 0) return;
    submit.mutate();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12 dark:bg-navy-950">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <img src="/logo.svg" alt="" className="h-11 w-11 rounded-xl" aria-hidden />
          <div>
            <p className="text-sm font-semibold tracking-widest text-navy-900 dark:text-white">RT AG CONNECT</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isInvite ? 'Welcome — set your password' : 'Choose a new password'}
            </p>
          </div>
        </div>

        <Card>
          {/* --- Checking the token ------------------------------------------ */}
          {token && info.isLoading && !done && <LoadingState label="Checking your link..." />}

          {/* --- Token is dead ------------------------------------------------ */}
          {token && !info.isLoading && info.data?.valid === false && !done && (
            <div className="p-6 text-center">
              <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                <AlertTriangle className="h-6 w-6" aria-hidden />
              </span>
              <h1 className="text-base font-semibold text-slate-900 dark:text-white">This link has expired</h1>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Links can be used once, and they do not last indefinitely. Ask a church administrator to send you a new
                one, or request a password reset yourself.
              </p>
              <Link
                to="/forgot-password"
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-navy-700 hover:underline dark:text-navy-300"
              >
                Request a new link
              </Link>
            </div>
          )}

          {/* --- No token in the link --------------------------------------- */}
          {!token && !done && (
            <div className="p-6 text-center">
              <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                <AlertTriangle className="h-6 w-6" aria-hidden />
              </span>
              <h1 className="text-base font-semibold text-slate-900 dark:text-white">This link is not complete</h1>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Open the link from your email exactly as it was sent. Some email apps break long links across two
                lines — if so, copy the whole address into your browser.
              </p>
              <Link
                to="/forgot-password"
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-navy-700 hover:underline dark:text-navy-300"
              >
                Request a new link
              </Link>
            </div>
          )}

          {/* --- Success ---------------------------------------------------- */}
          {done && (
            <div className="p-6 text-center">
              <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
                {isInvite ? <PartyPopper className="h-6 w-6" aria-hidden /> : <CheckCircle2 className="h-6 w-6" aria-hidden />}
              </span>
              <h1 className="text-base font-semibold text-slate-900 dark:text-white">
                {isInvite ? 'Your account is ready' : 'Your password has been reset'}
              </h1>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                {isInvite
                  ? 'Sign in with the email address your invitation was sent to, and the password you just chose.'
                  : 'You have been signed out everywhere else. Sign in with your new password.'}
              </p>
              <Button fullWidth size="lg" className="mt-6" onClick={() => navigate('/login', { replace: true })}>
                Go to sign in
              </Button>
            </div>
          )}

          {/* --- The form --------------------------------------------------- */}
          {token && info.data?.valid && !done && (
            <form onSubmit={onSubmit} className="p-6" noValidate>
              {isInvite ? (
                <>
                  <h1 className="text-base font-semibold text-slate-900 dark:text-white">
                    Welcome{info.data.fullName ? `, ${info.data.fullName.split(' ')[0]}` : ''}
                  </h1>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    You have been given access to the {info.data.churchName} membership system
                    {info.data.roleLabel ? ` as ${info.data.roleLabel}` : ''}. Choose a password to finish setting up
                    your account.
                  </p>
                  {info.data.email && (
                    <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-navy-950/50 dark:text-slate-400">
                      You will sign in with <strong className="break-all">{info.data.email}</strong>
                    </p>
                  )}
                </>
              ) : (
                <>
                  <h1 className="text-base font-semibold text-slate-900 dark:text-white">Choose a new password</h1>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Pick something you do not use anywhere else.
                  </p>
                </>
              )}

              {errors.form && (
                <div
                  role="alert"
                  className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-300"
                >
                  {errors.form}
                  {/Invalid|expired/i.test(errors.form) && (
                    <>
                      {' '}
                      <Link to="/forgot-password" className="font-medium underline">
                        Request a new link
                      </Link>
                      .
                    </>
                  )}
                </div>
              )}

              <div className="relative mt-5">
                <Input
                  label={isInvite ? 'Choose a password' : 'New password'}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errors.password) setErrors((p) => ({ ...p, password: '' }));
                  }}
                  error={errors.password ?? errors.newPassword}
                  autoComplete="new-password"
                  className="pr-10"
                  required
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-[2.15rem] text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-300"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                </button>
              </div>

              {/* Live requirements. Showing progress beats a rejection after submit. */}
              <ul className="mt-3 space-y-1" aria-live="polite">
                <Rule met={rules.length}>At least 10 characters</Rule>
                <Rule met={rules.upper}>One capital letter</Rule>
                <Rule met={rules.lower}>One small letter</Rule>
                <Rule met={rules.digit}>One number</Rule>
              </ul>

              <Input
                label={isInvite ? 'Confirm your password' : 'Confirm new password'}
                type={showPassword ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  if (errors.confirm) setErrors((p) => ({ ...p, confirm: '' }));
                }}
                error={errors.confirm}
                autoComplete="new-password"
                containerClassName="mt-4"
                required
              />

              <Button
                type="submit"
                fullWidth
                size="lg"
                className="mt-5"
                isLoading={submit.isPending}
                leftIcon={<KeyRound className="h-4 w-4" aria-hidden />}
              >
                {isInvite ? 'Set my password' : 'Set new password'}
              </Button>

              {!isInvite && (
                <Link
                  to="/login"
                  className="mt-5 flex items-center justify-center gap-1.5 text-sm font-medium text-navy-700 hover:underline dark:text-navy-300"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden /> Back to sign in
                </Link>
              )}
            </form>
          )}
        </Card>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          This link can be used once and expires shortly after it was sent.
        </p>
      </div>
    </div>
  );
}

function Rule({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      <span
        className={
          met
            ? 'flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
            : 'flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-navy-800 dark:text-slate-500'
        }
        aria-hidden
      >
        {met ? <CheckCircle2 className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      </span>
      <span className={met ? 'text-slate-700 dark:text-slate-300' : 'text-slate-500 dark:text-slate-400'}>
        {children}
      </span>
      <span className="sr-only">{met ? '(met)' : '(not yet met)'}</span>
    </li>
  );
}
