import { sql } from 'kysely';
import type { Db } from '../../db/client.js';
import { audit, type Actor } from '../../lib/audit.js';
import { badRequest } from '../../lib/errors.js';
import { defaultsFor, settingsSchemas, SETTINGS_GROUPS, type Settings, type SettingsGroup } from './schema.js';
import { isValidTimeZone } from '../../lib/time.js';

export type SettingsState = Settings & { approved: Record<SettingsGroup, boolean> };

export async function loadSettings(db: Db): Promise<SettingsState> {
  const rows = await db.selectFrom('business_settings').select(['key', 'value', 'approved']).execute();
  const out = { approved: {} } as SettingsState;
  for (const group of SETTINGS_GROUPS) {
    const row = rows.find((r) => r.key === group);
    const parsed = settingsSchemas[group].safeParse(row?.value ?? {});
    (out as Record<string, unknown>)[group] = parsed.success ? parsed.data : defaultsFor(group);
    out.approved[group] = row?.approved ?? false;
  }
  return out;
}

export async function getSetting<K extends SettingsGroup>(db: Db, group: K): Promise<Settings[K]> {
  const row = await db.selectFrom('business_settings').select('value').where('key', '=', group).executeTakeFirst();
  const parsed = settingsSchemas[group].safeParse(row?.value ?? {});
  return (parsed.success ? parsed.data : defaultsFor(group)) as Settings[K];
}

export async function businessTimezone(db: Db): Promise<string> {
  return (await getSetting(db, 'general')).timezone;
}

export async function updateSetting(db: Db, group: SettingsGroup, patch: unknown, actor: Actor) {
  const current = await getSetting(db, group);
  const merged = settingsSchemas[group].safeParse({ ...current, ...(patch as object) });
  if (!merged.success) {
    throw badRequest(merged.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), merged.error.issues);
  }
  if (group === 'general' && !isValidTimeZone((merged.data as Settings['general']).timezone)) {
    throw badRequest('That is not a valid timezone.');
  }
  await db
    .insertInto('business_settings')
    .values({ key: group, value: JSON.stringify(merged.data), updated_by: actor.id ?? null })
    .onConflict((oc) =>
      oc.column('key').doUpdateSet({
        value: sql`excluded.value`,
        updated_by: sql`excluded.updated_by`,
        updated_at: sql`now()`,
      }),
    )
    .execute();
  await audit(db, actor, 'settings.update', { type: 'settings' }, { group, patch: patch as object });
  return merged.data;
}

export async function setApproval(db: Db, group: SettingsGroup, approved: boolean, actor: Actor) {
  const current = await getSetting(db, group);
  await db
    .insertInto('business_settings')
    .values({ key: group, value: JSON.stringify(current), approved, approved_by: actor.id ?? null, approved_at: approved ? new Date() : null })
    .onConflict((oc) =>
      oc.column('key').doUpdateSet({
        approved,
        approved_by: actor.id ?? null,
        approved_at: approved ? new Date() : null,
      }),
    )
    .execute();
  await audit(db, actor, approved ? 'settings.approve' : 'settings.unapprove', { type: 'settings' }, { group });
}
