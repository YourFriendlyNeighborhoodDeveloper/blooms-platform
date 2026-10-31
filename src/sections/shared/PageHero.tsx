import { useEffect, type ReactNode } from 'react';
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'motion/react';
import { VariableWord } from '../../components/fx/VariableWord';
import { Img } from '../../components/ui/Img';
import { FadeIn } from '../../components/ui/Reveal';
import { useExperience } from '../../components/layout/Experience';
import type { ImageKey } from '../../lib/images';
import { cn } from '../../lib/cn';

const SLOTS = [
  { className: 'right-[5%] top-[17%] w-[13vw] max-w-[230px] aspect-[3/4]', rotate: 6, depth: 1 },
  { className: 'right-[19%] top-[31%] w-[8.5vw] max-w-[150px] aspect-[4/5]', rotate: -7, depth: 1.8 },
];

function FloatCard({ name, slot, i, mx, my, play }: { name: ImageKey; slot: (typeof SLOTS)[number]; i: number; mx: MotionValue<number>; my: MotionValue<number>; play: boolean }) {
  const x = useTransform(mx, (v) => v * 22 * slot.depth);
  const y = useTransform(my, (v) => v * 16 * slot.depth);
  return (
    <motion.div className={cn('absolute z-0 hidden lg:block', slot.className)} style={{ x, y }} aria-hidden="true">
      <motion.div
        className="h-full w-full overflow-hidden rounded-[18px] shadow-[0_40px_80px_-40px_rgba(52,47,44,0.55)] ring-1 ring-white/50"
        initial={{ opacity: 0, y: 60, rotate: slot.rotate * 2, scale: 0.8 }}
        animate={play ? { opacity: 1, y: 0, rotate: slot.rotate, scale: 1 } : undefined}
        whileHover={{ rotate: 0, scale: 1.05 }}
        transition={{ type: 'spring', stiffness: 70, damping: 16, delay: play ? 0.35 + i * 0.15 : 0 }}
      >
        <Img name={name} sizes="14vw" priority className="h-full w-full" />
      </motion.div>
    </motion.div>
  );
}

/** Interior page masthead: a cursor-reactive display word with an editorial dek. */
export function PageHero({
  word,
  srTitle,
  eyebrow,
  children,
  aside,
  images,
  className,
}: {
  word: string;
  srTitle: string;
  eyebrow: string;
  children?: ReactNode;
  aside?: ReactNode;
  images?: [ImageKey, ImageKey];
  className?: string;
}) {
  const { introDone } = useExperience();
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const mx = useSpring(rawX, { stiffness: 50, damping: 16 });
  const my = useSpring(rawY, { stiffness: 50, damping: 16 });

  const hasImages = !!images;
  useEffect(() => {
    if (!hasImages) return;
    const onMove = (e: PointerEvent) => {
      rawX.set((e.clientX / window.innerWidth) * 2 - 1);
      rawY.set((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [hasImages, rawX, rawY]);

  return (
    <section data-nav="light" className={cn('relative overflow-hidden bg-ivory pt-32 pb-16 lg:pt-40 lg:pb-24', className)}>
      {images?.map((name, i) => <FloatCard key={name} name={name} slot={SLOTS[i]} i={i} mx={mx} my={my} play={introDone} />)}
      <div className="shell relative">
        <FadeIn afterIntro y={12} className="eyebrow flex items-center gap-3 text-rose-deep">
          <span className="h-px w-8 bg-current opacity-50" aria-hidden="true" />
          {eyebrow}
        </FadeIn>
        <h1 className="mt-4 font-display leading-none text-charcoal">
          <span className="sr-only">{srTitle}</span>
          <span aria-hidden="true" className="block text-[22vw] tracking-[-0.045em] lg:text-[17vw] 2xl:text-[16rem]">
            <VariableWord text={word} play={introDone} radius={300} />
          </span>
        </h1>
        <div className="mt-6 grid gap-10 lg:mt-10 lg:grid-cols-12">
          <div className="lg:col-span-6">{children}</div>
          {aside && <div className="lg:col-span-5 lg:col-start-8">{aside}</div>}
        </div>
      </div>
    </section>
  );
}
