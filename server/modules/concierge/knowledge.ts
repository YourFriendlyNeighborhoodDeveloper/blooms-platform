import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { audit, type Actor } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import type { Mode } from './conversations.js';

export const knowledgeSchema = z.object({
  title: z.string().trim().min(3, 'Give the entry a short title.').max(160),
  body: z.string().trim().min(10, 'Write the answer Flora should give.').max(4000),
  keywords: z.string().trim().max(400).default(''),
  published: z.boolean().default(false),
});

/** Owner-approved answers. Demonstration entries are visible only to demonstration conversations. */
export async function searchKnowledge(db: Db, query: string, mode: Mode, limit = 3) {
  const q = query.trim().slice(0, 200);
  if (!q) return [];
  const rows = await db
    .selectFrom('concierge_knowledge')
    .select(['title', 'body', sql<number>`ts_rank(search, websearch_to_tsquery('english', ${q}))`.as('rank')])
    .where('published', '=', true)
    .where('is_demo', 'in', mode === 'demo' ? [true, false] : [false])
    .where((eb) => eb.or([sql<boolean>`search @@ websearch_to_tsquery('english', ${q})`, eb('title', 'ilike', `%${q.replace(/[%_]/g, '')}%`)]))
    .orderBy('rank', 'desc')
    .limit(limit)
    .execute();
  return rows.map((r) => ({ title: r.title, answer: r.body.slice(0, 1200) }));
}

export async function listKnowledge(db: Db) {
  return db.selectFrom('concierge_knowledge').select(['id', 'title', 'body', 'keywords', 'published', 'is_demo', 'updated_at']).orderBy('updated_at', 'desc').execute();
}

export async function saveKnowledge(db: Db, id: string | null, input: z.output<typeof knowledgeSchema>, actor: Actor) {
  if (id) {
    const res = await db.updateTable('concierge_knowledge').set({ ...input, updated_by: actor.id ?? null, updated_at: sql`now()` }).where('id', '=', id).returning('id').executeTakeFirst();
    if (!res) throw notFound('That entry no longer exists.');
    await audit(db, actor, 'concierge.knowledge_update', { type: 'concierge_knowledge', id }, { title: input.title, published: input.published });
    return res;
  }
  const res = await db.insertInto('concierge_knowledge').values({ ...input, updated_by: actor.id ?? null }).returning('id').executeTakeFirstOrThrow();
  await audit(db, actor, 'concierge.knowledge_create', { type: 'concierge_knowledge', id: res.id }, { title: input.title, published: input.published });
  return res;
}

export async function deleteKnowledge(db: Db, id: string, actor: Actor) {
  await db.deleteFrom('concierge_knowledge').where('id', '=', id).execute();
  await audit(db, actor, 'concierge.knowledge_delete', { type: 'concierge_knowledge', id });
}
