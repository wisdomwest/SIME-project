import { ButtonHTMLAttributes, AnchorHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'ghost' | 'link' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: 'link';
  size?: 'sm' | 'md';
}

const base = 'inline-flex items-center gap-2 font-medium tracking-tight transition-all duration-[120ms] focus:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-40 disabled:cursor-not-allowed';

const sizes: Record<Size, string> = {
  sm: 'text-xs px-3 py-1.5',
  md: 'text-sm px-4 py-2',
  lg: 'text-base px-5 py-2.5',
};

const variants: Record<Variant, string> = {
  primary:
    'bg-ink text-paper hover:bg-ink-soft active:translate-y-[1px]',
  ghost:
    'bg-transparent text-ink border border-rule hover:border-ink hover:bg-paper-2',
  link:
    'bg-transparent text-ember underline underline-offset-4 decoration-ember/40 hover:decoration-ember px-0 py-0',
  danger:
    'bg-transparent text-signal-neg border border-signal-neg/40 hover:bg-signal-neg-soft',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, ...rest }, ref) => (
    <button
      ref={ref}
      className={`${base} ${variants[variant]} ${variant !== 'link' ? sizes[size] : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(
  ({ variant = 'link', size = 'md', className = '', children, ...rest }, ref) => (
    <a
      ref={ref}
      className={`${base} ${variants[variant]} ${variant !== 'link' ? sizes[size] : ''} ${className}`}
      {...rest}
    >
      {children}
    </a>
  ),
);
LinkButton.displayName = 'LinkButton';
