/**
 * Sign-in page.
 *
 * Deliberately calm: a branded panel on the left for identity, the form on the
 * right. Nothing moves, nothing animates while typing. The error message is
 * whatever the API returned, which never distinguishes "no such account" from
 * "wrong password".
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail, ArrowRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ApiError, request } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input, Checkbox } from '@/components/ui/Form';
import { LoadingState } from '@/components/ui/States';

export default function LoginPage() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [branding, setBranding] = useState({ churchName: 'RT AG Connect', tagline: 'Connecting People. Strengthening the Church.' });

  // The church's own name on the login screen, fetched before sign-in.
  useEffect(() => {
    request('/api/auth/branding', { skipAuthRetry: true })
      .then((data) => setBranding(data))
      .catch(() => undefined); // keep the defaults if the API is not up yet
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-navy-950">
        <LoadingState label="Loading..." />
      </div>
    );
  }

  if (isAuthenticated) {
    const from = (location.state as any)?.from?.pathname ?? '/';
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const user = await login(email.trim(), password, rememberMe);
      const from = (location.state as any)?.from?.pathname ?? '/';
      navigate(user.mustChangePassword ? '/change-password' : from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.fields) setFieldErrors(err.fields);
      } else {
        setError('Could not reach the server. Please check your connection and try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-white dark:bg-navy-950">
      {/* Brand panel - hidden on small screens where it would push the form
          below the fold. */}
      <div className="relative hidden w-1/2 flex-col justify-between bg-navy-900 p-12 lg:flex">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, #B8892B 0, transparent 45%), radial-gradient(circle at 80% 70%, #ffffff 0, transparent 40%)',
          }}
          aria-hidden
        />

        <div className="relative flex items-center gap-3">
          <img src="/logo.svg" alt="" className="h-11 w-11 rounded-xl" aria-hidden />
          <div>
            <p className="text-sm font-semibold tracking-widest text-white">RT AG CONNECT</p>
            <p className="text-xs text-navy-300">Membership &amp; Follow-Up Management</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight text-white">{branding.churchName}</h1>
          <p className="mt-3 text-lg text-gold-300">{branding.tagline}</p>
          <p className="mt-6 text-sm leading-relaxed text-navy-200">
            Know who your members are, who attended, who has been absent, who needs a visit, and whose
            birthday is coming up - all in one place.
          </p>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-navy-300">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          Member information is confidential and access is recorded.
        </div>
      </div>

      {/* Form */}
      <div className="flex w-full items-center justify-center px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <img src="/logo.svg" alt="" className="h-11 w-11 rounded-xl" aria-hidden />
            <div>
              <p className="text-sm font-semibold tracking-widest text-navy-900 dark:text-white">RT AG CONNECT</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{branding.tagline}</p>
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">Welcome back</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Sign in to continue to {branding.churchName}.
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-300"
              >
                {error}
              </div>
            )}

            <Input
              label="Email address"
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@church.org"
              autoComplete="username"
              leftIcon={<Mail className="h-4 w-4" aria-hidden />}
              error={fieldErrors.email}
              required
              autoFocus
            />

            <div>
              <div className="relative">
                <Input
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  leftIcon={<Lock className="h-4 w-4" aria-hidden />}
                  error={fieldErrors.password}
                  className="pr-10"
                  required
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
            </div>

            <div className="flex items-center justify-between">
              <Checkbox
                label="Remember me"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <Link
                to="/forgot-password"
                className="text-sm font-medium text-navy-700 hover:underline dark:text-navy-300"
              >
                Forgot password?
              </Link>
            </div>

            <Button
              type="submit"
              fullWidth
              size="lg"
              isLoading={isSubmitting}
              rightIcon={<ArrowRight className="h-4 w-4" aria-hidden />}
            >
              Sign in
            </Button>
          </form>

          <p className="mt-8 text-center text-xs text-slate-400">
            Access to member information is logged for the protection of the congregation.
          </p>
        </div>
      </div>
    </div>
  );
}
