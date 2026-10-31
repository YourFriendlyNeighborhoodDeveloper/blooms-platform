import { useRef } from 'react';
import { motion, useAnimationFrame, useInView, useMotionValue, useScroll, useSpring, useTransform } from 'motion/react';
import { PageHero } from '../sections/shared/PageHero';
import { Visit } from '../sections/shared/Visit';
import { Img } from '../components/ui/Img';
import { ParallaxImage } from '../components/ui/Motion';
import { Arrow, Button } from '../components/ui/Button';
import { FadeIn, RevealText } from '../components/ui/Reveal';
import { business, links } from '../data/business';
import { useIsDesktop } from '../hooks/useMediaQuery';
import type { ImageKey } from '../lib/images';
import { cn } from '../lib/cn';

const RING: Array<{ name: ImageKey; label: string }> = [
  { name: 'knits', label: 'Clothing' },
  { name: 'gift-pink', label: 'Gifts' },
  { name: 'home-boho', label: 'Home' },
  { name: 'autumn-leaves', label: 'Seasonal' },
  { name: 'rack-light', label: 'Clothing' },
  { name: 'candle', label: 'Home' },
  { name: 'gift-held', label: 'Gifts' },
  { name: 'home-living', label: 'Home' },
  { name: 'sage-shirts', label: 'Clothing' },
  { name: 'pitcher-blooms', label: 'Gifts' },
];

/** A 3D carousel that turns with scroll, drifts on its own, and spins when dragged. */
function Ring() {
  const ref = useRef<HTMLDivElement>(null);
  const desktop = useIsDesktop();
  const inView = useInView(ref);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const scrollRot = useTransform(scrollYProgress, [0, 1], [40, -220]);
  const drift = useMotionValue(0);
  const drag = useMotionValue(0);
  const dragSmooth = useSpring(drag, { stiffness: 60, damping: 20 });
  const rotateY = useTransform(() => scrollRot.get() + drift.get() + dragSmooth.get());
  const card = desktop ? 230 : 140;
  const radius = Math.round((card / (2 * Math.tan(Math.PI / RING.length))) * 1.18);

  useAnimationFrame((_, delta) => {
    if (inView) drift.set(drift.get() - delta * 0.004);
  });

  return (
    <div
      ref={ref}
      className="relative flex h-[62svh] min-h-[420px] touch-pan-y items-center justify-center select-none"
      style={{ perspective: desktop ? 1600 : 900 }}
      data-cursor="Spin"
    >
      <motion.div
        className="relative cursor-grab active:cursor-grabbing"
        style={{ width: card, height: card * 1.3, transformStyle: 'preserve-3d', rotateX: -8, rotateY }}
        onPan={(_, info) => drag.set(drag.get() + info.delta.x * 0.35)}
      >
        {RING.map((r, i) => (
          <div
            key={r.name}
            className="absolute inset-0 overflow-hidden rounded-[18px] shadow-[0_30px_60px_-30px_rgba(52,47,44,0.6)]"
            style={{ transform: `rotateY(${(360 / RING.length) * i}deg) translateZ(${radius}px)`, backfaceVisibility: 'hidden' }}
          >
            <Img name={r.name} sizes="240px" className="h-full w-full" />
            <span className="absolute inset-x-3 bottom-3 rounded-full bg-ivory/85 px-3 py-1 text-center text-[0.72rem] font-medium tracking-wide backdrop-blur-sm">{r.label}</span>
          </div>
        ))}
      </motion.div>
      <p className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[0.72rem] text-charcoal/50">Drag to spin · illustrative photography</p>
    </div>
  );
}

const SECTIONS: Array<{ id: string; title: string; dek: string; body: string; a: ImageKey; b: ImageKey }> = [
  {
    id: 'clothing',
    title: 'Clothing',
    dek: 'Easy, wearable pieces.',
    body: 'Clothing chosen for the shop, worth a browse while you pick up flowers — or the reason you stopped in. Selection changes, so call or visit to see what’s on the rail.',
    a: 'knits',
    b: 'sage-shirts',
  },
  {
    id: 'gifts',
    title: 'Gifts',
    dek: 'For the people you’d send flowers to.',
    body: 'Thoughtful gifts to pair with a bouquet, tuck into a basket, or give on their own. Ask the shop to help you put something together.',
    a: 'gift-pink',
    b: 'gift-held',
  },
  {
    id: 'home',
    title: 'Home décor',
    dek: 'Texture, warmth, a little whimsy.',
    body: 'Pieces that bring a softer, more personal feel to a room — the kind of décor that sits happily beside a vase of fresh flowers.',
    a: 'home-boho',
    b: 'candle',
  },
  {
    id: 'seasonal',
    title: 'Seasonal',
    dek: 'What’s out follows the calendar.',
    body: 'Seasonal collections and displays come and go through the year. Ask what’s in now, or check the shop’s Facebook page.',
    a: 'autumn-leaves',
    b: 'home-living',
  },
];

