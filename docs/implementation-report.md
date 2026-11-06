# Implementation report

Blooms Boutique & Floral platform, as of 2026-11-05.

**In short:** the shop, wedding planner, team dashboard, capacity engine and background automation
are built, persistent and tested end to end, in a browser, against a real database. It is **not
production-ready**. No real payment, email or text message has gone through the business's own
accounts, because none have been connected. It has not been deployed anywhere. Its business rules
await the owner's decisions. Its legal pages are placeholders. Sections 2, 3 and 10 list what remains.

## 1. Functionality completed and tested

Each item below runs against the real PostgreSQL schema. Each is covered by server tests, and the
customer-facing ones also by browser tests in Chrome, on desktop and phone-sized screens.

**Customers**
- Shop with categories, search, filters, product options and variants, sale prices, and stock that cannot be oversold. The cart persists, and prices and totals are always recalculated on the server. Promotion codes.
- Checkout without an account. Pickup, local delivery and shipping. Only times the shop can meet are offered: opening hours, preparation time, workload capacity, driver schedules, delivery windows and stops, cutoffs, closures, seasons and lead times are all checked, and checked again when the order is placed. Impossible requests are refused before payment, and the earliest real alternative is shown (Scenario B).
- Payment on a hosted page. An order is marked paid only by a signed webhook. Pending, failed, expired, duplicate and late payments are handled (Scenario G).
- Private tracking links for every order, with per-item status (Scenario H), delivery milestones recorded by staff, and carrier tracking numbers. Order lookup by reference and email reveals nothing to strangers.
- Passwordless customer accounts showing orders, events, quotes and invoices, with contact preferences and support requests.
- The wedding and event planner: event details, style and inspiration photos (validated, re-encoded, private), service and rental selections, an itemized estimate that separates published prices, estimates and custom quotes, a live date check with alternatives, submission, consultation booking with double-booking protection, quote acceptance, and deposit and balance payment (Scenarios C and D).
- Both original inquiry forms now send real messages, with spam protection.
- Facebook videos and live videos, loaded only when a visitor asks, and failing safely.

**The team**
- Overview of today's work, money over a chosen period, capacity, deliveries, low stock and alerts, filterable by department.
- Orders: review, accept, decline with refund, ask the customer, per-item progress, reschedule through the rules, assign staff, edit instructions, refund in full or in part (with permissions and limits), record returns, approved recipe substitutes, packing slips, internal notes, and CSV export.
- Wedding pipeline with custom stages, inquiry handling, holds, consultations, quotes, invoices, deposits, contracts recorded by staff, projects with tasks, milestones, materials, rentals and documents.
- Calendar with month, week and day views, team filter, drag-and-drop rescheduling checked by the same rules as customers, conflict marks, daily capacity, and private calendar feeds.
- Inventory with locations, movements, waste, perishable lots, recipes, purchasing suggestions, purchase orders and low-stock alerts (Scenario E). Rentals with cleaning buffers that cannot be overbooked.
- Deliveries with zones, windows, drivers, vehicles, routes, proof, failure and retry.
- Customers, consent records, privacy export and erasure.
- Team: invitations, roles editable by the owner, schedules, days off, crews, deactivation, sessions.
- Settings for every business rule, with owner approval for policies, warnings for unsafe combinations, and an audit log of every change.
- Reports from real records, with definitions and CSV export, test data labelled, and no profit claims.
- Message templates with previews, test sends and a delivery log. Automation rules you can switch off.
- A launch checklist that knows what is still missing.

**The system**
- Every event is stored before anything is sent. A database-backed queue retries with backoff, keeps failed jobs for review, and recovers after restarts. Duplicate events and webhooks are ignored.
- 22 scheduled jobs: hold expiry, payment reconciliation, reminders, follow-ups, alerts, retention, record checks.
- Text messages that stay off without Twilio (Scenario F), with consent, opt-out, quiet hours and A2P gating ready for when they are switched on.
- Record checks that confirm stock, payments, refunds, invoices, bookings and rentals agree, every six hours.
- Startup refuses unsafe configuration, such as simulated payments in production, or a live key without explicit approval.
- A production Docker image and Compose file with web, worker, database, HTTPS and nightly backups, plus backup and restore scripts.

## 2. Implemented, but needing third-party credentials

