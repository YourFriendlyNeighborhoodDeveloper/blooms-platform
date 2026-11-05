import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { ApiError, api } from '../lib/api';
import { setShopTimezone } from '../lib/format';
import { cn } from '../lib/cn';
import { OWNER_APPROVED_LAUNCH } from '../lib/platform';
import { BloomMark } from '../components/fx/BloomMark';
import { SessionProvider, useSession } from './session';
import { Btn, ErrorBox, Field, Input, Loading, ToastProvider } from './ui';

const Overview = lazy(() => import('./pages/Overview'));
const Orders = lazy(() => import('./pages/Orders'));
const OrderDetail = lazy(() => import('./pages/OrderDetail'));
const PackingSlip = lazy(() => import('./pages/PackingSlip'));

const extra = {
  Products: lazy(() => import('./pages/Products')),
  ProductEdit: lazy(() => import('./pages/ProductEdit')),
  Inventory: lazy(() => import('./pages/Inventory')),
  InventoryItem: lazy(() => import('./pages/InventoryItem')),
  Purchasing: lazy(() => import('./pages/Purchasing')),
  Weddings: lazy(() => import('./pages/Weddings')),
  WeddingDetail: lazy(() => import('./pages/WeddingDetail')),
  ProjectDetail: lazy(() => import('./pages/ProjectDetail')),
  Services: lazy(() => import('./pages/Services')),
  Rentals: lazy(() => import('./pages/Rentals')),
  Calendar: lazy(() => import('./pages/CalendarPage')),
  Deliveries: lazy(() => import('./pages/Deliveries')),
  Tasks: lazy(() => import('./pages/Tasks')),
  Customers: lazy(() => import('./pages/Customers')),
  CustomerDetail: lazy(() => import('./pages/CustomerDetail')),
  Messages: lazy(() => import('./pages/Messages')),
  Staff: lazy(() => import('./pages/Staff')),
  Reports: lazy(() => import('./pages/Reports')),
  Settings: lazy(() => import('./pages/Settings')),
  Marketing: lazy(() => import('./pages/Marketing')),
  Templates: lazy(() => import('./pages/Templates')),
  System: lazy(() => import('./pages/System')),
  Setup: lazy(() => import('./pages/Setup')),
  Onboarding: lazy(() => import('./pages/Onboarding')),
  Account: lazy(() => import('./pages/MyAccount')),
};

type NavItem = { to: string; label: string; permission?: string; end?: boolean };

const NAV: Array<{ heading: string; items: NavItem[] }> = [
  { heading: 'Today', items: [
    { to: '/admin', label: 'Overview', end: true },
    { to: '/admin/calendar', label: 'Calendar', permission: 'calendar.view' },
    { to: '/admin/tasks', label: 'Tasks', permission: 'tasks.view' },
  ] },
  { heading: 'Sales', items: [
    { to: '/admin/orders', label: 'Orders', permission: 'orders.view' },
    { to: '/admin/deliveries', label: 'Deliveries', permission: 'deliveries.view' },
    { to: '/admin/products', label: 'Products', permission: 'catalog.manage' },
    { to: '/admin/inventory', label: 'Inventory', permission: 'inventory.view' },
    { to: '/admin/purchasing', label: 'Purchasing', permission: 'purchasing.manage' },
  ] },
  { heading: 'Weddings & events', items: [
    { to: '/admin/weddings', label: 'Pipeline', permission: 'weddings.view' },
    { to: '/admin/services', label: 'Services', permission: 'catalog.manage' },
    { to: '/admin/rentals', label: 'Rentals', permission: 'rentals.manage' },
  ] },
  { heading: 'People', items: [
    { to: '/admin/customers', label: 'Customers', permission: 'customers.view' },
    { to: '/admin/messages', label: 'Messages', permission: 'customers.view' },
    { to: '/admin/team', label: 'Team', permission: 'staff.view' },
  ] },
  { heading: 'Business', items: [
    { to: '/admin/reports', label: 'Reports', permission: 'reports.view' },
    { to: '/admin/marketing', label: 'Marketing', permission: 'marketing.manage' },
    { to: '/admin/settings', label: 'Settings', permission: 'settings.manage' },
    { to: '/admin/templates', label: 'Messages & rules', permission: 'templates.manage' },
    { to: '/admin/onboarding', label: 'Set up your shop', permission: 'settings.manage' },
    { to: '/admin/setup', label: 'Launch checklist', permission: 'settings.manage' },
    { to: '/admin/system', label: 'System', permission: 'system.manage' },
  ] },
];

