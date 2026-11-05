import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ButtonHTMLAttributes } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../lib/api';
import { cn } from '../lib/cn';

export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const tick = useRef(0);

  const reload = useCallback(async () => {
    if (!path) return;
    const mine = ++tick.current;
    setLoading(true);
    try {
      const result = await api<T>(path);
      if (mine === tick.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mine === tick.current) setError(err instanceof ApiError ? err : new ApiError(0, 'error', 'Could not load this.'));
    } finally {
      if (mine === tick.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

type ToastState = { id: number; tone: 'success' | 'error'; message: string } | null;
const ToastContext = createContext<(tone: 'success' | 'error', message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const show = useCallback((tone: 'success' | 'error', message: string) => setToast({ id: Date.now(), tone, message }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tone === 'error' ? 9000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        {toast && (
          <div role={toast.tone === 'error' ? 'alert' : 'status'} className={cn('pointer-events-auto max-w-xl rounded-xl px-4 py-3 text-sm shadow-lg', toast.tone === 'error' ? 'bg-rose-deep text-ivory' : 'bg-charcoal text-ivory')}>
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** Runs an action with busy state and shows either the success message or the server's explanation. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const result = await fn();
        if (success) toast('success', success);
        return result;
      } catch (err) {
        toast('error', err instanceof ApiError ? err.message : 'That did not work. Please try again.');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}

const BTN = {
  primary: 'bg-charcoal text-ivory hover:bg-ink',
  secondary: 'border border-charcoal/25 bg-white hover:border-charcoal/60',
  danger: 'bg-rose-deep text-ivory hover:bg-[#7a4553]',
  ghost: 'hover:bg-charcoal/5',
};

export function Btn({ tone = 'secondary', className, small, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof BTN; small?: boolean }) {
  return <button type="button" {...props} className={cn('inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50', small ? 'h-8 px-3 text-[0.8rem]' : 'h-10 px-4 text-[0.88rem]', BTN[tone], className)} />;
}

export const BtnLink = ({ to, children, tone = 'secondary', small, className }: { to: string; children: ReactNode; tone?: keyof typeof BTN; small?: boolean; className?: string }) => (
  <Link to={to} className={cn('inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors', small ? 'h-8 px-3 text-[0.8rem]' : 'h-10 px-4 text-[0.88rem]', BTN[tone], className)}>
    {children}
  </Link>
);

const inputClass = 'block w-full rounded-lg border border-charcoal/25 bg-white px-3 py-2 text-[0.9rem] text-charcoal placeholder:text-charcoal/35 focus:border-charcoal focus:outline-none disabled:bg-charcoal/5';

export function Field({ label, hint, children, className, required }: { label: string; hint?: ReactNode; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-[0.8rem] font-medium text-charcoal/80">
        {label}
        {required && <span className="text-rose-deep" aria-hidden="true"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[0.75rem] leading-snug text-charcoal/70">{hint}</span>}
    </label>
  );
}

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cn(inputClass, className)} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cn(inputClass, className)} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...p} className={cn(inputClass, className)} />;

export const Checkbox = ({ label, checked, onChange, hint, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode; disabled?: boolean }) => (
  <label className="flex cursor-pointer items-start gap-2 text-[0.88rem]">
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-rose-deep)]" />
    <span>
      {label}
      {hint && <span className="block text-[0.75rem] text-charcoal/70">{hint}</span>}
    </span>
  </label>
);

const TONES: Record<string, string> = {
  neutral: 'bg-charcoal/8 text-charcoal/80',
  good: 'bg-sage/15 text-sage-deep',
  warn: 'bg-gold-soft/60 text-[#6b5526]',
  bad: 'bg-blush text-[#6f3f4c]',
  info: 'bg-[#e4e8ee] text-[#3c4a5c]',
};

const STATUS_TONE: Record<string, string> = {
  accepted: 'info', preparing: 'info', ready: 'info', out_for_delivery: 'info', shipped: 'info', partially_fulfilled: 'info', scheduled: 'info', assigned: 'info', sent: 'info', booked: 'info',
  fulfilled: 'good', completed: 'good', paid: 'good', succeeded: 'good', confirmed: 'good', delivered: 'good', active: 'good', approved: 'good', received: 'good', done: 'good', won: 'good', processed: 'good',
  awaiting_review: 'warn', awaiting_payment: 'warn', payment_processing: 'warn', processing: 'warn', pending: 'warn', needs_customer: 'warn', rescheduling: 'warn', hold: 'warn', draft: 'warn', unpaid: 'warn', queued: 'warn', deferred: 'warn', invited: 'warn', open: 'warn', new: 'warn', partially_refunded: 'warn', partially_paid: 'warn', overdue: 'bad',
  payment_failed: 'bad', failed: 'bad', rejected: 'bad', delivery_failed: 'bad', inventory_shortage: 'bad', shortage: 'bad', dead: 'bad', critical: 'bad', cancelled: 'neutral', expired: 'neutral', refunded: 'neutral', disabled: 'neutral', archived: 'neutral', returned: 'neutral', released: 'neutral', declined: 'bad',
};

export const Badge = ({ tone = 'neutral', children }: { tone?: string; children: ReactNode }) => <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[0.72rem] font-medium whitespace-nowrap', TONES[tone] ?? TONES.neutral)}>{children}</span>;

export const StatusBadge = ({ status }: { status: string | null | undefined }) => <Badge tone={STATUS_TONE[status ?? ''] ?? 'neutral'}>{(status ?? '—').replace(/_/g, ' ')}</Badge>;

export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        {back && (
          <Link to={back.to} className="mb-1 inline-block text-[0.8rem] text-charcoal/70 hover:text-charcoal">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-[1.9rem] leading-tight tracking-[-0.02em]">{title}</h1>
        {subtitle && <div className="mt-1 text-[0.9rem] text-charcoal/70">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ title, children, className, actions, id }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode; id?: string }) {
  return (
    <section id={id} className={cn('rounded-xl border border-charcoal/10 bg-white p-5', className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-sans text-[0.95rem] font-semibold tracking-normal">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export type Column<T> = { key: string; label: string; render: (row: T) => ReactNode; className?: string; align?: 'right' };

export function Table<T>({ columns, rows, rowKey, empty = 'Nothing here yet.', caption }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; empty?: ReactNode; caption?: string }) {
  if (!rows.length) return <p className="py-8 text-center text-[0.9rem] text-charcoal/70">{empty}</p>;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-left text-[0.86rem]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-charcoal/15 text-[0.72rem] tracking-wide text-charcoal/70 uppercase">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn('px-2 py-2 font-semibold', c.align === 'right' && 'text-right', c.className)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-b border-charcoal/5 last:border-0">
              {columns.map((c) => (
                <td key={c.key} className={cn('px-2 py-2.5 align-top', c.align === 'right' && 'text-right tabular-nums', c.className)}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ title, open, onClose, children, wide }: { title: string; open: boolean; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} className={cn('m-auto w-[min(94vw,32rem)] rounded-2xl border-0 bg-white p-0 text-charcoal shadow-2xl backdrop:bg-ink/40', wide && 'w-[min(94vw,52rem)]')}>
      {open && (
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-[1.3rem] leading-tight">{title}</h2>
            <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg px-2 py-1 text-charcoal/70 hover:bg-charcoal/5">
              ✕
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export const ErrorBox = ({ error }: { error: ApiError | null | string }) =>
  error ? (
    <div role="alert" className="rounded-lg border border-rose-deep/30 bg-blush/40 p-3 text-[0.88rem]">
      {typeof error === 'string' ? error : error.message}
    </div>
  ) : null;

export const Loading = () => (
  <p role="status" className="py-10 text-center text-[0.9rem] text-charcoal/70">
    Loading…
  </p>
);

export function Loader<T>({ state, children }: { state: { data: T | null; error: ApiError | null; loading: boolean }; children: (data: T) => ReactNode }) {
  if (state.error && !state.data) return state.error.status === 403 ? <ErrorBox error="You do not have permission to see this." /> : <ErrorBox error={state.error} />;
  if (!state.data) return <Loading />;
  return <>{children(state.data)}</>;
}

export function Stat({ label, value, hint, to, tone }: { label: string; value: ReactNode; hint?: ReactNode; to?: string; tone?: 'attention' }) {
  const body = (
    <>
      <p className="text-[0.75rem] font-medium text-charcoal/70">{label}</p>
      <p className={cn('mt-1 font-display text-[clamp(1.3rem,1.75vw,1.9rem)] leading-none tabular-nums', tone === 'attention' && 'text-rose-deep')}>{value}</p>
      {hint && <p className="mt-1 text-[0.72rem] text-charcoal/70">{hint}</p>}
    </>
  );
  const cls = 'block min-w-0 rounded-xl border border-charcoal/10 bg-white p-4';
  return to ? (
    <Link to={to} className={cn(cls, 'transition-colors hover:border-charcoal/40')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
