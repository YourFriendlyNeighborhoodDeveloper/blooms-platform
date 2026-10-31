import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { images, srcFor, type ImageKey } from '../../lib/images';
import { useLenis } from '../layout/SmoothScroll';

type Props = { items: ImageKey[]; index: number | null; onChange: (i: number | null) => void };

/** Keyboard-friendly image viewer: arrows to browse, Esc to close, focus kept inside. */
export function Lightbox({ items, index, onChange }: Props) {
  const lenis = useLenis();
  const dialog = useRef<HTMLDivElement>(null);
  const open = index !== null;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    lenis?.stop();
    document.documentElement.style.overflow = 'hidden';
    window.setTimeout(() => dialog.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(), 50);
    return () => {
      lenis?.start();
      document.documentElement.style.overflow = '';
      previous?.focus({ preventScroll: true });
    };
  }, [open, lenis]);

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onChange(null);
      if (e.key === 'ArrowRight') onChange((index + 1) % items.length);
      if (e.key === 'ArrowLeft') onChange((index - 1 + items.length) % items.length);
      if (e.key === 'Tab' && dialog.current) {
        const f = Array.from(dialog.current.querySelectorAll<HTMLElement>('button'));
        const i = f.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, items.length, onChange]);

  return createPortal(
    <AnimatePresence>
      {index !== null && (
        <motion.div
          ref={dialog}
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
          data-theme="dark"
          className="fixed inset-0 z-[96] flex flex-col bg-ink/95 text-ivory backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          data-no-burst
        >
          <div className="flex items-center justify-between px-5 py-4 sm:px-8">
            <p className="text-sm text-ivory/70 tabular-nums">
              {String(index + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}
            </p>
            <button type="button" data-autofocus onClick={() => onChange(null)} className="rounded-full border border-ivory/30 px-4 py-2 text-sm hover:bg-ivory hover:text-ink">
              Close ✕
            </button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 sm:px-20">
            <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-0 cursor-default" onClick={() => onChange(null)} />
            <AnimatePresence mode="wait">
              <motion.figure
                key={items[index]}
                className="relative flex max-h-full flex-col items-center"
                initial={{ opacity: 0, scale: 0.94, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              >
                <img
                  src={srcFor(items[index], 1920)}
                  alt={images[items[index]].alt}
                  className="max-h-[72svh] w-auto max-w-full rounded-[14px] object-contain"
                  width={images[items[index]].width}
                  height={images[items[index]].height}
                />
                <figcaption className="mt-4 max-w-xl text-center text-sm text-ivory/75">
                  {images[items[index]].alt}
                  <span className="illustrative-tag ml-3 rounded-full bg-ivory/10 px-2 py-0.5 text-ivory/70">Illustrative photo</span>
                </figcaption>
              </motion.figure>
            </AnimatePresence>
            <button
              type="button"
              aria-label="Previous image"
              onClick={() => onChange((index - 1 + items.length) % items.length)}
              className="absolute left-3 grid h-12 w-12 place-items-center rounded-full border border-ivory/25 bg-ink/40 hover:bg-ivory hover:text-ink sm:left-6"
            >
              ←
            </button>
            <button
              type="button"
              aria-label="Next image"
              onClick={() => onChange((index + 1) % items.length)}
              className="absolute right-3 grid h-12 w-12 place-items-center rounded-full border border-ivory/25 bg-ink/40 hover:bg-ivory hover:text-ink sm:right-6"
            >
              →
            </button>
          </div>
          <p className="px-5 py-4 text-center text-xs text-ivory/50">Use ← → to browse · Esc to close</p>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
