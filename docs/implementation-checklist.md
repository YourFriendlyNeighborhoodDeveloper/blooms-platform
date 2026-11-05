# Implementation checklist

Status of each part of the build directive, as of 2026-11-05. Each item gets one of these labels:

- **Done.** Implemented, and covered by automated tests that run against the real database, server and (where it applies) a real browser.
- **Done, needs credentials.** Implemented and tested against a local stand-in. It still needs the business's own account to be verified for real. See [integrations.md](integrations.md).
- **Owner decision.** The software is ready, but a business rule or policy has to come from the owner. Until then a cautious default applies. See [owner-checklist.md](owner-checklist.md).
- **Limited.** Works, with a known boundary described in [implementation-report.md](implementation-report.md#4-known-limitations-and-outstanding-defects).

| § | Requirement | Status | Where |
| --- | --- | --- | --- |
| 1 | Preserve the existing frontend | Done. Marketing pages match the baseline screenshots. The only visual changes are darker small text for contrast (WCAG AA) and two new nav items (Shop, cart). | `src/pages`, `src/sections` |
| 1 | Every customer-facing control works | Done. Both inquiry forms now send. Cart, checkout, tracking, planner and account all work end to end. | `src/pages/shop`, `src/pages/planner`, `src/pages/account` |
| 1 | Architecture audit | Done | [architecture-audit.md](architecture-audit.md) |
| 2 | Modular monolith, PostgreSQL, validation, auth, Stripe, email, optional Twilio, durable jobs, object storage, logging, tests, reproducible deploy | Done | `server/` by domain |
| 3 | Configurable divisions, unified cart, explained split when fulfilment differs | Done | `server/modules/cart/lines.ts` |
| 3 | Product fields: images, categories, SKU, price, sale price, cost, tax category, stock, variants, options, prep time, fulfilment options, delivery restrictions, customization, seasons, active state | Done | Products in the dashboard |
| 3 | Boutique: variants, limited stock, pickup, shipping, automatic stock reduction, backorder, discounts, returns and refunds | Done | |
| 3 | Weddings: inquiries, consultations, questionnaires, services, venue, guests, setup, rentals, installation, teardown, quotes, contracts (staff-recorded), deposits, balances, timelines, assignments, communication | Done. Contract signing is recorded by staff, not an e-signature. | `server/modules/weddings` |
| 3 | Owner adds service categories without a developer | Done | Services page |
| 4 | Seven-step planner, uploads, selections, honest estimate, availability, submit, consultation booking, team approval, confirmed project | Done. Tested in the browser as Scenario C. | `/plan` |
| 5 | Capacity engine: staff hours, days off, appointment and event limits, crews, setup, travel, teardown, buffers, rentals, production points, delivery stops, blackouts, overrides | Done | `server/modules/availability`, `server/modules/weddings/availability.ts` |
| 5 | Booking concurrency: transactions, constraints, expiring holds, final revalidation; inquiry versus hold versus approved versus confirmed | Done. Concurrency is tested with simultaneous requests. | Database exclusion constraints, advisory locks |
| 6 | Order acceptance rules, earliest feasible slot, server-side refusal | Done. Tested as Scenario B. | |
| 6 | No example numbers become production settings; unapproved policies go to manual review | Done | Settings approvals |
| 7 | Shop: browse, search, filter, customize, cart, promo codes, fulfilment, times, totals, checkout, confirmation, history, tracking, guest checkout | Done | |
| 7 | Stripe hosted checkout, deposits, partial payments, invoices, balances, refunds, failed payment recovery, reconciliation, signature checks, duplicate and late webhooks | Done, needs credentials. Verified against stripe-mock and with Stripe's signing scheme. A real test-mode payment awaits the business's own Stripe keys. | `server/modules/payments` |
| 8 | Order and item tracking, branches, per-item status, carrier details, staff-recorded delivery milestones, no fake GPS | Done. Carrier events need a carrier integration, which is not configured. | `/track` |
| 9 | Owner dashboard with real data, division filter | Done | `/admin` |
| 9 | Order management: search, filter, approve, reject, fulfil, assign, reschedule, refund, contact, notes, packing slips, export | Done | |
| 9 | Wedding board with custom stages | Done | |
| 9 | Least-privilege roles, invitations, deactivation, sessions, audit log | Done. The owner can edit what each role can do. | Team page |
| 10 | Inventory: locations, reserved, available, thresholds, alerts, adjustments, waste, returns, suppliers, purchase orders, history, recipes, wedding requirements, purchasing suggestions, approved substitutes, perishables, no overselling | Done. There is no supplier stock feed, and none is claimed. | |
| 11 | Rentals with quantities, buffers, damage notes, overlap protection, cleaning turnaround | Done | Database trigger `enforce_rental_capacity` |
| 12 | Email templates for every listed event, variables, previews, test sends, delivery log, failure handling, staff alerts | Done, needs credentials. Real delivery is verified over SMTP to a local mail catcher only. | Messages & rules |
| 13 | Twilio SMS with consent, STOP and HELP, suppression, quiet hours, callbacks, duplicate prevention, A2P gating | Done, needs credentials. Off unless credentials and A2P registration are recorded. | |
| 14 | Event-driven automation, idempotency, retries, backoff, dead letters, recovery after restart | Done. A restart was rehearsed with the production containers. | `server/automation` |
| 15 | Calendar: all item types, month, week and day views, team filter, drag and drop with validation, conflicts, capacity | Done | Calendar page |
| 15 | Optional Google Calendar push, one way | Done, needs credentials | `server/modules/calendar/sync.ts` |
| 16 | Delivery: zones, fees, minimums, cutoffs, windows, drivers, vehicles, routes, instructions, proof, failures, redelivery, notices | Limited. Addresses are checked by ZIP code only, and there is no route optimization. | Deliveries page |
| 17 | Facebook: page links, public video and live embeds, featured video, calls to action, safe failure | Done. Meta's API needs app review for automatic discovery, so videos are added by link. | Marketing page |
| 18 | CRM and customer accounts, preferences, support requests, secure recovery, scoped links | Done | `/account`, Customers page |
| 19 | Owner-controlled settings with validation and warnings | Done | Settings page |
| 20 | Reports from real records, definitions, CSV, no profit claims | Done | Reports page |
| 21 | Security controls | Done. See the security section of the report. | |
| 21 | Backups and a tested restore | Done. Backup, restore and record checks were rehearsed. | [operations.md](operations.md) |
| 22 | Normalized schema with constraints for double booking, stock, idempotent payments, history, privacy | Done. 103 tables. | [database.md](database.md) |
| 23 | Scenarios A to H | Done. Each runs in a real browser. | `e2e/scenarios.spec.ts` |
| 24 | Testing requirements, including concurrency, mobile and accessibility | Done | [testing.md](testing.md) |
| 25 | Deployment and operations | Done. Nothing has been deployed. | [operations.md](operations.md) |
| 26 | Handoff documentation | Done | [handoff.md](handoff.md) |
| 28 | Owner configuration checklist | Done | [owner-checklist.md](owner-checklist.md) |
| 29 | Final report | Done | [implementation-report.md](implementation-report.md) |
