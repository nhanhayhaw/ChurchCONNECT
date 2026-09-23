/**
 * Toast notifications.
 *
 * Every mutation in the app reports its outcome here. Success messages come
 * straight from the API response (`message` field), so the wording a user sees
 * is decided once, on the server, and stays consistent across screens.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, X, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';

type ToastTone = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (tone: ToastTone, title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_CONFIG: Record<ToastTone, { icon: typeof CheckCircle2; classes: string; iconClass: string }> = {
  success: {
    icon: CheckCircle2,
    classes: 'border-emerald-200 bg-white dark:border-emerald-800/60 dark:bg-navy-900',
    iconClass: 'text-emerald-600 dark:text-emerald-400',
  },
  error: {
    icon: AlertCircle,
    classes: 'border-red-200 bg-white dark:border-red-800/60 dark:bg-navy-900',
    iconClass: 'text-red-600 dark:text-red-400',
  },
  warning: {
    icon: AlertTriangle,
    classes: 'border-amber-200 bg-white dark:border-amber-800/60 dark:bg-navy-900',
    iconClass: 'text-amber-600 dark:text-amber-400',
  },
  info: {
    icon: Info,
    classes: 'border-navy-200 bg-white dark:border-navy-700 dark:bg-navy-900',
    iconClass: 'text-navy-600 dark:text-navy-300',
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (tone: ToastTone, title: string, description?: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, title, description }]);
      // Errors linger longer - they usually need reading, not just noticing.
      window.setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) => toast('success', title, description),
      error: (title, description) => toast('error', title, description),
      info: (title, description) => toast('info', title, description),
      warning: (title, description) => toast('warning', title, description),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const config = TONE_CONFIG[t.tone];
          const Icon = config.icon;
          return (
            <div
              key={t.id}
              className={clsx(
                'pointer-events-auto flex animate-slide-up items-start gap-3 rounded-xl border p-3.5 shadow-panel',
                config.classes,
              )}
            >
              <Icon className={clsx('mt-0.5 h-5 w-5 shrink-0', config.iconClass)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{t.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-navy-800 dark:hover:text-slate-200"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider.');
  return context;
}
