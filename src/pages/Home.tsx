import { Hero } from '../sections/home/Hero';
import { Manifesto } from '../sections/home/Manifesto';
import { ServiceStack } from '../sections/home/ServiceStack';
import { GalleryReel } from '../sections/home/GalleryReel';
import { BoutiqueList } from '../sections/home/BoutiqueList';
import { Trust } from '../sections/home/Trust';
import { Consult } from '../sections/home/Consult';
import { Visit } from '../sections/shared/Visit';
import { WordBand } from '../sections/shared/WordBand';
import { Atelier } from '../components/atelier/Atelier';
import { Eyebrow, RevealText } from '../components/ui/Reveal';
import { HomePromos, FeaturedVideo } from '../sections/home/Promos';

export default function Home() {
  return (
    <>
      <Hero />
      <HomePromos />
      <Manifesto />
      <ServiceStack />
      <WordBand words={['Flowers', 'Weddings', 'Events', 'Boutique', 'Gifts', 'Home']} />
      <GalleryReel />
      <section data-nav="light" className="relative bg-ivory py-28 lg:py-40" aria-labelledby="atelier-heading">
        <div className="shell">
          <div className="mb-14 flex flex-col gap-6 lg:mb-20 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Eyebrow index="04" className="text-rose-deep">
                The Atelier
              </Eyebrow>
              <RevealText id="atelier-heading" text={'Play florist\nfor a *minute.*'} className="mt-6 text-[clamp(2.4rem,5.4vw,5.2rem)] leading-[1] tracking-[-0.03em]" />
            </div>
            <p className="max-w-sm text-charcoal/70">
              Add stems, pick a palette, then run your cursor (or finger) through the bouquet. When it feels right, send the idea along as a starting
              point.
            </p>
          </div>
          <Atelier />
        </div>
      </section>
      <BoutiqueList />
      <Trust />
      <FeaturedVideo />
      <Consult />
      <Visit />
    </>
  );
}
