-- Catalog, stock, procurement and recipes.

CREATE TABLE product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id uuid NOT NULL REFERENCES business_divisions(id) ON DELETE RESTRICT,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id uuid NOT NULL REFERENCES business_divisions(id) ON DELETE RESTRICT,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  short_description text,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  is_custom boolean NOT NULL DEFAULT false,
  tax_category text NOT NULL DEFAULT 'standard',
  prep_minutes integer NOT NULL DEFAULT 0 CHECK (prep_minutes >= 0),
  complexity_points integer NOT NULL DEFAULT 1 CHECK (complexity_points >= 0),
  min_lead_hours integer NOT NULL DEFAULT 0 CHECK (min_lead_hours >= 0),
  allow_pickup boolean NOT NULL DEFAULT false,
  allow_delivery boolean NOT NULL DEFAULT false,
  allow_shipping boolean NOT NULL DEFAULT false,
  delivery_restriction text,
  restricted_zone_ids uuid[] NOT NULL DEFAULT '{}',
  season_start_md text CHECK (season_start_md ~ '^[0-1][0-9]-[0-3][0-9]$'),
  season_end_md text CHECK (season_end_md ~ '^[0-1][0-9]-[0-3][0-9]$'),
  available_from date,
  available_until date,
  requires_approval boolean,
  out_of_stock_behavior text CHECK (out_of_stock_behavior IN ('reject', 'review', 'backorder')),
  return_policy text,
  featured boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_listing_idx ON products (status, division_id, sort_order);
CREATE INDEX products_search_idx ON products USING gin (to_tsvector('english', name || ' ' || coalesce(short_description, '') || ' ' || coalesce(description, '')));

CREATE TABLE product_category_links (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES product_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);
CREATE INDEX product_category_links_category_idx ON product_category_links (category_id);

CREATE TABLE product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT 'Standard',
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  sale_price_cents integer CHECK (sale_price_cents >= 0),
  cost_estimate_cents integer CHECK (cost_estimate_cents >= 0),
  prep_minutes integer CHECK (prep_minutes >= 0),
  complexity_points integer CHECK (complexity_points >= 0),
  weight_grams integer CHECK (weight_grams >= 0),
  attributes jsonb NOT NULL DEFAULT '{}',
  track_inventory boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_variants_product_idx ON product_variants (product_id, sort_order);

CREATE TABLE product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  url text NOT NULL,
  storage_key text,
  alt text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_images_product_idx ON product_images (product_id, sort_order);

CREATE TABLE product_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  input_type text NOT NULL CHECK (input_type IN ('select', 'multiselect', 'text', 'textarea')),
  required boolean NOT NULL DEFAULT false,
  max_length integer CHECK (max_length > 0),
  help_text text,
  choices jsonb NOT NULL DEFAULT '[]',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, code)
);

CREATE TABLE inventory_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX inventory_locations_one_default ON inventory_locations (is_default) WHERE is_default;

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_name text,
  email citext,
  phone text,
  website text,
  lead_time_days integer CHECK (lead_time_days >= 0),
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  division_id uuid REFERENCES business_divisions(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'finished_good' CHECK (kind IN ('finished_good', 'material', 'packaging', 'other')),
  unit text NOT NULL DEFAULT 'each',
  variant_id uuid UNIQUE REFERENCES product_variants(id) ON DELETE SET NULL,
  low_stock_threshold integer CHECK (low_stock_threshold >= 0),
  reorder_quantity integer CHECK (reorder_quantity >= 0),
  perishable boolean NOT NULL DEFAULT false,
  shelf_life_days integer CHECK (shelf_life_days >= 0),
  default_supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  cost_cents integer CHECK (cost_cents >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- available = on_hand - reserved. Reserving is one conditional UPDATE, so concurrent checkouts
-- cannot both take the last unit. reserved may exceed on_hand only when stock is written off
-- after being promised, which is reported as a shortage rather than hidden.
CREATE TABLE inventory_levels (
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  on_hand integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, location_id)
);

CREATE TABLE inventory_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  quantity_received integer NOT NULL CHECK (quantity_received > 0),
  quantity_remaining integer NOT NULL CHECK (quantity_remaining >= 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  best_by date,
  quality_check_on date,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_lots_expiry_idx ON inventory_lots (best_by) WHERE quantity_remaining > 0;

CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  delta_on_hand integer NOT NULL DEFAULT 0,
  delta_reserved integer NOT NULL DEFAULT 0,
  reason text NOT NULL CHECK (reason IN (
    'receive', 'adjust', 'count', 'waste', 'spoilage', 'return', 'sale', 'reserve', 'release', 'commit', 'transfer', 'substitute'
  )),
  ref_type text,
  ref_id uuid,
  lot_id uuid REFERENCES inventory_lots(id) ON DELETE SET NULL,
  note text,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_movements_item_idx ON inventory_movements (item_id, created_at DESC);

CREATE TABLE supplier_items (
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  supplier_sku text,
  cost_cents integer CHECK (cost_cents >= 0),
  lead_time_days integer CHECK (lead_time_days >= 0),
  PRIMARY KEY (supplier_id, item_id)
);

CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'partially_received', 'received', 'cancelled')),
  expected_on date,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  sent_at timestamptz,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  received_quantity integer NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  unit_cost_cents integer CHECK (unit_cost_cents >= 0),
  UNIQUE (purchase_order_id, item_id)
);

CREATE TABLE product_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  name text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((product_id IS NOT NULL) <> (variant_id IS NOT NULL))
);
CREATE UNIQUE INDEX product_recipes_product_idx ON product_recipes (product_id) WHERE product_id IS NOT NULL AND active;
CREATE UNIQUE INDEX product_recipes_variant_idx ON product_recipes (variant_id) WHERE variant_id IS NOT NULL AND active;

CREATE TABLE recipe_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES product_recipes(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  notes text,
  UNIQUE (recipe_id, item_id)
);

CREATE TABLE recipe_substitutes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id uuid NOT NULL REFERENCES recipe_components(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  note text,
  UNIQUE (component_id, item_id)
);

CREATE TABLE low_stock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  available integer NOT NULL,
  threshold integer NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX low_stock_events_open_idx ON low_stock_events (item_id) WHERE resolved_at IS NULL;

SELECT attach_updated_at_triggers();
