import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { KINDS, KindIcon, Leaf, PALETTES, Peony, Ranunculus, Rose, TulipHead, rng, shade, type Kind, type Palette } from './flora';
import { cn } from '../../lib/cn';
import { Arrow, Button } from '../ui/Button';

type Stem = { id: number; kind: Kind; seed: number; angle: number; length: number; bend: number };
type Wrap = 'kraft' | 'vase' | 'ribbon';

const BX = 300;
const BY = 610;
const MAX = 22;
const WRAPS: Array<{ id: Wrap; label: string }> = [
  { id: 'kraft', label: 'Kraft wrap' },
  { id: 'vase', label: 'Glass vase' },
  { id: 'ribbon', label: 'Hand-tied' },
];
const LAYER: Record<Kind, number> = Object.fromEntries(KINDS.map((k) => [k.id, k.layer])) as Record<Kind, number>;
const LABEL: Record<Kind, string> = Object.fromEntries(KINDS.map((k) => [k.id, k.label])) as Record<Kind, string>;

let nextId = 1;

function pickAngle(existing: Stem[], layer: number) {
  const same = existing.filter((s) => LAYER[s.kind] === layer).map((s) => s.angle);
  const all = existing.map((s) => s.angle);
  const spread = layer === 0 ? 48 : layer === 1 ? 42 : 34;
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < 14; i++) {
    const a = (Math.random() * 2 - 1) * spread;
    const dSame = same.length ? Math.min(...same.map((x) => Math.abs(x - a))) : 50;
    const dAll = all.length ? Math.min(...all.map((x) => Math.abs(x - a))) : 50;
    const score = dSame * 1.4 + dAll * 0.6 - Math.abs(a) * 0.15;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

function makeStem(kind: Kind, existing: Stem[]): Stem {
  const meta = KINDS.find((k) => k.id === kind)!;
  const seed = Math.random();
  const angle = pickAngle(existing, meta.layer);
  const [lo, hi] = meta.length;
  // Front flowers sit a little lower so the dome reads as layered.
  const length = lo + Math.random() * (hi - lo) - Math.abs(angle) * 0.6;
  return { id: nextId++, kind, seed, angle, length, bend: (Math.random() - 0.5) * 40 };
}

function geometry(s: Stem) {
  const rad = (s.angle * Math.PI) / 180;
  const hx = BX + Math.sin(rad) * s.length;
  const hy = BY - Math.cos(rad) * s.length;
  const cx = BX + Math.sin(rad * 0.45) * s.length * 0.55 + s.bend * 0.4;
  const cy = BY - Math.cos(rad * 0.45) * s.length * 0.55;
  const bottomX = BX + s.angle * 0.35;
  return { hx, hy, cx, cy, bottomX };
}

function bezierAt(t: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) {
  const u = 1 - t;
  return {
    x: u * u * x0 + 2 * u * t * x1 + t * t * x2,
    y: u * u * y0 + 2 * u * t * y1 + t * t * y2,
    tx: 2 * u * (x1 - x0) + 2 * t * (x2 - x1),
    ty: 2 * u * (y1 - y0) + 2 * t * (y2 - y1),
  };
}

const grow = { duration: 0.9, ease: [0.16, 1, 0.3, 1] } as const;
const pop = { type: 'spring', stiffness: 170, damping: 13, delay: 0.45 } as const;

function StemArt({ stem, palette }: { stem: Stem; palette: Palette }) {
  const { hx, hy, cx, cy, bottomX } = geometry(stem);
  const r = rng(stem.seed);
  const color = palette.blooms[Math.floor(r() * palette.blooms.length)];
  const accent = palette.accents[Math.floor(r() * palette.accents.length)];
  const green = stem.kind === 'eucalyptus' ? '#6f8579' : palette.green;
  const d = `M${bottomX} 745 L${BX} ${BY} Q${cx} ${cy} ${hx} ${hy}`;
  const along = (t: number) => bezierAt(t, BX, BY, cx, cy, hx, hy);
  const headAngle = stem.angle * 0.6;

  return (
    <g>
      <motion.path d={d} fill="none" stroke={green} strokeWidth={stem.kind === 'babysbreath' ? 1.6 : 2.6} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={grow} />

      {(stem.kind === 'rose' || stem.kind === 'peony' || stem.kind === 'ranunculus' || stem.kind === 'tulip') &&
        [0.42 + r() * 0.15].map((t) => {
          const p = along(t);
          const side = r() > 0.5 ? 1 : -1;
          const ang = (Math.atan2(p.ty, p.tx) * 180) / Math.PI + side * 50;
          return (
            <motion.g key="leaf" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...pop, delay: 0.35 }} style={{ originX: 0, originY: 0.5 }}>
              <g transform={`translate(${p.x} ${p.y}) rotate(${ang})`}>
                <Leaf color={shade(palette.green, 0.12)} size={1.15 + r() * 0.35} />
              </g>
            </motion.g>
          );
        })}

      {stem.kind === 'eucalyptus' &&
        Array.from({ length: 8 }, (_, i) => {
          const t = 0.32 + i * 0.09;
          const p = along(Math.min(t, 1));
          const len = Math.hypot(p.tx, p.ty) || 1;
          const side = i % 2 ? 1 : -1;
          const nx = (-p.ty / len) * 12 * side;
          const ny = (p.tx / len) * 12 * side;
          const rad = 9 - i * 0.55;
          return (
            <motion.circle
              key={i}
              cx={p.x + nx}
              cy={p.y + ny}
              r={rad * 1.25}
              fill={i % 2 ? '#93a89e' : '#a6b9af'}
              stroke="#7d9488"
              strokeWidth={0.6}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ ...pop, delay: 0.3 + i * 0.05 }}
            />
          );
        })}

      {stem.kind === 'snapdragon' &&
        Array.from({ length: 9 }, (_, i) => {
          const t = 0.62 + i * 0.045;
          const p = along(Math.min(t, 1));
          const len = Math.hypot(p.tx, p.ty) || 1;
          const side = i % 2 ? 1 : -1;
          const nx = (-p.ty / len) * 5 * side;
          const ny = (p.tx / len) * 5 * side;
          const size = 1 - i * 0.07;
          return (
            <motion.ellipse
              key={i}
              cx={p.x + nx}
              cy={p.y + ny}
              rx={10.5 * size}
              ry={8 * size}
              fill={i % 3 === 2 ? accent : shade(color, (i % 2) * 0.08)}
              stroke={shade(color, -0.25)}
              strokeWidth={0.6}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ ...pop, delay: 0.35 + i * 0.05 }}
            />
          );
        })}

      {stem.kind === 'babysbreath' &&
        Array.from({ length: 6 }, (_, i) => {
          const a = ((i / 5) * 2 - 1) * 70 + stem.angle;
          const rad = (a * Math.PI) / 180;
          const len = 34 + r() * 28;
          const ex = hx + Math.sin(rad) * len;
          const ey = hy - Math.cos(rad) * len;
          return (
            <motion.g key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 + i * 0.05 }}>
              <path d={`M${hx} ${hy} L${ex} ${ey}`} stroke={palette.green} strokeWidth={1} />
              {Array.from({ length: 5 }, (_, k) => (
                <circle key={k} cx={ex + Math.cos(k * 1.3 + i) * 8} cy={ey + Math.sin(k * 1.3 + i) * 8} r={3.4} fill={k % 2 ? '#ffffff' : accent} stroke="#d8cdc4" strokeWidth={0.4} />
              ))}
            </motion.g>
          );
        })}

      {(stem.kind === 'rose' || stem.kind === 'peony' || stem.kind === 'ranunculus' || stem.kind === 'tulip') && (
        <g transform={`translate(${hx} ${hy}) rotate(${stem.kind === 'tulip' ? stem.angle * 0.9 : headAngle}) scale(1.38)`}>
          <motion.g initial={{ scale: 0, rotate: -120 }} animate={{ scale: 1, rotate: 0 }} transition={pop}>
            {stem.kind === 'rose' && <Rose c={color} seed={stem.seed} />}
            {stem.kind === 'peony' && <Peony c={color} seed={stem.seed} />}
            {stem.kind === 'ranunculus' && <Ranunculus c={color} />}
            {stem.kind === 'tulip' && <TulipHead c={color} />}
          </motion.g>
        </g>
      )}
    </g>
  );
}

