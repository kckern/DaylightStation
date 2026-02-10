import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3111';

test('FHE menu - Spotlight item via keyboard', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const consoleLogs = [];
  page.on('console', (msg) => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto(`${BASE}/tv?list=menu:fhe`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Screenshot before navigation
  await page.screenshot({ path: '/tmp/fhe-before.png', fullPage: true });

  // Navigate to Spotlight (index 1) - press right arrow once from Opening Hymn
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/fhe-spotlight-selected.png', fullPage: true });

  // Press Enter to select
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/fhe-spotlight-opened.png', fullPage: true });

  console.log('Errors after Spotlight:', JSON.stringify(errors));
  console.log('Console logs:', consoleLogs.filter(l => !l.includes('PHASE 4') && !l.includes('VERSION')).join('\n'));
});

test('FHE menu - Gratitude item via keyboard', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const consoleLogs = [];
  page.on('console', (msg) => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto(`${BASE}/tv?list=menu:fhe`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Navigate to Gratitude (index 6) - it's in the second row
  // Row 1: Opening Hymn(0), Spotlight(1), Felix(2), Milo(3), Alan(4)
  // Row 2: Soren(5), Gratitude(6), Clip(7), Closing Hymn(8)
  // Press down to go to row 2, then right once to get to Gratitude
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/fhe-gratitude-selected.png', fullPage: true });

  // Press Enter to select
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/fhe-gratitude-opened.png', fullPage: true });

  console.log('Errors after Gratitude:', JSON.stringify(errors));
  console.log('Console logs:', consoleLogs.filter(l => !l.includes('PHASE 4') && !l.includes('VERSION')).join('\n'));
});
