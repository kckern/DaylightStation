// tests/_scratch/shoot-session-chart.mjs
// Usage: BASE_URL=http://localhost:3111 SESSION=20260612180809 LABEL=before \
//        node tests/_scratch/shoot-session-chart.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'https://daylightlocal.kckern.net';
const SESSION = process.env.SESSION || '20260612180809';
const LABEL = process.env.LABEL || 'shot';
const OUT = `/tmp/session-chart-${LABEL}.png`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1728, height: 1200 }, deviceScaleFactor: 2 });
await page.goto(`${BASE}/fitness/home/session-${SESSION}`, { waitUntil: 'networkidle' });
// The chart mounts async; wait for the race-chart svg + at least one avatar image.
await page.waitForSelector('.session-detail svg.race-chart__svg', { timeout: 20000 });
await page.waitForTimeout(1500);
const target = await page.$('.session-detail');
await (target || page).screenshot({ path: OUT });
console.log(`wrote ${OUT}`);
await browser.close();
