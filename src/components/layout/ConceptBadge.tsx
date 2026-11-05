import { useId, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { concept } from '../../data/business';
import { OWNER_APPROVED_LAUNCH, PLATFORM_ENABLED } from '../../lib/platform';

/** Small, always-available disclosure that this is an independent concept. */
export function ConceptBadge() {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (OWNER_APPROVED_LAUNCH) return null;
  return (
    <div className="concept-badge fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 z-[80] transition-opacity duration-300 sm:left-5" data-no-burst>
      <AnimatePresence>
        {open && (
          <motion.div
            id={id}
            role="region"
            aria-label="About this concept"
            className="absolute bottom-full left-0 mb-2 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-charcoal/10 bg-ivory/95 p-5 text-[0.82rem] leading-relaxed text-charcoal shadow-[0_30px_60px_-30px_rgba(52,47,44,0.45)] backdrop-blur-xl"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: 'bottom left' }}
          >
            <p className="eyebrow text-rose-deep">Design concept</p>
            <p className="mt-2">{concept.summary}</p>
            <p className="mt-2 text-charcoal/75">{concept.imagery}</p>
            {!PLATFORM_ENABLED && <p className="mt-2 text-charcoal/75">{concept.forms}</p>}
          </motion.div>
        )}
      </AnimatePresence>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-charcoal/10 bg-ivory/85 px-3 py-2 text-[0.7rem] font-medium tracking-wide text-charcoal/80 shadow-sm backdrop-blur-xl transition hover:text-charcoal"
      >
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inset-0 rounded-full bg-rose" style={{ animation: 'pulse-ring 2.4s ease-out infinite' }} />
          <span className="relative h-2 w-2 rounded-full bg-rose" />
        </span>
        <span className="sm:hidden">Concept · Abraxas</span>
        <span className="hidden sm:inline">Concept by {concept.studio}</span>
        <span className="text-charcoal/70">{open ? '×' : 'ⓘ'}</span>
      </button>
    </div>
  );
}
