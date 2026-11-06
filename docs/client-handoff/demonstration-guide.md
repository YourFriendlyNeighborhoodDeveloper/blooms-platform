# Demonstration guide

A guided tour of the real platform in 10 to 15 minutes, using the staging deployment and its
fictional data. Everything shown is the working system: nothing here is a mock-up made for the
presentation.

## Be clear about what is real

Say this early, and keep to it:

- **Real:** the website, the shop rules, the database, the order and wedding workflows, the dashboard, the automation, and the tracking pages.
- **Simulated:** payments (a clearly marked stand-in for Stripe's page, so no money moves), and email (captured in a test mailbox, never delivered).
- **Not running:** text messages, which need carrier registration (A2P 10DLC) in the business's name.
- **Flora:** a real AI model when the deployment's OpenAI key has credits. She works only with the demonstration's fictional data and never pretends to be a person.
- **Fictional:** every product, price, customer, team member and wedding.
- **Not Blooms' live website.** It is a demonstration by Abraxas Technologies.

## The night before

1. Keep the Mac on power, with the lid open, and stop it sleeping: **System Settings → Battery → Options → Prevent automatic sleeping when the display is off**, or run `caffeinate -ims &` in a terminal.
2. Make sure Docker Desktop is running, then in the project folder:
   ```sh
   scripts/staging.sh up            # starts staging, if it is not already running
   scripts/staging.sh reset --yes   # fresh demo data; note the dates it prints
   scripts/staging.sh publish       # a public https address for the phone
   ```
   `publish` makes the staging copy on this Mac reachable from the internet through Cloudflare, at an address ending in `trycloudflare.com`. The address is new each time, and is written to `deploy/staging/access.txt` along with the sign-in details.
3. Open `deploy/staging/access.txt`. Keep it to yourself.
4. On the iPhone, open the public address and bookmark it. Check that the home page loads.
5. On the laptop, using the **same public address** (not localhost), open three tabs:
   - **A, the shop:** the public address.
   - **B, the dashboard:** the address followed by `/admin`, signed in as `owner@demo.example`.
   - **C, the mailbox:** the address followed by `/mailbox/`, with the mailbox sign-in.
6. Note the scenario dates the reset printed: the full Saturday delivery window, the driver's day off, and the fully booked wedding date.

## The tour

### Part 1: a customer orders (3 minutes, on the phone)

1. Home page, then **Shop**.
2. Open **Classic Rose Bouquet (demo)**. Choose **A dozen**, a rose color, and type a card message.
3. **Add to cart**, then **View cart**, then **Checkout**.
4. Enter a name and an email address ending in `@demo.example`, such as `you@demo.example`. Only those, and the presenter's own test address, reach the test mailbox.
5. Choose **Pick up at the shop**. Point out that only times the shop can actually meet are offered.
6. Show the total, with tax, then **Continue to secure payment**.
7. Explain the payment page: in real use this is Stripe's page. Choose **Pay (simulate success)**.
8. The private tracking page appears, marked as a test order.

### Part 2: the owner sees it (2 minutes, laptop tab B)

1. **Overview**: the new order, the money taken today, and what needs attention.
2. **Orders**: open the new order. Show the payment, the card message, the tasks created for the florist, and the history.
3. Under **Assigned team**, assign **Finley Florist**.

### Part 3: the customer follows along (2 minutes, both)

1. On the order, press **Start preparing**. On the phone, refresh the tracking page: **Being prepared**.
2. Press **Mark ready**. Refresh: **Ready**.
3. In tab C, the mailbox shows the emails the customer received at each step, each labelled **[Test]**.
4. Press **Mark picked up**. Refresh: **Fulfilled**.

### Part 4: a wedding planned at 11:30 p.m. (3 minutes)

1. On the phone, open **Plan your event**. Enter a Saturday next year, a venue, guests and a budget.
2. Add colors and a short description, and upload a photo.
3. Add a **Bridal bouquet**, the **Reception centerpiece package**, and the **Birch ceremony arch**.
4. Show the estimate: published prices, estimates and custom quotes are kept apart, and it says it is not a final price.
5. Show the date check, then **Send my plan**. The thank-you page offers consultation times. Book one.
6. In the dashboard, open **Pipeline**: the inquiry is already there. Open it to show the selections, photo and date check.
7. Press **New quote**, set a price and a deposit, **Save draft**, then **Send to customer**. The quote email appears in the mailbox.
8. Optional: open the quote link from that email, accept it, pay the simulated deposit, and show the project created with its tasks.

### Part 5: the rules that protect the shop (2 to 3 minutes)

1. **A fully booked date.** In the planner, enter the fully booked wedding date. It is refused, with the reasons and nearby dates that work.
2. **A full delivery window.** Order a bouquet for delivery to ZIP 48609 on the full Saturday. The morning window is not offered, while the afternoon is.
3. **An absent employee.** On the driver's day off, delivery is not offered at all.
4. **Sold out.** The **Linen Throw Pillow (demo)** cannot be added to the cart.
5. **Not enough time.** The **Custom Floral Design (demo)** needs three days' notice, so nothing sooner is offered.

### Part 6: the owner changes the rules (2 minutes, dashboard)

1. **Settings → Ordering:** same-day orders, cutoffs and daily limits, and the owner's approval.
2. **Products:** change a price, or show **From a spreadsheet**.
3. **Team:** a schedule, and a day off.
4. **Set up your shop:** the guided list for her real setup.
5. Optional, the fully booked date again. Under **Team → Event crews**, add a crew. Under **Settings → Weddings & events**, set **Most events in a day** to 3 and **People per crew** to 1. The date check now opens. Change both back afterwards.

### Part 7: Flora, the AI concierge (2 to 3 minutes, optional)

Flora needs the deployment's own OpenAI key with credits. Without them she shows **Offline right
now**. She still opens, says why, and offers the shop, the planner, tracking and the shop's number, so
the presentation never shows anything broken. The link `/?chat=open` opens her directly. On the phone line she also needs the number
attached (`scripts/staging.sh flora-line`, after `publish`). Check **Dashboard → Flora** first: both
channels should say **Answering**. If either does not, skip that part rather than improvise.

1. **Chat, on the phone browser.** Tap **Ask Flora**, then **Plan my wedding**. Give a date, a venue,
   guests and colors. Point out that she says she is an automated assistant and that this is a
   demonstration. She checks the date and offers **Review and send my plan**.
2. **The review page.** Everything she saved is filled in. Change one thing, then send it. It lands
   in the sandbox, not the pipeline: show **Dashboard → Flora → Sandbox**, then open the conversation
   to show each lookup she made.
3. **The phone, if attached.** Call the number from the presenter's own verified phone. Plan a
   wedding the same way. When she offers a text, say yes. On this demonstration line she reads a
   six-digit code instead, because texting needs carrier registration. Open **Continue a call** on
   the website, enter the code and the last four digits of your phone, and the plan from the call
   appears.
4. **Safety, in one line.** Ask her to refund an order, or for someone else's order. She declines and
   offers to pass the request to a person.

Never call or text Samantha, her staff or customers from the demonstration line.

### Close### Close

Point to [owner-onboarding.md](owner-onboarding.md) for what the business would provide, and
[launch-checklist.md](launch-checklist.md) for what happens before real customers.

## Afterwards

```sh
scripts/staging.sh reset --yes   # fresh demo data for next time
scripts/staging.sh unpublish     # take it off the internet
```

In the mailbox, press **Delete all** to clear old messages.

## If something goes wrong

- **The page will not load on the phone.** Run `scripts/staging.sh status`. If the address changed, run `scripts/staging.sh resync` and use the new address from `access.txt`.
- **A button says "Cross-site request blocked."** The tab is using a different address from the published one. Use the public address in every tab.
- **Today is never offered.** That is correct after the 1 p.m. same-day cutoff, or when there is not enough time to prepare.
- **An email did not appear.** Only addresses ending in `@demo.example`, and the presenter's test address, are captured. Others show as skipped under **Messages & rules → Recently sent**.
