import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const logs = [];
page.on('console', msg => {
  const text = msg.text();
  if (text.includes('[SPIN') || text.includes('[WHEEL') || text.includes('animate')) {
    logs.push(text);
  }
});

console.log('Navigating to family-selector...');
await page.goto('http://localhost:3111/tv/app/family-selector', { waitUntil: 'networkidle', timeout: 15000 });

await page.waitForSelector('.wheel-rotator', { timeout: 10000 });
console.log('Wheel rendered. Pressing SPACE...');

await page.keyboard.press('Space');

// Check transform at 500ms intervals to see if it's animating
for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(500);
  const transform = await page.evaluate(() => {
    const el = document.querySelector('.wheel-rotator');
    return getComputedStyle(el).transform;
  });
  console.log(`[${(i+1)*500}ms after spin] transform: ${transform}`);
}

console.log('\n=== CONSOLE LOGS ===');
logs.forEach(l => console.log(l));

await browser.close();
