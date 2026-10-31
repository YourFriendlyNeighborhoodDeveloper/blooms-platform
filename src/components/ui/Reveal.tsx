import { Fragment, useRef, type ElementType, type ReactNode, type Ref } from 'react';
import { motion, useInView, useScroll, useTransform, type MotionValue } from 'motion/react';
import { cn } from '../../lib/cn';
import { useExperience } from '../layout/Experience';

const EASE = [0.16, 1, 0.3, 1] as const;

type Token = { text: string; em: boolean };

/** Splits "plain *emphasis* text\nnext line" into lines of word tokens. */
function tokenize(text: string): Token[][] {
  return text.split('\n').map((line) => {
    const tokens: Token[] = [];
    line.split(/(\*[^*]+\*)/g).forEach((chunk) => {
      if (!chunk) return;
      const em = chunk.startsWith('*') && chunk.endsWith('*');
      const body = em ? chunk.slice(1, -1) : chunk;
      body.split(/\s+/).forEach((w) => w && tokens.push({ text: w, em }));
    });
    return tokens;
  });
}

type RevealTextProps = {
  text: string;
  as?: ElementType;
  className?: string;
  emClassName?: string;
  delay?: number;
  stagger?: number;
  /** Wait for the intro to finish before animating (hero copy). */
  afterIntro?: boolean;
  once?: boolean;
  id?: string;
};

/** Headline whose words rise out of masks as it enters the viewport. */
export function RevealText({
  text,
  as: Tag = 'h2',
  className,
  emClassName = 'italic text-rose-deep',
  delay = 0,
  stagger = 0.06,
  afterIntro,
  once = true,
  id,
}: RevealTextProps) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once, amount: 0.2 });
  const { introDone } = useExperience();
  const show = inView && (!afterIntro || introDone);
  const lines = tokenize(text);
  let n = 0;
  return (
    <Tag ref={ref} className={className} id={id}>
      <span className="sr-only">{text.replace(/\*/g, '')}</span>
      <span aria-hidden="true">
        {lines.map((line, li) => (
          <Fragment key={li}>
            {line.map((tok, wi) => {
              const i = n++;
              return (
                <Fragment key={wi}>
                  <span className="inline-block overflow-hidden pt-[0.06em] pb-[0.14em] align-top -my-[0.06em]">
                    <motion.span
                      className={cn('inline-block', tok.em && emClassName)}
                      initial={{ y: '110%', rotate: 4 }}
                      animate={show ? { y: '0%', rotate: 0 } : { y: '110%', rotate: 4 }}
                      transition={{ duration: 1.1, delay: delay + i * stagger, ease: EASE }}
                    >
                      {tok.text}
                    </motion.span>
                  </span>
                  {wi < line.length - 1 && ' '}
                </Fragment>
              );
            })}
            {li < lines.length - 1 && <br />}
          </Fragment>
        ))}
      </span>
    </Tag>
  );
}

type FadeProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  as?: 'div' | 'p' | 'li' | 'span';
  afterIntro?: boolean;
};

/** Gentle fade-and-rise for supporting copy. */
export function FadeIn({ children, className, delay = 0, y = 28, as = 'div', afterIntro }: FadeProps) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.15 });
  const { introDone } = useExperience();
  const show = inView && (!afterIntro || introDone);
  const MotionTag = motion[as] as typeof motion.div;
  return (
    <MotionTag
      ref={ref as Ref<HTMLDivElement>}
      className={className}
      initial={{ opacity: 0, y }}
      animate={show ? { opacity: 1, y: 0 } : { opacity: 0, y }}
      transition={{ duration: 1.1, delay, ease: EASE }}
    >
      {children}
    </MotionTag>
  );
}

type ScrollTextPart = string | { image: ReactNode; label: string };

/**
 * Paragraph whose words light up as you scroll through it — inline image
 * capsules swell open as their turn comes.
 */
export function ScrollText({ parts, className }: { parts: ScrollTextPart[]; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.85', 'end 0.45'] });
  const units: Array<{ kind: 'word'; text: string } | { kind: 'image'; image: ReactNode }> = [];
  parts.forEach((p) => {
    if (typeof p === 'string') p.split(/\s+/).forEach((w) => w && units.push({ kind: 'word', text: w }));
    else units.push({ kind: 'image', image: p.image });
  });
  const plain = parts.map((p) => (typeof p === 'string' ? p : '')).join(' ').replace(/\s+/g, ' ').trim();
  return (
    <p ref={ref} className={className}>
      <span className="sr-only">{plain}</span>
      <span aria-hidden="true">
        {units.map((u, i) => {
          const range: [number, number] = [i / units.length, (i + 1) / units.length];
          return u.kind === 'word' ? (
            <Fragment key={i}>
              <ScrollWord progress={scrollYProgress} range={range}>
                {u.text}
              </ScrollWord>{' '}
            </Fragment>
          ) : (
            <Fragment key={i}>
              <ScrollCapsule progress={scrollYProgress} range={range}>
                {u.image}
              </ScrollCapsule>{' '}
            </Fragment>
          );
        })}
      </span>
    </p>
  );
}

function ScrollWord({ progress, range, children }: { progress: MotionValue<number>; range: [number, number]; children: ReactNode }) {
  const opacity = useTransform(progress, range, [0.14, 1]);
  return <motion.span style={{ opacity }}>{children}</motion.span>;
}

function ScrollCapsule({ progress, range, children }: { progress: MotionValue<number>; range: [number, number]; children: ReactNode }) {
  const width = useTransform(progress, [range[0] - 0.04, range[1] + 0.02], ['0.4em', '2.1em']);
  const opacity = useTransform(progress, [range[0] - 0.06, range[1]], [0.2, 1]);
  return (
    <motion.span
      className="relative mx-[0.06em] inline-block h-[0.78em] translate-y-[0.08em] overflow-hidden rounded-full align-baseline"
      style={{ width, opacity }}
    >
      {children}
    </motion.span>
  );
}

/** Eyebrow index label, e.g. "(02) Weddings & Events". */
export function Eyebrow({ index, children, className }: { index?: string; children: ReactNode; className?: string }) {
  return (
    <p className={cn('eyebrow flex items-center gap-3', className)}>
      {index && <span className="font-display text-[0.9rem] font-normal tracking-normal normal-case italic">({index})</span>}
      <span className="h-px w-8 bg-current opacity-40" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
