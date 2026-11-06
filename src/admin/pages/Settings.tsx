import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../../lib/api';
import { useSession } from '../session';
import { Badge, Btn, Card, Checkbox, Field, Input, Loader, PageHeader, Select, Textarea, useAction, useLoad } from '../ui';
import { cn } from '../../lib/cn';

type FieldSpec = { key: string; label: string; type: 'bool' | 'number' | 'nullable_number' | 'text' | 'nullable_text' | 'time' | 'nullable_time' | 'textarea' | 'money' | 'list' | 'select' | 'rates' | 'routes'; hint?: string; options?: Array<{ value: string; label: string }> };

const GROUPS: Array<{ key: string; label: string; intro?: string; needsApproval?: boolean; fields: FieldSpec[] }> = [
  {
    key: 'ordering', label: 'Ordering', needsApproval: true, intro: 'Until you approve these, every order waits for you to review it.',
    fields: [
      { key: 'same_day_enabled', label: 'Allow same-day orders', type: 'bool' },
      { key: 'same_day_cutoff', label: 'Same-day cutoff', type: 'nullable_time', hint: 'Orders after this time cannot be same-day.' },
      { key: 'min_lead_hours', label: 'Minimum notice for every order, in hours', type: 'number' },
      { key: 'daily_order_limit', label: 'Most orders in a day', type: 'nullable_number', hint: 'Blank means no limit is set, and orders go to review.' },
      { key: 'daily_points_limit', label: 'Most workload points in a day', type: 'nullable_number', hint: 'A big piece takes more points than a small bouquet.' },
      { key: 'custom_requires_approval', label: 'Custom orders need approval', type: 'bool' },
      { key: 'out_of_stock_behavior', label: 'When something is out of stock', type: 'select', options: [{ value: 'reject', label: 'Stop the sale' }, { value: 'review', label: 'Send for review' }, { value: 'backorder', label: 'Allow backorder' }] },
      { key: 'review_timing', label: 'For orders needing review', type: 'select', options: [{ value: 'approve_first', label: 'Approve first, then ask for payment' }, { value: 'pay_first', label: 'Take payment first, refund if declined' }] },
      { key: 'review_hold_hours', label: 'Hold stock during review for, in hours', type: 'number' },
      { key: 'slot_horizon_days', label: 'How many days ahead customers can order', type: 'number' },
      { key: 'complete_after_hours', label: 'Mark orders complete this many hours after fulfilment', type: 'number' },
      { key: 'overdue_after_minutes', label: 'Alert when an order is this many minutes late', type: 'number' },
    ],
  },
  {
    key: 'delivery', label: 'Delivery & shipping', needsApproval: true,
    fields: [
      { key: 'buffer_minutes', label: 'Have delivery orders ready this many minutes before the window', type: 'number' },
      { key: 'max_stops_per_driver_window', label: 'Most stops per driver per window', type: 'nullable_number' },
      { key: 'require_driver_on_duty', label: 'Only offer delivery when a driver is scheduled', type: 'bool' },
      { key: 'proof_of_delivery_required', label: 'Require proof of delivery', type: 'bool' },
      { key: 'public_policy', label: 'Delivery policy shown to customers', type: 'textarea' },
      { key: 'shipping_enabled', label: 'Offer shipping', type: 'bool' },
      { key: 'shipping_flat_cents', label: 'Flat shipping charge, in dollars', type: 'money' },
      { key: 'shipping_free_over_cents', label: 'Free shipping over, in dollars', type: 'money' },
      { key: 'shipping_allowed_states', label: 'States you ship to', type: 'list', hint: 'Two-letter codes, separated by commas. Selling into another state can create tax duties, so ask your accountant.' },
    ],
  },
  {
    key: 'tax', label: 'Sales tax', needsApproval: true, intro: 'Checkout stays closed until a rate is set. Please confirm rates with your accountant.',
    fields: [
      { key: 'label', label: 'Name shown to customers', type: 'text' },
      { key: 'rates_bps', label: 'Rates', type: 'rates', hint: 'One per line, as category = percent. Use "exempt = 0" for anything not taxed. Every product must use a listed category.' },
      { key: 'delivery_taxable', label: 'Charge tax on delivery fees', type: 'bool' },
      { key: 'shipping_taxable', label: 'Charge tax on shipping', type: 'bool' },
      { key: 'notes', label: 'Notes for your records', type: 'nullable_text' },
    ],
  },
  {
    key: 'refunds', label: 'Refunds', needsApproval: true,
    fields: [
      { key: 'policy_text', label: 'Refund policy shown at checkout', type: 'textarea' },
      { key: 'staff_limit_cents', label: 'Non-owners can refund up to, in dollars', type: 'money', hint: 'Blank means no limit beyond the refund permission.' },
    ],
  },
  {
    key: 'events', label: 'Weddings & events', needsApproval: false,
    fields: [
      { key: 'min_notice_days', label: 'Minimum notice for events, in days', type: 'number' },
      { key: 'max_events_per_day', label: 'Most events in a day', type: 'nullable_number', hint: 'Blank means the team reviews every date.' },
      { key: 'default_start_time', label: 'Assumed start when no time is given', type: 'time' },
      { key: 'default_event_hours', label: 'Assumed event length, in hours', type: 'number' },
      { key: 'setup_minutes', label: 'Setup time, in minutes', type: 'number' },
      { key: 'teardown_minutes', label: 'Teardown time, in minutes', type: 'number' },
      { key: 'travel_minutes', label: 'Travel each way, in minutes', type: 'number' },
      { key: 'buffer_minutes', label: 'Crew break after an event, in minutes', type: 'number' },
      { key: 'prep_days', label: 'Days needed to prepare before an event', type: 'number' },
      { key: 'crews_per_event', label: 'Crews needed per event', type: 'number' },
      { key: 'staff_per_crew', label: 'People per crew', type: 'nullable_number' },
      { key: 'deposit_percent', label: 'Usual deposit, in percent', type: 'nullable_number', hint: 'Used for the planner estimate. You set the real deposit on each quote.' },
      { key: 'balance_due_days_before', label: 'Balance due this many days before the event', type: 'number' },
      { key: 'quote_valid_days', label: 'Quotes are valid for, in days', type: 'number' },
      { key: 'hold_days_after_acceptance', label: 'Hold the date after a quote is accepted, in days', type: 'number' },
      { key: 'follow_up_hours', label: 'Remind the team about an unworked inquiry after, in hours', type: 'number' },
      { key: 'requires_contract', label: 'Require a signed contract by default', type: 'bool' },
      { key: 'cancellation_policy', label: 'Cancellation policy', type: 'textarea', hint: 'Shown with every quote. Please have a lawyer review it.' },
      { key: 'event_types', label: 'Event types offered', type: 'list' },
      { key: 'budget_ranges', label: 'Budget ranges offered', type: 'list' },
      { key: 'style_options', label: 'Style choices offered', type: 'list' },
    ],
  },
  {
    key: 'consultations', label: 'Consultations',
    fields: [
      { key: 'enabled', label: 'Let customers book consultations online', type: 'bool' },
      { key: 'duration_minutes', label: 'Length, in minutes', type: 'number' },
      { key: 'buffer_minutes', label: 'Gap between consultations, in minutes', type: 'number' },
      { key: 'min_notice_hours', label: 'Minimum notice, in hours', type: 'number' },
      { key: 'horizon_days', label: 'How far ahead customers can book, in days', type: 'number' },
      { key: 'step_minutes', label: 'Offer a start time every, in minutes', type: 'number' },
      { key: 'reminder_hours_before', label: 'Send a reminder this many hours before', type: 'number' },
      { key: 'formats', label: 'Ways to meet', type: 'list' },
    ],
  },
  {
    key: 'contact', label: 'Contact details',
    fields: [
      { key: 'business_name', label: 'Business name', type: 'text' },
      { key: 'phone_e164', label: 'Phone, as +19895550100', type: 'nullable_text' },
      { key: 'public_email', label: 'Public email', type: 'nullable_text' },
      { key: 'address_line', label: 'Address', type: 'nullable_text' },
      { key: 'facebook_url', label: 'Facebook page', type: 'nullable_text' },
      { key: 'hours_note', label: 'Note about hours', type: 'nullable_text' },
    ],
  },
  {
    key: 'general', label: 'Shop',
    fields: [
      { key: 'shop_open', label: 'The online shop is open', type: 'bool' },
      { key: 'guest_checkout_enabled', label: 'Allow checkout without an account', type: 'bool' },
      { key: 'timezone', label: 'Timezone', type: 'text', hint: 'For example America/Detroit.' },
      { key: 'notice_banner', label: 'Notice shown in the shop', type: 'nullable_text' },
    ],
  },
  {
    key: 'notifications', label: 'Staff alerts & quiet hours',
    fields: [
      { key: 'from_name', label: 'Name shown on emails', type: 'text' },
      { key: 'staff_inbox', label: 'Also send staff alerts to this inbox', type: 'nullable_text' },
      { key: 'quiet_start', label: 'Hold texts after', type: 'time' },
      { key: 'quiet_end', label: 'Hold texts until', type: 'time' },
    ],
  },
  {
    key: 'sms', label: 'Text messages', intro: 'Texts only go to customers who opted in, and only for messages listed here. Turning these on also requires completed A2P 10DLC registration with Twilio.',
    fields: [
      { key: 'enabled_templates', label: 'Messages sent by text', type: 'list', hint: 'Template codes, such as order_confirmation, order_ready_pickup, consultation_reminder.' },
      { key: 'sender_label', label: 'Sender name', type: 'text' },
      { key: 'help_reply', label: 'Reply to HELP', type: 'textarea' },
      { key: 'stop_reply', label: 'Reply to STOP', type: 'textarea' },
      { key: 'start_reply', label: 'Reply to START', type: 'textarea' },
      { key: 'consent_text_transactional', label: 'Wording for order text consent', type: 'textarea' },
      { key: 'consent_text_marketing', label: 'Wording for promotional text consent', type: 'textarea' },
    ],
  },
  {
    key: 'concierge', label: 'Flora', intro: 'Flora, the AI concierge on the website and the phone. She stays off until a channel is switched on and a monthly limit is set. Costs are estimates: the providers bill the real amounts.',
    fields: [
      { key: 'chat_enabled', label: 'Answer website chats', type: 'bool' },
      { key: 'voice_enabled', label: 'Answer the phone line', type: 'bool', hint: 'The phone number and its credentials are set up by your developer. See the System page for whether the line is configured.' },
      { key: 'chat_mode', label: 'The website chat works with', type: 'select', options: [{ value: 'demo', label: 'The demonstration sandbox (fictional data only)' }, { value: 'customer', label: 'The real business' }] },
      { key: 'voice_mode', label: 'The phone line works with', type: 'select', options: [{ value: 'demo', label: 'The demonstration sandbox (fictional data only)' }, { value: 'customer', label: 'The real business' }] },
      { key: 'monthly_budget_cents', label: 'Monthly spending limit, in dollars', type: 'money', hint: 'Once the estimated spend reaches this, Flora stops taking new chats and calls until next month.' },
      { key: 'assistant_name', label: 'Name', type: 'text' },
      { key: 'assistant_title', label: 'Title', type: 'text' },
      { key: 'chat_greeting', label: 'Chat greeting', type: 'textarea', hint: 'Keep saying that Flora is an automated assistant.' },
      { key: 'voice_greeting', label: 'Phone greeting', type: 'textarea', hint: 'Keep saying that Flora is automated and that calls are transcribed.' },
      { key: 'max_call_minutes', label: 'Longest call, in minutes', type: 'number' },
      { key: 'max_calls_per_number_per_day', label: 'Calls a number can make per day', type: 'number' },
      { key: 'max_concurrent_calls', label: 'Calls at the same time', type: 'number' },
      { key: 'max_messages_per_chat', label: 'Messages per chat', type: 'number' },
      { key: 'max_chats_per_visitor_per_hour', label: 'New chats per visitor per hour', type: 'number' },
      { key: 'texts_per_conversation', label: 'Texts Flora may send per call', type: 'number', hint: 'Only to the caller, only after they agree, and only once texting is registered.' },
      { key: 'store_transcripts', label: 'Keep transcripts of what people said', type: 'bool' },
      { key: 'transcript_retention_days', label: 'Delete transcripts after, in days', type: 'number' },
      { key: 'routing', label: 'Who hears about requests', type: 'routes', hint: 'One per line, as kind = roles. Kinds: wedding, order, delivery, general, complaint. Routine questions Flora can answer reach nobody.' },
      { key: 'escalate_urgent_minutes', label: 'Escalate an unacknowledged urgent request after, in minutes', type: 'number' },
      { key: 'escalate_high_minutes', label: 'Escalate an unacknowledged time-sensitive request after, in minutes', type: 'number' },
      { key: 'escalation_roles', label: 'Escalate to these roles', type: 'list' },
      { key: 'chat_model', label: 'Chat model', type: 'text' },
      { key: 'voice_model', label: 'Phone model', type: 'text' },
      { key: 'voice', label: 'Phone voice', type: 'text' },
      { key: 'transcription_model', label: 'Transcription model', type: 'text' },
    ],
  },
  {
    key: 'followups', label: 'Follow-ups',
    fields: [
      { key: 'enabled', label: 'Send a thank-you note after orders', type: 'bool', hint: 'Only to customers who opted in to marketing email. Also switch on the rule under Messages & rules.' },
      { key: 'days_after_fulfillment', label: 'Days after fulfilment', type: 'number' },
      { key: 'abandoned_cart_enabled', label: 'Remind people about abandoned checkouts', type: 'bool', hint: 'Only to customers who opted in to marketing email.' },
      { key: 'abandoned_cart_hours', label: 'Hours after they stopped', type: 'number' },
    ],
  },
  {
    key: 'privacy', label: 'Privacy & terms', intro: 'These pages are required before accepting real customers. Please have them reviewed by a lawyer.',
    fields: [
      { key: 'policy_text', label: 'Privacy policy', type: 'textarea' },
      { key: 'terms_text', label: 'Terms of sale', type: 'textarea' },
      { key: 'retain_abandoned_cart_days', label: 'Delete abandoned carts after, in days', type: 'number' },
      { key: 'retain_draft_upload_days', label: 'Delete unsent planner photos after, in days', type: 'number' },
      { key: 'retain_notification_body_days', label: 'Delete message contents after, in days', type: 'number' },
    ],
  },
];

