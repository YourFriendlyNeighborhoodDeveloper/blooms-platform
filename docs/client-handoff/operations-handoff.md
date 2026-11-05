# Hosting, monitoring, backups and recovery

For whoever hosts and looks after the platform. Technical detail is in
[../operations.md](../operations.md).

## What runs

- **The website and dashboard**, served by one web process.
- **A background worker**, which sends messages, runs reminders and scheduled checks, and retries anything that failed. If it stops, work waits safely and is done when it starts again.
- **A PostgreSQL database**, which holds everything.
- **File storage** for photos and documents.

A restart loses nothing. All work is kept in the database, never only in memory.

## Keeping demonstration and real data apart

| | Demonstration (staging) | Real business (production) |
| --- | --- | --- |
| Database | Its own, full of fictional data | A new, empty database |
| Accounts | Fictional team at @demo.example | Real people, invited by the owner |
| Customers | Fictional | Real |
| Payments | Simulated, no money moves | The business's own Stripe account |
| Email | Captured in a test mailbox, never delivered | The business's sending service and domain |
| Text messages | Off | Only after carrier registration |
| Search engines | Told to stay away | Allowed after the owner approves |

**How a clean production database is made:**

1. Create a new, empty PostgreSQL database. Never copy or restore the staging database into production.
2. Deploy with the production configuration. The application creates its tables, and the structure it needs, on first start, with no products, prices, people or orders.
3. Create the owner account with the `create-owner` command. A one-time password is printed once.
4. The owner enters the real setup through **Set up your shop**, or imports products from a spreadsheet.
5. Never run the demo data command against production. It refuses to run in production, and refuses any database that already holds real products or orders.

The launch checklist also refuses to pass while any demonstration product is active.

## Monitoring

- `/readyz` reports whether the database answers and the worker is running. Point an uptime monitor at it.
- Errors and alerts can be sent to a chat channel or error service.
- The dashboard's **System** page shows failed jobs, which can be retried, payment events, open alerts, the audit log, and record checks.
- **Record checks** confirm that stock, payments, refunds, invoices, bookings and rentals agree with each other. They run every six hours, and raise an alert if they do not.

## Backups and recovery

- The database is backed up every night. Copy the backups somewhere other than the server too.
- To recover, restore a backup into a new, empty database, run the record checks on it, and then switch the application over to it. This was rehearsed on the staging deployment, and the restored copy matched the original and passed every check.
- Photos and documents need their own backup, or storage with versioning.
- Test a restore at least every 90 days, and record it in the launch checklist.

## Updates

Back up, deploy the new version, and check `/readyz` and the **System** page. If something goes
wrong, deploy the previous version again. Database changes are made to work with both versions.

## Who looks after it

Hosting, updates, security patches, monitoring and backups need an owner. They are not included
automatically, and should be agreed in writing, with the original developer or anyone qualified.
