import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
try {
  await page.goto('http://localhost:3111/tv');
  await page.waitForTimeout(2000);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);

  const metrics = await page.evaluate(() => {
    const nav = document.querySelector('.arcade-selector__navmap');
    if (!nav) return { error: 'navmap not found' };
    const cols = nav.querySelectorAll('.arcade-selector__navmap-col');
    const colWidths = Array.from(cols).map(c => Math.round(c.getBoundingClientRect().width));
    const items = nav.querySelectorAll('.arcade-selector__navmap-item');
    const navRect = nav.getBoundingClientRect();
    let totalItemArea = 0;
    for (const item of items) {
      const r = item.getBoundingClientRect();
      totalItemArea += r.width * r.height;
    }
    const navArea = navRect.width * navRect.height;
    return {
      total: items.length,
      colWidths,
      widthRatio: colWidths.length ? (Math.max(...colWidths) / Math.min(...colWidths)).toFixed(2) : 'N/A',
      fillPct: (totalItemArea / navArea * 100).toFixed(1),
    };
  });
  console.log('Metrics:', JSON.stringify(metrics, null, 2));
  console.log('Width ratio (max/min):', metrics.widthRatio);

  await page.screenshot({ path: '/tmp/arcade-selector9.png' });
} catch (e) {
  await page.screenshot({ path: '/tmp/arcade-selector9-error.png' });
  console.error('FAIL:', e.message);
} finally { await browser.close(); }
