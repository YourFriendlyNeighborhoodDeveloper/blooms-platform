import { useRef, type ReactNode, type PointerEvent as ReactPointerEvent, type MouseEventHandler } from 'react';
import { Link } from 'react-router';
import { motion, useMotionValue, useSpring } from 'motion/react';
import { cn } from '../../lib/cn';
import { useFinePointer } from '../../hooks/useMediaQuery';

type Variant = 'solid' | 'outline' | 'light' | 'ghost-light' | 'rose';

type Props = {
  children: ReactNode;
  to?: string;
  href?: string;
  external?: boolean;
  onClick?: MouseEventHandler<HTMLElement>;
  type?: 'button' | 'submit';
  variant?: Variant;
  size?: 'md' | 'lg';
  icon?: ReactNode;
  className?: string;
  magnetic?: boolean;
  ariaLabel?: string;
  cursor?: string;
};

const VARIANTS: Record<Variant, { base: string; fill: string; hoverText: string }> = {
  solid: { base: 'bg-charcoal text-ivory', fill: 'bg-blush', hoverText: 'group-hover:text-charcoal' },
  outline: { base: 'border border-charcoal/70 text-charcoal', fill: 'bg-charcoal', hoverText: 'group-hover:text-ivory' },
  light: { base: 'bg-ivory text-charcoal', fill: 'bg-gold', hoverText: 'group-hover:text-ink' },
  'ghost-light': { base: 'border border-ivory/50 text-ivory', fill: 'bg-ivory', hoverText: 'group-hover:text-charcoal' },
  rose: { base: 'bg-rose-deep text-ivory', fill: 'bg-charcoal', hoverText: 'group-hover:text-ivory' },
};

/**
 * Pill button with a fill that blooms from the point the pointer enters,
 * a rolling label and an optional magnetic pull.
 */
export function Button({
  children,
  to,
  href,
  external,
  onClick,
  type = 'button',
  variant = 'solid',
  size = 'md',
  icon,
  className,
  magnetic = true,
  ariaLabel,
  cursor,
}: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const fine = useFinePointer();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(mx, { stiffness: 220, damping: 16, mass: 0.4 });
  const y = useSpring(my, { stiffness: 220, damping: 16, mass: 0.4 });
  const v = VARIANTS[variant];

  const setOrigin = (e: ReactPointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--fx', `${e.clientX - r.left}px`);
    el.style.setProperty('--fy', `${e.clientY - r.top}px`);
  };
  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!magnetic || !fine) return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - (r.left + r.width / 2)) * 0.28);
    my.set((e.clientY - (r.top + r.height / 2)) * 0.38);
  };
  const onLeave = (e: ReactPointerEvent<HTMLElement>) => {
    setOrigin(e);
    mx.set(0);
    my.set(0);
  };

  const inner = (
    <span
      ref={ref}
      className={cn(
        'relative isolate inline-flex items-center justify-center gap-3 overflow-hidden rounded-full font-medium tracking-[0.01em] transition-colors duration-500',
        size === 'lg' ? 'h-14 px-8 text-[0.98rem]' : 'h-12 px-6 text-[0.92rem]',
        v.base,
        v.hoverText,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute -z-10 aspect-square w-[260%] -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-100 group-focus-visible:scale-100',
          v.fill,
        )}
        style={{ left: 'var(--fx, 50%)', top: 'var(--fy, 50%)' }}
      />
      <span className="relative block overflow-hidden">
        <span className="block transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-full">{children}</span>
        <span aria-hidden="true" className="absolute inset-0 block translate-y-full transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-y-0">
          {children}
        </span>
      </span>
      {icon && <span className="relative transition-transform duration-500 group-hover:translate-x-1">{icon}</span>}
    </span>
  );

  const common = {
    className: cn('group relative inline-flex rounded-full', className),
    onPointerEnter: setOrigin,
    onPointerMove: onMove,
    onPointerLeave: onLeave,
    onClick,
    'aria-label': ariaLabel,
    'data-cursor': cursor,
  };

  const body = <motion.span className="inline-flex" style={{ x, y }}>{inner}</motion.span>;

  if (to) {
    return (
      <Link to={to} {...common}>
        {body}
      </Link>
    );
  }
  if (href) {
    return (
      <a href={href} {...common} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {body}
      </a>
    );
  }
  return (
    <button type={type} {...common}>
      {body}
    </button>
  );
}

export function Arrow({ className, direction = 'right' }: { className?: string; direction?: 'right' | 'down' | 'up-right' }) {
  const rotate = direction === 'down' ? 90 : direction === 'up-right' ? -45 : 0;
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" className={className} aria-hidden="true" style={{ transform: `rotate(${rotate}deg)` }}>
      <path d="M4 12h15m0 0-6-6m6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
