// Single source of truth for business facts used in copy, links and structured data.
// Only facts supplied and confirmed for this concept belong here. Anything flagged
// `verified: false` must be shown with a "please confirm" note and kept out of JSON-LD.

export const business = {
  name: 'Blooms Boutique & Floral',
  shortName: 'Blooms',
  legacyNames: ["Magical I Do's", "Magical Blooms & I Do's"],
  coOwner: 'Samantha Todd',
  address: {
    street: '7680 Gratiot Road, Suite 4',
    city: 'Saginaw',
    region: 'MI',
    regionName: 'Michigan',
    postalCode: '48609',
    country: 'US',
  },
  phone: { display: '(989) 600-8752', e164: '+19896008752' },
  // Spelling matches the public business listing.
  email: 'bloomsbotiquefloral@gmail.com',
  hours: {
    verified: false,
    source: 'Published Saginaw Township business listing',
    // 0 = Sunday … 6 = Saturday, 24h "HH:MM" in America/Detroit
    schedule: [
      { days: 'Tuesday – Friday', short: 'Tue–Fri', open: '10:00', close: '17:30', dayNums: [2, 3, 4, 5] },
      { days: 'Saturday', short: 'Sat', open: '10:00', close: '15:00', dayNums: [6] },
    ],
    closedNote: 'Sunday & Monday: not listed',
  },
  // Checked Oct 2026: WeddingWire lists "Blooms Boutique and Floral" at this address;
  // The Knot still lists "Magical I Do's" (with an older Gratiot Road address).
  // Facebook sits behind a login wall, so only its URL is relied on.
  profiles: [
    { label: 'Facebook', note: 'Official page', kind: 'page', href: 'https://www.facebook.com/magicalidos/' },
    { label: 'WeddingWire', note: 'Reviews', kind: 'reviews', href: 'https://www.weddingwire.com/biz/magical-i-dos-saginaw/6abb6eda20c74514.html' },
    { label: 'The Knot', note: "Reviews · listed as Magical I Do's", kind: 'reviews', href: 'https://www.theknot.com/marketplace/magical-i-dos-saginaw-mi-989238' },
  ],
} as const;

export const fullAddress = `${business.address.street}, ${business.address.city}, ${business.address.region} ${business.address.postalCode}`;

const mapQuery = encodeURIComponent(fullAddress);
export const links = {
  tel: `tel:${business.phone.e164}`,
  mailto: `mailto:${business.email}`,
  googleMaps: `https://www.google.com/maps/search/?api=1&query=${mapQuery}`,
  googleDirections: `https://www.google.com/maps/dir/?api=1&destination=${mapQuery}`,
  appleMaps: `https://maps.apple.com/?daddr=${mapQuery}`,
} as const;

export const concept = {
  studio: 'Abraxas Technologies',
  summary:
    'Independent design concept by Abraxas Technologies. This is not the official Blooms Boutique & Floral website, has not been commissioned, and is not a live storefront.',
  imagery:
    'Photography is illustrative stock from Unsplash and does not show Blooms’ own work. Owner photography would replace it.',
  forms: 'Forms on this concept validate your entries but do not send anything.',
} as const;

/** Returns open/closed state according to the published (unverified) hours. */
export function publishedHoursStatus(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Detroit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const today = business.hours.schedule.find((s) => (s.dayNums as readonly number[]).includes(day));
  if (today && minutes >= toMin(today.open) && minutes < toMin(today.close)) {
    return { open: true, closesAt: formatTime(today.close) };
  }
  return { open: false, closesAt: null };
}

export function formatTime(hhmm: string) {
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === '00' ? `${h12} ${suffix}` : `${h12}:${m} ${suffix}`;
}
