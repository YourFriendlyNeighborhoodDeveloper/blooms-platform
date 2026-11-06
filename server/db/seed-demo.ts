import { randomBytes } from 'node:crypto';
import type { Db } from './client.js';
import { createStaffUser } from '../auth/staff.js';
import { SYSTEM_ACTOR } from '../lib/audit.js';
import { changeStock, defaultLocationId } from '../modules/inventory/service.js';
import { setApproval, updateSetting } from '../modules/settings/service.js';

/**
 * Fictional data for local development, staging walkthroughs and browser tests. Every price, limit,
 * zone, name and policy below is invented to exercise the software. None of it is a recommendation,
 * and none of it reflects the real business. Products and services carry is_demo so the launch
 * checklist can flag them, and the command refuses to run in production or beside real catalog data.
 */

const EXAMPLE_NOTE = 'Demo data with example pricing. Replace before accepting real customers.';

const ROSES = (stems: number) => [{ item: 'MAT-ROSE-STEM', quantity: stems }, { item: 'MAT-GREENS', quantity: 1 }, { item: 'MAT-WRAP', quantity: 1 }];

const PRODUCTS: Array<{
  slug: string; name: string; division: 'floral' | 'boutique'; category: string; short: string; description: string; image: string; alt: string;
  variants: Array<{ name: string; price: number; sale?: number; cost?: number; stock?: number | null; low?: number; recipe?: Array<{ item: string; quantity: number }> }>;
  prep?: number; points?: number; lead?: number; pickup?: boolean; delivery?: boolean; shipping?: boolean; custom?: boolean; approval?: boolean; featured?: boolean; season?: [string, string]; outOfStock?: 'reject' | 'review' | 'backorder';
  options?: Array<{ code: string; label: string; input_type: 'select' | 'multiselect' | 'text' | 'textarea'; required?: boolean; choices?: unknown[]; max_length?: number; help_text?: string }>;
  recipe?: Array<{ item: string; quantity: number }>;
}> = [
  {
    slug: 'demo-classic-roses', name: 'Classic Rose Bouquet (demo)', division: 'floral', category: 'bouquets', short: 'Long-stem roses, hand-tied with fresh greenery.', description: 'A timeless dozen, or two, in the color you choose, wrapped and ready to give.',
    image: '/img/rose-blush-wall-1280.webp', alt: 'A wall of blush roses', featured: true, prep: 25, points: 2, delivery: true, pickup: true,
    variants: [{ name: 'A dozen', price: 7500, cost: 2600, recipe: ROSES(12) }, { name: 'Two dozen', price: 13500, cost: 4800, recipe: ROSES(24) }],
    options: [
      { code: 'rose_color', label: 'Rose color', input_type: 'select', required: true, choices: [{ value: 'Red' }, { value: 'Blush' }, { value: 'White' }, { value: 'Mixed' }] },
      { code: 'card_message', label: 'Card message', input_type: 'textarea', max_length: 200, help_text: 'Printed on a small card, up to 200 characters.' },
    ],
  },
  {
    slug: 'demo-premium-mixed', name: 'Premium Mixed Arrangement (demo)', division: 'floral', category: 'arrangements', short: 'A generous designer\'s choice, arranged in a keepsake vessel.', description: 'Our florists choose the best of the week: garden roses, seasonal blooms and textured greenery, arranged to last.',
    image: '/img/pitcher-blooms-1280.webp', alt: 'A full arrangement in a pitcher', featured: true, prep: 60, points: 4, lead: 24, delivery: true, pickup: true,
    variants: [{ name: 'Standard', price: 12500, cost: 4900 }, { name: 'Grand', price: 17500, cost: 6900 }],
    options: [{ code: 'card_message', label: 'Card message', input_type: 'textarea', max_length: 200 }],
    recipe: [{ item: 'MAT-ROSE-STEM', quantity: 10 }, { item: 'MAT-GREENS', quantity: 2 }],
  },
  {
    slug: 'demo-seasonal-centerpiece', name: 'Seasonal Centerpiece (demo)', division: 'floral', category: 'arrangements', short: 'A low table arrangement for this season.', description: 'Low enough to talk over, full enough to fill the table. Optional taper candles.',
    image: '/img/tablescape-1280.webp', alt: 'A dressed table with a low floral centerpiece', prep: 45, points: 3, delivery: true, pickup: true,
    variants: [{ name: 'Standard', price: 8500, cost: 3100 }],
    options: [{ code: 'candles', label: 'Candles', input_type: 'select', choices: [{ value: 'No candles' }, { value: 'With taper candles', price_delta_cents: 1500 }] }],
    recipe: [{ item: 'MAT-ROSE-STEM', quantity: 6 }, { item: 'MAT-GREENS', quantity: 1 }],
  },
  {
    slug: 'demo-garden-bouquet', name: 'Garden Bouquet (demo)', division: 'floral', category: 'bouquets', short: 'A loose, hand-tied mix in soft seasonal colors.', description: 'Hand-tied from what looks best that week, wrapped in paper and ribbon. Each one differs a little.',
    image: '/img/bouquet-lush-1280.webp', alt: 'A lush hand-tied bouquet', featured: true, prep: 30, points: 2, delivery: true, pickup: true,
    variants: [{ name: 'Standard', price: 6500, cost: 2600 }, { name: 'Deluxe', price: 9500, cost: 3800 }],
    options: [
      { code: 'ribbon', label: 'Ribbon color', input_type: 'select', choices: [{ value: 'Natural' }, { value: 'Blush' }, { value: 'Velvet burgundy', price_delta_cents: 500 }] },
      { code: 'card_message', label: 'Card message', input_type: 'textarea', max_length: 200, help_text: 'Printed on a small card, up to 200 characters.' },
    ],
    recipe: [{ item: 'MAT-ROSE-STEM', quantity: 6 }, { item: 'MAT-GREENS', quantity: 1 }, { item: 'MAT-WRAP', quantity: 1 }],
  },
  {
    slug: 'demo-white-bouquet', name: 'Quiet White Bouquet (demo)', division: 'floral', category: 'bouquets', short: 'All white and green, simple and calm.', description: 'White blooms and fresh greenery. A good choice for sympathy, thanks, or any quiet moment.',
    image: '/img/bouquet-white-1280.webp', alt: 'A white hand-tied bouquet', prep: 25, points: 2, delivery: true, pickup: true,
    variants: [{ name: 'Standard', price: 7000, cost: 2800 }],
    options: [{ code: 'card_message', label: 'Card message', input_type: 'textarea', max_length: 200 }],
    recipe: [{ item: 'MAT-ROSE-STEM', quantity: 8 }, { item: 'MAT-GREENS', quantity: 1 }, { item: 'MAT-WRAP', quantity: 1 }],
  },
  {
    slug: 'demo-mason-jar', name: 'Jar of Blooms (demo)', division: 'floral', category: 'arrangements', short: 'A small arrangement in a keepable jar.', description: 'Bright little stems in a glass jar, ready to set on a table.',
    image: '/img/arrangement-jar-1280.webp', alt: 'A floral arrangement in a glass jar', prep: 15, points: 1, delivery: true, pickup: true, featured: true,
    variants: [{ name: 'Standard', price: 3500, cost: 1200 }],
    recipe: [{ item: 'MAT-ROSE-STEM', quantity: 3 }, { item: 'MAT-JAR', quantity: 1 }],
  },
  {
    slug: 'demo-peony-season', name: 'Peony Season Bunch (demo)', division: 'floral', category: 'bouquets', short: 'Peonies, in season only.', description: 'An example of a seasonal product. It can only be ordered during its season.',
    image: '/img/peony-1280.webp', alt: 'A pink peony', prep: 20, points: 2, season: ['05-01', '06-30'], delivery: true, pickup: true,
    variants: [{ name: 'Standard', price: 8500, cost: 4200 }],
  },
  {
    slug: 'demo-custom-design', name: 'Custom Floral Design (demo)', division: 'floral', category: 'arrangements', short: 'Tell us the occasion and the colors.', description: 'A piece designed around your request. The shop reviews each one before accepting it.',
    image: '/img/moody-bouquet-1280.webp', alt: 'A moody dark-toned bouquet', custom: true, approval: true, prep: 90, points: 6, lead: 72, delivery: true, pickup: true,
    variants: [{ name: 'Standard', price: 15000, cost: 6000 }],
    options: [
      { code: 'occasion', label: 'Occasion', input_type: 'text', required: true, max_length: 80 },
      { code: 'colors', label: 'Colors and flowers you love', input_type: 'textarea', max_length: 500 },
    ],
  },
  {
    slug: 'demo-soy-candle', name: 'Fig & Cedar Candle (demo)', division: 'boutique', category: 'home', short: 'Hand-poured soy, about forty hours of burn.', description: 'A warm candle for the kitchen or the bedside. Example boutique item that can ship.',
    image: '/img/candle-1280.webp', alt: 'A lit candle', prep: 5, points: 0, pickup: true, delivery: true, shipping: true, featured: true,
    variants: [{ name: '8 oz', price: 2800, cost: 1100, stock: 12, low: 4 }],
  },
  {
    slug: 'demo-knit-cardigan', name: 'Oat Knit Cardigan (demo)', division: 'boutique', category: 'clothing', short: 'Soft, roomy, and easy to wear.', description: 'A relaxed everyday knit. Example of size variants with separate stock.',
    image: '/img/knits-1280.webp', alt: 'Knit sweaters on a shelf', prep: 5, points: 0, pickup: true, delivery: true, shipping: true,
    variants: [{ name: 'Small', price: 6800, cost: 2900, stock: 3, low: 2 }, { name: 'Medium', price: 6800, cost: 2900, stock: 5, low: 2 }, { name: 'Large', price: 6800, cost: 2900, stock: 1, low: 2 }],
  },
  {
    slug: 'demo-gift-box', name: 'The Thank-You Box (demo)', division: 'boutique', category: 'gifts', short: 'A candle, a card and a small treat, boxed.', description: 'Boxed and ready to give, with room for a short note. Currently on sale, as an example.',
    image: '/img/gift-pink-1280.webp', alt: 'A pink wrapped gift', prep: 10, points: 1, pickup: true, delivery: true, shipping: true,
    variants: [{ name: 'Standard', price: 4800, sale: 3900, cost: 2100, stock: 6, low: 2 }],
    options: [{ code: 'card_message', label: 'Note', input_type: 'textarea', max_length: 200 }],
  },
  {
    slug: 'demo-home-pillow', name: 'Linen Throw Pillow (demo)', division: 'boutique', category: 'home', short: 'Currently sold out, as an example.', description: 'Shows how a sold-out item behaves. The shop stops the sale rather than taking an order it cannot fill.',
    image: '/img/home-neutral-1280.webp', alt: 'Neutral home decor', prep: 5, points: 0, pickup: true, shipping: true,
    variants: [{ name: 'Standard', price: 4200, cost: 1800, stock: 0, low: 2 }],
  },
];

