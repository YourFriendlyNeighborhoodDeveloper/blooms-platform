// Hand-built SVG flora for the Atelier. Every head is drawn around (0, 0).

export type Kind = 'rose' | 'peony' | 'ranunculus' | 'tulip' | 'snapdragon' | 'eucalyptus' | 'babysbreath';

export type Palette = {
  id: string;
  label: string;
  blooms: string[];
  accents: string[];
  green: string;
  swatch: string[];
};

export const PALETTES: Palette[] = [
  {
    id: 'blush',
    label: 'Blush & ivory',
    blooms: ['#f1dcd5', '#e6c3bd', '#f7ede6', '#d9aaa8'],
    accents: ['#fffaf6', '#f0d9d2'],
    green: '#7d8b6f',
    swatch: ['#f1dcd5', '#d9aaa8', '#f7ede6'],
  },
  {
    id: 'rose',
    label: 'Dusty rose',
    blooms: ['#b87f89', '#c9939b', '#a56a76', '#dcb2b6'],
    accents: ['#e8d5cf', '#d8bf92'],
    green: '#64715a',
    swatch: ['#b87f89', '#dcb2b6', '#c7a977'],
  },
  {
    id: 'garden',
    label: 'Garden white',
    blooms: ['#fbf8f1', '#eef0e4', '#f5eee0', '#e3e7d6'],
    accents: ['#ffffff', '#dfe5d0'],
    green: '#5d6f51',
    swatch: ['#fbf8f1', '#e3e7d6', '#64715a'],
  },
  {
    id: 'sunset',
    label: 'Golden hour',
    blooms: ['#e7a37f', '#efc48f', '#d97c6c', '#f3d4b6'],
    accents: ['#f8e3c6', '#c7a977'],
    green: '#6b7a55',
    swatch: ['#e7a37f', '#efc48f', '#d97c6c'],
  },
];

export const KINDS: Array<{ id: Kind; label: string; plural: string; layer: number; length: [number, number] }> = [
  { id: 'rose', label: 'Garden rose', plural: 'garden roses', layer: 2, length: [200, 270] },
  { id: 'peony', label: 'Peony', plural: 'peonies', layer: 2, length: [180, 250] },
  { id: 'ranunculus', label: 'Ranunculus', plural: 'ranunculus', layer: 2, length: [210, 290] },
  { id: 'tulip', label: 'Tulip', plural: 'tulips', layer: 1, length: [240, 310] },
  { id: 'snapdragon', label: 'Snapdragon', plural: 'snapdragons', layer: 0, length: [290, 350] },
  { id: 'eucalyptus', label: 'Eucalyptus', plural: 'eucalyptus stems', layer: 0, length: [250, 330] },
  { id: 'babysbreath', label: "Baby's breath", plural: 'sprigs of baby’s breath', layer: 1, length: [240, 310] },
];

