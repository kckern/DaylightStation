import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
try {
  await page.goto('http://localhost:3111/tv');
  await page.waitForTimeout(2000);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);

  const metrics = await page.evaluate(() => {
    const nav = document.querySelector('.arcade-selector__navmap');
    const items = nav.querySelectorAll('.arcade-selector__navmap-item');
    const navRect = nav.getBoundingClientRect();
    let visible = 0;
    let totalItemArea = 0;
    for (const item of items) {
      const r = item.getBoundingClientRect();
      if (r.top >= navRect.top - 2 && r.bottom <= navRect.bottom + 2 &&
          r.left >= navRect.left - 2 && r.right <= navRect.right + 2) visible++;
      totalItemArea += r.width * r.height;
    }
    const navArea = navRect.width * navRect.height;
    return {
      total: items.length,
      visible,
      navW: Math.round(navRect.width),
      navH: Math.round(navRect.height),
      fillPct: (totalItemArea / navArea * 100).toFixed(1),
      emptyPct: (100 - totalItemArea / navArea * 100).toFixed(1),
      thumbW: Math.round(items[0]?.getBoundingClientRect().width || 0),
      thumbH: Math.round(items[0]?.getBoundingClientRect().height || 0),
      scrollH: nav.scrollHeight,
      clientH: nav.clientHeight,
    };
  });
  console.log('Metrics:', metrics);
  console.log(metrics.visible === metrics.total ? 'PASS: All visible' : 'FAIL: ' + metrics.visible + '/' + metrics.total);
  console.log('Fill:', metrics.fillPct + '% | Empty:', metrics.emptyPct + '%');

  await page.screenshot({ path: '/tmp/arcade-selector4.png' });
} catch (e) {
  await page.screenshot({ path: '/tmp/arcade-selector4-error.png' });
  console.error('FAIL:', e.message);
} finally { await browser.close(); }
