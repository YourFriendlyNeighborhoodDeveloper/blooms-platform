import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { api } from '../../lib/api';
import { money } from '../../lib/format';
import { Badge, Btn, Card, Checkbox, Field, Input, Loader, Modal, PageHeader, Select, Textarea, useAction, useLoad } from '../ui';

type Variant = { id: string; sku: string; name: string; price_cents: number; sale_price_cents: number | null; cost_estimate_cents: number | null; prep_minutes: number | null; complexity_points: number | null; track_inventory: boolean; active: boolean; sort_order: number; available: number | null; inventory_item_id: string | null };
type Option = { id: string; code: string; label: string; input_type: string; required: boolean; max_length: number | null; help_text: string | null; choices: Array<{ value: string; label?: string; price_delta_cents?: number }>; sort_order: number };
type Product = {
  id: string; name: string; slug: string; division_id: string; short_description: string | null; description: string | null; status: string; is_custom: boolean; tax_category: string; prep_minutes: number; complexity_points: number; min_lead_hours: number; allow_pickup: boolean; allow_delivery: boolean; allow_shipping: boolean; delivery_restriction: string | null; restricted_zone_ids: string[]; season_start_md: string | null; season_end_md: string | null; available_from: string | null; available_until: string | null; requires_approval: boolean | null; out_of_stock_behavior: string | null; return_policy: string | null; featured: boolean; sort_order: number; is_demo: boolean;
  variants: Variant[]; options: Option[]; images: Array<{ id: string; url: string; alt: string }>; category_ids: string[];
  recipe: { id: string; notes: string | null; components: Array<{ id: string; item_id: string; quantity: number; name: string; unit: string; substitutes: Array<{ id: string; item_id: string; quantity: number; name: string }> }> } | null;
  warnings: string[];
};
type Meta = { divisions: Array<{ id: string; name: string }>; categories: Array<{ id: string; name: string }>; zones: Array<{ id: string; name: string }> };
type Item = { id: string; name: string; unit: string; sku: string };

const cents = (s: string) => (s.trim() === '' ? null : Math.round(Number(s) * 100));
const dollars = (n: number | null | undefined) => (n === null || n === undefined ? '' : (n / 100).toFixed(2));
const num = (s: string) => (s.trim() === '' ? null : Number(s));

function VariantModal({ productId, variant, onClose, onSaved }: { productId: string; variant: Variant | 'new'; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const v = variant === 'new' ? null : variant;
  const [f, setF] = useState({ sku: v?.sku ?? '', name: v?.name ?? 'Standard', price: dollars(v?.price_cents), sale: dollars(v?.sale_price_cents), cost: dollars(v?.cost_estimate_cents), prep: v?.prep_minutes?.toString() ?? '', points: v?.complexity_points?.toString() ?? '', track: v?.track_inventory ?? true, active: v?.active ?? true, stock: true });
  const set = (k: keyof typeof f, val: string | boolean) => setF((s) => ({ ...s, [k]: val }));
  const save = async () => {
    const body = { sku: f.sku, name: f.name, price_cents: cents(f.price) ?? 0, sale_price_cents: cents(f.sale), cost_estimate_cents: cents(f.cost), prep_minutes: num(f.prep), complexity_points: num(f.points), track_inventory: f.track, active: f.active, ...(v ? {} : { create_stock_item: f.stock && f.track }) };
    const ok = await run(() => (v ? api(`/api/admin/catalog/variants/${v.id}`, { method: 'PUT', body }) : api(`/api/admin/catalog/products/${productId}/variants`, { body })), 'Saved.');
    if (ok !== undefined) onSaved();
  };
  return (
    <Modal title={v ? `Edit ${v.name}` : 'Add a size or version'} open onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required hint="Such as Standard, Large, or a color."><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="SKU" required><Input value={f.sku} onChange={(e) => set('sku', e.target.value)} /></Field>
        <Field label="Price in dollars" required><Input inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} /></Field>
        <Field label="Sale price"><Input inputMode="decimal" value={f.sale} onChange={(e) => set('sale', e.target.value)} /></Field>
        <Field label="Cost estimate" hint="Private. Never shown to customers."><Input inputMode="decimal" value={f.cost} onChange={(e) => set('cost', e.target.value)} /></Field>
        <Field label="Prep minutes override" hint="Blank uses the product's."><Input inputMode="numeric" value={f.prep} onChange={(e) => set('prep', e.target.value)} /></Field>
        <Field label="Workload points override"><Input inputMode="numeric" value={f.points} onChange={(e) => set('points', e.target.value)} /></Field>
      </div>
      <div className="mt-3 space-y-2">
        <Checkbox label="Active" checked={f.active} onChange={(x) => set('active', x)} />
        <Checkbox label="Track stock for this" hint="Turn off for made-to-order items, or ones limited by a recipe." checked={f.track} onChange={(x) => set('track', x)} />
        {!v && f.track && <Checkbox label="Create a stock item for it" checked={f.stock} onChange={(x) => set('stock', x)} />}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn tone="primary" disabled={busy || !f.sku.trim() || f.price.trim() === ''} onClick={save}>Save</Btn>
      </div>
    </Modal>
  );
}

