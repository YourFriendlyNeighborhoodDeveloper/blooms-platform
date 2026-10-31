// End-to-end smoke test against the production build (`npm run build` first).
// Starts `vite preview`, then checks every route on desktop and mobile for console
// errors, failed requests, overflow, contact links, navigation and both forms.
// Screenshots land in ./screenshots (git-ignored).
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 4173;
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;
const ROUTES = ['/', '/flowers', '/weddings-events', '/rentals', '/boutique', '/about'];
const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
};
const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`  ✗ ${msg}`);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

let server;
if (!process.env.BASE_URL) {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(BASE);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

try {
  console.log('Static HTML');
  for (const route of ROUTES) {
    const html = await (await fetch(BASE + route)).text();
    const title = (html.match(/<title>([^<]+)<\/title>/)?.[1] ?? '').replace(/&amp;/g, '&');
    const expected = { '/': 'Florist, Events', '/flowers': 'Flowers & Custom', '/weddings-events': 'Wedding & Event', '/rentals': 'Event Rentals', '/boutique': 'The Boutique', '/about': 'About & Contact' }[route];
    const og = html.match(/property="og:image" content="([^"]+)"/)?.[1] ?? '';
    const robots = html.match(/name="robots" content="([^"]+)"/)?.[1] ?? '';
    if (!title.includes(expected)) fail(`${route}: static shell has the wrong title (${title})`);
    if (!/^https?:\/\/.+\/og\/.+\.jpg$/.test(og)) fail(`${route}: og:image not absolute (${og})`);
    if (!robots) fail(`${route}: robots meta missing`);
    if (route === '/' && (!html.includes('application/ld+json') || html.includes('openingHours'))) fail('/: JSON-LD missing or includes unverified hours');
    ok(`${route} → "${title.slice(0, 60)}…" robots=${robots}`);
  }
  for (const file of ['/robots.txt', '/sitemap.xml', '/og/home.jpg', '/favicon.svg']) {
    const res = await fetch(BASE + file);
    if (!res.ok) fail(`${file}: HTTP ${res.status}`);
  }
  ok('robots.txt, sitemap.xml, OG image and favicon served');

  await fs.mkdir(path.join(root, 'screenshots'), { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  for (const [name, options] of Object.entries(VIEWPORTS)) {
    console.log(`\nRoutes · ${name}`);
    const context = await browser.newContext(options);
    await context.addInitScript(() => {
      try {
        sessionStorage.setItem('blooms-intro-seen', '1');
      } catch {
        /* ignore */
      }
    });
    for (const route of ROUTES) {
      const page = await context.newPage();
      const problems = [];
      page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
      page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.url()}`));
      await page.goto(BASE + route, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1800);
      // Scroll through so lazy images and scroll-driven sections all run.
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 700) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(800);
      const report = await page.evaluate(() => ({
        h1: document.querySelectorAll('h1').length,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        imgsNoAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length,
        tel: [...document.querySelectorAll('a[href^="tel:"]')].every((a) => a.getAttribute('href') === 'tel:+19896008752'),
        mail: [...document.querySelectorAll('a[href^="mailto:"]')].every((a) => a.getAttribute('href') === 'mailto:bloomsbotiquefloral@gmail.com'),
        unsafeExternal: [...document.querySelectorAll('a[target="_blank"]')].filter((a) => !(a.rel || '').includes('noopener')).length,
        brokenInternal: [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href')).filter((h) => !/^\/(flowers|weddings-events|rentals|boutique|about)?([?#].*)?$/.test(h)),
      }));
      problems.forEach((p) => fail(`${route} [${name}] ${p}`));
      if (report.h1 !== 1) fail(`${route} [${name}] expected one <h1>, found ${report.h1}`);
      if (report.overflow > 1) fail(`${route} [${name}] horizontal overflow ${report.overflow}px`);
      if (report.imgsNoAlt) fail(`${route} [${name}] ${report.imgsNoAlt} images without alt`);
      if (!report.tel || !report.mail) fail(`${route} [${name}] phone/email link mismatch`);
      if (report.unsafeExternal) fail(`${route} [${name}] ${report.unsafeExternal} external links without rel=noopener`);
      if (report.brokenInternal.length) fail(`${route} [${name}] unexpected internal links: ${report.brokenInternal.join(', ')}`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(root, 'screenshots', `${route === '/' ? 'home' : route.slice(1)}-${name}.png`) });
      if (!problems.length) ok(`${route} clean (h1=${report.h1}, overflow=${Math.max(0, report.overflow)}px)`);
      await page.close();
    }

    console.log(`\nNavigation · ${name}`);
    const page = await context.newPage();
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.keyboard.press('Tab');
    const firstFocus = await page.evaluate(() => document.activeElement?.textContent?.trim());
    if (firstFocus !== 'Skip to content') fail(`[${name}] first Tab focuses "${firstFocus}" instead of the skip link`);
    else ok('first Tab reaches “Skip to content”');
    for (const route of ROUTES.slice(1)) {
      if (name === 'mobile') {
        await page.getByRole('button', { name: 'Menu' }).click();
        await page.getByRole('dialog', { name: 'Site menu' }).locator(`a[href="${route}"]`).click();
      } else {
        await page.locator(`header nav a[href="${route}"]`).click();
      }
      await page.waitForURL(`**${route}`);
      await page.waitForTimeout(2300);
      const h1 = await page.locator('h1').count();
      if (h1 !== 1) fail(`[${name}] nav to ${route}: page did not render`);
      else ok(`nav → ${route}`);
    }
    await context.close();
  }

  console.log('\nForms');
  const ctx = await browser.newContext(VIEWPORTS.desktop);
  const page = await ctx.newPage();
  await page.goto(BASE + '/weddings-events?service=rentals', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  if (!(await page.locator('input[value="Rentals & showroom selections"]').isChecked())) fail('?service=rentals did not preselect the rentals chip');
  await page.getByRole('button', { name: 'Check my inquiry' }).click();
  await page.waitForTimeout(600);
  // Nine required fields; "services" is already satisfied by the ?service= preset.
  const errors = await page.locator('form [id$="-err"]').count();
  if (errors !== 8) fail(`event form: expected 8 field errors on empty submit, saw ${errors}`);
  else ok(`event form flags ${errors} empty required fields`);
  await page.fill('input[name="name"]', 'Jordan Example');
  await page.fill('input[name="email"]', 'not-an-email');
  await page.locator('input[name="email"]').blur();
  await page.waitForTimeout(300);
  if (!(await page.getByText('Please check the email format').count())) fail('event form: bad email not flagged');
  await page.fill('input[name="email"]', 'jordan@example.com');
  await page.fill('input[name="phone"]', '989-555-0123');
  await page.fill('input[name="eventDate"]', new Date(Date.now() + 180 * 864e5).toISOString().slice(0, 10));
  await page.fill('input[name="venue"]', 'Saginaw');
  await page.fill('input[name="guests"]', '120');
  await page.locator('label', { hasText: '$2,500 – $5,000' }).click();
  await page.fill('textarea[name="description"]', 'Garden-style wedding in blush and sage with a ceremony arch.');
  await page.getByRole('button', { name: 'Check my inquiry' }).click();
  await page.waitForTimeout(1000);
  const demo = await page.locator('[role="status"]').first().innerText().catch(() => '');
  if (!/nothing was sent/i.test(demo)) fail('event form: demo completion state not shown');
  else ok('event form: valid entry shows the “nothing was sent” demo state');

  await page.goto(BASE + '/about?topic=flowers&idea=Atelier%20sketch%3A%203%20peonies', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const msg = await page.locator('textarea[name="message"]').inputValue();
  if (!msg.startsWith('Atelier sketch: 3 peonies')) fail('general form: Atelier idea not prefilled');
  else ok('general form: Atelier idea prefilled from the URL');
  await page.getByRole('button', { name: 'Check my note' }).click();
  await page.waitForTimeout(500);
  if ((await page.locator('form [id$="-err"]').count()) < 2) fail('general form: missing name/email not flagged');
  else ok('general form validates');
  await ctx.close();
  await browser.close();
} finally {
  server?.kill();
}

console.log(failures.length ? `\n${failures.length} problem(s) found.` : '\nAll smoke checks passed.');
process.exit(failures.length ? 1 : 0);
