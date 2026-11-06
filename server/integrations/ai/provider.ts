import OpenAI from 'openai';
import { OpenAIRealtimeWS } from 'openai/realtime/ws';
import type { Env } from '../../config/env.js';
import type { Logger } from '../../lib/logger.js';

/** A backend function the model may ask for. The server decides whether it actually runs. */
export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

export type ChatItem =
  | { type: 'message'; role: 'user' | 'assistant'; content: string }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

export type ChatUsage = { input_tokens: number; cached_tokens: number; output_tokens: number };
export type ChatCall = { call_id: string; name: string; arguments: string };
export type ChatResponse = { text: string; calls: ChatCall[]; usage: ChatUsage; model: string };

export type ChatRequest = {
  model: string;
  instructions: string;
  items: ChatItem[];
  tools: ToolSpec[];
  maxOutputTokens: number;
  /** A one-way hash that lets the provider spot abuse without learning who the visitor is. */
  safetyId: string;
};

/** The small part of a Realtime connection the phone bridge uses, so tests can stand in for it. */
export interface RealtimeConnection {
  send(event: Record<string, unknown>): void;
  onEvent(handler: (event: Record<string, unknown> & { type: string }) => void): void;
  onOpen(handler: () => void): void;
  onClose(handler: (reason: string) => void): void;
  close(): void;
}

export interface AiProvider {
  readonly name: 'off' | 'mock' | 'openai';
  readonly enabled: boolean;
  respond(request: ChatRequest): Promise<ChatResponse>;
  connectRealtime(model: string): RealtimeConnection;
}

export class AiUnavailableError extends Error {}

export const disabledAi: AiProvider = {
  name: 'off',
  enabled: false,
  respond: async () => {
    throw new AiUnavailableError('No AI provider is configured.');
  },
  connectRealtime: () => {
    throw new AiUnavailableError('No AI provider is configured.');
  },
};

/** The OpenAI API through its official SDK. Requests are not stored by OpenAI (`store: false`). */
export function createOpenAiProvider(apiKey: string, log: Logger): AiProvider {
  const client = new OpenAI({ apiKey, maxRetries: 2, timeout: 45_000 });
  return {
    name: 'openai',
    enabled: true,
    async respond(req) {
      const res = await client.responses.create({
        model: req.model,
        instructions: req.instructions,
        input: req.items.map((item) => (item.type === 'message' ? { role: item.role, content: item.content } : item)),
        tools: req.tools.map((t) => ({ type: 'function' as const, name: t.name, description: t.description, parameters: t.parameters, strict: true })),
        tool_choice: 'auto',
        parallel_tool_calls: false,
        max_output_tokens: req.maxOutputTokens,
        store: false,
        prompt_cache_key: 'flora-chat',
        safety_identifier: req.safetyId,
      });
      const calls: ChatCall[] = [];
      for (const item of res.output) {
        if (item.type === 'function_call') calls.push({ call_id: item.call_id, name: item.name, arguments: item.arguments });
      }
      return {
        text: res.output_text ?? '',
        calls,
        model: res.model,
        usage: {
          input_tokens: res.usage?.input_tokens ?? 0,
          cached_tokens: res.usage?.input_tokens_details?.cached_tokens ?? 0,
          output_tokens: res.usage?.output_tokens ?? 0,
        },
      };
    },
    connectRealtime(model) {
      const rt = new OpenAIRealtimeWS({ model }, client);
      const closeHandlers: Array<(reason: string) => void> = [];
      let closed = false;
      const fireClose = (reason: string) => {
        if (closed) return;
        closed = true;
        for (const h of closeHandlers) h(reason);
      };
      rt.socket.on('close', (code: number) => fireClose(`closed ${code}`));
      rt.on('error', (err) => {
        log.warn('realtime error', { message: err.message, code: err.error?.code });
        // Most errors are recoverable problems with a single event, and come back as an `error`
        // event too. Only a broken socket ends the call.
      });
      return {
        send: (event) => rt.send(event as never),
        onEvent: (handler) => rt.on('event', (event) => handler(event as never)),
        onOpen: (handler) => rt.socket.on('open', handler),
        onClose: (handler) => closeHandlers.push(handler),
        close: () => {
          try {
            rt.close();
          } catch {
            /* Already closed. */
          }
          fireClose('closed by server');
        },
      };
    },
  };
}

/**
 * A scripted stand-in with no model behind it, for development and tests. It never pretends to
 * understand: it greets, answers the quick actions with fixed text, and runs a tool only when a
 * test asks for one explicitly with `/tool name {json}`.
 */
export function createMockAi(): AiProvider & { script: Array<ChatResponse | Error>; realtime: RealtimeConnection[]; realtimeFactory?: (model: string) => RealtimeConnection } {
  const mock = {
    name: 'mock' as const,
    enabled: true,
    script: [] as Array<ChatResponse | Error>,
    realtime: [] as RealtimeConnection[],
    realtimeFactory: undefined as undefined | ((model: string) => RealtimeConnection),
    async respond(req: ChatRequest): Promise<ChatResponse> {
      const usage = { input_tokens: 0, cached_tokens: 0, output_tokens: 0 };
      const scripted = mock.script.shift();
      if (scripted instanceof Error) throw scripted;
      if (scripted) return scripted;
      const last = [...req.items].reverse().find((i) => i.type === 'message' || i.type === 'function_call_output');
      if (last?.type === 'function_call_output') {
        return { text: `(Simulated assistant) The system answered: ${last.output.slice(0, 600)}`, calls: [], usage, model: 'mock' };
      }
      const text = last?.type === 'message' ? last.content.trim() : '';
      const command = text.match(/^\/tool\s+([a-z_]+)\s*(\{[\s\S]*\})?$/);
      if (command) return { text: '', calls: [{ call_id: `mock_${Date.now().toString(36)}`, name: command[1], arguments: command[2] ?? '{}' }], usage, model: 'mock' };
      return {
        text: '(Simulated assistant: no AI model is connected in this environment.) I can still point you to the shop, the wedding planner at /plan, or order tracking at /track.',
        calls: [],
        usage,
        model: 'mock',
      };
    },
    connectRealtime(model: string): RealtimeConnection {
      if (!mock.realtimeFactory) throw new AiUnavailableError('The mock provider has no realtime stand-in.');
      const conn = mock.realtimeFactory(model);
      mock.realtime.push(conn);
      return conn;
    },
  };
  return mock;
}

export function createAiProvider(env: Env, log: Logger): AiProvider {
  if (env.aiProvider === 'openai' && env.OPENAI_API_KEY) return createOpenAiProvider(env.OPENAI_API_KEY, log);
  if (env.aiProvider === 'mock') return createMockAi();
  return disabledAi;
}
