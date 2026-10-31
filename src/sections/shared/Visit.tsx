import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { business, formatTime, links, publishedHoursStatus } from '../../data/business';
import { Eyebrow, FadeIn, RevealText } from '../../components/ui/Reveal';
import { Arrow, Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';

function useHoursStatus() {
  const [status, setStatus] = useState(() => publishedHoursStatus());
  useEffect(() => {
    const id = window.setInterval(() => setStatus(publishedHoursStatus()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return status;
}

export function HoursCard({ tone = 'light', className }: { tone?: 'light' | 'dark'; className?: string }) {
  const status = useHoursStatus();
  return (
    <div className={cn('rounded-[22px] border p-6', tone === 'dark' ? 'border-ivory/15' : 'border-charcoal/12 bg-ivory/50', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="eyebrow font-sans">Shop hours</h3>
        <span
          className={cn(
            'inline-flex items-center gap-2 rounded-full px-3 py-1 text-[0.75rem]',
            status.open ? 'bg-sage/15 text-sage-deep' : tone === 'dark' ? 'bg-ivory/10 text-ivory/80' : 'bg-charcoal/8 text-charcoal/75',
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', status.open ? 'bg-sage' : 'bg-rose')} aria-hidden="true" />
          {status.open ? `Per listed hours: open until ${status.closesAt}` : 'Per listed hours: closed now'}
        </span>
      </div>
      <dl className="mt-5 space-y-2.5">
        {business.hours.schedule.map((s) => (
          <div key={s.days} className="flex justify-between gap-4 border-b border-current/10 pb-2.5">
            <dt>{s.days}</dt>
            <dd className="tabular-nums">
              {formatTime(s.open)} – {formatTime(s.close)}
            </dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 opacity-70">
          <dt>Sunday &amp; Monday</dt>
          <dd>Not listed</dd>
        </div>
      </dl>
      <p className={cn('mt-4 flex gap-2 text-[0.8rem] leading-snug', tone === 'dark' ? 'text-gold' : 'text-rose-deep')}>
        <span aria-hidden="true">⚑</span>
        <span>
          Unverified: taken from the {business.hours.source.toLowerCase()}. Please call {business.phone.display} to confirm before visiting.
        </span>
      </p>
    </div>
  );
}

/** Stylised, not-to-scale map that opens real directions. */
export function StylizedMap({ className }: { className?: string }) {
  return (
    <a
      href={links.googleMaps}
      target="_blank"
      rel="noopener noreferrer"
      data-cursor="Directions"
      aria-label={`Open ${business.address.street}, ${business.address.city} in Google Maps (opens in a new tab)`}
      className={cn('group relative block overflow-hidden rounded-[28px] bg-[#efe6dc]', className)}
    >
      <svg viewBox="0 0 600 520" className="h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="600" height="520" fill="#efe6dc" />
        {Array.from({ length: 14 }, (_, i) => (
          <path key={`h${i}`} d={`M-20 ${i * 40 + 10} L620 ${i * 40 - 30}`} stroke="#e2d6c9" strokeWidth="1" />
        ))}
        {Array.from({ length: 16 }, (_, i) => (
          <path key={`v${i}`} d={`M${i * 42} -10 L${i * 42 + 40} 540`} stroke="#e2d6c9" strokeWidth="1" />
        ))}
        <path d="M-40 380 C 120 330 220 300 330 250 S 520 150 660 110" stroke="#dcc6a6" strokeWidth="26" fill="none" strokeLinecap="round" />
        <path d="M-40 380 C 120 330 220 300 330 250 S 520 150 660 110" stroke="#f6f0e9" strokeWidth="2" strokeDasharray="10 10" fill="none" />
        <path d="M180 -20 C 200 120 240 200 300 270 S 380 420 400 560" stroke="#e8dccf" strokeWidth="12" fill="none" />
        <path d="M-20 120 C 120 140 240 120 360 60" stroke="#e8dccf" strokeWidth="9" fill="none" />
        <path d="M420 540 C 470 420 520 360 640 330" stroke="#e8dccf" strokeWidth="9" fill="none" />
        <circle cx="110" cy="200" r="46" fill="#dfe3d3" />
        <circle cx="500" cy="420" r="60" fill="#dfe3d3" />
        <text x="430" y="132" fontSize="15" fill="#8a7c6c" transform="rotate(-17 430 132)" style={{ fontFamily: 'var(--font-sans)', letterSpacing: '0.18em', fontWeight: 600 }}>
          GRATIOT RD
        </text>
      </svg>
      <div className="absolute top-[47%] left-[55%] -translate-x-1/2 -translate-y-full">
        <span className="absolute top-full left-1/2 h-4 w-10 -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-charcoal/20 blur-[2px]" />
        <span className="absolute top-full left-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-rose" style={{ animation: 'pulse-ring 2.6s ease-out infinite' }} />
        <motion.span
          className="relative flex flex-col items-center"
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          <span className="rounded-full bg-charcoal px-4 py-2 text-[0.8rem] whitespace-nowrap text-ivory shadow-lg">Blooms · Suite 4</span>
          <span className="-mt-1 h-3 w-3 rotate-45 bg-charcoal" />
        </motion.span>
      </div>
      <div className="absolute inset-x-4 bottom-4 flex items-center justify-between rounded-full bg-ivory/85 py-2 pr-2 pl-5 text-[0.85rem] backdrop-blur-md">
        <span>
          {business.address.street}, {business.address.city}
        </span>
        <span className="grid h-10 w-10 place-items-center rounded-full bg-charcoal text-ivory transition-transform duration-500 group-hover:-rotate-45">
          <Arrow />
        </span>
      </div>
      <span className="illustrative-tag absolute top-4 left-4 rounded-full bg-ivory/80 px-2.5 py-1 text-charcoal/70">Stylised map · not to scale</span>
    </a>
  );
}

export function Visit({ index = '08', heading = 'Come say *hello.*' }: { index?: string; heading?: string }) {
  return (
    <section data-nav="light" className="relative bg-ivory py-28 lg:py-40" aria-labelledby="visit-heading">
      <div className="shell grid gap-14 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <Eyebrow index={index} className="text-rose-deep">
            Visit &amp; contact
          </Eyebrow>
          <RevealText id="visit-heading" text={heading} className="mt-6 text-[clamp(2.6rem,6vw,5.6rem)] leading-[0.98] tracking-[-0.03em]" />
          <FadeIn className="mt-10 space-y-6">
            <address className="not-italic">
              <p className="eyebrow text-charcoal/50">Address</p>
              <p className="mt-2 font-display text-[1.6rem] leading-snug">
                {business.address.street}
                <br />
                {business.address.city}, {business.address.regionName} {business.address.postalCode}
              </p>
            </address>
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <p className="eyebrow text-charcoal/50">Phone</p>
                <a href={links.tel} className="link-underline mt-2 inline-block font-display text-[1.6rem]">
                  {business.phone.display}
                </a>
              </div>
              <div>
                <p className="eyebrow text-charcoal/50">Email</p>
                <a href={links.mailto} className="link-underline mt-2 inline-block text-[1.02rem] break-all">
                  {business.email}
                </a>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button href={links.tel} variant="solid">
                Call the shop
              </Button>
              <Button href={links.googleDirections} external variant="outline" icon={<Arrow direction="up-right" />}>
                Directions
              </Button>
              <Button href={links.appleMaps} external variant="outline">
                Apple Maps
              </Button>
            </div>
          </FadeIn>
        </div>
        <div className="grid gap-4 lg:col-span-7">
          <StylizedMap className="aspect-[6/5] sm:aspect-[6/4]" />
          <HoursCard />
        </div>
      </div>
    </section>
  );
}
