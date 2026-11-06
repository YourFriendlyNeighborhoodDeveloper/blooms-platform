/**
 * Published list prices, in US dollars, checked on 2026-11-05 on developers.openai.com and
 * twilio.com/en-us/voice/pricing/us. They change, so every figure computed from them is labelled
 * an estimate. A model missing from this table is priced at the most expensive known rate for its
 * kind, so an unknown model can only make the estimate too high, never too low.
 */
type TokenRates = { text_in: number; text_cached: number; text_out: number; audio_in?: number; audio_cached?: number; audio_out?: number };

export const PRICES_CHECKED_ON = '2026-11-05';

const PER_MILLION: Record<string, TokenRates> = {
  'gpt-5.4-mini': { text_in: 0.75, text_cached: 0.075, text_out: 4.5 },
  'gpt-realtime-2.1': { text_in: 4, text_cached: 0.4, text_out: 24, audio_in: 32, audio_cached: 0.4, audio_out: 64 },
  'gpt-realtime-2.1-mini': { text_in: 0.6, text_cached: 0.06, text_out: 2.4, audio_in: 10, audio_cached: 0.3, audio_out: 20 },
  'gpt-4o-transcribe': { text_in: 2.5, text_cached: 2.5, text_out: 10, audio_in: 2.5, audio_cached: 2.5, audio_out: 10 },
};

const CONSERVATIVE_CHAT: TokenRates = { text_in: 5, text_cached: 0.5, text_out: 30 };
const CONSERVATIVE_REALTIME: TokenRates = PER_MILLION['gpt-realtime-2.1'];

/** Transcription models billed by audio duration, per minute. */
const PER_MINUTE: Record<string, number> = { 'gpt-transcribe': 0.0045, 'gpt-live-transcribe': 0.017, 'gpt-realtime-whisper': 0.017 };

/** Twilio: receiving a call on a local US number, plus the Media Stream to the assistant. */
export const TWILIO_INBOUND_PER_MINUTE = 0.0085;
export const TWILIO_MEDIA_STREAM_PER_MINUTE = 0.0044;

const micros = (dollars: number) => Math.round(dollars * 1_000_000);

export function chatCostMicros(model: string, usage: { input_tokens: number; cached_tokens: number; output_tokens: number }): number {
  const r = PER_MILLION[model] ?? CONSERVATIVE_CHAT;
  const fresh = Math.max(0, usage.input_tokens - usage.cached_tokens);
  return micros((fresh * r.text_in + usage.cached_tokens * r.text_cached + usage.output_tokens * r.text_out) / 1_000_000);
}

/** The usage object on a Realtime `response.done` event. */
export type RealtimeUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { text_tokens?: number; audio_tokens?: number; cached_tokens?: number; cached_tokens_details?: { text_tokens?: number; audio_tokens?: number } };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
};

export function realtimeCostMicros(model: string, usage: RealtimeUsage): number {
  const r = PER_MILLION[model] ?? CONSERVATIVE_REALTIME;
  const inText = usage.input_token_details?.text_tokens ?? 0;
  const inAudio = usage.input_token_details?.audio_tokens ?? 0;
  const cachedText = usage.input_token_details?.cached_tokens_details?.text_tokens ?? 0;
  const cachedAudio = usage.input_token_details?.cached_tokens_details?.audio_tokens ?? 0;
  const outText = usage.output_token_details?.text_tokens ?? 0;
  const outAudio = usage.output_token_details?.audio_tokens ?? 0;
  const audioIn = r.audio_in ?? CONSERVATIVE_REALTIME.audio_in!;
  const audioCached = r.audio_cached ?? CONSERVATIVE_REALTIME.audio_cached!;
  const audioOut = r.audio_out ?? CONSERVATIVE_REALTIME.audio_out!;
  const dollars =
    Math.max(0, inText - cachedText) * r.text_in +
    cachedText * r.text_cached +
    Math.max(0, inAudio - cachedAudio) * audioIn +
    cachedAudio * audioCached +
    outText * r.text_out +
    outAudio * audioOut;
  return micros(dollars / 1_000_000);
}

/** The usage object on `conversation.item.input_audio_transcription.completed`. */
export type TranscriptionUsage = { type?: 'tokens' | 'duration'; seconds?: number; input_tokens?: number; output_tokens?: number };

export function transcriptionCostMicros(model: string, usage: TranscriptionUsage | undefined): number {
  if (!usage) return 0;
  if (usage.type === 'duration' || usage.seconds !== undefined) {
    const perMinute = PER_MINUTE[model] ?? 0.017;
    return micros(((usage.seconds ?? 0) / 60) * perMinute);
  }
  const r = PER_MILLION[model] ?? PER_MILLION['gpt-4o-transcribe'];
  return micros(((usage.input_tokens ?? 0) * (r.audio_in ?? r.text_in) + (usage.output_tokens ?? 0) * r.text_out) / 1_000_000);
}

/** Twilio bills each started minute. */
export function telephonyCostMicros(callSeconds: number): number {
  const minutes = Math.ceil(Math.max(0, callSeconds) / 60);
  return micros(minutes * (TWILIO_INBOUND_PER_MINUTE + TWILIO_MEDIA_STREAM_PER_MINUTE));
}

export const isKnownModel = (model: string) => model in PER_MILLION || model in PER_MINUTE;
