/**
 * Multi-item comparison test: FHE, The Chosen, news/cnn
 * Tests prod vs localhost to document bugs
 */

import { chromium } from 'playwright';

async function testMenuSelection(page, baseUrl, itemName, navigateTo) {
  console.log(`\n  📍 Testing "${itemName}"...`);

  // Navigate to TV app
  await page.goto(`${baseUrl}/tv`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Find the item in menu
  const menuItems = await page.locator('.menu-item').all();
  let targetIndex = -1;

  for (let i = 0; i < Math.min(50, menuItems.length); i++) {
    const label = await menuItems[i].locator('h3').textContent();
    if (label?.trim() === itemName) {
      targetIndex = i;
      break;
    }
  }

  if (targetIndex === -1) {
    console.log(`    ⚠️  "${itemName}" not found in menu`);
    return { found: false };
  }

  console.log(`    Found at index ${targetIndex}`);

  // Navigate using arrow keys
  const columns = 5;
  const row = Math.floor(targetIndex / columns);
  const col = targetIndex % columns;

  for (let i = 0; i < row; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(80);
  }
  for (let i = 0; i < col; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(80);
  }

  // Select
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);

  // Gather results
  const results = {
    found: true,
    submenuItems: await page.locator('.menu-items .menu-item').count(),
    playerComponents: await page.locator('[class*="player"]').count(),
    videoElements: await page.locator('video').count(),
    audioElements: await page.locator('audio').count(),
    loadingSpinner: await page.locator('[class*="loading"]').count(),
    debugJson: await page.locator('[class*="player"] pre').count(),
  };

  // Check for specific error states
  if (results.debugJson > 0) {
    const jsonText = await page.locator('[class*="player"] pre').first().textContent();
    results.debugJsonSnippet = jsonText.substring(0, 150);
  }

  console.log(`    Submenu: ${results.submenuItems}, Player: ${results.playerComponents}, Video: ${results.videoElements}, Loading: ${results.loadingSpinner}`);

  return results;
}

async function testDirectPlay(page, baseUrl, playParam) {
  console.log(`\n  📍 Testing direct play: ${playParam}...`);

  await page.goto(`${baseUrl}/tv?play=${playParam}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const results = {
    playerComponents: await page.locator('[class*="player"]').count(),
    videoElements: await page.locator('video').count(),
    audioElements: await page.locator('audio').count(),
    loadingSpinner: await page.locator('[class*="loading"]').count(),
    debugJson: await page.locator('[class*="player"] pre').count(),
  };

  // Get video state if exists
  if (results.videoElements > 0) {
    const video = page.locator('video').first();
    results.videoSrc = await video.evaluate(el => el.src || el.currentSrc || '');
    results.videoPaused = await video.evaluate(el => el.paused);
    results.videoTime = await video.evaluate(el => el.currentTime);
    results.videoReadyState = await video.evaluate(el => el.readyState);
    results.videoError = await video.evaluate(el => el.error?.message || null);
  }

  // Check for debug JSON
  if (results.debugJson > 0) {
    const jsonText = await page.locator('[class*="player"] pre').first().textContent();
    results.debugJsonSnippet = jsonText.substring(0, 200);
  }

  console.log(`    Player: ${results.playerComponents}, Video: ${results.videoElements}, Loading: ${results.loadingSpinner}`);
  if (results.videoElements > 0) {
    console.log(`    Video state: paused=${results.videoPaused}, time=${results.videoTime?.toFixed(1)}s, ready=${results.videoReadyState}`);
  }

  return results;
}

async function runAllTests(baseUrl, label) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Testing: ${label} (${baseUrl})`);
  console.log('='.repeat(70));

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();

  // Suppress console noise
  page.on('console', () => {});

  const results = {};

  // Test 1: FHE (Submenu)
  results.fhe = await testMenuSelection(page, baseUrl, 'FHE', null);

  // Test 2: The Chosen (TV Season)
  results.chosen = await testMenuSelection(page, baseUrl, 'Chosen', null);

  // Test 3: Direct play news/cnn
  results.newsCnn = await testDirectPlay(page, baseUrl, 'news/cnn');

  await page.waitForTimeout(5000);
  await browser.close();

  return results;
}

