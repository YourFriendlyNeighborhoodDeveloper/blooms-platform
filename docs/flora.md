# Flora, the AI concierge

Flora answers on the website chat and, optionally, on a phone line. She helps people find flowers,
plan a wedding or event, and check on an order. Wherever she can, she hands the customer the
business's own workflows: the shop, the wedding planner, private tracking links, and requests that a
person picks up.

She is an automated assistant built on a hosted model (the OpenAI API). She is not a trained model of
her own, and she never presents herself as a person.

## What she can and cannot do

| She can | She cannot |
| --- | --- |
| Answer from the business settings, the catalog, the wedding menu and the owner's knowledge base | State any business fact that is not in those, or guess |
| Quote prices and availability exactly as the system returns them, saying whether a price is published, an estimate, or quoted by the team | Reserve a date, confirm a booking, or promise a price |
| Check a wedding date, delivery windows and consultation times against the real rules | See any order without an identity check by emailed code, or any order other than the one verified |
| Save a wedding plan as she learns it, and give a private link to review, edit and send it | Refund, cancel, change an order or deposit, give a discount, or make an exception. These become requests for a person |
| Pass a request to the right people, with a priority, and escalate if nobody acknowledges it | Text anyone except the caller, once, after they said yes |
| In a demonstration, pass on a real consultation request with the caller's permission | Copy anything from the demonstration into a real record |

## How it works

```
 Website chat ─► POST /api/public/concierge/chat ─► OpenAI Responses API (gpt-5.4-mini)
                                                     │ tool calls
 Phone ─► Twilio ─► POST /api/webhooks/voice/incoming (signature checked)
                    ◄─ TwiML: <Connect><Stream> with a one-time token
          Twilio ═► wss /api/webhooks/voice/media ═► OpenAI Realtime (gpt-realtime-2.1)
                    G.711 mu-law both ways, no transcoding
                                                     │ tool calls
                     server/modules/concierge/tools.ts: scoped functions over the existing services
                     (catalog, availability, planner, consultations, orders, support requests)
```

The phone bridge follows the pattern proven in the Eastwood voice agent (Twilio Media Streams to
OpenAI Realtime over WebSocket). The audio format is the same, the session settings use the current
API shape, and the bridge clears Twilio's buffered audio when the caller interrupts. Tool calls are
answered and the next response requested only after the current one finishes, and the opening line
discloses that she is automated. None of Eastwood's code, database, Kafka pipeline or insurance logic
is used. Blooms does not depend on Eastwood.

### Pieces

| Part | Where |
| --- | --- |
| Provider adapter (OpenAI SDK, scripted stand-in for tests) | `server/integrations/ai/provider.ts` |
| Twilio Voice: signature checks, hang-up | `server/integrations/voice/provider.ts` |
| Instructions and disclosures | `server/modules/concierge/prompt.ts` |
| Tools, each checked on the server | `server/modules/concierge/tools.ts` |
| Chat turns, budgets, limits | `server/modules/concierge/chat.ts`, `conversations.ts` |
| Phone webhooks and media bridge | `server/modules/concierge/voice.ts` |
| Drafts, review link, six-digit continue code | `server/modules/concierge/drafts.ts` |
| Requests for the team, routing, escalation | `server/modules/concierge/tickets.ts` |
| Identity check by emailed code | `server/modules/concierge/verification.ts` |
| Knowledge base | `server/modules/concierge/knowledge.ts` |
| Retention, idle calls, draft expiry, escalation sweeps | `server/modules/concierge/sweeps.ts` |
| Database | `server/db/migrations/006_concierge.sql` |
| Chat widget | `src/components/concierge/FloraChat.tsx` |
| Review page, continue page | `src/pages/planner/DraftReview.tsx`, `ContinueCall.tsx` |
| Dashboard | `src/admin/pages/Concierge.tsx`, `ConciergeConversation.tsx`, Settings → Flora, Messages |

## Two modes

Each channel has its own mode, set in **Settings → Flora**.

- **Demonstration (sandbox).** Flora says at the start that this is an Abraxas Technologies
  demonstration with fictional data. Plans she saves are marked sandbox. When the customer sends
  one, it is checked and estimated, then kept in the sandbox. It never becomes an inquiry, a customer
  record or a notification. Order lookups reach only test orders. Requests for the team are marked
  sandbox and alert nobody. **Flora → Sandbox** shows them, and **Clear sandbox** removes them.
- **Customer.** Plans become real inquiries through the same code as the website planner. Requests
  go to the team.

**Conversion.** A demonstration caller who wants a real consultation can ask for one. Flora asks
permission, then reads back the name, email and phone. Only after that does she create a new, real
inquiry from those details, the event type and date, and any notes. Nothing fictional is copied.
The confirmation email goes to the address they gave. Promotional texts are never switched on from a
call. Customers choose them on the website, separately.

## Safety

- **Identity.** Flora says she is an automated assistant in every greeting. The model is told never
  to claim otherwise.
- **Untrusted input.** Customer messages are data. The tools the model sees depend on the channel,
  the mode and what has been verified. The server checks each call again, with strict argument
  schemas, whatever the model asks for. A refused call is recorded as refused.
- **No direct database access.** The model only reaches the functions in `tools.ts`. Each returns
  just what the customer may see.
