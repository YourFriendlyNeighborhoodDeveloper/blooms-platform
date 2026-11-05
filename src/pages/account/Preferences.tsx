import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Check, Notice, Panel, Spinner, StorePage } from '../../shop/ui';

type Prefs = { email_marketing: boolean; sms_marketing: boolean; sms_transactional: boolean };

export default function Preferences() {
  const { token } = useParams();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api<Prefs>(`/api/public/preferences/${token}`)
      .then(setPrefs)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'This link is not valid.'));
  }, [token]);
  if (error) {
    return (
      <StorePage narrow title="This link has expired">
        <Notice>{error}</Notice>
      </StorePage>
    );
  }
  if (!prefs) {
    return (
      <StorePage narrow title="Your preferences">
        <Spinner />
      </StorePage>
    );
  }
  const save = async () => {
    await api(`/api/public/preferences/${token}`, { method: 'PUT', body: prefs });
    setSaved(true);
  };
  return (
    <StorePage narrow eyebrow="Your preferences" title="Choose what you hear about">
      <Panel>
        <div className="space-y-5">
          <Check label="Occasional news and offers by email" checked={prefs.email_marketing} onChange={(v) => setPrefs({ ...prefs, email_marketing: v })} />
          <Check label="Order and event updates by text" checked={prefs.sms_transactional} onChange={(v) => setPrefs({ ...prefs, sms_transactional: v })} />
          <Check label="Promotional texts" checked={prefs.sms_marketing} onChange={(v) => setPrefs({ ...prefs, sms_marketing: v })} />
        </div>
        <p className="mt-5 text-[0.85rem] text-charcoal/70">Emails about orders and events you have placed still reach you, because they are about what you bought.</p>
        {saved && <Notice tone="success" className="mt-4">Saved. Thank you.</Notice>}
        <div className="mt-6">
          <Button onClick={save}>Save my choices</Button>
        </div>
      </Panel>
    </StorePage>
  );
}
