import { useParams } from 'react-router';
import { dateLabel, timeLabel } from '../../lib/format';
import { Btn, BtnLink, Loader, useLoad } from '../ui';

type Slip = {
  id: string;
  reference: string;
  contact_name: string;
  contact_phone: string | null;
  customer_note: string | null;
  items: Array<{ id: string; name: string; variant_name: string | null; sku: string | null; quantity: number; options: { display?: Array<{ label: string; value: string }> } }>;
  fulfillments: Array<{
    id: string;
    method: string;
    scheduled_date: string | null;
    window_start: string | null;
    window_end: string | null;
    recipient_name: string | null;
    recipient_phone: string | null;
    address: { line1?: string; line2?: string | null; city?: string; region?: string; postal_code?: string } | null;
    instructions: string | null;
    items: Array<{ order_item_id: string; quantity: number }>;
  }>;
};

/** One sheet per fulfilment for the bench or the van. Prices stay off it, so it can travel with a gift. */
export default function PackingSlip() {
  const { id } = useParams();
  const state = useLoad<Slip>(`/api/admin/orders/${id}`);
  return (
    <Loader state={state}>
      {(o) => (
        <div className="mx-auto max-w-2xl">
          <div className="mb-6 flex gap-2 print:hidden">
            <Btn tone="primary" onClick={() => window.print()}>Print</Btn>
            <BtnLink to={`/admin/orders/${o.id}`}>Back to the order</BtnLink>
          </div>
          {o.fulfillments.map((f) => (
            <section key={f.id} className="mb-8 break-after-page rounded-xl border border-charcoal/20 bg-white p-6 print:rounded-none print:border-0 print:p-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-display text-[1.5rem] leading-tight">Blooms Boutique &amp; Floral</p>
                  <p className="mt-1 text-[0.9rem]">Order {o.reference}</p>
                </div>
                <p className="text-right text-[0.9rem] font-semibold capitalize">{f.method}</p>
              </div>
              <dl className="mt-5 grid gap-x-6 gap-y-3 text-[0.92rem] sm:grid-cols-2 print:grid-cols-2">
                <div>
                  <dt className="font-semibold">For</dt>
                  <dd>{f.recipient_name ?? o.contact_name}</dd>
                  {(f.recipient_phone ?? o.contact_phone) && <dd>{f.recipient_phone ?? o.contact_phone}</dd>}
                </div>
                {f.scheduled_date && (
                  <div>
                    <dt className="font-semibold">When</dt>
                    <dd>{dateLabel(f.scheduled_date)}</dd>
                    {f.window_start && f.window_end && <dd>{timeLabel(f.window_start)} – {timeLabel(f.window_end)}</dd>}
                  </div>
                )}
                {f.address && (
                  <div className="sm:col-span-2 print:col-span-2">
                    <dt className="font-semibold">Deliver to</dt>
                    <dd>{[f.address.line1, f.address.line2].filter(Boolean).join(', ')}</dd>
                    <dd>{[f.address.city, f.address.region, f.address.postal_code].filter(Boolean).join(', ')}</dd>
                  </div>
                )}
                {f.instructions && (
                  <div className="sm:col-span-2 print:col-span-2">
                    <dt className="font-semibold">Instructions</dt>
                    <dd>{f.instructions}</dd>
                  </div>
                )}
              </dl>
              <table className="mt-6 w-full border-collapse text-left text-[0.92rem]">
                <caption className="sr-only">Items</caption>
                <thead>
                  <tr className="border-b-2 border-charcoal/40">
                    <th scope="col" className="w-12 py-1.5 pr-2">Done</th>
                    <th scope="col" className="w-12 py-1.5 pr-2">Qty</th>
                    <th scope="col" className="py-1.5">Item</th>
                  </tr>
                </thead>
                <tbody>
                  {f.items.map((line) => {
                    const item = o.items.find((i) => i.id === line.order_item_id);
                    if (!item) return null;
                    return (
                      <tr key={line.order_item_id} className="border-b border-charcoal/15 align-top">
                        <td className="py-2 pr-2"><span aria-hidden="true" className="block h-4 w-4 border border-charcoal/60" /></td>
                        <td className="py-2 pr-2 tabular-nums">{line.quantity}</td>
                        <td className="py-2">
                          <p className="font-medium">{item.name}{item.variant_name && item.variant_name !== 'Standard' ? ` (${item.variant_name})` : ''}</p>
                          {item.sku && <p className="text-[0.8rem] text-charcoal/70">{item.sku}</p>}
                          {item.options?.display?.map((d) => <p key={d.label} className="text-[0.85rem]">{d.label}: {d.value}</p>)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {o.customer_note && <p className="mt-4 text-[0.9rem]"><strong>Customer note:</strong> {o.customer_note}</p>}
            </section>
          ))}
        </div>
      )}
    </Loader>
  );
}
