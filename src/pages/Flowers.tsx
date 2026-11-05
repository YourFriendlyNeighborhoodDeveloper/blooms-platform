import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useMotionValue } from 'motion/react';
import { PageHero } from '../sections/shared/PageHero';
import { InquirySection } from '../sections/shared/InquirySection';
import { Atelier } from '../components/atelier/Atelier';
import { GeneralInquiryForm } from '../components/forms/GeneralInquiryForm';
import { Img } from '../components/ui/Img';
import { ParallaxImage } from '../components/ui/Motion';
import { Arrow, Button } from '../components/ui/Button';
import { Eyebrow, FadeIn, RevealText } from '../components/ui/Reveal';
import { scrollToTarget, useLenis } from '../components/layout/SmoothScroll';
import { business, links } from '../data/business';
import type { ImageKey } from '../lib/images';
import { cn } from '../lib/cn';
import { PLATFORM_ENABLED, usePlatform } from '../lib/platform';

const OCCASIONS: Array<{ word: string; image: ImageKey }> = [
  { word: 'birthdays', image: 'tulips-vase' },
  { word: 'anniversaries', image: 'rose-blush-wall' },
  { word: 'showers', image: 'peony' },
  { word: 'graduations', image: 'arrangement-jar' },
  { word: 'engagements', image: 'rings-blooms' },
  { word: 'just because', image: 'heart-flowers' },
];

function OccasionCycler() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setI((n) => (n + 1) % OCCASIONS.length), 2400);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-5">
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full sm:h-28 sm:w-28">
        <AnimatePresence initial={false}>
          <motion.div
            key={OCCASIONS[i].image}
            className="absolute inset-0"
            initial={{ clipPath: 'circle(0% at 50% 50%)' }}
            animate={{ clipPath: 'circle(75% at 50% 50%)' }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          >
            <Img name={OCCASIONS[i].image} sizes="120px" className="h-full w-full" />
          </motion.div>
        </AnimatePresence>
      </div>
      <p className="font-display text-[clamp(1.7rem,3vw,2.6rem)] leading-[1.05]">
        Flowers for{' '}
        <span className="relative inline-flex h-[1.15em] overflow-hidden align-bottom">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.em
              key={OCCASIONS[i].word}
              className="inline-block text-rose-deep"
              initial={{ y: '100%' }}
              animate={{ y: '0%' }}
              exit={{ y: '-100%' }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            >
              {OCCASIONS[i].word}.
            </motion.em>
          </AnimatePresence>
        </span>
      </p>
    </div>
  );
}

const BOUQUETS: Array<{ name: ImageKey; caption: string }> = [
  { name: 'bouquet-lush', caption: 'Garden-style, hand-tied' },
  { name: 'bouquet-blush', caption: 'Blush & kraft' },
  { name: 'pitcher-blooms', caption: 'Gathered in a pitcher' },
  { name: 'bouquet-white', caption: 'All-white classic' },
  { name: 'arrangement-jar', caption: 'Bright & sunny' },
  { name: 'moody-bouquet', caption: 'Deep & moody' },
  { name: 'tulips-vase', caption: 'Simply tulips' },
  { name: 'lily', caption: 'Statement stem' },
];

