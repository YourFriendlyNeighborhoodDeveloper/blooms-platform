import { useState } from 'react';
import { api } from '../../lib/api';
import { money, shortDate } from '../../lib/format';
import { Badge, Btn, Card, Checkbox, Field, Input, Loader, Modal, PageHeader, Select, StatusBadge, Textarea, useAction, useLoad } from '../ui';

type Video = { id: string; url: string; title: string | null; caption: string | null; kind: string; enabled: boolean; featured: boolean; cta_label: string | null; cta_url: string | null; sort_order: number };
type Promo = { id: string; code: string; description: string | null; kind: string; value: number; starts_at: string | null; ends_at: string | null; max_redemptions: number | null; per_customer_limit: number | null; redemption_count: number; min_subtotal_cents: number; division_ids: string[]; active: boolean };
type Block = { id: string; slot: string; title: string; body: string | null; link_label: string | null; link_url: string | null; active: boolean; starts_at: string | null; ends_at: string | null; sort_order: number };

const emptyPromo = { code: '', description: '', kind: 'percent', value: '', min: '', max: '', perCustomer: '', ends: '', active: true };

export default function Marketing() {
  const videos = useLoad<{ videos: Video[] }>('/api/admin/marketing/videos');
  const promos = useLoad<{ promotions: Promo[] }>('/api/admin/catalog/promotions');
  const content = useLoad<{ blocks: Block[] }>('/api/admin/marketing/content');
  const { busy, run } = useAction();
  const [video, setVideo] = useState<Partial<Video> | null>(null);
  const [promo, setPromo] = useState<(typeof emptyPromo & { id?: string }) | null>(null);
  const [block, setBlock] = useState<Partial<Block> | null>(null);

  const saveVideo = async () => {
    if (!video) return;
    const body = { url: video.url, title: video.title || null, caption: video.caption || null, kind: video.kind ?? 'video', enabled: video.enabled ?? true, featured: video.featured ?? false, cta_label: video.cta_label || null, cta_url: video.cta_url || null, sort_order: video.sort_order ?? 0 };
    const ok = await run(() => (video.id ? api(`/api/admin/marketing/videos/${video.id}`, { method: 'PUT', body }) : api('/api/admin/marketing/videos', { body })), 'Saved.');
    if (ok !== undefined) { setVideo(null); void videos.reload(); }
  };
  const savePromo = async () => {
    if (!promo) return;
    const body = { code: promo.code, description: promo.description || null, kind: promo.kind, value: promo.kind === 'fixed' ? Math.round(Number(promo.value) * 100) : promo.kind === 'percent' ? Number(promo.value) : 0, min_subtotal_cents: Math.round(Number(promo.min || 0) * 100), max_redemptions: promo.max ? Number(promo.max) : null, per_customer_limit: promo.perCustomer ? Number(promo.perCustomer) : null, ends_at: promo.ends ? new Date(`${promo.ends}T23:59:59`).toISOString() : null, active: promo.active };
    const ok = await run(() => (promo.id ? api(`/api/admin/catalog/promotions/${promo.id}`, { method: 'PUT', body }) : api('/api/admin/catalog/promotions', { body })), 'Saved.');
    if (ok !== undefined) { setPromo(null); void promos.reload(); }
  };
  const saveBlock = async () => {
    if (!block) return;
    const body = { slot: block.slot ?? 'home', title: block.title, body: block.body || null, link_label: block.link_label || null, link_url: block.link_url || null, active: block.active ?? false, sort_order: block.sort_order ?? 0 };
    const ok = await run(() => (block.id ? api(`/api/admin/marketing/content/${block.id}`, { method: 'PUT', body }) : api('/api/admin/marketing/content', { body })), 'Saved.');
    if (ok !== undefined) { setBlock(null); void content.reload(); }
  };

  return (
    <>
      <PageHeader title="Marketing" subtitle="Keep Facebook at the center, and bring its audience to the shop." />
      <div className="space-y-4">
        <Card title="Facebook videos" actions={<Btn small tone="primary" onClick={() => setVideo({ kind: 'video', enabled: true, featured: false })}>Add a video</Btn>}>
          <p className="mb-3 text-[0.82rem] text-charcoal/70">Paste the link to any public video or live video from your Page. The post must be public, or Facebook will not show it. Nothing is pulled from Facebook automatically, because that needs Meta app approval.</p>
          <Loader state={videos}>
            {(d) =>
              d.videos.length === 0 ? (
                <p className="text-[0.85rem] text-charcoal/70">No videos yet. The site simply links to your Facebook page.</p>
              ) : (
                <ul className="divide-y divide-charcoal/8 text-[0.86rem]">
                  {d.videos.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{v.title ?? 'Untitled video'} {v.kind === 'live' && <Badge tone="bad">live</Badge>} {v.featured && <Badge tone="good">featured on home</Badge>} {!v.enabled && <Badge>hidden</Badge>}</p>
                        <p className="truncate text-[0.75rem] text-charcoal/70">{v.url}</p>
                      </div>
                      <div className="flex gap-1.5">
                        <Btn small onClick={() => setVideo(v)}>Edit</Btn>
                        <Btn small tone="ghost" disabled={busy} onClick={async () => { await run(() => api(`/api/admin/marketing/videos/${v.id}`, { method: 'DELETE' })); void videos.reload(); }}>Remove</Btn>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            }
          </Loader>
        </Card>
        <Card title="Promotion codes" actions={<Btn small tone="primary" onClick={() => setPromo({ ...emptyPromo })}>Add a code</Btn>}>
          <Loader state={promos}>
            {(d) =>
              d.promotions.length === 0 ? (
                <p className="text-[0.85rem] text-charcoal/70">None yet.</p>
              ) : (
                <ul className="divide-y divide-charcoal/8 text-[0.86rem]">
                  {d.promotions.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div>
                        <p className="font-medium">{p.code} {!p.active && <Badge>off</Badge>}</p>
                        <p className="text-[0.75rem] text-charcoal/70">{p.kind === 'percent' ? `${p.value}% off` : p.kind === 'fixed' ? `${money(p.value)} off` : 'Free delivery'} · used {p.redemption_count}{p.max_redemptions !== null ? ` of ${p.max_redemptions}` : ''} times{p.ends_at ? ` · ends ${shortDate(p.ends_at)}` : ''}</p>
                      </div>
                      <Btn small onClick={() => setPromo({ id: p.id, code: p.code, description: p.description ?? '', kind: p.kind, value: p.kind === 'fixed' ? (p.value / 100).toFixed(2) : String(p.value), min: (p.min_subtotal_cents / 100).toFixed(2), max: p.max_redemptions?.toString() ?? '', perCustomer: p.per_customer_limit?.toString() ?? '', ends: p.ends_at ? p.ends_at.slice(0, 10) : '', active: p.active })}>Edit</Btn>
                    </li>
                  ))}
                </ul>
              )
            }
          </Loader>
        </Card>
        <Card title="Home page announcements" actions={<Btn small tone="primary" onClick={() => setBlock({ slot: 'home', active: true })}>Add</Btn>}>
          <p className="mb-3 text-[0.82rem] text-charcoal/70">A short banner below the home page hero. With none active, the home page looks exactly as designed.</p>
          <Loader state={content}>
            {(d) =>
              d.blocks.length === 0 ? (
                <p className="text-[0.85rem] text-charcoal/70">None yet.</p>
              ) : (
                <ul className="divide-y divide-charcoal/8 text-[0.86rem]">
                  {d.blocks.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <p className="font-medium">{b.title} <StatusBadge status={b.active ? 'active' : 'draft'} /></p>
                      <div className="flex gap-1.5">
                        <Btn small onClick={() => setBlock(b)}>Edit</Btn>
                        <Btn small tone="ghost" disabled={busy} onClick={async () => { await run(() => api(`/api/admin/marketing/content/${b.id}`, { method: 'DELETE' })); void content.reload(); }}>Remove</Btn>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            }
          </Loader>
        </Card>
      </div>

      <Modal title={video?.id ? 'Edit video' : 'Add a Facebook video'} open={Boolean(video)} onClose={() => setVideo(null)}>
        {video && (
          <div className="space-y-3">
            <Field label="Facebook video link" required><Input type="url" placeholder="https://www.facebook.com/yourpage/videos/…" value={video.url ?? ''} onChange={(e) => setVideo({ ...video, url: e.target.value })} /></Field>
            <Field label="Title"><Input value={video.title ?? ''} onChange={(e) => setVideo({ ...video, title: e.target.value })} /></Field>
            <Field label="Caption"><Textarea value={video.caption ?? ''} onChange={(e) => setVideo({ ...video, caption: e.target.value })} /></Field>
            <Field label="Type"><Select value={video.kind ?? 'video'} onChange={(e) => setVideo({ ...video, kind: e.target.value })}><option value="video">Video</option><option value="live">Live video</option></Select></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Button text" hint="Such as Shop this bouquet."><Input value={video.cta_label ?? ''} onChange={(e) => setVideo({ ...video, cta_label: e.target.value })} /></Field>
              <Field label="Button link" hint="A page here, like /shop/your-bouquet or /plan."><Input value={video.cta_url ?? ''} onChange={(e) => setVideo({ ...video, cta_url: e.target.value })} /></Field>
            </div>
            <Checkbox label="Shown on the site" checked={video.enabled ?? true} onChange={(v) => setVideo({ ...video, enabled: v })} />
            <Checkbox label="Feature this one on the home page" hint="Replaces any other featured video." checked={video.featured ?? false} onChange={(v) => setVideo({ ...video, featured: v })} />
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setVideo(null)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy || !video?.url?.trim()} onClick={saveVideo}>Save</Btn>
        </div>
      </Modal>
      <Modal title={promo?.id ? 'Edit code' : 'Add a promotion code'} open={Boolean(promo)} onClose={() => setPromo(null)}>
        {promo && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code" required><Input value={promo.code} onChange={(e) => setPromo({ ...promo, code: e.target.value })} /></Field>
            <Field label="Type"><Select value={promo.kind} onChange={(e) => setPromo({ ...promo, kind: e.target.value })}><option value="percent">Percent off</option><option value="fixed">Dollars off</option><option value="free_delivery">Free delivery</option></Select></Field>
            {promo.kind !== 'free_delivery' && <Field label={promo.kind === 'percent' ? 'Percent' : 'Dollars'} required><Input inputMode="decimal" value={promo.value} onChange={(e) => setPromo({ ...promo, value: e.target.value })} /></Field>}
            <Field label="Minimum order, in dollars"><Input inputMode="decimal" value={promo.min} onChange={(e) => setPromo({ ...promo, min: e.target.value })} /></Field>
            <Field label="Total uses allowed"><Input inputMode="numeric" value={promo.max} onChange={(e) => setPromo({ ...promo, max: e.target.value })} /></Field>
            <Field label="Uses per customer"><Input inputMode="numeric" value={promo.perCustomer} onChange={(e) => setPromo({ ...promo, perCustomer: e.target.value })} /></Field>
            <Field label="Ends"><Input type="date" value={promo.ends} onChange={(e) => setPromo({ ...promo, ends: e.target.value })} /></Field>
            <Field label="Description"><Input value={promo.description} onChange={(e) => setPromo({ ...promo, description: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Checkbox label="Active" checked={promo.active} onChange={(v) => setPromo({ ...promo, active: v })} /></div>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setPromo(null)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy || !promo?.code.trim()} onClick={savePromo}>Save</Btn>
        </div>
      </Modal>
      <Modal title="Home page announcement" open={Boolean(block)} onClose={() => setBlock(null)}>
        {block && (
          <div className="space-y-3">
            <Field label="Headline" required><Input value={block.title ?? ''} onChange={(e) => setBlock({ ...block, title: e.target.value })} /></Field>
            <Field label="Text"><Textarea value={block.body ?? ''} onChange={(e) => setBlock({ ...block, body: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Link text"><Input value={block.link_label ?? ''} onChange={(e) => setBlock({ ...block, link_label: e.target.value })} /></Field>
              <Field label="Link" hint="A page here, or an https link."><Input value={block.link_url ?? ''} onChange={(e) => setBlock({ ...block, link_url: e.target.value })} /></Field>
            </div>
            <Checkbox label="Show it now" checked={block.active ?? false} onChange={(v) => setBlock({ ...block, active: v })} />
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setBlock(null)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy || !block?.title?.trim()} onClick={saveBlock}>Save</Btn>
        </div>
      </Modal>
    </>
  );
}
