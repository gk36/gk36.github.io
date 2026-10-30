// Renders src/public/icon.svg into the PNG sizes iOS/Android need (run: node scripts/icons/render-icons.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const pub = path.join(root, 'src', 'public');
const svg = fs.readFileSync(path.join(pub, 'icon.svg'), 'utf8');
// Maskable icons need a full-bleed background with the mark inside the central 80% safe zone.
const maskable = svg
  .replace('<rect width="512" height="512" rx="112" fill="url(#g)"/>', '<rect width="512" height="512" fill="url(#g)"/>')
  .replace(/<path /g, '<path transform="translate(51.2 51.2) scale(0.8)" ');

const targets = [
  { file: 'apple-touch-icon.png', size: 180, src: svg.replace('rx="112"', 'rx="0"') },
  { file: 'icon-192.png', size: 192, src: svg },
  { file: 'icon-512.png', size: 512, src: svg },
  { file: 'icon-maskable-512.png', size: 512, src: maskable },
];

const browser = await chromium.launch();
for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${t.src.replace('<svg ', `<svg width="${t.size}" height="${t.size}" `)}</body></html>`);
  await page.screenshot({ path: path.join(pub, t.file), omitBackground: true, clip: { x: 0, y: 0, width: t.size, height: t.size } });
  await page.close();
  console.log(`wrote ${t.file} (${t.size}px)`);
}
await browser.close();