| Integration | State | What is needed |
| --- | --- | --- |
| Stripe | Adapter written. Its requests were validated against stripe-mock, which checks them against Stripe's published API definition. Webhook signing verified with Stripe's own helper. Full flows tested with a simulated gateway that sends signed, Stripe-shaped events through the real webhook endpoint. | The business's own Stripe account and test keys, then `npm run verify:stripe`, and a manual test payment, refund and decline |
| Email (Resend or SMTP) | SMTP delivery verified against a local mail catcher. Resend has not been called. | A sending domain the business owns, verified with the provider, and an API key or SMTP login |
| Twilio SMS | Off. Signature checks verified with Twilio's helper. Sending tested against a capturing stand-in. | A Twilio account, a Messaging Service and number, and approved A2P 10DLC registration |
| Google Calendar push | Queueing tested. The Google API itself has not been called. | An OAuth client and refresh token for the shared calendar |
| S3-compatible storage | Verified with signed requests against an S3-compatible server | A bucket and keys from the chosen provider |
| Facebook | Embeds by public link. No credentials needed. | The Page's video links |
| OpenAI (Flora's chat and phone) | Adapter on the official SDK. Every behavior tested with a scripted stand-in. The real key was reached on 2026-11-05 and is valid, but the account has **no credits**, so no real AI conversation has run. | A dedicated OpenAI project and key for this business, with credits and a monthly budget |
| Twilio Voice (Flora's phone line) | Webhooks signature-checked; media bridge tested with stand-in sockets, and once live through the real server with a synthetic caller. No real inbound call yet. | A public address, the number attached (`scripts/staging.sh flora-line`), and on the current trial account, a verified calling phone |

## 3. Business rules awaiting owner approval

Until each is settled, a cautious default applies, and orders go to manual review. The full list,
with defaults, is in [owner-checklist.md](owner-checklist.md). In short:

- the business name to use, given the listings disagree, and the confirmed Facebook page;
- real products and prices, and wedding service pricing;
- sales tax rates, and what is taxable, confirmed by an accountant;
- same-day ordering, cutoffs, lead times, daily order and workload limits, and out-of-stock handling;
- delivery zones, fees, minimums, windows and stops, and shipping;
- staff schedules, roles, crews, and event limits per day;
- wedding notice, setup and teardown times, deposits, balance timing, and the contract requirement;
- refund, cancellation and deposit policies, privacy policy and terms, reviewed by a lawyer;
- opening hours (the site shows the unverified township listing until they are saved);
- the email sending identity, whether to use text messages, and who owns hosting and the domain;
- approval to launch, which removes the concept notices.

## 4. Known limitations and outstanding defects

**Limitations by design or scope**
- Delivery addresses are checked by ZIP code only. There is no geocoding, no address verification service, and no route optimization. Routes group deliveries, and staff choose the order.
- Shipping records a carrier and tracking number, but there is no carrier integration, so no automatic tracking events or labels.
- Contracts are recorded as signed by staff. There is no legal e-signature. Quote acceptance records the typed name, time and IP address.
- Sales tax is a manual rate per category. There is no tax service, and no filing.
- Workload capacity is counted on the fulfilment date, not spread across earlier preparation days. Large event preparation is planned through project tasks and preparation days.
- An order line reserves stock from one location. It cannot split across locations.
- Staff sign-in uses passwords without two-factor authentication. Public forms use rate limits and a honeypot, not a CAPTCHA.
- Facebook videos are added by link, because automatic discovery needs Meta app review.
- Planner photo uploads accept JPEG, PNG and WebP. A HEIC file sent unconverted would be refused, though iPhones usually convert when uploading.
- The calendar's month view shortens long titles. The full text is on hover, and in week and day views.

**Known issues**
- Dev-only dependencies have 7 moderate advisories, all in `minimatch` under the linting tools. Nothing shipped to production is affected: the production dependency audit reports 0 vulnerabilities. The image library `sharp`, which handles uploads, was upgraded during this work to clear a high-severity advisory.
- During one full browser run on a heavily loaded machine (load average about 12), two tests failed because they waited on text that was already on screen. Both were changed to wait for navigation, and the next full run passed 55 of 55.

**Not tested**
- Load and stress, real phones (Chrome's Pixel 7 emulation was used), browsers other than Chrome, and screen readers (automated axe checks and a keyboard test were used).

## 5. Actual test results

Run on 2026-11-05, on the developer's machine.

| Check | Result |
| --- | --- |
| TypeScript, strict, whole project | Pass |
| ESLint, including accessibility rules | Pass |
| Server tests (unit, integration, database, adapters), real PostgreSQL 17 | **161 of 161 passed**, 6 files, about 49 seconds. Adapter checks ran against stripe-mock, Mailpit and an S3-compatible server. |
| Browser tests, Playwright, Chrome, desktop and phone emulation | **55 of 55 passed**, about 3.3 minutes. Includes Scenarios A to H, accessibility (axe, WCAG 2.1 AA) and mobile layout. |
| Original static concept build and smoke test | Pass. Pages compared against the screenshots taken before this work began: no visible change apart from the animated background. |
| Production build (site and server bundle) | Pass |
| Production Docker image and Compose stack | Built and run locally as a staging rehearsal. An order was paid with the worker stopped, the web server was restarted, the order survived, and the worker then sent exactly one confirmation. |
| Startup safety | Refused to start with simulated payments in production, with a live key without approval, with a live key outside production, and without a session secret or HTTPS address once deployed |
| Backup and restore | Backup taken with the script, restored into an empty database, row counts matched, all record checks passed on the copy, the audit log stayed append-only, and the script refused to overwrite a non-empty database |
| Production dependency audit | 0 vulnerabilities |
| Real Stripe test-mode payment | **Not run.** No business Stripe account is connected. |
| Flora (added later the same day) | Server tests **25 of 25** in `concierge.test.ts`, within a full run of **185 passed, 6 skipped**. Browser test `e2e/flora.spec.ts` passed. Live: OpenAI reached with a valid key but refused for credits; Twilio webhook, token and media path exercised with a synthetic caller. See [flora.md](flora.md#verified-and-not-yet). |
| Staging, through its public address | `scripts/staging.sh verify` in Chromium through the Cloudflare tunnel: **12 of 12 passed** on 2026-11-06. Covered: the phone-sized order journey, payments, weddings, protective rules, roles, the team gate, and that no secret (now including the OpenAI key and Twilio token) reaches the browser. Forged and unsigned voice webhooks got 403. The media WebSocket upgraded through Caddy and refused a bad token. |
| Checkout defect found through the public address | Fixed. Over the tunnel's slower connection, a click on **Continue to secure payment** made while the chosen time was still being priced was ignored, and the customer saw "Please choose a different time." The button now waits ("Checking your times…") until the current price is back. |
| Flora's visibility, after a report from a phone (2026-11-06) | Fixed. **Root cause:** when the AI provider refused for credits, Flora paused herself, and the widget then rendered nothing at all, so she vanished on every device. The pause also lifted after 10 minutes and failed the next visitor again. **Now:** the launcher is labelled "Chat with Flora", always on screen with her status, and placed above the safe area. On a phone the panel fills the visible screen and stays above the keyboard. When she is offline the panel shows an always-visible status strip and working alternatives. The pause is kept in the database and checked automatically. Verified in real Mobile Safari (iOS Simulator), WebKit, Chromium on Android and desktop sizes, and through the public address (15 of 15 staging checks). |
| Planner defect found by Flora's browser test | Fixed. Clicking **Continue** on the date step sent the plan one step early, skipping the final step with its opt-in boxes, because the browser reused the button as it changed to **Send my plan**. The two buttons are now separate elements, and the form sends only from the last step. The accessibility test had been passing on the resulting thank-you page, and now checks the real last step. That uncovered a keyboard gap on the empty Pipeline board, now fixed. |

How to reproduce each of these is in [testing.md](testing.md) and [operations.md](operations.md).

## 6. Actual deployment status

- **Code:** committed on the `platform` branch and pushed to a private GitHub repository, with git bundle backups on the developer's machine. Flora's work is committed separately.
- **Staging demonstration:** runs in Docker on the developer's machine (`scripts/staging.sh`), with fictional data, simulated payments and captured email. A team gate protects `/admin` and `/mailbox`. `scripts/staging.sh publish` serves it at a temporary `trycloudflare.com` address that changes on each publish, and `unpublish` takes it off the internet. Flora is configured on it in demonstration mode. Her phone line is not attached.
- **Public preview:** `abraxas-blooms-concept.pages.dev` still serves the static concept from 2026-10-31, unchanged.
- **Production:** not deployed.

## 7. Security and operational considerations

**In place**
- Card data never reaches the server: payment happens on Stripe's hosted page. Webhooks are verified by signature, stored once per event, and processed under row locks.
- Server-side permissions on every staff endpoint. Least-privilege roles that the owner can edit. Financial details and refunds are hidden from roles without them.
- Passwords are hashed with scrypt. Sessions sit in cookies that are http-only, secure and SameSite, and bound to the host once deployed. Staff sessions expire after 12 idle hours. Changing a password or deactivating someone signs them out everywhere.
- Rate limits stored in the database, with account lockout after repeated failed sign-ins. Client addresses are read safely behind a proxy.
- Cross-site request checks on every state-changing request. A content security policy and security headers, with HSTS once deployed.
- Every input validated on the server. Output escaped in pages and email. CSV exports neutralize formulas.
- Uploads are type-sniffed, size-limited, re-encoded, stored privately, and served only through authorized or token links.
- Customer links are random, hashed in storage, scoped to one purpose, and expiring. Order references are not sequential.
- Secrets live only in the environment, and are redacted from logs. Production refuses unsafe configuration.
- An append-only audit log of sensitive changes. Consent history. Privacy export and erasure. Retention schedules.
- Outside production, real email and text providers can only reach allowlisted addresses.

**For whoever operates it**
- Keep `SESSION_SECRET` long and private, and rotate it if exposed. Doing so signs everyone out.
- Copy nightly backups off the server, test a restore at least every 90 days, and record it on the launch checklist.
- Watch `/readyz`, set `ERROR_WEBHOOK_URL`, and check the dashboard's **System** page.
- Apply dependency and operating system updates. Nothing updates itself.
- Consider two-factor authentication for staff, through the hosting provider's access controls or a future change, before many people have access.
- No uptime is promised. The design aims for fast, lossless recovery instead.

## 8. Starting it locally

```sh
npm install
cp .env.example .env
npm run db:up && npm run db:migrate
npm run db:seed:demo      # fictional data; prints the staff password once
npm run dev               # site at http://localhost:5173, dashboard at /admin
```

Payments are simulated and email is recorded, not sent. To run the production build locally:
`npm run build`, then
`PUBLIC_BASE_URL=http://localhost:8787 SERVE_STATIC=true WORKER_EMBEDDED=true PAYMENTS_MODE=mock npm start`,
and open http://localhost:8787.

## 9. Configuring production

1. Create the business's accounts: hosting, domain, Stripe, email provider, and storage if used. See [costs-and-services.md](costs-and-services.md).
2. Fill in `.env.production` from `.env.example`: `APP_ENV=production`, the https `PUBLIC_BASE_URL`, a long random `SESSION_SECRET`, `TRUST_PROXY`, Stripe test keys first, the email provider and `EMAIL_FROM`, and storage.
3. Deploy with `docker-compose.prod.yml`, or on any host that runs the image, with a managed PostgreSQL 17. Run the web server and a worker.
4. Create the owner account, and work through the launch checklist and [owner-checklist.md](owner-checklist.md).
5. Verify Stripe in test mode, then go live as described in [operations.md](operations.md#going-live).

## 10. Remaining work before accepting real customers

1. A signed agreement with the business, covering ownership, hosting and support, and the owner's approval to launch.
2. Every decision in section 3, entered and approved in the dashboard.
3. The business's own Stripe account connected, `verify:stripe` passed, and a manual test payment, refund, decline and webhook delivery confirmed in Stripe test mode. Then live keys, explicitly approved.
4. A sending domain verified with an email provider, and test messages received in real inboxes, including Gmail and Outlook, without landing in spam.
5. A privacy policy, terms of sale, refund and cancellation policies written or reviewed by a lawyer, and sales tax confirmed by an accountant.
6. Real products, photos and prices entered, and the demo data removed. A real database should start empty: never load the demo seed into it.
7. Hosting set up with HTTPS, off-server backups, monitoring and error alerts, and a restore tested in that environment.
8. One end-to-end rehearsal in the real environment: an order, a delivery, a wedding inquiry, a quote, a deposit and a refund, using the business's real settings.
9. Staff trained with [staff-guide.md](staff-guide.md), and their accounts and schedules entered.
10. If text messages are wanted: A2P 10DLC registration approved, then a test with a team member's phone.
11. If Flora is wanted: the business's own OpenAI key with credits and a budget, the knowledge base written, a phone number in the business's name if the phone line is wanted, a real call and chat reviewed in the dashboard, and each channel switched from the sandbox to the real business only then. See [flora.md](flora.md).
