import { BloomMark } from '../components/fx/BloomMark';
import { Arrow, Button } from '../components/ui/Button';
import { NAV_LINKS } from '../components/layout/Nav';
import { Link } from 'react-router';

export default function NotFound() {
  return (
    <section data-nav="light" className="relative flex min-h-[100svh] items-center bg-ivory pt-24 pb-20">
      <div className="shell text-center">
        <div className="flex justify-center">
          <BloomMark size={120} spin />
        </div>
        <p className="eyebrow mt-10 text-rose-deep">404</p>
        <h1 className="mx-auto mt-4 max-w-[14ch] text-[clamp(2.8rem,7vw,6.5rem)] leading-[0.98] tracking-[-0.04em]">
          This stem <em className="text-rose-deep">wandered off.</em>
        </h1>
        <p className="mx-auto mt-6 max-w-md text-charcoal/70">The page you&rsquo;re looking for isn&rsquo;t here. Try one of these instead.</p>
        <div className="mt-10 flex justify-center">
          <Button to="/" size="lg" icon={<Arrow />}>
            Back to the homepage
          </Button>
        </div>
        <ul className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[0.95rem]">
          {NAV_LINKS.map((l) => (
            <li key={l.to}>
              <Link to={l.to} className="link-underline">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
