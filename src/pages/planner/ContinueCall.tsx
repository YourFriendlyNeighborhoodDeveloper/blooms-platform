import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { Arrow, Button } from '../../components/ui/Button';
import { TextField } from '../../components/forms/fields';
import { Notice, Panel, StorePage } from '../../shop/ui';

/** For callers when no text could be sent: the six-digit code Flora read out, and the phone's last four digits. */
export default function ContinueCall() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [last4, setLast4] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ token: string }>('/api/public/concierge/continue', { body: { code, last4 } });
      navigate(`/plan/draft/${res.token}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <StorePage eyebrow="Continue a call" title="Pick up where your call left off" intro="Enter the six-digit code Flora gave you on the phone, and the last four digits of the phone you called from." narrow>
      <Panel>
        <form onSubmit={submit} noValidate className="grid gap-6 sm:grid-cols-2">
          <TextField label="Six-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, '').slice(0, 11))} />
          <TextField label="Last four digits of your phone" name="last4" inputMode="numeric" required value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          <div className="sm:col-span-2">
            {error && <Notice tone="error" className="mb-4">{error}</Notice>}
            <Button type="submit" size="lg" icon={<Arrow />}>
              {busy ? 'Checking…' : 'Open my plan'}
            </Button>
          </div>
        </form>
      </Panel>
      <p className="mt-6 text-[0.85rem] text-charcoal/70">Codes work for 24 hours. After a few wrong tries, please wait an hour or call the shop.</p>
    </StorePage>
  );
}