function Login() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (forgot) {
        await api('/api/admin/auth/forgot-password', { body: { email } });
        setSent(true);
      } else {
        await signIn(email, password);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="grid min-h-svh place-items-center bg-ivory p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-charcoal/10 bg-white p-7">
        <div className="flex items-center gap-3">
          <BloomMark size={34} />
          <div>
            <h1 className="text-[1.5rem] leading-none">Blooms</h1>
            <p className="mt-1 text-[0.75rem] text-charcoal/70">Team dashboard</p>
          </div>
        </div>
        {sent ? (
          <p className="text-[0.9rem]">If that email belongs to a team member, a reset link is on its way.</p>
        ) : (
          <>
            <Field label="Email" required>
              <Input type="email" name="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            {!forgot && (
              <Field label="Password" required>
                <Input type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            )}
            <ErrorBox error={error} />
            <Btn type="submit" tone="primary" disabled={busy} className="w-full">
              {busy ? 'One moment…' : forgot ? 'Send reset link' : 'Sign in'}
            </Btn>
          </>
        )}
        <button type="button" onClick={() => { setForgot((f) => !f); setSent(false); setError(null); }} className="w-full text-center text-[0.8rem] text-charcoal/70 hover:text-charcoal">
          {forgot ? 'Back to sign in' : 'Forgot your password?'}
        </button>
      </form>
    </main>
  );
}

function SetPassword({ invite }: { invite?: boolean }) {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/auth/reset-password', { body: { token, password } });
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="grid min-h-svh place-items-center bg-ivory p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-charcoal/10 bg-white p-7">
        <h1 className="text-[1.5rem] leading-tight">{invite ? 'Welcome to the team' : 'Choose a new password'}</h1>
        <Field label="Password" required hint="At least 12 characters.">
          <Input type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        <Btn type="submit" tone="primary" disabled={busy} className="w-full">
          Save password
        </Btn>
      </form>
    </main>
  );
}

function ModeBanner() {
  const [config, setConfig] = useState<{ shop: { payments: string } } | null>(null);
  useEffect(() => {
    api<{ shop: { payments: string } }>('/api/public/config').then(setConfig).catch(() => {});
  }, []);
  if (!config || config.shop.payments === 'live') return null;
  return (
    <div className="bg-gold-soft/70 px-4 py-1.5 text-center text-[0.78rem] print:hidden" role="status">
      {config.shop.payments === 'test' ? 'Test mode: payments are simulated, and figures here are not real business results.' : 'Online payments are off. Customers cannot check out yet.'}
      {!OWNER_APPROVED_LAUNCH && ' This site is an unlaunched concept.'}
    </div>
  );
}

