import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { dateLabel, money, timeLabel, todayInShop } from '../../lib/format';
import { useSession } from '../session';
import { Btn, Card, Checkbox, Field, Input, Loader, Modal, PageHeader, Select, StatusBadge, Textarea, useAction, useLoad } from '../ui';

type Route = { id: string; route_date: string; name: string | null; driver_staff_id: string | null; vehicle_id: string | null };
type Delivery = {
  id: string; status: string; driver_staff_id: string | null; vehicle_id: string | null; route_id: string | null; proof_note: string | null; failure_reason: string | null; scheduled_date: string | null; window_start: string | null; window_end: string | null; address: { line1?: string; line2?: string | null; city?: string; region?: string; postal_code?: string } | null; instructions: string | null; recipient_name: string | null; recipient_phone: string | null; order_id: string; reference: string; zone_name: string | null; driver_name: string | null; vehicle_name: string | null; items_text: string; item_ids: string[];
};
type Zone = { id: string; name: string; postal_codes: string[]; fee_cents: number; min_order_cents: number; travel_minutes: number | null; active: boolean; notes: string | null; sort_order: number };
type Window = { id: string; kind: string; zone_id: string | null; weekday: number; start_time: string; end_time: string; cutoff_minutes: number; max_stops: number | null; active: boolean };
type Setup = { zones: Zone[]; windows: Window[]; vehicles: Array<{ id: string; name: string; max_stops: number | null; active: boolean }>; routes: Route[]; drivers: Array<{ id: string; display_name: string }> };

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const today = todayInShop;

