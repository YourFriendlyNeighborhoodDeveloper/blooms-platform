import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { cn } from '../../lib/cn';

type Props = {
  text: string;
  className?: string;
  /** Start the letter entrance. */
  play?: boolean;
  radius?: number;
  italic?: boolean;
};

const REST = { wght: 260, soft: 100, wonk: 0 };
const PEAK = { wght: 860, soft: 0, wonk: 1 };

/**
 * Display word whose letters swell, sharpen and turn "wonky" as the cursor nears —
 * Fraunces' weight, SOFT and WONK axes driven per-letter. Touch devices get a slow wave.
 */
export function VariableWord({ text, className, play = true, radius = 360, italic }: Props) {
  const letters = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    const els = letters.current.filter(Boolean) as HTMLSpanElement[];
    if (!els.length) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const state = els.map(() => ({ ...REST, lift: 0 }));
    const apply = (el: HTMLSpanElement, s: (typeof state)[number]) => {
      el.style.fontVariationSettings = `'wght' ${s.wght.toFixed(0)}, 'SOFT' ${s.soft.toFixed(0)}, 'WONK' ${s.wonk > 0.5 ? 1 : 0}, 'opsz' 144`;
      el.style.transform = `translateY(${(-s.lift).toFixed(2)}%)`;
    };
    els.forEach((el, i) => apply(el, state[i]));
    if (reduce) return;

    // Measure the un-transformed letter slots each frame (reads first, then writes).
    const slots = els.map((el) => el.parentElement?.parentElement ?? el);
    let mx = -1e5;
    let my = -1e5;
    const onMove = (e: PointerEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    let raf = 0;
    const tick = (now: number) => {
      const t = now / 1000;
      const rects = fine ? slots.map((el) => el.getBoundingClientRect()) : [];
      for (let i = 0; i < els.length; i++) {
        let k: number;
        if (fine) {
          const c = rects[i];
          const d = Math.hypot(mx - (c.left + c.width / 2), (my - (c.top + c.height / 2)) * 1.3);
          k = Math.max(0, 1 - d / radius);
          k = k * k * (3 - 2 * k);
        } else {
          k = Math.max(0, Math.sin(t * 1.1 - i * 0.7)) * 0.75;
        }
        const s = state[i];
        s.wght += (REST.wght + (PEAK.wght - REST.wght) * k - s.wght) * 0.12;
        s.soft += (REST.soft + (PEAK.soft - REST.soft) * k - s.soft) * 0.12;
        s.wonk += (k - s.wonk) * 0.12;
        s.lift += (k * 4 - s.lift) * 0.12;
        apply(els[i], s);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
    };
  }, [text, radius]);

  return (
    <span className={cn('relative inline-block', className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="inline-flex">
        {Array.from(text).map((ch, i) => (
          <span key={i} className="inline-block overflow-hidden pb-[0.08em] leading-[0.95]">
            <motion.span
              className="inline-block"
              initial={{ y: '105%', rotate: 8 }}
              animate={play ? { y: '0%', rotate: 0 } : { y: '105%', rotate: 8 }}
              transition={{ duration: 1.25, delay: 0.08 * i, ease: [0.16, 1, 0.3, 1] }}
            >
              <span
                ref={(el) => {
                  letters.current[i] = el;
                }}
                className={cn('inline-block will-change-transform', italic && 'italic')}
              >
                {ch === ' ' ? ' ' : ch}
              </span>
            </motion.span>
          </span>
        ))}
      </span>
    </span>
  );
}
