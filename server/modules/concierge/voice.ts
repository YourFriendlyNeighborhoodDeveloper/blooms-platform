import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { sql } from 'kysely';
import { WebSocketServer, WebSocket } from 'ws';
import type { AppContext } from '../../context.js';
import { toE164 } from '../../lib/phone.js';
import { consumeAccessToken, mintAccessToken, resolveAccessToken } from '../../lib/tokens.js';
import { addMinutes, localDate } from '../../lib/time.js';
import type { RealtimeConnection } from '../../integrations/ai/provider.js';
import { loadSettings, type SettingsState } from '../settings/service.js';
import { realtimeCostMicros, transcriptionCostMicros, type RealtimeUsage, type TranscriptionUsage } from './pricing.js';
import { accountProblem, addUsage, appendMessage, conciergeAvailability, conversationById, endConversation, monthToDateMicros, noteProviderProblem, startConversation, type Conversation } from './conversations.js';
import { buildInstructions, voiceOpening } from './prompt.js';
import { executeTool, permittedTools, type ToolContext } from './tools.js';

export const MEDIA_PATH = '/api/webhooks/voice/media';
const FALLBACK_TRANSCRIPTION = 'gpt-4o-transcribe';

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const sayAndHangUp = (text: string) => `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${xml(text)}</Say><Hangup/></Response>`;

/**
 * Twilio asks what to do with an incoming call. The answer is a stream to this server, or a short
 * spoken message when the line is off, busy, over budget, or the caller has reached today's limit.
 */
