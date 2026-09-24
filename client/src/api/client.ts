/**
 * API client.
 *
 * Design notes:
 *  - The access token lives in a module variable, never in localStorage. An
 *    XSS payload cannot read it from storage, and it dies with the tab. The
 *    refresh token is an httpOnly cookie the browser sends automatically.
 *  - A 401 triggers exactly one refresh attempt, and concurrent 401s share
 *    that single in-flight refresh rather than stampeding the endpoint.
 *  - Errors are normalised into ApiError so every screen can render
 *    `error.message` directly - the server already writes those for humans.
 */

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Registered by AuthProvider so a dead session redirects to the login page. */
export function setSessionLostHandler(fn: (() => void) | null): void {
  onSessionLost = fn;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Field-level messages from a 422, keyed by form field name. */
  readonly fields?: Record<string, string>;

  constructor(status: number, message: string, code = 'error', fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

async function parseError(response: Response): Promise<ApiError> {
  let message = 'Something went wrong. Please try again.';
  let code = 'error';
  let fields: Record<string, string> | undefined;

  try {
    const body = await response.json();
    if (body?.error) {
      message = body.error.message ?? message;
      code = body.error.code ?? code;
      fields = body.error.fields;
    }
  } catch {
    // Non-JSON response (proxy error page, network appliance) - keep the
    // generic message rather than showing raw HTML to the user.
    if (response.status === 502 || response.status === 503) {
      message = 'The server is not responding. Please check your connection and try again.';
    }
  }

  return new ApiError(response.status, message, code, fields);
}

/** Attempt a token refresh. Shared between concurrent callers. */
async function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        });
        if (!response.ok) return false;
        const body = await response.json();
        accessToken = body.accessToken;
        return true;
      } catch {
        return false;
      } finally {
        // Cleared on the next tick so callers awaiting this promise all see
        // the same result before a new attempt can begin.
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      }
    })();
  }
  return refreshPromise;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Set internally to stop a refresh loop. */
  _retried?: boolean;
  /** Skip the automatic refresh (used by the login/refresh calls themselves). */
  skipAuthRetry?: boolean;
}

export async function request<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, _retried, skipAuthRetry, ...rest } = options;

  const isFormData = body instanceof FormData;
  const init: RequestInit = {
    ...rest,
    credentials: 'include',
    headers: {
      ...(isFormData ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: isFormData ? body : JSON.stringify(body) } : {}),
  };

  const response = await fetch(path.startsWith('/') ? path : `/api/${path}`, init);

  if (response.status === 401 && !_retried && !skipAuthRetry) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request<T>(path, { ...options, _retried: true });
    }
    accessToken = null;
    onSessionLost?.();
    throw new ApiError(401, 'Your session has expired. Please sign in again.', 'unauthorized');
  }

  if (!response.ok) throw await parseError(response);

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return (await response.text()) as T;

  return response.json();
}

export const api = {
  get: <T = any>(path: string, params?: Record<string, unknown>) =>
    request<T>(params ? `${path}${buildQuery(params)}` : path),
  post: <T = any>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T = any>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T = any>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T = any>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Serialise params, dropping empty values so the URL stays readable. */
export function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === 'all') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Trigger a file download from an authenticated endpoint.
 *
 * The token is fetched into a blob rather than opening the URL directly, so
 * the access token never appears in browser history or server access logs.
 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });

  if (!response.ok) throw await parseError(response);

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick; revoking synchronously can cancel the download
  // in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Load a session-protected image and return an object URL for an <img>.
 *
 * The photo route requires the Bearer token, and a browser never sends
 * headers with a plain <img src>. So the bytes are fetched here with the
 * header, exactly as downloadFile does, and handed to the element as a
 * blob: URL. Results are cached by path: a members list renders one avatar
 * per row and must not refetch the same photo per render.
 */
const imageCache = new Map<string, Promise<string>>();

export function fetchImageObjectUrl(path: string): Promise<string> {
  const cached = imageCache.get(path);
  if (cached) return cached;

  const load = (async () => {
    const attempt = () =>
      fetch(path, {
        credentials: 'include',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });

    let response = await attempt();
    if (response.status === 401 && (await refreshSession())) response = await attempt();
    if (!response.ok) throw await parseError(response);

    return URL.createObjectURL(await response.blob());
  })();

  imageCache.set(path, load);
  // A failed load must not poison the cache: the photo may exist next time.
  load.catch(() => imageCache.delete(path));
  return load;
}
