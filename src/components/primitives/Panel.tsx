import { ReactNode } from 'react';

export function Panel({
  eyebrow,
  title,
  description,
  action,
  children,
  padded = true,
  className = '',
}: {
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return (
    <section className={`bg-paper border border-rule ${padded ? 'p-6' : ''} ${className}`}>
      {(eyebrow || title || action) && (
        <header className={`flex items-start justify-between gap-4 ${padded ? 'mb-5 pb-4 border-b border-rule' : 'px-6 py-4 border-b border-rule'}`}>
          <div className="space-y-1.5 min-w-0">
            {eyebrow}
            {title && (
              <h2
                className="font-display text-2xl font-light text-ink tracking-[-0.01em]"
                style={{ fontVariationSettings: "'opsz' 72, 'SOFT' 100" }}
              >
                {title}
              </h2>
            )}
            {description && <p className="text-sm text-ink-soft max-w-2xl">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {padded ? <div>{children}</div> : children}
    </section>
  );
}
