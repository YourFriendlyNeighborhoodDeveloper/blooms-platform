import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import Lenis from 'lenis';
import { useReducedMotion } from 'motion/react';

const LenisContext = createContext<Lenis | null>(null);

export function SmoothScroll({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  const [lenis, setLenis] = useState<Lenis | null>(null);

  useEffect(() => {
    if (reduce) return;
    const instance = new Lenis({ lerp: 0.085, wheelMultiplier: 0.95, smoothWheel: true });
    let id = requestAnimationFrame(function raf(time) {
      instance.raf(time);
      id = requestAnimationFrame(raf);
    });
    setLenis(instance);
    return () => {
      cancelAnimationFrame(id);
      instance.destroy();
      setLenis(null);
    };
  }, [reduce]);

  return <LenisContext.Provider value={lenis}>{children}</LenisContext.Provider>;
}

export const useLenis = () => useContext(LenisContext);

/**
 * Scrolls to a selector or element, falling back to native scrolling. Lenis caches
 * the page's scroll limit, so it is re-measured first (a freshly mounted page may
 * still be reporting the previous page's height).
 */
export function scrollToTarget(lenis: Lenis | null, target: string | HTMLElement, offset = -90, immediate = false) {
  const el = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
  if (!el) return;
  if (lenis) {
    lenis.resize();
    lenis.scrollTo(el, { offset, duration: 1.6, immediate, force: true });
  } else {
    const top = el.getBoundingClientRect().top + window.scrollY + offset;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top, behavior: reduce || immediate ? 'auto' : 'smooth' });
  }
  // Move focus for keyboard and screen-reader users without a second jump.
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

export function scrollToTop(lenis: Lenis | null) {
  if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
  window.scrollTo(0, 0);
}
