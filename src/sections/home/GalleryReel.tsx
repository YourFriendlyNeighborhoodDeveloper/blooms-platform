import { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useSpring, useTransform, useVelocity, type MotionValue } from 'motion/react';
import { Img } from '../../components/ui/Img';
import { Eyebrow } from '../../components/ui/Reveal';
import { Arrow, Button } from '../../components/ui/Button';
import type { ImageKey } from '../../lib/images';
import { cn } from '../../lib/cn';

type Item = { name: ImageKey; caption: string; size: string };

const ITEMS: Item[] = [
  { name: 'bride-bouquet-blush', caption: 'Bridal bouquets', size: 'h-[56svh] aspect-[3/4]' },
  { name: 'reception-table', caption: 'Reception tables', size: 'h-[42svh] aspect-[4/3] self-end' },
  { name: 'dahlias-peach', caption: 'Seasonal blooms', size: 'h-[50svh] aspect-[4/5] self-start' },
  { name: 'gazebo', caption: 'Ceremony décor', size: 'h-[58svh] aspect-[3/4]' },
  { name: 'rings-roses', caption: 'Small details', size: 'h-[38svh] aspect-square self-end' },
  { name: 'tulips-vase', caption: 'Arrangements', size: 'h-[52svh] aspect-[3/4] self-start' },
  { name: 'toast-lights', caption: 'Celebrations', size: 'h-[46svh] aspect-[4/3]' },
  { name: 'rose-blush-wall', caption: 'Single stems', size: 'h-[56svh] aspect-[3/4] self-end' },
];

function ReelItem({ item, i, progress, skew }: { item: Item; i: number; progress: MotionValue<number>; skew: MotionValue<number> }) {
  const x = useTransform(progress, [0, 1], ['-9%', '9%']);
  return (
    <motion.figure className={cn('group relative shrink-0', item.size.includes('self-end') ? 'self-end' : item.size.includes('self-start') ? 'self-start' : '')} style={{ skewX: skew }}>
      <div className={cn('relative overflow-hidden rounded-[20px]', item.size.replace(/self-\w+/, ''))} data-cursor="Look">
        <motion.div className="absolute inset-y-0 -left-[12%] w-[124%]" style={{ x }}>
          <Img name={item.name} sizes="(min-width: 1024px) 34vw, 70vw" className="h-full w-full transition-transform duration-[1.4s] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.06]" />
        </motion.div>
      </div>
      <figcaption className="mt-3 flex items-baseline justify-between gap-4 text-[0.82rem] text-charcoal/70">
        <span>
          <span className="font-display italic text-charcoal">{String(i + 1).padStart(2, '0')}</span> — {item.caption}
        </span>
        <span className="illustrative-tag text-charcoal/70">Illustrative</span>
      </figcaption>
    </motion.figure>
  );
}

/** Vertical scroll drives a horizontal filmstrip that leans into your scroll speed. */
export function GalleryReel() {
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [distance, setDistance] = useState(0);
  const distRef = useRef(0);
  distRef.current = distance;
  const { scrollYProgress } = useScroll({ target: section, offset: ['start start', 'end end'] });
  const smooth = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });
  const x = useTransform(() => -smooth.get() * distRef.current);
  const velocity = useVelocity(scrollYProgress);
  const skew = useSpring(useTransform(velocity, [-1, 0, 1], [3, 0, -3]), { stiffness: 200, damping: 30 });
  const bar = useTransform(smooth, [0, 1], ['0%', '100%']);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => setDistance(Math.max(0, el.scrollWidth - window.innerWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <section ref={section} data-nav="light" className="relative bg-ivory-deep" style={{ height: `calc(100svh + ${distance}px)` }} aria-label="Gallery preview">
      <div className="sticky top-0 flex h-[100svh] flex-col justify-center overflow-hidden">
        <motion.div ref={track} className="flex h-[78svh] w-max items-center gap-6 pr-[10vw] pl-[var(--gutter)] sm:gap-10" style={{ x }}>
          <div className="flex w-[78vw] shrink-0 flex-col justify-center pr-6 sm:w-[46vw] lg:w-[32vw]">
            <Eyebrow index="03" className="text-rose-deep">
              Gallery preview
            </Eyebrow>
            <h2 className="mt-6 text-[clamp(3rem,7vw,7rem)] leading-[0.92] tracking-[-0.04em]">
              In full <em className="text-rose-deep">bloom.</em>
            </h2>
            <p className="mt-6 max-w-sm text-charcoal/70">
              The kinds of moments Blooms designs for. Shown with illustrative photography — the shop&rsquo;s own portfolio would take its place.
            </p>
            <div className="mt-8">
              <Button to="/weddings-events" variant="outline" icon={<Arrow />}>
                Weddings &amp; events
              </Button>
            </div>
          </div>
          {ITEMS.map((item, i) => (
            <ReelItem key={item.name} item={item} i={i} progress={scrollYProgress} skew={skew} />
          ))}
        </motion.div>
        <div className="shell absolute inset-x-0 bottom-8">
          <div className="h-px w-full bg-charcoal/15">
            <motion.div className="h-px bg-charcoal" style={{ width: bar }} />
          </div>
        </div>
      </div>
    </section>
  );
}
