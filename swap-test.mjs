import { chromium } from 'playwright';

const URL = 'http://localhost:3111/admin/content/lists/menus/fhe';

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="item-row-0-4"]', { timeout: 10000 });

  const alanRow = page.locator('[data-testid="item-row-0-4"]');
  await alanRow.hover();
  await page.waitForTimeout(500);

  const handle = alanRow.locator('.col-content-drag');
  const hBox = await handle.boundingBox();
  console.log('Handle boundingBox:', JSON.stringify(hBox));

  // Check what element is at the handle coordinates
  const sx = hBox.x + hBox.width / 2;
  const sy = hBox.y + hBox.height / 2;
  
  const elementInfo = await page.evaluate(({x, y}) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return 'null';
    return {
      tag: el.tagName,
      className: el.className,
      parentClass: el.parentElement?.className,
      grandParentClass: el.parentElement?.parentElement?.className,
      text: el.textContent?.substring(0, 50),
      rect: el.getBoundingClientRect()
    };
  }, {x: sx, y: sy});
  
  console.log('Element at handle coords:', JSON.stringify(elementInfo, null, 2));

  // Also check: is the handle actually visible?
  const handleVisible = await handle.isVisible();
  const handleOpacity = await handle.evaluate(el => getComputedStyle(el).opacity);
  console.log(`Handle visible: ${handleVisible}, opacity: ${handleOpacity}`);

  // Check handle size
  const handleSize = await handle.evaluate(el => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height, x: r.x, y: r.y };
  });
  console.log('Handle actual rect:', JSON.stringify(handleSize));

  await page.waitForTimeout(3000);
  await browser.close();
})();
