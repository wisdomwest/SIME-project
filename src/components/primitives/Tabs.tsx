import { ReactNode, useState, useRef, useEffect } from 'react';

interface TabsProps {
  tabs: { id: string; label: string; count?: number; icon?: ReactNode }[];
  active: string;
  onChange: (id: string) => void;
  size?: 'sm' | 'md';
}

export function Tabs({ tabs, active, onChange, size = 'md' }: TabsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [underline, setUnderline] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>(`[data-tab="${active}"]`);
    if (el && ref.current) {
      const parent = ref.current.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      setUnderline({ left: rect.left - parent.left, width: rect.width });
    }
  }, [active, tabs]);

  const tabSize = size === 'sm' ? 'text-xs px-3 py-1.5' : 'text-sm px-4 py-2.5';
  return (
    <div className="relative border-b border-rule" ref={ref}>
      <div className="flex gap-1 overflow-x-auto no-scrollbar">
        {tabs.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              data-tab={t.id}
              onClick={() => onChange(t.id)}
              className={`relative inline-flex items-center gap-2 font-medium whitespace-nowrap transition-colors duration-150 ${tabSize} ${
                isActive ? 'text-ink' : 'text-ink-mute hover:text-ink-soft'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
              {typeof t.count === 'number' && (
                <span className="font-mono text-[10px] text-ink-mute">·{t.count.toLocaleString()}</span>
              )}
            </button>
          );
        })}
      </div>
      <span
        className="absolute bottom-[-1px] h-[1.5px] bg-ember transition-all duration-200"
        style={{ left: underline.left, width: underline.width }}
      />
    </div>
  );
}
