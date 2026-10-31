import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { motion, useMotionValue, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react';
import { SilkShader } from '../../components/fx/SilkShader';
import { VariableWord } from '../../components/fx/VariableWord';
import { Img } from '../../components/ui/Img';
import { Arrow, Button } from '../../components/ui/Button';
import { RevealText, FadeIn } from '../../components/ui/Reveal';
import { useExperience } from '../../components/layout/Experience';
import type { ImageKey } from '../../lib/images';
import { cn } from '../../lib/cn';

type CardSpec = {
  name: ImageKey;
  to: string;
  label: string;
  className: string;
  aspect: string;
  depth: number;
  rotate: number;
  drift: number;
  delay: number;
};

const CARDS: CardSpec[] = [
  { name: 'bouquet-blush', to: '/flowers', label: 'Flowers', className: 'left-[4%] top-[17%] w-[30vw] sm:w-[22vw] lg:left-[6%] lg:top-[19%] lg:w-[15vw] max-w-[250px]', aspect: 'aspect-[3/4]', depth: 0.7, rotate: -7, drift: -18, delay: 0.25 },
  { name: 'bride-bouquet-blush', to: '/weddings-events', label: 'Weddings', className: 'right-[5%] top-[13%] w-[27vw] sm:w-[19vw] lg:right-[7%] lg:top-[23%] lg:w-[13vw] max-w-[220px]', aspect: 'aspect-[4/5]', depth: 1.1, rotate: 6, drift: -34, delay: 0.4 },
  { name: 'peony', to: '/flowers', label: 'Flowers', className: 'right-[6%] bottom-[33%] w-[22vw] md:right-[24%] md:bottom-[19%] md:w-[10vw] max-w-[160px]', aspect: 'aspect-square', depth: 1.6, rotate: -4, drift: -52, delay: 0.55 },
  { name: 'knits', to: '/boutique', label: 'Boutique', className: 'hidden md:block left-[25%] bottom-[25%] w-[8.5vw] max-w-[140px]', aspect: 'aspect-[3/4]', depth: 1.3, rotate: 5, drift: -40, delay: 0.7 },
];

function HeroCard({ spec, mx, my, progress, play }: { spec: CardSpec; mx: MotionValue<number>; my: MotionValue<number>; progress: MotionValue<number>; play: boolean }) {
  const x = useTransform(mx, (v) => v * spec.depth * 26);
  const yMouse = useTransform(my, (v) => v * spec.depth * 18);
  const yScroll = useTransform(progress, [0, 1], ['0vh', `${spec.drift}vh`]);
  const rot = useTransform(progress, [0, 1], [spec.rotate, spec.rotate * 2.2]);
  return (
    <motion.div className={cn('absolute z-[1]', spec.className)} style={{ x, y: yScroll }}>
      <motion.div style={{ y: yMouse }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.6, y: 80 }}
          animate={play ? { opacity: 1, scale: 1, y: 0 } : undefined}
          transition={{ duration: 1.6, delay: spec.delay, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.div style={{ rotate: rot }} whileHover={{ scale: 1.06, rotate: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 18 }}>
            <Link
              to={spec.to}
              data-cursor={spec.label}
              tabIndex={-1}
              aria-hidden="true"
              className="block overflow-hidden rounded-[18px] shadow-[0_40px_80px_-40px_rgba(52,47,44,0.55)] ring-1 ring-white/40"
            >
              <Img name={spec.name} sizes="(min-width: 1024px) 16vw, 30vw" priority className={spec.aspect} />
            </Link>
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const { introDone } = useExperience();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const mx = useSpring(rawX, { stiffness: 60, damping: 18 });
  const my = useSpring(rawY, { stiffness: 60, damping: 18 });
  const wordY = useTransform(scrollYProgress, [0, 1], ['0%', '38%']);
  const wordScale = useTransform(scrollYProgress, [0, 1], [1, 0.82]);
  const wordOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);
  const tracking = useTransform(scrollYProgress, [0, 1], ['-0.045em', '0.04em']);
  const fade = useTransform(scrollYProgress, [0, 0.5], [1, 0]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      rawX.set((e.clientX / window.innerWidth) * 2 - 1);
      rawY.set((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [rawX, rawY]);

  return (
    <section ref={ref} data-nav="light" className="relative h-[100svh] min-h-[620px] overflow-hidden">
      <SilkShader />

      {CARDS.map((c) => (
        <HeroCard key={c.name} spec={c} mx={mx} my={my} progress={scrollYProgress} play={introDone} />
      ))}

      <div className="shell relative z-[2] flex h-full flex-col justify-between pt-24 pb-8 lg:pt-28 lg:pb-10">
        <FadeIn afterIntro delay={0.2} y={12} className="flex items-start justify-between gap-6 text-charcoal/75">
          <p className="eyebrow max-w-[16rem]">Florist · Weddings &amp; Events · Boutique</p>
          <p className="eyebrow hidden text-right sm:block">
            Gratiot Road
            <br />
            Saginaw, Michigan
          </p>
        </FadeIn>

        <motion.div style={{ y: wordY, scale: wordScale, opacity: wordOpacity }} className="pointer-events-none -mt-8 text-center select-none sm:-mt-4">
          <h1 className="font-display leading-none text-charcoal">
            <motion.span style={{ letterSpacing: tracking }} className="pointer-events-auto block text-[28vw] sm:text-[24vw] lg:text-[22vw] 2xl:text-[20rem]">
              <VariableWord text="Blooms" play={introDone} />
            </motion.span>
            <span className="sr-only"> Boutique &amp; Floral — florist, wedding and event design, and boutique in Saginaw, Michigan</span>
          </h1>
        </motion.div>

        <motion.div style={{ opacity: fade }} className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
          <RevealText
            as="p"
            afterIntro
            delay={0.35}
            stagger={0.05}
            text={'Beautiful flowers.\nThoughtful gifts.\n*Unforgettable celebrations.*'}
            className="font-display text-[clamp(1.55rem,3.1vw,2.6rem)] leading-[1.08] tracking-[-0.02em] text-charcoal"
          />
          <FadeIn afterIntro delay={0.9} y={16} className="flex flex-col gap-3 sm:flex-row lg:pb-1">
            <Button to="/flowers" variant="solid" size="lg" icon={<Arrow />}>
              Explore Flowers
            </Button>
            <Button to="/weddings-events" variant="outline" size="lg">
              Plan Your Event
            </Button>
          </FadeIn>
        </motion.div>
      </div>

      <motion.div style={{ opacity: fade }} className="pointer-events-none absolute bottom-3 left-1/2 z-[2] hidden -translate-x-1/2 flex-col items-center gap-2 lg:flex" aria-hidden="true">
        <span className="eyebrow text-[0.6rem] text-charcoal/50">Scroll</span>
        <span className="relative block h-10 w-px overflow-hidden bg-charcoal/15">
          <motion.span className="absolute inset-x-0 top-0 h-1/2 bg-charcoal/70" animate={{ y: ['-100%', '200%'] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }} />
        </span>
      </motion.div>
      <p className="absolute right-4 bottom-3 z-[2] hidden text-[0.65rem] tracking-wide text-charcoal/45 lg:block">Photography shown is illustrative</p>
    </section>
  );
}
