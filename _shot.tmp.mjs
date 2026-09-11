import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE.ERROR:', m.text().slice(0, 200)); });
await page.goto('http://localhost:3111/health?date=2026-09-10', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('.health-row-line', { timeout: 30000 });
await page.waitForTimeout(2500);
const rows = await page.$$eval('.health-row-line', els => els.slice(0, 12).map(el => {
  const name = el.querySelector('.health-row__name')?.textContent?.trim();
  const del = el.querySelector('.health-row__delete');
  const ok = el.querySelector('.health-row__confirm');
  const action = el.querySelector('.health-row__action');
  const r = action?.getBoundingClientRect();
  return { name, hasDelete: !!del, hasConfirm: !!ok,
    actionW: r ? Math.round(r.width) : null,
    delW: del ? Math.round(del.getBoundingClientRect().width) : null,
    overlap: del && ok ? (del.getBoundingClientRect().left < ok.getBoundingClientRect().right) : false };
}));
console.log(JSON.stringify(rows, null, 1));
const bodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log('horizontal overflow px:', bodyOverflow);
await page.screenshot({ path: '/tmp/claude-1001/-opt-Code-DaylightStation/47295da5-4095-47f9-a017-e17a57cbf939/scratchpad/health.png', fullPage: false });
await browser.close();