const MATERIALS = [
  { sku: 'MAT-ROSE-STEM', name: 'Rose stems', unit: 'stem', on_hand: 180, low: 40, reorder: 100, cost: 150, perishable: true, shelf: 7 },
  { sku: 'MAT-GREENS', name: 'Mixed greenery bunch', unit: 'bunch', on_hand: 25, low: 8, reorder: 20, cost: 400, perishable: true, shelf: 10 },
  { sku: 'MAT-WRAP', name: 'Kraft wrap and ribbon', unit: 'set', on_hand: 60, low: 15, reorder: 50, cost: 75 },
  { sku: 'MAT-JAR', name: 'Glass jar', unit: 'each', on_hand: 18, low: 6, reorder: 24, cost: 120 },
];

const SERVICES = [
  { code: 'demo-bridal-bouquet', category: 'bridal-party', name: 'Bridal bouquet (demo)', description: 'Designed around your dress, colors and season.', mode: 'estimate', low: 15000, high: 35000, unit: 'each', points: 4, image: '/img/bride-bouquet-blush-1280.webp' },
  { code: 'demo-bridesmaid-bouquet', category: 'bridal-party', name: 'Bridesmaid bouquets (demo)', description: 'Smaller companions to the bridal bouquet.', mode: 'estimate', low: 6000, high: 11000, unit: 'each', points: 2, image: '/img/couple-bouquet-1280.webp' },
  { code: 'demo-boutonniere', category: 'bridal-party', name: 'Boutonnieres (demo)', description: 'A single statement stem with greenery.', mode: 'package', price: 1800, unit: 'each', points: 1, image: '/img/rings-blooms-1280.webp' },
  { code: 'demo-ceremony-arch', category: 'installations', name: 'Ceremony arch florals (demo)', description: 'Flowers designed for your arch or backdrop.', mode: 'custom_quote', unit: 'each', points: 12, setup: 90, crew: true, image: '/img/gazebo-1280.webp' },
  { code: 'demo-aisle-flowers', category: 'ceremony', name: 'Aisle arrangements (demo)', description: 'Low arrangements lining the aisle.', mode: 'estimate', low: 4500, high: 9500, unit: 'each', points: 2, setup: 10, crew: true, image: '/img/aisle-1280.webp' },
  { code: 'demo-centerpieces', category: 'reception', name: 'Reception centerpieces (demo)', description: 'From low and lush to tall and dramatic.', mode: 'estimate', low: 6500, high: 18000, unit: 'table', points: 3, setup: 10, crew: true, image: '/img/tablescape-1280.webp' },
  { code: 'demo-reception-package', category: 'reception', name: 'Reception centerpiece package (demo)', description: 'Ten matching centerpieces, set on the tables before guests arrive.', mode: 'package', price: 95000, unit: 'package', points: 10, setup: 60, crew: true, image: '/img/reception-table-1280.webp' },
  { code: 'demo-sweetheart-table', category: 'reception', name: 'Sweetheart table (demo)', description: 'Garlands and candles for the two of you.', mode: 'custom_quote', unit: 'each', points: 5, setup: 30, crew: true, image: '/img/reception-table-1280.webp' },
  { code: 'demo-setup-teardown', category: 'logistics', name: 'Delivery, setup and teardown (demo)', description: 'We bring it, place it, and take it away.', mode: 'estimate', low: 25000, high: 90000, unit: 'event', points: 4, crew: true, image: '/img/ballroom-1280.webp' },
] as const;

