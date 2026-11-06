# Integrations

Each outside service sits behind an adapter, so it can be switched on, off or replaced through
configuration. All accounts should belong to the business, or to someone the business chooses. What
has and has not been verified is listed in [testing.md](testing.md#mocked-versus-verified).

## Stripe (payments)

Customers pay on Stripe's hosted Checkout page, so card details never reach this server. An order is
marked paid only after a signed webhook from Stripe says so, never because the customer returned to
the site.

**Setting up**

1. Create, or sign in to, the business's own Stripe account and finish its verification.
2. In test mode, copy the secret key (`sk_test_...`).
3. Add a webhook endpoint at `https://<your domain>/api/webhooks/stripe` with these events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `payment_intent.payment_failed`, `refund.updated`, `refund.failed`, `charge.dispute.created`.
   Copy its signing secret (`whsec_...`).
4. Set `PAYMENTS_MODE=stripe`, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, and restart.
5. Run the connection check. It refuses live keys, never charges anything, and records the result on the launch checklist:
   ```sh
   STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_... PUBLIC_BASE_URL=https://<your domain> DATABASE_URL=... npm run verify:stripe
   ```
6. Make a full test payment by hand: order something, pay with Stripe's test card `4242 4242 4242 4242`, and confirm the order shows as paid in the dashboard. Then refund it, and confirm the refund appears in both places. Also try a declined test card and an abandoned checkout.

**Going live** means swapping in the live keys and a live webhook secret, and setting
`APP_ENV=production` and `LIVE_PAYMENTS_APPROVED=true`. The server refuses a live key without
all of these. See [operations.md](operations.md#going-live).

**Local development** uses `PAYMENTS_MODE=mock`. A simulated payment page sends correctly signed,
Stripe-shaped webhooks to the real webhook endpoint, so everything after the payment page runs the
production code. It is refused in production.

## Email

Two adapters are ready: Resend (`EMAIL_PROVIDER=resend` with `RESEND_API_KEY`), or any SMTP service
(`EMAIL_PROVIDER=smtp` with `SMTP_URL`). With `EMAIL_PROVIDER=log`, messages are recorded in the
dashboard but not sent.

1. Choose a sending address on a domain the business owns. A Gmail address cannot be verified as a sender with these providers.
2. Verify the domain with the provider by adding the DNS records it gives (SPF and DKIM), and add a DMARC record.
3. Set `EMAIL_FROM` to that address, and optionally `EMAIL_REPLY_TO`.
4. In the dashboard, open **Messages & rules**, pick a template, and use **Send me a test**.

Outside production, real providers only send to addresses listed in `MESSAGE_ALLOWLIST`. Testing
with real credentials therefore cannot email a customer by accident.

## Twilio (optional text messages)

The platform works fully without texts. To turn them on:

1. Create a Twilio account in the business's name, and a Messaging Service with a local number.
2. Complete A2P 10DLC registration: a Brand (the business) and a Campaign (customer care and order updates). Carriers check that the legal name, tax ID, website, privacy policy and terms match. Registration can take days to weeks.
3. Set `SMS_ENABLED=true`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_MESSAGING_SERVICE_SID`. After registration is approved, also set `TWILIO_A2P_APPROVED=true`. Production refuses to send until it is.
4. In the Messaging Service, set the incoming message webhook to `https://<your domain>/api/webhooks/twilio/inbound`. Status callbacks are requested on each message automatically.
5. Choose which messages go by text under **Settings → Text messages**.

Safeguards built in:

- Consent checkboxes are unticked by default, and transactional and marketing texts are separate.
- Each consent is stored with its wording, time and source.
- STOP and the other opt-out words block further texts, and START re-subscribes. HELP gets the help reply.
- Texts are held during quiet hours, and duplicates are never sent.
- Webhooks are rejected unless Twilio's signature checks out.
- Credentials never reach the browser.

## Facebook

Paste the link of any public video or live video from the business's Page under **Marketing**, and
choose one to feature on the home page with a button to a product or the planner. Nothing loads from
Facebook until a visitor presses play. If Facebook is blocked or the video is gone, the page still
works and shows a link instead.

Videos are added by link on purpose. Meta's API can list a Page's videos automatically, but that
needs a Page access token with `pages_read_engagement`, and Meta's app review. The manual workflow
needs neither, and it does not scrape anything.

## Google Calendar (optional)

Every staff member can already subscribe to a private, read-only calendar feed from **Your account**,
in Google, Apple or Outlook calendar. That needs no setup.

For one shared Google calendar, the platform can push consultations and confirmed events to it, one
way. Edits made in Google are never read back, so they can never override a booking.

1. In Google Cloud, create an OAuth client and obtain a refresh token for the account that owns the calendar, with the calendar events scope.
2. Set `GOOGLE_CALENDAR_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN`.

## File storage

Uploads such as planner photos and event documents are private, and are served only through
signed-in or token links. Images are re-encoded, which removes location data.

- `STORAGE_PROVIDER=local` keeps files on disk. Use a persistent volume and back it up.
- `STORAGE_PROVIDER=s3` works with any S3-compatible service, such as Cloudflare R2, Backblaze B2 or Amazon S3. Set `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. Keep the bucket private.

## OpenAI and Twilio Voice (Flora)

Flora, the AI concierge, uses the OpenAI API through its official Node SDK (`openai`). The website
chat uses the Responses API. The phone uses the Realtime API, bridged to Twilio Media Streams. Both
are off unless `AI_PROVIDER=openai` and `OPENAI_API_KEY` are set, a channel is switched on, and the
owner has set a monthly limit. The phone line also needs `VOICE_ENABLED=true`, the Twilio account
credentials, and `TWILIO_VOICE_NUMBER`. Every Twilio webhook is signature-checked. See
[flora.md](flora.md) for the setup steps, the safety rules, costs, and what has been verified.

