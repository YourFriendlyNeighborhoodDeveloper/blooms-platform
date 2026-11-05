import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Arrow } from '../ui/Button';
import { cn } from '../../lib/cn';

export type Video = { id: string; url: string; title: string | null; caption: string | null; kind: 'video' | 'live'; featured: boolean; cta_label: string | null; cta_url: string | null };

declare global {
  interface Window {
    FB?: { init: (o: Record<string, unknown>) => void; XFBML: { parse: (el?: HTMLElement) => void } };
    fbAsyncInit?: () => void;
  }
}

let sdk: Promise<void> | null = null;

/** Loads Facebook's documented embed SDK once. It is only fetched after a visitor asks to watch. */
function loadSdk(): Promise<void> {
  if (sdk) return sdk;
  sdk = new Promise<void>((resolve, reject) => {
    if (window.FB) return resolve();
    window.fbAsyncInit = () => {
      window.FB?.init({ xfbml: false, version: 'v26.0' });
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => {
      sdk = null;
      reject(new Error('Facebook could not be reached.'));
    };
    document.body.appendChild(script);
  });
  return sdk;
}

/**
 * A public Facebook video that never slows or breaks the page. Facebook loads only when the visitor
 * clicks play, and the link to Facebook is always present, so if the embed fails they can still watch.
 */
export function FacebookVideo({ video, className }: { video: Video; className?: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state !== 'loading') return;
    let live = true;
    const timeout = window.setTimeout(() => live && setState('failed'), 12_000);
    loadSdk()
      .then(() => {
        if (!live) return;
        if (holder.current) window.FB?.XFBML.parse(holder.current);
        setState('ready');
      })
      .catch(() => live && setState('failed'))
      .finally(() => window.clearTimeout(timeout));
    return () => {
      live = false;
      window.clearTimeout(timeout);
    };
  }, [state]);

  const internalCta = video.cta_url?.startsWith('/');
  return (
    <figure className={cn('overflow-hidden rounded-[24px] border border-charcoal/10 bg-[#fffdf9]', className)}>
      {state === 'idle' || state === 'failed' ? (
        <div className="grid aspect-video place-items-center bg-[radial-gradient(100%_80%_at_50%_20%,#5a4c47,#2b2523)] p-6 text-center text-ivory">
          <div>
            {video.kind === 'live' && <span className="mb-3 inline-block rounded-full bg-rose-deep px-3 py-1 text-[0.72rem] tracking-wide uppercase">Live</span>}
            {state === 'failed' ? (
              <p className="mb-4 text-[0.95rem]">This video could not load here. You can still watch it on Facebook.</p>
            ) : (
              <button type="button" onClick={() => setState('loading')} className="mb-4 block w-full rounded-full bg-ivory px-6 py-3 text-[0.95rem] text-charcoal transition hover:bg-gold">
                Play video<span className="sr-only">: {video.title ?? 'from Facebook'}</span>
              </button>
            )}
            <a href={video.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-[0.88rem] text-ivory/85 underline underline-offset-4">
              Watch on Facebook <Arrow direction="up-right" className="h-3.5 w-3.5" />
            </a>
            {state === 'idle' && <p className="mt-3 text-[0.72rem] text-ivory/60">Playing here loads content from Facebook.</p>}
          </div>
        </div>
      ) : (
        <div ref={holder} className="bg-ink">
          <div className="fb-video" data-href={video.url} data-width="auto" data-allowfullscreen="true" data-show-text="false" />
        </div>
      )}
      {(video.title || video.caption || video.cta_url) && (
        <figcaption className="p-5">
          {video.title && <p className="font-display text-[1.35rem] leading-tight">{video.title}</p>}
          {video.caption && <p className="mt-1 text-[0.92rem] text-charcoal/70">{video.caption}</p>}
          {video.cta_url &&
            (internalCta ? (
              <Link to={video.cta_url} className="mt-3 inline-flex items-center gap-2 text-[0.92rem] font-medium text-rose-deep">
                <span className="link-underline">{video.cta_label ?? 'Shop this'}</span>
                <Arrow />
              </Link>
            ) : (
              <a href={video.cta_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-2 text-[0.92rem] font-medium text-rose-deep">
                <span className="link-underline">{video.cta_label ?? 'Learn more'}</span>
                <Arrow direction="up-right" />
              </a>
            ))}
        </figcaption>
      )}
    </figure>
  );
}
