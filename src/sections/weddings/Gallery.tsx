import { useRef, useState } from 'react';
import { motion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { Img } from '../../components/ui/Img';
import { Lightbox } from '../../components/ui/Lightbox';
import { Eyebrow, RevealText } from '../../components/ui/Reveal';
import { images, type ImageKey } from '../../lib/images';
import { cn } from '../../lib/cn';

const COLUMNS: Array<{ items: Array<{ name: ImageKey; aspect: string }>; speed: [string, string]; className?: string }> = [
  {
    items: [
      { name: 'bride-bouquet-blush', aspect: 'aspect-[3/4]' },
      { name: 'chairs-florals', aspect: 'aspect-[4/5]' },
      { name: 'rings-roses', aspect: 'aspect-[4/3]' },
      { name: 'veil', aspect: 'aspect-[3/4]' },
    ],
    speed: ['4%', '-6%'],
  },
  {
    items: [
      { name: 'gazebo', aspect: 'aspect-[4/5]' },
      { name: 'couple-bouquet', aspect: 'aspect-[3/4]' },
      { name: 'tablescape', aspect: 'aspect-[4/3]' },
      { name: 'petal-exit', aspect: 'aspect-[4/5]' },
    ],
    speed: ['18%', '-22%'],
  },
  {
    items: [
      { name: 'reception-table', aspect: 'aspect-[4/5]' },
      { name: 'curtain-couple', aspect: 'aspect-[3/4]' },
      { name: 'rings-blooms', aspect: 'aspect-square' },
      { name: 'couple-autumn', aspect: 'aspect-[3/4]' },
    ],
    speed: ['8%', '-10%'],
    className: 'hidden lg:flex',
  },
];

const ALL: ImageKey[] = COLUMNS.flatMap((c) => c.items.map((i) => i.name));

function Column({ col, progress, open }: { col: (typeof COLUMNS)[number]; progress: MotionValue<number>; open: (k: ImageKey) => void }) {
  const y = useTransform(progress, [0, 1], col.speed);
  return (
    <motion.div style={{ y }} className={cn('flex flex-1 flex-col gap-3 sm:gap-5', col.className)}>
      {col.items.map((it) => (
        <button
          key={it.name}
          type="button"
          onClick={() => open(it.name)}
          data-cursor="Enlarge"
          aria-label={`Enlarge image: ${images[it.name].alt}`}
          className="group relative block overflow-hidden rounded-[18px]"
        >
          <Img
            name={it.name}
            sizes="(min-width: 1024px) 30vw, 48vw"
            className={cn(it.aspect, 'w-full transition-transform duration-[1.4s] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.05]')}
          />
          <span className="absolute inset-0 bg-ink/0 transition-colors duration-500 group-hover:bg-ink/15" />
        </button>
      ))}
    </motion.div>
  );
}

export function WeddingGallery() {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState<number | null>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  return (
    <section id="gallery" data-nav="light" className="relative overflow-hidden bg-ivory py-28 lg:py-40" aria-labelledby="gallery-heading">
      <div className="shell">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Eyebrow index="02" className="text-rose-deep">
              Wedding floral gallery
            </Eyebrow>
            <RevealText id="gallery-heading" text={'Moments, *dressed in flowers.*'} className="mt-6 text-[clamp(2.4rem,5.4vw,5.2rem)] leading-[1] tracking-[-0.03em]" />
          </div>
          <p className="max-w-sm text-charcoal/70">
            Tap any image to enlarge. All photographs here are illustrative stand-ins — Blooms&rsquo; own wedding portfolio would replace them.
          </p>
        </div>
        <div ref={ref} className="mt-16 flex gap-3 sm:gap-5 lg:mt-24">
          {COLUMNS.map((col, i) => (
            <Column key={i} col={col} progress={scrollYProgress} open={(k) => setIndex(ALL.indexOf(k))} />
          ))}
        </div>
      </div>
      <Lightbox items={ALL} index={index} onChange={setIndex} />
    </section>
  );
}
