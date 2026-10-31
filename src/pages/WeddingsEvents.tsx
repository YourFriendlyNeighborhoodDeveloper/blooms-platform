import { CinematicHero } from '../sections/weddings/CinematicHero';
import { WeddingGallery } from '../sections/weddings/Gallery';
import { Chapters } from '../sections/weddings/Chapters';
import { Process } from '../sections/weddings/Process';
import { WordBand } from '../sections/shared/WordBand';
import { InquirySection } from '../sections/shared/InquirySection';
import { EventInquiryForm } from '../components/forms/EventInquiryForm';
import { Eyebrow, ScrollText } from '../components/ui/Reveal';
import { Img } from '../components/ui/Img';

export default function WeddingsEvents() {
  return (
    <>
      <CinematicHero />
      <section data-nav="light" className="bg-ivory py-28 lg:py-40">
        <div className="shell">
          <Eyebrow index="01" className="text-rose-deep">
            Every kind of celebration
          </Eyebrow>
          <ScrollText
            className="mt-10 max-w-[21ch] font-display text-[clamp(2rem,5vw,4.8rem)] leading-[1.06] tracking-[-0.03em]"
            parts={[
              'From the first bouquet sketch to the last centerpiece',
              { label: 'bouquet', image: <Img name="rings-roses" sizes="12vw" className="h-full w-full" inline /> },
              '— flowers, décor and the details in between, for weddings, engagements, rehearsals,',
              { label: 'table', image: <Img name="toast-lights" sizes="12vw" className="h-full w-full" inline /> },
              'showers, graduations, birthdays and anniversaries.',
            ]}
          />
        </div>
      </section>
      <WeddingGallery />
      <Chapters />
      <WordBand tone="dark" words={['Weddings', 'Engagements', 'Rehearsals', 'Showers', 'Graduations', 'Birthdays', 'Anniversaries']} />
      <Process />
      <InquirySection
        id="inquire"
        index="05"
        eyebrow="Event inquiry"
        heading={'Let’s plan something\n*beautiful.*'}
        intro={
          <>
            Share the essentials and a little about the feeling you&rsquo;re after. The more you tell, the better the first conversation — inspiration
            photos, colors and must-haves are all welcome.
          </>
        }
      >
        <EventInquiryForm />
      </InquirySection>
    </>
  );
}
