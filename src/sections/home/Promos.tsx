import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { PLATFORM_ENABLED } from '../../lib/platform';
import { FacebookVideo, type Video } from '../../components/social/FacebookVideo';
import { Arrow } from '../../components/ui/Button';
import { Eyebrow } from '../../components/ui/Reveal';

type Block = { id: string; title: string; body: string | null; image_url: string | null; link_label: string | null; link_url: string | null };

/** Owner-managed announcements. With none active, the page is exactly as designed. */
export function HomePromos() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  useEffect(() => {
    if (!PLATFORM_ENABLED) return;
    api<{ blocks: Block[] }>('/api/public/content/home').then((r) => setBlocks(r.blocks)).catch(() => {});
  }, []);
  if (!blocks.length) return null;
  return (
    <section data-nav="light" className="bg-blush py-10" aria-label="Shop announcements">
      <div className="shell space-y-4">
        {blocks.map((b) => (
          <div key={b.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-display text-[clamp(1.4rem,2.4vw,2rem)] leading-tight">{b.title}</p>
              {b.body && <p className="mt-1 text-[0.98rem] text-charcoal/75">{b.body}</p>}
            </div>
            {b.link_url &&
              (b.link_url.startsWith('/') ? (
                <Link to={b.link_url} className="inline-flex items-center gap-2 font-medium text-rose-deep">
                  <span className="link-underline">{b.link_label ?? 'Learn more'}</span>
                  <Arrow />
                </Link>
              ) : (
                <a href={b.link_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-medium text-rose-deep">
                  <span className="link-underline">{b.link_label ?? 'Learn more'}</span>
                  <Arrow direction="up-right" />
                </a>
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Shows the featured Facebook video when there is one. With none, or if the request fails, nothing renders. */
export function FeaturedVideo() {
  const [video, setVideo] = useState<Video | null>(null);
  useEffect(() => {
    if (!PLATFORM_ENABLED) return;
    api<{ videos: Video[] }>('/api/public/videos').then((r) => setVideo(r.videos.find((v) => v.featured) ?? null)).catch(() => {});
  }, []);
  if (!video) return null;
  return (
    <section data-nav="light" className="bg-ivory py-20 lg:py-28" aria-labelledby="featured-video-heading">
      <div className="shell">
        <Eyebrow className="text-rose-deep">{video.kind === 'live' ? 'Live from the shop' : 'From the shop'}</Eyebrow>
        <h2 id="featured-video-heading" className="mt-4 text-[clamp(2.2rem,4.6vw,4rem)] leading-[1.02] tracking-[-0.03em]">
          Come see what&rsquo;s <em className="text-rose-deep">new.</em>
        </h2>
        <div className="mt-10 max-w-4xl">
          <FacebookVideo video={video} />
        </div>
        <Link to="/live" className="mt-6 inline-flex items-center gap-2 text-[0.95rem] font-medium">
          <span className="link-underline">All videos</span>
          <Arrow />
        </Link>
      </div>
    </section>
  );
}
