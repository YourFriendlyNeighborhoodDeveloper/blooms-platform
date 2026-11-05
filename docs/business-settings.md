# Business settings

Every rule below is changed under **Settings** in the dashboard, takes effect immediately, and is
recorded in the audit log. Defaults are deliberately cautious. Groups marked **approval** also need
an owner to press **I approve these rules**. Until then, orders wait for a person to review them.

## Hours & closures

| Setting | What it does |
| --- | --- |
| Shop hours | Opening times for each day. Preparation time is only counted while the shop is open. Once saved, the public site shows these instead of the unverified listing. |
| Closures | Dates when the shop, or one department, stops taking orders, pickups, deliveries, shipping, consultations or events. A message can be shown to customers. |
| Capacity for specific dates | A different limit for one date, such as a holiday rush or a day when someone is away. |

## Ordering (approval)

| Setting | Default | What it does |
| --- | --- | --- |
| Allow same-day orders | Off | Whether today can be chosen at all. |
| Same-day cutoff | None | After this time, today is no longer offered. |
| Minimum notice for every order | 48 hours | Products can ask for more. |
| Most orders in a day | Not set | Without a limit, the system cannot tell when the day is full, so orders go to review. |
| Most workload points in a day | Not set | Each product carries points, so one large piece counts for more than one small bouquet. |
| Custom orders need approval | Yes | |
| When something is out of stock | Stop the sale | Or send for review, or allow backorder. Each product can override this. |
| For orders needing review | Approve first | Approve first means no money is taken until you accept. Pay first takes payment, and refunds in full if you decline. |
| Hold stock during review | 48 hours | |
| Days ahead customers can order | 21 | |
| Mark complete after fulfilment | 24 hours | |
| Late order alert | 60 minutes | Staff are alerted when an order runs this late. |

## Delivery & shipping (approval)

| Setting | Default | What it does |
| --- | --- | --- |
| Ready this long before the window | 60 minutes | Added to preparation time. |
| Most stops per driver per window | Not set | |
| Only offer delivery when a driver is scheduled | Yes | Uses each driver's schedule and days off. |
| Require proof of delivery | No | |
| Offer shipping | No | |
| Flat shipping charge and free-shipping threshold | Not set | |
| States you ship to | None | |

Delivery zones, fees, minimum orders and windows are set on the **Deliveries** page.

## Sales tax (approval)

Rates per tax category, for example `standard = 6` and `exempt = 0`. Every product must use a listed
category. You also choose whether delivery fees and shipping are taxable. Checkout stays closed until
a rate is set. Please have your accountant confirm the rates.

## Refunds (approval)

The refund policy shown at checkout, and an optional limit on how much non-owners can refund.

## Weddings & events

Minimum notice, most events per day, assumed start time and length, setup, teardown, travel and
break times, preparation days, crews per event, people per crew, usual deposit, when the balance is
due, how long quotes last, how long a date is held after acceptance, follow-up reminders, whether a
signed contract is required, the cancellation policy, and the event types, budget ranges and styles
offered in the planner. See [owner-checklist.md](owner-checklist.md) for the defaults.

## Consultations

Whether customers can book online, length, gap between consultations, minimum notice, how far
ahead, how often a start time is offered, when the reminder is sent, and the ways to meet.

## Contact details

Business name, phone, public email, address, Facebook page and a note about hours. These appear in
messages and on the site.

## Shop

Whether the online shop is open, whether checkout works without an account, the business timezone,
and a notice shown in the shop.

## Staff alerts & quiet hours

The name shown on emails, an extra inbox for staff alerts, and the quiet hours when texts are held
until morning.

## Text messages

Which messages go by text, the sender name, the replies to HELP, STOP and START, and the consent
wording shown next to the checkboxes. Texts also need Twilio and completed carrier registration.

## Follow-ups

The thank-you note after orders, and reminders about unfinished checkouts. Both are off by default,
and both go only to customers who opted in to marketing email.

## Privacy & terms

The privacy policy and terms of sale shown on the site, and how long abandoned carts, unsent planner
photos and message contents are kept.

## Safety checks

When you save, the dashboard warns about combinations that would stop sales or overpromise. For
example: the shop is open but has no pickup or delivery times, same-day orders are on with no cutoff,
or a product has no way to be received.
