export type LogFields = Record<string, unknown>;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

const SECRET = /(password|secret|token|authorization|cookie|api[-_]?key)/i;

function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) out[k] = SECRET.test(k) ? '[redacted]' : v instanceof Error ? v.message : v;
  return out;
}

/** One JSON object per line, ready for any log collector. */
export function createLogger(base: LogFields = {}, opts: { silent?: boolean; errorWebhook?: string } = {}): Logger {
  const write = (level: string, msg: string, fields?: LogFields) => {
    if (opts.silent) return;
    const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...base, ...(fields ? redact(fields) : {}) });
    if (level === 'error') console.error(line);
    else console.log(line);
  };
  return {
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => {
      write('error', m, f);
      if (opts.errorWebhook) {
        // Best effort: failing to report an error must not create another one.
        fetch(opts.errorWebhook, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: `[blooms] ${m}`, ...base, ...(f ? redact(f) : {}) }),
          signal: AbortSignal.timeout(5000),
        }).catch(() => {});
      }
    },
  };
}
