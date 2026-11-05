# Handoff

How the platform is organized, what a future developer needs to know, and how ownership and access
pass to the business.

## Ownership and independence

- The software runs on its own. It has no license checks, no phone-home, and no dependency on any service run by the developer. Every outside service is the business's own account, or one the business chooses.
- Ownership and usage rights follow the written agreement between the business and the developer. Delivering this code does not by itself transfer or grant rights beyond that agreement.
- Delivery does not create an obligation for ongoing or free maintenance. Support, hosting and updates are arranged separately.
- Third-party open-source packages keep their own licenses. They are listed in `package.json` and `package-lock.json`.
- Stock photographs used by the concept website are illustrative, and should be replaced with the business's own photos before launch.

## Handing over access

1. Create every outside account in the business's name: Stripe, the email provider, Twilio if used, hosting, the domain, and storage.
2. Put every secret in the host's secret settings. None are in the code or the repository.
3. Create the owner's dashboard account with `create-owner`, and have the owner change the password.
4. Transfer the code repository to the business, or give the business admin access to it.
5. Remove the developer's own access from each account once the business confirms it has what it needs.

## How the code is organized

```
src/                 The website and dashboard (Vite, React, TypeScript, Tailwind)
  pages/             Public pages, including the original concept pages
  pages/shop, planner, account   Shop, wedding planner, customer account
  admin/             The team dashboard
  sections, components           The original site's building blocks
server/              The API, worker and command line (Node, Hono, Kysely)
  config/            Environment checks
  db/                Migrations, seeding, the migrator, generated types
  auth/              Passwords, sessions, roles and permissions
  http/              Middleware and request helpers
  routes/            HTTP endpoints, thin, calling modules
  modules/           Business logic by domain: catalog, cart, orders, payments, availability,
                     weddings, inventory, notifications, calendar, reports, settings, system
  automation/        Events, job queue, worker, scheduled jobs
  integrations/      Stripe, email, SMS and storage adapters
shared/              Code used by both sides, such as status wording
e2e/                 Browser tests
scripts/             Build, backup, restore, verification and smoke-test scripts
docs/                This documentation
```

Rules worth keeping:

- Business logic lives in `server/modules`. Routes check permissions and validate input, then call a module.
- Anything that must not happen twice (stock, capacity, payments, messages) is enforced by the database or by a unique key, not only in code.
- Side effects such as email, texts and calendar pushes are written as events in the same transaction as the change, then delivered by the worker. A failed email never loses an order.
- Money is whole cents. Prices are always recalculated on the server.

## Getting started as a developer

```sh
npm install
cp .env.example .env
npm run db:up && npm run db:migrate
npm run db:seed:demo      # fictional data and staff sign-ins, printed once
npm run dev               # site at http://localhost:5173, API on port 8787, worker
```

Then read [architecture-audit.md](architecture-audit.md), [database.md](database.md) and
[testing.md](testing.md). Run `npm run check` before every change you ship.

## Documents

| For | Read |
| --- | --- |
| The owner | [owner-checklist.md](owner-checklist.md), [admin-guide.md](admin-guide.md), [business-settings.md](business-settings.md), [costs-and-services.md](costs-and-services.md) |
| Staff | [staff-guide.md](staff-guide.md) |
| Whoever hosts it | [operations.md](operations.md), [integrations.md](integrations.md), [troubleshooting.md](troubleshooting.md) |
| Developers | [architecture-audit.md](architecture-audit.md), [database.md](database.md), [testing.md](testing.md), [implementation-checklist.md](implementation-checklist.md) |
| Everyone | [implementation-report.md](implementation-report.md) |
