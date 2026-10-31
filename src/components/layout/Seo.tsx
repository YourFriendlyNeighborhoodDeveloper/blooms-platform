import { useEffect } from 'react';
import type { PageMeta } from '../../data/seo';

function setMeta(selector: string, attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/** Keeps title/description/OG tags in sync during client-side navigation. */
export function Seo({ meta }: { meta: PageMeta }) {
  useEffect(() => {
    document.title = meta.title;
    setMeta('meta[name="description"]', 'name', 'description', meta.description);
    setMeta('meta[property="og:title"]', 'property', 'og:title', meta.title);
    setMeta('meta[property="og:description"]', 'property', 'og:description', meta.description);
    const origin = window.location.origin;
    setMeta('meta[property="og:url"]', 'property', 'og:url', origin + meta.path);
    setMeta('meta[property="og:image"]', 'property', 'og:image', origin + meta.ogImage);
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = origin + meta.path;
  }, [meta]);
  return null;
}
