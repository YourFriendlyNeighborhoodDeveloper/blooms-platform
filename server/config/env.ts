import { z } from 'zod';

const flag = (fallback: 'true' | 'false' = 'false') =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(fallback)
    .transform((v) => v === 'true' || v === '1');

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: optional,
  DATABASE_SSL: flag(),
  SESSION_SECRET: optional,
  // false: use the direct connection. true: one trusted proxy, using the address it appended to
  // X-Forwarded-For. cloudflare: use CF-Connecting-IP, only when all traffic must pass through Cloudflare.
  TRUST_PROXY: z
    .enum(['true', 'false', '1', '0', 'cloudflare'])
    .default('false')
    .transform((v) => (v === 'cloudflare' ? ('cloudflare' as const) : v === 'true' || v === '1')),
  SERVE_STATIC: flag(),
  WORKER_EMBEDDED: flag(),
  ERROR_WEBHOOK_URL: optional,

  PAYMENTS_MODE: z.enum(['disabled', 'mock', 'stripe']).default('disabled'),
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  STRIPE_API_HOST: optional,
  STRIPE_API_PORT: z.coerce.number().int().positive().optional(),
  STRIPE_API_PROTOCOL: z.enum(['http', 'https']).optional(),
  LIVE_PAYMENTS_APPROVED: flag(),

  EMAIL_PROVIDER: z.enum(['log', 'resend', 'smtp']).default('log'),
  EMAIL_FROM: optional,
  EMAIL_REPLY_TO: optional,
  RESEND_API_KEY: optional,
  SMTP_URL: optional,
  MESSAGE_ALLOWLIST: optional,

  SMS_ENABLED: flag(),
  TWILIO_ACCOUNT_SID: optional,
  TWILIO_AUTH_TOKEN: optional,
  TWILIO_MESSAGING_SERVICE_SID: optional,
  TWILIO_A2P_APPROVED: flag(),

  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('storage'),
  S3_ENDPOINT: optional,
  S3_BUCKET: optional,
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,

  GOOGLE_CALENDAR_ID: optional,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  GOOGLE_REFRESH_TOKEN: optional,
});

export type RawEnv = z.output<typeof schema>;

export type Env = RawEnv & {
  DATABASE_URL: string;
  SESSION_SECRET: string;
  isProduction: boolean;
  isDeployed: boolean;
  /** Real money can move only when this is true. */
  livePayments: boolean;
  /** Addresses and numbers that non-production environments may contact. */
  messageAllowlist: string[];
  warnings: string[];
};

const DEV_DATABASE = 'postgres://blooms:blooms_dev_only@127.0.0.1:54329/blooms_dev';
const TEST_DATABASE = 'postgres://blooms:blooms_dev_only@127.0.0.1:54329/blooms_test';
const DEV_SECRET = 'local-development-secret-do-not-use-when-deployed';

export class ConfigError extends Error {}

/**
 * Outside production, real providers may only reach these recipients. An entry starting with "@"
 * allows a whole domain, which suits reserved test domains such as @demo.example.
 */
export function isAllowlisted(env: Pick<Env, 'messageAllowlist'>, recipient: string): boolean {
  const to = recipient.trim().toLowerCase();
  return env.messageAllowlist.some((entry) => (entry.startsWith('@') ? to.endsWith(entry) && to.length > entry.length : entry === to));
}

