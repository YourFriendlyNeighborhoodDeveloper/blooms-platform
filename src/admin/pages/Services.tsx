import { useState } from 'react';
import { api } from '../../lib/api';
import { money } from '../../lib/format';
import { Badge, Btn, Card, Checkbox, Field, Input, Loader, Modal, PageHeader, Select, Textarea, useAction, useLoad } from '../ui';

type Category = { id: string; name: string; slug: string; active: boolean };
type Service = { id: string; category_id: string; name: string; description: string | null; image_url: string | null; pricing_mode: string; unit: string; unit_price_cents: number | null; est_low_cents: number | null; est_high_cents: number | null; taxable: boolean; workload_points: number; setup_minutes: number; requires_crew: boolean; recipe_id: string | null; active: boolean; sort_order: number; is_demo: boolean };

const blank = (categoryId: string): Partial<Service> => ({ category_id: categoryId, pricing_mode: 'custom_quote', unit: 'each', taxable: true, active: true, workload_points: 0, setup_minutes: 0, requires_crew: false, sort_order: 0 });
const toCents = (s: string | number | null | undefined) => (s === '' || s === null || s === undefined ? null : Math.round(Number(s) * 100));
const toDollars = (n: number | null | undefined) => (n === null || n === undefined ? '' : (n / 100).toFixed(2));