const RENTALS = [
  { name: 'Birch ceremony arch (demo)', category: 'Arches', quantity: 2, price: 15000, buffer: 240, replacement: 60000, delivery: true, image: '/img/gazebo-1280.webp', description: 'A freestanding birch arch.' },
  { name: 'Gold candelabra (demo)', category: 'Décor', quantity: 12, price: 2500, buffer: 120, replacement: 9000, delivery: true, image: '/img/toast-lights-1280.webp', description: 'Tall five-arm candelabra.' },
  { name: 'Decorative vases (demo)', category: 'Tableware', quantity: 120, price: 200, buffer: 60, replacement: 500, delivery: false, image: '/img/arrangement-jar-1280.webp', description: 'Assorted small vases.' },
  { name: 'Velvet ring box (demo)', category: 'Details', quantity: 3, price: 800, buffer: 30, replacement: 3000, delivery: false, image: '/img/rings-roses-1280.webp', description: 'A small keepsake box for the rings.' },
];

const STAFF = [
  { email: 'owner@demo.example', name: 'Olivia Owner', roles: ['owner'], title: 'Owner (demo)', capabilities: ['consultation', 'production'], days: [1, 2, 3, 4, 5, 6] },
  { email: 'coordinator@demo.example', name: 'Casey Coordinator', roles: ['coordinator'], title: 'Wedding coordinator (demo)', capabilities: ['consultation', 'event_crew'], days: [2, 3, 4, 5, 6] },
  { email: 'florist@demo.example', name: 'Finley Florist', roles: ['florist'], title: 'Florist (demo)', capabilities: ['production', 'event_crew'], days: [1, 2, 3, 4, 5, 6] },
  { email: 'sales@demo.example', name: 'Sam Sales', roles: ['sales'], title: 'Boutique associate (demo)', capabilities: ['production'], days: [1, 2, 3, 4, 5] },
  { email: 'driver@demo.example', name: 'Devon Driver', roles: ['delivery'], title: 'Driver (demo)', capabilities: ['delivery', 'event_crew'], days: [1, 2, 3, 4, 5, 6] },
  { email: 'finance@demo.example', name: 'Fran Finance', roles: ['finance'], title: 'Bookkeeper (demo)', capabilities: [], days: [1, 2] },
];