function Shell() {
  const { user, signOut, can } = useSession();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  if (!user) return null;
  return (
    <div className="flex min-h-svh flex-col bg-[#faf7f3] text-charcoal">
      <ModeBanner />
      <div className="flex flex-1">
        <aside className={cn('print:hidden fixed inset-y-0 left-0 z-30 w-60 shrink-0 overflow-y-auto border-r border-charcoal/10 bg-white p-4 transition-transform lg:static lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
          <Link to="/admin" className="mb-5 flex items-center gap-2.5">
            <BloomMark size={26} />
            <span className="font-display text-[1.25rem]">Blooms</span>
          </Link>
          <nav aria-label="Dashboard" className="space-y-5">
            {NAV.map((group) => {
              const items = group.items.filter((i) => !i.permission || can(i.permission));
              if (!items.length) return null;
              return (
                <div key={group.heading}>
                  <p className="mb-1 px-2 text-[0.68rem] font-semibold tracking-wider text-charcoal/70 uppercase">{group.heading}</p>
                  <ul className="space-y-0.5">
                    {items.map((i) => (
                      <li key={i.to}>
                        <NavLink to={i.to} end={i.end} className={({ isActive }) => cn('block rounded-lg px-2 py-1.5 text-[0.88rem] transition-colors', isActive ? 'bg-charcoal text-ivory' : 'hover:bg-charcoal/5')}>
                          {i.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </nav>
          <div className="mt-6 border-t border-charcoal/10 pt-3 text-[0.8rem]">
            <Link to="/admin/me" className="block truncate font-medium hover:underline">
              {user.display_name}
            </Link>
            <button type="button" onClick={() => signOut()} className="mt-1 text-charcoal/70 hover:text-charcoal">
              Sign out
            </button>
            <a href="/" className="ml-3 text-charcoal/70 hover:text-charcoal">
              View site
            </a>
          </div>
        </aside>
        {open && <button type="button" aria-label="Close menu" className="fixed inset-0 z-20 bg-ink/30 lg:hidden" onClick={() => setOpen(false)} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 border-b border-charcoal/10 bg-white px-4 py-2 lg:hidden">
            <Btn small onClick={() => setOpen(true)} aria-expanded={open}>
              Menu
            </Btn>
            <span className="font-display text-[1.1rem]">Blooms</span>
          </div>
          <main id="admin-main" className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route index element={<Overview />} />
                <Route path="orders" element={<Orders />} />
                <Route path="orders/:id" element={<OrderDetail />} />
                <Route path="orders/:id/slip" element={<PackingSlip />} />
                <Route path="products" element={<extra.Products />} />
                <Route path="products/:id" element={<extra.ProductEdit />} />
                <Route path="inventory" element={<extra.Inventory />} />
                <Route path="inventory/items/:id" element={<extra.InventoryItem />} />
                <Route path="purchasing" element={<extra.Purchasing />} />
                <Route path="weddings" element={<extra.Weddings />} />
                <Route path="weddings/projects/:id" element={<extra.ProjectDetail />} />
                <Route path="weddings/:id" element={<extra.WeddingDetail />} />
                <Route path="services" element={<extra.Services />} />
                <Route path="rentals" element={<extra.Rentals />} />
                <Route path="calendar" element={<extra.Calendar />} />
                <Route path="deliveries" element={<extra.Deliveries />} />
                <Route path="tasks" element={<extra.Tasks />} />
                <Route path="customers" element={<extra.Customers />} />
                <Route path="customers/messages/:id" element={<extra.Messages />} />
                <Route path="customers/:id" element={<extra.CustomerDetail />} />
                <Route path="messages" element={<extra.Messages />} />
                <Route path="team" element={<extra.Staff />} />
                <Route path="reports" element={<extra.Reports />} />
                <Route path="marketing" element={<extra.Marketing />} />
                <Route path="settings" element={<extra.Settings />} />
                <Route path="templates" element={<extra.Templates />} />
                <Route path="setup" element={<extra.Setup />} />
                <Route path="onboarding" element={<extra.Onboarding />} />
                <Route path="system/*" element={<extra.System />} />
                <Route path="me" element={<extra.Account />} />
                <Route path="*" element={<Navigate to="/admin" replace />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </div>
    </div>
  );
}

function Gate() {
  const { user, loading } = useSession();
  if (loading) return <Loading />;
  return user ? <Shell /> : <Login />;
}

export default function AdminApp() {
  useEffect(() => {
    document.title = 'Team dashboard · Blooms';
    api<{ timezone?: string }>('/api/public/config')
      .then((c) => c.timezone && setShopTimezone(c.timezone))
      .catch(() => {});
  }, []);
  return (
    <ToastProvider>
      <SessionProvider>
        <Routes>
          <Route path="/admin/reset/:token" element={<SetPassword />} />
          <Route path="/admin/invite/:token" element={<SetPassword invite />} />
          <Route path="/admin/*" element={<Gate />} />
        </Routes>
      </SessionProvider>
    </ToastProvider>
  );
}
