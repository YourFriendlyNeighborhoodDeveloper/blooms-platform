import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const DIR = path.resolve(import.meta.dirname, 'migrations');

/**
 * Applies pending SQL migrations in filename order, each in its own transaction. An advisory lock
 * makes it safe for several instances to start at once. Applied files are checksummed so a changed
 * migration fails loudly instead of leaving environments silently different.
 */
export async function migrate(connectionString: string, opts: { ssl?: boolean; log?: (m: string) => void; dir?: string } = {}) {
  const log = opts.log ?? (() => {});
  const dir = opts.dir ?? DIR;
  const client = new pg.Client({ connectionString, ssl: opts.ssl ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  const { createHash } = await import('node:crypto');
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations');
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    let count = 0;
    for (const file of files) {
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const seen = applied.get(file);
      if (seen) {
        if (seen !== checksum) throw new Error(`Migration ${file} was changed after being applied. Add a new migration instead.`);
        continue;
      }
      log(`applying ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
        count++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }
    log(count ? `${count} migration(s) applied` : 'schema is up to date');
    return count;
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    await client.end();
  }
}
