-- Weddings and events: planner, availability, consultations, rentals, quotes, projects, invoices.

CREATE TABLE service_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id uuid REFERENCES business_divisions(id) ON DELETE SET NULL,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wedding_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES service_categories(id) ON DELETE RESTRICT,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  image_url text,
  -- package: published fixed price. estimate: published range, not a promise. custom_quote: no price shown.
  pricing_mode text NOT NULL DEFAULT 'custom_quote' CHECK (pricing_mode IN ('package', 'estimate', 'custom_quote')),
  unit text NOT NULL DEFAULT 'each',
  unit_price_cents integer CHECK (unit_price_cents >= 0),
  est_low_cents integer CHECK (est_low_cents >= 0),
  est_high_cents integer CHECK (est_high_cents >= 0),
  taxable boolean NOT NULL DEFAULT true,
  workload_points integer NOT NULL DEFAULT 0 CHECK (workload_points >= 0),
  setup_minutes integer NOT NULL DEFAULT 0 CHECK (setup_minutes >= 0),
  requires_crew boolean NOT NULL DEFAULT false,
  recipe_id uuid REFERENCES product_recipes(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (pricing_mode <> 'package' OR unit_price_cents IS NOT NULL),
  CHECK (pricing_mode <> 'estimate' OR (est_low_cents IS NOT NULL AND est_high_cents IS NOT NULL AND est_high_cents >= est_low_cents))
);

CREATE TABLE pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'open' CHECK (kind IN ('open', 'won', 'lost')),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wedding_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  event_date date NOT NULL,
  ceremony_time time,
  reception_time time,
  venue_name text,
  venue_address text,
  guest_count integer CHECK (guest_count >= 0),
  budget_range text,
  consultation_format text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'in_review', 'clarification_requested', 'date_suggested', 'accepted', 'declined', 'converted', 'closed'
  )),
  stage_id uuid NOT NULL REFERENCES pipeline_stages(id) ON DELETE RESTRICT,
  availability jsonb NOT NULL DEFAULT '{}',
  estimate jsonb NOT NULL DEFAULT '{}',
  suggested_date date,
  clarification_request text,
  decline_reason text,
  assigned_to uuid REFERENCES staff_profiles(id) ON DELETE SET NULL,
  idempotency_key text UNIQUE,
  source text,
  attribution jsonb NOT NULL DEFAULT '{}',
  is_test boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wedding_inquiries_stage_idx ON wedding_inquiries (stage_id, event_date);
CREATE INDEX wedding_inquiries_customer_idx ON wedding_inquiries (customer_id);
CREATE INDEX wedding_inquiries_date_idx ON wedding_inquiries (event_date);

CREATE TABLE wedding_questionnaires (
  inquiry_id uuid PRIMARY KEY REFERENCES wedding_inquiries(id) ON DELETE CASCADE,
  answers jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rental_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  description text,
  image_url text,
  quantity integer NOT NULL CHECK (quantity >= 0),
  price_cents integer CHECK (price_cents >= 0),
  setup_requirements text,
  logistics_notes text,
  requires_delivery boolean NOT NULL DEFAULT false,
  cleaning_buffer_minutes integer NOT NULL DEFAULT 0 CHECK (cleaning_buffer_minutes >= 0),
  replacement_cost_cents integer CHECK (replacement_cost_cents >= 0),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wedding_inquiry_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid NOT NULL REFERENCES wedding_inquiries(id) ON DELETE CASCADE,
  service_id uuid REFERENCES wedding_services(id) ON DELETE SET NULL,
  rental_item_id uuid REFERENCES rental_items(id) ON DELETE SET NULL,
  name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  notes text,
  pricing_mode text NOT NULL,
  unit text,
  unit_price_cents integer,
  est_low_cents integer,
  est_high_cents integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((service_id IS NOT NULL) OR (rental_item_id IS NOT NULL) OR pricing_mode = 'custom_quote')
);
CREATE INDEX wedding_inquiry_items_inquiry_idx ON wedding_inquiry_items (inquiry_id);

