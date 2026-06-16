import { ReactNode } from 'react';

interface MethodButtonProps {
  title: string;
  description: string;
  icon?: ReactNode;
  onClick?: () => void;
  status?: 'idle' | 'loading' | 'done' | 'error';
}

export function MethodButton({ title, description, icon, onClick, status = 'idle' }: MethodButtonProps) {
  return (
    <button
      onClick={onClick}
      className="group w-full text-left border border-rule bg-paper p-4 hover:border-ink transition-colors duration-150"
    >
      <div className="flex items-start gap-3">
        {icon && (
          <div className="shrink-0 w-9 h-9 border border-rule flex items-center justify-center text-ink-soft group-hover:text-ember group-hover:border-ember transition-colors">
            {icon}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-base text-ink font-normal leading-tight">{title}</h3>
            <span className="text-[10px] font-mono uppercase tracking-wider text-ink-mute">{statusLabel(status)}</span>
          </div>
          <p className="text-xs text-ink-soft mt-1 leading-relaxed">{description}</p>
        </div>
      </div>
    </button>
  );
}

function statusLabel(s: MethodButtonProps['status']): string {
  if (s === 'loading') return 'running';
  if (s === 'done') return 'ready';
  if (s === 'error') return 'failed';
  return 'idle';
}
