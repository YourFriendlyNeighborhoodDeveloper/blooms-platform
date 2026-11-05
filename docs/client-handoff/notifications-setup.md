# Email and text messages

## Email

Customers get an email when they order, when their order is being prepared, when it is ready or out
for delivery, when it is done, and for every step of a wedding: inquiry received, consultation booked,
reminders, quote ready, deposit received, booking confirmed, balance due, and refunds. The team gets
alerts for new orders, new inquiries, orders needing a decision, low stock, failed payments, late
orders, and anything the system could not do.

### Setting it up

1. **A sending address on the business's own domain**, such as orders@ your domain. Email services will not send on behalf of a Gmail address, and mail from unverified senders tends to land in spam.
2. **An email sending service.** Resend is ready to use, and most others work too. It has a free tier for small volumes, and a paid plan for busier shops.
3. **Verifying the domain.** The email service gives a few DNS records to add where the domain is managed. This proves the business owns it, and keeps mail out of spam folders.
4. **A test.** In the dashboard, under **Messages & rules**, any message can be previewed and sent to yourself first.

### Changing what is sent

Under **Messages & rules**:

- Every message can be edited, previewed with sample details, and switched on or off.
- Placeholders such as the customer's first name or order number fill in automatically.
- **Recently sent** shows each message, who it went to, and whether it was delivered.

Marketing messages, such as a thank-you note or a reminder about an unfinished checkout, only go to
customers who ticked the box to receive them. They are off until you turn them on.

## Text messages (optional)

The platform works fully without texts. If you want them:

- **A Twilio account** in the business's name.
- **Carrier registration (A2P 10DLC).** US mobile carriers require businesses to register before sending texts. It needs your legal business name, tax ID, website, privacy policy and terms, and these must match each other. It takes days to weeks, and has small one-time and monthly fees.
- **You choose which messages go by text**, such as "ready for pickup" or consultation reminders.

Customers only get texts they ticked a box for. The box is never ticked for them. They can reply
STOP at any time to stop all texts, or HELP for help. Texts are held overnight during quiet hours.

## In the demonstration

- Every email is **captured** by a private test mailbox, never delivered to a real inbox, and labelled **[Test]**. The presenter can open the mailbox to show exactly what a customer would receive.
- Only addresses ending in @demo.example, and the presenter's own test address, are captured. Any other address typed during a demonstration is skipped, and shown as skipped in the dashboard.
- Text messages are **off**, because no Twilio account or carrier registration exists. No text is sent or simulated to any phone.
