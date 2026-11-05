# Architecture audit

Audited 2026-11-05 at commit `3921d7c`, clean working tree, branch `main`, no Git remote.
Baseline before any platform work: typecheck, lint and build pass; `npm run smoke` passes
all 28 checks on desktop and mobile.

## What exists

| Area | Finding |
| --- | --- |
| Framework | Vite 7 single-page app, React 19, TypeScript 5.9 strict. **Not Next.js.** |
| Routing | React Router 7, client-side, with lazy route chunks and animated page transitions |
| Styling | Tailwind CSS 4 with a theme in `src/styles/index.css`; Fraunces and Instrument Sans self-hosted |
| Motion | Motion 12, Lenis smooth scroll, WebGL silk shader, petal canvas, custom cursor |
| Package manager | npm, `package-lock.json` |
| Hosting | Static build on Cloudflare Pages (`abraxas-blooms-concept.pages.dev`), marked `noindex` |
| Backend, database, auth | **None** |
| Integrations | **None.** Only outbound links (phone, email, maps, Facebook, WeddingWire, The Knot) |
| Tests | `scripts/smoke.mjs` (Playwright against Chrome). No unit or integration tests, no CI |
| Deployment config | No Wrangler file, no Dockerfile. Deployed by hand with `wrangler pages deploy` |

## Working versus placeholder

| Feature | State |
| --- | --- |
| Six marketing routes, 404, navigation, SEO shells, sitemap, JSON-LD | Working |
| Atelier bouquet sketchpad | Working; "Send this idea" pre-fills the contact form through the URL |
| Event inquiry form | **Placeholder.** Validates, then shows "nothing was sent" |
| General inquiry form | **Placeholder.** Same behaviour |
| Cart, checkout, product data, prices, stock | **Absent.** Copy says "no online store" and "no checkout here on purpose" |
| Customer accounts, order tracking, dashboard | **Absent** |
| Shop hours | Static, flagged unverified, kept out of structured data |

No fake commerce or invented business data was found. The existing site is careful to say
what it is not, and that care has to carry into the platform.

## Standing constraint: the site is an uncommissioned concept

The repository and footer state that this "has not been commissioned" and "is not the official
Blooms website". The build directive names Samantha and the Blooms team as the client. These
two statements disagree, and the code cannot settle it. Until the owner's approval is confirmed:

- `ConceptBadge`, the footer disclosure and the `noindex` default stay in place.
- `SITE_MODE=production` remains the single, deliberate switch that removes them.
- Nothing is deployed, and no live payment or message can be sent.

## Decisions

### Backend: a modular monolith on Node and PostgreSQL

| Option | Verdict |
| --- | --- |
| **Node + Hono + PostgreSQL, serving the existing SPA** | **Chosen.** Directly satisfies the PostgreSQL and schema-constraint requirements, runs on any host, and leaves the client free to move |
| Cloudflare Workers + D1 | Rejected. D1 has no interactive transactions or exclusion constraints, which are the core of double-booking protection, and it ties the client to one vendor |
| Migrate to Next.js | Rejected. It would rewrite a working frontend, which the directive prohibits |

The existing Vite app remains the only frontend. `/admin` and the store are lazy routes in the
same app, so the marketing pages gain almost no weight.

| Concern | Choice | Why |
| --- | --- | --- |
| HTTP | Hono on Node | Small, typed, no framework lock-in |
| Database access | Kysely with hand-written SQL migrations | The schema depends on exclusion constraints, triggers and partial indexes, which ORMs model poorly. A future developer only needs to know SQL. Prisma's current `latest` tag is a release candidate |
| Validation | Zod 4 | Requested by the directive |
| Jobs | PostgreSQL queue (`FOR UPDATE SKIP LOCKED`) | Redis would be a second stateful service for one small shop. Jobs commit in the same transaction as the business change, so a crash cannot lose them |
| Time | Luxon, `timestamptz`, business timezone setting | Daylight-saving-correct scheduling |
| Files | Local disk or any S3-compatible store (R2, S3) | Owner chooses; no vendor lock-in |
| Passwords | Node's built-in scrypt | No native dependency to maintain |

### Concurrency is enforced in the database

| Risk | Enforcement |
| --- | --- |
| Overselling the last unit | Atomic conditional `UPDATE ... WHERE on_hand - reserved >= qty`, plus `CHECK` constraints |
| Double-booking a consultation or crew | PostgreSQL `EXCLUDE USING gist` on staff or resource and time range |
| Over-reserving rentals | Trigger that locks the rental row and checks peak usage, including cleaning buffers |
| Exceeding daily capacity | Claims taken under a per-date advisory lock |
| Duplicate webhooks | `UNIQUE (provider, event_id)` plus monotonic state transitions |
| Duplicate charges | Idempotency keys on the gateway call and unique session IDs |
| Over-refunding | Row lock plus `CHECK (refunded_cents <= amount_cents)` |

### Safe defaults

The repository contains no real prices, delivery zones, policies or staff. The base seed therefore
creates only structure (roles, permissions, divisions, pipeline stages, message templates) with
conservative, explicitly unapproved settings: same-day off, custom orders need approval, nothing
auto-accepted. An empty catalog shows the existing "call the shop" path rather than an empty store.
Fictional demo data exists only behind an explicit development command, is marked `is_demo`, and
blocks the live-readiness check.

### Vendor rules checked (November 2026)

- **Stripe:** Checkout `expires_at` must be 30 minutes to 24 hours out. Fulfilment must be driven by
  `checkout.session.completed` and `async_payment_succeeded`, not by the landing page.
- **Twilio:** all US 10DLC SMS must be registered (brand and campaign). A campaign needs a privacy
  policy and terms URL, and the brand, website and sender domain must match. Default opt-out
  keywords are STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE and OPTOUT, with error 21610
  on sends to opted-out numbers.
- **Meta:** public videos and live videos may be embedded with the JavaScript SDK `fb-video` plugin.
  The `embed_html` iframe is deprecated. Discovering a Page's videos automatically needs a Page
  token and `pages_read_engagement`, and App Review for public access, so the platform uses a
  manual URL workflow. The SDK loads only after a visitor clicks, which keeps Facebook out of the
  page until then.

## What gets reused

- Every existing page, section, animation and design token.
- `Button`, `TextField`, `TextArea`, `SelectField`, `ChipGroup`, `useForm`, `PageShell`, `PageHero`,
  `Img`, `RevealText` and `Eyebrow` for the customer-facing flows.
- `src/data/business.ts` as the fallback for contact facts.
- `scripts/postbuild.mjs` for route shells, `SITE_MODE` for the launch switch, and
  `scripts/smoke.mjs` as the regression guard for the marketing site.

See [implementation-checklist.md](implementation-checklist.md) for the build order and status.