export default function Services() {
  const state = useLoad<{ categories: Category[]; services: Service[] }>('/api/admin/catalog/services');
  const recipes = useLoad<{ recipes: Array<{ id: string; name: string | null; product_id: string | null }> }>('/api/admin/inventory/recipes');
  const { busy, run } = useAction();
  const [editing, setEditing] = useState<Partial<Service> | null>(null);
  const [prices, setPrices] = useState({ unit: '', low: '', high: '' });
  const [addingCategory, setAddingCategory] = useState(false);
  const [categoryName, setCategoryName] = useState('');

  const open = (s: Partial<Service>) => {
    setEditing(s);
    setPrices({ unit: toDollars(s.unit_price_cents), low: toDollars(s.est_low_cents), high: toDollars(s.est_high_cents) });
  };

  const save = async () => {
    if (!editing) return;
    const body = {
      category_id: editing.category_id, name: editing.name, description: editing.description || null, image_url: editing.image_url || null, pricing_mode: editing.pricing_mode, unit: editing.unit || 'each',
      unit_price_cents: editing.pricing_mode === 'package' ? toCents(prices.unit) : null,
      est_low_cents: editing.pricing_mode === 'estimate' ? toCents(prices.low) : null,
      est_high_cents: editing.pricing_mode === 'estimate' ? toCents(prices.high) : null,
      taxable: editing.taxable, workload_points: Number(editing.workload_points) || 0, setup_minutes: Number(editing.setup_minutes) || 0, requires_crew: editing.requires_crew, recipe_id: editing.recipe_id || null, active: editing.active, sort_order: Number(editing.sort_order) || 0,
    };
    const ok = await run(() => (editing.id ? api(`/api/admin/catalog/services/${editing.id}`, { method: 'PUT', body }) : api('/api/admin/catalog/services', { body })), 'Saved.');
    if (ok !== undefined) {
      setEditing(null);
      void state.reload();
    }
  };

  return (
    <>
      <PageHeader title="Wedding & event services" subtitle="What appears in the online planner. Prices shown there come only from here." actions={<Btn onClick={() => setAddingCategory(true)}>Add category</Btn>} />
      <Loader state={state}>
        {(d) => (
          <div className="space-y-4">
            {d.categories.map((c) => (
              <Card key={c.id} title={c.name} actions={<Btn small onClick={() => open(blank(c.id))}>Add service</Btn>}>
                {d.services.filter((s) => s.category_id === c.id).length === 0 && <p className="text-[0.85rem] text-charcoal/70">Nothing here yet.</p>}
                <ul className="divide-y divide-charcoal/8 text-[0.88rem]">
                  {d.services.filter((s) => s.category_id === c.id).map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                      <div>
                        <p className="font-medium">{s.name} {!s.active && <Badge>hidden</Badge>} {s.is_demo && <Badge tone="warn">demo</Badge>}</p>
                        {s.description && <p className="text-[0.78rem] text-charcoal/70">{s.description}</p>}
                      </div>
                      <p className="text-charcoal/70">{s.pricing_mode === 'package' ? `${money(s.unit_price_cents)} per ${s.unit}` : s.pricing_mode === 'estimate' ? `${money(s.est_low_cents)}–${money(s.est_high_cents)} per ${s.unit}` : 'Custom quote'}</p>
                      <Btn small onClick={() => open(s)}>Edit</Btn>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </Loader>
      <Modal title={editing?.id ? 'Edit service' : 'Add a service'} open={Boolean(editing)} onClose={() => setEditing(null)}>
        {editing && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required className="sm:col-span-2"><Input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
            <Field label="How is it priced?" className="sm:col-span-2">
              <Select value={editing.pricing_mode} onChange={(e) => setEditing({ ...editing, pricing_mode: e.target.value })}>
                <option value="custom_quote">Custom quote (no price shown)</option>
                <option value="estimate">Estimate range (not a promise)</option>
                <option value="package">Published fixed price</option>
              </Select>
            </Field>
            {editing.pricing_mode === 'package' && <Field label="Price, in dollars" required><Input inputMode="decimal" value={prices.unit} onChange={(e) => setPrices({ ...prices, unit: e.target.value })} /></Field>}
            {editing.pricing_mode === 'estimate' && <Field label="Low estimate" required><Input inputMode="decimal" value={prices.low} onChange={(e) => setPrices({ ...prices, low: e.target.value })} /></Field>}
            {editing.pricing_mode === 'estimate' && <Field label="High estimate" required><Input inputMode="decimal" value={prices.high} onChange={(e) => setPrices({ ...prices, high: e.target.value })} /></Field>}
            <Field label="Priced per" hint="Such as each, or guest."><Input value={editing.unit ?? 'each'} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} /></Field>
            <Field label="Workload points"><Input inputMode="numeric" value={editing.workload_points ?? 0} onChange={(e) => setEditing({ ...editing, workload_points: Number(e.target.value) || 0 })} /></Field>
            <Field label="Image link"><Input value={editing.image_url ?? ''} onChange={(e) => setEditing({ ...editing, image_url: e.target.value })} /></Field>
            <Field label="Materials recipe" hint="Adds to the purchasing list when booked.">
              <Select value={editing.recipe_id ?? ''} onChange={(e) => setEditing({ ...editing, recipe_id: e.target.value || null })}>
                <option value="">None</option>
                {recipes.data?.recipes.map((r) => <option key={r.id} value={r.id}>{r.name ?? `Recipe ${r.id.slice(0, 6)}`}</option>)}
              </Select>
            </Field>
            <div className="space-y-2 sm:col-span-2">
              <Checkbox label="Taxable" checked={editing.taxable ?? true} onChange={(v) => setEditing({ ...editing, taxable: v })} />
              <Checkbox label="Shown in the planner" checked={editing.active ?? true} onChange={(v) => setEditing({ ...editing, active: v })} />
            </div>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setEditing(null)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy || !editing?.name?.trim()} onClick={save}>Save</Btn>
        </div>
      </Modal>
      <Modal title="Add a category" open={addingCategory} onClose={() => setAddingCategory(false)}>
        <Field label="Name" required><Input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} /></Field>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setAddingCategory(false)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy || !categoryName.trim()} onClick={async () => { const ok = await run(() => api('/api/admin/catalog/service-categories', { body: { name: categoryName } }), 'Added.'); if (ok !== undefined) { setAddingCategory(false); setCategoryName(''); void state.reload(); } }}>Add</Btn>
        </div>
      </Modal>
    </>
  );
}
