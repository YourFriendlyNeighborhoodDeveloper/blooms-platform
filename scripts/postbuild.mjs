// Runs after `vite build`. Writes a static HTML shell per route (so link previews and
// crawlers see the right title, description and Open Graph image without running JS),
// plus robots.txt, sitemap.xml and Cloudflare Pages headers.
//
//   SITE_URL   absolute origin used for canonical/OG URLs (default: the preview domain)
//   SITE_MODE  "production" to allow indexing; anything else builds a noindex preview
import fs from 'node:fs/promises';
import path from 'node:path';
import { pages, notFoundMeta, SITE_NAME } from '../src/data/seo.ts';
import { business, fullAddress } from '../src/data/business.ts';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const SITE_URL = (process.env.SITE_URL || 'https://abraxas-blooms-concept.pages.dev').replace(/\/$/, '');
const production = process.env.SITE_MODE === 'production';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Structured data uses only confirmed facts. Hours are unverified, so they are omitted.
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Florist',
  name: business.name,
  url: SITE_URL + '/',
  image: SITE_URL + '/og/home.jpg',
  telephone: business.phone.e164,
  email: business.email,
  address: {
    '@type': 'PostalAddress',
    streetAddress: business.address.street,
    addressLocality: business.address.city,
    addressRegion: business.address.region,
    postalCode: business.address.postalCode,
    addressCountry: business.address.country,
  },
  sameAs: business.profiles.map((p) => p.href),
};

function seoBlock(meta) {
  const url = SITE_URL + (meta.path === '/404' ? '/' : meta.path);
  const image = SITE_URL + meta.ogImage;
  const lines = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<meta name="robots" content="${production ? 'index, follow' : 'noindex, nofollow'}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(`${SITE_NAME} — ${meta.label}`)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
    `<meta name="geo.region" content="US-MI" />`,
    `<meta name="geo.placename" content="${esc(business.address.city)}" />`,
  ];
  if (meta.path === '/' || meta.path === '/about') {
    lines.push(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`);
  }
  return lines.join('\n    ');
}

const template = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
const START = '<!-- seo:start -->';
const END = '<!-- seo:end -->';
if (!template.includes(START) || !template.includes(END)) throw new Error('SEO markers missing from dist/index.html');

const render = (meta) => template.replace(new RegExp(`${START}[\\s\\S]*?${END}`), `${START}\n    ${seoBlock(meta)}\n    ${END}`);

// "flowers.html" is served at /flowers by Cloudflare Pages (and vite preview) with no
// trailing-slash redirect, so client routes and static shells share the same URLs.
for (const meta of pages) {
  const file = meta.path === '/' ? path.join(dist, 'index.html') : path.join(dist, `${meta.path.slice(1)}.html`);
  await fs.writeFile(file, render(meta));
}
// /contact is a client-side redirect to /about#contact; give it a shell so it never 404s.
await fs.writeFile(path.join(dist, 'contact.html'), render(pages.find((p) => p.path === '/about')));
// Cloudflare Pages serves 404.html (with a 404 status) for unknown paths; the SPA renders the not-found page.
await fs.writeFile(path.join(dist, '404.html'), render(notFoundMeta));

const today = new Date().toISOString().slice(0, 10);
await fs.writeFile(
  path.join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${SITE_URL}${p.path}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>${p.path === '/' ? '1.0' : '0.8'}</priority></url>`).join('\n')}
</urlset>
`,
);

await fs.writeFile(
  path.join(dist, 'robots.txt'),
  production
    ? `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`
    : `# Design concept preview — not the official ${business.name} website.\nUser-agent: *\nDisallow: /\n`,
);

await fs.writeFile(
  path.join(dist, '_headers'),
  `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
  X-Frame-Options: SAMEORIGIN
${production ? '' : '  X-Robots-Tag: noindex, nofollow\n'}
/assets/*
  Cache-Control: public, max-age=31536000, immutable

/img/*
  Cache-Control: public, max-age=2592000

/og/*
  Cache-Control: public, max-age=86400
`,
);

console.log(`postbuild: ${pages.length + 2} HTML shells, sitemap, robots (${production ? 'production' : 'preview / noindex'}) for ${SITE_URL}`);
console.log(`postbuild: structured data → ${fullAddress}`);
