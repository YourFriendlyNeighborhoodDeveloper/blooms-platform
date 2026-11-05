import { useRef } from 'react';
import { Link } from 'react-router';
import { motion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { Img } from '../../components/ui/Img';
import { Arrow } from '../../components/ui/Button';
import { Eyebrow, RevealText } from '../../components/ui/Reveal';
import type { ImageKey } from '../../lib/images';
import { cn } from '../../lib/cn';

type Service = {
  n: string;
  title: string;
  to: string;
  image: ImageKey;
  blurb: string;
  items: string[];
  cta: string;
  tone: 'blush' | 'dark' | 'sage';
};

const SERVICES: Service[] = [
  {
    n: '01',
    title: 'Flowers',
    to: '/flowers',
    image: 'bouquet-lush',
    blurb: 'Custom arrangements, bouquets and special-occasion flowers — designed around the person, the moment and the feeling you want to send.',
    items: ['Custom arrangements', 'Bouquets', 'Special occasions', 'Corsages & boutonnieres'],
    cta: 'Explore flowers',
    tone: 'blush',
  },
  {
    n: '02',
    title: 'Weddings & Events',
    to: '/weddings-events',
    image: 'aisle',
    blurb: 'Bridal bouquets to ceremony arches, centerpieces to linens — wedding and event design for celebrations of every size.',
    items: ['Bridal & wedding party flowers', 'Ceremony décor & arches', 'Reception centerpieces', 'Event rentals & styling'],
    cta: 'Plan your event',
    tone: 'dark',
  },
  {
    n: '03',
    title: 'Boutique & Gifts',
    to: '/boutique',
    image: 'pitcher-blooms',
    blurb: 'Clothing, gifts and home décor, gathered in the shop — for when the flowers deserve a companion, or you deserve a little something.',
    items: ['Clothing', 'Gifts', 'Home décor', 'Seasonal pieces'],
    cta: 'Visit the boutique',
    tone: 'sage',
  },
];

const TONES = {
  blush: { card: 'bg-blush text-charcoal', muted: 'text-charcoal/80', line: 'border-charcoal/15', chip: 'bg-ivory/60', theme: undefined },
  dark: { card: 'bg-charcoal text-ivory', muted: 'text-ivory/70', line: 'border-ivory/15', chip: 'bg-ivory/10', theme: 'dark' as const },
  sage: { card: 'bg-sage text-ivory', muted: 'text-ivory', line: 'border-ivory/20', chip: 'border border-ivory/40', theme: 'dark' as const },
};

function StackCard({ s, i, total, progress }: { s: Service; i: number; total: number; progress: MotionValue<number> }) {
  const tone = TONES[s.tone];
  const target = 1 - (total - 1 - i) * 0.045;
  const scale = useTransform(progress, [i / total, 1], [1, target]);
  const dim = useTransform(progress, [i / total, Math.min(1, (i + 1) / total + 0.1)], [0, i === total - 1 ? 0 : 0.35]);
  return (
    <div className="sticky top-0 flex h-[100svh] items-center justify-center px-3 sm:px-[var(--gutter)]">
      <motion.article
        data-theme={tone.theme}
        style={{ scale, top: `calc(${i} * 1.6rem)` }}
        className={cn('relative grid h-[84svh] max-h-[860px] w-full max-w-[1500px] origin-top grid-rows-[40%_1fr] overflow-hidden rounded-[28px] lg:grid-cols-2 lg:grid-rows-1', tone.card)}
      >
        <div className="relative order-2 flex flex-col justify-between gap-6 p-6 sm:p-10 lg:order-1 lg:p-14">
          <div>
            <div className="flex items-center justify-between">
              <span className="font-display text-sm italic opacity-70">({s.n})</span>
              <span className={cn('eyebrow', tone.muted)}>Service</span>
            </div>
            <h3 className="mt-4 text-[clamp(2.6rem,6vw,6rem)] leading-[0.95] tracking-[-0.035em]">{s.title}</h3>
            <p className={cn('mt-5 max-w-md text-[1.02rem] leading-relaxed', tone.muted)}>{s.blurb}</p>
          </div>
          <div>
            <ul className={cn('hidden flex-wrap gap-2 sm:flex')}>
              {s.items.map((it) => (
                <li key={it} className={cn('rounded-full px-3.5 py-1.5 text-[0.82rem]', tone.chip)}>
                  {it}
                </li>
              ))}
            </ul>
            <Link to={s.to} className={cn('group mt-6 flex items-center justify-between border-t pt-5 text-[1.02rem]', tone.line)}>
              <span className="font-display text-[1.5rem] italic">{s.cta}</span>
              <span className="grid h-12 w-12 place-items-center rounded-full border border-current/30 transition-all duration-500 group-hover:rotate-[-45deg] group-hover:bg-current/10">
                <Arrow />
              </span>
            </Link>
          </div>
        </div>
        <Link to={s.to} tabIndex={-1} aria-hidden="true" data-cursor="Open" className="relative order-1 block h-full min-h-0 overflow-hidden lg:order-2">
          <motion.div className="absolute inset-0" whileHover={{ scale: 1.04 }} transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}>
            <Img name={s.image} sizes="(min-width: 1024px) 50vw, 100vw" className="h-full w-full" tag />
          </motion.div>
        </Link>
        <motion.div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-ink" style={{ opacity: dim }} />
      </motion.article>
    </div>
  );
}

export function ServiceStack() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  return (
    <section data-nav="light" className="relative bg-ivory pb-[8vh]">
      <div className="shell flex flex-col gap-6 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Eyebrow index="02" className="text-rose-deep">
            Three ways in
          </Eyebrow>
          <RevealText text={'Flowers, celebrations\n& the *little extras.*'} className="mt-6 text-[clamp(2.4rem,5.4vw,5.2rem)] leading-[1] tracking-[-0.03em]" />
        </div>
        <p className="max-w-sm text-charcoal/70">One shop, three crafts. Start with whichever brought you here — they tend to overlap in the best way.</p>
      </div>
      <div ref={ref} className="relative">
        {SERVICES.map((s, i) => (
          <StackCard key={s.n} s={s} i={i} total={SERVICES.length} progress={scrollYProgress} />
        ))}
      </div>
    </section>
  );
}
