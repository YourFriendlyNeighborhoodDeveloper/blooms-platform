import { Link } from 'react-router';
import { Badge, Card, Loader, PageHeader, useLoad } from '../ui';

type Check = { id: string; title: string; status: 'ok' | 'todo' | 'blocker' | 'optional'; detail: string };
type Data = { checks: Check[]; ready_for_live: boolean };

/** The owner's setup, in the order that works best. Each step points at the screen where it is done. */
const STEPS: Array<{ title: string; what: string; to: string; checks: string[]; who?: 'developer' }> = [
  { title: 'Business details', what: 'Check the business name, phone, email, address and Facebook page used in messages and on the site.', to: '/admin/settings?tab=contact', checks: [] },
  { title: 'Opening hours and closures', what: 'Enter each day\'s hours, and any holidays. Preparation time only counts while you are open.', to: '/admin/settings?tab=hours', checks: ['hours'] },
  { title: 'Your team', what: 'Invite each person, choose what they can see, and set their usual week and days off. Add your event crews.', to: '/admin/team', checks: ['staff'] },
  { title: 'Products and photos', what: 'Add products one at a time, or many at once from a spreadsheet. Then add photos, and remove the demo products.', to: '/admin/products', checks: ['catalog'] },
  { title: 'Pickup and delivery', what: 'Add delivery zones by ZIP code, with fees and minimums, then the pickup and delivery times you offer.', to: '/admin/deliveries', checks: ['windows'] },
  { title: 'Ordering rules', what: 'Same-day orders, notice, daily limits and out-of-stock handling. Then approve them, or every order waits for review.', to: '/admin/settings?tab=ordering', checks: ['ordering_policy', 'capacity'] },
  { title: 'Delivery rules', what: 'Delivery buffers, stops per driver, and shipping. Then approve them.', to: '/admin/settings?tab=delivery', checks: ['delivery_policy'] },
  { title: 'Sales tax and refunds', what: 'Your tax rates, confirmed with your accountant, and your refund policy. Then approve both.', to: '/admin/settings?tab=tax', checks: ['tax', 'refund_policy'] },
  { title: 'Weddings and events', what: 'Your services and packages, rentals, crews, deposit and cancellation policies.', to: '/admin/services', checks: ['events', 'event_policy'] },
  { title: 'Privacy policy and terms', what: 'Paste in the wording your lawyer approved.', to: '/admin/settings?tab=privacy', checks: ['privacy', 'terms'] },
  { title: 'Customer messages', what: 'Read and adjust what customers receive. Sending real email needs your email account connected by your developer.', to: '/admin/templates', checks: ['email', 'sender'], who: 'developer' },
  { title: 'Payments', what: 'Your own Stripe account, connected and tested by your developer. Until then, payments are simulated.', to: '/admin/setup', checks: ['payments', 'webhook', 'stripe_verified'], who: 'developer' },
  { title: 'Go live', what: 'Backups tested, the worker running, and your approval to remove the concept notices.', to: '/admin/setup', checks: ['worker', 'backups', 'launch'], who: 'developer' },
];

export default function Onboarding() {
  const state = useLoad<Data>('/api/admin/readiness');
  return (
    <>
      <PageHeader title="Set up your shop" subtitle="Work down the list. Nothing here goes live by itself, and the rules you approve are the only ones the shop follows." />
      <Loader state={state}>
        {(d) => {
          const statusOf = (ids: string[]) => {
            const found = d.checks.filter((c) => ids.includes(c.id));
            if (!ids.length) return 'review';
            if (found.some((c) => c.status === 'blocker')) return 'needed';
            if (found.some((c) => c.status === 'todo')) return 'todo';
            return 'done';
          };
          const done = STEPS.filter((s) => statusOf(s.checks) === 'done').length;
          return (
            <>
              <p className="mb-4 text-[0.9rem] text-charcoal/75">{done} of {STEPS.length} steps done.</p>
              <ol className="space-y-3">
                {STEPS.map((step, i) => {
                  const status = statusOf(step.checks);
                  const details = d.checks.filter((c) => step.checks.includes(c.id) && c.status !== 'ok');
                  return (
                    <li key={step.title}>
                      <Card>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium">
                              <span className="mr-2 text-charcoal/70 tabular-nums">{i + 1}.</span>
                              {step.title}
                            </p>
                            <p className="mt-1 text-[0.85rem] text-charcoal/75">{step.what}</p>
                            {details.length > 0 && (
                              <ul className="mt-2 list-disc pl-5 text-[0.8rem] text-charcoal/75">
                                {details.map((c) => <li key={c.id}>{c.title}: {c.detail}</li>)}
                              </ul>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <Badge tone={status === 'done' ? 'good' : status === 'needed' ? 'bad' : status === 'todo' ? 'warn' : 'neutral'}>
                              {status === 'done' ? 'Done' : status === 'needed' ? 'Needed' : status === 'todo' ? 'To do' : 'Review'}
                            </Badge>
                            {step.who === 'developer' && status !== 'done' && <span className="text-[0.72rem] text-charcoal/70">With your developer</span>}
                            <Link className="inline-flex h-8 items-center rounded-lg border border-charcoal/25 px-3 text-[0.8rem] hover:bg-charcoal/5" to={step.to}>Go there</Link>
                          </div>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ol>
            </>
          );
        }}
      </Loader>
    </>
  );
}
