# Database

PostgreSQL 17. One database holds everything the business runs on: there is no second copy of
orders, customers, bookings or stock anywhere else.

## Conventions

- Primary keys are UUIDs. Customer-facing references, such as `BL-8KQ2-4TZM`, are random, so they cannot be guessed in sequence.
- Money is stored in whole cents as integers. Totals are checked by constraints, for example an order's total must equal items less discount plus delivery, shipping and tax.
- Moments in time are `timestamptz`. Calendar dates, such as an event date, are `date`, and the business timezone (America/Detroit by default) is a setting. Daylight saving changes are tested.
- Every table that changes has `created_at` and `updated_at`, kept by a trigger.
- Test and demo rows are flagged (`is_test`, `is_demo`) and kept out of reports.

## Migrations

Plain SQL files in `server/db/migrations`, applied in order at startup by `server/db/migrate.ts`.
Each runs in a transaction under an advisory lock, and each file's checksum is recorded. If an applied
file is later edited, startup stops rather than letting environments drift apart. Add new changes as
new files, and never edit an applied one.

TypeScript types for every table are generated from the live schema into `server/db/types.gen.ts`
with `npm run db:types`. Run it after adding a migration.

## Tables by area

| File | Area | Tables |
| --- | --- | --- |
| `001_foundation.sql` | Business, people, access | business_divisions, business_settings, business_hours, users, roles, permissions, role_permissions, user_roles, customers, customer_addresses, customer_consents, sms_suppressions, sessions, access_tokens, staff_profiles, staff_availability, staff_time_off, staff_assignments, staff_tasks, audit_logs, integration_settings, system_alerts |
| `002_catalog_inventory.sql` | Products and stock | product_categories, products, product_category_links, product_variants, product_images, product_options, inventory_locations, suppliers, inventory_items, inventory_levels, inventory_lots, inventory_movements, supplier_items, purchase_orders, purchase_order_lines, product_recipes, recipe_components, recipe_substitutes, low_stock_events |
| `003_commerce.sql` | Carts, orders, payments, delivery | promotions, carts, cart_items, delivery_zones, delivery_windows, delivery_vehicles, delivery_routes, orders, order_items, inventory_reservations, order_status_history, order_notes, fulfillments, fulfillment_items, deliveries, capacity_claims, promotion_redemptions, payments, refunds, returns, support_requests, customer_communications |
| `004_events.sql` | Weddings, events, scheduling | service_categories, wedding_services, pipeline_stages, wedding_inquiries, wedding_questionnaires, rental_items, wedding_inquiry_items, resources, blackout_rules, capacity_overrides, consultations, event_bookings, resource_reservations, rental_reservations, quotes, quote_line_items, wedding_projects, wedding_documents, project_milestones, project_materials, invoices, invoice_line_items, payment_schedule_items, task_templates |
| `005_automation.sql` | Messages, jobs, integrations, content | notification_templates, notifications, notification_deliveries, automation_events, automation_rules, automation_jobs, worker_heartbeats, webhook_events, facebook_videos, content_blocks, calendar_entries, calendar_sync_links, data_requests, mock_gateway_sessions |

These cover every entity in the build directive's list. `StaffAvailability` is split into usual
weekly hours and time off, and `InventoryReservation` covers both order stock and project materials.

## How the database prevents the expensive mistakes

| Risk | Protection |
| --- | --- |
| Selling the last item twice | Stock is reserved with one conditional update, `on_hand - reserved >= quantity`, so concurrent buyers cannot both succeed. `CHECK` constraints keep counts from going negative. |
| Booking one crew for two events | An exclusion constraint on `resource_reservations`: one resource cannot have two overlapping time ranges. |
| Double-booking a consultant | The same kind of constraint on `consultations`, per staff member. |
| Renting out more than the shop owns | A trigger on `rental_reservations` adds up overlapping reservations, including each item's cleaning buffer after its return, and refuses any that would exceed the quantity owned. |
| Overfilling a day | Daily capacity claims are made under a lock per date, and checked again at the moment of placing the order. |
| Charging or fulfilling twice | Orders carry a unique idempotency key. Webhooks are stored once per provider event ID. Payments are unique per Checkout session and payment intent. Refunds can never exceed the payment (`CHECK refunded <= amount`). |
| Two accepted quotes for one inquiry | A unique partial index allows only one. |
| Rewriting history | `audit_logs` rejects updates and deletes with a trigger. Order status changes are kept in `order_status_history`. |
| Leaking customer data | Access links are stored only as hashes, are scoped to one purpose, and expire. Passwords use scrypt. Card numbers are never seen. |

## Record checks

Some rules span many rows, so a constraint cannot express them. `server/modules/system/integrity.ts`
checks them: stock against its movement history, reservations against reserved counts, payments
against orders and invoices, refunds against payments, finished orders against their items, closed
orders against held stock and capacity, rentals against quantities owned, and confirmed events against
crew reservations. It runs every six hours, from the dashboard, or with `npm run db:check`.

## Privacy

- Customers can be exported or erased from the dashboard. Erasing removes personal details while keeping amounts for the financial records.
- Retention periods for abandoned carts, unsent uploads and message contents are settings, and a scheduled job applies them.
- Consent is stored as a history of grants and withdrawals, each with its wording, time and source.
