import { useMemo, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { shopTimezone, todayInShop } from '../../lib/format';
import { useSession } from '../session';
import { Badge, Btn, Card, Checkbox, Field, Input, Loader, Modal, PageHeader, Select, useAction, useLoad } from '../ui';
import { cn } from '../../lib/cn';

type Item = { id: string; source_id: string; kind: string; title: string; start: string; end: string; all_day: boolean; staff_id: string | null; status: string | null; link: string | null; movable: boolean; conflict: boolean; detail?: string | null };
type Summary = { date: string; orders: number; points: number; prep_minutes: number; stops: number; events: number; max_orders: number | null; max_points: number | null; closed: boolean; closure: string | null };
type Data = { items: Item[]; summaries: Summary[]; staff: Array<{ id: string; name: string }>; timezone: string };
type View = 'month' | 'week' | 'day';

const KINDS: Array<{ key: string; label: string; on: boolean; tone: string }> = [
  { key: 'event', label: 'Events', on: true, tone: 'bg-rose-deep text-ivory' },
  { key: 'setup', label: 'Setup', on: true, tone: 'bg-blush' },
  { key: 'teardown', label: 'Teardown', on: true, tone: 'bg-blush' },
  { key: 'consultation', label: 'Consultations', on: true, tone: 'bg-[#e4e8ee]' },
  { key: 'delivery', label: 'Deliveries', on: true, tone: 'bg-gold-soft/70' },
  { key: 'pickup', label: 'Pickups', on: true, tone: 'bg-gold-soft/40' },
  { key: 'task', label: 'Tasks', on: false, tone: 'bg-charcoal/8' },
  { key: 'rental_return', label: 'Rental returns', on: true, tone: 'bg-sage/15' },
  { key: 'time_off', label: 'Days off', on: true, tone: 'bg-charcoal/8' },
  { key: 'blackout', label: 'Closures', on: true, tone: 'bg-charcoal text-ivory' },
  { key: 'shift', label: 'Shifts', on: false, tone: 'bg-charcoal/5' },
  { key: 'store_hours', label: 'Shop hours', on: false, tone: 'bg-charcoal/5' },
  { key: 'custom', label: 'Other', on: true, tone: 'bg-ivory-deep' },
];
const toneOf = (kind: string) => KINDS.find((k) => k.key === kind)?.tone ?? 'bg-ivory-deep';

const toDate = (s: string) => new Date(`${s}T12:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const shift = (s: string, days: number) => {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
};
const startOfWeek = (s: string) => shift(s, -toDate(s).getUTCDay());
const monthDays = (s: string) => {
  const d = toDate(s);
  const first = fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12)));
  const last = fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)));
  const from = startOfWeek(first);
  const to = shift(startOfWeek(last), 6);
  return { from, to };
};
const today = todayInShop;

export default function CalendarPage() {
  const { can } = useSession();
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(today());
  const [staffId, setStaffId] = useState('');
  const [enabled, setEnabled] = useState(() => new Set(KINDS.filter((k) => k.on).map((k) => k.key)));
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [moving, setMoving] = useState<Item | null>(null);
  const [moveDate, setMoveDate] = useState('');
  const [adding, setAdding] = useState(false);
  const [entry, setEntry] = useState({ title: '', date: today(), start: '09:00', end: '10:00' });
  const { busy, run } = useAction();

  const range = useMemo(() => {
    if (view === 'day') return { from: anchor, to: anchor };
    if (view === 'week') return { from: startOfWeek(anchor), to: shift(startOfWeek(anchor), 6) };
    return monthDays(anchor);
  }, [view, anchor]);

  const query = new URLSearchParams({ from: range.from, to: range.to, kinds: [...enabled].join(',') });
  if (staffId) query.set('staff_id', staffId);
  const state = useLoad<Data>(`/api/admin/calendar?${query.toString()}`);
  const canMove = can('calendar.manage');

  const dateOf = (iso: string, tz: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
  const timeOf = (iso: string, tz: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });

  const move = async (item: Item, date: string) => {
    const kind = item.kind === 'setup' || item.kind === 'teardown' ? 'event' : item.kind;
    const ok = await run(() => api('/api/admin/calendar/move', { body: { kind, id: item.source_id, date } }), 'Moved.');
    setMoving(null);
    if (ok !== undefined) void state.reload();
  };

  const onDrop = (e: DragEvent, date: string, items: Item[]) => {
    e.preventDefault();
    setDragOver(null);
    const item = items.find((i) => i.id === e.dataTransfer.getData('text/calendar-item'));
    if (item) void move(item, date);
  };

  const step = (dir: number) => {
    if (view === 'day') setAnchor(shift(anchor, dir));
    else if (view === 'week') setAnchor(shift(anchor, dir * 7));
    else {
      const d = toDate(anchor);
      setAnchor(fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1, 12))));
    }
  };

  const title = view === 'month'
    ? toDate(anchor).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : view === 'week'
      ? `Week of ${toDate(range.from).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`
      : toDate(anchor).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

  const Chip = ({ item, tz, full, all }: { item: Item; tz: string; full?: boolean; all: Item[] }) => {
    void all;
    const canDrag = canMove && item.movable;
    const body = (
      <>
        {item.conflict && <span title="Needs attention" aria-label="Conflict" className="mr-1">⚠</span>}
        {!item.all_day && <span className="opacity-70">{timeOf(item.start, tz)} </span>}
        {item.title}
      </>
    );
    return (
      <div title={[item.title, item.detail].filter(Boolean).join(' · ')} draggable={canDrag} onDragStart={(e) => e.dataTransfer.setData('text/calendar-item', item.id)} className={cn('flex items-start justify-between gap-1 rounded px-1.5 py-0.5 text-[0.72rem] leading-snug', toneOf(item.kind), item.conflict && 'ring-1 ring-rose-deep', canDrag && 'cursor-grab')}>
        <div className={cn('min-w-0 flex-1', !full && 'truncate')}>
          {item.link ? <Link to={item.link} className="hover:underline">{body}</Link> : body}
          {full && item.detail && <p className="opacity-70">{item.detail}</p>}
        </div>
        {canDrag && full && <button type="button" aria-label={`Move ${item.title}`} className="shrink-0 underline" onClick={() => { setMoving(item); setMoveDate(dateOf(item.start, tz)); }}>Move</button>}
        {canMove && full && item.kind === 'custom' && <button type="button" aria-label={`Remove ${item.title}`} className="shrink-0 underline" onClick={async () => { const ok = await run(() => api(`/api/admin/calendar/entries/${item.source_id}`, { method: 'DELETE' }), 'Removed.'); if (ok !== undefined) void state.reload(); }}>Remove</button>}
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle={title}
        actions={
          <>
            <div className="flex rounded-lg border border-charcoal/20 bg-white" role="group" aria-label="View">
              {(['month', 'week', 'day'] as View[]).map((v) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn('h-10 px-3 text-[0.85rem] capitalize first:rounded-l-lg last:rounded-r-lg', view === v && 'bg-charcoal text-ivory')}>{v}</button>
              ))}
            </div>
            <Btn aria-label="Previous" onClick={() => step(-1)}>←</Btn>
            <Btn onClick={() => setAnchor(today())}>Today</Btn>
            <Btn aria-label="Next" onClick={() => step(1)}>→</Btn>
            {canMove && <Btn tone="primary" onClick={() => setAdding(true)}>Add</Btn>}
          </>
        }
      />
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {KINDS.map((k) => (
            <Checkbox key={k.key} label={k.label} checked={enabled.has(k.key)} onChange={(v) => { const next = new Set(enabled); if (v) next.add(k.key); else next.delete(k.key); setEnabled(next); }} />
          ))}
          <label className="ml-auto">
            <span className="sr-only">Team member</span>
            <Select className="h-9 py-0" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">Whole team</option>
              {state.data?.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </label>
        </div>
      </Card>
      <Loader state={state}>
        {(d) => {
          const byDate = new Map<string, Item[]>();
          for (const i of d.items) {
            // Multi-day items, like closures, appear on every day they cover.
            const first = dateOf(i.start, d.timezone);
            const last = i.all_day ? dateOf(new Date(new Date(i.end).getTime() - 1000).toISOString(), d.timezone) : first;
            for (let day = first; day <= last; day = shift(day, 1)) byDate.set(day, [...(byDate.get(day) ?? []), i]);
          }
          const days: string[] = [];
          for (let day = range.from; day <= range.to; day = shift(day, 1)) days.push(day);
          const todayStr = today();
          const summaryFor = (date: string) => d.summaries.find((s) => s.date === date);

          if (view === 'day') {
            const s = summaryFor(anchor);
            const items = byDate.get(anchor) ?? [];
            return (
              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2" title="Schedule">
                  {items.length === 0 && <p className="text-[0.88rem] text-charcoal/70">Nothing scheduled.</p>}
                  <div className="space-y-1.5">{items.map((i) => <Chip key={i.id} item={i} tz={d.timezone} full all={d.items} />)}</div>
                </Card>
                <Card title="Capacity">
                  {s?.closed && <p className="mb-2"><Badge tone="bad">Closed</Badge> {s.closure}</p>}
                  <dl className="space-y-1 text-[0.88rem]">
                    <div className="flex justify-between"><dt>Orders</dt><dd className="tabular-nums">{s?.orders ?? 0}{s?.max_orders !== null && s?.max_orders !== undefined ? ` of ${s.max_orders}` : ''}</dd></div>
                    <div className="flex justify-between"><dt>Workload points</dt><dd className="tabular-nums">{s?.points ?? 0}{s?.max_points !== null && s?.max_points !== undefined ? ` of ${s.max_points}` : ''}</dd></div>
                    <div className="flex justify-between"><dt>Estimated prep</dt><dd className="tabular-nums">{Math.round((s?.prep_minutes ?? 0) / 6) / 10} hours</dd></div>
                    <div className="flex justify-between"><dt>Delivery and pickup stops</dt><dd className="tabular-nums">{s?.stops ?? 0}</dd></div>
                    <div className="flex justify-between"><dt>Events</dt><dd className="tabular-nums">{s?.events ?? 0}</dd></div>
                  </dl>
                </Card>
              </div>
            );
          }

          return (
            <div className="overflow-x-auto rounded-xl border border-charcoal/10 bg-white">
              <div className="grid min-w-[46rem] grid-cols-7">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => (
                  <div key={w} className="border-b border-charcoal/10 px-2 py-1.5 text-[0.72rem] font-semibold tracking-wide text-charcoal/70 uppercase">{w}</div>
                ))}
                {days.map((date) => {
                  const items = byDate.get(date) ?? [];
                  const s = summaryFor(date);
                  const outside = view === 'month' && date.slice(5, 7) !== anchor.slice(5, 7);
                  const full = s && ((s.max_orders !== null && s.orders >= s.max_orders) || (s.max_points !== null && s.points >= s.max_points));
                  return (
                    <div
                      key={date}
                      onDragOver={(e) => { if (canMove) { e.preventDefault(); setDragOver(date); } }}
                      onDragLeave={() => setDragOver(null)}
                      onDrop={(e) => onDrop(e, date, d.items)}
                      className={cn('min-h-28 border-r border-b border-charcoal/8 p-1.5', outside && 'bg-charcoal/[0.02]', dragOver === date && 'bg-blush/50', s?.closed && 'bg-charcoal/[0.05]', view === 'week' && 'min-h-72')}
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <button type="button" onClick={() => { setAnchor(date); setView('day'); }} className={cn('grid h-6 min-w-6 place-items-center rounded-full px-1 text-[0.75rem] hover:bg-charcoal/10', date === todayStr && 'bg-charcoal text-ivory hover:bg-charcoal', outside && 'text-charcoal/70')} aria-label={`${Number(date.slice(8))}: open ${toDate(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}`}>
                          {Number(date.slice(8))}
                        </button>
                        {s && (s.orders > 0 || s.events > 0) && <span title={`${s.orders} orders, ${s.points} points, ${s.events} events`} className={cn('text-[0.65rem] text-charcoal/70 tabular-nums', full && 'font-semibold text-rose-deep')}>{s.orders}{s.max_orders !== null ? `/${s.max_orders}` : ''} orders</span>}
                      </div>
                      <div className="space-y-0.5">
                        {items.slice(0, view === 'week' ? 40 : 4).map((i) => <Chip key={i.id} item={i} tz={d.timezone} all={d.items} full={view === 'week'} />)}
                        {view === 'month' && items.length > 4 && (
                          <button type="button" className="text-[0.68rem] text-charcoal/70 underline" onClick={() => { setAnchor(date); setView('day'); }}>
                            {items.length - 4} more
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }}
      </Loader>
      <p className="mt-3 text-[0.78rem] text-charcoal/70">Drag an item to another day, or open a day and use Move. The same rules that protect customers check each move, and it is refused if the shop cannot do it.</p>

      <Modal title={`Move: ${moving?.title ?? ''}`} open={Boolean(moving)} onClose={() => setMoving(null)}>
        <Field label="New date" required><Input type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} /></Field>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setMoving(null)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy || !moveDate} onClick={() => moving && move(moving, moveDate)}>Move</Btn>
        </div>
      </Modal>
      <Modal title="Add to the calendar" open={adding} onClose={() => setAdding(false)}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Title" required className="sm:col-span-3"><Input value={entry.title} onChange={(e) => setEntry({ ...entry, title: e.target.value })} /></Field>
          <Field label="Date" required><Input type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} /></Field>
          <Field label="Starts"><Input type="time" value={entry.start} onChange={(e) => setEntry({ ...entry, start: e.target.value })} /></Field>
          <Field label="Ends"><Input type="time" value={entry.end} onChange={(e) => setEntry({ ...entry, end: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setAdding(false)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy || !entry.title.trim()} onClick={async () => {
            const tz = state.data?.timezone ?? shopTimezone();
            // Build the instant from wall-clock time in the business timezone, whatever timezone this browser is in.
            const toInstant = (date: string, time: string) => {
              const guess = new Date(`${date}T${time}:00Z`);
              const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess);
              const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
              const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
              return new Date(guess.getTime() - (shown - guess.getTime())).toISOString();
            };
            const ok = await run(() => api('/api/admin/calendar/entries', { body: { title: entry.title, starts_at: toInstant(entry.date, entry.start), ends_at: toInstant(entry.date, entry.end) } }), 'Added.');
            if (ok !== undefined) { setAdding(false); setEntry({ ...entry, title: '' }); void state.reload(); }
          }}>Add</Btn>
        </div>
      </Modal>
    </>
  );
}