export default function Deliveries() {
  const { can } = useSession();
  const [date, setDate] = useState(today());
  const list = useLoad<{ deliveries: Delivery[] }>(`/api/admin/deliveries?date=${date}`);
  const setup = useLoad<Setup>('/api/admin/delivery-setup');
  const { busy, run } = useAction();
  const [zone, setZone] = useState<Partial<Zone> & { zips?: string; fee?: string; min?: string } | null>(null);
  const [windowForm, setWindowForm] = useState<{ id?: string; kind: string; zone_id: string; weekdays: number[]; start_time: string; end_time: string; cutoff_minutes: string; max_stops: string } | null>(null);
  const [failing, setFailing] = useState<Delivery | null>(null);
  const [proofing, setProofing] = useState<Delivery | null>(null);
  const [text, setText] = useState('');
  const [vehicleName, setVehicleName] = useState('');
  const [route, setRoute] = useState<{ name: string; driver_staff_id: string; vehicle_id: string } | null>(null);

  const manage = can('deliveries.manage');
  const dayRoutes = setup.data?.routes.filter((r) => r.route_date === date) ?? [];
  const settings = can('delivery.settings');
  const assign = async (d: Delivery, patch: Record<string, string | null>) => {
    const ok = await run(() => api(`/api/admin/deliveries/${d.id}/assign`, { body: { driver_staff_id: d.driver_staff_id, vehicle_id: d.vehicle_id, ...patch } }), 'Assigned.');
    if (ok !== undefined) void list.reload();
  };
  const setStatus = async (d: Delivery, status: string, extra: Record<string, unknown> = {}) => {
    const ok = await run(() => api(`/api/admin/orders/${d.order_id}/items/status`, { body: { item_ids: d.item_ids, status, ...extra } }), 'Updated, and the customer has been told.');
    if (ok !== undefined) void list.reload();
  };

  return (
    <>
      <PageHeader
        title="Deliveries"
        subtitle="Progress here is recorded by staff. There is no live GPS tracking."
        actions={<label><span className="sr-only">Date</span><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>}
      />
      <Card title={dateLabel(date)} actions={manage && <Btn small onClick={() => setRoute({ name: `Run ${dayRoutes.length + 1}`, driver_staff_id: '', vehicle_id: '' })}>New route</Btn>}>
        <Loader state={list}>
          {(d) =>
            d.deliveries.length === 0 ? (
              <p className="py-6 text-center text-[0.88rem] text-charcoal/70">No deliveries on this date.</p>
            ) : (
              <ul className="divide-y divide-charcoal/8">
                {d.deliveries.map((x) => (
                  <li key={x.id} className="py-3" data-testid="delivery-row">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 text-[0.88rem]">
                        <p className="font-medium"><Link className="hover:underline" to={`/admin/orders/${x.order_id}`}>{x.reference}</Link>{x.window_start && x.window_end && <span className="font-normal text-charcoal/70"> · {timeLabel(x.window_start)} – {timeLabel(x.window_end)}</span>}{x.zone_name && <span className="font-normal text-charcoal/70"> · {x.zone_name}</span>}</p>
                        <p>{x.items_text}</p>
                        {x.address && <p className="text-charcoal/70">{x.recipient_name && `${x.recipient_name}, `}{[x.address.line1, x.address.line2, x.address.city, x.address.postal_code].filter(Boolean).join(', ')}</p>}
                        {x.recipient_phone && <p><a className="underline" href={`tel:${x.recipient_phone}`}>{x.recipient_phone}</a></p>}
                        {x.instructions && <p className="text-charcoal/70">Note: {x.instructions}</p>}
                        {x.failure_reason && <p className="text-rose-deep">Failed: {x.failure_reason}</p>}
                        {x.proof_note && <p className="text-charcoal/70">Proof: {x.proof_note}</p>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={x.status} />
                        {manage && (
                          <label>
                            <span className="sr-only">Driver for {x.reference}</span>
                            <Select className="h-8 w-36 py-0 text-[0.78rem]" disabled={busy} value={x.driver_staff_id ?? ''} onChange={(e) => assign(x, { driver_staff_id: e.target.value || null })}>
                              <option value="">No driver</option>
                              {setup.data?.drivers.map((dr) => <option key={dr.id} value={dr.id}>{dr.display_name}</option>)}
                            </Select>
                          </label>
                        )}
                        {manage && Boolean(setup.data?.vehicles.length) && (
                          <label>
                            <span className="sr-only">Vehicle for {x.reference}</span>
                            <Select className="h-8 w-32 py-0 text-[0.78rem]" disabled={busy} value={x.vehicle_id ?? ''} onChange={(e) => assign(x, { vehicle_id: e.target.value || null })}>
                              <option value="">No vehicle</option>
                              {setup.data?.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                            </Select>
                          </label>
                        )}
                        {manage && dayRoutes.length > 0 && (
                          <label>
                            <span className="sr-only">Route for {x.reference}</span>
                            <Select className="h-8 w-32 py-0 text-[0.78rem]" disabled={busy} value={x.route_id ?? ''} onChange={(e) => assign(x, { route_id: e.target.value || null })}>
                              <option value="">No route</option>
                              {dayRoutes.map((r) => <option key={r.id} value={r.id}>{r.name ?? 'Route'}</option>)}
                            </Select>
                          </label>
                        )}
                        {manage && ['scheduled', 'assigned', 'rescheduled'].includes(x.status) && <Btn small disabled={busy} onClick={() => setStatus(x, 'out_for_delivery')}>Out for delivery</Btn>}
                        {manage && x.status === 'out_for_delivery' && <Btn small tone="primary" disabled={busy} onClick={() => setStatus(x, 'fulfilled')}>Delivered</Btn>}
                        {manage && x.status === 'out_for_delivery' && <Btn small onClick={() => { setFailing(x); setText(''); }}>Failed</Btn>}
                        {manage && x.status === 'failed' && <Btn small disabled={busy} onClick={async () => { await run(() => api(`/api/admin/deliveries/${x.id}/retry`, { body: {} })); await setStatus(x, 'out_for_delivery'); }}>Try again</Btn>}
                        {manage && !x.proof_note && ['out_for_delivery', 'delivered'].includes(x.status) && <Btn small onClick={() => { setProofing(x); setText(''); }}>Add proof</Btn>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )
          }
        </Loader>
      </Card>

      <Loader state={setup}>
        {(s) => (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="Delivery zones" actions={settings && <Btn small onClick={() => setZone({ active: true, zips: '', fee: '', min: '0' })}>Add zone</Btn>}>
              {s.zones.length === 0 && <p className="text-[0.85rem] text-charcoal/70">No zones yet. Delivery is unavailable until you add one.</p>}
              <ul className="divide-y divide-charcoal/8 text-[0.85rem]">
                {s.zones.map((z) => (
                  <li key={z.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <p className="font-medium">{z.name}{!z.active && ' (off)'}</p>
                      <p className="text-[0.75rem] text-charcoal/70">{money(z.fee_cents)} fee · {money(z.min_order_cents)} minimum · {z.postal_codes.join(', ')}</p>
                    </div>
                    {settings && <Btn small onClick={() => setZone({ ...z, zips: z.postal_codes.join(', '), fee: (z.fee_cents / 100).toFixed(2), min: (z.min_order_cents / 100).toFixed(2) })}>Edit</Btn>}
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Pickup and delivery windows" actions={settings && <Btn small onClick={() => setWindowForm({ kind: 'pickup', zone_id: '', weekdays: [], start_time: '10:00', end_time: '17:00', cutoff_minutes: '0', max_stops: '' })}>Add windows</Btn>}>
              {s.windows.filter((w) => w.active).length === 0 && <p className="text-[0.85rem] text-charcoal/70">No windows yet. Nothing can be ordered online until you add some.</p>}
              <ul className="max-h-80 divide-y divide-charcoal/8 overflow-y-auto text-[0.82rem]">
                {s.windows.filter((w) => w.active).map((w) => (
                  <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span className="capitalize">{w.kind}</span>
                    <span>{WEEKDAYS[w.weekday]} {w.start_time.slice(0, 5)}–{w.end_time.slice(0, 5)}</span>
                    <span className="text-charcoal/70">{w.max_stops !== null ? `${w.max_stops} max` : 'no limit'}, {w.cutoff_minutes} min cutoff</span>
                    {settings && <Btn small tone="ghost" disabled={busy} onClick={async () => { await run(() => api(`/api/admin/windows/${w.id}`, { method: 'DELETE' })); void setup.reload(); }}>Remove</Btn>}
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Vehicles">
              <ul className="mb-2 text-[0.85rem]">
                {s.vehicles.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-0.5">
                    <span>{v.name}{!v.active && ' (retired)'}</span>
                    {settings && <Btn small tone="ghost" disabled={busy} onClick={async () => { const ok = await run(() => api(`/api/admin/vehicles/${v.id}`, { method: 'PUT', body: { name: v.name, max_stops: v.max_stops, active: !v.active } })); if (ok !== undefined) void setup.reload(); }}>{v.active ? 'Retire' : 'Bring back'}</Btn>}
                  </li>
                ))}
              </ul>
              {settings && (
                <div className="flex gap-2">
                  <label className="flex-1"><span className="sr-only">Vehicle name</span><Input placeholder="Vehicle name" value={vehicleName} onChange={(e) => setVehicleName(e.target.value)} /></label>
                  <Btn disabled={busy || !vehicleName.trim()} onClick={async () => { const ok = await run(() => api('/api/admin/vehicles', { body: { name: vehicleName } }), 'Added.'); if (ok !== undefined) { setVehicleName(''); void setup.reload(); } }}>Add</Btn>
                </div>
              )}
            </Card>
          </div>
        )}
      </Loader>

      <Modal title={zone?.id ? 'Edit zone' : 'Add a delivery zone'} open={Boolean(zone)} onClose={() => setZone(null)}>
        {zone && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required className="sm:col-span-2"><Input value={zone.name ?? ''} onChange={(e) => setZone({ ...zone, name: e.target.value })} /></Field>
            <Field label="ZIP codes" required hint="Separate with commas." className="sm:col-span-2"><Textarea value={zone.zips ?? ''} onChange={(e) => setZone({ ...zone, zips: e.target.value })} /></Field>
            <Field label="Delivery fee, in dollars" required><Input inputMode="decimal" value={zone.fee ?? ''} onChange={(e) => setZone({ ...zone, fee: e.target.value })} /></Field>
            <Field label="Minimum order, in dollars"><Input inputMode="decimal" value={zone.min ?? ''} onChange={(e) => setZone({ ...zone, min: e.target.value })} /></Field>
            <Field label="Travel minutes" hint="Added to preparation lead time."><Input inputMode="numeric" value={zone.travel_minutes ?? ''} onChange={(e) => setZone({ ...zone, travel_minutes: e.target.value ? Number(e.target.value) : null })} /></Field>
            <div className="self-end pb-2"><Checkbox label="Active" checked={zone.active ?? true} onChange={(v) => setZone({ ...zone, active: v })} /></div>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setZone(null)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy || !zone?.name?.trim() || zone.fee === ''} onClick={async () => {
            if (!zone) return;
            const body = { name: zone.name, postal_codes: (zone.zips ?? '').split(/[\s,]+/).filter(Boolean), fee_cents: Math.round(Number(zone.fee) * 100), min_order_cents: Math.round(Number(zone.min || 0) * 100), travel_minutes: zone.travel_minutes ?? null, active: zone.active ?? true };
            const ok = await run(() => (zone.id ? api(`/api/admin/zones/${zone.id}`, { method: 'PUT', body }) : api('/api/admin/zones', { body })), 'Saved.');
            if (ok !== undefined) { setZone(null); void setup.reload(); }
          }}>Save</Btn>
        </div>
      </Modal>
      <Modal title="Add pickup or delivery windows" open={Boolean(windowForm)} onClose={() => setWindowForm(null)}>
        {windowForm && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type"><Select value={windowForm.kind} onChange={(e) => setWindowForm({ ...windowForm, kind: e.target.value })}><option value="pickup">Pickup</option><option value="delivery">Delivery</option></Select></Field>
            {windowForm.kind === 'delivery' && <Field label="Zone" hint="Blank means every zone."><Select value={windowForm.zone_id} onChange={(e) => setWindowForm({ ...windowForm, zone_id: e.target.value })}><option value="">All zones</option>{setup.data?.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</Select></Field>}
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-[0.8rem] font-medium">Days</legend>
              <div className="flex flex-wrap gap-3">
                {WEEKDAYS.map((w, i) => <Checkbox key={w} label={w.slice(0, 3)} checked={windowForm.weekdays.includes(i)} onChange={(v) => setWindowForm({ ...windowForm, weekdays: v ? [...windowForm.weekdays, i] : windowForm.weekdays.filter((x) => x !== i) })} />)}
              </div>
            </fieldset>
            <Field label="Starts" required><Input type="time" value={windowForm.start_time} onChange={(e) => setWindowForm({ ...windowForm, start_time: e.target.value })} /></Field>
            <Field label="Ends" required><Input type="time" value={windowForm.end_time} onChange={(e) => setWindowForm({ ...windowForm, end_time: e.target.value })} /></Field>
            <Field label="Stop taking orders this many minutes before"><Input inputMode="numeric" value={windowForm.cutoff_minutes} onChange={(e) => setWindowForm({ ...windowForm, cutoff_minutes: e.target.value })} /></Field>
            <Field label="Maximum orders in this window" hint="Blank means the shop confirms by hand."><Input inputMode="numeric" value={windowForm.max_stops} onChange={(e) => setWindowForm({ ...windowForm, max_stops: e.target.value })} /></Field>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setWindowForm(null)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy || !windowForm?.weekdays.length} onClick={async () => {
            if (!windowForm) return;
            const ok = await run(async () => {
              for (const weekday of windowForm.weekdays) {
                await api('/api/admin/windows', { body: { kind: windowForm.kind, zone_id: windowForm.zone_id || null, weekday, start_time: windowForm.start_time, end_time: windowForm.end_time, cutoff_minutes: Number(windowForm.cutoff_minutes) || 0, max_stops: windowForm.max_stops ? Number(windowForm.max_stops) : null } });
              }
              return true;
            }, 'Windows added.');
            if (ok) { setWindowForm(null); void setup.reload(); }
          }}>Add</Btn>
        </div>
      </Modal>
      <Modal title={`New route for ${dateLabel(date)}`} open={Boolean(route)} onClose={() => setRoute(null)}>
        {route && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name" required><Input value={route.name} onChange={(e) => setRoute({ ...route, name: e.target.value })} /></Field>
            <Field label="Driver"><Select value={route.driver_staff_id} onChange={(e) => setRoute({ ...route, driver_staff_id: e.target.value })}><option value="">Not yet</option>{setup.data?.drivers.map((d) => <option key={d.id} value={d.id}>{d.display_name}</option>)}</Select></Field>
            <Field label="Vehicle"><Select value={route.vehicle_id} onChange={(e) => setRoute({ ...route, vehicle_id: e.target.value })}><option value="">Not yet</option>{setup.data?.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></Field>
          </div>
        )}
        <p className="mt-3 text-[0.8rem] text-charcoal/70">Then choose this route on each delivery. The order of stops is yours to decide, because route optimization is not built in.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setRoute(null)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy || !route?.name.trim()} onClick={async () => { if (!route) return; const ok = await run(() => api('/api/admin/routes', { body: { route_date: date, name: route.name, driver_staff_id: route.driver_staff_id || null, vehicle_id: route.vehicle_id || null } }), 'Route added.'); if (ok !== undefined) { setRoute(null); void setup.reload(); } }}>Add route</Btn>
        </div>
      </Modal>
      <Modal title="What went wrong?" open={Boolean(failing)} onClose={() => setFailing(null)}>
        <Field label="Reason" required hint="Sent to the customer."><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setFailing(null)}>Cancel</Btn>
          <Btn tone="danger" disabled={busy || !text.trim()} onClick={async () => { if (failing) await setStatus(failing, 'delivery_failed', { reason: text }); setFailing(null); }}>Record failed delivery</Btn>
        </div>
      </Modal>
      <Modal title="Proof of delivery" open={Boolean(proofing)} onClose={() => setProofing(null)}>
        <Field label="Note" required hint="Such as who received it, or where it was left."><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setProofing(null)}>Cancel</Btn>
          <Btn tone="primary" disabled={busy || !text.trim()} onClick={async () => { if (!proofing) return; const ok = await run(() => api(`/api/admin/deliveries/${proofing.id}/proof`, { body: { note: text } }), 'Saved.'); if (ok !== undefined) { setProofing(null); void list.reload(); } }}>Save</Btn>
        </div>
      </Modal>
    </>
  );
}