type Values = Record<string, Record<string, unknown>> & { approved: Record<string, boolean>; integration_status: Record<string, unknown> };

const toForm = (spec: FieldSpec, v: unknown): string | boolean => {
  switch (spec.type) {
    case 'bool': return Boolean(v);
    case 'money': return v === null || v === undefined ? '' : ((v as number) / 100).toFixed(2);
    case 'list': return Array.isArray(v) ? v.join(', ') : '';
    case 'rates': return Object.entries((v as Record<string, number>) ?? {}).map(([k, bps]) => `${k} = ${bps / 100}`).join('\n');
    case 'routes': return Object.entries((v as Record<string, string[]>) ?? {}).map(([k, roles]) => `${k} = ${roles.join(', ')}`).join('\n');
    default: return v === null || v === undefined ? '' : String(v);
  }
};

const fromForm = (spec: FieldSpec, v: string | boolean): unknown => {
  const s = typeof v === 'string' ? v.trim() : v;
  switch (spec.type) {
    case 'bool': return Boolean(v);
    case 'number': return Number(s);
    case 'nullable_number': return s === '' ? null : Number(s);
    case 'money': return s === '' ? null : Math.round(Number(s) * 100);
    case 'nullable_text': case 'nullable_time': case 'textarea': return s === '' ? null : s;
    case 'list': return String(s).split(',').map((x) => x.trim()).filter(Boolean);
    case 'rates': return Object.fromEntries(String(s).split('\n').map((l) => l.split('=').map((x) => x.trim())).filter((p) => p.length === 2 && p[0]).map(([k, val]) => [k, Math.round(Number(val) * 100)]));
    case 'routes': return Object.fromEntries(String(s).split('\n').map((l) => l.split('=').map((x) => x.trim())).filter((p) => p.length === 2 && p[0]).map(([k, roles]) => [k, roles.split(',').map((r) => r.trim()).filter(Boolean)]));
    default: return s;
  }
};

