import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../http/types.js';
import { staffActor } from '../http/types.js';
import { clearCookie, cookieNames, readCookie, readJson, setSessionCookie } from '../http/helpers.js';
import { badRequest, notFound, unauthorized } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { hitRateLimit } from '../lib/ratelimit.js';
import { addMinutes } from '../lib/time.js';
import { consumeAccessToken, mintAccessToken, resolveAccessToken } from '../lib/tokens.js';
import { assertStrongPassword, hashPassword, verifyPassword } from '../auth/passwords.js';
import { createSession, resolveSession, revokeAllForUser, revokeSession } from '../auth/sessions.js';
import { loadStaffPrincipal } from '../auth/staff.js';
import { sendDirect } from '../modules/notifications/service.js';

export const adminAuthRoutes = new Hono<AppEnv>();

const LOCK_AFTER = 8;
const LOCK_MINUTES = 15;

const GENERIC_LOGIN_ERROR = 'That email and password do not match.';

adminAuthRoutes.post('/login', async (c) => {
  const ctx = c.get('ctx');
  const body = await readJson(c, z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }));
  const ip = c.get('ip');
  const allowed = (await hitRateLimit(ctx.db, ctx.clock, `login-ip:${ip}`, 30, 900)) && (await hitRateLimit(ctx.db, ctx.clock, `login-email:${body.email}`, 15, 900));
  if (!allowed) {
    await audit(ctx.db, { type: 'staff', label: body.email, ip }, 'auth.login_rate_limited');
    throw unauthorized('Too many attempts. Please wait 15 minutes and try again.');
  }
  const user = await ctx.db.selectFrom('users').select(['id', 'password_hash', 'status', 'failed_logins', 'locked_until']).where('email', '=', body.email).executeTakeFirst();
  const now = ctx.clock.now();
  const locked = Boolean(user?.locked_until && user.locked_until > now);
  // Hash even when the account is missing or locked, so response time reveals nothing.
  const ok = await verifyPassword(body.password, user?.password_hash);
  if (!user || locked || !ok || user.status !== 'active') {
    if (user && !locked) {
      const failed = user.failed_logins + 1;
      await ctx.db
        .updateTable('users')
        .set({ failed_logins: failed, locked_until: failed >= LOCK_AFTER ? addMinutes(now, LOCK_MINUTES) : null })
        .where('id', '=', user.id)
        .execute();
    }
    await audit(ctx.db, { type: 'staff', id: user?.id ?? null, label: body.email, ip }, 'auth.login_failed');
    throw unauthorized(GENERIC_LOGIN_ERROR);
  }
  await ctx.db.updateTable('users').set({ failed_logins: 0, locked_until: null, last_login_at: now }).where('id', '=', user.id).execute();
  const session = await createSession(ctx.db, ctx.clock, { userId: user.id }, { ip, userAgent: c.req.header('user-agent') });
  setSessionCookie(c, ctx.env, cookieNames(ctx.env).staff, session.token, session.expiresAt);
  await audit(ctx.db, { type: 'staff', id: user.id, label: body.email, ip }, 'auth.login');
  const principal = await loadStaffPrincipal(ctx.db, user.id, session.id);
  return c.json({ user: serialize(principal) });
});

const serialize = (p: Awaited<ReturnType<typeof loadStaffPrincipal>>) =>
  p && { id: p.userId, email: p.email, display_name: p.displayName, staff_id: p.staffId, roles: p.roles, permissions: [...p.permissions] };

adminAuthRoutes.post('/logout', async (c) => {
  const ctx = c.get('ctx');
  const name = cookieNames(ctx.env).staff;
  const session = await resolveSession(ctx.db, ctx.clock, readCookie(c, name));
  if (session) await revokeSession(ctx.db, ctx.clock, session.id);
  clearCookie(c, ctx.env, name);
  return c.json({ ok: true });
});

