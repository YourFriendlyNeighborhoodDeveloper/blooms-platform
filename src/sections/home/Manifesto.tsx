import { Link } from 'react-router';
import { Img } from '../../components/ui/Img';
import { Eyebrow, FadeIn, ScrollText } from '../../components/ui/Reveal';
import { Arrow } from '../../components/ui/Button';

export function Manifesto() {
  return (
    <section data-nav="light" className="relative bg-ivory py-28 lg:py-44">
      <div className="shell">
        <Eyebrow index="01" className="text-rose-deep">
          The shop on Gratiot
        </Eyebrow>
        <ScrollText
          className="mt-10 max-w-[19ch] font-display text-[clamp(2.1rem,5.6vw,5.4rem)] leading-[1.04] tracking-[-0.03em] text-charcoal"
          parts={[
            'Your vision,',
            { label: 'bouquet', image: <Img name="bouquet-white" sizes="12vw" className="h-full w-full" inline /> },
            'beautifully brought to life. Flowers',
            { label: 'rings', image: <Img name="rings-blooms" sizes="12vw" className="h-full w-full" inline /> },
            'and details for life’s most meaningful moments —',
            { label: 'flowers', image: <Img name="flower-market" sizes="12vw" className="h-full w-full" inline /> },
            'thoughtfully designed in Saginaw, Michigan.',
          ]}
        />
        <div className="mt-16 grid gap-10 lg:mt-24 lg:grid-cols-12">
          <FadeIn className="lg:col-span-5 lg:col-start-7">
            <p className="text-[1.08rem] leading-relaxed text-charcoal/80">
              Blooms Boutique &amp; Floral is a florist, an event designer and a boutique in one — custom flowers for everyday moments, wedding and event
              design with the details handled, and a shop of clothing, gifts and home décor. It&rsquo;s the kind of place where a conversation turns into a
              design.
            </p>
            <Link to="/about" className="group mt-7 inline-flex items-center gap-3 text-[0.95rem] font-medium text-rose-deep">
              <span className="link-underline">Meet the shop</span>
              <Arrow className="transition-transform duration-500 group-hover:translate-x-1" />
            </Link>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
