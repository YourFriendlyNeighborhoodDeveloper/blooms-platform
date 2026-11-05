import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { business, type HoursRow } from '../data/business';
import { setShopTimezone } from './format';

/** Off only for the static concept preview, which has no backend. */
export const PLATFORM_ENABLED = import.meta.env.VITE_PLATFORM !== 'off';

/** True only for an owner-approved launch. Until then the concept disclosures stay visible. */
export const OWNER_APPROVED_LAUNCH = import.meta.env.VITE_SITE_MODE === 'production';

export type PlatformConfig = {
  shop: { has_products: boolean; accepting_orders: boolean; payments: 'disabled' | 'test' | 'live'; guest_checkout: boolean; notice: string | null };
  planner: { has_services: boolean; consultations: boolean };
  contact: { business_name: string; phone: string; phone_e164: string | null; email: string | null; address: string | null; facebook_url: string | null; hours_note: string | null };
  hours: { rows: Array<{ weekday: number; opens_at: string | null; closes_at: string | null; closed: boolean }>; confirmed: boolean };
  sms_enabled: boolean;
  timezone: string;
};

type State = { config: PlatformConfig | null; loading: boolean; unavailable: boolean };

const PlatformContext = createContext<State>({ config: null, loading: false, unavailable: false });

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ config: null, loading: PLATFORM_ENABLED, unavailable: false });
  useEffect(() => {
    if (!PLATFORM_ENABLED) return;
    let live = true;
    api<PlatformConfig>('/api/public/config')
      .then((config) => {
        if (config.timezone) setShopTimezone(config.timezone);
        if (live) setState({ config, loading: false, unavailable: false });
      })
      .catch(() => live && setState({ config: null, loading: false, unavailable: true }));
    return () => {
      live = false;
    };
  }, []);
  return <PlatformContext.Provider value={state}>{children}</PlatformContext.Provider>;
}

export const usePlatform = () => useContext(PlatformContext);

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Opening hours for the public site. Once the owner saves hours in the dashboard, those are shown as
 * confirmed. Until then, the unverified hours from the public listing appear, with their warning.
 */
type ShopHours = { confirmed: boolean; schedule: HoursRow[]; closedDays: string | null; closedLabel: string };

export function useShopHours(): ShopHours {
  const { config } = usePlatform();
  const rows = config?.hours.confirmed ? config.hours.rows : null;
  // Stable between renders, so components can depend on it.
  return useMemo(() => shopHours(rows ?? null), [rows]);
}

function shopHours(rows: Array<{ weekday: number; opens_at: string | null; closes_at: string | null; closed: boolean }> | null): ShopHours {
  if (!rows || rows.length < 7) return { confirmed: false, schedule: [...business.hours.schedule], closedDays: 'Sunday & Monday', closedLabel: 'Not listed' };
  // Monday first, the way people read a week, grouping neighbouring days with the same hours.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const schedule: HoursRow[] = [];
  const closed: number[] = [];
  for (const day of order) {
    const row = rows.find((r) => r.weekday === day);
    if (!row || row.closed || !row.opens_at || !row.closes_at) {
      closed.push(day);
      continue;
    }
    const open = row.opens_at.slice(0, 5);
    const close = row.closes_at.slice(0, 5);
    const last = schedule.at(-1);
    const lastDay = last?.dayNums.at(-1);
    if (last && last.open === open && last.close === close && lastDay !== undefined && order.indexOf(lastDay) === order.indexOf(day) - 1) {
      last.dayNums = [...last.dayNums, day];
    } else {
      schedule.push({ days: '', short: '', open, close, dayNums: [day] });
    }
  }
  for (const s of schedule) {
    const first = s.dayNums[0];
    const end = s.dayNums.at(-1) as number;
    s.days = s.dayNums.length === 1 ? DAY[first] : `${DAY[first]} – ${DAY[end]}`;
    s.short = s.dayNums.length === 1 ? SHORT[first] : `${SHORT[first]}–${SHORT[end]}`;
  }
  return { confirmed: true, schedule, closedDays: closed.length ? closed.map((d) => DAY[d]).join(' & ').replace(/ & (?=.* & )/g, ', ') : null, closedLabel: 'Closed' };
}
