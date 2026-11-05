import { useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { dateLabel } from '../../lib/format';
import { useSession } from '../session';
import { Badge, Btn, Field, Input, Loader, Modal, PageHeader, Select, useAction, useLoad } from '../ui';
import { cn } from '../../lib/cn';

type Stage = { id: string; code: string; name: string; kind: string; sort_order: number };
type CardRow = { id: string; reference: string; event_type: string; event_date: string; guest_count: number | null; budget_range?: string | null; status: string; stage_id: string; availability_status?: string; is_test: boolean; customer_name: string; assigned_name: string | null; open_tasks: number };

const AVAILABILITY: Record<string, { label: string; tone: string }> = {
  available: { label: 'date looks open', tone: 'good' },
  review: { label: 'date needs review', tone: 'warn' },
  unavailable: { label: 'date conflict', tone: 'bad' },
};

function StageRow({ stage, onSaved }: { stage: { id: string; name: string }; onSaved: () => void }) {
  const { busy, run } = useAction();
  const [value, setValue] = useState(stage.name);
  return (
    <li className="flex items-center gap-2">
      <label className="flex-1"><span className="sr-only">Name of the {stage.name} stage</span><Input value={value} onChange={(e) => setValue(e.target.value)} /></label>
      <Btn small disabled={busy || !value.trim() || value === stage.name} onClick={async () => { const ok = await run(() => api(`/api/admin/weddings/stages/${stage.id}`, { method: 'PATCH', body: { name: value.trim() } }), 'Renamed.'); if (ok !== undefined) onSaved(); }}>Rename</Btn>
    </li>
  );
}

export default function Weddings() {
  const state = useLoad<{ stages: Stage[]; cards: CardRow[] }>('/api/admin/weddings/board');
  const { can } = useSession();
  const { busy, run } = useAction();
  const [over, setOver] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const manage = can('weddings.manage');

  const move = async (id: string, stage_id: string) => {
    if (!state.data) return;
    const previous = state.data;
    state.setData({ ...previous, cards: previous.cards.map((c) => (c.id === id ? { ...c, stage_id } : c)) });
    const ok = await run(() => api(`/api/admin/weddings/${id}/stage`, { body: { stage_id } }));
    if (ok === undefined) state.setData(previous);
  };

  const onDrop = (e: DragEvent, stageId: string) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData('text/inquiry');
    if (id) void move(id, stageId);
  };

  return (
    <>
      <PageHeader title="Weddings & events" subtitle="Drag a card to change its stage, or use its menu." actions={can('settings.manage') && <Btn onClick={() => setAdding(true)}>Manage stages</Btn>} />
      <Loader state={state}>
        {(d) => (
          <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <div className="flex min-w-max gap-3">
              {d.stages.map((stage) => {
                const cards = d.cards.filter((c) => c.stage_id === stage.id);
                return (
                  <section
                    key={stage.id}
                    aria-label={`${stage.name}, ${cards.length} ${cards.length === 1 ? 'card' : 'cards'}`}
                    onDragOver={(e) => { if (manage) { e.preventDefault(); setOver(stage.id); } }}
                    onDragLeave={() => setOver(null)}
                    onDrop={(e) => onDrop(e, stage.id)}
                    className={cn('w-64 shrink-0 rounded-xl bg-charcoal/[0.04] p-2.5 transition-colors', over === stage.id && 'bg-blush/60')}
                  >
                    <h2 className="mb-2 flex items-center justify-between px-1 font-sans text-[0.78rem] font-semibold tracking-normal">
                      {stage.name}
                      <span className="font-normal text-charcoal/70">{cards.length}</span>
                    </h2>
                    <ul className="space-y-2">
                      {cards.map((c) => {
                        const availability = c.availability_status ? AVAILABILITY[c.availability_status] : null;
                        return (
                          <li key={c.id} draggable={manage} onDragStart={(e) => e.dataTransfer.setData('text/inquiry', c.id)} className="rounded-lg border border-charcoal/10 bg-white p-2.5 text-[0.82rem] shadow-sm">
                            <Link to={`/admin/weddings/${c.id}`} className="font-medium hover:underline">{c.customer_name}</Link>
                            {c.is_test && <span className="ml-1"><Badge tone="warn">test</Badge></span>}
                            <p className="text-charcoal/70">{c.event_type}, {dateLabel(c.event_date, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                            {c.guest_count !== null && <p className="text-charcoal/70">{c.guest_count} guests{c.budget_range ? ` · ${c.budget_range}` : ''}</p>}
                            {availability && <div className="mt-1"><Badge tone={availability.tone}>{availability.label}</Badge></div>}
                            {c.assigned_name && <p className="mt-1 text-[0.72rem] text-charcoal/70">{c.assigned_name}</p>}
                            {manage && (
                              <label className="mt-2 block">
                                <span className="sr-only">Move {c.customer_name} to stage</span>
                                <Select className="h-8 py-0 text-[0.78rem] leading-none" disabled={busy} value={c.stage_id} onChange={(e) => move(c.id, e.target.value)}>
                                  {d.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </Select>
                              </label>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </Loader>
      <Modal title="Pipeline stages" open={adding} onClose={() => setAdding(false)}>
        <ul className="mb-4 space-y-2">
          {state.data?.stages.map((stage) => <StageRow key={stage.id} stage={stage} onSaved={() => void state.reload()} />)}
        </ul>
        <Field label="Add a stage" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setAdding(false)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy || !name.trim()} onClick={async () => { const ok = await run(() => api('/api/admin/weddings/stages', { body: { name } }), 'Stage added.'); if (ok !== undefined) { setAdding(false); setName(''); void state.reload(); } }}>Add</Btn>
        </div>
      </Modal>
    </>
  );
}
