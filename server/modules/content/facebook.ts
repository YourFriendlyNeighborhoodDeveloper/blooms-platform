import { badRequest } from '../../lib/errors.js';

const ALLOWED = new Set(['facebook.com', 'www.facebook.com', 'web.facebook.com', 'm.facebook.com', 'fb.watch', 'www.fb.watch']);

/**
 * Accepts only https Facebook video links, and stores them on the host the embed plugin expects.
 * Anything else is rejected, so this field cannot be used to load arbitrary content on the site.
 */
export function normalizeFacebookUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw badRequest('That does not look like a link.');
  }
  if (url.protocol !== 'https:' || !ALLOWED.has(url.hostname.toLowerCase())) {
    throw badRequest('Please paste a public video link from facebook.com or fb.watch.');
  }
  if (url.hostname.toLowerCase().endsWith('fb.watch')) {
    url.search = '';
    return url.toString();
  }
  if (!/\/(videos|watch|reel|share\/v|share\/r|video\.php)/.test(url.pathname)) {
    throw badRequest('That is a Facebook link, but not to a video. Open the video and copy its link.');
  }
  url.hostname = 'www.facebook.com';
  url.hash = '';
  // Tracking parameters are removed. Only the video id, when it lives in the query string, is kept.
  const keep = url.searchParams.get('v');
  url.search = '';
  if (keep) url.searchParams.set('v', keep);
  return url.toString();
}
