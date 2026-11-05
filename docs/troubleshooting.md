# Troubleshooting

Start with the dashboard's **System** page and **Launch checklist**. Most problems show up there
first, as a failed job, an open alert, or an unticked item.

## Customers

**Nothing can be ordered, or no times are offered.**
Check the **Launch checklist**. The usual causes are no pickup or delivery windows, the shop marked
closed, no sales tax rate, an unapproved Ordering rule, a closure on those dates, or products with no
way to be received. A warning appears under **Settings** for each of these.

**A delivery ZIP code is "outside the delivery area."**
Add the ZIP code to a zone under **Deliveries**.

**Today is never offered.**
Same-day orders are off by default, and when on, today disappears after the cutoff time and when
preparation could not finish in time during opening hours.

**An order says "With the shop for review."**
It needs a decision. The yellow panel on the order explains why: a custom order, an unapproved rule,
a full day, or a shortage.

**A customer paid, but the order still says "Waiting for payment."**
The order is only marked paid when Stripe's webhook arrives. Check **System → Payment events**. If
nothing arrived, check the webhook endpoint and signing secret in Stripe. The payment check that runs
every five minutes also asks Stripe directly, and catches up on its own.

**A customer's link "has expired."**
Order links from checkout and from order emails last for months, and links sent from the lookup form
last 7 days. Customers can always request a fresh one from **Order status** with their order number
and email, or sign in to their account.

## Messages

**No emails are arriving.**
Check **Messages & rules → Recently sent** for the status and reason. "Recorded, not delivered"
means `EMAIL_PROVIDER=log`. "Skipped: not on MESSAGE_ALLOWLIST" means a non-production server is
protecting real addresses. A provider error usually means the sending domain is not verified.

**Texts are not sent.**
Texts need Twilio credentials, `TWILIO_A2P_APPROVED=true`, the message switched on under
**Settings → Text messages**, and the customer's opt-in. Customers who replied STOP are blocked until
they reply START. Texts are held during quiet hours.

## Staff

**Someone cannot see a page or button.**
Their role does not include it. An owner can change roles under **Team**.

**Someone is locked out.**
They can use **Forgot your password?**. Repeated failed sign-ins lock the account briefly, and too many
attempts pause sign-in for 15 minutes.
An owner can deactivate and reactivate an account, which also signs it out everywhere.

**A move on the calendar is refused.**
The same rules that protect customers apply: closures, capacity, crews, staff days off and rentals.
The message says which one. A manager can override capacity when rescheduling an order.

## System

**A job failed.**
**System → Jobs** lists failed jobs with their error, and **Try again** requeues one. Jobs already
retry on their own, with growing delays, before they are marked failed.

**The readiness check reports the worker as down.**
Start the worker process (`node dist-server/worker.js`), or set `WORKER_EMBEDDED=true` for a single
process. Work queued meanwhile is done when it returns.

**Record checks report a problem.**
**System → Record checks** names the check and shows examples. Nothing is changed automatically. A
stock mismatch usually means a count was edited outside the dashboard. Record a stock count
correction to fix it. For payments, compare with the Stripe dashboard before changing anything.

**The server will not start.**
It prints which setting is unsafe or missing, for example simulated payments in production, or a
short `SESSION_SECRET`. Fix that setting. It will not start in an unsafe state.

**The site still says "concept".**
That is intentional until the owner approves launch. See [operations.md](operations.md#going-live).
