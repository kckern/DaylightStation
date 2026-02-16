const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Load FamilySelector directly via the TV app route
  await page.goto('http://localhost:3111/tv/app/family-selector', { waitUntil: 'networkidle', timeout: 15000 });

  // Wait for the wheel to appear
  await page.waitForSelector('.roulette-wheel', { timeout: 10000 });
  console.log('Wheel loaded');

  // Measure the spin
  const start = Date.now();
  await page.keyboard.press('Space');

  // Wait for winner modal (signals spin complete)
  await page.waitForSelector('.winner-modal-overlay', { timeout: 20000 });
  const elapsed = Date.now() - start;
  console.log('SPIN_DURATION_MS=' + elapsed);

  await browser.close();
})();
