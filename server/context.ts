import type pg from 'pg';
import type { Env } from './config/env.js';
import { createDb, type Database } from './db/client.js';
import { createLogger, type Logger } from './lib/logger.js';
import { systemClock, type Clock } from './lib/time.js';
import { createPaymentGateway, type PaymentGateway } from './integrations/payments/gateway.js';
import { createEmailProvider, type EmailProvider } from './integrations/email/provider.js';
import { createSmsProvider, type SmsProvider } from './integrations/sms/provider.js';
import { createStorage, type StorageProvider } from './integrations/storage/provider.js';
import { createAiProvider, type AiProvider } from './integrations/ai/provider.js';
import { createVoiceProvider, type VoiceProvider } from './integrations/voice/provider.js';

export type AppContext = {
  env: Env;
  db: Database;
  pool: pg.Pool;
  log: Logger;
  clock: Clock;
  payments: PaymentGateway;
  email: EmailProvider;
  sms: SmsProvider;
  storage: StorageProvider;
  ai: AiProvider;
  voice: VoiceProvider;
};

export function createContext(env: Env, overrides: Partial<AppContext> = {}): AppContext {
  const { db, pool } = createDb(env.DATABASE_URL, { ssl: env.DATABASE_SSL });
  const log = overrides.log ?? createLogger({ env: env.APP_ENV }, { errorWebhook: env.ERROR_WEBHOOK_URL });
  const ctx = {
    env,
    db,
    pool,
    log,
    clock: systemClock,
    ...overrides,
  } as AppContext;
  ctx.payments = overrides.payments ?? createPaymentGateway(ctx);
  ctx.email = overrides.email ?? createEmailProvider(env, log);
  ctx.sms = overrides.sms ?? createSmsProvider(env, log);
  ctx.storage = overrides.storage ?? createStorage(env);
  ctx.ai = overrides.ai ?? createAiProvider(env, log);
  ctx.voice = overrides.voice ?? createVoiceProvider(env, log);
  return ctx;
}

export async function destroyContext(ctx: AppContext) {
  await ctx.db.destroy();
}
