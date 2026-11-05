import { Hono } from 'hono';
import type { AppContext } from '../context.js';
import type { AppEnv } from '../http/types.js';
import { notFound } from '../lib/errors.js';
import { escapeHtml } from '../lib/template.js';
import { formatCents } from '../lib/money.js';
import { mockEvent, mockSignature } from '../integrations/payments/mock.js';

/**
 * The simulated payment page, mounted only when PAYMENTS_MODE=mock, which startup refuses in
 * production. Buttons post a properly signed event to the real webhook endpoint, so everything after
 * this page is the production code path.
 */
export const devRoutes = new Hono<AppEnv>();

const load = async (ctx: AppContext, id: string) => {
  const row = await ctx.db.selectFrom('mock_gateway_sessions').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw notFound('Unknown simulated session.');
  return row;
};

devRoutes.get('/mock-checkout/:id', async (c) => {
  const s = await load(c.get('ctx'), c.req.param('id'));
  const action = (o: string, label: string, style = '') => `<form method="post" action="/api/dev/mock-checkout/${escapeHtml(s.id)}/${o}"><button style="${style}" type="submit">${label}</button></form>`;
  return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simulated payment</title>
  <style>body{font-family:system-ui,sans-serif;background:#f6f0e9;color:#342f2c;margin:0;padding:24px}main{max-width:460px;margin:40px auto;background:#fff;border-radius:16px;padding:32px}
  .tag{display:inline-block;background:#8e5664;color:#fff;font-size:12px;letter-spacing:.08em;text-transform:uppercase;padding:4px 10px;border-radius:99px}
  button{width:100%;padding:14px;margin-top:10px;border-radius:99px;border:1px solid #342f2c;background:#fff;font-size:15px;cursor:pointer}.pay{background:#342f2c;color:#fff}</style></head>
  <body><main><span class="tag">Simulated: no real payment</span><h1 style="font-size:22px">${escapeHtml(s.description)}</h1><p style="font-size:30px;margin:8px 0 20px">${formatCents(s.amount_cents)}</p>
  <p style="color:#6b625d;font-size:14px">This page stands in for Stripe during development. No card is requested and no money moves.</p>
  ${s.status === 'open' ? action('pay', 'Pay (simulate success)', 'background:#342f2c;color:#fff') + action('pending', 'Bank transfer (payment stays pending)') + action('decline', 'Simulate a failed bank payment') : `<p>This session is ${escapeHtml(s.status)}.</p>`}
  <form method="post" action="/api/dev/mock-checkout/${escapeHtml(s.id)}/cancel"><button type="submit">Go back without paying</button></form></main></body></html>`);
});

const sessionObject = (s: { id: string; amount_cents: number; payment_intent_id: string; metadata: unknown; expires_at: Date }, status: string, paymentStatus: string) => ({
  id: s.id,
  object: 'checkout.session',
  status,
  payment_status: paymentStatus,
  amount_total: s.amount_cents,
  payment_intent: s.payment_intent_id,
  metadata: s.metadata,
  expires_at: Math.floor(s.expires_at.getTime() / 1000),
  livemode: false,
});

devRoutes.post('/mock-checkout/:id/:outcome', async (c) => {
  const ctx = c.get('ctx');
  const s = await load(ctx, c.req.param('id'));
  const outcome = c.req.param('outcome');
  const send = async (type: string, object: Record<string, unknown>) => {
    const body = JSON.stringify(mockEvent(type, object));
    const res = await fetch(`http://127.0.0.1:${ctx.env.PORT}/api/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': mockSignature(body) }, body });
    if (!res.ok) throw new Error(`Simulated webhook returned ${res.status}`);
  };
  const set = (status: 'paid' | 'processing' | 'failed' | 'expired') => ctx.db.updateTable('mock_gateway_sessions').set({ status }).where('id', '=', s.id).execute();

  switch (outcome) {
    case 'pay':
      await set('paid');
      await send('checkout.session.completed', sessionObject(s, 'complete', 'paid'));
      return c.redirect(s.success_url, 303);
    case 'pending':
      await set('processing');
      await send('checkout.session.completed', sessionObject(s, 'complete', 'unpaid'));
      return c.redirect(s.success_url, 303);
    case 'settle':
      await set('paid');
      await send('checkout.session.async_payment_succeeded', sessionObject(s, 'complete', 'paid'));
      return c.json({ ok: true });
    case 'decline':
      await set('failed');
      await send('checkout.session.async_payment_failed', sessionObject(s, 'complete', 'unpaid'));
      return c.redirect(s.success_url, 303);
    case 'expire':
      await set('expired');
      await send('checkout.session.expired', sessionObject(s, 'expired', 'unpaid'));
      return c.json({ ok: true });
    case 'cancel':
      return c.redirect(s.cancel_url, 303);
    default:
      throw notFound();
  }
});
