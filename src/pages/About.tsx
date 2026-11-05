import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { PageHero } from '../sections/shared/PageHero';
import { InquirySection } from '../sections/shared/InquirySection';
import { Visit } from '../sections/shared/Visit';
import { GeneralInquiryForm } from '../components/forms/GeneralInquiryForm';
import { ParallaxImage } from '../components/ui/Motion';
import { Img } from '../components/ui/Img';
import { Arrow } from '../components/ui/Button';
import { Eyebrow, FadeIn, RevealText } from '../components/ui/Reveal';
import { BloomMark } from '../components/fx/BloomMark';
import { business } from '../data/business';
import { useIsDesktop } from '../hooks/useMediaQuery';
import type { ImageKey } from '../lib/images';

const POLAROIDS: Array<{ name: ImageKey; caption: string; x: number; y: number; r: number }> = [
  { name: 'bouquet-blush', caption: 'bouquets', x: 6, y: 10, r: -8 },
  { name: 'aisle', caption: 'the big day', x: 28, y: 30, r: 5 },
  { name: 'reception-table', caption: 'tablescapes', x: 52, y: 6, r: -3 },
  { name: 'gift-pink', caption: 'little gifts', x: 72, y: 34, r: 9 },
  { name: 'home-boho', caption: 'home', x: 14, y: 52, r: 4 },
  { name: 'heart-flowers', caption: 'just because', x: 60, y: 54, r: -6 },
];

/** A pile of polaroids you can pick up and toss around the table. */
function TossTable() {
  const table = useRef<HTMLDivElement>(null);
  const desktop = useIsDesktop();
  const [order, setOrder] = useState(POLAROIDS.map((_, i) => i));
  const lift = (i: number) => setOrder((o) => [...o.filter((x) => x !== i), i]);
  return (
    <section data-nav="light" className="relative overflow-hidden bg-blush py-28 lg:py-36" aria-labelledby="toss-heading">
      <div className="shell">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Eyebrow index="03" className="text-rose-deep">
              Things we love making
            </Eyebrow>
            <RevealText id="toss-heading" text={'Go on, *make a mess.*'} className="mt-6 text-[clamp(2.4rem,5vw,4.8rem)] leading-[1] tracking-[-0.03em]" />
          </div>
          <p className="max-w-sm text-charcoal/70">Pick up a photo and toss it across the table. (Florists&rsquo; work tables rarely stay tidy for long.)</p>
        </div>
        <div
          ref={table}
          role="group"
          aria-label="Decorative pile of illustrative photos you can drag"
          className="relative mt-12 h-[560px] rounded-[32px] border border-charcoal/10 bg-[radial-gradient(120%_80%_at_50%_0%,#f3e6e0,#e2c9c2)] sm:h-[640px]"
          data-cursor="Toss"
        >
          {POLAROIDS.map((p, i) => (
            <motion.div
              key={p.name}
              drag
              dragConstraints={table}
              dragElastic={0.18}
              dragTransition={{ power: 0.35, timeConstant: 320 }}
              onPointerDown={() => lift(i)}
              initial={{ opacity: 0, y: -120, rotate: p.r * 3 }}
              whileInView={{ opacity: 1, y: 0, rotate: p.r }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ type: 'spring', stiffness: 90, damping: 14, delay: i * 0.08 }}
              whileDrag={{ scale: 1.07, rotate: 0, boxShadow: '0 50px 80px -30px rgba(52,47,44,0.55)' }}
              className="absolute touch-none bg-[#fffdf9] p-2.5 pb-10 shadow-[0_20px_40px_-20px_rgba(52,47,44,0.5)] sm:p-3 sm:pb-12"
              style={{ left: `${desktop ? p.x : Math.min(p.x, 48)}%`, top: `${p.y}%`, width: desktop ? 230 : 150, zIndex: order.indexOf(i) + 1 }}
            >
              <Img name={p.name} sizes="240px" className="aspect-square w-full" />
              <p className="absolute inset-x-0 bottom-2 text-center font-display text-[1.05rem] text-charcoal/80 italic sm:bottom-3 sm:text-[1.2rem]">{p.caption}</p>
            </motion.div>
          ))}
          <span className="illustrative-tag absolute right-4 bottom-4 text-charcoal/70">Illustrative photos</span>
        </div>
      </div>
    </section>
  );
}

