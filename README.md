# Blooms Boutique & Floral: website and business platform

A website, online shop, wedding planner, and team dashboard for **Blooms Boutique & Floral**
(7680 Gratiot Road, Suite 4, Saginaw, MI), by **Abraxas Technologies**.

> **This is not the official Blooms website.** It began as an independent concept and has not been
> launched. Every page says so, preview builds ask search engines not to list them, and payments run
> in test mode. Photography is illustrative stock from Unsplash and does not show Blooms' own work.
> Going live is a deliberate step that needs the owner's approval. See [docs/operations.md](docs/operations.md#going-live).

## What it does

**For customers.** The original motion-rich site, now backed by a real system: an online shop for
flowers and boutique pieces, with options, pickup, delivery and shipping, and only offering times the
shop can actually meet; secure payment on Stripe's hosted page; order tracking for every item; a
seven-step wedding and event planner that works at any hour, with an honest estimate, a live date check
and consultation booking; quotes, deposits and balances; and a passwordless customer account.

**For the team.** A dashboard at `/admin` with today's work, orders, deliveries, a shared calendar,
the wedding pipeline, inventory with recipes and purchasing, rentals, customers, reports, message
templates, and every business rule. Roles limit what each person sees.

**Behind the scenes.** A capacity engine that weighs staff hours, workload, crews, rentals, delivery
windows and closures. The database enforces no overselling and no double booking. Background jobs
send messages, remind, reconcile payments and recover after restarts.

See [docs/implementation-report.md](docs/implementation-report.md) for exactly what is done, tested,
and still needed.

## Stack

React 19, TypeScript, Vite 7, Tailwind CSS 4, Motion 12 and React Router 7 for the site and dashboard.
Node with Hono, PostgreSQL 17 with Kysely, and Zod on the server. Stripe, Resend or SMTP, Twilio
(optional), and any S3-compatible storage as integrations. Vitest and Playwright for tests. Fonts are
self-hosted (Fraunces and Instrument Sans, both SIL OFL).

## Getting started

Needs Node 22 or newer, and Docker for the local database.

```sh
npm install
cp .env.example .env
npm run db:up && npm run db:migrate
npm run db:seed:demo      # fictional products, staff and rules; prints the staff password once
npm run dev               # site at http://localhost:5173, team dashboard at /admin
```

Payments are simulated locally (`PAYMENTS_MODE=mock`), and email is recorded rather than sent.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Site, API and worker together, with reload |
| `npm run build` | Type-check, build the site, write the per-route HTML shells, and bundle the server |
| `npm start` / `npm run start:worker` | Run the built web server or worker |
| `npm run check` | Typecheck, lint, all server tests, and the production build |
| `npm test` | Server tests against a real PostgreSQL database |
| `npm run test:e2e` | Browser tests against the production build |
| `npm run db:migrate`, `db:seed:demo`, `db:reset`, `db:check`, `db:types` | Database tasks. `db:check` runs the record checks |
| `npm run admin:create -- <email> "<name>"` | Create an owner account |
| `npm run verify:stripe` | Check a Stripe test-mode connection. Refuses live keys |
| `npm run build:concept` and `npm run smoke` | The original static concept, with no backend, and its smoke test |
| `scripts/staging.sh up`, `publish`, `verify`, `reset`, `backup`, `restore-check` | The staging demonstration: run it, publish it, check it from outside, and reset it. See [the demonstration guide](docs/client-handoff/demonstration-guide.md) |
| `npm run images` / `npm run og` | Re-download the stock photography, and re-render the Open Graph cards |

## Documentation

| | |
| --- | --- |
| [Client handoff](docs/client-handoff/README.md) | Plain-language guides for the owner, and the demonstration script |
| [Implementation report](docs/implementation-report.md) | What is finished, tested, mocked, and still needed |
| [Owner checklist](docs/owner-checklist.md) | Decisions and accounts only the business can provide |
| [Administrator guide](docs/admin-guide.md) and [staff guide](docs/staff-guide.md) | Using the dashboard |
| [Business settings](docs/business-settings.md) | Every rule and its default |
| [Operations](docs/operations.md) | Deploying, monitoring, backups, restores and rollback |
| [Integrations](docs/integrations.md) | Stripe, email, Twilio, Facebook, Google Calendar and storage |
| [Services and costs](docs/costs-and-services.md) | Every outside service and what it costs |
| [Testing](docs/testing.md) | Test layers, and what is mocked versus verified |
| [Database](docs/database.md), [architecture audit](docs/architecture-audit.md), [handoff](docs/handoff.md), [troubleshooting](docs/troubleshooting.md), [implementation checklist](docs/implementation-checklist.md) | For developers and whoever maintains it |

## Facts: confirmed versus to confirm with the owner

Used as confirmed: the business name, co-owner Samantha Todd, the address, phone, public email
(`bloomsbotiquefloral@gmail.com`, spelled as listed), and the Facebook, WeddingWire and The Knot
profile links. Shop hours come from the township listing, and are shown as unverified until the owner
saves real hours in the dashboard. Open questions are in [docs/owner-checklist.md](docs/owner-checklist.md).

## Replacing the imagery

Stock images are listed in `scripts/image-manifest.json` and fetched with `npm run images`, which
writes `public/img/<key>-<width>.webp` and blur placeholders in `src/data/images.json`. For the
owner's own photos, point `processOne` in `scripts/fetch-images.mjs` at local files and keep the same
keys. Then remove the "Illustrative photo" tags and the imagery note in `src/data/business.ts`.
Product photos are uploaded in the dashboard.

## Accessibility and motion

Semantic landmarks, one `h1` per page, a skip link, visible focus, keyboard-operable menus and forms,
and errors linked to their fields. Small text meets WCAG AA contrast, and the forms, shop, planner and
dashboard are checked automatically with axe in the browser tests. `prefers-reduced-motion` turns
off the intro, smooth scrolling, petals and shader animation.

## Credits

Design and development: Abraxas Technologies. Illustrative photography: [Unsplash](https://unsplash.com)
contributors, under the Unsplash License.
