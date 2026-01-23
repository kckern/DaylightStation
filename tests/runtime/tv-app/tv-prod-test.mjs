/**
 * Quick test against production to observe Bible Project behavior
 */

import { chromium } from 'playwright';

const BASE_URL = 'https://daylightlocal.kckern.net';

(async () => {
  console.log(`\n🔗 Testing against ${BASE_URL}/tv\n`);

  const browser = await chromium.launch({ 
    headless: false,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();

  // Track errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`❌ Browser error: ${msg.text()}`);
    }
  });

  page.on('pageerror', error => {
    console.log(`❌ Page error: ${error.message}`);
  });

  // Navigate to TV app
  console.log('Loading TV app...');
  try {
    await page.goto(`${BASE_URL}/tv`, { waitUntil: 'networkidle', timeout: 60000 });
  } catch (e) {
    console.log(`⚠️  Navigation warning: ${e.message}`);
    await page.waitForTimeout(5000);
  }
  await page.waitForTimeout(2000);

  // Find Bible Project
  const menuItems = await page.locator('.menu-item').all();
  console.log(`Found ${menuItems.length} menu items`);

  let targetIndex = -1;
  for (let i = 0; i < Math.min(30, menuItems.length); i++) {
    const label = await menuItems[i].locator('h3').textContent();
    if (label?.trim() === 'Bible Project') {
      targetIndex = i;
      console.log(`✅ Found "Bible Project" at index ${i}`);
      break;
    }
  }

  if (targetIndex === -1) {
    console.log('⚠️  Bible Project not found');
    await browser.close();
    return;
  }

  // Navigate to it
  const columns = 5;
  const row = Math.floor(targetIndex / columns);
  const col = targetIndex % columns;

  console.log(`\nNavigating to row ${row}, col ${col}...`);
  for (let i = 0; i < row; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
  }
  for (let i = 0; i < col; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
  }

  const activeItem = await page.locator('.menu-item.active h3').textContent();
  console.log(`Active item: "${activeItem?.trim()}"`);

  // Select it
  console.log('\n▶️  Pressing Enter...');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);

  // Check what happened
  const hasVideo = await page.locator('video').count();
  const hasAudio = await page.locator('audio').count();
  const hasSubmenu = await page.locator('.menu-items .menu-item').count();
  const hasPlayer = await page.locator('[class*="player"]').count();

  console.log(`\nAfter selection:`);
  console.log(`  - Video elements: ${hasVideo}`);
  console.log(`  - Audio elements: ${hasAudio}`);
  console.log(`  - Submenu items: ${hasSubmenu}`);
  console.log(`  - Player components: ${hasPlayer}`);

  // If player exists, check its state
  if (hasPlayer > 0) {
    const playerDebug = await page.locator('[class*="player"]').first().evaluate(el => {
      const preElement = el.querySelector('pre');
      return {
        hasVideo: !!el.querySelector('video'),
        hasAudio: !!el.querySelector('audio'),
        hasPreDebug: !!preElement,
        loadingVisible: !!el.querySelector('[class*="loading"]'),
        jsonSnippet: preElement ? preElement.textContent.substring(0, 200) : null
      };
    });
    console.log(`\nPlayer state:`, playerDebug);

    if (hasVideo > 0) {
      await page.waitForTimeout(3000);
      const video = page.locator('video').first();
      const videoSrc = await video.evaluate(el => el.src || el.currentSrc);
      const currentTime = await video.evaluate(el => el.currentTime);
      const isPaused = await video.evaluate(el => el.paused);
      const readyState = await video.evaluate(el => el.readyState);
      
      console.log(`\nVideo info:`);
      console.log(`  - Source: ${videoSrc}`);
      console.log(`  - Time: ${currentTime.toFixed(2)}s`);
      console.log(`  - Paused: ${isPaused}`);
      console.log(`  - ReadyState: ${readyState}`);
    }
  }

  console.log('\n✅ Test complete. Browser will stay open for 30 seconds...');
  await page.waitForTimeout(30000);
  await browser.close();
})().catch(error => {
  console.error('\n❌ Test failed:', error.message);
  process.exit(1);
});
