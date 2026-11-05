import './config/dotenv.js';
import { loadEnv } from './config/env.js';
import { createContext } from './context.js';
import { migrate } from './db/migrate.js';
import { startWorker } from './automation/worker.js';

const env = loadEnv();
await migrate(env.DATABASE_URL, { ssl: env.DATABASE_SSL });
const ctx = createContext(env);
for (const warning of env.warnings) ctx.log.warn(warning);
const worker = startWorker(ctx);

const shutdown = async (signal: string) => {
  ctx.log.info('shutting down', { signal });
  await worker.stop();
  await ctx.db.destroy();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
