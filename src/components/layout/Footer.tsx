import { useRef } from 'react';
import { Link } from 'react-router';
import { motion, useScroll, useTransform } from 'motion/react';
import { business, concept, formatTime, links } from '../../data/business';
import { EXTRA_LINKS, NAV_LINKS } from './Nav';
import { OWNER_APPROVED_LAUNCH, useShopHours } from '../../lib/platform';
import { useExperience } from './Experience';
import { useLenis } from './SmoothScroll';
import { Arrow, Button } from '../ui/Button';
import { BloomMark } from '../fx/BloomMark';

export function Footer() {
  const ref = useRef<HTMLElement>(null);
  const { petals, setPetals, reduceMotion } = useExperience();
  const hours = useShopHours();
  const lenis = useLenis();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end end'] });
  const y = useTransform(scrollYProgress, [0, 1], ['-28%', '0%']);
  const wordY = useTransform(scrollYProgress, [0.35, 1], ['60%', '0%']);
  const bloom = useTransform(scrollYProgress, [0.2, 0.95], [0, 1]);

  return (
    <footer ref={ref} data-theme="dark" data-nav="dark" className="relative overflow-hidden bg-ink text-ivory">
      <motion.div style={{ y: reduceMotion ? 0 : y }} className="relative">
        <div className="shell grid gap-14 pt-24 pb-10 lg:grid-cols-12 lg:pt-32">
          <div className="lg:col-span-5">
            <BloomMark size={64} tone="dark" progress={bloom} />
            <h2 className="mt-8 max-w-[14ch] text-[clamp(2.4rem,5.4vw,4.8rem)] leading-[0.98]">
              Have a date, a feeling, or a photo you <em className="text-gold">love?</em>
            </h2>
            <div className="mt-10 flex flex-wrap gap-3">
              <Button to="/weddings-events#inquire" variant="light" size="lg" icon={<Arrow />}>
                Plan your event
              </Button>
              <Button href={links.tel} variant="ghost-light" size="lg">
                Call {business.phone.display}
              </Button>
            </div>
          </div>

          <div className="grid gap-10 sm:grid-cols-[0.8fr_1.35fr_1fr] lg:col-span-7 lg:pt-4">
            <div>
              <h3 className="eyebrow font-sans text-ivory/50">Explore</h3>
              <ul className="mt-5 space-y-2.5">
                {[{ to: '/', label: 'Home' }, ...NAV_LINKS, ...EXTRA_LINKS].map((l) => (
                  <li key={l.to}>
                    <Link to={l.to} className="link-underline text-ivory/85 hover:text-ivory">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="eyebrow font-sans text-ivory/50">Visit</h3>
              <address className="mt-5 space-y-2.5 not-italic text-ivory/85">
                <a href={links.googleDirections} target="_blank" rel="noopener noreferrer" className="link-underline block">
                  {business.address.street}
                  <br />
                  {business.address.city}, {business.address.region} {business.address.postalCode}
                </a>
                <a href={links.tel} className="link-underline block">
                  {business.phone.display}
                </a>
                <a href={links.mailto} className="link-underline block text-[0.9rem] break-all">
                  {business.email}
                </a>
              </address>
              <div className="mt-6 text-sm text-ivory/70">
                {hours.schedule.map((s) => (
                  <p key={s.days}>
                    {s.short} · {formatTime(s.open)}–{formatTime(s.close)}
                  </p>
                ))}
                {!hours.confirmed && <p className="mt-2 text-xs text-gold/90">Hours from the township listing — please call to confirm.</p>}
              </div>
            </div>
            <div>
              <h3 className="eyebrow font-sans text-ivory/50">Elsewhere</h3>
              <ul className="mt-5 space-y-2.5">
                {business.profiles.map((p) => (
                  <li key={p.href}>
                    <a href={p.href} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-2 text-ivory/85 hover:text-ivory">
                      <span className="link-underline">{p.label}</span>
                      <Arrow direction="up-right" className="h-3.5 w-3.5 opacity-60 transition group-hover:opacity-100" />
                    </a>
                    <span className="block text-xs text-ivory/50">{p.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden" aria-hidden="true">
          <motion.p
            style={{ y: reduceMotion ? 0 : wordY, fontVariationSettings: "'SOFT' 100, 'WONK' 1, 'opsz' 144" }}
            className="shell font-display text-[24.5vw] leading-[0.78] font-light tracking-[-0.05em] whitespace-nowrap select-none"
          >
            <span className="bg-gradient-to-b from-gold-soft via-blush to-rose bg-clip-text text-transparent">Blooms</span>
          </motion.p>
        </div>

        <div className="shell flex flex-col gap-5 border-t border-ivory/10 py-7 text-xs text-ivory/55 md:flex-row md:items-center md:justify-between">
          <p className="max-w-3xl leading-relaxed">
            {!OWNER_APPROVED_LAUNCH && `${concept.summary} `}
            {concept.imagery}
          </p>
          <div className="flex shrink-0 items-center gap-3">
            {!reduceMotion && (
              <button
                type="button"
                onClick={() => setPetals(!petals)}
                aria-pressed={petals}
                className="rounded-full border border-ivory/20 px-3.5 py-2 text-ivory/80 transition hover:border-ivory/60 hover:text-ivory"
              >
                Petals: {petals ? 'on' : 'off'}
              </button>
            )}
            <button
              type="button"
              onClick={() => (lenis ? lenis.scrollTo(0, { duration: 2.2 }) : window.scrollTo({ top: 0, behavior: 'smooth' }))}
              className="rounded-full border border-ivory/20 px-3.5 py-2 text-ivory/80 transition hover:border-ivory/60 hover:text-ivory"
            >
              Back to top ↑
            </button>
          </div>
        </div>
      </motion.div>
    </footer>
  );
}
