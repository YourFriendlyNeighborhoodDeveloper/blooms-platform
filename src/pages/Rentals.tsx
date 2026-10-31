import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { PageHero } from '../sections/shared/PageHero';
import { Img } from '../components/ui/Img';
import { Arrow, Button } from '../components/ui/Button';
import { Eyebrow, FadeIn, RevealText } from '../components/ui/Reveal';
import { useFinePointer, useIsDesktop } from '../hooks/useMediaQuery';
import type { ImageKey } from '../lib/images';
import { cn } from '../lib/cn';

const CATEGORIES: Array<{ title: string; key: string; image: ImageKey; blurb: string; items: string[] }> = [
  {
    title: 'Arch & ceremony design',
    key: 'arches',
    image: 'gazebo',
    blurb: 'Frame the vows. Arches, altars and aisle details that set the stage for the ceremony.',
    items: ['Ceremony arches & altars', 'Aisle markers', 'Aisle runners', 'Ceremony florals'],
  },
  {
    title: 'Linens & chair styling',
    key: 'linens',
    image: 'ballroom',
    blurb: 'The quiet foundation of a beautiful room: linens and runners, chair covers and sashes.',
    items: ['Table linens', 'Table runners', 'Chair covers', 'Sashes'],
  },
  {
    title: 'Tablescapes & centerpieces',
    key: 'tablescapes',
    image: 'reception-table',
    blurb: 'Where guests spend the evening. Centerpieces, vases and the flowers that finish the cake.',
    items: ['Centerpieces', 'Vases', 'Cake flowers', 'Reception florals'],
  },
  {
    title: 'Lighting & drapery',
    key: 'lighting',
    image: 'stage-drapery',
    blurb: 'Soft fabric and warm light change a room completely — and photograph beautifully.',
    items: ['Drapery', 'Lighting'],
  },
  {
    title: 'Decorative accessories',
    key: 'accessories',
    image: 'sign',
    blurb: 'The finishing touches: signage, card boxes and the small accessories that tie it together.',
    items: ['Decorative signage', 'Card boxes', 'Accessories'],
  },
];

