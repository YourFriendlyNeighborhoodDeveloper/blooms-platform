// Downloads the illustrative photography listed in image-manifest.json and
// produces responsive WebP variants plus a tiny blurred placeholder for each.
// Output: public/img/<key>-<width>.webp and src/data/images.json
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'public/img');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'scripts/image-manifest.json'), 'utf8'));
const WIDTHS = [640, 1280, 1920];

await fs.mkdir(outDir, { recursive: true });

async function processOne({ key, id, alt }) {
  const url = `https://images.unsplash.com/photo-${id}?w=2200&q=88&fm=jpg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
  const input = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(input).metadata();
  const widths = WIDTHS.filter((w) => w < meta.width).concat(meta.width < 1920 ? [meta.width] : []);
  for (const w of widths) {
    await sharp(input).resize({ width: w }).webp({ quality: 72, effort: 5 }).toFile(path.join(outDir, `${key}-${w}.webp`));
  }
  const lqip = await sharp(input).resize({ width: 20 }).blur(1.2).webp({ quality: 40 }).toBuffer();
  const { dominant } = await sharp(input).stats();
  return {
    key,
    alt,
    width: meta.width,
    height: meta.height,
    widths,
    lqip: `data:image/webp;base64,${lqip.toString('base64')}`,
    color: `rgb(${dominant.r} ${dominant.g} ${dominant.b})`,
    source: `https://images.unsplash.com/photo-${id}`,
  };
}

const results = {};
const queue = [...manifest.images];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const item = queue.shift();
      results[item.key] = await processOne(item);
      process.stdout.write(`✓ ${item.key}\n`);
    }
  }),
);

const ordered = Object.fromEntries(manifest.images.map((i) => [i.key, results[i.key]]));
await fs.writeFile(path.join(root, 'src/data/images.json'), JSON.stringify(ordered, null, 2) + '\n');
console.log(`Wrote ${Object.keys(ordered).length} images.`);
