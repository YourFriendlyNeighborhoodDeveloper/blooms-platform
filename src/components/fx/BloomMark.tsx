import { motion, useTransform, type MotionValue } from 'motion/react';

const OUTER = 'M0 0 C 10 -7 14 -27 0 -41 C -14 -27 -10 -7 0 0 Z';
const INNER = 'M0 0 C 8 -6 10 -20 0 -29 C -10 -20 -8 -6 0 0 Z';
const OUTER_N = 8;
const INNER_N = 5;

type Palette = { outer: string; inner: string; stroke: string; center: string };
const LIGHT: Palette = { outer: '#e8d5cf', inner: '#b87f89', stroke: '#b87f89', center: '#c7a977' };
const DARK: Palette = { outer: '#4a403c', inner: '#b87f89', stroke: '#c7a977', center: '#c7a977' };

type Props = {
  size?: number | string;
  /** 0 → closed bud, 1 → fully open. Takes priority over `play`. */
  progress?: MotionValue<number>;
  /** Animate open once on mount. */
  play?: boolean;
  delay?: number;
  tone?: 'light' | 'dark';
  className?: string;
  spin?: boolean;
};

export function BloomMark({ size = 64, progress, play = true, delay = 0, tone = 'light', className, spin }: Props) {
  const pal = tone === 'dark' ? DARK : LIGHT;
  return (
    <svg viewBox="-50 -50 100 100" width={size} height={size} className={className} aria-hidden="true">
      <g style={spin ? { animation: 'spin-slow 24s linear infinite', transformOrigin: '0 0' } : undefined}>
        {Array.from({ length: OUTER_N }, (_, i) => (
          <g key={`o${i}`} transform={`rotate(${(360 / OUTER_N) * i})`}>
            <Petal d={OUTER} fill={pal.outer} stroke={pal.stroke} index={i} count={OUTER_N} ring={0} progress={progress} play={play} delay={delay} />
          </g>
        ))}
        {Array.from({ length: INNER_N }, (_, i) => (
          <g key={`i${i}`} transform={`rotate(${(360 / INNER_N) * i + 36})`}>
            <Petal d={INNER} fill={pal.inner} stroke={pal.inner} index={i} count={INNER_N} ring={1} progress={progress} play={play} delay={delay} />
          </g>
        ))}
      </g>
      <Center fill={pal.center} progress={progress} play={play} delay={delay} />
    </svg>
  );
}

type PetalProps = {
  d: string;
  fill: string;
  stroke: string;
  index: number;
  count: number;
  ring: number;
  progress?: MotionValue<number>;
  play: boolean;
  delay: number;
};

function Petal({ progress, ...rest }: PetalProps) {
  return progress ? <ScrubPetal progress={progress} {...rest} /> : <PlayPetal {...rest} />;
}

function ScrubPetal({ d, fill, stroke, index, count, ring, progress }: PetalProps & { progress: MotionValue<number> }) {
  const start = ring * 0.25 + (index / count) * 0.35;
  const end = Math.min(1, start + 0.4);
  const scale = useTransform(progress, [start, end], [0, 1]);
  const rotate = useTransform(progress, [start, end], [-50, 0]);
  return (
    <motion.path
      d={d}
      fill={fill}
      stroke={stroke}
      strokeWidth={0.8}
      strokeOpacity={0.6}
      style={{ scale, rotate, originX: 0.5, originY: 1 }}
    />
  );
}

function PlayPetal({ d, fill, stroke, index, ring, play, delay }: Omit<PetalProps, 'progress'>) {
  return (
    <motion.path
      d={d}
      fill={fill}
      stroke={stroke}
      strokeWidth={0.8}
      strokeOpacity={0.6}
      style={{ originX: 0.5, originY: 1 }}
      initial={{ scale: 0, rotate: -70 }}
      animate={play ? { scale: 1, rotate: 0 } : { scale: 0, rotate: -70 }}
      transition={{ delay: delay + ring * 0.25 + index * 0.06, type: 'spring', stiffness: 120, damping: 14 }}
    />
  );
}

function Center({ fill, progress, play, delay }: { fill: string; progress?: MotionValue<number>; play: boolean; delay: number }) {
  const fallback = useTransform(() => 1);
  const scale = useTransform(progress ?? fallback, [0, 0.3], [0.4, 1]);
  if (progress) return <motion.circle r={7} fill={fill} style={{ scale }} />;
  return (
    <motion.circle
      r={7}
      fill={fill}
      initial={{ scale: 0 }}
      animate={{ scale: play ? 1 : 0 }}
      transition={{ delay: delay + 0.55, type: 'spring', stiffness: 200, damping: 12 }}
    />
  );
}
