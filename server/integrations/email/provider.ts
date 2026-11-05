import nodemailer from 'nodemailer';
import type { Env } from '../../config/env.js';
import type { Logger } from '../../lib/logger.js';

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  reply_to?: string | null;
  from_name?: string | null;
  idempotency_key: string;
};

export type EmailResult = { provider: string; message_id: string | null; status: 'sent' | 'skipped'; reason?: string };

export interface EmailProvider {
  readonly name: string;
  readonly deliversForReal: boolean;
  send(message: EmailMessage): Promise<EmailResult>;
}

export class PermanentSendError extends Error {}

const withName = (from: string, name?: string | null) => (name && !from.includes('<') ? `"${name.replace(/"/g, '')}" <${from}>` : from);

/** Records the message and sends nothing. The default everywhere until a real provider is configured. */
export const logEmailProvider = (log: Logger): EmailProvider => ({
  name: 'log',
  deliversForReal: false,
  async send(m) {
    log.info('email recorded, not delivered', { to: m.to, subject: m.subject });
    return { provider: 'log', message_id: null, status: 'sent' };
  },
});

function resendProvider(env: Env): EmailProvider {
  return {
    name: 'resend',
    deliversForReal: true,
    async send(m) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          'content-type': 'application/json',
          'idempotency-key': m.idempotency_key.slice(0, 256),
        },
        body: JSON.stringify({
          from: withName(env.EMAIL_FROM as string, m.from_name),
          to: [m.to],
          subject: m.subject,
          text: m.text,
          html: m.html,
          ...(m.reply_to ? { reply_to: m.reply_to } : {}),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) {
        const message = `Resend ${res.status}: ${body.message ?? 'request failed'}`;
        // 4xx other than rate limiting will not fix itself on retry.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new PermanentSendError(message);
        throw new Error(message);
      }
      return { provider: 'resend', message_id: body.id ?? null, status: 'sent' };
    },
  };
}

function smtpProvider(env: Env): EmailProvider {
  const transport = nodemailer.createTransport(env.SMTP_URL as string);
  return {
    name: 'smtp',
    deliversForReal: true,
    async send(m) {
      const info = await transport.sendMail({
        from: withName(env.EMAIL_FROM as string, m.from_name),
        to: m.to,
        subject: m.subject,
        text: m.text,
        html: m.html,
        ...(m.reply_to ? { replyTo: m.reply_to } : {}),
        messageId: undefined,
      });
      return { provider: 'smtp', message_id: info.messageId ?? null, status: 'sent' };
    },
  };
}

/**
 * Outside production, a real provider can only reach addresses on MESSAGE_ALLOWLIST. Testing with
 * real credentials therefore cannot email an actual customer by accident.
 */
function guarded(inner: EmailProvider, env: Env, log: Logger): EmailProvider {
  if (env.isProduction || !inner.deliversForReal) return inner;
  return {
    name: inner.name,
    deliversForReal: inner.deliversForReal,
    async send(m) {
      if (!env.messageAllowlist.includes(m.to.toLowerCase())) {
        log.info('email blocked by non-production allowlist', { subject: m.subject });
        return { provider: inner.name, message_id: null, status: 'skipped', reason: 'Recipient is not on MESSAGE_ALLOWLIST outside production' };
      }
      return inner.send(m);
    },
  };
}

export function createEmailProvider(env: Env, log: Logger): EmailProvider {
  const provider = env.EMAIL_PROVIDER === 'resend' ? resendProvider(env) : env.EMAIL_PROVIDER === 'smtp' ? smtpProvider(env) : logEmailProvider(log);
  return guarded(provider, env, log);
}