CREATE TABLE resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('crew', 'vehicle', 'space', 'equipment')),
  name text NOT NULL,
  division_id uuid REFERENCES business_divisions(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE blackout_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'business' CHECK (scope IN ('business', 'division', 'resource')),
  division_id uuid REFERENCES business_divisions(id) ON DELETE CASCADE,
  resource_id uuid REFERENCES resources(id) ON DELETE CASCADE,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  reason text NOT NULL DEFAULT 'closure' CHECK (reason IN ('closure', 'holiday', 'weather', 'capacity', 'special_event', 'other')),
  -- Empty means everything: orders, pickup, delivery, shipping, consultations, events.
  affects text[] NOT NULL DEFAULT '{}',
  public_message text,
  note text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  CHECK (scope <> 'division' OR division_id IS NOT NULL),
  CHECK (scope <> 'resource' OR resource_id IS NOT NULL)
);
CREATE INDEX blackout_rules_range_idx ON blackout_rules (starts_on, ends_on);

CREATE TABLE capacity_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  on_date date NOT NULL,
  division_id uuid REFERENCES business_divisions(id) ON DELETE CASCADE,
  max_orders integer CHECK (max_orders >= 0),
  max_points integer CHECK (max_points >= 0),
  max_stops integer CHECK (max_stops >= 0),
  max_events integer CHECK (max_events >= 0),
  same_day_enabled boolean,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (on_date, division_id)
);

CREATE TABLE consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid REFERENCES wedding_inquiries(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  staff_id uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE RESTRICT,
  format text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  during tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'completed', 'cancelled', 'no_show')),
  notes text,
  cancelled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CONSTRAINT consultations_no_double_booking EXCLUDE USING gist (staff_id WITH =, during WITH &&) WHERE (status = 'booked')
);
CREATE INDEX consultations_inquiry_idx ON consultations (inquiry_id);
CREATE INDEX consultations_time_idx ON consultations (starts_at);
CREATE UNIQUE INDEX consultations_one_active_per_inquiry ON consultations (inquiry_id) WHERE status = 'booked' AND inquiry_id IS NOT NULL;

CREATE TABLE event_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid NOT NULL REFERENCES wedding_inquiries(id) ON DELETE CASCADE,
  -- inquiry: nothing reserved. hold: expiring reservation. approved: staff committed, awaiting
  -- payment or contract. confirmed: conditions met. Only hold onward reserves resources.
  status text NOT NULL DEFAULT 'inquiry' CHECK (status IN ('inquiry', 'hold', 'approved', 'confirmed', 'completed', 'cancelled')),
  hold_expires_at timestamptz,
  event_date date NOT NULL,
  event_start timestamptz NOT NULL,
  event_end timestamptz NOT NULL,
  setup_minutes integer NOT NULL DEFAULT 0 CHECK (setup_minutes >= 0),
  teardown_minutes integer NOT NULL DEFAULT 0 CHECK (teardown_minutes >= 0),
  travel_minutes integer NOT NULL DEFAULT 0 CHECK (travel_minutes >= 0),
  buffer_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_minutes >= 0),
  crews_required integer NOT NULL DEFAULT 1 CHECK (crews_required >= 0),
  workload_points integer NOT NULL DEFAULT 0 CHECK (workload_points >= 0),
  prep_days integer NOT NULL DEFAULT 0 CHECK (prep_days >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (event_end > event_start),
  CHECK (status <> 'hold' OR hold_expires_at IS NOT NULL)
);
CREATE INDEX event_bookings_date_idx ON event_bookings (event_date, status);
CREATE UNIQUE INDEX event_bookings_one_active_per_inquiry ON event_bookings (inquiry_id) WHERE status NOT IN ('cancelled');

CREATE TABLE resource_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL REFERENCES event_bookings(id) ON DELETE CASCADE,
  phase text NOT NULL CHECK (phase IN ('setup', 'event', 'teardown', 'other')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  during tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  status text NOT NULL DEFAULT 'hold' CHECK (status IN ('hold', 'approved', 'confirmed', 'released')),
  hold_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CONSTRAINT resource_no_overlap EXCLUDE USING gist (resource_id WITH =, during WITH &&) WHERE (status <> 'released')
);
CREATE INDEX resource_reservations_booking_idx ON resource_reservations (booking_id);

