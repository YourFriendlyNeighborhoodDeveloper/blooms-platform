import { motion } from 'motion/react';
import { business } from '../../data/business';
import { Eyebrow, FadeIn, RevealText } from '../../components/ui/Reveal';
import { Arrow } from '../../components/ui/Button';

const THEMES = [
  { title: 'Creativity', body: 'Reviewers single out Samantha’s creativity and eye for design.' },
  { title: 'Personal attention', body: 'Clients describe personalised, attentive service from the first conversation on.' },
  { title: 'Inspiration, made real', body: 'Couples describe their inspiration photos and ideas translated into real designs.' },
  { title: 'Every detail', body: 'Reviews note close attention to the details that make an event come together.' },
];

/** Cards with a soft spotlight that follows the pointer across the grid. */
export function Trust() {
  return (
    <section data-nav="light" className="relative overflow-hidden bg-blush py-28 lg:py-40">
      <div className="shell">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-6">
            <Eyebrow index="06" className="text-rose-deep">
              In their words, on their sites
            </Eyebrow>
            <RevealText text={'What people keep\n*coming back to.*'} className="mt-6 text-[clamp(2.4rem,5.4vw,5.2rem)] leading-[1] tracking-[-0.03em]" />
          </div>
          <FadeIn className="self-end lg:col-span-5 lg:col-start-8">
            <p className="text-[1.05rem] leading-relaxed text-charcoal/80">
              Public reviews of {business.coOwner}&rsquo;s work return to the same few themes. We&rsquo;d rather you read them where they were written than
              take a website&rsquo;s word for it.
            </p>
          </FadeIn>
        </div>

        <div
          className="group/grid mt-14 grid gap-3 sm:grid-cols-2 lg:mt-20 lg:grid-cols-4"
          onPointerMove={(e) => {
            for (const card of e.currentTarget.querySelectorAll<HTMLElement>('[data-spot]')) {
              const r = card.getBoundingClientRect();
              card.style.setProperty('--sx', `${e.clientX - r.left}px`);
              card.style.setProperty('--sy', `${e.clientY - r.top}px`);
            }
          }}
        >
          {THEMES.map((t, i) => (
            <motion.article
              key={t.title}
              data-spot
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '0px 0px -10% 0px' }}
              transition={{ duration: 1, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="relative overflow-hidden rounded-[22px] border border-charcoal/10 bg-ivory/60 p-7 lg:min-h-[300px] lg:p-8"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover/grid:opacity-100"
                style={{ background: 'radial-gradient(420px circle at var(--sx, 50%) var(--sy, 50%), rgba(184,127,137,0.28), transparent 60%)' }}
              />
              <span className="relative font-display text-5xl text-rose/70 italic">0{i + 1}</span>
              <h3 className="relative mt-10 text-[1.9rem] leading-tight">{t.title}</h3>
              <p className="relative mt-3 text-[0.95rem] leading-relaxed text-charcoal/75">{t.body}</p>
            </motion.article>
          ))}
        </div>

        <div className="mt-14 grid gap-3 md:grid-cols-3">
          {business.profiles.map((p) => (
            <a
              key={p.href}
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between rounded-full border border-charcoal/20 py-3 pr-3 pl-6 transition-colors duration-500 hover:bg-charcoal hover:text-ivory"
            >
              <span>
                <span className="font-display text-xl">{p.kind === 'reviews' ? `Read reviews on ${p.label}` : `Visit on ${p.label}`}</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </span>
              <span className="grid h-11 w-11 place-items-center rounded-full bg-charcoal text-ivory transition-colors duration-500 group-hover:bg-ivory group-hover:text-charcoal">
                <Arrow direction="up-right" />
              </span>
            </a>
          ))}
        </div>
        <p className="mt-6 text-[0.78rem] text-charcoal/70">
          Themes summarised from public reviews on WeddingWire and The Knot (where the listing still uses the Magical I Do&rsquo;s name). No reviews are
          reproduced or edited here.
        </p>
      </div>
    </section>
  );
}
