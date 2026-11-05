import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { business } from '../data/business';
import { Panel, Spinner, StorePage } from '../shop/ui';

type Policies = { privacy: string | null; terms: string | null; refunds: string | null; cancellation: string | null; contact: { name: string; email: string | null } };

function usePolicies() {
  const [policies, setPolicies] = useState<Policies | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<Policies>('/api/public/policies').then(setPolicies).catch(() => setFailed(true));
  }, []);
  return { policies, failed };
}

const NotYet = ({ what }: { what: string }) => (
  <p className="text-charcoal/75">
    The shop has not published its {what} yet. Please contact {business.name} at{' '}
    <a className="link-underline" href={`tel:${business.phone.e164}`}>
      {business.phone.display}
    </a>{' '}
    with any questions.
  </p>
);

export function PrivacyPage() {
  const { policies, failed } = usePolicies();
  return (
    <StorePage narrow eyebrow="Privacy" title="Your privacy">
      <Panel>
        {!policies && !failed && <Spinner />}
        {failed && <NotYet what="privacy policy" />}
        {policies && (policies.privacy ? <p className="leading-relaxed whitespace-pre-line">{policies.privacy}</p> : <NotYet what="privacy policy" />)}
      </Panel>
    </StorePage>
  );
}

export function TermsPage() {
  const { policies, failed } = usePolicies();
  return (
    <StorePage narrow eyebrow="Terms" title="Terms of sale">
      <div className="space-y-6">
        <Panel>
          {!policies && !failed && <Spinner />}
          {failed && <NotYet what="terms" />}
          {policies && (policies.terms ? <p className="leading-relaxed whitespace-pre-line">{policies.terms}</p> : <NotYet what="terms" />)}
        </Panel>
        {policies?.refunds && <Panel title="Refunds"><p className="leading-relaxed whitespace-pre-line">{policies.refunds}</p></Panel>}
        {policies?.cancellation && <Panel title="Event cancellations"><p className="leading-relaxed whitespace-pre-line">{policies.cancellation}</p></Panel>}
      </div>
    </StorePage>
  );
}
