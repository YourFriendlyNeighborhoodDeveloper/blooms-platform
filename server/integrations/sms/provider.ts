import twilio from 'twilio';
import { isAllowlisted, type Env } from '../../config/env.js';
import type { Logger } from '../../lib/logger.js';

export type SmsResult = { provider: string; message_id: string | null; status: 'sent' | 'skipped'; reason?: string };

export interface SmsProvider {
  readonly enabled: boolean;
  readonly name: string;
  send(input: { to: string; body: string; status_callback?: string }): Promise<SmsResult>;
  /** Validates Twilio's request signature for an inbound webhook. */
  validateWebhook(signature: string | undefined, url: string, params: Record<string, string>): boolean;
}

export const disabledSms: SmsProvider = {
  enabled: false,
  name: 'disabled',
  send: async () => ({ provider: 'disabled', message_id: null, status: 'skipped', reason: 'SMS is not enabled' }),
  validateWebhook: () => false,
};

/** Error codes that retrying will not fix: opted out, invalid number, cannot receive texts. */
export const PERMANENT_TWILIO_ERRORS = new Set([21211, 21408, 21610, 21612, 21614, 30003, 30005, 30006, 30007]);

export class SmsPermanentError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export function createSmsProvider(env: Env, log: Logger): SmsProvider {
  if (!env.SMS_ENABLED) return disabledSms;
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  return {
    enabled: true,
    name: 'twilio',
    async send({ to, body, status_callback }) {
      if (!env.isProduction && !isAllowlisted(env, to)) {
        log.info('sms blocked by non-production allowlist');
        return { provider: 'twilio', message_id: null, status: 'skipped', reason: 'Recipient is not on MESSAGE_ALLOWLIST outside production' };
      }
      try {
        const message = await client.messages.create({
          to,
          body,
          messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
          ...(status_callback ? { statusCallback: status_callback } : {}),
        });
        return { provider: 'twilio', message_id: message.sid, status: 'sent' };
      } catch (err) {
        const code = (err as { code?: number }).code;
        if (code && PERMANENT_TWILIO_ERRORS.has(code)) throw new SmsPermanentError(code, (err as Error).message);
        throw err;
      }
    },
    validateWebhook(signature, url, params) {
      if (!signature) return false;
      return twilio.validateRequest(env.TWILIO_AUTH_TOKEN as string, signature, url, params);
    },
  };
}
