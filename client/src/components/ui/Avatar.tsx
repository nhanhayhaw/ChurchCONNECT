/**
 * Member avatar.
 *
 * Falls back to initials on a colour derived from the name, so a member with
 * no photograph still gets a stable, recognisable tile rather than a grey
 * placeholder identical to everyone else's.
 */
import { useState } from 'react';
import clsx from 'clsx';
import { initials } from '@/utils/format';

const FALLBACK_COLOURS = [
  'bg-navy-100 text-navy-800 dark:bg-navy-800 dark:text-navy-100',
  'bg-gold-100 text-gold-800 dark:bg-gold-900/40 dark:text-gold-200',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
];

/** Stable hash so a given member always gets the same colour. */
function colourFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return FALLBACK_COLOURS[Math.abs(hash) % FALLBACK_COLOURS.length]!;
}

const SIZES = {
  xs: 'h-7 w-7 text-2xs',
  sm: 'h-9 w-9 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-16 w-16 text-lg',
  xl: 'h-28 w-28 text-3xl',
} as const;

export function Avatar({
  src,
  name,
  size = 'sm',
  className,
  ring = false,
}: {
  src?: string | null;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
  ring?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = src && !failed;

  return (
    <span
      className={clsx(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold',
        SIZES[size],
        !showImage && colourFor(name),
        ring && 'ring-2 ring-white dark:ring-navy-900',
        className,
      )}
      title={name}
    >
      {showImage ? (
        <img
          src={src}
          alt={name}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden>{initials(name)}</span>
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}
