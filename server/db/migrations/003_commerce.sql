-- Carts, promotions, delivery, orders, fulfilment and payments.

CREATE TABLE promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  description text,
  kind text NOT NULL CHECK (kind IN ('percent', 'fixed', 'free_delivery')),
  value integer NOT NULL DEFAULT 0 CHECK (value >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions integer CHECK (max_redemptions > 0),
  per_customer_limit integer CHECK (per_customer_limit > 0),
  redemption_count integer NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
  min_subtotal_cents integer NOT NULL DEFAULT 0 CHECK (min_subtotal_cents >= 0),
  division_ids uuid[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'percent' OR value <= 100),
  CHECK (max_redemptions IS NULL OR redemption_count <= max_redemptions)
);

CREATE TABLE carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_payment', 'converted', 'abandoned')),
  promotion_code citext,
  saved_details jsonb NOT NULL DEFAULT '{}',
  attribution jsonb NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX carts_expiry_idx ON carts (status, expires_at);

CREATE TABLE cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0 AND quantity <= 999),
  options jsonb NOT NULL DEFAULT '{}',
  options_key text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, variant_id, options_key)
);

CREATE TABLE delivery_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  postal_codes text[] NOT NULL DEFAULT '{}',
  fee_cents integer NOT NULL CHECK (fee_cents >= 0),
  min_order_cents integer NOT NULL DEFAULT 0 CHECK (min_order_cents >= 0),
  travel_minutes integer CHECK (travel_minutes >= 0),
  active boolean NOT NULL DEFAULT true,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_zones_postal_idx ON delivery_zones USING gin (postal_codes);

CREATE TABLE delivery_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('delivery', 'pickup')),
  zone_id uuid REFERENCES delivery_zones(id) ON DELETE CASCADE,
  division_id uuid REFERENCES business_divisions(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  cutoff_minutes integer NOT NULL DEFAULT 0 CHECK (cutoff_minutes >= 0),
  max_stops integer CHECK (max_stops >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
CREATE INDEX delivery_windows_lookup_idx ON delivery_windows (kind, weekday, active);

CREATE TABLE delivery_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  max_stops integer CHECK (max_stops >= 0),
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE delivery_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_date date NOT NULL,
  name text,
  driver_staff_id uuid REFERENCES staff_profiles(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES delivery_vehicles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_routes_date_idx ON delivery_routes (route_date);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  cart_id uuid REFERENCES carts(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN (
    'awaiting_payment', 'payment_processing', 'payment_failed', 'awaiting_review', 'needs_customer',
    'accepted', 'preparing', 'ready', 'out_for_delivery', 'shipped', 'partially_fulfilled', 'fulfilled',
    'completed', 'rescheduling', 'delivery_failed', 'inventory_shortage', 'rejected', 'cancelled', 'expired', 'returned'
  )),
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN (
    'not_required', 'unpaid', 'processing', 'paid', 'partially_refunded', 'refunded', 'failed'
  )),
  acceptance_mode text NOT NULL DEFAULT 'review' CHECK (acceptance_mode IN ('auto', 'review')),
  review_timing text NOT NULL DEFAULT 'approve_first' CHECK (review_timing IN ('approve_first', 'pay_first')),
  acceptance_reasons jsonb NOT NULL DEFAULT '[]',
  needs_attention boolean NOT NULL DEFAULT false,
  attention_reason text,
  contact_name text NOT NULL,
  contact_email citext NOT NULL,
  contact_phone text,
  customer_note text,
  subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  delivery_cents integer NOT NULL DEFAULT 0 CHECK (delivery_cents >= 0),
  shipping_cents integer NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  tax_cents integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  paid_cents integer NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  currency text NOT NULL DEFAULT 'usd',
  promotion_id uuid REFERENCES promotions(id) ON DELETE SET NULL,
  source text,
  attribution jsonb NOT NULL DEFAULT '{}',
  idempotency_key text UNIQUE,
  hold_expires_at timestamptz,
  is_test boolean NOT NULL DEFAULT false,
  placed_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  fulfilled_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total_cents = subtotal_cents - discount_cents + delivery_cents + shipping_cents + tax_cents),
  CHECK (refunded_cents <= paid_cents)
);
CREATE INDEX orders_customer_idx ON orders (customer_id, placed_at DESC);
CREATE INDEX orders_status_idx ON orders (status, placed_at DESC);
CREATE INDEX orders_placed_idx ON orders (placed_at DESC);
CREATE INDEX orders_attention_idx ON orders (needs_attention) WHERE needs_attention;
CREATE INDEX orders_hold_idx ON orders (hold_expires_at) WHERE hold_expires_at IS NOT NULL;

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  division_id uuid REFERENCES business_divisions(id) ON DELETE SET NULL,
  name text NOT NULL,
  variant_name text,
  sku text,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  options_price_cents integer NOT NULL DEFAULT 0,
  line_subtotal_cents integer NOT NULL CHECK (line_subtotal_cents >= 0),
  discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_cents integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  tax_category text,
  cost_estimate_cents integer,
  options jsonb NOT NULL DEFAULT '{}',
  prep_minutes integer NOT NULL DEFAULT 0,
  complexity_points integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'preparing', 'ready', 'out_for_delivery', 'shipped', 'fulfilled',
    'backordered', 'shortage', 'delivery_failed', 'cancelled', 'refunded', 'returned'
  )),
  refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_items_order_idx ON order_items (order_id, sort_order);
