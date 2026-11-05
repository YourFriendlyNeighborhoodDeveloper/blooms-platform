# Taking payments with Stripe

Customers pay on Stripe's own secure page, so card numbers never reach the Blooms website. Money goes
directly into the business's Stripe account, and from there to the business's bank account.

## What the business does

1. **Create a Stripe account in the business's name** at stripe.com, or use an existing one. It must belong to the business, not to the developer or anyone personally.
2. **Complete Stripe's verification:** business details, a bank account for payouts, and identity checks. Stripe requires these before paying out.
3. **Decide who on the team can sign in to Stripe.** Stripe lets you invite people with limited access.
4. **Give the developer access to connect it,** through Stripe's team invitation. Do not email passwords or keys.

## What the developer does

1. Connects the account in **test mode** first, using Stripe's test keys.
2. Runs a connection check that confirms the right account is connected, then places test orders with Stripe's test cards: a success, a decline, and a refund.
3. Confirms each one appears correctly in both Stripe and the dashboard.
4. Only then, with your written approval, switches to live mode. The system refuses to take real payments until a person deliberately turns them on.

## What customers see

- A secure Stripe page with the order total, which they can pay by card. Other payment methods can be turned on in Stripe.
- Afterwards, a confirmation page and a confirmation email, and a private page to follow the order.
- If a payment fails, nothing is charged, and they can try again from the same page.

## What the business sees

- Each order shows its payment status, the amount paid, and its payment history.
- **Refunds** are issued from the order, in full or in part. People without refund permission do not see the button, and non-owners can be given a limit.
- **Reports** show money collected, refunds, and net sales. Net sales is not profit: card fees, costs and wages are not included.

## Fees

Stripe charges a fee on each successful card payment. For US cards on standard pricing, this was
2.9% plus 30¢ at the time of writing, with more for international cards. Check
[stripe.com/pricing](https://stripe.com/pricing) for current rates.

## In the demonstration

Payments are **simulated**. The payment page is clearly marked, and offers a success, a payment that
stays pending, and a failed payment, so every path can be shown. No card is requested and no money
moves. This is not a test of a real Stripe account.
