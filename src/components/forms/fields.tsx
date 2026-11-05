import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../../lib/cn';

type Common = { label: string; error?: string; hint?: string; required?: boolean; className?: string };

function ErrorText({ id, error }: { id: string; error?: string }) {
  return (
    <AnimatePresence initial={false}>
      {error && (
        <motion.p
          id={id}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.25 }}
          className="flex items-center gap-1.5 pt-2 text-[0.82rem] text-rose-deep"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 4.5v4.2M8 11v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {error}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

function Label({ htmlFor, label, required }: { htmlFor?: string; label: string; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="eyebrow block text-charcoal/70">
      {label}
      {required ? (
        <span className="text-rose-deep" aria-hidden="true">
          {' '}
          *
        </span>
      ) : (
        <span className="font-sans text-[0.68rem] tracking-normal text-charcoal/70 normal-case"> (optional)</span>
      )}
    </label>
  );
}

const fieldBase =
  'peer mt-2 block w-full rounded-none border-0 border-b bg-transparent px-0 pb-3 pt-2 text-[1.08rem] text-charcoal placeholder:text-charcoal/35 focus:outline-none focus-visible:outline-none';

function Underline({ invalid }: { invalid: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute bottom-0 left-0 h-[2px] w-full origin-left scale-x-0 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] peer-focus:scale-x-100',
        invalid ? 'bg-rose-deep' : 'bg-charcoal',
      )}
    />
  );
}

export function TextField({ label, error, hint, required, className, ...input }: Common & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  return (
    <div className={className}>
      <Label htmlFor={id} label={label} required={required} />
      <div className="relative">
        <input
          id={id}
          required={required}
          aria-invalid={!!error}
          aria-describedby={cn(error && errId, hint && hintId) || undefined}
          className={cn(fieldBase, error ? 'border-rose-deep/70' : 'border-charcoal/25')}
          {...input}
        />
        <Underline invalid={!!error} />
      </div>
      {hint && (
        <p id={hintId} className="pt-2 text-[0.78rem] text-charcoal/70">
          {hint}
        </p>
      )}
      <ErrorText id={errId} error={error} />
    </div>
  );
}

export function TextArea({ label, error, hint, required, className, ...input }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  return (
    <div className={className}>
      <Label htmlFor={id} label={label} required={required} />
      <div className="relative">
        <textarea
          id={id}
          required={required}
          aria-invalid={!!error}
          aria-describedby={cn(error && errId, hint && hintId) || undefined}
          className={cn(fieldBase, 'min-h-[8.5rem] resize-y leading-relaxed', error ? 'border-rose-deep/70' : 'border-charcoal/25')}
          {...input}
        />
        <Underline invalid={!!error} />
      </div>
      {hint && (
        <p id={hintId} className="pt-2 text-[0.78rem] text-charcoal/70">
          {hint}
        </p>
      )}
      <ErrorText id={errId} error={error} />
    </div>
  );
}

export function SelectField({ label, error, required, className, children, ...select }: Common & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <div className={className}>
      <Label htmlFor={id} label={label} required={required} />
      <div className="relative">
        <select
          id={id}
          required={required}
          aria-invalid={!!error}
          aria-describedby={error ? errId : undefined}
          className={cn(fieldBase, 'appearance-none pr-8', error ? 'border-rose-deep/70' : 'border-charcoal/25')}
          {...select}
        >
          {children}
        </select>
        <svg viewBox="0 0 24 24" width="16" height="16" className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 text-charcoal/70" aria-hidden="true">
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <Underline invalid={!!error} />
      </div>
      <ErrorText id={errId} error={error} />
    </div>
  );
}

type ChipGroupProps = {
  label: string;
  name: string;
  options: readonly string[];
  value: string | string[];
  multiple?: boolean;
  onChange: (next: string | string[]) => void;
  onBlur?: () => void;
  error?: string;
  required?: boolean;
  className?: string;
  hint?: string;
};

/** Accessible checkbox/radio group styled as tactile chips. */
export function ChipGroup({ label, name, options, value, multiple, onChange, onBlur, error, required, className, hint }: ChipGroupProps) {
  const id = useId();
  const errId = `${id}-err`;
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  return (
    <fieldset className={className} aria-describedby={error ? errId : undefined} onBlur={onBlur}>
      <legend className="eyebrow text-charcoal/80">
        {label}
        {required && (
          <span className="text-rose-deep" aria-hidden="true">
            {' '}
            *
          </span>
        )}
        {hint && <span className="ml-2 font-sans text-[0.68rem] tracking-normal text-charcoal/70 normal-case">{hint}</span>}
      </legend>
      <div className="mt-4 flex flex-wrap gap-2">
        {options.map((opt, i) => {
          const checked = selected.includes(opt);
          return (
            <label
              key={opt}
              className={cn(
                'relative flex items-center gap-2 rounded-full border px-4 py-2.5 text-[0.88rem] transition-all duration-300 select-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]',
                checked ? 'border-charcoal bg-charcoal text-ivory' : 'border-charcoal/20 bg-ivory/40 hover:border-charcoal/50',
              )}
            >
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={name}
                value={opt}
                checked={checked}
                required={required && i === 0 && !multiple}
                aria-invalid={!!error}
                className="sr-only"
                onChange={() => {
                  if (multiple) onChange(checked ? selected.filter((s) => s !== opt) : [...selected, opt]);
                  else onChange(opt);
                }}
              />
              <span
                aria-hidden="true"
                className={cn(
                  'grid h-4 w-4 place-items-center rounded-full border transition-colors',
                  checked ? 'border-gold bg-gold' : 'border-charcoal/30',
                )}
              >
                {checked && (
                  <svg viewBox="0 0 12 12" width="9" height="9">
                    <path d="m2.5 6 2.2 2.2L9.5 3.5" fill="none" stroke="#221d1b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              {opt}
            </label>
          );
        })}
      </div>
      <ErrorText id={errId} error={error} />
    </fieldset>
  );
}

export function DemoNotice({ className, tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) {
  return (
    <div
      role="note"
      className={cn(
        'flex gap-3 rounded-2xl border border-dashed p-4 text-[0.85rem] leading-relaxed',
        tone === 'dark' ? 'border-gold/50 text-ivory/80' : 'border-rose-deep/40 bg-ivory/60 text-charcoal/80',
        className,
      )}
    >
      <span className={cn('eyebrow shrink-0 pt-0.5', tone === 'dark' ? 'text-gold' : 'text-rose-deep')}>Demo</span>
      <span>
        This form is part of a design concept. It checks your entries but does <strong>not</strong> send them anywhere. To reach Blooms today, call or
        email the shop directly.
      </span>
    </div>
  );
}
