import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';

type Status = { available: boolean; name: string; title: string; greeting: string; mode: 'demo' | 'customer'; simulated: boolean; quick_actions: Array<{ label: string; message: string }> };
type Action = { label: string; url: string };
type Message = { role: 'visitor' | 'flora'; text: string; actions?: Action[] };
type Reply = { conversation_token: string; reference: string; mode: string; reply: string; actions: Action[] };

const STORE = 'blooms-flora-chat';

function restore(): { token: string | null; messages: Message[] } {
  try {
    const raw = sessionStorage.getItem(STORE);
    if (raw) return JSON.parse(raw);
  } catch {
    /* Private browsing: the chat still works, it just starts fresh. */
  }
  return { token: null, messages: [] };
}

function persist(token: string | null, messages: Message[]) {
  try {
    sessionStorage.setItem(STORE, JSON.stringify({ token, messages: messages.slice(-40) }));
  } catch {
    /* Not essential. */
  }
}

/** Links from Flora's tools. Pages on this site open in place; nothing else is ever offered. */
function ActionLink({ action, onNavigate }: { action: Action; onNavigate: () => void }) {
  let path: string | null = null;
  try {
    const u = new URL(action.url, window.location.origin);
    if (u.origin === window.location.origin) path = `${u.pathname}${u.search}`;
  } catch {
    path = null;
  }
  if (!path) return null;
  return (
    <Link to={path} onClick={onNavigate} className="inline-flex items-center rounded-full border border-charcoal/25 bg-ivory px-3.5 py-1.5 text-[0.82rem] text-charcoal transition-colors hover:bg-charcoal hover:text-ivory">
      {action.label} <span aria-hidden="true" className="ml-1.5">→</span>
    </Link>
  );
}

function FlowerMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 9.8c-1.6-2.6-1.2-5 0-6.3 1.2 1.3 1.6 3.7 0 6.3ZM14.2 12c2.6-1.6 5-1.2 6.3 0-1.3 1.2-3.7 1.6-6.3 0ZM12 14.2c1.6 2.6 1.2 5 0 6.3-1.2-1.3-1.6-3.7 0-6.3ZM9.8 12c-2.6 1.6-5 1.2-6.3 0 1.3-1.2 3.7-1.6 6.3 0Z" />
    </svg>
  );
}

/**
 * Flora in the corner of every page. It says up front that it is an automated assistant, labels
 * demonstration data, and never shows anything the server did not return.
 */