const CATEGORIES: Array<[slug: string, name: string, division: 'floral' | 'boutique']> = [
  ['bouquets', 'Bouquets', 'floral'],
  ['arrangements', 'Arrangements', 'floral'],
  ['clothing', 'Clothing', 'boutique'],
  ['home', 'Home', 'boutique'],
  ['gifts', 'Gifts', 'boutique'],
];

export async function seedDemo(db: Db, opts: { log: (m: string) => void; password?: string }) {
  const log = opts.log;
  const real = await db.selectFrom('products').select('id').where('is_demo', '=', false).limit(1).executeTakeFirst();
  const orders = await db.selectFrom('orders').select('id').where('is_test', '=', false).limit(1).executeTakeFirst();
  if (real || orders) throw new Error('This database holds non-demo products or orders. Demo data is only loaded into an empty database.');
  const already = await db.selectFrom('products').select('id').where('is_demo', '=', true).limit(1).executeTakeFirst();
  if (already) {
    log('Demo data is already loaded. Run npm run db:reset first to start over.');
    return null;
  }

  const actor = SYSTEM_ACTOR;
  // Example rules only. Approving them here is what lets the demo accept orders automatically.
  await updateSetting(db, 'general', { shop_open: true, notice_banner: 'This is demo data with example pricing. Payments run in test mode.' }, actor);
  await updateSetting(db, 'ordering', { same_day_enabled: true, same_day_cutoff: '13:00', min_lead_hours: 0, daily_order_limit: 20, daily_points_limit: 40, review_timing: 'approve_first', out_of_stock_behavior: 'reject', custom_requires_approval: true }, actor);
  await updateSetting(db, 'delivery', { buffer_minutes: 60, max_stops_per_driver_window: 5, shipping_enabled: true, shipping_flat_cents: 1200, shipping_free_over_cents: 15000, shipping_allowed_states: ['MI', 'OH', 'IN'], public_policy: 'Demo policy. Example wording only: someone should be available to receive flowers at the address.' }, actor);
  await updateSetting(db, 'tax', { rates_bps: { standard: 600, exempt: 0 }, notes: 'Demo rate. Have your accountant confirm the real one.' }, actor);
  await updateSetting(db, 'refunds', { policy_text: 'Demo policy. Example wording only: tell us within 24 hours if something arrives damaged.', staff_limit_cents: 10000 }, actor);
  await updateSetting(db, 'events', { max_events_per_day: 2, min_notice_days: 60, deposit_percent: 25, staff_per_crew: 2, requires_contract: false, cancellation_policy: 'Demo policy. Example wording only: deposits hold your date and are not refundable.' }, actor);
  await updateSetting(db, 'privacy', { policy_text: 'Demo privacy policy. This placeholder is not legal text. A lawyer should write the real one.', terms_text: 'Demo terms of sale. This placeholder is not legal text. A lawyer should write the real one.' }, actor);
  await updateSetting(db, 'followups', { enabled: false, abandoned_cart_enabled: false }, actor);
  // Flora in demonstration mode: fictional sandbox only, and a small monthly budget for the demo.
  await updateSetting(db, 'concierge', { chat_enabled: true, voice_enabled: true, chat_mode: 'demo', voice_mode: 'demo', monthly_budget_cents: 1500 }, actor);
  const knowledge = [
    { title: 'Do you deliver to hospitals? (demo)', body: 'Demo answer, example wording only: we deliver to most local hospitals. Some units do not allow flowers, so we check with the hospital first.', keywords: 'hospital delivery patient room' },
    { title: 'Can I bring my own vases? (demo)', body: 'Demo answer, example wording only: yes, bring them to the shop when you order, and we will use them for your arrangement.', keywords: 'vase vases bring own containers' },
    { title: 'How far ahead should I book wedding flowers? (demo)', body: 'Demo answer, example wording only: most couples book three to nine months ahead. Popular Saturdays in June and September fill first.', keywords: 'wedding book ahead how early lead time' },
  ];
  for (const k of knowledge) await db.insertInto('concierge_knowledge').values({ ...k, published: true, is_demo: true }).execute();
  for (const group of ['ordering', 'delivery', 'tax', 'refunds'] as const) await setApproval(db, group, true, actor);

  for (let weekday = 0; weekday < 7; weekday++) {
    const closed = weekday === 0;
    await db.insertInto('business_hours').values({ weekday, closed, opens_at: closed ? null : '09:00', closes_at: closed ? null : '18:00' }).execute();
  }

  const zone = await db.insertInto('delivery_zones').values({ name: 'Nearby (demo)', postal_codes: ['48601', '48602', '48603', '48604', '48607', '48609', '48638'], fee_cents: 1200, min_order_cents: 0, travel_minutes: 20, notes: EXAMPLE_NOTE }).returning('id').executeTakeFirstOrThrow();
  const far = await db.insertInto('delivery_zones').values({ name: 'Further out (demo)', postal_codes: ['48706', '48708', '48640', '48642', '48722'], fee_cents: 2500, min_order_cents: 5000, travel_minutes: 45, notes: EXAMPLE_NOTE }).returning('id').executeTakeFirstOrThrow();
  for (let weekday = 1; weekday <= 6; weekday++) {
    await db.insertInto('delivery_windows').values({ kind: 'pickup', weekday, start_time: '10:00', end_time: '17:30', cutoff_minutes: 0 }).execute();
    for (const zoneId of [zone.id, far.id]) {
      await db.insertInto('delivery_windows').values({ kind: 'delivery', zone_id: zoneId, weekday, start_time: '10:00', end_time: '13:00', cutoff_minutes: 120, max_stops: weekday === 6 ? 3 : 6 }).execute();
      await db.insertInto('delivery_windows').values({ kind: 'delivery', zone_id: zoneId, weekday, start_time: '14:00', end_time: '17:00', cutoff_minutes: 120, max_stops: 6 }).execute();
    }
  }
  await db.insertInto('delivery_vehicles').values([{ name: 'Delivery van (demo)', max_stops: 12 }, { name: 'Event truck (demo)', max_stops: 4 }]).execute();

  const password = opts.password ?? randomBytes(12).toString('base64url');
  for (const s of STAFF) {
    const created = await createStaffUser(db, { email: s.email, displayName: s.name, roleCodes: s.roles, password, capabilities: s.capabilities, jobTitle: s.title });
    for (const weekday of s.days) {
      await db.insertInto('staff_availability').values({ staff_id: created.staffId, weekday, starts_at: '09:00', ends_at: '18:00' }).execute();
    }
    if (s.capabilities.includes('consultation')) {
      await db.updateTable('staff_profiles').set({ max_appointments_per_day: 4 }).where('id', '=', created.staffId).execute();
    }
  }
  await db.insertInto('resources').values([{ kind: 'crew', name: 'Event crew A (demo)' }, { kind: 'crew', name: 'Event crew B (demo)' }]).execute();

  const divisions = Object.fromEntries((await db.selectFrom('business_divisions').select(['id', 'code']).execute()).map((d) => [d.code, d.id]));
  const categories: Record<string, string> = {};
  for (const [i, [slug, name, division]] of CATEGORIES.entries()) {
    const row = await db.insertInto('product_categories').values({ slug, name, division_id: divisions[division], sort_order: i }).returning('id').executeTakeFirstOrThrow();
    categories[slug] = row.id;
  }
  const supplier = await db.insertInto('suppliers').values({ name: 'Example Wholesale Florals (demo)', contact_name: 'Pat Wholesale', email: 'orders@wholesale.example', lead_time_days: 3, notes: EXAMPLE_NOTE }).returning('id').executeTakeFirstOrThrow();
  const location = await defaultLocationId(db);
  const items: Record<string, string> = {};
  for (const m of MATERIALS) {
    const row = await db
      .insertInto('inventory_items')
      .values({ sku: m.sku, name: `${m.name} (demo)`, division_id: divisions.floral, kind: m.sku === 'MAT-WRAP' ? 'packaging' : 'material', unit: m.unit, low_stock_threshold: m.low, reorder_quantity: m.reorder, perishable: m.perishable ?? false, shelf_life_days: m.shelf ?? null, default_supplier_id: supplier.id, cost_cents: m.cost })
      .returning('id')
      .executeTakeFirstOrThrow();
    items[m.sku] = row.id;
    await db.insertInto('inventory_levels').values({ item_id: row.id, location_id: location }).execute();
    await db.insertInto('supplier_items').values({ supplier_id: supplier.id, item_id: row.id, cost_cents: m.cost, lead_time_days: 3 }).execute();
    await changeStock(db, { item_id: row.id, delta: m.on_hand, reason: 'receive', note: 'Demo opening stock' }, actor);
  }

  for (const [i, p] of PRODUCTS.entries()) {
    const product = await db
      .insertInto('products')
      .values({
        division_id: divisions[p.division], slug: p.slug, name: p.name, short_description: p.short, description: `${p.description}\n\n${EXAMPLE_NOTE}`, status: 'active', is_custom: p.custom ?? false, prep_minutes: p.prep ?? 15, complexity_points: p.points ?? 1, min_lead_hours: p.lead ?? 0, allow_pickup: p.pickup ?? false, allow_delivery: p.delivery ?? false, allow_shipping: p.shipping ?? false,
        requires_approval: p.approval ?? null, season_start_md: p.season?.[0] ?? null, season_end_md: p.season?.[1] ?? null, out_of_stock_behavior: p.outOfStock ?? null, featured: p.featured ?? false, sort_order: i, is_demo: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db.insertInto('product_category_links').values({ product_id: product.id, category_id: categories[p.category] }).execute();
    await db.insertInto('product_images').values({ product_id: product.id, url: p.image, alt: p.alt }).execute();
    for (const [o, option] of (p.options ?? []).entries()) {
      await db.insertInto('product_options').values({ product_id: product.id, code: option.code, label: option.label, input_type: option.input_type, required: option.required ?? false, choices: JSON.stringify(option.choices ?? []), max_length: option.max_length ?? null, help_text: option.help_text ?? null, sort_order: o }).execute();
    }
    for (const [v, variant] of p.variants.entries()) {
      const sku = `${p.slug.replace('demo-', '').toUpperCase()}-${variant.name.toUpperCase().replace(/[^A-Z0-9]+/g, '')}`;
      const row = await db
        .insertInto('product_variants')
        .values({ product_id: product.id, sku, name: variant.name, price_cents: variant.price, sale_price_cents: variant.sale ?? null, cost_estimate_cents: variant.cost ?? null, sort_order: v })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (variant.recipe) {
        const recipe = await db.insertInto('product_recipes').values({ variant_id: row.id, name: `${p.name}, ${variant.name}` }).returning('id').executeTakeFirstOrThrow();
        for (const c of variant.recipe) await db.insertInto('recipe_components').values({ recipe_id: recipe.id, item_id: items[c.item], quantity: c.quantity }).execute();
      }
      if (variant.stock !== undefined && variant.stock !== null) {
        const item = await db.insertInto('inventory_items').values({ sku: `INV-${sku}`, name: `${p.name}, ${variant.name}`, division_id: divisions[p.division], kind: 'finished_good', variant_id: row.id, low_stock_threshold: variant.low ?? null, cost_cents: variant.cost ?? null }).returning('id').executeTakeFirstOrThrow();
        await db.insertInto('inventory_levels').values({ item_id: item.id, location_id: location }).execute();
        if (variant.stock > 0) await changeStock(db, { item_id: item.id, delta: variant.stock, reason: 'receive', note: 'Demo opening stock' }, actor);
      }
    }
    if (p.recipe) {
      const recipe = await db.insertInto('product_recipes').values({ product_id: product.id, name: `${p.name} recipe` }).returning('id').executeTakeFirstOrThrow();
      for (const c of p.recipe) await db.insertInto('recipe_components').values({ recipe_id: recipe.id, item_id: items[c.item], quantity: c.quantity }).execute();
    }
  }
  await db.insertInto('promotions').values([{ code: 'WELCOME10', description: 'Demo: 10% off', kind: 'percent', value: 10, min_subtotal_cents: 2000 }, { code: 'FREEDELIVERY', description: 'Demo: free delivery', kind: 'free_delivery', value: 0, min_subtotal_cents: 5000 }]).execute();

  const serviceCategories = Object.fromEntries((await db.selectFrom('service_categories').select(['id', 'slug']).execute()).map((c) => [c.slug, c.id]));
  for (const [i, s] of SERVICES.entries()) {
    await db
      .insertInto('wedding_services')
      .values({
        category_id: serviceCategories[s.category], code: s.code, name: s.name, description: s.description, image_url: s.image, pricing_mode: s.mode, unit: s.unit, unit_price_cents: 'price' in s ? s.price : null, est_low_cents: 'low' in s ? s.low : null, est_high_cents: 'high' in s ? s.high : null, workload_points: s.points, setup_minutes: 'setup' in s ? s.setup : 0, requires_crew: 'crew' in s ? s.crew : false, sort_order: i, is_demo: true,
      })
      .execute();
  }
  for (const [i, r] of RENTALS.entries()) {
    await db.insertInto('rental_items').values({ name: r.name, category: r.category, description: r.description, image_url: r.image, quantity: r.quantity, price_cents: r.price, requires_delivery: r.delivery, cleaning_buffer_minutes: r.buffer, replacement_cost_cents: r.replacement, sort_order: i, is_demo: true }).execute();
  }

  log('');
  log('Demo data loaded. Everything in it is fictional, and all pricing is example pricing.');
  log('Team sign-ins, at /admin:');
  for (const s of STAFF) log(`  ${s.email.padEnd(28)} ${s.roles.join(', ')}`);
  log(opts.password ? '  Password: the DEMO_PASSWORD you provided' : `  Password for all of them: ${password}`);
  log('');
  return { password };
}
