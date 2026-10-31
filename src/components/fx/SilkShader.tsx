import { useEffect, useRef } from 'react';
import { cn } from '../../lib/cn';

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Domain-warped noise mapped onto the brand palette: a slow, silky flow of ivory,
// blush, rose and champagne. The cursor twists the fabric and leaves a warm glow.
const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uDark;
uniform float uEnergy;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = r * p * 2.03 + 0.17; a *= 0.5; }
  return v;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec2 m = (uMouse - 0.5 * uRes) / uRes.y;
  float t = uTime * 0.045;

  vec2 d = p - m;
  float r = length(d);
  float twist = exp(-r * r * 5.0) * (0.9 + uEnergy * 1.6);
  float c = cos(twist), s = sin(twist);
  p = m + mat2(c, -s, s, c) * d;

  vec2 q = vec2(fbm(p * 1.3 + t), fbm(p * 1.3 + vec2(5.2, 1.3) - t));
  vec2 w = vec2(fbm(p * 1.5 + 3.2 * q + vec2(1.7, 9.2) + t * 1.4), fbm(p * 1.5 + 3.2 * q + vec2(8.3, 2.8) - t));
  float f = fbm(p * 1.1 + 2.6 * w);

  vec3 ivory = vec3(0.965, 0.941, 0.914);
  vec3 blush = vec3(0.910, 0.835, 0.812);
  vec3 rose = vec3(0.722, 0.498, 0.537);
  vec3 gold = vec3(0.780, 0.663, 0.467);
  vec3 sage = vec3(0.392, 0.443, 0.353);
  vec3 coal = vec3(0.204, 0.184, 0.173);

  vec3 light = mix(ivory, blush, smoothstep(0.25, 0.78, f));
  light = mix(light, rose, smoothstep(0.62, 1.0, f * (0.6 + length(q))) * 0.42);
  light = mix(light, gold, smoothstep(0.55, 0.95, w.x) * 0.16);
  light += pow(abs(sin((f + w.y) * 7.0)), 10.0) * 0.045;

  vec3 dark = mix(coal, coal * 1.25 + rose * 0.08, smoothstep(0.2, 0.8, f));
  dark = mix(dark, rose * 0.55, smoothstep(0.6, 1.0, f * (0.6 + length(q))) * 0.5);
  dark = mix(dark, gold * 0.6, smoothstep(0.6, 1.0, w.x) * 0.3);
  dark = mix(dark, sage * 0.5, smoothstep(0.5, 0.9, w.y) * 0.18);
  dark += pow(abs(sin((f + w.y) * 7.0)), 12.0) * 0.05 * gold;

  vec3 col = mix(light, dark, uDark);
  col += mix(vec3(1.0, 0.94, 0.9), gold, uDark) * exp(-r * r * 16.0) * (0.07 + uEnergy * 0.1);
  col += (hash(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.022;
  gl_FragColor = vec4(col, 1.0);
}
`;

type Props = { dark?: boolean; className?: string; resolution?: number };

/** Lightweight full-bleed WebGL background. Pauses offscreen and when the tab is hidden. */
export function SilkShader({ dark = false, className, resolution = 0.5 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uMouse = gl.getUniformLocation(prog, 'uMouse');
    const uDark = gl.getUniformLocation(prog, 'uDark');
    const uEnergy = gl.getUniformLocation(prog, 'uEnergy');

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let scale = Math.min(window.devicePixelRatio || 1, 2) * resolution;
    let w = 1;
    let h = 1;
    const target = { x: 0.6, y: 0.45 };
    const mouse = { x: 0.6, y: 0.45 };
    let energy = 0;
    let visible = true;
    let raf = 0;
    const start = performance.now() - Math.random() * 20000;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      scale = Math.min(window.devicePixelRatio || 1, 2) * resolution;
      w = Math.max(1, Math.round(rect.width * scale));
      h = Math.max(1, Math.round(rect.height * scale));
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    };

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      energy = Math.min(1, energy + Math.hypot(nx - target.x, ny - target.y) * 3);
      target.x = nx;
      target.y = ny;
    };

    const draw = (now: number) => {
      mouse.x += (target.x - mouse.x) * 0.06;
      mouse.y += (target.y - mouse.y) * 0.06;
      energy *= 0.96;
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.uniform2f(uMouse, mouse.x * w, (1 - mouse.y) * h);
      gl.uniform1f(uDark, dark ? 1 : 0);
      gl.uniform1f(uEnergy, energy);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const loop = (now: number) => {
      draw(now);
      if (visible && !document.hidden) raf = requestAnimationFrame(loop);
      else raf = 0;
    };
    const kick = () => {
      if (!raf && visible && !document.hidden && !reduce) raf = requestAnimationFrame(loop);
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      kick();
    });
    io.observe(canvas);
    const ro = new ResizeObserver(() => {
      resize();
      if (reduce) draw(performance.now());
    });
    ro.observe(canvas);
    const onLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      raf = 0;
      visible = false;
    };

    resize();
    draw(performance.now());
    kick();
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('visibilitychange', kick);
    canvas.addEventListener('webglcontextlost', onLost);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', kick);
      canvas.removeEventListener('webglcontextlost', onLost);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    };
  }, [dark, resolution]);

  return (
    <div
      aria-hidden="true"
      className={cn('absolute inset-0 overflow-hidden', className)}
      style={{
        background: dark
          ? 'radial-gradient(120% 90% at 70% 30%, #4a3f3b 0%, #342f2c 55%, #221d1b 100%)'
          : 'radial-gradient(120% 90% at 70% 30%, #f3e4de 0%, #f6f0e9 55%, #efe5da 100%)',
      }}
    >
      <canvas ref={ref} className="h-full w-full" />
    </div>
  );
}