export default function Boutique() {
  return (
    <>
      <PageHero
        images={['knits', 'gift-pink']}
        word="Boutique"
        srTitle="The boutique: clothing, gifts and home décor"
        eyebrow="Clothing · Gifts · Home décor · Seasonal"
        aside={
          <FadeIn afterIntro delay={0.45} className="text-[1.05rem] leading-relaxed text-charcoal/75">
            Alongside the flowers, the shop on Gratiot Road carries clothing, gifts, home décor and seasonal pieces. This page is a showcase — there&rsquo;s
            no online store, so the best way to shop is in person.
          </FadeIn>
        }
      >
        <FadeIn afterIntro delay={0.3}>
          <p className="font-display text-[clamp(1.6rem,2.8vw,2.4rem)] leading-[1.1]">
            Come for the flowers. <em className="text-rose-deep">Stay for a browse.</em>
          </p>
        </FadeIn>
      </PageHero>

      <section data-nav="light" className="overflow-hidden bg-gradient-to-b from-ivory to-ivory-deep pb-16" aria-label="Boutique lookbook carousel">
        <Ring />
      </section>

      <section data-nav="light" className="bg-ivory-deep py-20 lg:py-32" aria-label="Boutique categories">
        <div className="shell space-y-28 lg:space-y-44">
          {SECTIONS.map((s, i) => {
            const flip = i % 2 === 1;
            return (
              <article key={s.id} id={s.id} className="grid scroll-mt-28 items-center gap-10 lg:grid-cols-12 lg:gap-16" aria-labelledby={`${s.id}-title`}>
                <div className={cn('relative lg:col-span-7', flip && 'lg:order-2 lg:col-start-6')}>
                  <ParallaxImage name={s.a} className="aspect-[4/5] w-[82%] sm:aspect-[5/6]" sizes="(min-width:1024px) 45vw, 80vw" />
                  <ParallaxImage
                    name={s.b}
                    className="absolute right-0 -bottom-10 aspect-square w-[42%] rounded-[18px] shadow-[0_40px_80px_-40px_rgba(52,47,44,0.6)] ring-8 ring-ivory-deep"
                    sizes="25vw"
                    amount={8}
                    tag={false}
                  />
                </div>
                <div className={cn('lg:col-span-4', flip ? 'lg:order-1 lg:col-start-1' : 'lg:col-start-9')}>
                  <p className="font-display text-lg text-rose-deep italic">0{i + 1} / 04</p>
                  <RevealText as="h2" id={`${s.id}-title`} text={s.title} className="mt-3 text-[clamp(3rem,6vw,6rem)] leading-[0.95] tracking-[-0.04em]" />
                  <p className="mt-4 font-display text-[1.5rem] italic">{s.dek}</p>
                  <FadeIn className="mt-5 text-[1.02rem] leading-relaxed text-charcoal/75">{s.body}</FadeIn>
                  <a href={links.tel} className="group mt-8 inline-flex items-center gap-3 text-[0.95rem] font-medium text-rose-deep">
                    <span className="link-underline">Ask what&rsquo;s in · {business.phone.display}</span>
                    <Arrow className="transition-transform group-hover:translate-x-1" />
                  </a>
                </div>
              </article>
            );
          })}
        </div>
        <div className="shell mt-28">
          <div className="flex flex-col items-start justify-between gap-6 rounded-[28px] bg-charcoal p-8 text-ivory sm:p-12 lg:flex-row lg:items-center" data-theme="dark">
            <div>
              <p className="eyebrow text-gold">Display catalog</p>
              <p className="mt-3 max-w-2xl font-display text-[clamp(1.6rem,3vw,2.4rem)] leading-tight">
                No online checkout, prices or stock lists — just a reason to visit. Products shown are illustrative.
              </p>
            </div>
            <Button href={links.googleDirections} external variant="light" size="lg" icon={<Arrow direction="up-right" />}>
              Get directions
            </Button>
          </div>
        </div>
      </section>

      <Visit index="05" heading={'Browse *in person.*'} />
    </>
  );
}
