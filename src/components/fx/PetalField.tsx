import { useEffect, useRef } from 'react';

type Petal = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vr: number;
  flip: number;
  vf: number;
  depth: number;
  sprite: number;
  life: number;
  burst: boolean;
};

const PALETTE: Array<[string, string]> = [
  ['#efdcd6', '#d8b5ad'],
  ['#c8919a', '#a76c78'],
  ['#f7ece7', '#e3cbc3'],
  ['#d9bf8f', '#bc9a62'],
  ['#e3bcc2', '#c99aa2'],
];

function makeSprite([c1, c2]: [string, string]) {
  const s = document.createElement('canvas');
  s.width = s.height = 64;
  const g = s.getContext('2d')!;
  g.translate(32, 32);
  const grad = g.createLinearGradient(-10, -28, 10, 28);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, 28);
  g.bezierCurveTo(23, 14, 21, -20, 7, -27);
  g.quadraticCurveTo(0, -21, -7, -27);
  g.bezierCurveTo(-21, -20, -23, 14, 0, 28);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.38)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(0, 25);
  g.quadraticCurveTo(2.5, 2, 0, -19);
  g.stroke();
  return s;
}

/**
 * A fixed canvas of drifting petals. They fall slowly, parallax with scroll,
 * get pushed around by the cursor's "wind" and burst from every click.
 */
export function PetalField({ enabled }: { enabled: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const small = window.matchMedia('(max-width: 640px)').matches;
    const ambientCount = small ? 11 : 24;
    const sprites = PALETTE.map(makeSprite);
    const petals: Petal[] = [];
    let W = 0;
    let H = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    };

    const spawn = (x?: number, y?: number, burst = false): Petal => ({
      x: x ?? Math.random() * W,
      y: y ?? Math.random() * H,
      vx: 0,
      vy: 0,
      size: (small ? 9 : 11) + Math.random() * (small ? 7 : 10),
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.02,
      flip: Math.random() * Math.PI * 2,
      vf: 0.012 + Math.random() * 0.03,
      depth: 0.35 + Math.random() * 0.65,
      sprite: Math.floor(Math.random() * sprites.length),
      life: 1,
      burst,
    });

    resize();
    for (let i = 0; i < ambientCount; i++) petals.push(spawn());

    let mx = -9999;
    let my = -9999;
    let pmx = mx;
    let pmy = my;
    let lastScroll = window.scrollY;
    let raf = 0;
    let running = true;

    const onMove = (e: PointerEvent) => {
      if (mx < -9000) {
        pmx = e.clientX;
        pmy = e.clientY;
      }
      mx = e.clientX;
      my = e.clientY;
    };
    const onLeave = () => {
      mx = my = pmx = pmy = -9999;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const t = e.target as Element | null;
      if (t?.closest('input, textarea, select, label, [data-no-burst]')) return;
      const bursting = petals.filter((p) => p.burst).length;
      const n = Math.min(small ? 7 : 11, 70 - bursting);
      for (let i = 0; i < n; i++) {
        const p = spawn(e.clientX, e.clientY, true);
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
        const speed = 2.5 + Math.random() * 4.5;
        p.vx = Math.cos(a) * speed;
        p.vy = Math.sin(a) * speed - 2;
        p.vr = (Math.random() - 0.5) * 0.25;
        p.vf = 0.08 + Math.random() * 0.1;
        p.depth = 0.75 + Math.random() * 0.25;
        petals.push(p);
      }
    };

    const tick = (now: number) => {
      if (!running) return;
      const time = now * 0.001;
      const sy = window.scrollY;
      const ds = Math.max(-80, Math.min(80, sy - lastScroll));
      lastScroll = sy;
      const mvx = mx > -9000 ? mx - pmx : 0;
      const mvy = my > -9000 ? my - pmy : 0;
      pmx = mx;
      pmy = my;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (let i = petals.length - 1; i >= 0; i--) {
        const p = petals[i];
        const dx = p.x - mx;
        const dy = p.y - my;
        const d2 = dx * dx + dy * dy;
        const R = 150;
        if (d2 < R * R) {
          const d = Math.sqrt(d2) || 1;
          const f = 1 - d / R;
          p.vx += (mvx * 0.07 + (dx / d) * 0.5) * f;
          p.vy += (mvy * 0.07 + (dy / d) * 0.5) * f;
          p.vr += mvx * 0.0009 * f;
          p.vf += 0.025 * f;
        }
        p.vx *= 0.955;
        p.vy *= 0.955;
        p.vr *= 0.985;
        p.vf = Math.max(0.012, p.vf * 0.985);

        const fall = 0.32 + p.depth * 0.5;
        p.x += p.vx + Math.sin(time * 0.9 + p.flip * 0.7) * 0.35 * p.depth;
        p.y += p.vy + fall - ds * p.depth * 0.42;
        p.rot += p.vr + 0.002;
        p.flip += p.vf;

        if (p.burst) {
          p.life -= 0.0055;
          if (p.life <= 0 || p.y > H + 60) {
            petals.splice(i, 1);
            continue;
          }
        } else {
          if (p.y > H + 40) {
            p.y = -40;
            p.x = Math.random() * W;
          } else if (p.y < -70) {
            p.y = H + 40;
            p.x = Math.random() * W;
          }
          if (p.x < -50) p.x = W + 40;
          else if (p.x > W + 50) p.x = -40;
        }

        const s = (p.size * (0.55 + p.depth * 0.55)) / 32;
        const alpha = (0.5 + p.depth * 0.45) * (p.burst ? Math.min(1, p.life * 2.2) : 1);
        const cos = Math.cos(p.rot);
        const sin = Math.sin(p.rot);
        const fx = Math.cos(p.flip) * s;
        ctx.globalAlpha = alpha;
        // translate → rotate → scale(fx, s), multiplied by device pixel ratio
        ctx.setTransform(cos * fx * dpr, sin * fx * dpr, -sin * s * dpr, cos * s * dpr, p.x * dpr, p.y * dpr);
        ctx.drawImage(sprites[p.sprite], -32, -32);
      }
      raf = requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        lastScroll = window.scrollY;
        raf = requestAnimationFrame(tick);
      }
    };

    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [enabled]);

  if (!enabled) return null;
  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[55] h-full w-full" />;
}