(async () => {
  console.log('\n🧪 Multi-Item Bug Investigation');
  console.log('Testing: FHE, The Chosen, news/cnn\n');

  const localhostResults = await runAllTests('http://localhost:3111', 'LOCALHOST');
  const prodResults = await runAllTests('https://daylightlocal.kckern.net', 'PRODUCTION');

  // Summary
  console.log('\n' + '='.repeat(100));
  console.log('📊 COMPARISON SUMMARY');
  console.log('='.repeat(100));

  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ FHE (Submenu)                                                                           │');
  console.log('├─────────────────────────────────────────────────────────────────────────────────────────┤');
  console.log(`│ LOCALHOST:  Submenu=${localhostResults.fhe.submenuItems}, Player=${localhostResults.fhe.playerComponents}, Loading=${localhostResults.fhe.loadingSpinner}`);
  console.log(`│ PRODUCTION: Submenu=${prodResults.fhe.submenuItems}, Player=${prodResults.fhe.playerComponents}, Loading=${prodResults.fhe.loadingSpinner}`);
  console.log(`│ STATUS: ${localhostResults.fhe.submenuItems > 5 ? '✅ OK' : '❌ BUG - Submenu not opening'}`);
  console.log('└─────────────────────────────────────────────────────────────────────────────────────────┘');

  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ The Chosen (TV Season)                                                                  │');
  console.log('├─────────────────────────────────────────────────────────────────────────────────────────┤');
  console.log(`│ LOCALHOST:  Submenu=${localhostResults.chosen.submenuItems}, Player=${localhostResults.chosen.playerComponents}, Video=${localhostResults.chosen.videoElements}`);
  console.log(`│ PRODUCTION: Submenu=${prodResults.chosen.submenuItems}, Player=${prodResults.chosen.playerComponents}, Video=${prodResults.chosen.videoElements}`);
  console.log(`│ STATUS: ${(localhostResults.chosen.submenuItems > 5 || localhostResults.chosen.videoElements > 0) ? '✅ OK' : '❌ BUG'}`);
  console.log('└─────────────────────────────────────────────────────────────────────────────────────────┘');

  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ news/cnn (Direct Play)                                                                  │');
  console.log('├─────────────────────────────────────────────────────────────────────────────────────────┤');
  console.log(`│ LOCALHOST:  Video=${localhostResults.newsCnn.videoElements}, Paused=${localhostResults.newsCnn.videoPaused}, Ready=${localhostResults.newsCnn.videoReadyState}`);
  console.log(`│ PRODUCTION: Video=${prodResults.newsCnn.videoElements}, Paused=${prodResults.newsCnn.videoPaused}, Ready=${prodResults.newsCnn.videoReadyState}`);
  if (localhostResults.newsCnn.videoSrc) console.log(`│ LOCAL SRC:  ${localhostResults.newsCnn.videoSrc.substring(0, 80)}...`);
  if (prodResults.newsCnn.videoSrc) console.log(`│ PROD SRC:   ${prodResults.newsCnn.videoSrc.substring(0, 80)}...`);
  console.log(`│ STATUS: ${localhostResults.newsCnn.videoElements > 0 && !localhostResults.newsCnn.videoPaused ? '✅ OK' : '❌ BUG'}`);
  console.log('└─────────────────────────────────────────────────────────────────────────────────────────┘');

  // Debug JSON snippets if present
  if (localhostResults.fhe.debugJsonSnippet) {
    console.log('\n📄 FHE Debug JSON (localhost):');
    console.log(localhostResults.fhe.debugJsonSnippet);
  }
  if (localhostResults.chosen.debugJsonSnippet) {
    console.log('\n📄 Chosen Debug JSON (localhost):');
    console.log(localhostResults.chosen.debugJsonSnippet);
  }
  if (localhostResults.newsCnn.debugJsonSnippet) {
    console.log('\n📄 news/cnn Debug JSON (localhost):');
    console.log(localhostResults.newsCnn.debugJsonSnippet);
  }

  // Export raw results for bug reports
  console.log('\n\n📋 RAW RESULTS FOR BUG REPORTS:');
  console.log(JSON.stringify({ localhost: localhostResults, production: prodResults }, null, 2));

  console.log('\n✅ Test complete\n');
})().catch(error => {
  console.error('\n❌ Test failed:', error.message);
  process.exit(1);
});
