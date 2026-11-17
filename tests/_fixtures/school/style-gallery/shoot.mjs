// node tests/_fixtures/school/style-gallery/shoot.mjs <outDir> [baseUrl]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const [out, base = 'http://127.0.0.1:43188/tests/_fixtures/school/style-gallery/'] = process.argv.slice(2);
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'snapshots');
const names = fs.readdirSync(dir).filter(f => f.endsWith('.html')).map(f => f.slice(0, -5));
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
for (const name of names) {
  await page.goto(`${base}?shot=${name}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log('shot', name);
}
await browser.close();