function OptionModal({ productId, option, onClose, onSaved }: { productId: string; option: Option | 'new'; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const o = option === 'new' ? null : option;
  const [label, setLabel] = useState(o?.label ?? '');
  const code = o?.code ?? '';
  const [type, setType] = useState(o?.input_type ?? 'select');
  const [required, setRequired] = useState(o?.required ?? false);
  const [maxLength, setMaxLength] = useState(o?.max_length?.toString() ?? '');
  const [help, setHelp] = useState(o?.help_text ?? '');
  const [choices, setChoices] = useState((o?.choices ?? []).map((c) => `${c.value}${c.price_delta_cents ? ` | ${(c.price_delta_cents / 100).toFixed(2)}` : ''}`).join('\n'));
  const save = async () => {
    const parsed = choices.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [value, delta] = line.split('|').map((s) => s.trim());
      return { value, ...(delta ? { price_delta_cents: Math.round(Number(delta) * 100) } : {}) };
    });
    const body = { label, code: code || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40), input_type: type, required, max_length: num(maxLength), help_text: help || null, choices: parsed };
    const ok = await run(() => (o ? api(`/api/admin/catalog/options/${o.id}`, { method: 'PUT', body }) : api(`/api/admin/catalog/products/${productId}/options`, { body })), 'Saved.');
    if (ok !== undefined) onSaved();
  };
  return (
    <Modal title={o ? `Edit ${o.label}` : 'Add a customer choice'} open onClose={onClose}>
      <div className="space-y-3">
        <Field label="What to ask" required hint="Such as Bouquet size, Color preference, or Card message."><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="select">Choose one</option>
            <option value="multiselect">Choose several</option>
            <option value="text">Short text</option>
            <option value="textarea">Long text</option>
          </Select>
        </Field>
        {(type === 'select' || type === 'multiselect') && (
          <Field label="Choices" required hint="One per line. To add a charge, write: Large | 15.00"><Textarea rows={5} value={choices} onChange={(e) => setChoices(e.target.value)} /></Field>
        )}
        {(type === 'text' || type === 'textarea') && <Field label="Maximum length"><Input inputMode="numeric" value={maxLength} onChange={(e) => setMaxLength(e.target.value)} /></Field>}
        <Field label="Help text"><Input value={help} onChange={(e) => setHelp(e.target.value)} /></Field>
        <Checkbox label="Required" checked={required} onChange={setRequired} />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn tone="primary" disabled={busy || !label.trim()} onClick={save}>Save</Btn>
      </div>
    </Modal>
  );
}

