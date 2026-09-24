/**
 * Resolve an image source that may sit behind the API's session check.
 *
 * Paths under /api are fetched with the Bearer token and returned as a
 * blob: URL. Anything else (a data: preview from a file picker, an external
 * logo URL) is passed through untouched. Returns null while loading or when
 * the fetch fails, so callers fall back to their placeholder.
 */
import { useEffect, useState } from 'react';
import { fetchImageObjectUrl } from '@/api/client';

const needsAuth = (src: string) => src.startsWith('/api/');

export function useAuthedImage(src: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (src && !needsAuth(src) ? src : null));

  useEffect(() => {
    if (!src) {
      setUrl(null);
      return;
    }
    if (!needsAuth(src)) {
      setUrl(src);
      return;
    }

    let cancelled = false;
    setUrl(null);
    fetchImageObjectUrl(src)
      .then((objectUrl) => {
        if (!cancelled) setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  return url;
}
