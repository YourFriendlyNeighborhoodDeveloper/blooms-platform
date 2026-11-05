import './config/dotenv.js';
import { serve } from '@hono/node-server';
import { loadEnv } from './config/env.js';
import { createContext } from './context.js';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { seedBase } from './db/seed-base.js';
import { startWorker, type RunningWorker } from './automation/worker.js';

const env = loadEnv();
await migrate(env.DATABASE_URL, { ssl: env.DATABASE_SSL });
const ctx = createContext(env);
await seedBase(ctx.db);
for (const warning of env.warnings) ctx.log.warn(warning);

const app = createApp(ctx);
const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.isDeployed ? '0.0.0.0' : '127.0.0.1' }, (info) => {
  ctx.log.info('web server listening', { port: info.port, env: env.APP_ENV, payments: ctx.payments.name, livemode: ctx.payments.livemode, email: ctx.email.name, sms: ctx.sms.enabled });
});

let worker: RunningWorker | null = null;
if (env.WORKER_EMBEDDED) worker = startWorker(ctx);

const shutdown = async (signal: string) => {
  ctx.log.info('shutting down', { signal });
  await worker?.stop();
  server.close();
  await ctx.db.destroy();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