function RecipeCard({ product, onSaved }: { product: Product; onSaved: () => void }) {
  const items = useLoad<{ items: Item[] }>('/api/admin/inventory/items');
  const { busy, run } = useAction();
  const [rows, setRows] = useState(product.recipe?.components.map((c) => ({ item_id: c.item_id, quantity: String(c.quantity), substitutes: c.substitutes.map((s) => ({ item_id: s.item_id, quantity: s.quantity })) })) ?? []);
  const save = () => run(() => api(`/api/admin/inventory/recipes/product/${product.id}`, { method: 'PUT', body: { components: rows.filter((r) => r.item_id && Number(r.quantity) > 0).map((r) => ({ item_id: r.item_id, quantity: Number(r.quantity), substitutes: r.substitutes })) } }), 'Recipe saved.').then(onSaved);
  return (
    <Card title="Recipe" actions={<Btn small onClick={() => setRows((r) => [...r, { item_id: '', quantity: '1', substitutes: [] }])}>Add material</Btn>}>
      <p className="mb-3 text-[0.8rem] text-charcoal/70">Materials used per one of this product. They are reserved at checkout, and the product sells out when a material runs short.</p>
      {rows.length === 0 && <p className="text-[0.88rem] text-charcoal/70">No recipe. Stock is limited only by the items themselves.</p>}
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <label className="min-w-[12rem] flex-1">
              <span className="sr-only">Material</span>
              <Select value={r.item_id} onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, item_id: e.target.value } : x)))}>
                <option value="">Choose a material…</option>
                {items.data?.items.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>)}
              </Select>
            </label>
            <label className="w-24">
              <span className="sr-only">Quantity</span>
              <Input inputMode="numeric" value={r.quantity} onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
            </label>
            <label className="min-w-[10rem]">
              <span className="sr-only">Approved substitute</span>
              <Select value={r.substitutes[0]?.item_id ?? ''} onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, substitutes: e.target.value ? [{ item_id: e.target.value, quantity: Number(x.quantity) || 1 }] : [] } : x)))}>
                <option value="">No substitute allowed</option>
                {items.data?.items.filter((it) => it.id !== r.item_id).map((it) => <option key={it.id} value={it.id}>Substitute: {it.name}</option>)}
              </Select>
            </label>
            <Btn small tone="ghost" aria-label="Remove material" onClick={() => setRows((s) => s.filter((_, j) => j !== i))}>✕</Btn>
          </li>
        ))}
      </ul>
      <Btn small tone="primary" className="mt-3" disabled={busy} onClick={save}>Save recipe</Btn>
    </Card>
  );
}

