import twilio from 'twilio';
import type { Env } from '../../config/env.js';
import type { Logger } from '../../lib/logger.js';

/** Twilio Voice: checking that a webhook really came from Twilio, and hanging up a call. */
export interface VoiceProvider {
  readonly enabled: boolean;
  /** The number Flora answers, as +1XXXXXXXXXX. */
  readonly number: string | null;
  validateWebhook(signature: string | undefined, url: string, params: Record<string, string>): boolean;
  hangup(callSid: string): Promise<boolean>;
}

export const disabledVoice: VoiceProvider = {
  enabled: false,
  number: null,
  validateWebhook: () => false,
  hangup: async () => false,
};

export function createVoiceProvider(env: Env, log: Logger): VoiceProvider {
  if (!env.voiceEnabled || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return disabledVoice;
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const token = env.TWILIO_AUTH_TOKEN;
  return {
    enabled: true,
    number: env.TWILIO_VOICE_NUMBER ?? null,
    validateWebhook(signature, url, params) {
      if (!signature) return false;
      return twilio.validateRequest(token, signature, url, params);
    },
    async hangup(callSid) {
      try {
        await client.calls(callSid).update({ status: 'completed' });
        return true;
      } catch (err) {
        log.warn('could not hang up call', { code: (err as { code?: number }).code });
        return false;
      }
    },
  };
}
