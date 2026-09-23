/**
 * Debounce a rapidly changing value (search boxes, filter inputs).
 *
 * Keeping this in a hook rather than inside each component means the search
 * endpoint sees one request per pause in typing, not one per keystroke.
 */
import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
