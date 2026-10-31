import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { BloomMark } from '../fx/BloomMark';
import { Seo } from './Seo';
import type { PageMeta } from '../../data/seo';

const CURTAIN_EASE = [0.83, 0, 0.17, 1] as const;
let firstPage = true;

/**
 * Wraps each route. On leave a blush curtain rises over the page; on arrival it
 * lifts away again, carrying the destination's name.
 */
export function PageShell({ meta, children }: { meta: PageMeta; children: ReactNode }) {
  const [skipEnter] = useState(() => firstPage);
  useEffect(() => {
    firstPage = false;
  }, []);

  return (
    <>
      <Seo meta={meta} />
      {children}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[90] bg-blush"
        initial={{ clipPath: 'inset(100% 0% 0% 0%)' }}
        animate={{ clipPath: 'inset(100% 0% 0% 0%)' }}
        exit={{ clipPath: 'inset(0% 0% 0% 0%)' }}
        transition={{ duration: 0.75, ease: CURTAIN_EASE }}
      />
      {!skipEnter && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[90] flex flex-col items-center justify-center gap-6 bg-blush"
          initial={{ clipPath: 'inset(0% 0% 0% 0%)' }}
          animate={{ clipPath: 'inset(0% 0% 100% 0%)' }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9, delay: 0.35, ease: CURTAIN_EASE }}
        >
          <BloomMark size={72} />
          <motion.p
            className="font-display text-[clamp(2.5rem,7vw,5.5rem)] text-charcoal italic"
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: -20, opacity: 1 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          >
            {meta.label}
          </motion.p>
        </motion.div>
      )}
    </>
  );
}
