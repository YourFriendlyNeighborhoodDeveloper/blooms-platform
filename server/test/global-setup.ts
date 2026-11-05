import pg from 'pg';
import { migrate } from '../db/migrate.js';

const ADMIN = 'postgres://blooms:blooms_dev_only@127.0.0.1:54329/blooms_dev';
const TEST = process.env.TEST_DATABASE_URL ?? 'postgres://blooms:blooms_dev_only@127.0.0.1:54329/blooms_test';

/** Recreates the test schema from the migrations, so tests always prove the migrations work. */
export default async function setup() {
  if (!process.env.TEST_DATABASE_URL) {
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = 'blooms_test'`);
    if (!exists.rowCount) await admin.query('CREATE DATABASE blooms_test');
    await admin.end();
  }
  const client = new pg.Client({ connectionString: TEST });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
  await migrate(TEST);
}
