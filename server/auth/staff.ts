import type { Db } from '../db/client.js';
import { inTransaction } from '../db/client.js';
import { conflict } from '../lib/errors.js';
import { hashPassword } from './passwords.js';
import type { Permission } from './permissions.js';

export type StaffPrincipal = {
  type: 'staff';
  userId: string;
  sessionId: string;
  email: string;
  displayName: string;
  staffId: string | null;
  roles: string[];
  permissions: Set<Permission>;
};

export async function loadStaffPrincipal(db: Db, userId: string, sessionId: string): Promise<StaffPrincipal | null> {
  const user = await db
    .selectFrom('users')
    .leftJoin('staff_profiles', 'staff_profiles.user_id', 'users.id')
    .select(['users.id', 'users.email', 'users.status', 'staff_profiles.id as staff_id', 'staff_profiles.display_name'])
    .where('users.id', '=', userId)
    .executeTakeFirst();
  if (!user || user.status !== 'active') return null;
  const roles = await db
    .selectFrom('user_roles')
    .innerJoin('roles', 'roles.id', 'user_roles.role_id')
    .select('roles.code')
    .where('user_roles.user_id', '=', userId)
    .execute();
  const permissions = await db
    .selectFrom('user_roles')
    .innerJoin('role_permissions', 'role_permissions.role_id', 'user_roles.role_id')
    .select('role_permissions.permission_code')
    .distinct()
    .where('user_roles.user_id', '=', userId)
    .execute();
  return {
    type: 'staff',
    userId: user.id,
    sessionId,
    email: user.email,
    displayName: user.display_name ?? user.email,
    staffId: user.staff_id,
    roles: roles.map((r) => r.code),
    permissions: new Set(permissions.map((p) => p.permission_code as Permission)),
  };
}

export async function createStaffUser(
  db: Db,
  input: { email: string; displayName: string; roleCodes: string[]; password?: string; capabilities?: string[]; jobTitle?: string | null; phone?: string | null },
) {
  const email = input.email.trim().toLowerCase();
  return inTransaction(db, async (trx) => {
    const existing = await trx.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
    if (existing) throw conflict('email_taken', 'A team member with that email already exists.');
    const password_hash = input.password ? await hashPassword(input.password) : null;
    const user = await trx
      .insertInto('users')
      .values({ email, password_hash, status: input.password ? 'active' : 'invited', password_changed_at: input.password ? new Date() : null })
      .returning('id')
      .executeTakeFirstOrThrow();
    const profile = await trx
      .insertInto('staff_profiles')
      .values({
        user_id: user.id,
        display_name: input.displayName,
        capabilities: input.capabilities ?? [],
        job_title: input.jobTitle ?? null,
        phone_e164: input.phone ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const roles = await trx.selectFrom('roles').select(['id', 'code']).where('code', 'in', input.roleCodes).execute();
    if (roles.length !== input.roleCodes.length) throw conflict('unknown_role', 'One of those roles does not exist.');
    await trx
      .insertInto('user_roles')
      .values(roles.map((r) => ({ user_id: user.id, role_id: r.id })))
      .execute();
    return { userId: user.id, staffId: profile.id };
  });
}