CREATE TABLE rental_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_item_id uuid NOT NULL REFERENCES rental_items(id) ON DELETE RESTRICT,
  booking_id uuid REFERENCES event_bookings(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  buffer_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_minutes >= 0),
  blocked_until timestamptz NOT NULL,
  blocked_during tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, blocked_until, '[)')) STORED,
  status text NOT NULL DEFAULT 'hold' CHECK (status IN ('hold', 'approved', 'confirmed', 'out', 'returned', 'cancelled')),
  hold_expires_at timestamptz,
  returned_at timestamptz,
  condition_notes text,
  damage_notes text,
  damage_cost_cents integer CHECK (damage_cost_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX rental_reservations_item_idx ON rental_reservations (rental_item_id, status);
CREATE INDEX rental_reservations_blocked_idx ON rental_reservations USING gist (blocked_during);
CREATE INDEX rental_reservations_booking_idx ON rental_reservations (booking_id);

-- Quantity-aware overlap check. Runs inside the writer's transaction with the rental item row
-- locked, so two simultaneous reservations cannot both claim the last piece. A piece stays
-- blocked through its cleaning buffer, including late returns.
CREATE FUNCTION enforce_rental_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cap integer;
  peak integer;
  rng tstzrange;
BEGIN
  NEW.blocked_until := COALESCE(NEW.returned_at, NEW.ends_at) + make_interval(mins => NEW.buffer_minutes);
  IF NEW.blocked_until < NEW.ends_at AND NEW.status NOT IN ('returned', 'cancelled') THEN
    NEW.blocked_until := NEW.ends_at + make_interval(mins => NEW.buffer_minutes);
  END IF;
  IF NEW.status NOT IN ('hold', 'approved', 'confirmed', 'out') THEN
    RETURN NEW;
  END IF;

  SELECT quantity INTO cap FROM rental_items WHERE id = NEW.rental_item_id FOR UPDATE;
  rng := tstzrange(NEW.starts_at, NEW.blocked_until, '[)');

  SELECT COALESCE(MAX(load), 0) INTO peak FROM (
    SELECT (
      SELECT COALESCE(SUM(r.quantity), 0)
      FROM rental_reservations r
      WHERE r.rental_item_id = NEW.rental_item_id
        AND r.id IS DISTINCT FROM NEW.id
        AND r.status IN ('hold', 'approved', 'confirmed', 'out', 'returned')
        AND NOT (r.status = 'hold' AND r.hold_expires_at IS NOT NULL AND r.hold_expires_at <= now())
        AND r.blocked_during @> pt
    ) AS load
    FROM (
      SELECT lower(rng) AS pt
      UNION
      SELECT lower(r.blocked_during)
      FROM rental_reservations r
      WHERE r.rental_item_id = NEW.rental_item_id
        AND r.id IS DISTINCT FROM NEW.id
        AND r.blocked_during && rng
        AND lower(r.blocked_during) > lower(rng)
    ) points
  ) loads;

  IF peak + NEW.quantity > cap THEN
    RAISE EXCEPTION 'rental capacity exceeded: % of % already reserved', peak, cap
      USING ERRCODE = 'BL001', CONSTRAINT = 'rental_capacity';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rental_reservations_capacity BEFORE INSERT OR UPDATE ON rental_reservations
  FOR EACH ROW EXECUTE FUNCTION enforce_rental_capacity();

CREATE TABLE quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  inquiry_id uuid NOT NULL REFERENCES wedding_inquiries(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired', 'superseded')),
  subtotal_cents integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_cents integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  deposit_cents integer NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),
  valid_until date,
  terms text,
  customer_message text,
  internal_notes text,
  requires_contract boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  sent_at timestamptz,
  accepted_at timestamptz,
  accepted_name text,
  accepted_ip text,
  declined_at timestamptz,
  decline_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (deposit_cents <= total_cents),
  CHECK (total_cents = subtotal_cents - discount_cents + tax_cents)
);
CREATE INDEX quotes_inquiry_idx ON quotes (inquiry_id, version DESC);
CREATE UNIQUE INDEX quotes_one_accepted_per_inquiry ON quotes (inquiry_id) WHERE status = 'accepted';