export default function About() {
  return (
    <>
      <PageHero
        images={['pitcher-blooms', 'rose-blush-wall']}
        word="Hello"
        srTitle="About Blooms Boutique & Floral, and how to get in touch"
        eyebrow="About & contact"
        aside={
          <FadeIn afterIntro delay={0.45} className="text-[1.05rem] leading-relaxed text-charcoal/75">
            Flowers, celebrations and a boutique, together at {business.address.street} in {business.address.city}. Here&rsquo;s a little about the shop — and
            every way to reach it.
          </FadeIn>
        }
      >
        <FadeIn afterIntro delay={0.3}>
          <p className="font-display text-[clamp(1.6rem,2.8vw,2.4rem)] leading-[1.1]">
            Rooted in Saginaw. <em className="text-rose-deep">Made for your moments.</em>
          </p>
        </FadeIn>
      </PageHero>

      <section data-nav="light" className="bg-ivory pb-28 lg:pb-40" aria-labelledby="story-heading">
        <div className="shell grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-6">
            <ParallaxImage name="flower-market" className="aspect-[4/5]" sizes="(min-width:1024px) 50vw, 100vw" />
          </div>
          <div className="lg:col-span-5 lg:col-start-8 lg:pt-16">
            <Eyebrow index="01" className="text-rose-deep">
              The shop
            </Eyebrow>
            <RevealText id="story-heading" text={'Three crafts,\n*one conversation.*'} className="mt-6 text-[clamp(2.4rem,4.6vw,4.4rem)] leading-[1] tracking-[-0.03em]" />
            <FadeIn className="mt-8 space-y-5 text-[1.05rem] leading-relaxed text-charcoal/80">
              <p>
                {business.name} brings three things under one roof: flowers for everyday moments and big ones, design and décor for weddings and
                celebrations, and a boutique of clothing, gifts and home décor.
              </p>
              <p>
                You may also know the wedding side of the business as <em>Magical I Do&rsquo;s</em> — the name behind its Facebook address and its
                listing on The Knot. Couples have left reviews there and on WeddingWire.
              </p>
              <p>What ties it together is how the work starts: with a conversation about you, and a design that grows from there.</p>
            </FadeIn>
          </div>
        </div>
      </section>

      <section data-nav="dark" data-theme="dark" className="bg-charcoal py-28 text-ivory lg:py-36" aria-labelledby="owner-heading">
        <div className="shell grid items-center gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <div className="relative mx-auto aspect-[4/5] max-w-md overflow-hidden rounded-[28px] bg-[radial-gradient(100%_80%_at_50%_20%,#5a4c47,#2b2523)]">
              <div className="absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <BloomMark size={110} tone="dark" spin />
                  <p className="mt-6 font-display text-6xl text-gold italic">ST</p>
                </div>
              </div>
              <span className="illustrative-tag absolute bottom-4 left-4 rounded-full bg-ivory/10 px-2.5 py-1 text-ivory/70">Portrait to be supplied by owner</span>
            </div>
          </div>
          <div className="lg:col-span-6 lg:col-start-7">
            <Eyebrow index="02" className="text-gold">
              Co-owner
            </Eyebrow>
            <RevealText id="owner-heading" as="h2" text={'Samantha *Todd*'} className="mt-6 text-[clamp(3rem,7vw,6.5rem)] leading-[0.95] tracking-[-0.04em]" emClassName="italic text-gold" />
            <FadeIn className="mt-8 space-y-5 text-[1.05rem] leading-relaxed text-ivory/80">
              <p>
                Samantha Todd is a co-owner of {business.name}. In public reviews, clients return again and again to her creativity, her personal
                attention, and her knack for turning inspiration photos and loose ideas into real designs — with the details looked after.
              </p>
              <p className="text-ivory/60">A fuller introduction, in Samantha&rsquo;s own words, would live here once she&rsquo;s happy to share it.</p>
            </FadeIn>
            <div className="mt-10 grid gap-3 sm:grid-cols-3">
              {business.profiles.map((p) => (
                <a
                  key={p.href}
                  href={p.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center justify-between rounded-2xl border border-ivory/15 px-4 py-3 transition hover:border-gold hover:bg-ivory/5"
                >
                  <span>
                    <span className="block font-display text-lg">{p.label}</span>
                    <span className="block text-[0.72rem] text-ivory/55">{p.note}</span>
                  </span>
                  <Arrow direction="up-right" className="opacity-60 transition group-hover:opacity-100" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      <TossTable />

      <InquirySection
        id="contact"
        index="04"
        eyebrow="General inquiry"
        tone="ivory"
        heading={'Drop the shop\na *line.*'}
        intro={
          <>
            Questions about flowers, a celebration, rentals or the boutique — all welcome. For weddings and events, the{' '}
            <Link to="/weddings-events#inquire" className="link-underline text-rose-deep">
              event inquiry
            </Link>{' '}
            asks the right questions up front.
          </>
        }
      >
        <GeneralInquiryForm />
      </InquirySection>

      <Visit index="05" heading={'Find us on *Gratiot.*'} />
    </>
  );
}