export function FloraChat() {
  const { pathname } = useLocation();
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [{ token, messages }, setState] = useState(restore);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    api<Status>('/api/public/concierge/status')
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open, sending]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => launcherRef.current?.focus(), 30);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || sending) return;
    setError(null);
    const next: Message[] = [...messages, { role: 'visitor', text: message }];
    setState({ token, messages: next });
    setInput('');
    setSending(true);
    try {
      const res = await api<Reply>('/api/public/concierge/chat', { body: { conversation_token: token, message } });
      const done: Message[] = [...next, { role: 'flora', text: res.reply, actions: res.actions }];
      setState({ token: res.conversation_token, messages: done });
      persist(res.conversation_token, done);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      if (apiErr && ['conversation_ended', 'not_found', 'conversation_limit'].includes(apiErr.code)) {
        setState({ token: null, messages: next });
        persist(null, next);
      }
      setError(apiErr?.message ?? 'Flora could not answer just now. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const restart = () => {
    setState({ token: null, messages: [] });
    persist(null, []);
    setError(null);
  };

  if (!status?.available || pathname.startsWith('/admin')) return null;

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'fixed right-4 bottom-4 z-[60] flex items-center gap-2 rounded-full bg-charcoal py-3 pr-5 pl-4 text-[0.92rem] text-ivory shadow-[0_10px_30px_-10px_rgba(0,0,0,0.45)] transition-transform hover:-translate-y-0.5 sm:right-6 sm:bottom-6',
          open && 'max-sm:hidden',
        )}
      >
        <FlowerMark className="h-5 w-5" />
        {open ? 'Close chat' : `Ask ${status.name}`}
      </button>

      {open && (
        <section
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-label={`Chat with ${status.name}, an automated assistant`}
          className="fixed inset-x-2 bottom-2 z-[85] flex max-h-[min(78svh,640px)] flex-col overflow-hidden rounded-3xl border border-charcoal/12 bg-[#fffdf9] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)] sm:inset-x-auto sm:right-6 sm:bottom-24 sm:w-[min(400px,calc(100vw-3rem))]"
        >
          <header className="flex items-start gap-3 border-b border-charcoal/10 bg-blush/40 px-5 py-4">
            <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-charcoal text-ivory">
              <FlowerMark className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-[1.25rem] leading-tight">{status.name}</p>
              <p className="text-[0.8rem] text-charcoal/75">{status.title} · Available 24/7</p>
              <p className="mt-1 inline-flex rounded-full bg-charcoal/8 px-2 py-0.5 text-[0.7rem] font-medium text-charcoal/80">Automated assistant{status.mode === 'demo' ? ' · demonstration' : ''}</p>
            </div>
            <button type="button" onClick={close} className="grid h-9 w-9 place-items-center rounded-full text-charcoal/70 hover:bg-charcoal/8" aria-label="Close chat">
              ✕
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4" aria-live="polite" aria-relevant="additions">
            <div className="max-w-[90%] rounded-2xl rounded-tl-md bg-ivory px-4 py-3 text-[0.9rem] leading-relaxed whitespace-pre-line text-charcoal">{status.greeting}</div>
            {status.simulated && <p className="text-[0.75rem] text-charcoal/70">No AI model is connected here, so answers are simulated.</p>}
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {status.quick_actions.map((q) => (
                  <button key={q.label} type="button" onClick={() => void send(q.message)} className="rounded-full border border-charcoal/25 px-3.5 py-1.5 text-[0.84rem] transition-colors hover:bg-charcoal hover:text-ivory">
                    {q.label}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn('flex flex-col gap-2', m.role === 'visitor' ? 'items-end' : 'items-start')}>
                <p className="sr-only">{m.role === 'visitor' ? 'You said:' : `${status.name} said:`}</p>
                <div className={cn('max-w-[90%] rounded-2xl px-4 py-3 text-[0.9rem] leading-relaxed whitespace-pre-line', m.role === 'visitor' ? 'rounded-tr-md bg-charcoal text-ivory' : 'rounded-tl-md bg-ivory text-charcoal')}>{m.text}</div>
                {m.actions && m.actions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {m.actions.map((a) => (
                      <ActionLink key={a.url} action={a} onNavigate={() => setOpen(window.innerWidth >= 640)} />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {sending && <p className="text-[0.82rem] text-charcoal/70">{status.name} is typing…</p>}
            {error && (
              <p role="alert" className="rounded-xl bg-rose-deep/10 px-3 py-2 text-[0.84rem] text-rose-deep">
                {error}
              </p>
            )}
          </div>

          <form onSubmit={onSubmit} className="border-t border-charcoal/10 px-4 pt-3 pb-4">
            <label htmlFor={`${panelId}-input`} className="sr-only">
              Message {status.name}
            </label>
            <div className="flex items-end gap-2">
              <textarea
                id={`${panelId}-input`}
                ref={inputRef}
                rows={1}
                maxLength={1500}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder="Type your message"
                className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-charcoal/20 bg-white px-4 py-2.5 text-[0.92rem] outline-none focus-visible:border-charcoal"
              />
              <button type="submit" disabled={sending || !input.trim()} className="h-11 rounded-full bg-charcoal px-4 text-[0.88rem] text-ivory disabled:opacity-50">
                Send
              </button>
            </div>
            <p className="mt-2 text-[0.72rem] leading-snug text-charcoal/70">
              {status.name} is an AI and can make mistakes; the team confirms dates and prices. Chats are saved so the team can follow up. Never share card numbers.{' '}
              <Link to="/continue" onClick={close} className="underline">
                Continue a call
              </Link>
              {messages.length > 0 && (
                <>
                  {' · '}
                  <button type="button" onClick={restart} className="underline">
                    New chat
                  </button>
                </>
              )}
            </p>
          </form>
        </section>
      )}
    </>
  );
}