export async function incomingCallTwiml(ctx: AppContext, params: Record<string, string>): Promise<string> {
  const settings = await loadSettings(ctx.db);
  const name = settings.contact.business_name;
  const callSid = params.CallSid ?? '';
  if (!/^CA[0-9a-f]{32}$/.test(callSid)) return sayAndHangUp('Sorry, this call could not be connected.');
  if (ctx.voice.number && params.To && toE164(params.To) !== ctx.voice.number) return sayAndHangUp('Sorry, this number is not set up for the assistant.');

  const available = await conciergeAvailability(ctx, settings, 'voice');
  if (!available.ok) return sayAndHangUp(`Thanks for calling ${name}. The automated assistant is not available right now. Please visit the website, or call back during business hours.`);

  const caller = toE164(params.From);
  const active = await ctx.db
    .selectFrom('concierge_conversations')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('channel', '=', 'voice')
    .where('status', '=', 'active')
    .where('started_at', '>', addMinutes(ctx.clock.now(), -40))
    .executeTakeFirstOrThrow();
  const existing = await ctx.db.selectFrom('concierge_conversations').select('id').where('call_sid', '=', callSid).executeTakeFirst();
  if (!existing && active.n >= settings.concierge.max_concurrent_calls) return sayAndHangUp(`Thanks for calling ${name}. The assistant is helping other callers right now. Please try again in a few minutes, or visit the website.`);
  if (!existing && caller) {
    const today = localDate(ctx.clock.now(), settings.general.timezone);
    const calls = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM concierge_conversations
      WHERE channel = 'voice' AND caller_phone_e164 = ${caller} AND (started_at AT TIME ZONE ${settings.general.timezone})::date = ${today}::date
    `.execute(ctx.db);
    if ((calls.rows[0]?.n ?? 0) >= settings.concierge.max_calls_per_number_per_day) return sayAndHangUp(`Thanks for calling ${name}. This number has reached today's limit for the automated assistant. Please visit the website, or call back tomorrow.`);
  }

  let conversationId = existing?.id;
  if (!conversationId) {
    const started = await startConversation(ctx.db, ctx.clock, { channel: 'voice', mode: settings.concierge.voice_mode, model: settings.concierge.voice_model, callSid, callerPhone: caller });
    conversationId = started.conversation.id;
    await appendMessage(ctx.db, settings, conversationId, { role: 'event', content: `Call started${caller ? '' : ' from a hidden number'}.` });
  }
  const token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'voice_stream', subjectId: conversationId, ttlMinutes: 2, singleUse: true });
  const base = ctx.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const stream = `${base.replace(/^https:/, 'wss:')}${MEDIA_PATH}`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect action="${xml(`${base}/api/webhooks/voice/after-stream`)}"><Stream url="${xml(stream)}"><Parameter name="token" value="${xml(token)}"/></Stream></Connect></Response>`;
}

/** Twilio asks what comes next once the stream closes. A call that failed hears an apology. */
export async function afterStreamTwiml(ctx: AppContext, params: Record<string, string>): Promise<string> {
  const row = params.CallSid ? await ctx.db.selectFrom('concierge_conversations').select(['status', 'end_reason']).where('call_sid', '=', params.CallSid).executeTakeFirst() : null;
  if (row?.status === 'failed') return sayAndHangUp('Sorry, the assistant has run into a problem. Please call back, or visit the website. Goodbye.');
  return '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';
}

/** Twilio's final word on a call: how long it lasted, for the cost estimate. */
export async function recordCallStatus(ctx: AppContext, params: Record<string, string>) {
  if (!params.CallSid) return;
  const row = await ctx.db.selectFrom('concierge_conversations').select(['id', 'call_seconds']).where('call_sid', '=', params.CallSid).executeTakeFirst();
  if (!row) return;
  const seconds = Number(params.CallDuration ?? params.Duration ?? 0);
  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(params.CallStatus ?? '')) {
    await endConversation(ctx.db, row.id, { reason: `twilio_${params.CallStatus}`, callSeconds: row.call_seconds === null && seconds > 0 ? seconds : null });
  }
}

type TwilioMessage =
  | { event: 'connected' }
  | { event: 'start'; streamSid: string; start: { callSid: string; streamSid: string; customParameters?: Record<string, string> } }
  | { event: 'media'; media: { payload: string; track?: string } }
  | { event: 'mark'; mark: { name: string } }
  | { event: 'stop' }
  | { event: string };

/**
 * One phone call: Twilio's audio stream on one side, the Realtime model on the other. Audio passes
 * through untouched as G.711 mu-law, which both sides speak. Tool calls go through the same server
 * checks as the website chat.
 */
export class VoiceCall {
  private conversation: Conversation | null = null;
  private settings: SettingsState | null = null;
  private rt: RealtimeConnection | null = null;
  private streamSid: string | null = null;
  private startedAt = Date.now();
  private greeted = false;
  private configured = false;
  private transcriptionFallback = false;
  private responseActive = false;
  private toolsInFlight = 0;
  private toolOutputsWaiting = false;
  private hangupRequested = false;
  private wrapUpSent = false;
  private finished = false;
  private lastCustomerText = '';
  private speechStoppedAt = 0;
  private transcriptAt = 0;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private ctx: AppContext,
    private twilio: WebSocket,
  ) {
    twilio.on('message', (data) => {
      let msg: TwilioMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      void this.onTwilio(msg).catch((err) => {
        ctx.log.error('voice call error', { error: err });
        void this.finish('error', 'failed');
      });
    });
    twilio.on('close', () => void this.finish('caller_disconnected'));
    twilio.on('error', () => void this.finish('twilio_error', 'failed'));
    // A stream that never starts properly is closed rather than left open.
    this.timers.push(setTimeout(() => !this.conversation && this.twilio.close(1008, 'no start'), 10_000));
  }

  private async onTwilio(msg: TwilioMessage) {
    if (msg.event === 'start' && 'start' in msg) return this.begin(msg.start.callSid, msg.start.streamSid ?? msg.streamSid, msg.start.customParameters?.token ?? '');
    if (msg.event === 'media' && 'media' in msg) {
      if (this.configured && this.rt) this.rt.send({ type: 'input_audio_buffer.append', audio: msg.media.payload });
      return;
    }
    if (msg.event === 'mark' && 'mark' in msg && msg.mark.name === 'goodbye') return this.finish('ended_by_assistant');
    if (msg.event === 'stop') return this.finish('caller_hung_up');
  }

  /** The stream token proves Twilio fetched our TwiML for this very call. It works once, for two minutes. */
  private async begin(callSid: string, streamSid: string, token: string) {
    if (this.conversation) return;
    const t = await resolveAccessToken(this.ctx.db, this.ctx.clock, token, ['voice_stream']);
    if (!t?.subject_id || !(await consumeAccessToken(this.ctx.db, this.ctx.clock, t.id))) return this.twilio.close(1008, 'invalid token');
    const conversation = await conversationById(this.ctx.db, t.subject_id);
    if (!conversation || conversation.call_sid !== callSid || conversation.status !== 'active') return this.twilio.close(1008, 'unknown call');
    this.conversation = conversation;
    this.streamSid = streamSid;
    this.settings = await loadSettings(this.ctx.db);
    const c = this.settings.concierge;

    this.rt = this.ctx.ai.connectRealtime(c.voice_model);
    this.rt.onOpen(() => void this.configure());
    this.rt.onEvent((event) => void this.onModel(event).catch((err) => this.ctx.log.error('voice model event failed', { error: err, type: event.type })));
    this.rt.onClose(() => void this.finish('model_disconnected', this.hangupRequested ? 'ended' : 'failed'));

    const limitMs = c.max_call_minutes * 60_000;
    this.timers.push(setTimeout(() => this.wrapUp('The call is close to its time limit.'), Math.max(30_000, limitMs - 60_000)));
    this.timers.push(setTimeout(() => void this.finish('time_limit'), limitMs));
    this.timers.push(setInterval(() => void this.checkBudget(), 60_000));
  }

  private async configure() {
    if (!this.conversation || !this.settings || !this.rt) return;
    const c = this.settings.concierge;
    const instructions = await buildInstructions(this.ctx.db, this.ctx.clock, this.settings, { channel: 'voice', mode: this.conversation.mode, isProduction: this.ctx.env.isProduction });
    this.rt.send({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: c.voice_model,
        output_modalities: ['audio'],
        instructions,
        tools: permittedTools(this.conversation).map((t) => ({ type: 'function', ...t })),
        tool_choice: 'auto',
        max_output_tokens: 1500,
        ...(c.voice_model.startsWith('gpt-realtime-2') ? { reasoning: { effort: 'low' } } : {}),
        audio: {
          input: {
            format: { type: 'audio/pcmu' },
            noise_reduction: { type: 'near_field' },
            transcription: { model: this.transcriptionFallback ? FALLBACK_TRANSCRIPTION : c.transcription_model, language: 'en' },
            // Ordinary phone pauses run long, so a turn ends after 0.8 seconds of silence, and
            // a higher threshold keeps line noise from opening one.
            turn_detection: { type: 'server_vad', threshold: 0.6, prefix_padding_ms: 400, silence_duration_ms: 800, create_response: true, interrupt_response: true, idle_timeout_ms: 15_000 },
          },
          output: { format: { type: 'audio/pcmu' }, voice: c.voice },
        },
      },
    });
  }

  private toolContext(): ToolContext {
    return {
      ctx: this.ctx,
      settings: this.settings!,
      conversation: this.conversation!,
      actions: [],
      lastCustomerText: () => this.lastCustomerText,
      requestHangup: () => {
        this.hangupRequested = true;
      },
    };
  }

  private async onModel(event: Record<string, unknown> & { type: string }) {
    const conversation = this.conversation;
    const settings = this.settings;
    if (!conversation || !settings) return;
    switch (event.type) {
      case 'session.updated': {
        this.configured = true;
        if (!this.greeted && this.streamSid) {
          this.greeted = true;
          const opening = voiceOpening(settings, conversation.mode);
          this.respond(`Begin the call now. Say exactly this, then stop and listen: "${opening}"`);
        }
        return;
      }
      case 'error': {
        const err = (event.error ?? {}) as { code?: string; message?: string; param?: string };
        if (err.code === 'conversation_already_has_active_response' || err.code === 'response_cancel_not_active') return;
        this.ctx.log.warn('realtime reported an error', { code: err.code, param: err.param, message: err.message?.slice(0, 200) });
        const problem = accountProblem(event.error);
        if (problem) {
          await noteProviderProblem(this.ctx, problem);
          return this.finish('provider_account_problem', 'failed');
        }
        if (!this.configured && !this.transcriptionFallback && /transcription/.test(`${err.param ?? ''} ${err.message ?? ''}`)) {
          this.transcriptionFallback = true;
          await this.configure();
        }
        return;
      }
      case 'input_audio_buffer.speech_started': {
        // The caller is talking: stop Flora mid-sentence, including audio Twilio has already buffered.
        if (this.streamSid && this.twilio.readyState === WebSocket.OPEN) this.twilio.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }));
        return;
      }
      case 'input_audio_buffer.speech_stopped':
        this.speechStoppedAt = Date.now();
        return;
      case 'response.created':
        this.responseActive = true;
        return;
      case 'response.output_audio.delta': {
        const delta = event.delta as string | undefined;
        if (delta && this.streamSid && this.twilio.readyState === WebSocket.OPEN) this.twilio.send(JSON.stringify({ event: 'media', streamSid: this.streamSid, media: { payload: delta } }));
        return;
      }
      case 'response.output_audio_transcript.done': {
        const text = String(event.transcript ?? '').trim();
        if (text) await appendMessage(this.ctx.db, settings, conversation.id, { role: 'assistant', content: text });
        return;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const text = String(event.transcript ?? '').trim();
        this.transcriptAt = Date.now();
        if (text) {
          this.lastCustomerText = text;
          await appendMessage(this.ctx.db, settings, conversation.id, { role: 'customer', content: text });
        }
        const model = this.transcriptionFallback ? FALLBACK_TRANSCRIPTION : settings.concierge.transcription_model;
        const cost = transcriptionCostMicros(model, event.usage as TranscriptionUsage | undefined);
        if (cost) await addUsage(this.ctx.db, conversation.id, { costMicros: cost });
        return;
      }
      case 'response.function_call_arguments.done':
        return this.runTool({ call_id: String(event.call_id), name: String(event.name), arguments: String(event.arguments ?? '{}') });
      case 'response.done': {
        this.responseActive = false;
        const response = (event.response ?? {}) as { usage?: RealtimeUsage; status?: string };
        const u = response.usage ?? {};
        await addUsage(this.ctx.db, conversation.id, {
          input: u.input_tokens ?? 0,
          cached: u.input_token_details?.cached_tokens ?? 0,
          output: u.output_tokens ?? 0,
          audioIn: u.input_token_details?.audio_tokens ?? 0,
          audioOut: u.output_token_details?.audio_tokens ?? 0,
          costMicros: realtimeCostMicros(settings.concierge.voice_model, u),
          turns: 1,
        });
        if (this.hangupRequested && this.toolsInFlight === 0) return this.sayGoodbyeThenHangUp();
        if (this.toolOutputsWaiting && this.toolsInFlight === 0) {
          this.toolOutputsWaiting = false;
          this.respond();
        }
        return;
      }
      default:
        return;
    }
  }

  /** Transcription arrives a moment after the model hears the words. Tools wait for it, briefly. */
  private async awaitTranscript() {
    const deadline = Date.now() + 2500;
    while (this.transcriptAt < this.speechStoppedAt && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  }

  private async runTool(call: { call_id: string; name: string; arguments: string }) {
    this.toolsInFlight++;
    try {
      await this.awaitTranscript();
      const result = await executeTool(this.toolContext(), call);
      this.rt?.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) } });
      this.toolOutputsWaiting = true;
    } finally {
      this.toolsInFlight--;
    }
    if (this.toolsInFlight === 0 && !this.responseActive && this.toolOutputsWaiting) {
      this.toolOutputsWaiting = false;
      if (this.hangupRequested) return this.sayGoodbyeThenHangUp();
      this.respond();
    }
  }

  private respond(instructions?: string) {
    this.rt?.send({ type: 'response.create', ...(instructions ? { response: { instructions } } : {}) });
  }

  /** A mark after the last audio comes back from Twilio once the caller has heard it all. */
  private sayGoodbyeThenHangUp() {
    if (this.finished) return;
    if (this.streamSid && this.twilio.readyState === WebSocket.OPEN) this.twilio.send(JSON.stringify({ event: 'mark', streamSid: this.streamSid, mark: { name: 'goodbye' } }));
    this.timers.push(setTimeout(() => void this.finish('ended_by_assistant'), 12_000));
  }

  private wrapUp(reason: string) {
    if (this.wrapUpSent || !this.rt) return;
    this.wrapUpSent = true;
    this.rt.send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: `${reason} In your next turn, briefly say what has been saved, offer the planning link if you have not, say goodbye, and then use end_call.` }] },
    });
    if (!this.responseActive) this.respond();
  }

  private async checkBudget() {
    if (!this.settings) return;
    const spent = await monthToDateMicros(this.ctx, this.settings);
    if (spent >= this.settings.concierge.monthly_budget_cents * 10_000) this.wrapUp("This month's assistant budget has been reached.");
  }

  private async finish(reason: string, status: 'ended' | 'failed' = 'ended') {
    if (this.finished) return;
    this.finished = true;
    for (const t of this.timers) clearTimeout(t);
    this.rt?.close();
    if (this.twilio.readyState === WebSocket.OPEN) this.twilio.close(1000, 'done');
    const conversation = this.conversation;
    if (!conversation || !this.settings) return;
    const drafts = await this.ctx.db.selectFrom('concierge_drafts').select('id').where('conversation_id', '=', conversation.id).execute();
    const tickets = await this.ctx.db.selectFrom('support_requests').select('id').where('conversation_id', '=', conversation.id).execute();
    await appendMessage(this.ctx.db, this.settings, conversation.id, { role: 'event', content: `Call ended: ${reason.replace(/_/g, ' ')}.` });
    await endConversation(this.ctx.db, conversation.id, {
      status,
      reason,
      outcome: drafts.length ? 'plan_saved' : tickets.length ? 'passed_to_team' : 'answered',
      callSeconds: Math.round((Date.now() - this.startedAt) / 1000),
    });
  }
}

/**
 * Accepts Twilio's media WebSocket on the web server. Anything else asking to upgrade is refused.
 * The one-time token in the stream's parameters is what admits a call.
 */
export function attachVoiceMedia(server: Server, ctx: AppContext) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== MEDIA_PATH || !ctx.voice.enabled) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => new VoiceCall(ctx, ws));
  });
  return wss;
}
