import { HTMLAttributes } from 'react';

interface EyebrowProps extends HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
  accent?: boolean;
}

/**
 * Issue-style metadata marker. `REPORT N°037 · 24 JUNE 2024 · 6,397 ACCOUNTS`
 * Always paired with a 1px ember rule under the section title that follows.
 */
export function Eyebrow({ children, accent = false, className = '', ...rest }: EyebrowProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${
        accent ? 'text-ember' : 'text-ink-mute'
      } ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
