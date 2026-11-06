import { randomInt } from 'node:crypto';
import { sql } from 'kysely';
import type { AppContext } from '../../context.js';
import { hashToken } from '../../lib/tokens.js';
import { addMinutes } from '../../lib/time.js';
import { hitRateLimit } from '../../lib/ratelimit.js';
import { sendDirect } from '../notifications/service.js';
import type { Conversation } from './conversations.js';

const CODE_MINUTES = 10;
const VERIFIED_MINUTES = 30;
const MAX_FAILURES = 5;

const codeHash = (verificationId: string, code: string) => hashToken(`flora-verify:${verificationId}:${code}`);

/**
 * Demonstration conversations can only ever see test orders, so a demo caller cannot reach a real
 * customer's order even with the right details.
 */
const orderScope = (conversation: Conversation) => (conversation.mode === 'demo' ? [true] : [true, false]);

/**
 * Emails a one-time code to the address already on the order. The answer is the same whether or
 * not the details matched, so this cannot be used to test which orders or emails exist.
 */
export async function startIdentityCheck(ctx: AppContext, conversation: Conversation, input: { order_reference: string; email: string }) {
  const sameAnswer = { status: 'sent_if_matched', note: 'If those details match an order, a six-digit code is on its way to the email address on that order. It expires in 10 minutes.' };
  const perConversation = await hitRateLimit(ctx.db, ctx.clock, `flora-verify:${conversation.id}`, 3, 3600);
  const perEmail = await hitRateLimit(ctx.db, ctx.clock, `flora-verify-email:${input.email.toLowerCase()}`, 5, 3600);
  if (!perConversation || !perEmail) return { status: 'limit_reached', note: 'Too many checks for now. Offer the order tracking page or a callback instead.' };
  const order = await ctx.db
    .selectFrom('orders')
    .select(['id', 'reference', 'contact_email', 'customer_id'])
    .where('reference', '=', input.order_reference.trim().toUpperCase())
    .where('contact_email', '=', input.email.trim().toLowerCase())
    .where('is_test', 'in', orderScope(conversation))
    .executeTakeFirst();
  if (!order) return sameAnswer;
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const row = await ctx.db
    .insertInto('concierge_verifications')
    .values({ conversation_id: conversation.id, order_id: order.id, code_hash: 'pending', expires_at: addMinutes(ctx.clock.now(), CODE_MINUTES) })
    .returning('id')
    .executeTakeFirstOrThrow();
  await ctx.db.updateTable('concierge_verifications').set({ code_hash: codeHash(row.id, code) }).where('id', '=', row.id).execute();
  await sendDirect(ctx, {
    template: 'concierge_verification_code',
    to: order.contact_email,
    customerId: order.customer_id,
    dedupe: `flora-verify:${row.id}`,
    vars: { verification: { code }, order: { reference: order.reference } },
  });
  return sameAnswer;
}

export async function confirmIdentityCode(ctx: AppContext, conversation: Conversation, code: string) {
  const pending = await ctx.db
    .selectFrom('concierge_verifications as v')
    .innerJoin('orders as o', 'o.id', 'v.order_id')
    .select(['v.id', 'v.failures', 'v.expires_at', 'o.reference'])
    .where('v.conversation_id', '=', conversation.id)
    .where('v.verified_at', 'is', null)
    .orderBy('v.created_at', 'desc')
    .executeTakeFirst();
  if (!pending || pending.expires_at <= ctx.clock.now() || pending.failures >= MAX_FAILURES) return { verified: false, note: 'There is no active code. Start the check again if needed.' };
  if (codeHash(pending.id, code.replace(/\D/g, '')) !== (await ctx.db.selectFrom('concierge_verifications').select('code_hash').where('id', '=', pending.id).executeTakeFirstOrThrow()).code_hash) {
    await ctx.db.updateTable('concierge_verifications').set({ failures: sql`failures + 1` }).where('id', '=', pending.id).execute();
    return { verified: false, note: 'That code did not match.' };
  }
  await ctx.db.updateTable('concierge_verifications').set({ verified_at: ctx.clock.now() }).where('id', '=', pending.id).execute();
  return { verified: true, order_reference: pending.reference };
}

/** The order this conversation has verified, if the check is still fresh. */
export async function verifiedOrder(ctx: AppContext, conversation: Conversation, reference: string) {
  return ctx.db
    .selectFrom('concierge_verifications as v')
    .innerJoin('orders as o', 'o.id', 'v.order_id')
    .select(['o.id', 'o.reference'])
    .where('v.conversation_id', '=', conversation.id)
    .where('o.reference', '=', reference.trim().toUpperCase())
    .where('v.verified_at', '>', addMinutes(ctx.clock.now(), -VERIFIED_MINUTES))
    .where('o.is_test', 'in', orderScope(conversation))
    .executeTakeFirst();
}

export async function hasPendingCheck(ctx: AppContext, conversationId: string) {
  const row = await ctx.db.selectFrom('concierge_verifications').select('id').where('conversation_id', '=', conversationId).where('verified_at', 'is', null).where('expires_at', '>', ctx.clock.now()).executeTakeFirst();
  return Boolean(row);
}

export async function hasVerifiedOrder(ctx: AppContext, conversationId: string) {
  const row = await ctx.db.selectFrom('concierge_verifications').select('id').where('conversation_id', '=', conversationId).where('verified_at', '>', addMinutes(ctx.clock.now(), -VERIFIED_MINUTES)).executeTakeFirst();
  return Boolean(row);
}