function Catalog() {
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(0);
  return (
    <section data-nav="light" className="relative bg-ivory pb-28 lg:pb-40" aria-labelledby="catalog-heading">
      <div className="shell">
        <div className="flex flex-col gap-6 border-t border-charcoal/15 pt-12 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Eyebrow index="01" className="text-rose-deep">
              Rental categories
            </Eyebrow>
            <RevealText id="catalog-heading" text={'The showroom, *by category.*'} className="mt-6 text-[clamp(2.4rem,5vw,4.8rem)] leading-[1] tracking-[-0.03em]" />
          </div>
          <p className="max-w-sm text-charcoal/70">{desktop ? 'Hover or focus a panel to open it.' : 'Tap a category to open it.'} Each one leads to an inquiry with that category pre-selected.</p>
        </div>

        {desktop ? (
          <div className="mt-14 flex h-[74svh] min-h-[560px] gap-3">
            {CATEGORIES.map((c, i) => {
              const isOpen = open === i;
              return (
                <div
                  key={c.key}
                  onPointerEnter={() => setOpen(i)}
                  onFocusCapture={() => setOpen(i)}
                  className={cn(
                    'group relative overflow-hidden rounded-[24px] bg-charcoal text-ivory transition-[flex-grow] duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
                    isOpen ? 'grow-[5]' : 'grow',
                  )}
                  style={{ flexBasis: 0 }}
                  data-theme="dark"
                >
                  <div className={cn('absolute inset-0 transition-all duration-[1.2s]', isOpen ? 'scale-100 opacity-100' : 'scale-110 opacity-45')}>
                    <Img name={c.image} sizes="60vw" className="h-full w-full" />
                    <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/30 to-ink/10" />
                  </div>
                  <span className="absolute top-5 left-5 font-display text-lg italic">0{i + 1}</span>
                  <h3
                    className={cn(
                      'absolute bottom-6 left-5 origin-bottom-left text-[1.7rem] leading-none whitespace-nowrap transition-all duration-700',
                      isOpen ? 'pointer-events-none opacity-0' : '-rotate-90 translate-x-[1.6rem] opacity-100',
                    )}
                    aria-hidden={isOpen}
                  >
                    {c.title}
                  </h3>
                  <div
                    className={cn(
                      'absolute inset-x-0 bottom-0 p-8 transition-all duration-700 xl:p-10',
                      isOpen ? 'translate-y-0 opacity-100 delay-200' : 'pointer-events-none translate-y-8 opacity-0',
                    )}
                  >
                    <h3 className="text-[clamp(2.2rem,3.4vw,3.6rem)] leading-[1] tracking-[-0.03em]">{c.title}</h3>
                    <p className="mt-4 max-w-md text-ivory/80">{c.blurb}</p>
                    <ul className="mt-6 flex flex-wrap gap-2">
                      {c.items.map((it) => (
                        <li key={it} className="rounded-full bg-ivory/12 px-3.5 py-1.5 text-[0.84rem] backdrop-blur-sm">
                          {it}
                        </li>
                      ))}
                    </ul>
                    <Link
                      to={`/weddings-events?service=${c.key}#inquire`}
                      tabIndex={isOpen ? 0 : -1}
                      className="group/link mt-7 inline-flex items-center gap-3 rounded-full bg-ivory px-5 py-3 text-[0.9rem] text-charcoal transition hover:bg-gold"
                    >
                      Ask about {c.title.toLowerCase()}
                      <Arrow className="transition-transform group-hover/link:translate-x-1" />
                    </Link>
                    <span className="illustrative-tag absolute top-8 right-8 rounded-full bg-ink/50 px-2.5 py-1 text-ivory/80">Illustrative photo</span>
                  </div>
                  {!isOpen && (
                    <button type="button" className="absolute inset-0 opacity-0" onClick={() => setOpen(i)} aria-label={`Open ${c.title}`} />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <ul className="mt-12 space-y-3">
            {CATEGORIES.map((c, i) => {
              const isOpen = open === i;
              return (
                <li key={c.key} className="overflow-hidden rounded-[22px] bg-charcoal text-ivory" data-theme="dark">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? -1 : i)}
                    aria-expanded={isOpen}
                    aria-controls={`rental-${c.key}`}
                    className="relative flex w-full items-center justify-between gap-4 p-5 text-left"
                  >
                    <span className="flex items-baseline gap-3">
                      <span className="font-display text-sm text-gold italic">0{i + 1}</span>
                      <span className="font-display text-[1.6rem] leading-tight">{c.title}</span>
                    </span>
                    <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-full border border-ivory/30 transition-transform duration-500', isOpen && 'rotate-45')} aria-hidden="true">
                      +
                    </span>
                  </button>
                  <motion.div
                    id={`rental-${c.key}`}
                    initial={false}
                    animate={{ height: isOpen ? 'auto' : 0, opacity: isOpen ? 1 : 0 }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-6">
                      <Img name={c.image} sizes="100vw" className="aspect-[4/3] w-full rounded-2xl" tag="dark" />
                      <p className="mt-5 text-ivory/80">{c.blurb}</p>
                      <ul className="mt-4 flex flex-wrap gap-2">
                        {c.items.map((it) => (
                          <li key={it} className="rounded-full bg-ivory/12 px-3 py-1.5 text-[0.82rem]">
                            {it}
                          </li>
                        ))}
                      </ul>
                      <Link to={`/weddings-events?service=${c.key}#inquire`} className="mt-6 inline-flex items-center gap-3 rounded-full bg-ivory px-5 py-3 text-[0.9rem] text-charcoal">
                        Ask about this <Arrow />
                      </Link>
                    </div>
                  </motion.div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-6 text-[0.8rem] text-charcoal/60">
          Categories reflect rental offerings documented in the business&rsquo;s public listings. Current inventory, availability and pricing are confirmed
          directly with Blooms — nothing here is a live catalog.
        </p>
      </div>
    </section>
  );
}

const BULBS = 15;

/** Dark room, warm light: the pointer is a lamp that reveals the scene and wakes the string lights. */
function Spotlight() {
  const ref = useRef<HTMLDivElement>(null);
  const bulbs = useRef<Array<HTMLSpanElement | null>>([]);
  const fine = useFinePointer();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let tx = 0.62;
    let ty = 0.55;
    let x = tx;
    let y = ty;
    let pointerActive = false;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width;
      ty = (e.clientY - r.top) / r.height;
      pointerActive = true;
    };
    const onLeave = () => {
      pointerActive = false;
    };
    const tick = (now: number) => {
      if (!pointerActive) {
        const t = now / 1000;
        tx = 0.5 + Math.sin(t * 0.45) * 0.3;
        ty = 0.55 + Math.sin(t * 0.7) * 0.18;
      }
      x += (tx - x) * 0.08;
      y += (ty - y) * 0.08;
      el.style.setProperty('--lx', `${(x * 100).toFixed(2)}%`);
      el.style.setProperty('--ly', `${(y * 100).toFixed(2)}%`);
      bulbs.current.forEach((b, i) => {
        if (!b) return;
        const bx = (i + 0.5) / BULBS;
        const d = Math.abs(bx - x) + Math.abs(y - 0.1) * 0.35;
        const glow = Math.max(0.25, 1 - d * 2.4);
        b.style.opacity = glow.toFixed(3);
      });
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([e]) => {
      cancelAnimationFrame(raf);
      if (e.isIntersecting) raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  const mask = 'radial-gradient(circle min(34vw, 340px) at var(--lx, 60%) var(--ly, 55%), #000 0%, rgba(0,0,0,0.7) 35%, transparent 72%)';

  return (
    <section data-nav="dark" data-theme="dark" className="relative bg-ink text-ivory" aria-labelledby="light-heading">
      <div ref={ref} className="relative h-[100svh] min-h-[620px] overflow-hidden" data-cursor={fine ? 'Light' : undefined}>
        <div className="absolute inset-0 opacity-[0.22] grayscale-[40%]">
          <Img name="stage-drapery" sizes="100vw" className="h-full w-full" />
        </div>
        <div className="absolute inset-0" style={{ WebkitMaskImage: mask, maskImage: mask }}>
          <Img name="stage-drapery" sizes="100vw" className="h-full w-full" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_var(--lx)_var(--ly),rgba(255,214,150,0.25),transparent_45%)]" />
        </div>
        <div className="absolute inset-x-0 top-0 h-[14svh]" aria-hidden="true">
          <svg viewBox="0 0 1000 120" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            <path d="M0 10 Q 250 110 500 40 T 1000 20" stroke="#c7a977" strokeOpacity="0.4" strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />
          </svg>
          {Array.from({ length: BULBS }, (_, i) => {
            const t = (i + 0.5) / BULBS;
            const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
            const q = (a: number, b: number, c: number) => (1 - u) * (1 - u) * a + 2 * (1 - u) * u * b + u * u * c;
            const yy = t < 0.5 ? q(10, 110, 40) : q(40, -30, 20);
            return (
              <span key={i} className="absolute flex -translate-x-1/2 flex-col items-center" style={{ left: `${t * 100}%`, top: `${(yy / 120) * 100}%` }}>
                <span className="block h-2 w-px bg-gold/50" />
                <span
                  ref={(el) => {
                    bulbs.current[i] = el;
                  }}
                  className="block h-3 w-3 rounded-full bg-[#ffe2a8] shadow-[0_0_18px_6px_rgba(255,211,138,0.55)]"
                  style={{ opacity: 0.4 }}
                />
              </span>
            );
          })}
        </div>
        <div className="shell pointer-events-none relative flex h-full flex-col justify-end pb-16 lg:pb-24">
          <Eyebrow index="02" className="text-gold">
            Lighting &amp; drapery
          </Eyebrow>
          <RevealText id="light-heading" text={'Light changes\n*everything.*'} className="mt-6 text-[clamp(3rem,8vw,8rem)] leading-[0.92] tracking-[-0.04em]" emClassName="italic text-gold" />
          <FadeIn className="mt-6 max-w-md text-ivory/75">
            Soft fabric and warm light can turn any room into the room. {fine ? 'Move your cursor to light the scene.' : 'Watch the light wander the scene.'}
          </FadeIn>
        </div>
        <span className="illustrative-tag absolute right-4 bottom-4 rounded-full bg-ink/60 px-2.5 py-1 text-ivory/70">Illustrative photo</span>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: '01', title: 'Share the basics', body: 'Your date, venue, guest count and the categories you’re curious about.' },
    { n: '02', title: 'Explore what fits', body: 'Ask about the showroom and current selections, and talk through how pieces work together.' },
    { n: '03', title: 'Plan the logistics', body: 'Ask what’s available for delivery, setup and cleanup at your venue.' },
  ];
  return (
    <section data-nav="light" className="bg-blush py-28 lg:py-36">
      <div className="shell">
        <Eyebrow index="03" className="text-rose-deep">
          How rentals work
        </Eyebrow>
        <RevealText text={'Simple, *personal,* in person.'} className="mt-6 text-[clamp(2.4rem,5vw,4.8rem)] leading-[1] tracking-[-0.03em]" />
        <ol className="mt-14 grid gap-3 md:grid-cols-3">
          {steps.map((s, i) => (
            <motion.li
              key={s.n}
              initial={{ opacity: 0, y: 40, rotate: i % 2 ? 2 : -2 }}
              whileInView={{ opacity: 1, y: 0, rotate: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 1, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-[24px] bg-ivory/70 p-8"
            >
              <span className="font-display text-5xl text-rose/70 italic">{s.n}</span>
              <h3 className="mt-8 text-[1.9rem] leading-tight">{s.title}</h3>
              <p className="mt-3 text-charcoal/75">{s.body}</p>
            </motion.li>
          ))}
        </ol>
        <div className="mt-12 flex flex-wrap gap-3">
          <Button to="/weddings-events?service=rentals#inquire" size="lg" icon={<Arrow />}>
            Start a rental inquiry
          </Button>
          <Button to="/about" variant="outline" size="lg">
            Visit the shop
          </Button>
        </div>
      </div>
    </section>
  );
}

export default function Rentals() {
  return (
    <>
      <PageHero
        images={['chairs-florals', 'candle']}
        word="Rentals"
        srTitle="Event rentals"
        eyebrow="Event rentals · Saginaw, MI"
        aside={
          <FadeIn afterIntro delay={0.4} className="text-[1.05rem] leading-relaxed text-charcoal/75">
            Ceremony arches, linens and chair styling, tablescapes, lighting, drapery and decorative accessories — explore the categories, then ask what&rsquo;s
            available for your date.
          </FadeIn>
        }
      >
        <FadeIn afterIntro delay={0.3}>
          <p className="font-display text-[clamp(1.6rem,2.8vw,2.4rem)] leading-[1.1]">
            The details that make a room feel <em className="text-rose-deep">like yours.</em>
          </p>
        </FadeIn>
      </PageHero>
      <Catalog />
      <Spotlight />
      <HowItWorks />
    </>
  );
}
