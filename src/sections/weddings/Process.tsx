import { useRef } from 'react';
import { motion, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react';
import { BloomMark } from '../../components/fx/BloomMark';
import { Eyebrow, RevealText } from '../../components/ui/Reveal';
import { cn } from '../../lib/cn';

const STEPS = [
  { title: 'Say hello', body: 'Call, email or send an inquiry with your date, venue and a rough guest count. A ballpark is plenty to begin.' },
  { title: 'Share your vision', body: 'Bring inspiration photos, colors and must-haves. Talk through flowers, décor and rentals — and what matters most to you.' },
  { title: 'Shape the design', body: 'Your plan comes together around your vision and budget, with details confirmed with you along the way.' },
  { title: 'Celebrate', body: 'On the day, your flowers and décor arrive ready. Ask about delivery, setup and cleanup so you can simply enjoy it.' },
];

function Step({ i, progress, step }: { i: number; progress: MotionValue<number>; step: (typeof STEPS)[number] }) {
  const at = (i + 0.5) / STEPS.length;
  const bloom = useTransform(progress, [at - 0.16, at + 0.02], [0, 1]);
  const opacity = useTransform(progress, [at - 0.2, at - 0.02], [0.25, 1]);
  const right = i % 2 === 1;
  return (
    <motion.li style={{ opacity }} className="relative grid grid-cols-[56px_1fr] gap-5 lg:grid-cols-2 lg:gap-28">
      <div aria-hidden="true" className="lg:hidden" />
      <div className={cn('lg:row-start-1', right ? 'lg:col-start-2' : 'lg:col-start-1 lg:text-right')}>
        <p className="font-display text-lg text-rose-deep italic">Step 0{i + 1}</p>
        <h3 className="mt-2 text-[clamp(2rem,3.6vw,3.4rem)] leading-[1.02] tracking-[-0.03em]">{step.title}</h3>
        <p className={cn('mt-4 max-w-md text-[1.02rem] leading-relaxed text-charcoal/75', !right && 'lg:ml-auto')}>{step.body}</p>
      </div>
      <div className="absolute top-0 left-[28px] -translate-x-1/2 rounded-full bg-ivory p-1.5 lg:left-1/2">
        <BloomMark size={44} progress={bloom} />
      </div>
    </motion.li>
  );
}

/** A vine draws itself as you scroll; each step's bloom opens when the vine arrives. */
export function Process() {
  const ref = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.7', 'end 0.55'] });
  const progress = useSpring(scrollYProgress, { stiffness: 90, damping: 24 });
  return (
    <section data-nav="light" className="relative bg-ivory py-28 lg:py-40" aria-labelledby="process-heading">
      <div className="shell">
        <div className="mx-auto max-w-3xl text-center">
          <Eyebrow index="04" className="justify-center text-rose-deep">
            The consultation process
          </Eyebrow>
          <RevealText id="process-heading" text={'How it typically *unfolds.*'} className="mt-6 text-[clamp(2.4rem,5.4vw,5.2rem)] leading-[1] tracking-[-0.03em]" />
          <p className="mt-6 text-charcoal/70">A typical flow — exact steps and timing are confirmed with you during your consultation.</p>
        </div>
        <div className="relative mt-20 lg:mt-28">
          <svg className="pointer-events-none absolute top-0 bottom-0 left-[28px] h-full w-16 -translate-x-1/2 lg:left-1/2" viewBox="0 0 100 1000" preserveAspectRatio="none" aria-hidden="true">
            <path d="M50 0 C 90 120, 10 250, 50 375 S 90 620, 50 750 S 10 900, 50 1000" fill="none" stroke="#342f2c" strokeOpacity="0.12" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            <motion.path
              d="M50 0 C 90 120, 10 250, 50 375 S 90 620, 50 750 S 10 900, 50 1000"
              fill="none"
              stroke="#64715a"
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
              style={{ pathLength: progress }}
            />
          </svg>
          <ol ref={ref} className="relative space-y-24 lg:space-y-36">
            {STEPS.map((s, i) => (
              <Step key={s.title} i={i} step={s} progress={progress} />
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
