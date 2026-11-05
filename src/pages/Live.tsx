import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Arrow, Button } from '../components/ui/Button';
import { FacebookVideo, type Video } from '../components/social/FacebookVideo';
import { Spinner, StorePage } from '../shop/ui';
import { business } from '../data/business';

export default function Live() {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [facebook, setFacebook] = useState<string>(business.profiles[0].href);
  useEffect(() => {
    api<{ videos: Video[]; facebook_url: string | null }>('/api/public/videos')
      .then((r) => {
        setVideos(r.videos);
        if (r.facebook_url) setFacebook(r.facebook_url);
      })
      .catch(() => setVideos([]));
  }, []);
  return (
    <StorePage
      eyebrow="Live & video"
      title="See what’s new at the shop"
      intro="Live shows and videos from the Blooms Facebook page, with a link to anything you fall for."
      aside={
        <Button href={facebook} external variant="outline" icon={<Arrow direction="up-right" />}>
          Follow on Facebook
        </Button>
      }
    >
      {!videos && <Spinner />}
      {videos && !videos.length && <p className="text-charcoal/70">New videos will appear here. In the meantime, the shop posts regularly on Facebook.</p>}
      {videos && videos.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2">
          {videos.map((v) => (
            <FacebookVideo key={v.id} video={v} className={v.featured ? 'md:col-span-2' : undefined} />
          ))}
        </div>
      )}
    </StorePage>
  );
}
