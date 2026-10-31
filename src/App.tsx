import { lazy, Suspense, useEffect, useRef, type ComponentType, type LazyExoticComponent } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { AnimatePresence } from 'motion/react';
import { ExperienceProvider, useExperience } from './components/layout/Experience';
import { SmoothScroll, scrollToTarget, scrollToTop, useLenis } from './components/layout/SmoothScroll';
import { Nav } from './components/layout/Nav';
import { Footer } from './components/layout/Footer';
import { ConceptBadge } from './components/layout/ConceptBadge';
import { PageShell } from './components/layout/PageShell';
import { Intro } from './components/layout/Intro';
import { Cursor } from './components/fx/Cursor';
import { PetalField } from './components/fx/PetalField';
import { notFoundMeta, pages, type PageMeta } from './data/seo';
import Home from './pages/Home';

const loaders = {
  '/flowers': () => import('./pages/Flowers'),
  '/weddings-events': () => import('./pages/WeddingsEvents'),
  '/rentals': () => import('./pages/Rentals'),
  '/boutique': () => import('./pages/Boutique'),
  '/about': () => import('./pages/About'),
} as const;

const lazyPages = Object.fromEntries(Object.entries(loaders).map(([path, load]) => [path, lazy(load)])) as unknown as Record<keyof typeof loaders, LazyExoticComponent<ComponentType>>;
const NotFound = lazy(() => import('./pages/NotFound'));

const metaFor = (path: string) => pages.find((p) => p.path === path) as PageMeta;

function PageFallback() {
  return <div className="min-h-[100svh]" />;
}

function AnimatedRoutes() {
  const location = useLocation();
  const lenis = useLenis();
  return (
    <AnimatePresence mode="wait" onExitComplete={() => scrollToTop(lenis)}>
      <Routes location={location} key={location.pathname}>
        <Route
          path="/"
          element={
            <PageShell meta={metaFor('/')}>
              <Home />
            </PageShell>
          }
        />
        {(Object.keys(lazyPages) as Array<keyof typeof lazyPages>).map((path) => {
          const Page = lazyPages[path];
          return (
            <Route
              key={path}
              path={path}
              element={
                <PageShell meta={metaFor(path)}>
                  <Suspense fallback={<PageFallback />}>
                    <Page />
                  </Suspense>
                </PageShell>
              }
            />
          );
        })}
        <Route path="/contact" element={<Navigate to="/about#contact" replace />} />
        <Route
          path="*"
          element={
            <PageShell meta={notFoundMeta}>
              <Suspense fallback={<PageFallback />}>
                <NotFound />
              </Suspense>
            </PageShell>
          }
        />
      </Routes>
    </AnimatePresence>
  );
}

/**
 * Scrolls to #hash targets. Arriving from another page, it jumps while the curtain
 * still covers the screen so the curtain lifts straight onto the target; within a
 * page it glides there.
 */
function HashScroller() {
  const location = useLocation();
  const lenis = useLenis();
  const { introDone } = useExperience();
  const prevPath = useRef(location.pathname);
  useEffect(() => {
    const changedPage = prevPath.current !== location.pathname;
    prevPath.current = location.pathname;
    if (!location.hash || !introDone) return;
    const id = decodeURIComponent(location.hash.slice(1));
    let tries = 0;
    let timer = window.setTimeout(
      function attempt() {
        const el = document.getElementById(id);
        if (el) scrollToTarget(lenis, el, -90, changedPage);
        else if (tries++ < 30) timer = window.setTimeout(attempt, 120);
      },
      changedPage ? 950 : 60,
    );
    return () => window.clearTimeout(timer);
  }, [location.key, location.pathname, location.hash, lenis, introDone]);
  return null;
}

/** After a page change, hand focus to the new page so screen readers announce it. */
function RouteFocus() {
  const location = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (location.hash) return;
    const t = window.setTimeout(() => document.getElementById('main')?.focus({ preventScroll: true }), 1000);
    return () => window.clearTimeout(t);
  }, [location.pathname, location.hash]);
  return null;
}

function Prefetch() {
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 2500));
    idle(() => Object.values(loaders).forEach((load) => load()));
  }, []);
  return null;
}

function Chrome() {
  const { petals } = useExperience();
  return (
    <div className="grain">
      <Intro />
      <Cursor />
      <PetalField enabled={petals} />
      <Nav />
      <main id="main" tabIndex={-1} className="relative outline-none">
        <AnimatedRoutes />
      </main>
      <Footer />
      <ConceptBadge />
      <HashScroller />
      <RouteFocus />
      <Prefetch />
    </div>
  );
}

export default function App() {
  return (
    <ExperienceProvider>
      <SmoothScroll>
        <Chrome />
      </SmoothScroll>
    </ExperienceProvider>
  );
}
