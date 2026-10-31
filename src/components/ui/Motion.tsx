import { useRef, type ReactNode } from 'react';
import {
  motion,
  useAnimationFrame,
  useInView,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
  wrap,
} from 'motion/react';
import { Img } from './Img';
import type { ImageKey } from '../../lib/images';
import { cn } from '../../lib/cn';

/** Marquee that drifts on its own and surges/reverses with scroll velocity. */
export function VelocityMarquee({ children, baseVelocity = 2.5, className }: { children: ReactNode; baseVelocity?: number; className?: string }) {
  const baseX = useMotionValue(0);
  const { scrollY } = useScroll();
  const scrollVelocity = useVelocity(scrollY);
  const smooth = useSpring(scrollVelocity, { damping: 50, stiffness: 400 });
  const factor = useTransform(smooth, [-1500, 0, 1500], [-4, 0, 4], { clamp: false });
  const skew = useTransform(smooth, [-2500, 0, 2500], [7, 0, -7]);
  const x = useTransform(baseX, (v) => `${wrap(-25, 0, v)}%`);
  const dir = useRef(1);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);

  useAnimationFrame((_, delta) => {
    if (!inView) return;
    let move = dir.current * baseVelocity * (delta / 1000);
    const f = factor.get();
    if (f < 0) dir.current = -1;
    else if (f > 0) dir.current = 1;
    move += dir.current * move * Math.abs(f);
    baseX.set(baseX.get() - move);
  });

  return (
    <div ref={ref} className={cn('overflow-hidden whitespace-nowrap', className)} aria-hidden="true">
      <motion.div className="flex w-max flex-nowrap" style={{ x, skewX: skew }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex shrink-0 items-center">
            {children}
          </div>
        ))}
      </motion.div>
    </div>
  );
}

type ParallaxImageProps = {
  name: ImageKey;
  className?: string;
  sizes?: string;
  amount?: number;
  tag?: boolean | 'light' | 'dark';
  priority?: boolean;
  cursor?: string;
  position?: string;
  reveal?: boolean;
};

/**
 * Image that wipes open on entry and drifts within its frame as you scroll.
 * The observed wrapper stays unclipped: Chrome's IntersectionObserver honours an
 * element's own clip-path, so a fully clipped element would never count as visible.
 */
export function ParallaxImage({ name, className, sizes, amount = 12, tag = true, priority, cursor, position, reveal = true }: ParallaxImageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.12 });
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [`-${amount}%`, `${amount}%`]);
  const shown = inView || !reveal;
  return (
    <div ref={ref} data-cursor={cursor} className={cn('relative', className)}>
      <motion.div
        className="absolute inset-0 overflow-hidden rounded-[18px]"
        initial={reveal ? { clipPath: 'inset(100% 0% 0% 0% round 18px)' } : false}
        animate={shown ? { clipPath: 'inset(0% 0% 0% 0% round 18px)' } : undefined}
        transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.div className="absolute inset-x-0" style={{ y, top: `-${amount}%`, bottom: `-${amount}%` }}>
          <motion.div
            className="h-full w-full"
            initial={reveal ? { scale: 1.25 } : false}
            animate={shown ? { scale: 1 } : undefined}
            transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <Img name={name} sizes={sizes} className="h-full w-full" priority={priority} position={position} />
          </motion.div>
        </motion.div>
        {tag && (
          <span
            className={cn(
              'illustrative-tag pointer-events-none absolute bottom-3 left-3 z-10 rounded-full px-2.5 py-1 backdrop-blur-md',
              tag === 'dark' ? 'bg-ink/55 text-ivory/90' : 'bg-ivory/75 text-charcoal/80',
            )}
          >
            Illustrative photo
          </span>
        )}
      </motion.div>
    </div>
  );
}

/** Wrapper that tilts its child in 3D toward the pointer. */
export function Tilt({ children, className, max = 8 }: { children: ReactNode; className?: string; max?: number }) {
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, { stiffness: 150, damping: 15 });
  const sry = useSpring(ry, { stiffness: 150, damping: 15 });
  return (
    <motion.div
      className={className}
      style={{ rotateX: srx, rotateY: sry, transformPerspective: 900 }}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return;
        const r = e.currentTarget.getBoundingClientRect();
        ry.set(((e.clientX - r.left) / r.width - 0.5) * max * 2);
        rx.set(-((e.clientY - r.top) / r.height - 0.5) * max * 2);
      }}
      onPointerLeave={() => {
        rx.set(0);
        ry.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}