CREATE INDEX order_items_product_idx ON order_items (product_id);

ALTER TABLE inventory_movements ADD COLUMN order_id uuid REFERENCES orders(id) ON DELETE SET NULL;

CREATE TABLE inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL CHECK (status IN ('held', 'committed', 'released', 'consumed', 'backorder')),
  expires_at timestamptz,
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id uuid REFERENCES order_items(id) ON DELETE CASCADE,
  project_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'held' OR expires_at IS NOT NULL)
);
CREATE INDEX inventory_reservations_order_idx ON inventory_reservations (order_id);
CREATE INDEX inventory_reservations_expiry_idx ON inventory_reservations (expires_at) WHERE status = 'held';
CREATE INDEX inventory_reservations_item_idx ON inventory_reservations (item_id, status);

CREATE TABLE order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id uuid REFERENCES order_items(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  actor_type text NOT NULL DEFAULT 'system',
  actor_id uuid,
  note text,
  customer_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_status_history_order_idx ON order_status_history (order_id, created_at);

CREATE TABLE order_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  staff_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_notes_order_idx ON order_notes (order_id, created_at);

CREATE TABLE fulfillments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('pickup', 'delivery', 'shipping')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'preparing', 'ready', 'out_for_delivery', 'shipped', 'fulfilled', 'failed', 'cancelled', 'returned'
  )),
  scheduled_date date,
  window_start timestamptz,
  window_end timestamptz,
  window_id uuid REFERENCES delivery_windows(id) ON DELETE SET NULL,
  fee_cents integer NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  recipient_name text,
  recipient_phone text,
  address jsonb,
  instructions text,
  card_message text,
  carrier text,
  tracking_number text,
  tracking_url text,
  assigned_staff_id uuid REFERENCES staff_profiles(id) ON DELETE SET NULL,
  ready_at timestamptz,
  shipped_at timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fulfillments_order_idx ON fulfillments (order_id);
CREATE INDEX fulfillments_schedule_idx ON fulfillments (scheduled_date, method);

