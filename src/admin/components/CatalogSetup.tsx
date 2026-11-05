import { useState } from 'react';
import { api } from '../../lib/api';
import { useSession } from '../session';
import { Badge, Btn, Card, Field, Input, Modal, Select, useAction, useLoad } from '../ui';

type Division = { id: string; code: string; name: string; description: string | null; active: boolean };
type Category = { id: string; division_id: string; name: string; slug: string; description: string | null; active: boolean; sort_order: number };

/** Departments and categories: the owner's own structure, changeable without a developer. */
export function CatalogSetup() {
  const { can } = useSession();
  const meta = useLoad<{ divisions: Division[]; categories: Category[] }>('/api/admin/catalog/meta');
  const { busy, run } = useAction();
  const [division, setDivision] = useState<Partial<Division> | null>(null);
  const [category, setCategory] = useState<Partial<Category> | null>(null);
  const canSettings = can('settings.manage');
  const reload = () => void meta.reload();

  const saveDivision = async () => {
    if (!division?.name?.trim()) return;
    const body = { name: division.name.trim(), description: division.description || null, ...(division.id ? { active: division.active ?? true } : {}) };
    const ok = await run(() => (division.id ? api(`/api/admin/catalog/divisions/${division.id}`, { method: 'PATCH', body }) : api('/api/admin/catalog/divisions', { body })), 'Saved.');
    if (ok !== undefined) { setDivision(null); reload(); }
  };
  const saveCategory = async () => {
    if (!category?.name?.trim() || !category.division_id) return;
    const body = { division_id: category.division_id, name: category.name.trim(), slug: category.slug ?? null, description: category.description || null, active: category.active ?? true, sort_order: category.sort_order ?? 0 };
    const ok = await run(() => (category.id ? api(`/api/admin/catalog/categories/${category.id}`, { method: 'PUT', body }) : api('/api/admin/catalog/categories', { body })), 'Saved.');
    if (ok !== undefined) { setCategory(null); reload(); }
  };

  return (
    <>
      <Card title="Departments and categories" className="mt-4" actions={<div className="flex gap-2">{canSettings && <Btn small onClick={() => setDivision({ active: true })}>Add department</Btn>}<Btn small onClick={() => setCategory({ active: true, division_id: meta.data?.divisions[0]?.id })}>Add category</Btn></div>}>
        <ul className="space-y-3 text-[0.88rem]">
          {meta.data?.divisions.map((d) => (
            <li key={d.id}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{d.name}</p>
                {!d.active && <Badge>off</Badge>}
                {canSettings && <Btn small tone="ghost" onClick={() => setDivision(d)}>Edit</Btn>}
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {meta.data?.categories.filter((c) => c.division_id === d.id).map((c) => (
                  <button key={c.id} type="button" onClick={() => setCategory(c)} aria-label={`Edit category ${c.name}`} className="rounded-full border border-charcoal/20 px-2.5 py-0.5 text-[0.78rem] hover:bg-charcoal/5">
                    {c.name}{!c.active && ' (off)'}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Modal title={division?.id ? 'Edit department' : 'Add a department'} open={Boolean(division)} onClose={() => setDivision(null)}>
        {division && (
          <div className="space-y-3">
            <Field label="Name" required><Input value={division.name ?? ''} onChange={(e) => setDivision({ ...division, name: e.target.value })} /></Field>
            <Field label="Description"><Input value={division.description ?? ''} onChange={(e) => setDivision({ ...division, description: e.target.value })} /></Field>
            {division.id && (
              <Field label="Status" hint="Turning a department off removes its products from the shop.">
                <Select value={division.active ? 'on' : 'off'} onChange={(e) => setDivision({ ...division, active: e.target.value === 'on' })}><option value="on">On</option><option value="off">Off</option></Select>
              </Field>
            )}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setDivision(null)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy || !division?.name?.trim()} onClick={saveDivision}>Save</Btn>
        </div>
      </Modal>
      <Modal title={category?.id ? 'Edit category' : 'Add a category'} open={Boolean(category)} onClose={() => setCategory(null)}>
        {category && (
          <div className="space-y-3">
            <Field label="Name" required><Input value={category.name ?? ''} onChange={(e) => setCategory({ ...category, name: e.target.value })} /></Field>
            <Field label="Department" required>
              <Select value={category.division_id ?? ''} onChange={(e) => setCategory({ ...category, division_id: e.target.value })}>
                {meta.data?.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            {category.id && (
              <Field label="Status">
                <Select value={category.active ? 'on' : 'off'} onChange={(e) => setCategory({ ...category, active: e.target.value === 'on' })}><option value="on">Shown in the shop</option><option value="off">Hidden</option></Select>
              </Field>
            )}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setCategory(null)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy || !category?.name?.trim() || !category.division_id} onClick={saveCategory}>Save</Btn>
        </div>
      </Modal>
    </>
  );
}