/** Lighten (amt > 0) or darken (amt < 0) a hex colour. */
export function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = amt < 0 ? c * (1 + amt) : c + (255 - c) * amt;
    return Math.round(Math.max(0, Math.min(255, v)));
  });
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Deterministic pseudo-random from a seed. */
export function rng(seed: number) {
  let s = Math.floor(seed * 2147483646) + 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function Rose({ c, seed }: { c: string; seed: number }) {
  const r = rng(seed);
  const rot = r() * 360;
  return (
    <g transform={`rotate(${rot})`}>
      <circle r={29} fill={shade(c, -0.18)} />
      {Array.from({ length: 6 }, (_, i) => (
        <ellipse key={i} cx={0} cy={-15} rx={15} ry={17} fill={shade(c, -0.04 + (i % 2) * 0.05)} stroke={shade(c, -0.28)} strokeWidth={0.8} transform={`rotate(${i * 60})`} />
      ))}
      <circle r={16} fill={shade(c, 0.08)} stroke={shade(c, -0.25)} strokeWidth={0.8} />
      <path d="M0 0 a3.5 3.5 0 1 1 5 2 a8 8 0 1 1 -11 -3 a12 12 0 1 1 15 8" fill="none" stroke={shade(c, -0.32)} strokeWidth={1.5} strokeLinecap="round" />
    </g>
  );
}

export function Peony({ c, seed }: { c: string; seed: number }) {
  const r = rng(seed);
  const outer = Array.from({ length: 11 }, (_, i) => ({ a: (i / 11) * 360 + r() * 14, s: 0.9 + r() * 0.25 }));
  const mid = Array.from({ length: 8 }, (_, i) => ({ a: (i / 8) * 360 + r() * 20, s: 0.85 + r() * 0.3 }));
  return (
    <g>
      {outer.map((p, i) => (
        <ellipse key={`o${i}`} cy={-24} rx={17 * p.s} ry={20 * p.s} fill={shade(c, -0.1 + (i % 3) * 0.04)} stroke={shade(c, -0.26)} strokeWidth={0.7} transform={`rotate(${p.a})`} />
      ))}
      {mid.map((p, i) => (
        <ellipse key={`m${i}`} cy={-12} rx={13 * p.s} ry={15 * p.s} fill={shade(c, 0.05 + (i % 2) * 0.05)} stroke={shade(c, -0.2)} strokeWidth={0.6} transform={`rotate(${p.a})`} />
      ))}
      {Array.from({ length: 5 }, (_, i) => (
        <ellipse key={`c${i}`} cy={-4} rx={7} ry={8} fill={shade(c, 0.16)} stroke={shade(c, -0.15)} strokeWidth={0.5} transform={`rotate(${i * 72 + r() * 30})`} />
      ))}
    </g>
  );
}

export function Ranunculus({ c }: { c: string }) {
  const rings = [27, 22.5, 18, 13.5, 9];
  return (
    <g>
      {rings.map((rad, i) => (
        <circle key={rad} r={rad} fill={shade(c, i % 2 ? 0.08 : -0.08 - i * 0.01)} stroke={shade(c, -0.3)} strokeWidth={0.7} />
      ))}
      <circle r={4} fill="#8a9a5b" />
      <circle r={1.6} cx={-1} cy={-1} fill="#b7c48b" />
    </g>
  );
}

export function TulipHead({ c }: { c: string }) {
  return (
    <g>
      <path d="M-15 4 C -20 -14 -11 -31 -1 -33 C -6 -18 -5 -4 0 7 Z" fill={shade(c, -0.12)} stroke={shade(c, -0.3)} strokeWidth={0.8} />
      <path d="M15 4 C 20 -14 11 -31 1 -33 C 6 -18 5 -4 0 7 Z" fill={shade(c, -0.12)} stroke={shade(c, -0.3)} strokeWidth={0.8} />
      <path d="M-10 6 C -13 -14 -6 -31 0 -36 C 6 -31 13 -14 10 6 C 5 11 -5 11 -10 6 Z" fill={c} stroke={shade(c, -0.28)} strokeWidth={0.8} />
      <path d="M0 -30 C -2 -18 -2 -6 0 6" stroke={shade(c, 0.25)} strokeWidth={1} fill="none" opacity={0.6} />
    </g>
  );
}

export function Leaf({ color, size = 1 }: { color: string; size?: number }) {
  return (
    <g transform={`scale(${size})`}>
      <path d="M0 0 C 9 -8 25 -8 34 0 C 25 8 9 8 0 0 Z" fill={color} />
      <path d="M2 0 L 30 0" stroke={shade(color, 0.25)} strokeWidth={0.8} />
    </g>
  );
}

/** Small, centred preview of a flower kind for buttons. */
export function KindIcon({ kind, palette }: { kind: Kind; palette: Palette }) {
  const c = palette.blooms[1];
  const a = palette.accents[1];
  return (
    <svg viewBox="-40 -40 80 80" width="36" height="36" aria-hidden="true">
      {kind === 'rose' && <Rose c={c} seed={0.3} />}
      {kind === 'peony' && (
        <g transform="scale(0.78)">
          <Peony c={c} seed={0.5} />
        </g>
      )}
      {kind === 'ranunculus' && <Ranunculus c={c} />}
      {kind === 'tulip' && (
        <g transform="translate(0 14)">
          <TulipHead c={c} />
        </g>
      )}
      {kind === 'snapdragon' && (
        <g>
          <path d="M0 34 L0 -30" stroke={palette.green} strokeWidth={2} />
          {[-24, -14, -4, 6, 16].map((y, i) => (
            <ellipse key={y} cx={i % 2 ? 6 : -6} cy={y} rx={7 - i * 0.4} ry={5.5} fill={i % 2 ? a : c} />
          ))}
        </g>
      )}
      {kind === 'eucalyptus' && (
        <g>
          <path d="M0 34 Q 4 0 0 -32" stroke="#6f8579" strokeWidth={2} fill="none" />
          {[-24, -12, 0, 12, 24].map((y, i) => (
            <circle key={y} cx={i % 2 ? 9 : -9} cy={y} r={8} fill={i % 2 ? '#93a89e' : '#a5b8ae'} />
          ))}
        </g>
      )}
      {kind === 'babysbreath' && (
        <g>
          {[
            [-16, -14],
            [0, -24],
            [16, -12],
            [-8, 2],
            [10, 6],
          ].map(([x, y], i) => (
            <g key={i}>
              <path d={`M0 34 L${x} ${y}`} stroke={palette.green} strokeWidth={1.2} />
              {[0, 1, 2, 3].map((k) => (
                <circle key={k} cx={x + Math.cos(k * 1.7) * 5} cy={y + Math.sin(k * 1.7) * 5} r={3} fill={k % 2 ? '#fff' : a} stroke="#d9cfc6" strokeWidth={0.4} />
              ))}
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}