CREATE TABLE quote_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  service_id uuid REFERENCES wedding_services(id) ON DELETE SET NULL,
  rental_item_id uuid REFERENCES rental_items(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  taxable boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  CHECK (total_cents = quantity * unit_price_cents)
);
CREATE INDEX quote_line_items_quote_idx ON quote_line_items (quote_id, sort_order);

CREATE TABLE wedding_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  inquiry_id uuid NOT NULL UNIQUE REFERENCES wedding_inquiries(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  booking_id uuid REFERENCES event_bookings(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'in_preparation', 'event_scheduled', 'completed', 'cancelled')),
  contract_status text NOT NULL DEFAULT 'not_required' CHECK (contract_status IN ('not_required', 'pending', 'sent', 'signed')),
  contract_signed_at timestamptz,
  lead_staff_id uuid REFERENCES staff_profiles(id) ON DELETE SET NULL,
  notes text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wedding_projects_customer_idx ON wedding_projects (customer_id);

ALTER TABLE inventory_reservations
  ADD CONSTRAINT inventory_reservations_project_fk FOREIGN KEY (project_id) REFERENCES wedding_projects(id) ON DELETE CASCADE;

CREATE TABLE wedding_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid REFERENCES wedding_inquiries(id) ON DELETE CASCADE,
  project_id uuid REFERENCES wedding_projects(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'inspiration' CHECK (kind IN ('inspiration', 'contract', 'proposal', 'other')),
  storage_key text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  sha256 text NOT NULL,
  customer_visible boolean NOT NULL DEFAULT false,
  draft_token_hash text,
  uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wedding_documents_inquiry_idx ON wedding_documents (inquiry_id);
CREATE INDEX wedding_documents_project_idx ON wedding_documents (project_id);
CREATE INDEX wedding_documents_draft_idx ON wedding_documents (draft_token_hash) WHERE inquiry_id IS NULL;

CREATE TABLE project_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES wedding_projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  due_on date,
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'done', 'skipped')),
  customer_visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  source_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, source_key)
);
CREATE INDEX project_milestones_project_idx ON project_milestones (project_id, sort_order);

CREATE TABLE project_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES wedding_projects(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  needed_by date,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, item_id)
);

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  project_id uuid REFERENCES wedding_projects(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'custom' CHECK (kind IN ('deposit', 'balance', 'custom')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'partially_paid', 'paid', 'void')),
  subtotal_cents integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  paid_cents integer NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  due_on date,
  notes text,
  sent_at timestamptz,
  paid_at timestamptz,
  overdue_notified_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  is_test boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total_cents = subtotal_cents + tax_cents)
);
CREATE INDEX invoices_customer_idx ON invoices (customer_id);
CREATE INDEX invoices_project_idx ON invoices (project_id);
CREATE INDEX invoices_due_idx ON invoices (status, due_on);

ALTER TABLE payments
  ADD CONSTRAINT payments_invoice_fk FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT;

CREATE TABLE invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX invoice_line_items_invoice_idx ON invoice_line_items (invoice_id, sort_order);

CREATE TABLE payment_schedule_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES wedding_projects(id) ON DELETE CASCADE,
  label text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  due_on date,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'invoiced', 'paid', 'cancelled')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_schedule_items_project_idx ON payment_schedule_items (project_id, sort_order);

-- Owner-editable checklists generated when a project or order is confirmed.
CREATE TABLE task_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('wedding_project', 'order')),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  offset_days integer NOT NULL DEFAULT 0,
  est_minutes integer,
  required_capability text,
  customer_visible_milestone boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

SELECT attach_updated_at_triggers();
