import type { Context } from 'hono';
import type { AppContext } from '../context.js';
import type { StaffPrincipal } from '../auth/staff.js';
import type { Actor } from '../lib/audit.js';

export type CustomerPrincipal = { type: 'customer'; customerId: string; sessionId: string; email: string; name: string };

export type AppEnv = {
  Variables: {
    ctx: AppContext;
    ip: string;
    requestId: string;
    staff: StaffPrincipal;
    customer: CustomerPrincipal;
  };
};

export type C = Context<AppEnv>;

export const staffActor = (c: C): Actor => {
  const s = c.get('staff');
  return { type: 'staff', id: s.userId, label: s.displayName, ip: c.get('ip') };
};

export const customerActor = (c: C, id?: string | null): Actor => ({ type: 'customer', id: id ?? null, ip: c.get('ip') });