function GroupForm({ group, values, approved, onSaved }: { group: (typeof GROUPS)[number]; values: Record<string, unknown>; approved: boolean; onSaved: () => void }) {
  const { user } = useSession();
  const { busy, run } = useAction();
  // Starts filled in, so a save can never send blanks for fields that had not loaded yet.
  const fromValues = () => Object.fromEntries(group.fields.map((f) => [f.key, toForm(f, values[f.key])]));
  const [form, setForm] = useState<Record<string, string | boolean>>(fromValues);
  const [warnings, setWarnings] = useState<string[]>([]);
  const field = (key: string, value: string | boolean) => setForm((s) => ({ ...s, [key]: value }));
  useEffect(() => {
    setForm(fromValues());
    // Reloaded values replace the form. The component is keyed by group, so the group never changes here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);
  const save = async () => {
    const body = Object.fromEntries(group.fields.map((f) => [f.key, fromForm(f, form[f.key] ?? '')]));
    const res = await run(() => api<{ warnings: string[] }>(`/api/admin/settings/${group.key}`, { method: 'PUT', body }), 'Saved.');
    if (res) {
      setWarnings(res.warnings);
      onSaved();
    }
  };
  const isOwner = user?.roles.includes('owner');
  return (
    <Card title={group.label} actions={group.needsApproval && (approved ? <Badge tone="good">approved</Badge> : <Badge tone="warn">not approved</Badge>)}>
      {group.intro && <p className="mb-4 text-[0.85rem] text-charcoal/70">{group.intro}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {group.fields.map((f) => {
          const value = form[f.key];
          if (f.type === 'bool') return <div key={f.key} className="sm:col-span-2"><Checkbox label={f.label} hint={f.hint} checked={Boolean(value)} onChange={(v) => field(f.key, v)} /></div>;
          if (f.type === 'select') return <Field key={f.key} label={f.label} hint={f.hint}><Select value={String(value ?? '')} onChange={(e) => field(f.key, e.target.value)}>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>;
          if (f.type === 'textarea' || f.type === 'rates' || f.type === 'routes') return <Field key={f.key} label={f.label} hint={f.hint} className="sm:col-span-2"><Textarea rows={f.key.endsWith('text') || f.key === 'cancellation_policy' ? 8 : 3} value={String(value ?? '')} onChange={(e) => field(f.key, e.target.value)} /></Field>;
          if (f.type === 'list') return <Field key={f.key} label={f.label} hint={f.hint ?? 'Separate with commas.'} className="sm:col-span-2"><Input value={String(value ?? '')} onChange={(e) => field(f.key, e.target.value)} /></Field>;
          const isTime = f.type === 'time' || f.type === 'nullable_time';
          const numeric = f.type === 'number' || f.type === 'nullable_number';
          return <Field key={f.key} label={f.label} hint={f.hint}><Input type={isTime ? 'time' : 'text'} inputMode={numeric ? 'numeric' : f.type === 'money' ? 'decimal' : undefined} value={String(value ?? '')} onChange={(e) => field(f.key, e.target.value)} /></Field>;
        })}
      </div>
      {warnings.map((w) => <p key={w} role="alert" className="mt-3 rounded-lg border border-gold/60 bg-gold-soft/30 p-2 text-[0.85rem]">{w}</p>)}
      <div className="mt-4 flex flex-wrap gap-2">
        <Btn tone="primary" disabled={busy} onClick={save}>Save</Btn>
        {group.needsApproval && isOwner && (
          <Btn disabled={busy} onClick={async () => { const ok = await run(() => api(`/api/admin/settings/${group.key}/approval`, { body: { approved: !approved } }), approved ? 'Approval removed.' : 'Approved.'); if (ok !== undefined) onSaved(); }}>
            {approved ? 'Remove approval' : 'I approve these rules'}
          </Btn>
        )}
      </div>
    </Card>
  );
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function Hours() {
  const state = useLoad<{ hours: Array<{ weekday: number; opens_at: string | null; closes_at: string | null; closed: boolean }> }>('/api/admin/hours');
  const { busy, run } = useAction();
  const [days, setDays] = useState(WEEKDAYS.map((_, weekday) => ({ weekday, closed: true, opens_at: '10:00', closes_at: '17:00' })));
  useEffect(() => {
    if (state.data?.hours.length) {
      setDays(WEEKDAYS.map((_, weekday) => {
        const row = state.data?.hours.find((h) => h.weekday === weekday);
        return { weekday, closed: row?.closed ?? true, opens_at: row?.opens_at?.slice(0, 5) ?? '10:00', closes_at: row?.closes_at?.slice(0, 5) ?? '17:00' };
      }));
    }
  }, [state.data]);
  return (
    <Card title="Shop hours">
      <p className="mb-3 text-[0.85rem] text-charcoal/70">Preparation time is counted only during these hours.{!state.data?.hours.length && ' Nothing is set yet: these are not your confirmed hours until you save them.'}</p>
      <div className="space-y-1.5">
        {days.map((d, i) => (
          <div key={d.weekday} className="flex flex-wrap items-center gap-3 text-[0.88rem]">
            <span className="w-24">{WEEKDAYS[d.weekday]}</span>
            <Checkbox label="Closed" checked={d.closed} onChange={(v) => setDays((s) => s.map((x, j) => (j === i ? { ...x, closed: v } : x)))} />
            <label><span className="sr-only">{WEEKDAYS[d.weekday]} opens</span><Input type="time" className="w-32" disabled={d.closed} value={d.opens_at} onChange={(e) => setDays((s) => s.map((x, j) => (j === i ? { ...x, opens_at: e.target.value } : x)))} /></label>
            <label><span className="sr-only">{WEEKDAYS[d.weekday]} closes</span><Input type="time" className="w-32" disabled={d.closed} value={d.closes_at} onChange={(e) => setDays((s) => s.map((x, j) => (j === i ? { ...x, closes_at: e.target.value } : x)))} /></label>
          </div>
        ))}
      </div>
      <Btn tone="primary" className="mt-4" disabled={busy} onClick={async () => { const ok = await run(() => api('/api/admin/hours', { method: 'PUT', body: { days } }), 'Hours saved.'); if (ok !== undefined) void state.reload(); }}>Save hours</Btn>
    </Card>
  );
}

function Closures() {
  const state = useLoad<{ blackouts: Array<{ id: string; starts_on: string; ends_on: string; reason: string; division_id: string | null; affects: string[]; public_message: string | null; note: string | null }> }>('/api/admin/blackouts');
  const overrides = useLoad<{ overrides: Array<{ id: string; on_date: string; max_orders: number | null; max_points: number | null; max_stops: number | null; max_events: number | null; same_day_enabled: boolean | null; note: string | null }> }>('/api/admin/capacity-overrides');
  const { busy, run } = useAction();
  const meta = useLoad<{ divisions: Array<{ id: string; name: string }> }>('/api/admin/catalog/meta');
  const blank = { starts_on: '', ends_on: '', reason: 'closure', division_id: '', affects: [] as string[], public_message: '', note: '' };
  const [f, setF] = useState(blank);
  const [o, setO] = useState({ on_date: '', max_orders: '', max_points: '', max_stops: '', max_events: '', note: '' });
  const AFFECTS = ['orders', 'pickup', 'delivery', 'shipping', 'consultations', 'events'];
  return (
    <>
      <Card title="Closures and blackout dates">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="From" required><Input type="date" value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value, ends_on: f.ends_on || e.target.value })} /></Field>
          <Field label="To" required><Input type="date" value={f.ends_on} onChange={(e) => setF({ ...f, ends_on: e.target.value })} /></Field>
          <Field label="Why"><Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}><option value="closure">Closure</option><option value="holiday">Holiday</option><option value="weather">Weather</option><option value="capacity">Capacity limit</option><option value="special_event">Special event</option><option value="other">Other</option></Select></Field>
          <Field label="Applies to"><Select value={f.division_id} onChange={(e) => setF({ ...f, division_id: e.target.value })}><option value="">The whole business</option>{meta.data?.divisions.map((d) => <option key={d.id} value={d.id}>{d.name} only</option>)}</Select></Field>
          <Field label="Message customers see" className="sm:col-span-2"><Input value={f.public_message} onChange={(e) => setF({ ...f, public_message: e.target.value })} /></Field>
          <Field label="Note for the team"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
        <fieldset className="mt-3">
          <legend className="mb-1 text-[0.8rem] font-medium">What is affected? (none ticked means everything)</legend>
          <div className="flex flex-wrap gap-3">
            {AFFECTS.map((a) => <Checkbox key={a} label={a} checked={f.affects.includes(a)} onChange={(v) => setF({ ...f, affects: v ? [...f.affects, a] : f.affects.filter((x) => x !== a) })} />)}
          </div>
        </fieldset>
        <Btn tone="primary" className="mt-3" disabled={busy || !f.starts_on || !f.ends_on} onClick={async () => { const ok = await run(() => api('/api/admin/blackouts', { body: { starts_on: f.starts_on, ends_on: f.ends_on, reason: f.reason, affects: f.affects, scope: f.division_id ? 'division' : 'business', division_id: f.division_id || null, public_message: f.public_message || null, note: f.note || null } }), 'Closure added.'); if (ok !== undefined) { setF(blank); void state.reload(); } }}>Add closure</Btn>
        <ul className="mt-4 divide-y divide-charcoal/8 text-[0.85rem]">
          {state.data?.blackouts.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>{b.starts_on}{b.ends_on !== b.starts_on ? ` to ${b.ends_on}` : ''} · {b.division_id ? `${meta.data?.divisions.find((d) => d.id === b.division_id)?.name ?? 'One department'} only · ` : ''}{b.reason.replace('_', ' ')}{b.affects.length ? ` · ${b.affects.join(', ')}` : ' · everything'}{b.public_message ? ` · “${b.public_message}”` : ''}</span>
              <Btn small tone="ghost" disabled={busy} onClick={async () => { await run(() => api(`/api/admin/blackouts/${b.id}`, { method: 'DELETE' })); void state.reload(); }}>Remove</Btn>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Capacity for specific dates">
        <p className="mb-3 text-[0.85rem] text-charcoal/70">Holiday limits and emergency restrictions. These replace the daily limits for one date.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date" required><Input type="date" value={o.on_date} onChange={(e) => setO({ ...o, on_date: e.target.value })} /></Field>
          <Field label="Most orders"><Input inputMode="numeric" value={o.max_orders} onChange={(e) => setO({ ...o, max_orders: e.target.value })} /></Field>
          <Field label="Most points"><Input inputMode="numeric" value={o.max_points} onChange={(e) => setO({ ...o, max_points: e.target.value })} /></Field>
          <Field label="Most delivery stops"><Input inputMode="numeric" value={o.max_stops} onChange={(e) => setO({ ...o, max_stops: e.target.value })} /></Field>
          <Field label="Most events"><Input inputMode="numeric" value={o.max_events} onChange={(e) => setO({ ...o, max_events: e.target.value })} /></Field>
          <Field label="Note"><Input value={o.note} onChange={(e) => setO({ ...o, note: e.target.value })} /></Field>
        </div>
        <Btn tone="primary" className="mt-3" disabled={busy || !o.on_date} onClick={async () => {
          const n = (s: string) => (s ? Number(s) : null);
          const ok = await run(() => api('/api/admin/capacity-overrides', { method: 'PUT', body: { on_date: o.on_date, max_orders: n(o.max_orders), max_points: n(o.max_points), max_stops: n(o.max_stops), max_events: n(o.max_events), note: o.note || null } }), 'Saved.');
          if (ok !== undefined) { setO({ on_date: '', max_orders: '', max_points: '', max_stops: '', max_events: '', note: '' }); void overrides.reload(); }
        }}>Save for this date</Btn>
        <ul className="mt-4 divide-y divide-charcoal/8 text-[0.85rem]">
          {overrides.data?.overrides.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>{x.on_date}: {[x.max_orders !== null && `${x.max_orders} orders`, x.max_points !== null && `${x.max_points} points`, x.max_stops !== null && `${x.max_stops} stops`, x.max_events !== null && `${x.max_events} events`].filter(Boolean).join(', ')}{x.note ? ` · ${x.note}` : ''}</span>
              <Btn small tone="ghost" disabled={busy} onClick={async () => { await run(() => api(`/api/admin/capacity-overrides/${x.id}`, { method: 'DELETE' })); void overrides.reload(); }}>Remove</Btn>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

export default function Settings() {
  const state = useLoad<Values>('/api/admin/settings');
  const [params] = useSearchParams();
  const [tab, setTab] = useState(() => params.get('tab') ?? 'hours');
  const tabs = [{ key: 'hours', label: 'Hours & closures' }, ...GROUPS.map((g) => ({ key: g.key, label: g.label }))];
  return (
    <>
      <PageHeader title="Settings" subtitle="Your rules. Changes apply right away, and every change is logged." />
      <div className="grid gap-4 lg:grid-cols-[13rem_1fr]">
        <nav aria-label="Settings sections" className="flex flex-wrap gap-1 lg:block lg:space-y-0.5">
          {tabs.map((t) => (
            <button key={t.key} type="button" aria-current={tab === t.key ? 'page' : undefined} onClick={() => setTab(t.key)} className={cn('block rounded-lg px-3 py-1.5 text-left text-[0.86rem] lg:w-full', tab === t.key ? 'bg-charcoal text-ivory' : 'hover:bg-charcoal/5')}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 space-y-4">
          {tab === 'hours' ? (
            <>
              <Hours />
              <Closures />
            </>
          ) : (
            <Loader state={state}>
              {(d) => {
                const group = GROUPS.find((g) => g.key === tab);
                return group ? <GroupForm key={group.key} group={group} values={d[group.key] as Record<string, unknown>} approved={d.approved[group.key]} onSaved={() => void state.reload()} /> : null;
              }}
            </Loader>
          )}
        </div>
      </div>
    </>
  );
}
