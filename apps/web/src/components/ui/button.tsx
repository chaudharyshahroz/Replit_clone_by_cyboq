import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap ' +
  'transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary:
    'bg-surface-raised text-text border border-border-strong hover:bg-surface-hover hover:border-text-muted',
  ghost: 'text-text-secondary hover:text-text hover:bg-surface-hover',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-md',
  md: 'h-10 px-4 text-sm rounded-lg',
  lg: 'h-12 px-6 text-[15px] rounded-lg',
};

interface CommonProps {
  readonly variant?: Variant;
  readonly size?: Size;
  readonly className?: string;
  readonly children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: CommonProps & ComponentProps<'button'>) {
  return (
    <button className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: CommonProps & ComponentProps<typeof Link>) {
  const classes = `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`;

  /**
   * A same-page fragment gets a native anchor: jumping within the current page
   * is not a navigation, so it does not need the client router.
   */
  if (typeof rest.href === 'string' && rest.href.startsWith('#')) {
    const { href, ...anchorProps } = rest;
    return (
      <a href={href} className={classes} {...(anchorProps as ComponentProps<'a'>)}>
        {children}
      </a>
    );
  }

  return (
    <Link className={classes} {...rest}>
      {children}
    </Link>
  );
}
