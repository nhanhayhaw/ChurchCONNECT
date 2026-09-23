/**
 * Client entry point.
 *
 * The error boundary here is the last line of defence: a render crash should
 * show a church administrator something they can act on, not a blank page.
 */
import { StrictMode, Component, type ReactNode, type ErrorInfo } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // In production this is where a reporting service would be called.
    console.error('[RT AG Connect] render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 dark:bg-navy-950">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-card dark:border-navy-800 dark:bg-navy-900">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            RT AG Connect ran into an unexpected problem on this screen. Your data has not been affected.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-800"
            >
              Reload the page
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = '/';
              }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-navy-700 dark:text-slate-200 dark:hover:bg-navy-800"
            >
              Back to dashboard
            </button>
          </div>
          {import.meta.env.DEV && (
            <pre className="mt-4 overflow-auto rounded bg-slate-100 p-3 text-left text-2xs text-slate-600 dark:bg-navy-950 dark:text-slate-400">
              {this.state.error.message}
            </pre>
          )}
        </div>
      </div>
    );
  }
}

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root was not found in index.html.');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
