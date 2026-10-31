import { Fragment } from 'react';
import { VelocityMarquee } from '../../components/ui/Motion';
import { BloomMark } from '../../components/fx/BloomMark';
import { cn } from '../../lib/cn';

/** Oversized, scroll-reactive word band. Alternates filled and outlined type. */
export function WordBand({ words, tone = 'light', className }: { words: string[]; tone?: 'light' | 'dark' | 'rose'; className?: string }) {
  const ink = tone === 'dark' ? '#f6f0e9' : '#342f2c';
  return (
    <div
      data-nav={tone === 'dark' ? 'dark' : 'light'}
      className={cn(
        'relative py-8 lg:py-12',
        tone === 'dark' ? 'bg-ink text-ivory' : tone === 'rose' ? 'bg-blush text-charcoal' : 'bg-ivory text-charcoal',
        className,
      )}
    >
      <VelocityMarquee baseVelocity={2}>
        {words.map((w, i) => (
          <Fragment key={w}>
            <span
              className={cn('px-6 font-display text-[clamp(3.5rem,11vw,10rem)] leading-none tracking-[-0.04em]', i % 2 === 1 && 'italic')}
              style={
                i % 2
                  ? { color: 'transparent', WebkitTextStroke: `1.2px ${ink}`, fontVariationSettings: "'SOFT' 100, 'WONK' 1" }
                  : { fontVariationSettings: "'SOFT' 100, 'WONK' 0" }
              }
            >
              {w}
            </span>
            <BloomMark size={56} play tone={tone === 'dark' ? 'dark' : 'light'} spin className="shrink-0" />
          </Fragment>
        ))}
      </VelocityMarquee>
    </div>
  );
}