adminAuthRoutes.post('/forgot-password', async (c) => {
  const ctx = c.get('ctx');
  const { email } = await readJson(c, z.object({ email: z.string().trim().toLowerCase().email() }));
  const allowed = await hitRateLimit(ctx.db, ctx.clock, `forgot:${c.get('ip')}`, 5, 900);
  const user = allowed ? await ctx.db.selectFrom('users').select(['id', 'email', 'status']).where('email', '=', email).executeTakeFirst() : null;
  if (user && user.status === 'active') {
    const token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'password_reset', subjectId: user.id, ttlMinutes: 60, singleUse: true });
    await sendDirect(ctx, {
      template: 'staff_password_reset',
      to: user.email,
      staffUserId: user.id,
      audience: 'staff',
      dedupe: `reset:${user.id}:${token.slice(0, 12)}`,
      vars: { reset: { url: `${ctx.env.PUBLIC_BASE_URL}/admin/reset/${token}` } },
    });
  }
  return c.json({ sent: true });
});

const setPasswordSchema = z.object({ token: z.string().min(10).max(200), password: z.string().min(1).max(200) });

adminAuthRoutes.post('/reset-password', async (c) => {
  const ctx = c.get('ctx');
  const body = await readJson(c, setPasswordSchema);
  assertStrongPassword(body.password);
  const token = await resolveAccessToken(ctx.db, ctx.clock, body.token, ['password_reset', 'staff_invite']);
  if (!token?.subject_id) throw notFound('This link has expired. Please ask for a new one.');
  if (!(await consumeAccessToken(ctx.db, ctx.clock, token.id))) throw badRequest('This link has already been used.');
  const hash = await hashPassword(body.password);
  const now = ctx.clock.now();
  await ctx.db.updateTable('users').set({ password_hash: hash, status: 'active', password_changed_at: now, failed_logins: 0, locked_until: null }).where('id', '=', token.subject_id).where('status', '!=', 'disabled').execute();
  await revokeAllForUser(ctx.db, ctx.clock, token.subject_id);
  await audit(ctx.db, { type: 'staff', id: token.subject_id, ip: c.get('ip') }, token.purpose === 'staff_invite' ? 'auth.invite_accepted' : 'auth.password_reset');
  return c.json({ ok: true });
});

/** Routes below require a signed-in staff member. Mounted after the staff middleware. */
export const adminSessionRoutes = new Hono<AppEnv>();

adminSessionRoutes.get('/me', (c) => c.json({ user: serialize(c.get('staff')) }));

adminSessionRoutes.post('/change-password', async (c) => {
  const ctx = c.get('ctx');
  const staff = c.get('staff');
  const body = await readJson(c, z.object({ current_password: z.string().max(200), new_password: z.string().max(200) }));
  assertStrongPassword(body.new_password);
  const user = await ctx.db.selectFrom('users').select('password_hash').where('id', '=', staff.userId).executeTakeFirstOrThrow();
  if (!(await verifyPassword(body.current_password, user.password_hash))) throw badRequest('Your current password is not correct.');
  await ctx.db.updateTable('users').set({ password_hash: await hashPassword(body.new_password), password_changed_at: ctx.clock.now() }).where('id', '=', staff.userId).execute();
  await revokeAllForUser(ctx.db, ctx.clock, staff.userId, staff.sessionId);
  await audit(ctx.db, staffActor(c), 'auth.password_changed', { type: 'user', id: staff.userId });
  return c.json({ ok: true });
});

adminSessionRoutes.get('/sessions', async (c) => {
  const ctx = c.get('ctx');
  const staff = c.get('staff');
  const rows = await ctx.db
    .selectFrom('sessions')
    .select(['id', 'ip', 'user_agent', 'created_at', 'last_seen_at', 'expires_at'])
    .where('user_id', '=', staff.userId)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', ctx.clock.now())
    .orderBy('last_seen_at', 'desc')
    .execute();
  return c.json({ sessions: rows.map((s) => ({ ...s, current: s.id === staff.sessionId })) });
});

adminSessionRoutes.delete('/sessions/:id', async (c) => {
  const ctx = c.get('ctx');
  const staff = c.get('staff');
  const session = await ctx.db.selectFrom('sessions').select('id').where('id', '=', c.req.param('id')).where('user_id', '=', staff.userId).executeTakeFirst();
  if (!session) throw notFound('Session not found.');
  await revokeSession(ctx.db, ctx.clock, session.id);
  await audit(ctx.db, staffActor(c), 'auth.session_revoked', { type: 'session', id: session.id });
  return c.json({ ok: true });
});
