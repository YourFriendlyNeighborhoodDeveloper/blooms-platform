import type { AppContext } from '../../context.js';
import { audit, type Actor } from '../../lib/audit.js';
import { conflict, notFound } from '../../lib/errors.js';

/** Everything held about one customer, for a data-access request. */
export async function exportCustomerData(ctx: AppContext, customerId: string) {
  const db = ctx.db;
  const customer = await db.selectFrom('customers').selectAll().where('id', '=', customerId).executeTakeFirst();
  if (!customer) throw notFound('Customer not found.');
  const [addresses, consents, orders, inquiries, consultations, communications, invoices, quotes] = await Promise.all([
    db.selectFrom('customer_addresses').selectAll().where('customer_id', '=', customerId).execute(),
    db.selectFrom('customer_consents').selectAll().where('customer_id', '=', customerId).orderBy('created_at').execute(),
    db.selectFrom('orders').select(['reference', 'status', 'placed_at', 'total_cents', 'contact_name', 'contact_email', 'contact_phone', 'customer_note']).where('customer_id', '=', customerId).execute(),
    db.selectFrom('wedding_inquiries').select(['reference', 'event_type', 'event_date', 'venue_name', 'venue_address', 'guest_count', 'budget_range', 'status', 'created_at']).where('customer_id', '=', customerId).execute(),
    db.selectFrom('consultations').select(['starts_at', 'format', 'status']).where('customer_id', '=', customerId).execute(),
    db.selectFrom('customer_communications').select(['direction', 'channel', 'subject', 'body', 'created_at']).where('customer_id', '=', customerId).where('direction', '!=', 'note').execute(),
    db.selectFrom('invoices').select(['number', 'kind', 'status', 'total_cents', 'paid_cents', 'due_on']).where('customer_id', '=', customerId).execute(),
    db.selectFrom('quotes').select(['reference', 'status', 'total_cents', 'accepted_at', 'accepted_name']).where('customer_id', '=', customerId).execute(),
  ]);
  return { exported_at: ctx.clock.now(), customer: { ...customer, notes: undefined }, addresses, consents, orders, inquiries, consultations, communications, invoices, quotes };
}

/**
 * Erases personal details while keeping the financial records the law requires. Order totals and
 * dates stay; names, addresses, phone numbers, notes and message bodies go. Consent history is kept
 * with the phone removed, as proof that consent rules were followed. Open work blocks erasure.
 */
export async function anonymizeCustomer(ctx: AppContext, customerId: string, actor: Actor) {
  const open = await ctx.db
    .selectFrom('orders')
    .select('reference')
    .where('customer_id', '=', customerId)
    .where('status', 'not in', ['completed', 'cancelled', 'rejected', 'expired', 'returned', 'fulfilled'])
    .executeTakeFirst();
  if (open) throw conflict('open_orders', `Order ${open.reference} is still open. Finish or cancel it first.`);
  const upcoming = await ctx.db
    .selectFrom('wedding_projects')
    .select('reference')
    .where('customer_id', '=', customerId)
    .where('status', 'in', ['pending', 'confirmed', 'in_preparation', 'event_scheduled'])
    .executeTakeFirst();
  if (upcoming) throw conflict('open_project', `Project ${upcoming.reference} is still active. Finish or cancel it first.`);

  const docs = await ctx.db
    .selectFrom('wedding_documents as d')
    .innerJoin('wedding_inquiries as i', 'i.id', 'd.inquiry_id')
    .select(['d.id', 'd.storage_key'])
    .where('i.customer_id', '=', customerId)
    .where('d.kind', '!=', 'contract')
    .execute();

  await ctx.db.transaction().execute(async (trx) => {
    const placeholder = `erased-${customerId}@erased.invalid`;
    await trx.updateTable('customers').set({ name: 'Erased customer', email: placeholder, phone_e164: null, notes: null, special_requests: null, tags: [], anonymized_at: ctx.clock.now() }).where('id', '=', customerId).execute();
    await trx.deleteFrom('customer_addresses').where('customer_id', '=', customerId).execute();
    await trx.updateTable('orders').set({ contact_name: 'Erased customer', contact_email: placeholder, contact_phone: null, customer_note: null }).where('customer_id', '=', customerId).execute();
    await trx
      .updateTable('fulfillments')
      .set({ recipient_name: null, recipient_phone: null, address: null, instructions: null, card_message: null })
      .where('order_id', 'in', (eb) => eb.selectFrom('orders').select('id').where('customer_id', '=', customerId))
      .execute();
    await trx.updateTable('order_items').set({ options: JSON.stringify({}) }).where('order_id', 'in', (eb) => eb.selectFrom('orders').select('id').where('customer_id', '=', customerId)).execute();
    await trx.updateTable('wedding_inquiries').set({ venue_name: null, venue_address: null, clarification_request: null, decline_reason: null, estimate: JSON.stringify({}) }).where('customer_id', '=', customerId).execute();
    await trx.deleteFrom('wedding_questionnaires').where('inquiry_id', 'in', (eb) => eb.selectFrom('wedding_inquiries').select('id').where('customer_id', '=', customerId)).execute();
    await trx.updateTable('customer_communications').set({ subject: null, body: null }).where('customer_id', '=', customerId).execute();
    await trx.updateTable('notifications').set({ recipient: placeholder, subject: null, body: '[erased]' }).where('customer_id', '=', customerId).execute();
    await trx.updateTable('customer_consents').set({ phone_e164: null, ip: null, user_agent: null }).where('customer_id', '=', customerId).execute();
    await trx.updateTable('support_requests').set({ name: 'Erased customer', email: placeholder, phone_e164: null, message: '[erased]' }).where('customer_id', '=', customerId).execute();
    if (docs.length) await trx.deleteFrom('wedding_documents').where('id', 'in', docs.map((d) => d.id)).execute();
    await trx.updateTable('sessions').set({ revoked_at: ctx.clock.now() }).where('customer_id', '=', customerId).execute();
    await trx.updateTable('data_requests').set({ status: 'completed', completed_at: ctx.clock.now(), handled_by: actor.id ?? null }).where('customer_id', '=', customerId).where('kind', '=', 'delete').where('status', '=', 'requested').execute();
    await audit(trx, actor, 'privacy.anonymize', { type: 'customer', id: customerId });
  });
  for (const d of docs) await ctx.storage.delete(d.storage_key).catch((err) => ctx.log.warn('could not delete erased document', { error: err }));
}