/** Drag-to-browse rail with momentum. */
function BouquetRail() {
  const track = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(0);
  const x = useMotionValue(0);
  useEffect(() => {
    const measure = () => {
      if (track.current && wrap.current) setLimit(Math.max(0, track.current.scrollWidth - wrap.current.clientWidth));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (track.current) ro.observe(track.current);
    return () => ro.disconnect();
  }, []);
  const nudge = (dir: 1 | -1) => {
    const next = Math.max(-limit, Math.min(0, x.get() - dir * 420));
    animate(x, next, { type: 'spring', stiffness: 120, damping: 22 });
  };
  return (
    <div ref={wrap} className="relative mt-14 overflow-hidden" data-cursor="Drag">
      <motion.div
        ref={track}
        drag="x"
        dragConstraints={{ left: -limit, right: 0 }}
        dragElastic={0.12}
        style={{ x }}
        className="flex w-max cursor-grab gap-4 pl-[var(--gutter)] pr-[var(--gutter)] active:cursor-grabbing sm:gap-6"
      >
        {BOUQUETS.map((b, i) => (
          <motion.figure
            key={b.name}
            className="w-[68vw] shrink-0 select-none sm:w-[38vw] lg:w-[24vw]"
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 1, delay: (i % 4) * 0.08, ease: [0.16, 1, 0.3, 1] }}
          >
            <Img name={b.name} sizes="(min-width: 1024px) 24vw, 68vw" className={cn('w-full rounded-[20px]', i % 2 ? 'aspect-[4/5]' : 'aspect-[3/4]')} />
            <figcaption className="mt-3 flex justify-between text-[0.85rem] text-charcoal/70">
              <span>
                <span className="font-display text-charcoal italic">{String(i + 1).padStart(2, '0')}</span> — {b.caption}
              </span>
              <span className="illustrative-tag text-charcoal/70">Illustrative</span>
            </figcaption>
          </motion.figure>
        ))}
      </motion.div>
      <div className="shell mt-8 flex gap-2">
        <button type="button" aria-label="Scroll bouquets left" onClick={() => nudge(-1)} className="grid h-12 w-12 place-items-center rounded-full border border-charcoal/20 transition hover:bg-charcoal hover:text-ivory">
          ←
        </button>
        <button type="button" aria-label="Scroll bouquets right" onClick={() => nudge(1)} className="grid h-12 w-12 place-items-center rounded-full border border-charcoal/20 transition hover:bg-charcoal hover:text-ivory">
          →
        </button>
      </div>
    </div>
  );
}

const MOMENTS: Array<{ title: string; image: ImageKey; note: string }> = [
  { title: 'Birthdays', image: 'tulips-vase', note: 'Their favorite colors, gathered up.' },
  { title: 'Anniversaries', image: 'rose-white', note: 'Classic, or something that tells your story.' },
  { title: 'Showers', image: 'peony', note: 'Soft florals for baby and bridal showers.' },
  { title: 'Graduations', image: 'arrangement-jar', note: 'Bright, proud and celebratory.' },
  { title: 'Engagements', image: 'rings-blooms', note: 'For the question — or the party after.' },
  { title: 'Just because', image: 'heart-flowers', note: 'The best reason, honestly.' },
];

