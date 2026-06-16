import { HTMLAttributes, ReactNode } from 'react';

export type ChipTone = 'pos' | 'neg' | 'neu' | 'warn' | 'ember' | 'ink' | 'ghost';

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  size?: 'xs' | 'sm';
  children: ReactNode;
}

const tones: Record<ChipTone, string> = {
  pos: 'bg-signal-pos-soft text-signal-pos',
  neg: 'bg-signal-neg-soft text-signal-neg',
  neu: 'bg-signal-neu-soft text-ink-soft',
  warn: 'bg-signal-warn/10 text-signal-warn',
  ember: 'bg-ember-soft text-ember',
  ink: 'bg-ink text-paper',
  ghost: 'bg-transparent text-ink-soft border border-rule',
};
export function Chip({ tone = 'neu', size = 'xs', className = '', children, ...rest }: ChipProps) {
  const sz = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[2px] font-semibold uppercase tracking-wider ${tones[tone]} ${sz} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
