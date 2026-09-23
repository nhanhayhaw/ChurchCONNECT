/**
 * Authentication state.
 *
 * On mount the provider tries a silent refresh. If the httpOnly refresh cookie
 * is still valid the user lands straight back in the app; otherwise they see
 * the login page. That is what makes a page reload feel seamless without ever
 * putting a token in localStorage.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, request, setAccessToken, setSessionLostHandler, ApiError } from '@/api/client';
import type { AuthUser } from '@/types';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string, rememberMe: boolean) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /** True when the user's role grants the permission (or holds the wildcard). */
  can: (permission: string) => boolean;
  canAny: (...permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Silent restore on first load.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const body = await request<{ user: AuthUser; accessToken: string }>('/api/auth/refresh', {
          method: 'POST',
          skipAuthRetry: true,
        });
        if (cancelled) return;
        setAccessToken(body.accessToken);
        setUser(body.user);
      } catch {
        // No valid session - this is the normal first-visit path, not an error.
        if (!cancelled) {
          setAccessToken(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // When a refresh fails mid-session, drop the user back to the login screen.
  useEffect(() => {
    setSessionLostHandler(() => {
      setUser(null);
      setAccessToken(null);
    });
    return () => setSessionLostHandler(null);
  }, []);

  const login = useCallback(async (email: string, password: string, rememberMe: boolean) => {
    const body = await request<{ user: AuthUser; accessToken: string }>('/api/auth/login', {
      method: 'POST',
      body: { email, password, rememberMe },
      skipAuthRetry: true,
    });
    setAccessToken(body.accessToken);
    setUser(body.user);
    return body.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch (err) {
      // A failed logout call still ends the session locally; the refresh token
      // expires on its own.
      if (!(err instanceof ApiError)) console.error(err);
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const body = await api.get<{ user: AuthUser }>('/api/auth/me');
    setUser(body.user);
  }, []);

  const can = useCallback(
    (permission: string) => {
      if (!user) return false;
      return user.permissions.includes('*') || user.permissions.includes(permission);
    },
    [user],
  );

  const canAny = useCallback(
    (...permissions: string[]) => permissions.some((p) => can(p)),
    [can],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: user !== null,
      login,
      logout,
      refreshUser,
      can,
      canAny,
    }),
    [user, isLoading, login, logout, refreshUser, can, canAny],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider.');
  return context;
}
