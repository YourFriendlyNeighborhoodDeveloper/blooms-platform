// Route metadata shared by the client <Seo> component and scripts/postbuild.mjs,
// which writes a static HTML shell per route so link previews get the right tags.

export type PageMeta = {
  path: string;
  title: string;
  description: string;
  ogImage: string;
  label: string;
};

export const SITE_NAME = 'Blooms Boutique & Floral';

export const pages: PageMeta[] = [
  {
    path: '/',
    label: 'Home',
    title: 'Blooms Boutique & Floral — Florist, Events & Boutique in Saginaw, MI',
    description:
      'Beautiful flowers. Thoughtful gifts. Unforgettable celebrations. Custom florals, wedding and event design, and a boutique of clothing, gifts and home décor in Saginaw, Michigan.',
    ogImage: '/og/home.jpg',
  },
  {
    path: '/flowers',
    label: 'Flowers',
    title: 'Flowers & Custom Arrangements — Blooms Boutique & Floral, Saginaw',
    description:
      'Custom arrangements, bouquets and special-occasion flowers designed in Saginaw, Michigan. Call, email or visit Blooms to start an order.',
    ogImage: '/og/flowers.jpg',
  },
  {
    path: '/weddings-events',
    label: 'Weddings & Events',
    title: 'Wedding & Event Florals and Design — Blooms Boutique & Floral',
    description:
      'Bridal bouquets, ceremony décor, reception design, centerpieces and event styling for weddings and celebrations around Saginaw, Michigan.',
    ogImage: '/og/weddings-events.jpg',
  },
  {
    path: '/rentals',
    label: 'Event Rentals',
    title: 'Event Rentals — Arches, Linens, Lighting & Décor | Blooms Saginaw',
    description:
      'Ceremony arches, linens and chair styling, tablescapes, lighting, drapery and decorative accessories. Ask Blooms what is available for your date.',
    ogImage: '/og/rentals.jpg',
  },
  {
    path: '/boutique',
    label: 'Boutique',
    title: 'The Boutique — Clothing, Gifts & Home Décor | Blooms Saginaw',
    description:
      'Clothing, gifts, home décor and seasonal pieces at Blooms Boutique & Floral on Gratiot Road in Saginaw, Michigan.',
    ogImage: '/og/boutique.jpg',
  },
  {
    path: '/about',
    label: 'About & Contact',
    title: 'About & Contact — Blooms Boutique & Floral, Saginaw, MI',
    description:
      'Visit Blooms at 7680 Gratiot Road, Suite 4, Saginaw. Call (989) 600-8752 or send a note about flowers, weddings, rentals or the boutique.',
    ogImage: '/og/about.jpg',
  },
];

export const notFoundMeta: PageMeta = {
  path: '/404',
  label: 'Not found',
  title: 'Page not found — Blooms Boutique & Floral',
  description: 'This page wandered off. Head back to the Blooms homepage.',
  ogImage: '/og/home.jpg',
};
