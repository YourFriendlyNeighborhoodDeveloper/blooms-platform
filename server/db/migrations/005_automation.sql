-- Notifications, the durable event/job engine, webhooks, content and calendar sync.

CREATE TABLE notification_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  audience text NOT NULL CHECK (audience IN ('customer', 'staff')),
  category text NOT NULL DEFAULT 'transactional' CHECK (category IN ('transactional', 'marketing')),
  name text NOT NULL,
  subject text,
  body text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  variables text[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, channel)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_code text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  audience text NOT NULL CHECK (audience IN ('customer', 'staff')),
  category text NOT NULL DEFAULT 'transactional',
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  staff_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  recipient text NOT NULL,
  subject text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'sending', 'sent', 'delivered', 'failed', 'suppressed', 'skipped', 'deferred'
  )),
  status_reason text,
  dedupe_key text NOT NULL UNIQUE,
  subject_type text,
  subject_id uuid,
  send_after timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  is_test boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_status_idx ON notifications (status, created_at DESC);
CREATE INDEX notifications_customer_idx ON notifications (customer_id, created_at DESC);
CREATE INDEX notifications_subject_idx ON notifications (subject_type, subject_id, created_at DESC);

ALTER TABLE customer_communications
  ADD CONSTRAINT customer_communications_notification_fk FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE SET NULL;

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_message_id text,
  status text NOT NULL,
  error_code text,
  error_message text,
  attempt integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_deliveries_notification_idx ON notification_deliveries (notification_id, created_at DESC);
CREATE UNIQUE INDEX notification_deliveries_provider_idx ON notification_deliveries (provider, provider_message_id) WHERE provider_message_id IS NOT NULL;

-- Transactional outbox: written in the same transaction as the business change.
CREATE TABLE automation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  subject_type text,
  subject_id uuid,
  payload jsonb NOT NULL DEFAULT '{}',
  dedupe_key text UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatched')),
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz
);
CREATE INDEX automation_events_pending_idx ON automation_events (created_at) WHERE status = 'pending';
CREATE INDEX automation_events_subject_idx ON automation_events (subject_type, subject_id, created_at DESC);

CREATE TABLE automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  action text NOT NULL CHECK (action IN ('notify_customer', 'notify_staff', 'create_task')),
  config jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  system boolean NOT NULL DEFAULT false,
  source_key text UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automation_rules_event_idx ON automation_rules (event_type, enabled);

CREATE TABLE automation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'dead', 'cancelled')),
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  last_error text,
  locked_by text,
  locked_until timestamptz,
  dedupe_key text UNIQUE,
  event_id uuid REFERENCES automation_events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX automation_jobs_claim_idx ON automation_jobs (run_at) WHERE status = 'queued';
CREATE INDEX automation_jobs_lease_idx ON automation_jobs (locked_until) WHERE status = 'running';
CREATE INDEX automation_jobs_dead_idx ON automation_jobs (updated_at DESC) WHERE status = 'dead';

CREATE TABLE worker_heartbeats (
  worker_id text PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  jobs_processed bigint NOT NULL DEFAULT 0
);

CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed', 'ignored')),
  attempts integer NOT NULL DEFAULT 0,
  error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, event_id)
);
CREATE INDEX webhook_events_status_idx ON webhook_events (status, received_at DESC);

CREATE TABLE facebook_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  title text,
  caption text,
  kind text NOT NULL DEFAULT 'video' CHECK (kind IN ('video', 'live')),
  enabled boolean NOT NULL DEFAULT true,
  featured boolean NOT NULL DEFAULT false,
  cta_label text,
  cta_url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX facebook_videos_one_featured ON facebook_videos (featured) WHERE featured;

CREATE TABLE content_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot text NOT NULL,
  title text NOT NULL,
  body text,
  image_url text,
  link_label text,
  link_url text,
  active boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX content_blocks_slot_idx ON content_blocks (slot, active, sort_order);

CREATE TABLE calendar_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'custom',
  division_id uuid REFERENCES business_divisions(id) ON DELETE SET NULL,
  staff_id uuid REFERENCES staff_profiles(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at >= starts_at)
);
CREATE INDEX calendar_entries_time_idx ON calendar_entries (starts_at);

-- One-way push to an external calendar. The platform owns the data, so an edit made on the
-- external side is never read back over a booking.
CREATE TABLE calendar_sync_links (
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  provider text NOT NULL,
  external_id text NOT NULL,
  content_hash text,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_type, source_id, provider)
);

CREATE TABLE data_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('export', 'delete')),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'completed', 'declined')),
  note text,
  handled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX data_requests_status_idx ON data_requests (status, created_at DESC);

-- Backs the simulated payment page used in development, tests and staging demos. Never used
-- when real Stripe keys are configured.
CREATE TABLE mock_gateway_sessions (
  id text PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  payment_intent_id text NOT NULL UNIQUE,
  amount_cents integer NOT NULL,
  description text NOT NULL,
  success_url text NOT NULL,
  cancel_url text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'processing', 'paid', 'failed', 'expired')),
  metadata jsonb NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

SELECT attach_updated_at_triggers();
