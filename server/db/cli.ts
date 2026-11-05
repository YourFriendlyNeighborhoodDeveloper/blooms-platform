import '../config/dotenv.js';
import { randomBytes } from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { createDb } from './client.js';
import { migrate } from './migrate.js';
import { seedBase } from './seed-base.js';
import { sql } from 'kysely';

const [command, ...args] = process.argv.slice(2);

async function main() {
  const env = loadEnv();
  const log = (m: string) => console.log(m);

  if (command === 'migrate') {
    await migrate(env.DATABASE_URL, { ssl: env.DATABASE_SSL, log });
    const { db } = createDb(env.DATABASE_URL, { ssl: env.DATABASE_SSL, max: 2 });
    await seedBase(db);
    await db.destroy();
    log('base structure is seeded');
    return;
  }

  const { db } = createDb(env.DATABASE_URL, { ssl: env.DATABASE_SSL, max: 2 });
  try {
    if (command === 'seed') {
      await seedBase(db);
      log('base structure is seeded');
    } else if (command === 'seed-demo') {
      if (env.isProduction) throw new Error('Demo data is never loaded in production.');
      const { seedDemo } = await import('./seed-demo.js');
      await seedDemo(db, { log, password: process.env.DEMO_PASSWORD || undefined });
    } else if (command === 'check') {
      const { checkIntegrity } = await import('../modules/system/integrity.js');
      const report = await checkIntegrity(db);
      for (const c of report.checks) {
        log(`${c.violations === 0 ? 'ok  ' : 'FAIL'} ${c.title}${c.violations ? ` (${c.violations})` : ''}`);
        for (const row of c.sample) log(`       ${JSON.stringify(row)}`);
      }
      if (!report.ok) process.exitCode = 1;
    } else if (command === 'reset') {
      if (env.isDeployed) throw new Error('Reset is only available locally.');
      await sql`DROP SCHEMA public CASCADE`.execute(db);
      await sql`CREATE SCHEMA public`.execute(db);
      await migrate(env.DATABASE_URL, { log });
      await seedBase(db);
      log('database reset');
    } else if (command === 'create-owner') {
      const email = args[0];
      const name = args[1] ?? 'Owner';
      if (!email) throw new Error('Usage: npm run admin:create -- <email> [display name]');
      const { createStaffUser } = await import('../auth/staff.js');
      const password = args[2] ?? randomBytes(15).toString('base64url');
      await createStaffUser(db, { email, displayName: name, roleCodes: ['owner'], password });
      log(`Owner ${email} created.`);
      if (!args[2]) log(`Temporary password (shown once, change it after signing in): ${password}`);
    } else {
      throw new Error('Commands: migrate, seed, seed-demo, check, reset, create-owner');
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
