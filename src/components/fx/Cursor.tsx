import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useSpring } from 'motion/react';
import { useFinePointer } from '../../hooks/useMediaQuery';

type Variant = 'default' | 'link' | 'label' | 'field' | 'hidden';
type CursorState = { variant: Variant; label: string; dark: boolean };

const SIZES: Record<Variant, number> = { default: 34, link: 64, label: 104, field: 0, hidden: 0 };

/**
 * Two-part cursor: an exact dot and a trailing ring. Elements opt into a labelled
 * bubble with data-cursor="View". Dark sections flip it to ivory.
 */
export function Cursor() {
  const fine = useFinePointer();
  const x = useMotionValue(-200);
  const y = useMotionValue(-200);
  const rx = useSpring(x, { stiffness: 420, damping: 36, mass: 0.6 });
  const ry = useSpring(y, { stiffness: 420, damping: 36, mass: 0.6 });
  const [state, setState] = useState<CursorState>({ variant: 'hidden', label: '', dark: false });
  const [pressed, setPressed] = useState(false);
  const visible = useRef(false);

  useEffect(() => {
    if (!fine) return;
    const root = document.documentElement;
    root.classList.add('cursor-custom');

    const update = (next: CursorState) =>
      setState((prev) => (prev.variant === next.variant && prev.label === next.label && prev.dark === next.dark ? prev : next));

    const resolve = (target: Element | null): CursorState => {
      const dark = !!target?.closest('[data-theme="dark"]');
      if (!target) return { variant: 'default', label: '', dark };
      if (target.closest('input, textarea, select')) return { variant: 'field', label: '', dark };
      const labelled = target.closest<HTMLElement>('[data-cursor]');
      if (labelled?.dataset.cursor) return { variant: 'label', label: labelled.dataset.cursor, dark };
      if (target.closest('a, button, [role="button"], summary, label')) return { variant: 'link', label: '', dark };
      return { variant: 'default', label: '', dark };
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      x.set(e.clientX);
      y.set(e.clientY);
      if (!visible.current) {
        visible.current = true;
        rx.jump(e.clientX);
        ry.jump(e.clientY);
        update(resolve(e.target as Element));
      }
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') update(resolve(e.target as Element));
    };
    const onLeave = () => {
      visible.current = false;
      update({ variant: 'hidden', label: '', dark: false });
    };
    const onDown = () => setPressed(true);
    const onUp = () => setPressed(false);

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerover', onOver, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    return () => {
      root.classList.remove('cursor-custom');
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerover', onOver);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    };
  }, [fine, x, y, rx, ry]);

  if (!fine) return null;

  const { variant, label, dark } = state;
  const size = SIZES[variant];
  const ink = dark ? '#f6f0e9' : '#342f2c';
  const isLabel = variant === 'label';

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[100]">
      <motion.div className="absolute top-0 left-0" style={{ x: rx, y: ry }}>
        <motion.div
          className="flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
          animate={{
            width: size,
            height: size,
            backgroundColor: isLabel ? (dark ? '#c7a977' : '#b87f89') : 'rgba(0,0,0,0)',
            borderColor: isLabel ? 'rgba(0,0,0,0)' : variant === 'link' ? (dark ? 'rgba(199,169,119,0.9)' : 'rgba(184,127,137,0.9)') : ink,
            opacity: variant === 'hidden' || variant === 'field' ? 0 : 1,
            scale: pressed ? 0.82 : 1,
          }}
          transition={{ type: 'spring', stiffness: 380, damping: 30, mass: 0.6 }}
          style={{ borderWidth: 1, borderStyle: 'solid' }}
        >
          <AnimatePresence mode="popLayout">
            {isLabel && (
              <motion.span
                key={label}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25 }}
                className="px-2 text-center text-[0.68rem] font-semibold tracking-[0.14em] whitespace-nowrap uppercase"
                style={{ color: dark ? '#221d1b' : '#f6f0e9' }}
              >
                {label}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
      <motion.div className="absolute top-0 left-0" style={{ x, y }}>
        <motion.div
          className="-translate-x-1/2 -translate-y-1/2 rounded-full"
          animate={{
            width: isLabel ? 0 : 6,
            height: isLabel ? 0 : 6,
            backgroundColor: variant === 'link' ? (dark ? '#c7a977' : '#b87f89') : ink,
            opacity: variant === 'hidden' || variant === 'field' ? 0 : 1,
          }}
          transition={{ duration: 0.18 }}
        />
      </motion.div>
    </div>
  );
}
