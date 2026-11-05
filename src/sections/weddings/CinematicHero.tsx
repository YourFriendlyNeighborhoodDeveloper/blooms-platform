import { useEffect, useRef } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import { Img } from '../../components/ui/Img';
import { RevealText, FadeIn } from '../../components/ui/Reveal';
import { Arrow, Button } from '../../components/ui/Button';
import { scrollToTarget, useLenis } from '../../components/layout/SmoothScroll';
import { useExperience } from '../../components/layout/Experience';

const BARS = [0.83, 0, 0.17, 1] as const;

/** Running 24fps timecode — a small, silly bit of cinema. */
function Timecode() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const f = Math.floor(((now - start) / 1000) * 24);
      const ff = f % 24;
      const s = Math.floor(f / 24);
      const pad = (n: number) => String(n).padStart(2, '0');
      if (ref.current) ref.current.textContent = `00:${pad(Math.floor(s / 60))}:${pad(s % 60)}:${pad(ff)}`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <span ref={ref} className="tabular-nums" />;
}

export function CinematicHero() {
  const ref = useRef<HTMLElement>(null);
  const lenis = useLenis();
  const { introDone } = useExperience();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const clip = useTransform(scrollYProgress, [0, 0.8], ['inset(0% 0% 0% 0% round 0px)', 'inset(8% 5% 8% 5% round 32px)']);
  const imgScale = useTransform(scrollYProgress, [0, 1], [1, 1.18]);
  const titleY = useTransform(scrollYProgress, [0, 1], ['0%', '-40%']);
  const titleOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);

  return (
    <section ref={ref} data-nav="dark" data-theme="dark" className="relative h-[100svh] min-h-[640px] overflow-hidden bg-ink text-ivory">
      <motion.div className="absolute inset-0" style={{ clipPath: clip }}>
        <motion.div className="absolute inset-0" style={{ scale: imgScale }}>
          <motion.div className="absolute inset-0" initial={{ scale: 1.22 }} animate={{ scale: 1 }} transition={{ duration: 9, ease: [0.16, 1, 0.3, 1] }}>
            <Img name="bride-moody" priority sizes="100vw" className="h-full w-full" position="50% 40%" />
          </motion.div>
        </motion.div>
        <div className="absolute inset-0 bg-gradient-to-b from-ink/60 via-ink/10 to-ink/85" />
        <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_30%_70%,rgba(34,29,27,0.55),transparent)]" />
      </motion.div>

      <motion.div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 z-[3] bg-ink"
        initial={{ height: '50.5%' }}
        animate={{ height: introDone ? '7svh' : '50.5%' }}
        transition={{ duration: 1.7, ease: BARS, delay: 0.15 }}
      />
      <motion.div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 z-[3] flex items-start justify-end gap-8 bg-ink px-[var(--gutter)] pt-3 text-[0.62rem] tracking-[0.2em] text-ivory/50 uppercase"
        initial={{ height: '50.5%' }}
        animate={{ height: introDone ? '7svh' : '50.5%' }}
        transition={{ duration: 1.7, ease: BARS, delay: 0.15 }}
      >
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose" /> Weddings &amp; Events — Saginaw, MI
        </span>
        <span className="hidden sm:inline">
          TC <Timecode />
        </span>
      </motion.div>

      <motion.div style={{ y: titleY, opacity: titleOpacity }} className="shell relative z-[2] flex h-full flex-col justify-end pb-[13svh]">
        <FadeIn afterIntro delay={1.2} y={10} className="eyebrow text-gold">
          Weddings &amp; Events
        </FadeIn>
        <RevealText
          as="h1"
          afterIntro
          delay={1.3}
          text={'Your vision,\n*beautifully brought to life.*'}
          className="mt-5 max-w-[16ch] text-[clamp(2.8rem,8vw,8.4rem)] leading-[0.95] tracking-[-0.04em]"
          emClassName="italic text-gold"
        />
        <FadeIn afterIntro delay={1.8} className="mt-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <p className="max-w-md text-[1.05rem] leading-relaxed text-ivory/80">
            Wedding florals, ceremony and reception design, rentals and styling — for weddings and celebrations around Saginaw, Michigan.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => scrollToTarget(lenis, '#inquire')} variant="light" size="lg" icon={<Arrow direction="down" />}>
              Start your inquiry
            </Button>
            <Button onClick={() => scrollToTarget(lenis, '#gallery')} variant="ghost-light" size="lg">
              See the gallery
            </Button>
          </div>
        </FadeIn>
      </motion.div>
    </section>
  );
}
