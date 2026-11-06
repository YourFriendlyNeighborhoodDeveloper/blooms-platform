import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useLenis } from '../layout/SmoothScroll';

type Status = {
  shown: boolean;
  available: boolean;
  state: 'online' | 'offline' | 'resting';
  status_message: string | null;
  demo_note: string | null;
  phone_e164: string | null;
  name: string;
  title: string;
  greeting: string;
  mode: 'demo' | 'customer';
  simulated: boolean;
  quick_actions: Array<{ label: string; message: string }>;
};
type Action = { label: string; url: string };
type Message = { role: 'visitor' | 'flora'; text: string; actions?: Action[] };
type Reply = { conversation_token: string; reference: string; mode: string; reply: string; actions: Action[] };

const STORE = 'blooms-flora-chat';
const MOBILE = '(max-width: 639px)';

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

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/**
 * The part of the screen the visitor can actually see. On a phone the keyboard shrinks it, and a
 * panel sized to it keeps the text box above the keyboard instead of behind it.
 */
function useVisualViewport(active: boolean) {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) {
      setBox(null);
      return;
    }
    const update = () => setBox({ top: vv.offsetTop, height: vv.height });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);
  return box;
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
    <Link to={path} onClick={onNavigate} className="inline-flex min-h-11 items-center rounded-full border border-charcoal/25 bg-ivory px-4 py-2 text-[0.88rem] text-charcoal transition-colors hover:bg-charcoal hover:text-ivory">
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

const STATE_LABEL: Record<Status['state'], string> = { online: 'Online', offline: 'Offline right now', resting: 'Offline until next month' };

