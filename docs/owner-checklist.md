# Owner checklist

These are the decisions and accounts only the business can provide. Nothing on this list has been
assumed. Until an item is settled, the system uses a cautious default that never promises something
the shop may not be able to do, and most of these defaults send orders to a person for review.

The same list appears inside the dashboard, under **Launch checklist**, and ticks itself off as items
are completed.

## 1. Who the business is

- **Business name.** Public listings disagree. WeddingWire uses "Blooms Boutique and Floral", The Knot still shows "Magical I Do's", and the Facebook page address is `facebook.com/magicalidos`. Which name should customers, receipts and text messages use?
- **Departments.** Floral, Boutique, and Weddings & Events are set up. Rename, add or switch any off under **Products → Departments and categories**.
- **Contact details and hours.** The website currently shows the hours from the township listing, marked as unverified. Once you save your real hours under **Settings → Hours & closures**, the site shows those instead and drops the warning.

## 2. Payments

- **A Stripe account in the business's name.** It must be the business's own account, not a personal or developer account. Payments go straight to it.
- **Who can see it.** Decide who on your team needs Stripe dashboard access.
- *Until then:* the shop uses a simulated payment page, clearly marked, and no money moves. The server refuses to accept live payments until the account is connected, tested, and a person turns live payments on deliberately.

## 3. Sales tax

- **Rates, and what is taxable.** Michigan's state sales tax rate is 6%. Your accountant should confirm which products, delivery fees and shipping charges are taxable, and whether shipping to other states creates any duties.
- *Until then:* checkout stays closed. No rate is assumed.

## 4. Products and prices

- **Your real products.** Name, photos, price, options, preparation time and how each one can be received. The demo products are fictional and marked "(demo)". The checklist will not pass while any are active.
- **Wedding services and packages.** For each one, decide whether to publish a fixed price, an estimate range, or "custom quote". Nothing has been priced for you.

## 5. Ordering rules

Under **Settings → Ordering**, and approved by you before they take effect:

| Rule | Current safe default |
| --- | --- |
| Same-day orders | Off |
| Same-day cutoff time | Not set |
| Minimum notice for any order | 48 hours |
| Most orders per day | Not set, so every order goes to review |
| Most workload points per day | Not set |
| Custom orders | Need your approval |
| When something is out of stock | Stop the sale |
| Orders needing review | Approve first, then ask for payment |

## 6. Delivery

- **Zones.** Which ZIP codes, the fee for each zone, and any minimum order.
- **Windows.** Which days and times you deliver, the order cutoff for each, and the most stops per window.
- **Drivers and vehicles.** Who drives, and on which days.
- *Until then:* there are no zones, so delivery is not offered online. Pickup works once pickup times exist.

## 7. Team and capacity

- **Who works when.** Each person's usual week, days off, and what they do (prepare orders, drive, consultations, events).
- **What each person may see.** Choose a role for each person. Employees do not see financial details or issue refunds unless you allow it.
- **Event crews.** How many crews can work events at the same time. This is what stops a date being overbooked.

## 8. Weddings and events

| Policy | Current safe default |
| --- | --- |
| Minimum notice for an event | 90 days |
| Most events in a day | Not set, so the team reviews every date |
| Setup, teardown and travel times | 3 hours, 2 hours, 1 hour each way |
| Days of preparation before an event | 2 |
| Usual deposit | Not set, so you set it on each quote |
| Balance due | 14 days before the event |
| Quotes valid for | 14 days |
| Date held after a quote is accepted | 7 days |
| Contract required | No |

- **Cancellation policy.** It is shown with every quote. Please have a lawyer review it.
- **Deposit rules.** Whether deposits are refundable, and when.

## 9. Messages to customers

- **A sending address on a domain the business owns.** For example, orders@ followed by your domain. Email providers will not send on behalf of a Gmail address, and messages from unverified senders tend to land in spam. If the business has no website domain yet, one needs to be bought, at roughly the cost of a domain each year.
- **An email provider account.** Resend is set up and ready. Any SMTP service also works.
- **Which messages go out.** Every message can be edited, previewed, and switched off under **Messages & rules**.
- *Until then:* messages are recorded in the dashboard but not sent.

## 10. Text messages (optional)

- **Whether to use them at all.** The system works fully without them.
- **If yes:** a Twilio account, and US carrier registration (A2P 10DLC) for the business. Registration needs the business's legal name, tax ID, website, privacy policy and terms, and these have to match each other. It takes days to weeks, and carries one-time and monthly fees. See [costs-and-services.md](costs-and-services.md).
- Customers only ever get texts they ticked a box for, can reply STOP at any time, and texts are held during quiet hours.

## 11. Legal pages

- **Privacy policy and terms of sale.** Required before taking real orders, and before text message registration. Please have them written or reviewed by a lawyer. The demo text is a placeholder and says so.
- **Refund policy.** Shown at checkout before anyone pays.

## 12. Facebook

- **The official page address.** To confirm it is `facebook.com/magicalidos`, or to give the new one.
- **Which videos to show.** Paste the link of any public video or live video under **Marketing**. No Meta developer app or approval is needed for this.

## 13. Hosting and domain

- **Who owns the hosting account and the domain.** They should be in the business's name, or held by someone the business chooses, according to your agreement with the developer.
- **Who looks after it.** Someone needs to watch alerts, keep backups, and apply updates. This is not included automatically. See [handoff.md](handoff.md).

## 14. Going live

The website is currently an unlaunched concept. It says so on every page, and asks search engines not to list it. When you are ready, and only with your approval, a single setting removes those notices.