- **Orders.** A code goes to the email already on the order, and the reply is the same whether or not
  the details matched. Five wrong codes end the check. A verification lasts 30 minutes and covers one
  order.
- **Texts.** A text goes only to the number calling, only when the caller's own transcribed words
  contain a yes, at most once per call, only through the SMS provider (which needs A2P approval), and
  only to the allowlist outside production. Without texting, Flora reads a six-digit code. The code
  works on `/continue` for 24 hours, only with the last four digits of the calling number, and with
  attempts rate-limited.
- **Phone webhooks.** Every Twilio request must carry a valid `X-Twilio-Signature` for the exact
  public URL. The media stream is accepted only with a one-time token that is bound to the call and
  expires in two minutes.
- **Payments.** Flora never asks for card or bank details.

## Costs and limits

Settings → Flora holds the monthly limit. It is **zero by default, so Flora stays off** until the
owner sets one. Flora counts the estimated spend from each response's token counts at published
rates, plus Twilio call minutes. When the limit is reached, chats and calls stop until next month, and
a call in progress is asked to wrap up. Other limits:

- call length, 8 minutes by default; Twilio trial calls stop at 10 anyway;
- calls per number per day, 3;
- simultaneous calls, 2;
- messages per chat, 40;
- new chats per visitor per hour, 6;
- texts per call, 1.

Flora never buys credits or switches on automatic recharge. If the provider refuses for credits or
credentials, Flora pauses for 10 minutes and raises a critical alert in the dashboard. During the
pause the widget is hidden and the phone line says the assistant is unavailable.

Rough figures from the published rates, checked 2026-11-05:

| | Estimate |
| --- | --- |
| A 10-message website chat, gpt-5.4-mini | about 1 to 3 cents |
| A 5-minute call, gpt-realtime-2.1 | about 30 to 50 cents for the model, plus about 6.5 cents of Twilio time ($0.0085 a minute to receive, $0.0044 a minute for the stream) |
| The same call on gpt-realtime-2.1-mini | roughly a third of the model cost |
| Transcripts | under 1 cent per call |

The model cost of a call grows with its length, because each reply re-reads the conversation (most of
it at the cached rate). The dashboard shows the real token counts and estimated cost of every
conversation. The provider's invoice is the actual figure.

## Retention

Transcripts are kept for 90 days by default (**Settings → Flora**), then the words are removed. The
record of what Flora did (tools, requests, plans) stays. Owners can turn transcript storage off
entirely. No call audio is recorded or stored. The greeting says calls are transcribed.

## Setting it up

1. **A dedicated OpenAI key.** In the OpenAI dashboard, create a project for this business, give it
   a monthly budget, and create a key. Add credits; Flora never adds them.
2. **Twilio.** The account SID and auth token are needed, because the auth token is what signs
   webhooks. You also need a number for Flora.
   - A trial account has one number, accepts calls only from verified numbers, and limits calls to
     10 minutes.
   - Texting needs a Messaging Service with approved A2P 10DLC registration in the business's own
     name.
3. **Variables.**

   | Variable | Value |
   | --- | --- |
   | `AI_PROVIDER` | `openai` |
   | `OPENAI_API_KEY` | the dedicated key |
   | `VOICE_ENABLED` | `true` |
   | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | from the Twilio account |
   | `TWILIO_VOICE_NUMBER` | Flora's number, as `+1XXXXXXXXXX` |
   | `SMS_ENABLED`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_A2P_APPROVED` | for texting, once registration is approved |

   In staging, `scripts/staging.sh flora-credentials <env-file>` copies them from an env file without
   printing them.
4. **Point the number at the deployment.** Set the number's voice URL to
   `https://<address>/api/webhooks/voice/incoming` and its status callback to `.../status`. In
   staging, `scripts/staging.sh flora-line` does this, after `publish`. `flora-line release` restores
   the number's previous handling.
5. **Settings → Flora.** Turn on chat and/or phone, choose each mode, set the monthly limit, and
   review the greetings.
6. **Flora → Knowledge.** Write and publish the answers Flora may give.

## Verified, and not yet

| | Status |
| --- | --- |
| Tools, scoping, refusals, identity checks, sandbox isolation, conversion, budgets, limits, escalation, retention, signatures, the phone bridge (with stand-ins for Twilio and OpenAI) | Server tests: `server/modules/concierge/concierge.test.ts` |
| Chat widget, plan saved from chat, review page prefilled and edited, sent to the sandbox, dashboard | Browser test: `e2e/flora.spec.ts` (scripted model) |
| OpenAI API reached with the real key | **Yes**, 2026-11-05. The key is valid and lists the realtime models |
| A real AI conversation | **Not yet.** OpenAI refused with "You have no credits remaining" (chat: HTTP 429; realtime: `credit_balance_exhausted`). Flora degraded as designed: an apology in chat; on the phone, the call marked failed and an apology spoken |
| The phone path through the real server | Signed webhook, TwiML, one-time token, media WebSocket and Realtime connection exercised live with a synthetic caller. The model refused for credits, as above |
| A real inbound call through Twilio | **Not yet.** Needs a public address (`scripts/staging.sh publish`), the number attached (`flora-line`), credits, and a call from a verified number |
| A real text | **Not available.** The Twilio account has no A2P registration. All 8 earlier texts from it were undelivered with error 30034 |