function StatusDot({ state, className }: { state: Status['state']; className?: string }) {
  return <span aria-hidden="true" className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2', state === 'online' ? 'bg-[#4f8a5b] ring-[#4f8a5b]/25' : 'bg-[#c58b2e] ring-[#c58b2e]/25', className)} />;
}

/**
 * Flora on every page. The launcher is always visible once the owner has set her up, labelled, and
 * shows whether she can answer right now. On a phone the conversation opens as a full-screen sheet.
 */
export function FloraChat() {
  const { pathname, search, hash } = useLocation();
  const lenis = useLenis();
  const mobile = useMediaQuery(MOBILE);
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [{ token, messages }, setState] = useState(restore);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const viewport = useVisualViewport(open && mobile);

  const loadStatus = useCallback(() => {
    api<Status>('/api/public/concierge/status')
      .then(setStatus)
      .catch(() => setStatus((s) => s));
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // A link such as /?chat=open or /#chat opens Flora straight away, for QR codes and shared links.
  useEffect(() => {
    if (new URLSearchParams(search).get('chat') === 'open' || hash === '#chat') setOpen(true);
  }, [search, hash]);

  useEffect(() => {
    if (open) loadStatus();
  }, [open, loadStatus]);

  // A conversation opens at its latest message; a new chat opens at the top, where the status is.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: messages.length || sending ? el.scrollHeight : 0 });
  }, [messages, open, sending, status]);

  // On a phone the sheet covers the page, so the page underneath should not scroll.
  useEffect(() => {
    if (!open || !mobile) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    lenis?.stop();
    return () => {
      root.style.overflow = previous;
      lenis?.start();
    };
  }, [open, mobile, lenis]);

  useEffect(() => {
    if (!open) return;
    const target = status?.available ? inputRef.current : closeRef.current;
    const t = window.setTimeout(() => target?.focus({ preventScroll: true }), 40);
    return () => window.clearTimeout(t);
  }, [open, status?.available]);

  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => launcherRef.current?.focus(), 40);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || sending || !status?.available) return;
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
      // A reply may have been an apology because the service just went offline. Check, so the
      // status shown matches what is really happening.
      loadStatus();
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      if (apiErr && ['conversation_ended', 'not_found', 'conversation_limit'].includes(apiErr.code)) {
        setState({ token: null, messages: next });
        persist(null, next);
      }
      if (apiErr?.status === 503) loadStatus();
      setError(apiErr?.message ?? `${status.name} could not answer just now. Please try again.`);
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

  if (!status?.shown || pathname.startsWith('/admin')) return null;

  const online = status.available;
  const stateLabel = STATE_LABEL[status.state];
  const phone = status.phone_e164;
  const phoneLabel = phone ? phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3') : null;
  const alternatives: Array<{ label: string; to?: string; href?: string }> = [
    { label: 'Shop flowers', to: '/shop' },
    { label: 'Plan your event', to: '/plan' },
    { label: 'Track an order', to: '/track' },
    ...(phone ? [{ label: `Call ${phoneLabel}`, href: `tel:${phone}` }] : []),
  ];

  return (
    <>
      {!(open && mobile) && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => (open ? close() : setOpen(true))}
          aria-expanded={open}
          aria-controls={panelId}
          data-testid="flora-launcher"
          className={cn(
            'flora-launcher fixed right-3 z-[57] flex min-h-[52px] items-center gap-2.5 rounded-full bg-charcoal py-2.5 pr-4 pl-3 text-ivory shadow-[0_12px_32px_-10px_rgba(0,0,0,0.55)] ring-1 ring-ivory/15 transition-transform hover:-translate-y-0.5 sm:right-6',
            // Above the iPhone home indicator and Safari's toolbar, level with the concept badge. On very
            // narrow screens it sits one row higher, so the two never overlap.
            'bottom-[max(0.75rem,calc(env(safe-area-inset-bottom)_+_0.25rem))] max-[379px]:bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))_+_3.25rem)] sm:bottom-6',
            // On wide screens the home page puts its two main buttons in the bottom-right corner: stay above them.
            'lg:bottom-[6.5rem]',
          )}
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-ivory/12">
            <FlowerMark className="h-5 w-5" />
          </span>
          <span className="flex flex-col items-start leading-tight">
            <span className="text-[0.95rem] font-medium">{open ? 'Close chat' : `Chat with ${status.name}`}</span>
            <span className="flex items-center gap-1.5 text-[0.72rem] text-ivory/80">
              <StatusDot state={status.state} className="h-2 w-2 ring-1" />
              {status.state === 'online' ? 'AI concierge · online' : stateLabel}
            </span>
          </span>
        </button>
      )}

      {open && (
        <section
          id={panelId}
          role="dialog"
          aria-modal={mobile}
          aria-label={`Chat with ${status.name}, an automated assistant`}
          data-testid="flora-panel"
          style={mobile && viewport ? { top: viewport.top, height: viewport.height } : undefined}
          className={cn(
            'fixed z-[85] flex flex-col overflow-hidden bg-[#fffdf9]',
            mobile
              ? 'inset-x-0 top-0 h-[100dvh] pt-[env(safe-area-inset-top)]'
              : 'right-6 bottom-[5.75rem] max-h-[min(72vh,640px)] lg:bottom-[10.5rem] lg:max-h-[min(66vh,640px)] w-[min(400px,calc(100vw-3rem))] rounded-3xl border border-charcoal/12 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)]',
          )}
        >
          <header className="flex items-start gap-3 border-b border-charcoal/10 bg-blush/40 px-4 py-3 sm:px-5 sm:py-4">
            <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-charcoal text-ivory">
              <FlowerMark className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-[1.25rem] leading-tight">{status.name}</p>
              <p className="text-[0.8rem] text-charcoal/75">{status.title}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.72rem] font-medium text-charcoal/80">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-charcoal/8 px-2 py-0.5">
                  <StatusDot state={status.state} className="h-2 w-2 ring-1" />
                  {status.state === 'online' ? 'Online' : stateLabel}
                </span>
                <span className="rounded-full bg-charcoal/8 px-2 py-0.5">Automated assistant{status.mode === 'demo' ? ' · demonstration' : ''}</span>
              </p>
            </div>
            <button ref={closeRef} type="button" onClick={close} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[1.1rem] text-charcoal/75 hover:bg-charcoal/8" aria-label="Close chat">
              ✕
            </button>
          </header>

          {!online && (
            // Outside the scrolling area, so the status is the first thing seen and never scrolls away.
            <div role="status" className="border-b border-[#c58b2e]/30 bg-[#fbf3e3] px-4 py-3 text-[0.9rem] leading-snug text-charcoal sm:px-5">
              <p className="flex items-center gap-2 font-medium">
                <StatusDot state={status.state} />
                {status.name} is {status.state === 'resting' ? 'offline until next month' : 'offline right now'}
              </p>
              <p className="mt-1 text-charcoal/85">{status.status_message}</p>
            </div>
          )}

          <div ref={listRef} data-lenis-prevent className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5" aria-live="polite" aria-relevant="additions">
            {!online && (
              <div className="space-y-3">
                {status.demo_note && <p className="rounded-xl bg-charcoal/[0.04] px-3 py-2 text-[0.82rem] leading-snug text-charcoal/80">{status.demo_note}</p>}
                <div className="flex flex-wrap gap-2" aria-label="Other ways to get help" role="group">
                  {alternatives.map((a) =>
                    a.to ? (
                      <Link key={a.label} to={a.to} onClick={close} className="inline-flex min-h-11 items-center rounded-full border border-charcoal/25 bg-ivory px-4 py-2 text-[0.88rem] hover:bg-charcoal hover:text-ivory">
                        {a.label}
                      </Link>
                    ) : (
                      <a key={a.label} href={a.href} className="inline-flex min-h-11 items-center rounded-full border border-charcoal/25 bg-ivory px-4 py-2 text-[0.88rem] hover:bg-charcoal hover:text-ivory">
                        {a.label}
                      </a>
                    ),
                  )}
                </div>
              </div>
            )}
            <div className="max-w-[92%] rounded-2xl rounded-tl-md bg-ivory px-4 py-3 text-[0.92rem] leading-relaxed whitespace-pre-line text-charcoal">{status.greeting}</div>
            {status.simulated && <p className="text-[0.75rem] text-charcoal/70">No AI model is connected here, so answers are simulated.</p>}
            {online && messages.length === 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {status.quick_actions.map((q) => (
                  <button key={q.label} type="button" onClick={() => void send(q.message)} className="min-h-11 rounded-full border border-charcoal/25 px-4 py-2 text-[0.9rem] transition-colors hover:bg-charcoal hover:text-ivory">
                    {q.label}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn('flex flex-col gap-2', m.role === 'visitor' ? 'items-end' : 'items-start')}>
                <p className="sr-only">{m.role === 'visitor' ? 'You said:' : `${status.name} said:`}</p>
                <div className={cn('max-w-[92%] rounded-2xl px-4 py-3 text-[0.92rem] leading-relaxed whitespace-pre-line', m.role === 'visitor' ? 'rounded-tr-md bg-charcoal text-ivory' : 'rounded-tl-md bg-ivory text-charcoal')}>{m.text}</div>
                {m.actions && m.actions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {m.actions.map((a) => (
                      <ActionLink key={a.url} action={a} onNavigate={() => setOpen(!mobile)} />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {sending && <p className="text-[0.85rem] text-charcoal/70">{status.name} is typing…</p>}
            {error && (
              <p role="alert" className="rounded-xl bg-rose-deep/10 px-3 py-2 text-[0.88rem] text-rose-deep">
                {error}
              </p>
            )}
          </div>

          <form onSubmit={onSubmit} className="border-t border-charcoal/10 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:pb-4">
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
                disabled={!online}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder={online ? 'Type your message' : `${status.name} is offline right now`}
                // 16px on every screen, so Safari on iPhone and iPad does not zoom the page when the box is tapped.
                className="max-h-32 min-h-[48px] flex-1 resize-none rounded-2xl border border-charcoal/25 bg-white px-4 py-3 text-[16px] outline-none focus-visible:border-charcoal disabled:cursor-not-allowed disabled:bg-charcoal/[0.04]"
              />
              <button type="submit" disabled={sending || !online || !input.trim()} className="h-12 shrink-0 rounded-full bg-charcoal px-5 text-[0.95rem] text-ivory disabled:opacity-45">
                Send
              </button>
            </div>
            <p className="mt-2 text-[0.75rem] leading-snug text-charcoal/75">
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
