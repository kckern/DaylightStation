/**
 * Test FHE menu selection - Production vs Localhost comparison
 * 
 * Expected (Production): Opens submenu
 * Bug (Localhost): Shows spinner, doesn't open submenu
 */

import { chromium } from 'playwright';

async function testFHESelection(baseUrl, label) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Testing: ${label}`);
  console.log(`URL: ${baseUrl}/tv`);
  console.log('='.repeat(70));

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
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  page.on('pageerror', error => {
    errors.push(error.message);
  });

  // Navigate to TV app
  console.log('\n📍 Loading /tv...');
  try {
    await page.goto(`${baseUrl}/tv`, { 
      waitUntil: 'networkidle', 
      timeout: 60000 
    });
  } catch (e) {
    console.log(`  ⚠️  Navigation warning: ${e.message}`);
    await page.waitForTimeout(5000);
  }

  await page.waitForTimeout(2000);
  console.log('  ✅ Page loaded\n');

  // Find FHE in the menu
  const menuItems = await page.locator('.menu-item').all();
  console.log(`📋 Found ${menuItems.length} menu items\n`);

  let fheIndex = -1;
  for (let i = 0; i < Math.min(50, menuItems.length); i++) {
    const label = await menuItems[i].locator('h3').textContent();
    if (label?.trim() === 'FHE') {
      fheIndex = i;
      console.log(`✅ Found "FHE" at index ${i}\n`);
      break;
    }
  }

  if (fheIndex === -1) {
    console.log('❌ FHE not found in menu\n');
    await browser.close();
    return {
      found: false,
      submenuOpened: false,
      spinnerShown: false,
      errors: errors.length
    };
  }

  // Navigate to FHE using arrow keys
  const columns = 5;
  const row = Math.floor(fheIndex / columns);
  const col = fheIndex % columns;

  console.log(`🎯 Navigating to row ${row}, col ${col}...`);
  for (let i = 0; i < row; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
  }
  for (let i = 0; i < col; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
  }

  const activeItem = await page.locator('.menu-item.active h3').textContent();
  console.log(`  Active: "${activeItem?.trim()}"\n`);

  // Select FHE
  console.log('▶️  Pressing Enter to select FHE...\n');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);

  // Check what happened
  const hasSubmenu = await page.locator('.menu-items .menu-item').count();
  const hasPlayer = await page.locator('[class*="player"]').count();
  const hasVideo = await page.locator('video').count();
  const hasAudio = await page.locator('audio').count();
  const loadingVisible = await page.locator('[class*="loading"][class*="visible"], .loading-overlay').count();
  const hasPreDebug = await page.locator('[class*="player"] pre').count();

  console.log('📊 After Selection:\n');
  console.log(`  Submenu items: ${hasSubmenu}`);
  console.log(`  Player components: ${hasPlayer}`);
  console.log(`  Video elements: ${hasVideo}`);
  console.log(`  Audio elements: ${hasAudio}`);
  console.log(`  Loading spinner: ${loadingVisible > 0 ? '✅ VISIBLE' : '❌ Hidden'}`);
  console.log(`  Debug JSON shown: ${hasPreDebug > 0 ? '✅ YES' : '❌ No'}`);

  // Determine behavior
  const submenuOpened = hasSubmenu > 5;
  const spinnerStuck = loadingVisible > 0 && !hasVideo && !hasAudio;
  const debugShown = hasPreDebug > 0;

  console.log('\n🔍 Analysis:\n');
  if (submenuOpened) {
    console.log('  ✅ Submenu opened successfully');
  } else if (spinnerStuck) {
    console.log('  ❌ SPINNER STUCK (bug detected)');
  } else if (debugShown) {
    console.log('  ❌ DEBUG JSON shown (folder metadata bug)');
  } else if (hasVideo || hasAudio) {
    console.log('  ⚠️  Media player loaded (unexpected for folder)');
  } else {
    console.log('  ⚠️  Unknown state');
  }

  // Check for debug JSON data if present
  if (debugShown) {
    const jsonSnippet = await page.locator('[class*="player"] pre').first().textContent();
    console.log('\n  Debug JSON snippet:');
    const lines = jsonSnippet.split('\n').slice(0, 8);
    lines.forEach(line => console.log(`    ${line}`));
  }

  // Check for errors
  if (errors.length > 0) {
    console.log(`\n⚠️  ${errors.length} errors detected:`);
    errors.slice(0, 5).forEach(err => {
      if (!err.includes('🔥 PHASE') && !err.includes('VERSION:')) {
        console.log(`    - ${err.substring(0, 100)}`);
      }
    });
  }

  console.log('\n⏱️  Keeping browser open for 15 seconds...\n');
  await page.waitForTimeout(15000);
  
  await browser.close();

  return {
    found: true,
    submenuOpened,
    spinnerStuck,
    debugShown,
    hasSubmenu,
    hasPlayer,
    hasVideo,
    hasAudio,
    loadingVisible,
    errors: errors.length
  };
}

(async () => {
  console.log('\n🧪 FHE Menu Selection Test');
  console.log('Comparing Localhost vs Production\n');

  console.log('Testing LOCALHOST first...\n');
  const localhostResults = await testFHESelection('http://localhost:3111', 'LOCALHOST');
  
  console.log('\n' + '─'.repeat(100) + '\n');
  
  console.log('Testing PRODUCTION...\n');
  const prodResults = await testFHESelection('https://daylightlocal.kckern.net', 'PRODUCTION');

  // Summary comparison
  console.log('\n' + '='.repeat(100));
  console.log('📊 COMPARISON SUMMARY');
  console.log('='.repeat(100) + '\n');

  console.log('| Metric                  | Localhost              | Production             |');
  console.log('|-------------------------|------------------------|------------------------|');
  console.log(`| FHE Found               | ${localhostResults.found ? '✅ Yes' : '❌ No'}                 | ${prodResults.found ? '✅ Yes' : '❌ No'}                 |`);
  console.log(`| Submenu Opened          | ${localhostResults.submenuOpened ? '✅ Yes' : '❌ No'}                 | ${prodResults.submenuOpened ? '✅ Yes' : '❌ No'}                 |`);
  console.log(`| Spinner Stuck           | ${localhostResults.spinnerStuck ? '❌ YES (BUG!)' : '✅ No'}          | ${prodResults.spinnerStuck ? '❌ YES (BUG!)' : '✅ No'}          |`);
  console.log(`| Debug JSON Shown        | ${localhostResults.debugShown ? '❌ YES (BUG!)' : '✅ No'}          | ${prodResults.debugShown ? '❌ YES (BUG!)' : '✅ No'}          |`);
  console.log(`| Submenu Item Count      | ${localhostResults.hasSubmenu.toString().padEnd(22)} | ${prodResults.hasSubmenu.toString().padEnd(22)} |`);
  console.log(`| Player Components       | ${localhostResults.hasPlayer.toString().padEnd(22)} | ${prodResults.hasPlayer.toString().padEnd(22)} |`);
  console.log(`| Loading Spinner Visible | ${localhostResults.loadingVisible.toString().padEnd(22)} | ${prodResults.loadingVisible.toString().padEnd(22)} |`);

  console.log('\n');

  // Verdict
  if (localhostResults.submenuOpened && prodResults.submenuOpened) {
    console.log('✅ PASS: Both environments work correctly\n');
  } else if (!localhostResults.submenuOpened && prodResults.submenuOpened) {
    console.log('❌ BUG CONFIRMED: Localhost fails to open submenu, Production works\n');
    console.log('Root cause: Same as Bible Project bug - folder metadata passed to Player\n');
  } else if (localhostResults.submenuOpened && !prodResults.submenuOpened) {
    console.log('⚠️  WARNING: Localhost works but Production fails (unexpected)\n');
  } else {
    console.log('❌ FAIL: Both environments fail\n');
  }

  console.log('✅ Test complete\n');
})().catch(error => {
  console.error('\n❌ Test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
});
