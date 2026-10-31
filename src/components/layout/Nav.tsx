import { useEffect, useRef, useState, type RefObject } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { business, links, concept } from '../../data/business';
import { cn } from '../../lib/cn';
import { useLenis } from './SmoothScroll';
import { BloomMark } from '../fx/BloomMark';

export const NAV_LINKS = [
  { to: '/flowers', label: 'Flowers' },
  { to: '/weddings-events', label: 'Weddings & Events' },
  { to: '/rentals', label: 'Rentals' },
  { to: '/boutique', label: 'Boutique' },
  { to: '/about', label: 'About & Contact' },
] as const;

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" className={className} aria-hidden="true">
      <path
        d="M5 4h3.2l1.6 4-2 1.3a11 11 0 0 0 5 5l1.3-2 4 1.6V17a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Rolling-letter link label. */
function RollLabel({ children }: { children: string }) {
  return (
    <span className="relative block overflow-hidden">
      <span className="block transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-full">{children}</span>
      <span aria-hidden="true" className="absolute inset-0 block translate-y-full italic transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-y-0 font-display">
        {children}
      </span>
    </span>
  );
}

export function Nav() {
  const location = useLocation();
  const lenis = useLenis();
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [dark, setDark] = useState(false);
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let last = window.scrollY;
    let raf = 0;
    const check = () => {
      raf = 0;
      const y = window.scrollY;
      setScrolled(y > 40);
      if (Math.abs(y - last) > 6) {
        setHidden(y > last && y > 160);
        last = y;
      }
      const stack = document.elementsFromPoint(window.innerWidth / 2, 36);
      const section = stack.find((el) => !headerRef.current?.contains(el) && el.closest('[data-nav]'));
      setDark(section?.closest<HTMLElement>('[data-nav]')?.dataset.nav === 'dark');
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    const settle = window.setTimeout(check, 1200);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.clearTimeout(settle);
      cancelAnimationFrame(raf);
    };
  }, [location.pathname]);

  useEffect(() => {
    setOpen(false);
    setHidden(false);
  }, [location.pathname]);

  useEffect(() => {
    if (open) lenis?.stop();
    else lenis?.start();
    document.documentElement.style.overflow = open ? 'hidden' : '';
    document.documentElement.toggleAttribute('data-menu-open', open);
  }, [open, lenis]);

  const onDark = dark && !open;

  return (
    <>
      <a
        href="#main"
        className="fixed top-3 left-3 z-[120] -translate-y-24 rounded-full bg-charcoal px-5 py-3 text-sm text-ivory focus-visible:translate-y-0"
      >
        Skip to content
      </a>
      <motion.header
        ref={headerRef}
        data-theme={onDark || open ? 'dark' : undefined}
        className="fixed inset-x-0 top-0 z-[60]"
        animate={{ y: hidden && !open ? '-110%' : '0%' }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <div
          className={cn(
            'absolute inset-0 -z-10 transition-all duration-700',
            scrolled && !open ? (onDark ? 'bg-ink/45 backdrop-blur-xl' : 'bg-ivory/70 backdrop-blur-xl') : 'bg-transparent',
          )}
        />
        <div className={cn('shell flex h-[4.5rem] items-center justify-between gap-6 transition-colors duration-500 lg:h-20', onDark || open ? 'text-ivory' : 'text-charcoal')}>
          <Link to="/" className="group relative z-[2] flex items-center gap-3" aria-label={`${business.name} — home`}>
            <BloomMark size={30} tone={onDark || open ? 'dark' : 'light'} className="transition-transform duration-700 group-hover:rotate-[72deg]" />
            <span className="flex flex-col leading-none">
              <span className="font-display text-[1.45rem] tracking-[-0.02em]" style={{ fontVariationSettings: "'SOFT' 100, 'WONK' 1" }}>
                Blooms
              </span>
              <span className="mt-1 text-[0.58rem] font-semibold tracking-[0.24em] uppercase opacity-70">Boutique &amp; Floral</span>
            </span>
          </Link>

          <nav aria-label="Primary" className="hidden lg:block">
            <ul className="flex items-center gap-7 xl:gap-9">
              {NAV_LINKS.map((l) => (
                <li key={l.to}>
                  <NavLink to={l.to} className="group relative block py-2 text-[0.92rem]">
                    {({ isActive }) => (
                      <>
                        <RollLabel>{l.label}</RollLabel>
                        {isActive && (
                          <motion.span
                            layoutId="nav-dot"
                            className={cn('absolute -bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full', onDark ? 'bg-gold' : 'bg-rose')}
                            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                          />
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="relative z-[2] flex items-center gap-2">
            <a
              href={links.tel}
              className={cn(
                'group flex h-11 items-center gap-2 rounded-full border px-4 text-[0.88rem] transition-colors duration-500',
                onDark || open ? 'border-ivory/30 hover:bg-ivory hover:text-charcoal' : 'border-charcoal/20 hover:bg-charcoal hover:text-ivory',
              )}
              aria-label={`Call Blooms at ${business.phone.display}`}
            >
              <PhoneIcon />
              <span className="hidden sm:inline">{business.phone.display}</span>
            </a>
            <button
              ref={menuButton}
              type="button"
              className={cn(
                'flex h-11 items-center gap-3 rounded-full px-4 text-[0.88rem] transition-colors lg:hidden',
                open ? 'bg-ivory text-charcoal' : onDark ? 'bg-ivory/10 text-ivory' : 'bg-charcoal text-ivory',
              )}
              aria-expanded={open}
              aria-controls="site-menu"
              onClick={() => setOpen((o) => !o)}
            >
              <span>{open ? 'Close' : 'Menu'}</span>
              <span className="relative block h-3 w-4" aria-hidden="true">
                <span className={cn('absolute left-0 h-px w-4 bg-current transition-all duration-500', open ? 'top-1.5 rotate-45' : 'top-0.5')} />
                <span className={cn('absolute left-0 h-px w-4 bg-current transition-all duration-500', open ? 'top-1.5 -rotate-45' : 'top-2.5')} />
              </span>
            </button>
          </div>
        </div>
      </motion.header>
      <MenuOverlay open={open} onClose={() => setOpen(false)} returnFocus={menuButton} />
    </>
  );
}

function MenuOverlay({ open, onClose, returnFocus }: { open: boolean; onClose: () => void; returnFocus: RefObject<HTMLButtonElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    const button = returnFocus.current;
    const first = node?.querySelector<HTMLElement>('a');
    window.setTimeout(() => first?.focus(), 350);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !node) return;
      const focusables = [button, ...Array.from(node.querySelectorAll<HTMLElement>('a, button'))].filter(Boolean) as HTMLElement[];
      const idx = focusables.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (idx <= 0 ? focusables.length - 1 : idx - 1) : idx === focusables.length - 1 ? 0 : idx + 1;
      e.preventDefault();
      focusables[next]?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      button?.focus({ preventScroll: true });
    };
  }, [open, onClose, returnFocus]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          id="site-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Site menu"
          data-theme="dark"
          className="fixed inset-0 z-[58] flex flex-col overflow-y-auto bg-charcoal text-ivory lg:hidden"
          initial={{ clipPath: 'circle(0% at calc(100% - 3rem) 2.25rem)' }}
          animate={{ clipPath: 'circle(150% at calc(100% - 3rem) 2.25rem)' }}
          exit={{ clipPath: 'circle(0% at calc(100% - 3rem) 2.25rem)' }}
          transition={{ duration: 0.85, ease: [0.83, 0, 0.17, 1] }}
        >
          <div className="pointer-events-none absolute -right-24 -bottom-24 opacity-40">
            <BloomMark size={360} tone="dark" spin />
          </div>
          <nav aria-label="Mobile" className="shell relative flex flex-1 flex-col justify-center pt-24 pb-8">
            <ul className="space-y-1">
              {[{ to: '/', label: 'Home' }, ...NAV_LINKS].map((l, i) => (
                <li key={l.to} className="overflow-hidden">
                  <motion.div
                    initial={{ y: '110%' }}
                    animate={{ y: '0%' }}
                    exit={{ y: '110%' }}
                    transition={{ duration: 0.9, delay: 0.18 + i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <NavLink
                      to={l.to}
                      onClick={onClose}
                      className={({ isActive }) =>
                        cn('flex items-baseline gap-4 py-1 font-display text-[clamp(2.3rem,10vw,4.5rem)] leading-[1.05]', isActive && 'italic text-gold')
                      }
                    >
                      <span className="font-sans text-xs tracking-widest text-ivory/50">0{i + 1}</span>
                      {l.label}
                    </NavLink>
                  </motion.div>
                </li>
              ))}
            </ul>
          </nav>
          <motion.div
            className="shell relative grid gap-4 border-t border-ivory/15 py-6 text-sm text-ivory/80 sm:grid-cols-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: 0.55 } }}
            exit={{ opacity: 0 }}
          >
            <div>
              <a href={links.tel} className="block text-lg text-ivory">
                {business.phone.display}
              </a>
              <a href={links.mailto} className="block break-all">
                {business.email}
              </a>
            </div>
            <p className="text-ivory/60">{concept.summary.split('.')[0]}.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