function summarize(stems: Stem[], palette: Palette, wrap: Wrap) {
  if (!stems.length) return '';
  const counts = new Map<Kind, number>();
  stems.forEach((s) => counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1));
  const parts = KINDS.filter((k) => counts.has(k.id)).map((k) => {
    const n = counts.get(k.id)!;
    return n > 1 ? `${n} ${k.plural}` : `1 ${k.label.toLowerCase()}`;
  });
  return `${parts.join(', ')} — ${palette.label.toLowerCase()} palette, ${WRAPS.find((w) => w.id === wrap)!.label.toLowerCase()}`;
}

/**
 * A playful bouquet sketchpad: add stems, recolour, choose a wrap, brush the
 * bouquet with the cursor, then hand the idea to the shop as a starting point.
 */
export function Atelier({ compact = false }: { compact?: boolean }) {
  const [stems, setStems] = useState<Stem[]>([]);
  const [paletteId, setPaletteId] = useState(PALETTES[0].id);
  const [wrap, setWrap] = useState<Wrap>('kraft');
  const [announce, setAnnounce] = useState('');
  const palette = PALETTES.find((p) => p.id === paletteId)!;
  const svgRef = useRef<SVGSVGElement>(null);
  const groups = useRef(new Map<number, SVGGElement>());
  const physics = useRef(new Map<number, { th: number; w: number }>());
  const pointer = useRef({ x: -1e4, y: -1e4, vx: 0, active: false });
  const timers = useRef<number[]>([]);
  const navigate = useNavigate();

  const stemsRef = useRef<Stem[]>([]);
  const commit = (next: Stem[]) => {
    stemsRef.current = next;
    setStems(next);
  };

  const add = useCallback((kind: Kind) => {
    const prev = stemsRef.current;
    if (prev.length >= MAX) return;
    const stem = makeStem(kind, prev);
    physics.current.set(stem.id, { th: (Math.random() - 0.5) * 16, w: 0 });
    stemsRef.current = [...prev, stem];
    setStems(stemsRef.current);
    setAnnounce(`Added ${LABEL[kind].toLowerCase()}. ${prev.length + 1} stems.`);
  }, []);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    commit([]);
    setAnnounce('Bouquet cleared.');
  };

  const surprise = useCallback(() => {
    timers.current.forEach(clearTimeout);
    stemsRef.current = [];
    setStems([]);
    const recipe: Kind[] = ['eucalyptus', 'snapdragon', 'eucalyptus', 'tulip', 'babysbreath', 'rose', 'peony', 'ranunculus', 'rose', 'eucalyptus', 'peony', 'babysbreath'];
    const shuffled = recipe.sort((a, b) => LAYER[a] - LAYER[b] || Math.random() - 0.5);
    timers.current = shuffled.map((k, i) => window.setTimeout(() => add(k), 140 + i * 170));
    setPaletteId(PALETTES[Math.floor(Math.random() * PALETTES.length)].id);
  }, [add]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Physics: stems are damped springs around the bundle point; the pointer is wind.
  useEffect(() => {
    let raf = 0;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tick = (now: number) => {
      const t = now / 1000;
      const p = pointer.current;
      groups.current.forEach((g, id) => {
        const st = physics.current.get(id);
        if (!st) return;
        const stem = stemsRef.current.find((s) => s.id === id);
        let force = reduce ? 0 : Math.sin(t * 0.9 + id * 1.7) * 0.012;
        if (p.active && stem) {
          const { hx, hy } = geometry(stem);
          const mid = { x: (hx + BX) / 2, y: (hy + BY) / 2 };
          const d = Math.min(Math.hypot(p.x - hx, p.y - hy), Math.hypot(p.x - mid.x, p.y - mid.y));
          const fall = Math.max(0, 1 - d / 150);
          force += p.vx * 0.05 * fall;
        }
        st.w += -0.045 * st.th - 0.09 * st.w + force;
        st.th = Math.max(-28, Math.min(28, st.th + st.w));
        g.setAttribute('transform', `rotate(${st.th.toFixed(3)} ${BX} ${BY})`);
      });
      p.vx *= 0.85;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toSvg = (e: ReactPointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 600, y: ((e.clientY - r.top) / r.height) * 760 };
  };

  const ordered = useMemo(() => [...stems].sort((a, b) => LAYER[a.kind] - LAYER[b.kind] || a.id - b.id), [stems]);
  const summary = summarize(stems, palette, wrap);

  const sendIdea = () => {
    const params = new URLSearchParams({ topic: 'flowers', idea: `Atelier sketch: ${summary}.` });
    navigate(`/about?${params.toString()}#contact`);
  };

  return (
    <div className={cn('grid items-center gap-10 lg:grid-cols-12 lg:gap-14', compact && 'lg:gap-10')}>
      <div className="order-2 lg:order-1 lg:col-span-5">
        <fieldset>
          <legend className="eyebrow text-charcoal/80">Add stems</legend>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => add(k.id)}
                disabled={stems.length >= MAX}
                data-no-burst
                className="group flex items-center gap-2 rounded-2xl border border-charcoal/10 bg-ivory/80 py-2 pr-3 pl-2 text-left text-[0.86rem] transition hover:-translate-y-0.5 hover:border-rose/50 hover:bg-white hover:shadow-[0_12px_30px_-18px_rgba(142,86,100,0.6)] active:scale-95 disabled:opacity-40"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blush/50 transition-transform duration-500 group-hover:rotate-12">
                  <KindIcon kind={k.id} palette={palette} />
                </span>
                {k.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-8">
          <legend className="eyebrow text-charcoal/80">Palette</legend>
          <div className="mt-4 flex flex-wrap gap-2">
            {PALETTES.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={p.id === paletteId}
                onClick={() => setPaletteId(p.id)}
                data-no-burst
                className={cn(
                  'flex items-center gap-2 rounded-full border py-1.5 pr-3.5 pl-1.5 text-[0.84rem] transition',
                  p.id === paletteId ? 'border-charcoal bg-charcoal text-ivory' : 'border-charcoal/15 hover:border-charcoal/40',
                )}
              >
                <span className="flex -space-x-1.5" aria-hidden="true">
                  {p.swatch.map((c) => (
                    <span key={c} className="h-5 w-5 rounded-full border border-white/70" style={{ background: c }} />
                  ))}
                </span>
                {p.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-8">
          <legend className="eyebrow text-charcoal/80">Finish</legend>
          <div className="mt-4 flex flex-wrap gap-2">
            {WRAPS.map((w) => (
              <button
                key={w.id}
                type="button"
                aria-pressed={w.id === wrap}
                onClick={() => setWrap(w.id)}
                data-no-burst
                className={cn(
                  'rounded-full border px-4 py-2 text-[0.84rem] transition',
                  w.id === wrap ? 'border-charcoal bg-charcoal text-ivory' : 'border-charcoal/15 hover:border-charcoal/40',
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-9 flex flex-wrap items-center gap-3">
          <Button onClick={surprise} variant="outline">
            Surprise me
          </Button>
          <Button onClick={sendIdea} variant="solid" icon={<Arrow />} className={cn(!stems.length && 'pointer-events-none opacity-40')} ariaLabel="Send this idea, your bouquet, to the inquiry form">
            Send this idea
          </Button>
          {stems.length > 0 && (
            <button type="button" onClick={clear} className="link-underline ml-1 text-sm text-charcoal/70 hover:text-charcoal">
              Clear
            </button>
          )}
        </div>
        <p className="mt-6 max-w-md text-[0.82rem] leading-relaxed text-charcoal/70">
          A mood board, not an order or a quote. Real designs follow the season and the florist&rsquo;s eye — this simply gives the conversation a head start.
        </p>
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </div>

      <div className="order-1 lg:order-2 lg:col-span-7">
        <div className="relative overflow-hidden rounded-[28px] border border-charcoal/10 bg-[radial-gradient(90%_70%_at_50%_35%,#fffaf6_0%,#f3e7df_60%,#ead9d0_100%)]">
          <div className="absolute top-5 left-5 z-10 flex items-baseline gap-2">
            <span className="font-display text-4xl tabular-nums">{String(stems.length).padStart(2, '0')}</span>
            <span className="eyebrow text-charcoal/80">/ {MAX} stems</span>
          </div>
          <div className="absolute top-5 right-5 z-10 max-w-[55%] text-right text-[0.78rem] leading-snug text-charcoal/70" aria-hidden="true">
            {summary || 'Tap a stem to begin'}
          </div>
          <svg
            ref={svgRef}
            viewBox="0 0 600 760"
            className="relative block h-auto w-full touch-pan-y select-none"
            role="img"
            aria-label={summary ? `Bouquet sketch: ${summary}` : 'Empty bouquet sketch'}
            data-cursor={stems.length ? 'Brush' : undefined}
            onPointerMove={(e) => {
              const pt = toSvg(e);
              if (!pt) return;
              const p = pointer.current;
              if (p.active) p.vx = p.vx * 0.5 + (pt.x - p.x) * 0.5;
              p.x = pt.x;
              p.y = pt.y;
              p.active = true;
            }}
            onPointerLeave={() => {
              pointer.current.active = false;
            }}
          >
            <defs>
              <linearGradient id="kraft" x1="0" x2="1">
                <stop offset="0" stopColor="#c9a57c" />
                <stop offset="0.5" stopColor="#dcbf98" />
                <stop offset="1" stopColor="#c19a70" />
              </linearGradient>
              <linearGradient id="glass" x1="0" x2="1">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
                <stop offset="0.35" stopColor="#ffffff" stopOpacity="0.12" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0.4" />
              </linearGradient>
              <radialGradient id="shadow">
                <stop offset="0" stopColor="#342f2c" stopOpacity="0.25" />
                <stop offset="1" stopColor="#342f2c" stopOpacity="0" />
              </radialGradient>
            </defs>
            <ellipse cx={BX} cy={748} rx={150} ry={14} fill="url(#shadow)" />

            {wrap === 'kraft' && <path d="M168 470 L215 455 L262 470 L300 452 L340 468 L388 452 L432 472 L330 742 L270 742 Z" fill="#b8916a" />}

            {ordered.map((s) => (
              <g
                key={s.id}
                ref={(el) => {
                  if (el) groups.current.set(s.id, el);
                  else groups.current.delete(s.id);
                }}
              >
                <StemArt stem={s} palette={palette} />
              </g>
            ))}

            <AnimatePresence mode="wait">
              {wrap === 'kraft' && (
                <motion.g key="kraft" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} transition={{ duration: 0.5 }}>
                  <path d="M196 560 L300 745 L404 560 L366 548 L300 575 L232 548 Z" fill="url(#kraft)" />
                  <path d="M300 575 L300 745" stroke="#a8825b" strokeOpacity="0.5" strokeWidth="1.5" />
                  <path d="M232 548 L300 745" stroke="#a8825b" strokeOpacity="0.25" />
                  <path d="M262 640 Q300 652 338 640 L336 656 Q300 668 264 656 Z" fill="#b87f89" />
                  <path d="M300 650 C 270 628 252 640 262 656 C 270 668 290 660 300 650 C 310 660 330 668 338 656 C 348 640 330 628 300 650 Z" fill="#c9939b" stroke="#a56a76" strokeWidth="1" />
                  <path d="M296 656 C 290 690 280 710 270 724 M304 656 C 312 688 322 706 334 722" stroke="#b87f89" strokeWidth="5" strokeLinecap="round" fill="none" />
                </motion.g>
              )}
              {wrap === 'vase' && (
                <motion.g key="vase" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} transition={{ duration: 0.5 }}>
                  <path d="M236 580 C 228 640 222 700 236 740 L364 740 C 378 700 372 640 364 580 Z" fill="url(#glass)" stroke="#64715a" strokeOpacity="0.35" strokeWidth="2" />
                  <path d="M233 640 C 270 648 330 648 367 640 L 372 700 C 374 720 370 735 364 740 L236 740 C 230 735 226 720 228 700 Z" fill="#9fb3a8" fillOpacity="0.25" />
                  <ellipse cx={300} cy={580} rx={64} ry={7} fill="none" stroke="#64715a" strokeOpacity="0.35" strokeWidth="2" />
                  <path d="M250 600 C 246 650 246 690 252 725" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="5" strokeLinecap="round" fill="none" />
                </motion.g>
              )}
              {wrap === 'ribbon' && (
                <motion.g key="ribbon" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ type: 'spring', stiffness: 200, damping: 14 }}>
                  <path d="M276 636 Q300 646 324 636 L322 652 Q300 662 278 652 Z" fill="#e8d5cf" stroke="#c9939b" />
                  <path d="M300 644 C 262 612 236 632 252 652 C 264 666 288 656 300 644 C 312 656 336 666 348 652 C 364 632 338 612 300 644 Z" fill="#f1dcd5" stroke="#c9939b" strokeWidth="1.2" />
                  <path d="M296 652 C 286 690 270 714 256 736 M304 652 C 316 688 330 712 346 734" stroke="#e8d5cf" strokeWidth="6" strokeLinecap="round" fill="none" />
                </motion.g>
              )}
            </AnimatePresence>

            {!stems.length && (
              <g aria-hidden="true">
                <text x={BX} y={380} textAnchor="middle" className="font-display" fontSize="30" fill="#342f2c" fillOpacity="0.55" fontStyle="italic">
                  Your bouquet starts here
                </text>
                <text x={BX} y={414} textAnchor="middle" fontSize="13" fill="#342f2c" fillOpacity="0.45" letterSpacing="2">
                  ADD A STEM — OR TAP “SURPRISE ME”
                </text>
              </g>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}
