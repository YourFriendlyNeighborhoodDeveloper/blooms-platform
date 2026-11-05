import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { PLATFORM_ENABLED } from '../lib/platform';

export type CartLine = {
  id: string;
  variant_id: string;
  product_id: string;
  slug: string;
  name: string;
  variant_name: string;
  division_code: string;
  quantity: number;
  unit_price_cents: number;
  list_price_cents: number;
  options_price_cents: number;
  line_subtotal_cents: number;
  options_display: Array<{ label: string; value: string }>;
  image_url: string | null;
  methods: Array<'pickup' | 'delivery' | 'shipping'>;
  available_quantity: number | null;
  problems: string[];
};

export type CartGroup = { key: string; line_ids: string[]; methods: Array<'pickup' | 'delivery' | 'shipping'>; note: string | null };

export type Cart = {
  id: string | null;
  item_count: number;
  lines: CartLine[];
  groups: CartGroup[];
  promotion: { code: string; kind: string; value: number } | null;
  promotion_error?: string | null;
  totals: { subtotal_cents: number; discount_cents: number; delivery_cents: number; shipping_cents: number; tax_cents: number; total_cents: number };
  tax_ready: boolean;
  saved_details: Record<string, unknown>;
};

const EMPTY: Cart = {
  id: null,
  item_count: 0,
  lines: [],
  groups: [],
  promotion: null,
  totals: { subtotal_cents: 0, discount_cents: 0, delivery_cents: 0, shipping_cents: 0, tax_cents: 0, total_cents: 0 },
  tax_ready: true,
  saved_details: {},
};

type CartState = {
  cart: Cart;
  loading: boolean;
  refresh: () => Promise<Cart>;
  addItem: (variantId: string, quantity: number, options: Record<string, string | string[]>) => Promise<void>;
  setQuantity: (lineId: string, quantity: number) => Promise<void>;
  removeItem: (lineId: string) => Promise<void>;
  applyPromo: (code: string) => Promise<void>;
  clearPromo: () => Promise<void>;
};

const CartContext = createContext<CartState | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart>(EMPTY);
  const [loading, setLoading] = useState(PLATFORM_ENABLED);

  const refresh = useCallback(async () => {
    const next = await api<Cart>('/api/public/cart');
    setCart(next);
    return next;
  }, []);

  useEffect(() => {
    if (!PLATFORM_ENABLED) return;
    refresh()
      .catch(() => setCart(EMPTY))
      .finally(() => setLoading(false));
  }, [refresh]);

  const value = useMemo<CartState>(
    () => ({
      cart,
      loading,
      refresh,
      addItem: async (variant_id, quantity, options) => setCart(await api<Cart>('/api/public/cart/items', { body: { variant_id, quantity, options } })),
      setQuantity: async (id, quantity) => setCart(await api<Cart>(`/api/public/cart/items/${id}`, { method: 'PATCH', body: { quantity } })),
      removeItem: async (id) => setCart(await api<Cart>(`/api/public/cart/items/${id}`, { method: 'DELETE' })),
      applyPromo: async (code) => setCart(await api<Cart>('/api/public/cart/promo', { body: { code } })),
      clearPromo: async () => setCart(await api<Cart>('/api/public/cart/promo', { method: 'DELETE' })),
    }),
    [cart, loading, refresh],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
