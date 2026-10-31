import { useCallback, useMemo, useRef, useState } from 'react';

export type Values = Record<string, string | string[]>;
export type Validator<V extends Values> = (value: V[keyof V], all: V) => string | null;
export type Rules<V extends Values> = Partial<Record<keyof V, Validator<V>>>;

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

export function phoneDigits(s: string) {
  const d = s.replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}

export function formatPhone(s: string) {
  const d = phoneDigits(s);
  if (d.length !== 10) return s;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/**
 * Minimal form state: values, per-field validation on blur, full validation on
 * submit with focus moved to the first invalid field.
 */
export function useForm<V extends Values>(initial: V, rules: Rules<V>) {
  const [values, setValues] = useState<V>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof V, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof V, boolean>>>({});
  const [submitCount, setSubmitCount] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  const validateField = useCallback(
    (name: keyof V, all: V) => {
      const rule = rules[name];
      return rule ? rule(all[name], all) : null;
    },
    [rules],
  );

  const valuesRef = useRef(values);
  const set = useCallback(
    (name: keyof V, value: V[keyof V]) => {
      const next = { ...valuesRef.current, [name]: value };
      valuesRef.current = next;
      setValues(next);
      if (touched[name] || submitCount > 0) {
        setErrors((e) => ({ ...e, [name]: validateField(name, next) ?? undefined }));
      }
    },
    [touched, submitCount, validateField],
  );

  const blur = useCallback(
    (name: keyof V) => {
      setTouched((t) => ({ ...t, [name]: true }));
      setErrors((e) => ({ ...e, [name]: validateField(name, values) ?? undefined }));
    },
    [validateField, values],
  );

  const validateAll = useCallback(() => {
    const next: Partial<Record<keyof V, string>> = {};
    (Object.keys(rules) as Array<keyof V>).forEach((k) => {
      const msg = validateField(k, values);
      if (msg) next[k] = msg;
    });
    setErrors(next);
    setSubmitCount((c) => c + 1);
    const firstInvalid = (Object.keys(rules) as Array<keyof V>).find((k) => next[k]);
    if (firstInvalid) {
      const el = formRef.current?.querySelector<HTMLElement>(`[name="${String(firstInvalid)}"]`);
      el?.focus({ preventScroll: false });
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    return { ok: !firstInvalid, errors: next };
  }, [rules, validateField, values]);

  const validCount = useMemo(
    () => (Object.keys(rules) as Array<keyof V>).filter((k) => !validateField(k, values)).length,
    [rules, validateField, values],
  );

  const reset = useCallback(() => {
    valuesRef.current = initial;
    setValues(initial);
    setErrors({});
    setTouched({});
    setSubmitCount(0);
  }, [initial]);

  return { values, errors, set, blur, validateAll, validCount, total: Object.keys(rules).length, formRef, submitCount, reset };
}
