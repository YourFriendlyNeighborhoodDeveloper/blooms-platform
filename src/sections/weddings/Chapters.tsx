import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Img } from '../../components/ui/Img';
import { Eyebrow } from '../../components/ui/Reveal';
import type { ImageKey } from '../../lib/images';
import { cn } from '../../lib/cn';

const CHAPTERS: Array<{ title: string; image: ImageKey; body: string; items: string[] }> = [
  {
    title: 'Bridal bouquets',
    image: 'bride-bouquet-blush',
    body: 'The flowers you carry — and the ones your people wear. Designed around your palette, your dress, your venue and the feeling you want walking down the aisle.',
    items: ['Bridal bouquets', 'Bridesmaid bouquets', 'Boutonnieres', 'Corsages'],
  },
  {
    title: 'Ceremony décor',
    image: 'gazebo',
    body: 'The setting for the moment everyone remembers: florals framing the vows, an arch or altar to stand beneath, and an aisle that feels like an arrival.',
    items: ['Ceremony florals', 'Arches & altars', 'Aisle markers & runners'],
  },
  {
    title: 'Reception design',
    image: 'ballroom',
    body: 'Cohesive styling that turns a room into your reception — linens and runners, chair covers and sashes, drapery and lighting working together.',
    items: ['Linens & table runners', 'Chair covers & sashes', 'Drapery & lighting'],
  },
  {
    title: 'Centerpieces',
    image: 'reception-table',
    body: 'The details guests lean in to admire. Low and lush or tall and airy, plus the flowers that finish the cake.',
    items: ['Reception centerpieces', 'Vases', 'Cake flowers'],
  },
  {
    title: 'Event styling',
    image: 'sign',
    body: 'The finishing layer: signage, card boxes and accessories. Ask about delivery, setup and cleanup so you can simply be present.',
    items: ['Decorative signage', 'Card boxes & accessories', 'Delivery, setup & cleanup (ask)'],
  },
];

/** Sticky image theatre on the left; chapters scroll past on the right. */
export function Chapters() {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index));
        });
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <section data-nav="light" className="relative bg-ivory-deep py-24 lg:py-0" aria-labelledby="chapters-heading">
      <div className="shell lg:grid lg:grid-cols-2 lg:gap-16">
        <div className="hidden lg:block">
          <div className="sticky top-0 flex h-[100svh] items-center py-24">
            <div className="relative aspect-[4/5] max-h-full w-full overflow-hidden rounded-[28px]">
              {CHAPTERS.map((c, i) => (
                <motion.div
                  key={c.title}
                  className="absolute inset-0"
                  style={{ zIndex: i }}
                  initial={false}
                  animate={{ clipPath: i <= active ? 'inset(0% 0% 0% 0%)' : 'inset(100% 0% 0% 0%)', scale: i === active ? 1 : i < active ? 1.08 : 1.2 }}
                  transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Img name={c.image} sizes="45vw" className="h-full w-full" />
                </motion.div>
              ))}
              <div className="absolute top-5 left-5 z-10 flex items-baseline gap-1 overflow-hidden rounded-full bg-ivory/85 px-4 py-2 font-display text-lg backdrop-blur-md">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span key={active} initial={{ y: '100%' }} animate={{ y: '0%' }} exit={{ y: '-100%' }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="inline-block italic">
                    0{active + 1}
                  </motion.span>
                </AnimatePresence>
                <span className="text-charcoal/45">/ 0{CHAPTERS.length}</span>
              </div>
              <span className="illustrative-tag absolute bottom-4 left-4 z-10 rounded-full bg-ivory/80 px-2.5 py-1 text-charcoal/75">Illustrative photo</span>
            </div>
          </div>
        </div>

        <div>
          <div className="pb-10 lg:pt-[24svh]">
            <Eyebrow index="03" className="text-rose-deep">
              What Blooms designs
            </Eyebrow>
            <h2 id="chapters-heading" className="mt-6 text-[clamp(2.4rem,5vw,4.6rem)] leading-[1] tracking-[-0.03em]">
              From the first stem <em className="text-rose-deep">to the last detail.</em>
            </h2>
          </div>
          {CHAPTERS.map((c, i) => (
            <div
              key={c.title}
              ref={(el) => {
                refs.current[i] = el;
              }}
              data-index={i}
              className="flex flex-col justify-center border-t border-charcoal/15 py-12 lg:min-h-[78svh]"
            >
              <div className="mb-8 overflow-hidden rounded-[22px] lg:hidden">
                <Img name={c.image} sizes="100vw" className="aspect-[4/3] w-full" tag />
              </div>
              <p className="font-display text-lg text-rose-deep italic">Chapter 0{i + 1}</p>
              <h3
                className={cn(
                  'mt-3 text-[clamp(2.2rem,4.4vw,4.2rem)] leading-[1] tracking-[-0.03em] transition-all duration-700',
                  active === i ? 'opacity-100' : 'lg:opacity-30',
                )}
              >
                {c.title}
              </h3>
              <p className="mt-5 max-w-lg text-[1.05rem] leading-relaxed text-charcoal/75">{c.body}</p>
              <ul className="mt-7 flex flex-wrap gap-2">
                {c.items.map((it) => (
                  <li key={it} className="rounded-full border border-charcoal/15 px-3.5 py-1.5 text-[0.84rem]">
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
