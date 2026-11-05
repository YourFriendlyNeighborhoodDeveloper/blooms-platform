# Administrator guide

For the owner and anyone with the Owner or Administrator role. Everything here happens in the team
dashboard at `/admin` on the shop's website.

## First-time setup, in order

1. **Sign in** with the owner account the developer created for you, then change the password under **Your account**.
2. **Settings → Hours & closures.** Enter the real opening hours and any closed dates. Preparation time is only counted during these hours.
3. **Team.** Invite each person, choose their role, tick what they do, and set their usual week under **Schedule**. Add your event crews.
4. **Products.** Add departments and categories, then each product with photos, price, options, preparation time and how it can be received. Remove the demo products.
5. **Deliveries.** Add delivery zones (ZIP codes, fee, minimum) and pickup and delivery windows.
6. **Services and Rentals.** Add wedding services and rental items, with prices only where you want them published.
7. **Settings.** Work through each section. Ordering, Delivery, Sales tax and Refunds each need your approval before orders are accepted without review.
8. **Messages & rules.** Read the customer messages and adjust the wording.
9. **Launch checklist.** Everything marked **Needed** must be done before taking real orders.

## The daily view

**Overview** shows what needs you today: orders waiting on a decision, failed payments, new wedding
inquiries, today's deliveries, low stock, capacity used today, and money in the period you choose.
Anything urgent appears at the top under **Needs attention**.

Numbers in test mode are labelled as test data. Net sales is money collected less refunds. It is not
profit, because costs, fees and wages are not recorded.

## Orders

- **Orders waiting for review** show a yellow panel explaining why: a custom order, an unapproved rule, a full day, or something out of stock. Choose **Accept**, **Ask the customer**, or **Decline**. Declining a paid order refunds it.
- **Moving work along.** Each item has its own buttons: Start preparing, Mark ready, Send out for delivery, Delivered, or Mark picked up. The customer is told automatically, and the order only finishes when every item has.
- **Change date or time** moves a pickup or delivery. The same rules that protect customers check the move. A manager can override capacity when they know the shop can do it.
- **Refund** returns money through Stripe, in full or in part. People without refund permission do not see the button, and there is an optional limit for non-owners under **Settings → Refunds**.
- **Record a return** puts items back in stock. It does not move money. Refund separately if needed.
- **Use a substitute** swaps a recipe ingredient for one you approved on the product's recipe.
- **Packing slip** opens a printable sheet with no prices on it.
- **Assigned team** records who is working on an order. The calendar's team filter uses it.

## Weddings and events

The **Pipeline** shows every inquiry by stage. Drag a card, or use its menu, to move it. Rename
stages or add your own with **Manage stages**.

On an inquiry you can accept it into planning, ask a question, suggest another date, hold the date for
a few days, book a consultation for the customer, build and send a quote, or decline. A quote
becomes a project when the customer accepts it. The date is confirmed only when the deposit is paid,
and the contract is marked signed if you required one.

The date check on every inquiry tells you whether crews, rentals and your daily event limit allow
it, and suggests nearby dates when they do not.

## Calendar

Month, week and day views. Drag an item to another day to reschedule it. The move is refused if the
shop cannot do it. Use the checkboxes to show or hide kinds of items, and the team filter to see one
person's work. Each day shows how full it is.

Staff can subscribe to their own read-only calendar feed from **Your account**. Editing an event in
Google or Apple Calendar never changes a booking.

## Settings worth knowing

- **Approvals.** Only an owner can approve Ordering, Delivery, Sales tax and Refunds. Until approved, every order goes to review.
- **Closures.** Add holidays and closures under **Settings → Hours & closures**. A closure can cover the whole business or one department, and can stop only some things, such as deliveries.
- **Capacity for one date.** Set a different limit for a busy holiday, or for a day when someone is out.
- Every settings change is recorded in the audit log under **System**.

For what each setting does, see [business-settings.md](business-settings.md).

## Team and permissions

Roles control what people can see and do. Owners can change each role under **Team → Edit what they
can do**. Deactivating someone signs them out everywhere immediately. Each person can see where they
are signed in, and sign out other devices, under **Your account**.

## When something goes wrong

- **System** shows background jobs, failed jobs you can retry, payment events received, open alerts, the audit log, and the record checks.
- **Record checks** confirm that stock, payments, invoices and bookings agree with each other. They run every six hours and raise an alert if anything disagrees.

See [troubleshooting.md](troubleshooting.md).
