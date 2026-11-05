import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, useVelocity } from 'motion/react';
import { Img } from '../../components/ui/Img';
import { Eyebrow, RevealText } from '../../components/ui/Reveal';
import { Arrow } from '../../components/ui/Button';
import type { ImageKey } from '../../lib/images';
import { useFinePointer } from '../../hooks/useMediaQuery';
import { PLATFORM_ENABLED, usePlatform } from '../../lib/platform';

const ROWS: Array<{ title: string; note: string; image: ImageKey; anchor: string }> = [
  { title: 'Clothing', note: 'Easy, wearable pieces', image: 'knits', anchor: 'clothing' },
  { title: 'Gifts', note: 'For the people you’d send flowers to', image: 'gift-pink', anchor: 'gifts' },
  { title: 'Home décor', note: 'Texture, warmth, a little whimsy', image: 'home-boho', anchor: 'home' },
  { title: 'Seasonal', note: 'What’s out changes with the calendar', image: 'autumn-leaves', anchor: 'seasonal' },
];

/** Typographic index; hovering a row conjures an image that trails the cursor. */
export function BoutiqueList() {
  const fine = useFinePointer();
  const { config } = usePlatform();
  const [active, setActive] = useState<number | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(mx, { stiffness: 160, damping: 20, mass: 0.5 });
  const y = useSpring(my, { stiffness: 160, damping: 20, mass: 0.5 });
  const vx = useVelocity(x);
  const rotate = useTransform(vx, [-1500, 0, 1500], [-14, 0, 14], { clamp: true });

  return (
    <section data-nav="light" className="relative bg-ivory py-28 lg:py-40">
      <div className="shell">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Eyebrow index="05" className="text-rose-deep">
              The boutique
            </Eyebrow>
            <RevealText text={'A little shop\nfull of *good reasons.*'} className="mt-6 text-[clamp(2.4rem,5.4vw,5.2rem)] leading-[1] tracking-[-0.03em]" />
          </div>
          <p className="max-w-sm text-charcoal/70">
            Alongside the flowers: clothing, gifts and home décor, chosen in the shop. Stock changes — stop in or call to ask what&rsquo;s new.
          </p>
        </div>

        <div
          ref={area}
          className="relative mt-16"
          onPointerMove={(e) => {
            const r = area.current?.getBoundingClientRect();
            if (!r) return;
            mx.set(e.clientX - r.left);
            my.set(e.clientY - r.top);
          }}
          onPointerLeave={() => setActive(null)}
        >
          {fine && (
            <motion.div className="pointer-events-none absolute top-0 left-0 z-20 hidden md:block" style={{ x, y, rotate }} aria-hidden="true">
              <AnimatePresence>
                {active !== null && (
                  <motion.div
                    key={active}
                    className="absolute -top-[150px] -left-[120px] h-[300px] w-[240px] overflow-hidden rounded-[18px] shadow-[0_40px_80px_-30px_rgba(52,47,44,0.5)]"
                    initial={{ clipPath: 'inset(50% 50% 50% 50% round 18px)', scale: 1.15 }}
                    animate={{ clipPath: 'inset(0% 0% 0% 0% round 18px)', scale: 1 }}
                    exit={{ clipPath: 'inset(50% 50% 50% 50% round 18px)', opacity: 0 }}
                    transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <Img name={ROWS[active].image} sizes="240px" className="h-full w-full" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          <ul className="border-t border-charcoal/15">
            {ROWS.map((row, i) => (
              <li key={row.title} className="border-b border-charcoal/15">
                <Link
                  to={`/boutique#${row.anchor}`}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="group relative grid grid-cols-[auto_1fr_auto] items-center gap-4 py-6 sm:gap-8 sm:py-9"
                >
                  <span className="font-display text-sm text-charcoal/70 italic">0{i + 1}</span>
                  <span className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-8">
                    <span className="font-display text-[clamp(2.2rem,6.4vw,6rem)] leading-[0.95] tracking-[-0.035em] transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-4 group-hover:text-rose-deep group-hover:italic">
                      {row.title}
                    </span>
                    <span className="text-[0.9rem] text-charcoal/70 transition-opacity duration-500 sm:opacity-0 sm:group-hover:opacity-100">{row.note}</span>
                  </span>
                  <span className="flex items-center gap-4">
                    <span className="h-16 w-14 overflow-hidden rounded-xl md:hidden">
                      <Img name={row.image} sizes="64px" className="h-full w-full" />
                    </span>
                    <span className="hidden h-14 w-14 place-items-center rounded-full border border-charcoal/20 transition-all duration-500 group-hover:-rotate-45 group-hover:border-charcoal group-hover:bg-charcoal group-hover:text-ivory sm:grid">
                      <Arrow />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[0.75rem] text-charcoal/70">
            {PLATFORM_ENABLED && config?.shop.has_products ? (
              <>
                A selection is <Link to="/shop?division=boutique" className="underline">available online</Link>. Photography is illustrative.
              </>
            ) : PLATFORM_ENABLED ? (
              'Photography is illustrative.'
            ) : (
              'Display catalog only — no online sales. Photography is illustrative.'
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
