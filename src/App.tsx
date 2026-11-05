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
import { PLATFORM_ENABLED, PlatformProvider } from './lib/platform';
import { CartProvider } from './shop/CartContext';

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

const AdminApp = lazy(() => import('./admin/AdminApp'));

const privateMeta = (path: string, label: string): PageMeta => ({ path, label, title: `${label} — Blooms Boutique & Floral`, description: 'Blooms Boutique & Floral', ogImage: '/og/home.jpg' });

/** Store, account and planner routes. They exist only in the platform build, never in the static concept preview. */
const platformRoutes: Array<{ path: string; meta: PageMeta; Page: LazyExoticComponent<ComponentType> }> = PLATFORM_ENABLED
  ? [
      { path: '/shop', meta: metaFor('/shop'), Page: lazy(() => import('./pages/shop/Shop')) },
      { path: '/shop/:slug', meta: privateMeta('/shop', 'Shop'), Page: lazy(() => import('./pages/shop/ProductPage')) },
      { path: '/cart', meta: privateMeta('/cart', 'Your cart'), Page: lazy(() => import('./pages/shop/CartPage')) },
      { path: '/checkout', meta: privateMeta('/checkout', 'Checkout'), Page: lazy(() => import('./pages/shop/Checkout')) },
      { path: '/track', meta: privateMeta('/track', 'Order status'), Page: lazy(() => import('./pages/shop/Track').then((m) => ({ default: m.TrackLookup }))) },
      { path: '/track/:token', meta: privateMeta('/track', 'Order status'), Page: lazy(() => import('./pages/shop/Track')) },
      { path: '/plan', meta: metaFor('/plan'), Page: lazy(() => import('./pages/planner/Planner')) },
      { path: '/plan/:token', meta: privateMeta('/plan', 'Your plan'), Page: lazy(() => import('./pages/planner/InquiryPortal')) },
      { path: '/quote/:token', meta: privateMeta('/quote', 'Your quote'), Page: lazy(() => import('./pages/planner/QuotePage')) },
      { path: '/pay/:token', meta: privateMeta('/pay', 'Payment'), Page: lazy(() => import('./pages/planner/PayInvoice')) },
      { path: '/project/:token', meta: privateMeta('/project', 'Your event'), Page: lazy(() => import('./pages/planner/ProjectPortal')) },
      { path: '/account', meta: privateMeta('/account', 'Your account'), Page: lazy(() => import('./pages/account/Account')) },
      { path: '/account/verify/:token', meta: privateMeta('/account', 'Signing in'), Page: lazy(() => import('./pages/account/Verify')) },
      { path: '/preferences/:token', meta: privateMeta('/preferences', 'Your preferences'), Page: lazy(() => import('./pages/account/Preferences')) },
      { path: '/live', meta: metaFor('/live'), Page: lazy(() => import('./pages/Live')) },
      { path: '/privacy', meta: privateMeta('/privacy', 'Privacy'), Page: lazy(() => import('./pages/Policy').then((m) => ({ default: m.PrivacyPage }))) },
      { path: '/terms', meta: privateMeta('/terms', 'Terms'), Page: lazy(() => import('./pages/Policy').then((m) => ({ default: m.TermsPage }))) },
    ]
  : [];

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
        {platformRoutes.map(({ path, meta, Page }) => (
          <Route
            key={path}
            path={path}
            element={
              <PageShell meta={meta}>
                <Suspense fallback={<PageFallback />}>
                  <Page />
                </Suspense>
              </PageShell>
            }
          />
        ))}
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
  const { pathname } = useLocation();
  if (PLATFORM_ENABLED && pathname.startsWith('/admin')) {
    // The dashboard is a work tool: same fonts and palette, none of the marketing site's motion.
    return (
      <Suspense fallback={<PageFallback />}>
        <AdminApp />
      </Suspense>
    );
  }
  return (
    <PlatformProvider>
      <CartProvider>
        <ExperienceProvider>
          <SmoothScroll>
            <Chrome />
          </SmoothScroll>
        </ExperienceProvider>
      </CartProvider>
    </PlatformProvider>
  );
}
