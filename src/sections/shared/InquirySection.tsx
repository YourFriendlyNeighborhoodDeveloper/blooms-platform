import type { ReactNode } from 'react';
import { business, links } from '../../data/business';
import { Eyebrow, RevealText } from '../../components/ui/Reveal';
import { HoursCard } from './Visit';

/** Two-column inquiry layout: sticky context + direct contact on the left, the form on the right. */
export function InquirySection({
  id,
  index,
  eyebrow,
  heading,
  intro,
  children,
  tone = 'blush',
}: {
  id: string;
  index: string;
  eyebrow: string;
  heading: string;
  intro: ReactNode;
  children: ReactNode;
  tone?: 'blush' | 'ivory';
}) {
  return (
    <section id={id} data-nav="light" className={tone === 'blush' ? 'relative scroll-mt-24 bg-blush py-28 lg:py-40' : 'relative scroll-mt-24 bg-ivory-deep py-28 lg:py-40'} aria-labelledby={`${id}-heading`}>
      <div className="shell grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-28">
            <Eyebrow index={index} className="text-rose-deep">
              {eyebrow}
            </Eyebrow>
            <RevealText id={`${id}-heading`} text={heading} className="mt-6 text-[clamp(2.4rem,5vw,4.8rem)] leading-[1] tracking-[-0.03em]" />
            <div className="mt-6 max-w-md text-[1.02rem] leading-relaxed text-charcoal/75">{intro}</div>
            <dl className="mt-10 space-y-5 border-t border-charcoal/15 pt-8">
              <div>
                <dt className="eyebrow text-charcoal/80">Prefer to talk?</dt>
                <dd className="mt-1">
                  <a href={links.tel} className="link-underline font-display text-[1.7rem]">
                    {business.phone.display}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="eyebrow text-charcoal/80">Email</dt>
                <dd className="mt-1">
                  <a href={links.mailto} className="link-underline break-all">
                    {business.email}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="eyebrow text-charcoal/80">Visit</dt>
                <dd className="mt-1">
                  <a href={links.googleDirections} target="_blank" rel="noopener noreferrer" className="link-underline">
                    {business.address.street}, {business.address.city}
                  </a>
                </dd>
              </div>
            </dl>
            <HoursCard className="mt-8 hidden lg:block" />
          </div>
        </div>
        <div className="lg:col-span-7">{children}</div>
      </div>
    </section>
  );
}
