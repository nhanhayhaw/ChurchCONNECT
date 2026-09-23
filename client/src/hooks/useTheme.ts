/**
 * Light/dark theme.
 *
 * Light is the default, per the brief. The choice is stored in localStorage and
 * applied to <html> before first paint by an inline script in index.html, so
 * there is no flash of the wrong theme on reload.
 */
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'cc-theme';

export type Theme = 'light' | 'dark';

function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(currentTheme);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing with storage disabled - the theme still applies for
      // this session, it simply is not remembered.
    }
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  // Follow the OS only while the user has never made an explicit choice.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem(STORAGE_KEY)) return;
      } catch {
        return;
      }
      document.documentElement.classList.toggle('dark', event.matches);
      setThemeState(event.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return { theme, isDark: theme === 'dark', setTheme, toggle };
}
