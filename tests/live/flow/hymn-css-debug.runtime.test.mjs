import { test, expect } from '@playwright/test';

test('Hymn 116 renders with correct CSS styling', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('http://localhost:3111/tv?hymn=116', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  await page.screenshot({ path: '/tmp/hymn-116.png', fullPage: true });

  // Check that the content-scroller has the singalong class
  const scroller = page.locator('.content-scroller');
  const scrollerClass = await scroller.getAttribute('class');
  console.log('Scroller classes:', scrollerClass);

  // Check background color is applied (hymn amber: #fdf0d588)
  const bgColor = await scroller.evaluate(el => getComputedStyle(el).backgroundColor);
  console.log('Background color:', bgColor);

  // Check text is visible and styled
  const textEl = page.locator('.singalong-text, .hymn-text');
  const textVisible = await textEl.isVisible();
  console.log('Text element visible:', textVisible);

  if (textVisible) {
    const fontSize = await textEl.evaluate(el => getComputedStyle(el).fontSize);
    console.log('Font size:', fontSize);
  }

  console.log('JS Errors:', errors.filter(e => !e.includes('PHASE 4')));
});
