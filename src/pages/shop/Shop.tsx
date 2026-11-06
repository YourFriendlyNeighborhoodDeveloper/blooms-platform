import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { money } from '../../lib/format';
import { usePlatform } from '../../lib/platform';
import { cn } from '../../lib/cn';
import { CallTheShop, Notice, ProductImage, Spinner, StorePage, TestModeBanner } from '../../shop/ui';

type Product = {
  id: string;
  slug: string;
  name: string;
  short_description: string | null;
  division: { code: string; name: string };
  image: { url: string; alt: string } | null;
  from_price_cents: number;
  from_list_price_cents: number;
  has_price_range: boolean;
  on_sale: boolean;
  sold_out: boolean;
  is_custom: boolean;
};

type Category = { id: string; name: string; slug: string; division_code: string };

const DIVISIONS = [
  { code: '', label: 'Everything' },
  { code: 'floral', label: 'Flowers' },
  { code: 'boutique', label: 'Boutique' },
];

const SORTS = [
  { value: 'featured', label: 'Featured' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'newest', label: 'Newest' },
];

function ProductCard({ p }: { p: Product }) {
  return (
    <li>
      <Link to={`/shop/${p.slug}`} className="group block" data-cursor="View">
        <div className="relative overflow-hidden rounded-[20px]">
          <ProductImage url={p.image?.url ?? null} alt={p.image?.alt || p.name} className="aspect-[4/5] w-full transition-transform duration-[1.2s] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]" />
          {p.sold_out && <span className="absolute top-3 left-3 rounded-full bg-charcoal px-3 py-1 text-[0.72rem] text-ivory">Sold out</span>}
          {!p.sold_out && p.on_sale && <span className="absolute top-3 left-3 rounded-full bg-rose-deep px-3 py-1 text-[0.72rem] text-ivory">On sale</span>}
        </div>
        <h2 className="mt-4 text-[1.35rem] leading-tight">{p.name}</h2>
        {p.short_description && <p className="mt-1 line-clamp-2 text-[0.92rem] text-charcoal/70">{p.short_description}</p>}
        <p className="mt-2 text-[0.98rem] tabular-nums">
          {p.has_price_range && <span className="text-charcoal/70">From </span>}
          {money(p.from_price_cents)}
          {p.on_sale && <s className="ml-2 text-charcoal/70">{money(p.from_list_price_cents)}</s>}
        </p>
      </Link>
    </li>
  );
}

export default function Shop() {
  const [params, setParams] = useSearchParams();
  const { config, loading: configLoading } = usePlatform();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const division = params.get('division') ?? '';
  const category = params.get('category') ?? '';
  const sort = params.get('sort') ?? 'featured';
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);

  const setParam = (key: string, value: string) => {
    // Built from the address bar, not this render's params: the router applies changes as a
    // transition, so a search typed right after a department click would otherwise undo the click.
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === 'division') next.delete('category');
    setParams(next, { replace: true });
  };

  const query = useMemo(() => {
    const s = new URLSearchParams();
    if (division) s.set('division', division);
    if (category) s.set('category', category);
    if (q) s.set('q', q);
    if (sort) s.set('sort', sort);
    return s.toString();
  }, [division, category, q, sort]);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    api<{ products: Product[]; categories: Category[] }>(`/api/public/products?${query}`, { signal: controller.signal })
      .then((r) => {
        setProducts(r.products);
        setCategories(r.categories);
      })
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') setError(err instanceof ApiError ? err.message : 'We could not load the shop.');
      });
    return () => controller.abort();
  }, [query]);

  const open = config?.shop.has_products;

  return (
    <StorePage eyebrow="The shop" title="Order online, any time" intro="Flowers and boutique pieces, ready for pickup or delivery when the shop can make it happen. The times offered at checkout are ones the shop can actually meet.">
      <TestModeBanner />
      {config?.shop.notice && <Notice className="mb-6">{config.shop.notice}</Notice>}
      {error && <Notice tone="error" className="mb-6">{error}</Notice>}
      {!configLoading && !error && products && !open && <CallTheShop message="Online ordering is not open yet. The shop is happy to take your order by phone or email in the meantime." />}
      {(open || (products && products.length > 0)) && (
        <>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by department">
              {DIVISIONS.map((d) => (
                <button
                  key={d.code}
                  type="button"
                  aria-pressed={division === d.code}
                  onClick={() => setParam('division', d.code)}
                  className={cn('rounded-full border px-4 py-2 text-[0.9rem] transition-colors', division === d.code ? 'border-charcoal bg-charcoal text-ivory' : 'border-charcoal/25 hover:border-charcoal/60')}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <form
              className="flex flex-1 flex-wrap items-center gap-3 lg:max-w-xl lg:justify-end"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                setParam('q', search.trim());
              }}
            >
              <label className="flex-1 min-w-[12rem]">
                <span className="sr-only">Search the shop</span>
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="h-11 w-full rounded-full border border-charcoal/25 bg-transparent px-4 text-[0.95rem]" />
              </label>
              <label>
                <span className="sr-only">Sort by</span>
                <select value={sort} onChange={(e) => setParam('sort', e.target.value)} className="h-11 rounded-full border border-charcoal/25 bg-transparent px-4 text-[0.9rem]">
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </form>
          </div>
          {categories.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={category === c.slug}
                  onClick={() => setParam('category', category === c.slug ? '' : c.slug)}
                  className={cn('rounded-full px-3 py-1.5 text-[0.82rem] transition-colors', category === c.slug ? 'bg-rose-deep text-ivory' : 'bg-ivory-deep hover:bg-blush')}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {!products && <Spinner />}
          {products && products.length === 0 && <p className="py-16 text-center text-charcoal/70">Nothing matches that just now. Try a different search or filter.</p>}
          {products && products.length > 0 && (
            <ul className="mt-10 grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-3 xl:grid-cols-4">
              {products.map((p) => (
                <ProductCard key={p.id} p={p} />
              ))}
            </ul>
          )}
        </>
      )}
      {!products && !error && !open && <Spinner />}
    </StorePage>
  );
}