/**
 * Parses configuration and refuses to start on any combination that could move real money or
 * reach real people by accident. Optional integrations that are merely incomplete degrade to
 * "off" with a warning, so the site keeps working without them.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const raw = parsed.data;
  const isProduction = raw.APP_ENV === 'production';
  const isDeployed = raw.APP_ENV === 'production' || raw.APP_ENV === 'staging';
  const errors: string[] = [];
  const warnings: string[] = [];

  let databaseUrl = raw.DATABASE_URL;
  if (!databaseUrl) {
    if (isDeployed) errors.push('DATABASE_URL is required.');
    databaseUrl = raw.APP_ENV === 'test' ? TEST_DATABASE : DEV_DATABASE;
  }

  let sessionSecret = raw.SESSION_SECRET;
  if (!sessionSecret) {
    if (isDeployed) errors.push('SESSION_SECRET is required.');
    sessionSecret = DEV_SECRET;
  } else if (sessionSecret.length < 32) {
    errors.push('SESSION_SECRET must be at least 32 characters.');
  } else if (isDeployed && sessionSecret === DEV_SECRET) {
    errors.push('SESSION_SECRET must not use the development value.');
  }

  if (isDeployed && !raw.PUBLIC_BASE_URL.startsWith('https://')) {
    errors.push('PUBLIC_BASE_URL must use https when deployed.');
  }

  const key = raw.STRIPE_SECRET_KEY ?? '';
  const isLiveKey = key.startsWith('sk_live_') || key.startsWith('rk_live_');
  let livePayments = false;
  if (raw.PAYMENTS_MODE === 'mock' && isProduction) {
    errors.push('PAYMENTS_MODE=mock is not allowed in production.');
  }
  if (raw.PAYMENTS_MODE === 'stripe') {
    if (!key) errors.push('PAYMENTS_MODE=stripe requires STRIPE_SECRET_KEY.');
    if (!raw.STRIPE_WEBHOOK_SECRET) errors.push('PAYMENTS_MODE=stripe requires STRIPE_WEBHOOK_SECRET.');
    if (isLiveKey) {
      if (!isProduction) errors.push('A live Stripe key may only be used with APP_ENV=production.');
      else if (!raw.LIVE_PAYMENTS_APPROVED) errors.push('A live Stripe key requires LIVE_PAYMENTS_APPROVED=true, set after the readiness checks pass.');
      else livePayments = true;
    } else if (isProduction && key) {
      warnings.push('Stripe is in test mode: no real payments will be collected.');
    }
  }

  if (isProduction && raw.EMAIL_PROVIDER === 'log') {
    warnings.push('EMAIL_PROVIDER=log: customer email is recorded but not delivered.');
  }
  if (raw.EMAIL_PROVIDER !== 'log') {
    if (raw.EMAIL_PROVIDER === 'resend' && !raw.RESEND_API_KEY) errors.push('EMAIL_PROVIDER=resend requires RESEND_API_KEY.');
    if (raw.EMAIL_PROVIDER === 'smtp' && !raw.SMTP_URL) errors.push('EMAIL_PROVIDER=smtp requires SMTP_URL.');
    if (!raw.EMAIL_FROM) errors.push('A real email provider requires EMAIL_FROM, using a verified business sender.');
  }

  let smsEnabled = raw.SMS_ENABLED;
  if (smsEnabled && !(raw.TWILIO_ACCOUNT_SID && raw.TWILIO_AUTH_TOKEN && raw.TWILIO_MESSAGING_SERVICE_SID)) {
    warnings.push('SMS_ENABLED is true but Twilio credentials are incomplete; SMS is off.');
    smsEnabled = false;
  }
  if (smsEnabled && isProduction && !raw.TWILIO_A2P_APPROVED) {
    warnings.push('SMS is off until TWILIO_A2P_APPROVED=true records that A2P 10DLC registration is complete.');
    smsEnabled = false;
  }

  if (raw.STORAGE_PROVIDER === 's3' && !(raw.S3_ENDPOINT && raw.S3_BUCKET && raw.S3_ACCESS_KEY_ID && raw.S3_SECRET_ACCESS_KEY)) {
    errors.push('STORAGE_PROVIDER=s3 requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.');
  }

  if (errors.length) throw new ConfigError(`Refusing to start:\n - ${errors.join('\n - ')}`);

  return {
    ...raw,
    SMS_ENABLED: smsEnabled,
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: sessionSecret,
    isProduction,
    isDeployed,
    livePayments,
    messageAllowlist: (raw.MESSAGE_ALLOWLIST ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    warnings,
  };
}
