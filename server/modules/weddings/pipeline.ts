import type { Db } from '../../db/client.js';

/** Moves an inquiry along the board. `onlyFrom` keeps automation from dragging a card backwards. */
export async function moveToStage(db: Db, inquiryId: string, code: string, opts: { onlyFrom?: string[] } = {}) {
  const stage = await db.selectFrom('pipeline_stages').select('id').where('code', '=', code).executeTakeFirst();
  if (!stage) return;
  if (opts.onlyFrom) {
    const current = await db
      .selectFrom('wedding_inquiries as i')
      .innerJoin('pipeline_stages as s', 's.id', 'i.stage_id')
      .select('s.code')
      .where('i.id', '=', inquiryId)
      .executeTakeFirst();
    if (!current || !opts.onlyFrom.includes(current.code)) return;
  }
  await db.updateTable('wedding_inquiries').set({ stage_id: stage.id }).where('id', '=', inquiryId).execute();
}
