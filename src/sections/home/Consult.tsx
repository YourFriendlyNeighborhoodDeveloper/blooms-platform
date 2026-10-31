import { useId } from 'react';
import { Link } from 'react-router';
import { motion, useMotionValue, useSpring } from 'motion/react';
import { SilkShader } from '../../components/fx/SilkShader';
import { Eyebrow, FadeIn, RevealText } from '../../components/ui/Reveal';
import { Button } from '../../components/ui/Button';
import { business, links } from '../../data/business';

/** Circular badge: text orbits a magnetic core. */
export function OrbitButton({ to, label, ring }: { to: string; label: string; ring: string }) {
  const id = useId().replace(/:/g, '');
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(mx, { stiffness: 180, damping: 14 });
  const y = useSpring(my, { stiffness: 180, damping: 14 });
  return (
    <Link
      to={to}
      aria-label={label}
      className="group relative grid h-44 w-44 place-items-center sm:h-56 sm:w-56"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mx.set((e.clientX - r.left - r.width / 2) * 0.35);
        my.set((e.clientY - r.top - r.height / 2) * 0.35);
      }}
      onPointerLeave={() => {
        mx.set(0);
        my.set(0);
      }}
    >
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full animate-[spin-slow_18s_linear_infinite] group-hover:animate-[spin-slow_6s_linear_infinite]" aria-hidden="true">
        <defs>
          <path id={id} d="M100,100 m-82,0 a82,82 0 1,1 164,0 a82,82 0 1,1 -164,0" />
        </defs>
        <text fontSize="13.5" letterSpacing="4.2" fill="currentColor" className="uppercase" style={{ fontFamily: 'var(--font-sans)', fontWeight: 600 }}>
          <textPath href={`#${id}`}>{ring}</textPath>
        </text>
      </svg>
      <motion.span
        style={{ x, y }}
        className="relative grid h-24 w-24 place-items-center rounded-full bg-gold text-ink transition-transform duration-500 group-hover:scale-110 sm:h-28 sm:w-28"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" className="transition-transform duration-500 group-hover:-rotate-45">
          <path d="M4 12h15m0 0-6-6m6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </motion.span>
    </Link>
  );
}

export function Consult() {
  return (
    <section data-nav="dark" data-theme="dark" className="relative overflow-hidden bg-charcoal py-28 text-ivory lg:py-44">
      <SilkShader dark resolution={0.4} />
      <div className="shell relative grid items-center gap-14 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Eyebrow index="07" className="text-gold">
            Consultations
          </Eyebrow>
          <RevealText
            text={'Bring the photos you’ve saved,\nthe colors you love — and\n*the feeling you’re after.*'}
            className="mt-8 text-[clamp(2.2rem,5vw,5rem)] leading-[1.02] tracking-[-0.03em]"
            emClassName="italic text-gold"
          />
          <FadeIn delay={0.2} className="mt-10 max-w-xl text-[1.05rem] leading-relaxed text-ivory/75">
            Whether it&rsquo;s a wedding next year or a bouquet for Friday, the first step is a conversation. Share your date, venue and ideas, and Blooms
            will talk through what&rsquo;s possible.
          </FadeIn>
          <FadeIn delay={0.3} className="mt-10 flex flex-wrap gap-3">
            <Button to="/weddings-events#inquire" variant="light" size="lg">
              Start an event inquiry
            </Button>
            <Button href={links.tel} variant="ghost-light" size="lg">
              Call {business.phone.display}
            </Button>
          </FadeIn>
        </div>
        <div className="flex justify-center lg:col-span-4 lg:justify-end">
          <OrbitButton to="/weddings-events#inquire" label="Plan your event" ring="Plan your event · Book a consultation · " />
        </div>
      </div>
    </section>
  );
}
