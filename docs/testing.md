# Testing

## How to run it

```sh
npm run db:up        # the local PostgreSQL in Docker
npm run check        # typecheck, lint, all server tests, production build
npm run test:e2e     # browser tests, against the production build (run npm run build first)
npm run build:concept && npm run smoke   # the original static concept still builds and works
```

The server tests run against a real PostgreSQL database (`blooms_test`), recreated from the
migrations on every run, so they also prove the migrations work. The browser tests start the built
server against their own database (`blooms_e2e`), load the fictional demo data, and use simulated
payments.

### The adapter checks

`server/integrations/adapters.contract.test.ts` runs the real Stripe, SMTP and S3 adapters against
local stand-ins. Each part is skipped unless its stand-in is running:

```sh
docker run -d --rm --name blooms-stripe-mock -p 127.0.0.1:12111:12111 stripe/stripe-mock:latest
docker run -d --rm --name blooms-mailpit -p 127.0.0.1:8025:8025 -p 127.0.0.1:1025:1025 axllent/mailpit:latest
docker run -d --rm --name blooms-s3 -p 127.0.0.1:9100:9000 -e RUSTFS_ACCESS_KEY=blooms-test-key -e RUSTFS_SECRET_KEY=blooms-test-secret-only rustfs/rustfs:latest

STRIPE_MOCK_PORT=12111 MAILPIT_URL=http://127.0.0.1:8025 SMTP_TEST_URL=smtp://127.0.0.1:1025 \
S3_TEST_ENDPOINT=http://127.0.0.1:9100 npm test
```

CI (`.github/workflows/ci.yml`) runs stripe-mock and Mailpit as services, so the Stripe and SMTP
checks run on every push.

### Checking a staging deployment from outside

`scripts/staging.sh verify` runs `e2e/staging/` against the running staging deployment, as a customer
on a phone-sized screen and as the owner. It covers the full order journey with the tracking page
following each staff step, pending, failed and abandoned payments, duplicate confirmations, a partial
refund, a wedding plan through to a confirmed project, the fully booked date, the shop's protective
rules, role limits, and that no secret reaches the browser. It never resets data. It adds fictional
test orders, which `scripts/staging.sh reset` removes. Credentials are passed in for the run only.

## What is covered

| Layer | File | What it proves |
| --- | --- | --- |
| Unit | `server/lib/*.test.ts` | Money arithmetic and rounding, allocation, daylight saving time, working-hour arithmetic, references, CSV formula neutralizing |
| Integration and database | `server/modules/orders/commerce.test.ts` | Scenarios A, B, E, F, G and H at the API level; pricing recalculated on the server; promotions; same-day cutoffs and lead times; stock and capacity under concurrent checkouts; duplicate, forged, late and out-of-order webhooks; failed and pending payments; refunds and their limits; reconciliation; holds that expire; dead-letter jobs and retry |
| Integration and database | `server/modules/weddings/weddings.test.ts` | Scenario C at 11:30 p.m.; Scenario D; crew and rental double booking under concurrent requests; consultation double booking; staff days off; holds that expire; deposits, balances and invoices; quote acceptance rules |
| Integration and database | `server/modules/platform.test.ts` | SMS consent, STOP, START and HELP, quiet hours and the Twilio switch; customer accounts and private links; privacy export and erasure; safe uploads; Facebook links; launch checklist and safe defaults; templates; calendar and moves; inventory operations; reports; health; Google Calendar queueing; request limits; staff assignments; returns; record checks; client addresses behind proxies; idempotency key scope; reschedules; department closures; substitutes; role permissions |
| Adapters | `server/integrations/adapters.contract.test.ts` | The real Stripe adapter's requests, checked against Stripe's published API definition; Stripe's webhook signing; real SMTP delivery and the non-production allowlist; private S3 storage with signed requests; Twilio webhook signatures and the A2P switch |
| Browser | `e2e/scenarios.spec.ts` | Scenarios A to H, each through the real pages, in Chrome |
| Browser | `e2e/platform.spec.ts` | Product discovery, cart, promotions, private tracking, passwordless sign-in, refunds, role restrictions, calendar, settings, Facebook failing safely, the order desk, owner setup, confirmed hours, and the original pages |
| Browser | `e2e/a11y.spec.ts` | Automated WCAG 2.1 AA checks (axe) on checkout, every planner step, the shop, account, tracking, the inquiry forms and the dashboard; keyboard-only sign-in |
| Browser | `e2e/mobile.spec.ts` | No sideways scrolling on 14 pages at phone width; buying, planning, and staff work on a phone |
| Browser | `e2e/zz-integrity.spec.ts` | After every browser flow, all record checks still pass |

Concurrency is tested directly: two customers race for the last unit, the last delivery stop, the
last daily capacity and the same event crew, and exactly one wins each time.

## Mocked versus verified

| Integration | How it was tested | Verified for real? |
| --- | --- | --- |
| Stripe Checkout, refunds | Simulated gateway sending correctly signed, Stripe-shaped events through the real webhook path; real adapter checked against stripe-mock | **No.** Needs the business's own test keys, then `npm run verify:stripe` and a manual test payment |
| Stripe webhook signatures | Stripe's own signing helper, including tampered, wrong-secret and stale signatures | Yes, for the signing scheme |
| Email over SMTP | Real delivery to a local mail catcher (Mailpit) | Yes, for SMTP itself. Not with the business's provider or domain |
| Email over Resend | Not called | **No.** Needs an API key and a verified domain |
| Twilio SMS | Capturing stand-in for sending; real signature checks with Twilio's helper | **No sends.** Needs an account and A2P registration |
| S3 storage | Real signed requests against an S3-compatible server | Yes, for the protocol. Not with the business's provider |
| Google Calendar push | Queueing tested; the Google API call is not | **No.** Needs OAuth credentials |
| Facebook embeds | Loading on request and failing safely, tested with Facebook blocked | Not with a real public video |
| Hosting | Production compose file built and run locally; restart and worker recovery rehearsed; backup and restore rehearsed | Not deployed anywhere |

## Fixtures

All test and demo data is fictional: `example.test` and `demo.example` addresses, 555 phone numbers,
"(demo)" product names. Nothing uses real customer information, and no test sends a real email or text.

## Not covered

- Load or stress testing.
- Real mobile devices and screen readers. The mobile tests emulate a Pixel 7 in Chrome, and accessibility is checked automatically with axe plus a keyboard test.
- Browsers other than Chrome.
- Automated visual regression. The original pages were compared against baseline screenshots by hand.
