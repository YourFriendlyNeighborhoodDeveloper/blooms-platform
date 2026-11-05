import type { z } from 'zod';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from '../config/env.js';
import { badRequest, forbidden, unauthorized } from '../lib/errors.js';
import type { Permission } from '../auth/permissions.js';
import type { C } from './types.js';

function zodDetails(error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return { fields };
}

export async function readJson<S extends z.ZodType>(c: C, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('Expected a JSON body.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const details = zodDetails(parsed.error);
    const first = Object.values(details.fields)[0];
    throw badRequest(first ?? 'Please check your entries.', details);
  }
  return parsed.data;
}

export function readQuery<S extends z.ZodType>(c: C, schema: S): z.output<S> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw badRequest('Invalid query parameters.', zodDetails(parsed.error));
  return parsed.data;
}

export function requirePermission(c: C, ...needed: Permission[]) {
  const staff = c.get('staff');
  if (!staff) throw unauthorized();
  if (!needed.every((p) => staff.permissions.has(p))) throw forbidden();
  return staff;
}

export const can = (c: C, permission: Permission) => c.get('staff')?.permissions.has(permission) ?? false;

export const cookieNames = (env: Env) => {
  // __Host- binds the cookie to this exact host over HTTPS, so a sibling subdomain cannot set it.
  const prefix = env.isDeployed ? '__Host-' : '';
  return { staff: `${prefix}blooms_staff`, customer: `${prefix}blooms_customer`, cart: `${prefix}blooms_cart` };
};

export function setSessionCookie(c: C, env: Env, name: string, token: string, expires: Date) {
  setCookie(c, name, token, { httpOnly: true, secure: env.isDeployed, sameSite: 'Lax', path: '/', expires });
}

export const clearCookie = (c: C, env: Env, name: string) => deleteCookie(c, name, { path: '/', secure: env.isDeployed });

export const readCookie = (c: C, name: string) => getCookie(c, name);

export function csvResponse(c: C, filename: string, body: string) {
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  return c.body(body);
}