CREATE TABLE fulfillment_items (
  fulfillment_id uuid NOT NULL REFERENCES fulfillments(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (fulfillment_id, order_item_id)
);

CREATE TABLE deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_id uuid NOT NULL UNIQUE REFERENCES fulfillments(id) ON DELETE CASCADE,
  zone_id uuid REFERENCES delivery_zones(id) ON DELETE SET NULL,
  route_id uuid REFERENCES delivery_routes(id) ON DELETE SET NULL,
  driver_staff_id uuid REFERENCES staff_profiles(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES delivery_vehicles(id) ON DELETE SET NULL,
  stop_sequence integer,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled', 'assigned', 'out_for_delivery', 'delivered', 'failed', 'rescheduled', 'cancelled'
  )),
  attempt integer NOT NULL DEFAULT 1,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  proof_note text,
  proof_storage_key text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deliveries_route_idx ON deliveries (route_id);
CREATE INDEX deliveries_driver_idx ON deliveries (driver_staff_id, status);

-- Production and delivery load promised against a calendar date. Row-based rather than a counter,
-- so a release can never drift; writers take a per-date advisory lock before summing and inserting.
CREATE TABLE capacity_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_date date NOT NULL,
  division_id uuid REFERENCES business_divisions(id) ON DELETE SET NULL,
  points integer NOT NULL DEFAULT 0,
  prep_minutes integer NOT NULL DEFAULT 0,
  counts_as_order boolean NOT NULL DEFAULT true,
  stops integer NOT NULL DEFAULT 0,
  window_id uuid REFERENCES delivery_windows(id) ON DELETE SET NULL,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  fulfillment_id uuid REFERENCES fulfillments(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX capacity_claims_date_idx ON capacity_claims (claim_date, status);
CREATE INDEX capacity_claims_order_idx ON capacity_claims (order_id);

CREATE TABLE promotion_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX promotion_redemptions_customer_idx ON promotion_redemptions (promotion_id, customer_id);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE RESTRICT,
  invoice_id uuid,
  gateway text NOT NULL CHECK (gateway IN ('stripe', 'mock', 'manual')),
  kind text NOT NULL DEFAULT 'order' CHECK (kind IN ('order', 'deposit', 'balance', 'invoice')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'succeeded', 'failed', 'expired', 'cancelled'
  )),
  checkout_session_id text UNIQUE,
  payment_intent_id text UNIQUE,
  checkout_url text,
  session_expires_at timestamptz,
  refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  failure_reason text,
  manual_reference text,
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  amount_mismatch boolean NOT NULL DEFAULT false,
  livemode boolean NOT NULL DEFAULT false,
  paid_at timestamptz,
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (refunded_cents <= amount_cents),
  CHECK (order_id IS NOT NULL OR invoice_id IS NOT NULL)
);
CREATE INDEX payments_order_idx ON payments (order_id);
CREATE INDEX payments_invoice_idx ON payments (invoice_id);
CREATE INDEX payments_open_idx ON payments (status, created_at) WHERE status IN ('pending', 'processing');

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled')),
  gateway_refund_id text UNIQUE,
  failure_reason text,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refunds_payment_idx ON refunds (payment_id);
CREATE INDEX refunds_order_idx ON refunds (order_id);

CREATE TABLE returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  reason text,
  restock boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'received', 'rejected')),
  refund_id uuid REFERENCES refunds(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX returns_order_idx ON returns (order_id);

CREATE TABLE support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  topic text NOT NULL,
  name text NOT NULL,
  email citext NOT NULL,
  phone_e164 text,
  message text NOT NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'open', 'closed')),
  assigned_to uuid REFERENCES staff_profiles(id) ON DELETE SET NULL,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_requests_status_idx ON support_requests (status, created_at DESC);

CREATE TABLE customer_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound', 'note')),
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'phone', 'portal', 'note')),
  subject text,
  body text,
  notification_id uuid,
  staff_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  subject_type text,
  subject_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_communications_customer_idx ON customer_communications (customer_id, created_at DESC);
CREATE INDEX customer_communications_subject_idx ON customer_communications (subject_type, subject_id, created_at DESC);

SELECT attach_updated_at_triggers();
