// Renders the 1200×630 Open Graph cards in public/og/ with the site's own fonts.
// Uses Playwright with the locally installed Chrome. Re-run after changing copy or imagery.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'public/og');
const font = (f) => pathToFileURL(path.join(root, 'node_modules/@fontsource-variable', f)).href;
const img = (key) => pathToFileURL(path.join(root, 'public/img', `${key}-1280.webp`)).href;

const CARDS = [
  { file: 'home', label: 'Florist · Events · Boutique', images: ['bouquet-blush', 'bride-bouquet-blush'] },
  { file: 'flowers', label: 'Flowers & custom arrangements', images: ['dahlias-peach', 'bouquet-lush'] },
  { file: 'weddings-events', label: 'Weddings & Events', images: ['bride-moody', 'gazebo'] },
  { file: 'rentals', label: 'Event rentals', images: ['reception-table', 'chairs-florals'] },
  { file: 'boutique', label: 'The boutique', images: ['knits', 'gift-pink'] },
  { file: 'about', label: 'About & contact', images: ['flower-market', 'pitcher-blooms'] },
];

const petals = Array.from({ length: 8 }, (_, i) => `<ellipse rx="7" ry="13" transform="rotate(${i * 45}) translate(0 -11)" />`).join('');

const html = (card) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Fraunces'; src: url(${font('fraunces/files/fraunces-latin-full-normal.woff2')}) format('woff2'); font-weight: 100 900; }
@font-face { font-family: 'Fraunces'; font-style: italic; src: url(${font('fraunces/files/fraunces-latin-full-italic.woff2')}) format('woff2'); font-weight: 100 900; }
@font-face { font-family: 'Instrument Sans'; src: url(${font('instrument-sans/files/instrument-sans-latin-wght-normal.woff2')}) format('woff2'); font-weight: 400 700; }
* { margin: 0; box-sizing: border-box; }
body { width: 1200px; height: 630px; overflow: hidden; background: radial-gradient(120% 120% at 85% 10%, #ecd9d2 0%, #f6f0e9 55%, #efe5da 100%); font-family: 'Instrument Sans'; color: #342f2c; position: relative; }
.left { position: absolute; left: 72px; top: 64px; bottom: 56px; width: 600px; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 14px; }
.eyebrow { font-size: 15px; letter-spacing: .24em; text-transform: uppercase; font-weight: 600; color: #8e5664; }
.word { font-family: 'Fraunces'; font-size: 178px; line-height: .86; letter-spacing: -.045em; margin-top: 38px; font-variation-settings: 'SOFT' 100, 'WONK' 1, 'opsz' 144; font-weight: 330; }
.label { font-family: 'Fraunces'; font-style: italic; font-size: 44px; color: #8e5664; margin-top: 22px; font-variation-settings: 'SOFT' 100; }
.tag { font-size: 21px; line-height: 1.4; color: rgba(52,47,44,.78); margin-top: 18px; max-width: 520px; }
.foot { margin-top: auto; display: flex; align-items: center; gap: 14px; font-size: 16px; color: rgba(52,47,44,.7); }
.pill { border: 1px solid rgba(52,47,44,.25); border-radius: 999px; padding: 7px 14px; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; font-weight: 600; }
.ph { position: absolute; border-radius: 22px; overflow: hidden; box-shadow: 0 40px 80px -30px rgba(52,47,44,.55); border: 6px solid #fffaf6; }
.ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
.a { width: 330px; height: 430px; right: 70px; top: 70px; transform: rotate(5deg); }
.b { width: 210px; height: 260px; right: 330px; top: 300px; transform: rotate(-7deg); }
</style></head><body>
<div class="ph a"><img src="${img(card.images[0])}"></div>
<div class="ph b"><img src="${img(card.images[1])}"></div>
<div class="left">
  <div class="brand"><svg width="34" height="34" viewBox="-25 -25 50 50"><g fill="#e8d5cf" stroke="#b87f89" stroke-width=".8">${petals}</g><circle r="5" fill="#c7a977"/></svg><span class="eyebrow">Boutique &amp; Floral · Saginaw, MI</span></div>
  <div class="word">Blooms</div>
  <div class="label">${card.label}</div>
  <div class="tag">Beautiful flowers. Thoughtful gifts. Unforgettable celebrations.</div>
  <div class="foot"><span class="pill">Design concept</span><span>7680 Gratiot Road, Suite 4</span></div>
</div>
</body></html>`;

await fs.mkdir(outDir, { recursive: true });
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'blooms-og-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const card of CARDS) {
  const file = path.join(tmp, `${card.file}.html`);
  await fs.writeFile(file, html(card));
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(outDir, `${card.file}.jpg`), type: 'jpeg', quality: 86 });
  console.log(`✓ og/${card.file}.jpg`);
}
await browser.close();
await fs.rm(tmp, { recursive: true, force: true });