function Occasions() {
  return (
    <section data-nav="light" className="bg-blush py-28 lg:py-40" aria-labelledby="occasions-heading">
      <div className="shell">
        <Eyebrow index="03" className="text-rose-deep">
          Special occasions
        </Eyebrow>
        <RevealText id="occasions-heading" text={'Something to *celebrate?*'} className="mt-6 text-[clamp(2.4rem,5vw,4.8rem)] leading-[1] tracking-[-0.03em]" />
        <ul className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MOMENTS.map((m) => (
            <li key={m.title}>
              <div
                className="group relative flex h-56 flex-col justify-between overflow-hidden rounded-[22px] bg-ivory/70 p-7 sm:h-64"
                onPointerEnter={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  e.currentTarget.style.setProperty('--ox', `${e.clientX - r.left}px`);
                  e.currentTarget.style.setProperty('--oy', `${e.clientY - r.top}px`);
                }}
              >
                <div
                  aria-hidden="true"
                  className="absolute inset-0 transition-[clip-path] duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] [clip-path:circle(0%_at_var(--ox,50%)_var(--oy,50%))] group-hover:[clip-path:circle(150%_at_var(--ox,50%)_var(--oy,50%))]"
                >
                  <Img name={m.image} sizes="33vw" className="h-full w-full" />
                  <div className="absolute inset-0 bg-gradient-to-t from-ink/70 to-ink/10" />
                </div>
                <h3 className="relative text-[2.2rem] leading-none transition-colors duration-500 group-hover:text-ivory">{m.title}</h3>
                <p className="relative text-charcoal/70 transition-colors duration-500 group-hover:text-ivory/90">{m.note}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function HowToOrder() {
  const lenis = useLenis();
  const { config } = usePlatform();
  const online = PLATFORM_ENABLED && Boolean(config?.shop.has_products);
  const ways = [
    { title: 'Call the shop', body: 'The quickest way to talk through an order.', action: business.phone.display, href: links.tel },
    { title: 'Send an email', body: 'Share the occasion, colors and any photos you love.', action: 'Email Blooms', href: links.mailto },
    { title: 'Stop in', body: `${business.address.street}, ${business.address.city}. Hours listed below — please call to confirm.`, action: 'Get directions', href: links.googleDirections },
  ];
  const ready = ['The occasion and the date you need them', 'Who they’re for — or the feeling you want', 'Colors, favorite flowers or inspiration photos', 'A budget you’re comfortable with', 'Pickup, or questions about delivery'];
  return (
    <section data-nav="light" className="bg-ivory py-28 lg:py-40" aria-labelledby="order-heading">
      <div className="shell">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Eyebrow index="05" className="text-rose-deep">
              Inquiry &amp; ordering help
            </Eyebrow>
            <RevealText id="order-heading" text={'Ordering flowers,\n*made easy.*'} className="mt-6 text-[clamp(2.4rem,5vw,4.8rem)] leading-[1] tracking-[-0.03em]" />
            <FadeIn className="mt-6 max-w-md text-[1.02rem] leading-relaxed text-charcoal/75">
              {online
                ? 'Order online any time, or reach out the way that suits you and Blooms will help you choose.'
                : PLATFORM_ENABLED
                  ? 'Reach out the way that suits you and Blooms will help you choose.'
                  : 'There’s no checkout here on purpose: every order starts with a real person. Reach out the way that suits you and Blooms will help you choose.'}
            </FadeIn>
            <div className="mt-8 rounded-[22px] border border-charcoal/12 p-6">
              <p className="eyebrow text-charcoal/80">Good to have ready</p>
              <ul className="mt-4 space-y-2.5">
                {ready.map((r) => (
                  <li key={r} className="flex gap-3 text-[0.95rem]">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-rose" aria-hidden="true" />
                    {r}
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-[0.8rem] leading-snug text-rose-deep">
                Delivery areas, timing and fees aren&rsquo;t published here — please confirm them directly with the shop.
              </p>
            </div>
          </div>
          <ol className="grid gap-3 lg:col-span-6 lg:col-start-7">
            {online && (
              <li>
                <Button to="/shop?division=floral" size="lg" icon={<Arrow />}>
                  Shop flowers online
                </Button>
              </li>
            )}
            {ways.map((w, i) => (
              <li key={w.title}>
                <a
                  href={w.href}
                  {...(w.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className="group flex items-center justify-between gap-6 rounded-[24px] border border-charcoal/12 p-7 transition-colors duration-500 hover:bg-charcoal hover:text-ivory"
                >
                  <span>
                    <span className="font-display text-sm text-rose-deep italic transition-colors group-hover:text-gold">0{i + 1}</span>
                    <span className="mt-2 block text-[2rem] leading-tight font-display">{w.title}</span>
                    <span className="mt-2 block text-[0.95rem] opacity-75">{w.body}</span>
                    <span className="mt-4 inline-block border-b border-current pb-0.5 text-[0.95rem]">{w.action}</span>
                  </span>
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-current/30 transition-transform duration-500 group-hover:-rotate-45">
                    <Arrow />
                  </span>
                </a>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => scrollToTarget(lenis, '#flower-note')}
                className="w-full rounded-[24px] bg-blush p-7 text-left transition hover:bg-blush-deep"
              >
                <span className="block text-[1.4rem] font-display">…or send a note below</span>
                <span className="mt-1 block text-[0.9rem] text-charcoal/70">{PLATFORM_ENABLED ? 'A short form. The shop replies by phone or email.' : 'A short form (demo on this concept).'}</span>
              </button>
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}

export default function Flowers() {
  const lenis = useLenis();
  return (
    <>
      <PageHero
        images={['bouquet-blush', 'peony']}
        word="Flowers"
        srTitle="Flowers and custom arrangements"
        eyebrow="Florist · Saginaw, Michigan"
        aside={
          <FadeIn afterIntro delay={0.45} className="flex flex-col gap-6">
            <p className="text-[1.05rem] leading-relaxed text-charcoal/75">
              Custom arrangements, bouquets and special-occasion flowers — designed by hand around the person, the moment and the feeling you want to
              send.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => scrollToTarget(lenis, '#order')} icon={<Arrow direction="down" />}>
                How to order
              </Button>
              <Button href={links.tel} variant="outline">
                Call {business.phone.display}
              </Button>
            </div>
          </FadeIn>
        }
      >
        <FadeIn afterIntro delay={0.3}>
          <OccasionCycler />
        </FadeIn>
      </PageHero>

      <section data-nav="light" className="bg-ivory pb-28 lg:pb-40" aria-labelledby="custom-heading">
        <div className="shell grid items-end gap-10 lg:grid-cols-12 lg:gap-16">
          <ParallaxImage name="dahlias-peach" className="aspect-[4/5] lg:col-span-6" sizes="(min-width:1024px) 50vw, 100vw" cursor="Custom" />
          <div className="lg:col-span-5 lg:col-start-8 lg:pb-10">
            <Eyebrow index="01" className="text-rose-deep">
              Custom arrangements
            </Eyebrow>
            <RevealText id="custom-heading" text={'Made for *one person,*\none moment.'} className="mt-6 text-[clamp(2.4rem,4.6vw,4.4rem)] leading-[1] tracking-[-0.03em]" />
            <FadeIn className="mt-6 space-y-4 text-[1.02rem] leading-relaxed text-charcoal/75">
              <p>Tell Blooms who they&rsquo;re for, what they love and what you want to say. The arrangement is designed around that — not picked from a grid.</p>
              <p>Arrangements, bouquets, corsages and boutonnieres, and floral designs for showers and celebrations.</p>
            </FadeIn>
            <div className="mt-10 grid grid-cols-2 gap-3">
              <ParallaxImage name="pitcher-blooms" className="aspect-square" sizes="25vw" amount={8} tag={false} />
              <ParallaxImage name="rose-white" className="aspect-square" sizes="25vw" amount={8} tag={false} />
            </div>
            <p className="mt-3 text-[0.72rem] text-charcoal/70">All photography illustrative.</p>
          </div>
        </div>
      </section>

      <section data-nav="light" className="bg-ivory-deep py-28 lg:py-40" aria-labelledby="bouquets-heading">
        <div className="shell flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Eyebrow index="02" className="text-rose-deep">
              Floral bouquets
            </Eyebrow>
            <RevealText id="bouquets-heading" text={'A bouquet for *every mood.*'} className="mt-6 text-[clamp(2.4rem,5vw,4.8rem)] leading-[1] tracking-[-0.03em]" />
          </div>
          <p className="max-w-sm text-charcoal/70">Drag through a few styles for inspiration. Every bouquet is made to order, so yours will be its own thing.</p>
        </div>
        <BouquetRail />
      </section>

      <Occasions />

      <section data-nav="light" className="bg-ivory py-28 lg:py-40" aria-labelledby="personal-heading">
        <div className="shell">
          <div className="mb-14 flex flex-col gap-6 lg:mb-20 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Eyebrow index="04" className="text-rose-deep">
                Personalized designs
              </Eyebrow>
              <RevealText id="personal-heading" text={'Sketch it.\nWe’ll *make it real.*'} className="mt-6 text-[clamp(2.4rem,5vw,4.8rem)] leading-[1] tracking-[-0.03em]" />
            </div>
            <p className="max-w-sm text-charcoal/70">
              Not sure how to describe what you want? Build a rough idea here — stems, palette, finish — and send it along as a starting point.
            </p>
          </div>
          <Atelier />
        </div>
      </section>

      <div id="order" className="scroll-mt-20">
        <HowToOrder />
      </div>

      <InquirySection
        id="flower-note"
        index="06"
        eyebrow="Flower inquiry"
        tone="ivory"
        heading={'Send a *note.*'}
        intro={<>Share the occasion, date and anything you have in mind. Blooms can take it from there by phone or email.</>}
      >
        <GeneralInquiryForm defaultTopic="flowers" />
      </InquirySection>
    </>
  );
}