function Details({ product, meta, onSaved }: { product: Product; meta: Meta; onSaved: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState(product);
  useEffect(() => setF(product), [product]);
  const set = <K extends keyof Product>(k: K, v: Product[K]) => setF((s) => ({ ...s, [k]: v }));
  const save = () =>
    run(
      () =>
        api(`/api/admin/catalog/products/${product.id}`, {
          method: 'PUT',
          body: {
            name: f.name, division_id: f.division_id, slug: f.slug, short_description: f.short_description || null, description: f.description || null, status: f.status, is_custom: f.is_custom, tax_category: f.tax_category, prep_minutes: Number(f.prep_minutes) || 0, complexity_points: Number(f.complexity_points) || 0, min_lead_hours: Number(f.min_lead_hours) || 0, allow_pickup: f.allow_pickup, allow_delivery: f.allow_delivery, allow_shipping: f.allow_shipping, delivery_restriction: f.delivery_restriction || null, restricted_zone_ids: f.restricted_zone_ids, season_start_md: f.season_start_md || null, season_end_md: f.season_end_md || null, available_from: f.available_from || null, available_until: f.available_until || null, requires_approval: f.requires_approval, out_of_stock_behavior: f.out_of_stock_behavior || null, return_policy: f.return_policy || null, featured: f.featured, sort_order: Number(f.sort_order) || 0, category_ids: f.category_ids,
          },
        }),
      'Saved.',
    ).then(onSaved);
  return (
    <Card title="Details" actions={<Btn small tone="primary" disabled={busy} onClick={save}>Save details</Btn>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
            <option value="draft">Draft (hidden)</option>
            <option value="active">Active (on sale)</option>
            <option value="archived">Archived</option>
          </Select>
        </Field>
        <Field label="Department">
          <Select value={f.division_id} onChange={(e) => set('division_id', e.target.value)}>
            {meta.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Tax category" hint="Must match a rate in Settings."><Input value={f.tax_category} onChange={(e) => set('tax_category', e.target.value)} /></Field>
        <Field label="Short description" className="sm:col-span-2"><Input value={f.short_description ?? ''} onChange={(e) => set('short_description', e.target.value)} /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea rows={5} value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Prep minutes" hint="Work needed for one."><Input inputMode="numeric" value={f.prep_minutes} onChange={(e) => set('prep_minutes', Number(e.target.value) || 0)} /></Field>
        <Field label="Workload points" hint="A bouquet might be 2, a large piece 10."><Input inputMode="numeric" value={f.complexity_points} onChange={(e) => set('complexity_points', Number(e.target.value) || 0)} /></Field>
        <Field label="Minimum notice, in hours"><Input inputMode="numeric" value={f.min_lead_hours} onChange={(e) => set('min_lead_hours', Number(e.target.value) || 0)} /></Field>
        <Field label="If out of stock">
          <Select value={f.out_of_stock_behavior ?? ''} onChange={(e) => set('out_of_stock_behavior', e.target.value || null)}>
            <option value="">Use the shop-wide setting</option>
            <option value="reject">Stop the sale</option>
            <option value="review">Send for review</option>
            <option value="backorder">Allow backorder</option>
          </Select>
        </Field>
        <Field label="Season starts" hint="MM-DD, such as 11-15."><Input value={f.season_start_md ?? ''} onChange={(e) => set('season_start_md', e.target.value)} /></Field>
        <Field label="Season ends" hint="MM-DD, such as 01-05."><Input value={f.season_end_md ?? ''} onChange={(e) => set('season_end_md', e.target.value)} /></Field>
        <Field label="Delivery note" className="sm:col-span-2"><Input value={f.delivery_restriction ?? ''} onChange={(e) => set('delivery_restriction', e.target.value)} /></Field>
        <Field label="Return policy" className="sm:col-span-2"><Textarea value={f.return_policy ?? ''} onChange={(e) => set('return_policy', e.target.value)} /></Field>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Checkbox label="Pickup" checked={f.allow_pickup} onChange={(v) => set('allow_pickup', v)} />
        <Checkbox label="Local delivery" checked={f.allow_delivery} onChange={(v) => set('allow_delivery', v)} />
        <Checkbox label="Shipping" checked={f.allow_shipping} onChange={(v) => set('allow_shipping', v)} />
        <Checkbox label="Custom piece" hint="Follows the custom-order approval setting." checked={f.is_custom} onChange={(v) => set('is_custom', v)} />
        <Checkbox label="Always needs approval" checked={f.requires_approval === true} onChange={(v) => set('requires_approval', v ? true : null)} />
        <Checkbox label="Featured in the shop" checked={f.featured} onChange={(v) => set('featured', v)} />
      </div>
      {meta.categories.length > 0 && (
        <fieldset className="mt-4">
          <legend className="mb-1 text-[0.8rem] font-medium">Categories</legend>
          <div className="flex flex-wrap gap-3">
            {meta.categories.map((c) => (
              <Checkbox key={c.id} label={c.name} checked={f.category_ids.includes(c.id)} onChange={(v) => set('category_ids', v ? [...f.category_ids, c.id] : f.category_ids.filter((x) => x !== c.id))} />
            ))}
          </div>
        </fieldset>
      )}
      {meta.zones.length > 0 && (
        <fieldset className="mt-4">
          <legend className="mb-1 text-[0.8rem] font-medium">Only deliver to (leave all off for every zone)</legend>
          <div className="flex flex-wrap gap-3">
            {meta.zones.map((z) => (
              <Checkbox key={z.id} label={z.name} checked={f.restricted_zone_ids.includes(z.id)} onChange={(v) => set('restricted_zone_ids', v ? [...f.restricted_zone_ids, z.id] : f.restricted_zone_ids.filter((x) => x !== z.id))} />
            ))}
          </div>
        </fieldset>
      )}
    </Card>
  );
}

export default function ProductEdit() {
  const { id } = useParams();
  const state = useLoad<Product>(`/api/admin/catalog/products/${id}`);
  const meta = useLoad<Meta>('/api/admin/catalog/meta');
  const { run } = useAction();
  const [variant, setVariant] = useState<Variant | 'new' | null>(null);
  const [option, setOption] = useState<Option | 'new' | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.set('file', file);
      await run(() => api(`/api/admin/catalog/products/${id}/images`, { formData: form }), 'Photo added.');
    }
    void state.reload();
  };

  return (
    <Loader state={state}>
      {(p) => (
        <>
          <PageHeader title={p.name} back={{ to: '/admin/products', label: 'Products' }} subtitle={p.is_demo ? <Badge tone="warn">Fictional demo product</Badge> : undefined} />
          {p.warnings.map((w) => (
            <p key={w} role="alert" className="mb-4 rounded-lg border border-rose-deep/30 bg-blush/40 p-3 text-[0.88rem]">{w}</p>
          ))}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              {meta.data && <Details product={p} meta={meta.data} onSaved={state.reload} />}
              <Card title="Sizes and versions" actions={<Btn small onClick={() => setVariant('new')}>Add</Btn>}>
                {p.variants.length === 0 && <p role="alert" className="text-[0.88rem] text-rose-deep">Add at least one with a price, or this product cannot be sold.</p>}
                <ul className="divide-y divide-charcoal/8 text-[0.88rem]">
                  {p.variants.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                      <div>
                        <p className="font-medium">{v.name} {!v.active && <Badge>inactive</Badge>}</p>
                        <p className="text-[0.75rem] text-charcoal/70">{v.sku}</p>
                      </div>
                      <p className="tabular-nums">{money(v.sale_price_cents ?? v.price_cents)}{v.sale_price_cents !== null && <s className="ml-1 text-charcoal/70">{money(v.price_cents)}</s>}</p>
                      <p className="tabular-nums text-charcoal/70">{v.available === null ? 'Made to order' : `${v.available} available`}</p>
                      <div className="flex gap-2">
                        {v.inventory_item_id && <a className="text-[0.8rem] underline" href={`/admin/inventory/items/${v.inventory_item_id}`}>Stock</a>}
                        <Btn small onClick={() => setVariant(v)}>Edit</Btn>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="Customer choices" actions={<Btn small onClick={() => setOption('new')}>Add</Btn>}>
                {p.options.length === 0 && <p className="text-[0.88rem] text-charcoal/70">No choices. Add things like size, color or a card message.</p>}
                <ul className="divide-y divide-charcoal/8 text-[0.88rem]">
                  {p.options.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                      <div>
                        <p className="font-medium">{o.label} {o.required && <Badge tone="info">required</Badge>}</p>
                        {o.choices.length > 0 && <p className="text-[0.78rem] text-charcoal/70">{o.choices.map((c) => c.value).join(', ')}</p>}
                      </div>
                      <div className="flex gap-2">
                        <Btn small onClick={() => setOption(o)}>Edit</Btn>
                        <Btn small tone="ghost" onClick={async () => { await run(() => api(`/api/admin/catalog/options/${o.id}`, { method: 'DELETE' })); void state.reload(); }}>Remove</Btn>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
              <RecipeCard key={p.recipe?.id ?? 'none'} product={p} onSaved={state.reload} />
            </div>
            <Card title="Photos" className="self-start">
              <ul className="grid grid-cols-2 gap-2">
                {p.images.map((img) => (
                  <li key={img.id} className="relative">
                    <img src={img.url} alt={img.alt} className="aspect-square w-full rounded-lg object-cover" />
                    <Btn small tone="ghost" className="absolute top-1 right-1 bg-white/90" aria-label="Remove photo" onClick={async () => { await run(() => api(`/api/admin/catalog/images/${img.id}`, { method: 'DELETE' })); void state.reload(); }}>✕</Btn>
                  </li>
                ))}
              </ul>
              <label className="mt-3 inline-flex h-10 cursor-pointer items-center rounded-lg border border-charcoal/25 px-4 text-[0.88rem] hover:border-charcoal/60">
                Add photos
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
              </label>
            </Card>
          </div>
          {variant && <VariantModal productId={p.id} variant={variant} onClose={() => setVariant(null)} onSaved={() => { setVariant(null); void state.reload(); }} />}
          {option && <OptionModal productId={p.id} option={option} onClose={() => setOption(null)} onSaved={() => { setOption(null); void state.reload(); }} />}
        </>
      )}
    </Loader>
  );
}
