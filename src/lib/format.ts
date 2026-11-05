const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? '—' : usd.format(cents / 100));

// The owner's setting replaces this at startup. Dates always show in shop time, wherever the viewer is.
let TZ = 'America/Detroit';
export const setShopTimezone = (tz: string) => {
  TZ = tz;
};
export const shopTimezone = () => TZ;
/** Today's date in the shop, as YYYY-MM-DD. */
export const todayInShop = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

export const dateLabel = (date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });

export const timeLabel = (iso: string | Date, tz = shopTimezone()) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });

export const dateTimeLabel = (iso: string | Date, tz = shopTimezone()) =>
  new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz });

export const shortDate = (iso: string | Date, tz = shopTimezone()) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz });

export const statusLabel = (s: string | null | undefined) => (s ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
