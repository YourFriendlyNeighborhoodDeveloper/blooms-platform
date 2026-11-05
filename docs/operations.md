# Operations

How to deploy, run, watch, back up, restore and roll back the platform. Written for whoever hosts and
maintains it.

## What runs

| Process | Command | Notes |
| --- | --- | --- |
| Web server | `node dist-server/index.js` | Serves the API and the built site (`SERVE_STATIC=true`). Runs database migrations at startup, under a lock, so several instances can start at once. |
| Worker | `node dist-server/worker.js` | Sends messages, runs scheduled jobs, retries failures. Run at least one. Several are safe. |
| PostgreSQL 17 | | Needs the `btree_gist` and `citext` extensions, which the migrations create. |

For a small deployment the worker can run inside the web process (`WORKER_EMBEDDED=true`). Separate
processes are better, because a busy web server then never delays messages, and the reverse.

All state lives in PostgreSQL, plus uploaded files in storage. A restart loses nothing. Work queued
while the worker is down is done when it returns. This was rehearsed: an order was paid with the
worker stopped, the web server was restarted, and the worker sent exactly one confirmation when it
came back.

## Deploying with Docker Compose (one server)

`docker-compose.prod.yml` runs the web server, worker, PostgreSQL, nightly backups, and Caddy for
automatic HTTPS.

1. Point the domain's DNS at the server.
2. Copy `.env.example` to `.env.production` and fill it in. See [Configuration](#configuration).
3. Start it:
   ```sh
   export POSTGRES_PASSWORD='a long random value'
   export SITE_DOMAIN=shop.example.com
   docker compose -f docker-compose.prod.yml up -d --build
   ```
4. Create the owner account:
   ```sh
   docker compose -f docker-compose.prod.yml exec web node dist-server/cli.js create-owner owner@example.com "Owner Name"
   ```
   A temporary password is printed once. Change it after signing in.
5. Open `/admin`, then work through the **Launch checklist**.

Other hosts work too. Any platform that runs a Docker image, or Node 22 or newer, plus a managed
PostgreSQL 17, is enough. Run the same image twice with different commands for the web server and the
worker.

## Configuration

Every variable is listed, with comments, in `.env.example`. Never commit real values. The server
checks its configuration at startup and refuses to start on anything unsafe, for example:

- simulated payments in production,
- a live Stripe key outside production, or without `LIVE_PAYMENTS_APPROVED=true`,
- a missing or short `SESSION_SECRET`, or a non-https address, once deployed,
- a real email provider without a sender address.

Incomplete optional integrations, such as Twilio without A2P registration, switch themselves off and
log a warning instead.

`TRUST_PROXY` matters for rate limiting. Use `true` behind one proxy you control, such as the Caddy
container, and `cloudflare` only when every request must pass through Cloudflare. With the wrong
value, clients could disguise their address.

## Going live

These are deliberate steps, taken by a person, in this order:

1. Every **Needed** item on the dashboard's **Launch checklist** is done.
2. Stripe has been verified with the business's test key (`npm run verify:stripe`), and a full test payment, refund and webhook delivery were made by hand. See [integrations.md](integrations.md).
3. Switch to the live Stripe keys, and set `LIVE_PAYMENTS_APPROVED=true`.
4. With the owner's approval, rebuild with `SITE_MODE=production`. This removes the concept notices and allows search engines. Set it in `.env.production` too.
5. Place one small real order with a real card, refund it, and confirm both arrive in Stripe and in the dashboard.

## Scheduled jobs

The worker runs these on its own. Each is deduplicated, so several workers never run one twice.

| Every | Jobs |
| --- | --- |
| 1 minute | Expire unpaid order holds, after asking Stripe |
| 5 minutes | Expire event date holds; reconcile open payments with Stripe |
| 10 minutes | Alert on late orders |
| 15 minutes | Consultation reminders; mark fulfilled orders complete; alert on failing jobs |
| 30 minutes | Abandoned checkout reminders (if enabled); alert on unassigned deliveries |
| 1 hour | Expire carts and quotes; follow-ups; upcoming events and milestones; invoice reminders; rental returns; low stock; data retention; cleanup |
| 6 hours | Perishable stock nearing its date; record checks |

## Health and monitoring

- `GET /healthz` answers when the process is up. Use it for liveness checks.
- `GET /readyz` answers 200 when the database responds and a worker checked in within the last few minutes, and 503 otherwise. Use it for readiness checks and uptime monitoring.
- Logs are JSON lines on standard output. Secrets, tokens, cookies and passwords are redacted.
- Set `ERROR_WEBHOOK_URL` to receive errors and alerts in a chat channel or error service.
- In the dashboard, **System** shows failed jobs (with retry), payment events, open alerts, the audit log, and record checks.
- **Record checks** confirm that stock, payments, refunds, invoices, bookings and rentals agree with each other. They run every six hours and raise an alert if not. Run them by hand with `node dist-server/cli.js check`.

No uptime figure is promised. The design aims for quick recovery: no work is held in memory, every
external call is retried safely, and the database enforces the rules that matter.

## Backups

The `backup` service writes a compressed dump every night to `BACKUP_DIR` and keeps
`BACKUP_KEEP_DAYS` days. **Copy those files somewhere off the server as well**, for example to the
business's cloud storage. A backup on the same disk does not survive losing that disk.

For a one-off backup:

```sh
DATABASE_URL=postgres://... scripts/backup.sh backups
```

Managed databases usually include their own daily backups and point-in-time recovery. Keep them on.

Uploaded files are a second thing to back up. With `STORAGE_PROVIDER=s3`, use the provider's
versioning or replication. With local storage, back up the `storage` volume.

## Restoring

Always restore into a new, empty database first. Check it, and only then switch to it.

```sh
createdb blooms_restored   # or create it in your provider's console
TARGET_DATABASE_URL=postgres://.../blooms_restored scripts/restore.sh backups/blooms-YYYYMMDDTHHMMSSZ.dump
DATABASE_URL=postgres://.../blooms_restored node dist-server/cli.js check
```

The restore script refuses a database that already has tables, unless `RESTORE_REPLACE=yes` is set.
Then point `DATABASE_URL` at the restored database and restart the web server and worker.

This procedure was rehearsed on 2026-11-05 with the production compose file. Row counts matched
the original, all record checks passed on the restored copy, and the audit log was still
append-only. Repeat the rehearsal at least every 90 days, then record it on the **Launch checklist**
with **I tested a restore today**.

## Updating and rolling back

1. Back up the database.
2. Build and start the new version. Migrations run automatically at startup, each in its own transaction, so a failed migration changes nothing. A migration file that was edited after being applied stops startup, rather than leaving databases quietly different.
3. Check `/readyz` and the dashboard's **System** page.

To roll back the code, deploy the previous image tag (`BLOOMS_VERSION`). This works when the new
release's migrations only added tables or columns, which is true of every migration so far. Keep it
that way: add in one release, remove in a later one. If a release ever needs a change the previous
version cannot run against, say so in its notes, because rolling back then means restoring the
backup taken in step 1.

## Data retention

Abandoned carts, unsent planner photos and old message contents are deleted on the schedule set
under **Settings → Privacy & terms**. Customers can ask for a copy of their data or to be erased.
Staff handle these under **Customers**. Erasing removes personal details while keeping order totals
for the financial records. The audit log is permanent.
