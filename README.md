# Blooms Boutique & Floral — website concept

An independent, speculative website design for **Blooms Boutique & Floral** (7680 Gratiot Road, Suite 4, Saginaw, MI) by **Abraxas Technologies**.

> **This is not the official Blooms website.** It has not been commissioned, it is not a live storefront, and preview builds are marked `noindex`. Photography is illustrative stock from Unsplash and does not show Blooms' own work. Forms validate input but never send anything.

## What's in it

Six routes — Home, Flowers, Weddings & Events, Event Rentals, Boutique, About & Contact — plus a 404, built as a motion-first experience:

- **WebGL silk shader** (raw WebGL, no 3D library) behind the hero and consultation sections, twisted by the cursor.
- **Petal field**: a global canvas of petals that drift, parallax with scroll, scatter in the cursor's wind and burst from every click. Toggle in the footer; off under reduced motion.
- **Variable-type wordmarks**: Fraunces' weight, SOFT and WONK axes respond per-letter to cursor distance (a slow wave on touch devices).
- **The Atelier**: a generative SVG bouquet sketchpad (7 flower kinds, 4 palettes, 3 finishes) with spring physics you can brush through; "Send this idea" pre-fills the contact form.
- Page-transition curtains, a first-visit intro, custom cursor with contextual labels, magnetic buttons, Lenis smooth scrolling, scroll-lit manifesto text, stacking service cards, a pinned horizontal gallery, a cinematic letterboxed hero with a running timecode, sticky chapter theatre, a scroll-drawn process vine, a "lamp" cursor that lights a dark room, a 3D boutique ring and a pile of tossable polaroids.
- Event inquiry and general inquiry forms with full client-side validation, clearly labelled as demonstrations.

## Stack

React 19 · TypeScript · Vite 7 · Tailwind CSS 4 · Motion 12 · Lenis · React Router 7. Fonts are self-hosted (Fraunces, Instrument Sans — both SIL OFL). No backend, database, analytics, third-party embeds or secrets.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server |
| `npm run build` | Type-check, build, then write per-route HTML shells, sitemap, robots and `_headers` (`scripts/postbuild.mjs`) |
| `npm run preview` | Serve the build on port 4173 |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint (incl. jsx-a11y) |
| `npm run smoke` | Playwright smoke test of the build on desktop + mobile: console errors, failed requests, overflow, contact links, navigation, both forms. Needs Google Chrome installed. |
| `npm run images` | Re-download and re-encode the photography listed in `scripts/image-manifest.json` |
| `npm run og` | Re-render the Open Graph cards in `public/og/` |

Build switches:

- `SITE_URL` — absolute origin for canonical and Open Graph URLs (default `https://abraxas-blooms-concept.pages.dev`).
- `SITE_MODE=production` (or `npm run build:production`) — removes the preview `noindex` directives and opens `robots.txt`. Only use this for an owner-approved launch.

## Where things live

```
src/data/business.ts   Business facts — single source of truth for copy, links and JSON-LD
src/data/seo.ts        Per-route titles, descriptions and OG images
src/components/fx      Shader, petals, cursor, variable type, bloom mark
src/components/atelier Bouquet sketchpad and its SVG flora
src/components/forms   Form state/validation and both inquiry forms
src/sections/…         Page sections, grouped by page
scripts/               Image pipeline, OG renderer, postbuild, smoke test
```

## Facts: confirmed vs. to confirm with the owner

Used as confirmed: business name, co-owner Samantha Todd, address, phone, public email (`bloomsbotiquefloral@gmail.com`, spelled as listed), and the Facebook / WeddingWire / The Knot profile links. The WeddingWire listing (checked Oct 2026) shows the same name, address and phone.

Shown with an "unverified — please call to confirm" flag and kept out of structured data: **shop hours** (from the township listing).

Open questions for the owner:

- Hours, holiday schedule and whether Sunday/Monday are closed.
- The Knot still lists the business as *Magical I Do's* at **6881 Gratiot Road** — likely worth updating.
- Delivery areas, timing and fees for flowers; which rental items are current; showroom visits by appointment or walk-in.
- Real portfolio photography and a portrait/bio for Samantha (placeholders are marked).
- Boutique: no products, prices, brands or stock are shown anywhere, by design.

## Replacing the imagery

Stock images: add or swap entries in `scripts/image-manifest.json` (`key`, Unsplash `id`, `alt`) and run `npm run images`. It writes `public/img/<key>-<width>.webp` (640/1280/1920) plus blur placeholders and dimensions in `src/data/images.json`.

Owner photos: `scripts/fetch-images.mjs` currently downloads from Unsplash only; point its `processOne` at local files (read with `fs.readFile` instead of `fetch`) and keep the same keys so components pick them up unchanged. Then remove the "Illustrative photo" tags and the imagery note in `src/data/business.ts`.

## Going live (after approval)

1. Connect the forms: e.g. a Cloudflare Pages Function or form service that emails the shop, with spam protection (Turnstile). Replace the demo-complete states.
2. Swap in owner photography and confirm the open questions above.
3. Build with the real domain: `SITE_URL=https://example.com npm run build:production`.
4. Remove the concept badge (`src/components/layout/ConceptBadge.tsx`) and concept copy in the footer.

## Accessibility & motion

Semantic landmarks, one `h1` per page, skip link, visible focus rings, keyboard-operable menu, lightbox, accordions and forms (errors linked with `aria-describedby`, focus moves to the first invalid field). `prefers-reduced-motion` disables the intro, smooth scrolling, petals and shader animation. The custom cursor only appears on fine pointers and never hides the text caret in fields.

## Credits

Design and development: Abraxas Technologies. Illustrative photography: [Unsplash](https://unsplash.com) contributors, under the Unsplash License.
