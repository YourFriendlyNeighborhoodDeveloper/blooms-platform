// Starts the built server against a throwaway database for the Playwright suite. The database is
// wiped on every run, payments are simulated, and email is recorded rather than delivered.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';

const root = path.resolve(import.meta.dirname, '..');
const PORT = process.env.E2E_PORT ?? '8788';
const ADMIN_URL = process.env.E2E_ADMIN_DATABASE_URL ?? 'postgres://blooms:blooms_dev_only@127.0.0.1:54329/blooms_dev';
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://blooms:blooms_dev_only@127.0.0.1:54329/blooms_e2e';

const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = 'blooms_e2e'`);
if (!exists.rowCount && !process.env.E2E_DATABASE_URL) await admin.query('CREATE DATABASE blooms_e2e');
await admin.end();

const env = {
  ...process.env,
  APP_ENV: 'development',
  DATABASE_URL,
  PORT,
  PUBLIC_BASE_URL: `http://localhost:${PORT}`,
  SERVE_STATIC: 'true',
  WORKER_EMBEDDED: 'true',
  PAYMENTS_MODE: 'mock',
  EMAIL_PROVIDER: 'log',
  SMS_ENABLED: 'false',
  // Flora runs on the scripted stand-in: no AI provider is called from the browser tests.
  AI_PROVIDER: 'mock',
  STORAGE_LOCAL_DIR: path.join(root, 'test-results', 'e2e-storage'),
  DEMO_PASSWORD: 'e2e-password-not-secret',
};

const run = (command) => {
  const result = spawnSync('node', ['dist-server/cli.js', command], { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run('reset');
run('seed-demo');

const server = spawn('node', ['dist-server/index.js'], { cwd: root, env, stdio: 'inherit' });
server.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
