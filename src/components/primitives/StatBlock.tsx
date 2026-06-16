import { ReactNode } from 'react';
import { Sparkline } from './Sparkline';
import { Info } from 'lucide-react';

interface StatBlockProps {
  label: string;
  value: string;
  caption?: string;
  spark?: number[];
  explainer?: string;
  emphasis?: 'ember' | 'ink' | 'pos' | 'neg' | 'neu' | 'warn';
}

const emphasisClass: Record<NonNullable<StatBlockProps['emphasis']>, string> = {
  ember: 'text-ember',
  ink: 'text-ink',
  pos: 'text-signal-pos',
  neg: 'text-signal-neg',
  neu: 'text-ink-soft',
  warn: 'text-signal-warn',
};

export function StatBlock({ label, value, caption, spark, explainer, emphasis = 'ink' }: StatBlockProps) {
  return (
    <div className="flex flex-col gap-2 py-5">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute">{label}</span>
        {explainer && <Explainer text={explainer} />}
      </div>
      <div className="flex items-baseline gap-3">
        <span
          className={`font-display text-[2.75rem] leading-none tracking-[-0.02em] font-light ${emphasisClass[emphasis]}`}
          style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 100" }}
        >
          {value}
        </span>
        {spark && spark.length > 1 && <Sparkline values={spark} />}
      </div>
      {caption && <span className="text-xs text-ink-mute">{caption}</span>}
    </div>
  );
}

export function Explainer({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <Info
        size={11}
        className="text-ink-mute hover:text-ember transition-colors cursor-help"
        aria-label="What this means"
      />
      <span className="pointer-events-none absolute left-0 top-full z-50 mt-2 w-72 border border-rule bg-paper p-4 text-xs font-body font-normal normal-case tracking-normal text-ink shadow-[0_2px_0_0_rgba(26,26,26,0.04)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-x-8 gap-y-2 divide-x divide-rule [&>*:not(:first-child)]:pl-8 [&>*:first-child]:pl-0">
      {children}
    </div>
  );
}
