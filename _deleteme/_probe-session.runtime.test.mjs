import { test } from '@playwright/test';

test('probe session state', async ({ page }) => {
  page.on('console', (m) => {
    const t = m.text();
    if (/session/i.test(t)) console.log('CONSOLE:', t.slice(0, 200));
  });
  await page.goto('http://localhost:3111/fitness/module/fitness_instruction', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const info = await page.evaluate(() => ({
    hasGlobal: typeof window.__fitnessSession !== 'undefined',
    sessionId: window.__fitnessSession?.sessionId ?? null,
    kiosk: window.__fitnessSession?._kioskMode ?? null,
    roster: window.__fitnessSession?.roster?.length ?? null,
    ua: navigator.userAgent,
  }));
  console.log('PROBE', JSON.stringify(info, null, 2));
});
