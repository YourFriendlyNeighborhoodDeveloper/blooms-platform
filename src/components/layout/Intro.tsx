import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BloomMark } from '../fx/BloomMark';
import { useExperience } from './Experience';
import { useLenis } from './SmoothScroll';

const EASE = [0.83, 0, 0.17, 1] as const;

/** First-visit overture: a bloom unfurls, the name rises, then the curtain lifts. */
export function Intro() {
  const { introDone, finishIntro } = useExperience();
  const lenis = useLenis();
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (introDone) return;
    let cancelled = false;
    const fallback = window.setTimeout(() => !cancelled && setReady(true), 1400);
    document.fonts?.ready.then(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
    };
  }, [introDone]);

  useEffect(() => {
    if (!ready || introDone) return;
    const t1 = window.setTimeout(() => setLeaving(true), 2100);
    const t2 = window.setTimeout(finishIntro, 2350);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [ready, introDone, finishIntro]);

  useEffect(() => {
    if (introDone) return;
    lenis?.stop();
    return () => lenis?.start();
  }, [introDone, lenis]);

  return (
    <AnimatePresence>
      {!introDone && (
        <motion.div
          key="intro"
          className="fixed inset-0 z-[95] flex flex-col items-center justify-center bg-ivory"
          initial={{ clipPath: 'inset(0% 0% 0% 0%)' }}
          exit={{ clipPath: 'inset(0% 0% 100% 0%)' }}
          transition={{ duration: 1.05, ease: EASE }}
          role="presentation"
        >
          <motion.div
            animate={leaving ? { scale: 7, opacity: 0, rotate: 50 } : { scale: 1, opacity: 1, rotate: 0 }}
            transition={{ duration: 1.1, ease: [0.7, 0, 0.84, 0] }}
          >
            <BloomMark size={120} play={ready} delay={0.1} />
          </motion.div>
          <div className="mt-8 overflow-hidden">
            <motion.p
              className="font-display text-[clamp(3rem,9vw,6.5rem)] leading-none text-charcoal"
              style={{ fontVariationSettings: "'SOFT' 100, 'WONK' 1, 'opsz' 144" }}
              initial={{ y: '110%' }}
              animate={ready && !leaving ? { y: '0%' } : leaving ? { y: '-110%' } : { y: '110%' }}
              transition={{ duration: 1, delay: leaving ? 0 : 0.55, ease: [0.16, 1, 0.3, 1] }}
            >
              Blooms
            </motion.p>
          </div>
          <motion.p
            className="eyebrow mt-4 text-charcoal/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: ready && !leaving ? 1 : 0 }}
            transition={{ duration: 0.8, delay: leaving ? 0 : 0.9 }}
          >
            Boutique &amp; Floral · Saginaw, Michigan
          </motion.p>
          <motion.div
            className="absolute bottom-10 h-px w-40 origin-left bg-charcoal/30"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: ready ? 1 : 0.1 }}
            transition={{ duration: 1.9, ease: [0.65, 0, 0.35, 1] }}
          />
          <button
            type="button"
            onClick={finishIntro}
            className="absolute right-5 bottom-6 rounded-full px-4 py-2 text-xs tracking-widest text-charcoal/60 uppercase hover:text-charcoal"
          >
            Skip intro
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
