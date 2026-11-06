# Services and running costs

Every outside service the platform can use, who should own the account, and what it costs to run.
Prices were taken from each provider's own pricing page on 2026-11-05. They change, and free tiers can
shrink or end, so check the linked pages before budgeting. Nothing here is free forever.

## Required to take orders

| Service | What it is for | Account owner | Recurring cost |
| --- | --- | --- | --- |
| Hosting | Runs the website, the dashboard and the background worker | The business, or as agreed | A small virtual server starts at about $4 a month. For the web server, worker and database on one machine, plan on a 2 GB server, about $12 to $24 a month at DigitalOcean's listed prices. |
| Database | Stores everything | The business, or as agreed | Included above when it runs on the same server. A managed PostgreSQL database, with automatic backups, starts at about $15 a month plus storage. |
| Domain name | The website address, and the sending address for email | The business | A yearly registration fee, typically in the range of $10 to $25 a year for a .com. This is an estimate: prices vary by registrar. |
| Stripe | Card payments | The business | No monthly fee on standard pricing. 2.9% + 30¢ for each successful domestic card payment, plus 1.5% for international cards, and 1% more when currency is converted. Refunds and disputes have their own terms. |
| Email provider | Order confirmations, updates, staff alerts | The business | Resend's free plan covers 3,000 emails a month, at most 100 a day. A busy day can pass 100, since each order sends several messages, so a paid plan from $20 a month (50,000 emails) is more realistic once orders flow. Any SMTP service also works. |

## Optional

| Service | What it is for | Recurring cost |
| --- | --- | --- |
| Twilio | Text message updates | Each 160-character segment costs $0.0083, plus a carrier fee of about $0.0035 to $0.005, depending on the carrier. Carrier registration (A2P 10DLC) costs a one-time brand fee ($4.50 for a low-volume standard brand, or $46 for a standard brand), $15 per campaign for vetting, and a monthly campaign fee from $1.50 to $10. The phone number itself has a monthly charge. |
| OpenAI API | Flora, the AI concierge ([flora.md](flora.md)) | Pay as you go, from prepaid credits; no monthly fee. gpt-5.4-mini costs $0.75 per million input tokens and $4.50 per million output tokens. gpt-realtime-2.1 audio costs $32 per million input tokens and $64 per million output tokens; gpt-realtime-2.1-mini costs $10 and $20. A 10-message chat comes to about 1 to 3 cents, and a 5-minute call to about 30 to 50 cents on gpt-realtime-2.1. Flora stops at the monthly limit set in the dashboard, and never buys credits. |
| Twilio Voice | Flora's phone line | Receiving a call on a local number costs $0.0085 a minute, plus $0.0044 a minute for the audio stream to Flora. A local number is $1.15 a month. A trial account allows one number and calls only from verified numbers. |
| File storage (S3-compatible) | Planner photos and event documents, off the server | Cloudflare R2: the first 10 GB each month are free, then $0.015 per GB a month, with no charge for downloads. Local disk storage costs nothing extra, but needs its own backup. |
| Off-server backup copies | Surviving the loss of the server | A few cents to a few dollars a month for storage. |
| Google Calendar | One shared team calendar | None for the push itself. A Google account is needed. |
| Facebook | Videos on the site | None. No Meta developer app is needed. |
| Error alerts | Sending errors to a chat channel or error service | Many services have free tiers. Optional. |

## Not included

- **Ongoing maintenance.** Updates, security patches, monitoring, and help with problems are not included automatically, and no ongoing obligation is created by delivering this software. Arrange them separately, with the original developer or anyone qualified. See [handoff.md](handoff.md).
- **Professional advice.** An accountant should confirm sales tax, and a lawyer should review the privacy policy, terms, refund and cancellation policies.

## Sources

- [Stripe pricing](https://stripe.com/pricing)
- [Resend pricing](https://resend.com/pricing) and [Resend plan limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits)
- [Twilio SMS pricing, United States](https://www.twilio.com/en-us/sms/pricing/us)
- [Twilio A2P 10DLC fees](https://support.twilio.com/hc/en-us/articles/1260803965530-What-pricing-and-fees-are-associated-with-the-A2P-10DLC-service)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [DigitalOcean Droplet pricing](https://www.digitalocean.com/pricing/droplets) and [Managed Databases pricing](https://www.digitalocean.com/pricing/managed-databases)
