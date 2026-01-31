/**
 * Test audio-header element differences between localhost and production
 * Testing URL parameter: play=154382
 */

import { chromium } from 'playwright';

async function testAudioHeader(baseUrl, label) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${label}`);
  console.log(`URL: ${baseUrl}/tv?play=154382`);
  console.log('='.repeat(60));

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();

  // Track all API requests
  const apiRequests = [];
  page.on('request', request => {
    const url = request.url();
    if (url.includes('/api/') || url.includes('154382')) {
      apiRequests.push({
        method: request.method(),
        url: url,
        postData: request.postData()
      });
    }
  });

  // Track console output
  const consoleMessages = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleMessages.push({ type: msg.type(), text });
    if (msg.type() === 'error') {
      console.log(`  ❌ Console error: ${text}`);
    }
  });

  page.on('pageerror', error => {
    console.log(`  ❌ Page error: ${error.message}`);
  });

  // Navigate
  console.log('\n📍 Loading page...');
  try {
    await page.goto(`${baseUrl}/tv?play=154382`, { 
      waitUntil: 'networkidle', 
      timeout: 60000 
    });
  } catch (e) {
    console.log(`  ⚠️  Navigation warning: ${e.message}`);
    await page.waitForTimeout(5000);
  }

  console.log('  ✅ Page loaded\n');

  // Wait for content to load
  await page.waitForTimeout(3000);

  // Check for audio-header
  const audioHeaderExists = await page.locator('.audio-header').count();
  console.log(`🎵 Audio Header Elements Found: ${audioHeaderExists}\n`);

  if (audioHeaderExists > 0) {
    // Get all audio-header elements
    const audioHeaders = await page.locator('.audio-header').all();
    
    for (let i = 0; i < audioHeaders.length; i++) {
      const header = audioHeaders[i];
      
      const info = await header.evaluate(el => {
        return {
          className: el.className,
          innerHTML: el.innerHTML,
          textContent: el.textContent.trim(),
          childElementCount: el.childElementCount,
          children: Array.from(el.children).map(child => ({
            tagName: child.tagName,
            className: child.className,
            textContent: child.textContent.trim()
          })),
          computedStyles: {
            display: window.getComputedStyle(el).display,
            visibility: window.getComputedStyle(el).visibility,
            fontSize: window.getComputedStyle(el).fontSize,
            fontWeight: window.getComputedStyle(el).fontWeight,
            color: window.getComputedStyle(el).color,
            background: window.getComputedStyle(el).backgroundColor
          },
          attributes: Array.from(el.attributes).map(attr => ({
            name: attr.name,
            value: attr.value
          }))
        };
      });

      console.log(`Audio Header #${i + 1}:`);
      console.log(`  Class: ${info.className}`);
      console.log(`  Text Content: "${info.textContent}"`);
      console.log(`  Child Elements: ${info.childElementCount}`);
      
      if (info.children.length > 0) {
        console.log(`  Children:`);
        info.children.forEach((child, idx) => {
          console.log(`    ${idx + 1}. <${child.tagName.toLowerCase()}> class="${child.className}"`);
          console.log(`       Text: "${child.textContent}"`);
        });
      }

      console.log(`  Computed Styles:`);
      console.log(`    Display: ${info.computedStyles.display}`);
      console.log(`    Visibility: ${info.computedStyles.visibility}`);
      console.log(`    Font: ${info.computedStyles.fontSize} / ${info.computedStyles.fontWeight}`);
      console.log(`    Color: ${info.computedStyles.color}`);

      if (info.attributes.length > 0) {
        console.log(`  Attributes:`);
        info.attributes.forEach(attr => {
          console.log(`    ${attr.name}="${attr.value}"`);
        });
      }

      console.log(`  Raw HTML (first 200 chars):`);
      console.log(`    ${info.innerHTML.substring(0, 200)}...\n`);
    }
  } else {
    console.log('  ⚠️  No .audio-header elements found!\n');
  }

  // Check for related elements
  console.log('🔍 Related Elements:');
  const audioPlayer = await page.locator('.audio-player').count();
  const audioContainer = await page.locator('[class*="audio"]').count();
  const playerComponent = await page.locator('[class*="player"]').count();
  
  console.log(`  .audio-player: ${audioPlayer}`);
  console.log(`  [class*="audio"]: ${audioContainer}`);
  console.log(`  [class*="player"]: ${playerComponent}\n`);

  // Check media elements
  const videoCount = await page.locator('video').count();
  const audioCount = await page.locator('audio').count();
  
  console.log(`🎬 Media Elements:`);
  console.log(`  <video>: ${videoCount}`);
  console.log(`  <audio>: ${audioCount}\n`);

  if (audioCount > 0) {
    const audioEl = page.locator('audio').first();
    const audioInfo = await audioEl.evaluate(el => ({
      src: el.src || el.currentSrc,
      currentTime: el.currentTime,
      duration: el.duration,
      paused: el.paused,
      readyState: el.readyState
    }));
    
    console.log(`  Audio Info:`);
    console.log(`    Source: ${audioInfo.src}`);
    console.log(`    Time: ${audioInfo.currentTime.toFixed(2)}s / ${audioInfo.duration.toFixed(2)}s`);
    console.log(`    Paused: ${audioInfo.paused}`);
    console.log(`    ReadyState: ${audioInfo.readyState}\n`);
  }

  console.log('⏱️  Keeping browser open for 10 seconds for inspection...\n');
  
  // Print API requests that were made
  console.log('🔍 API Requests made:');
  apiRequests.forEach((req, idx) => {
    console.log(`  ${idx + 1}. ${req.method} ${req.url}`);
    if (req.postData) {
      console.log(`     POST data: ${req.postData.substring(0, 100)}`);
    }
  });
  console.log('');
  
  await page.waitForTimeout(10000);
  
  await browser.close();
  
  return {
    audioHeaderCount: audioHeaderExists,
    audioPlayerCount: audioPlayer,
    videoCount,
    audioCount
  };
}

(async () => {
  console.log('\n🔬 Audio Header Investigation');
  console.log('Testing play=154382 on localhost vs production\n');

  const localhostResults = await testAudioHeader('http://localhost:3111', 'LOCALHOST');
  console.log('\n' + '─'.repeat(80) + '\n');
  const prodResults = await testAudioHeader('https://daylightlocal.kckern.net', 'PRODUCTION');

  console.log('\n' + '='.repeat(80));
  console.log('📊 COMPARISON SUMMARY');
  console.log('='.repeat(80));
  console.log('\n| Metric                | Localhost | Production |');
  console.log('|-----------------------|-----------|------------|');
  console.log(`| .audio-header count   | ${localhostResults.audioHeaderCount.toString().padEnd(9)} | ${prodResults.audioHeaderCount.toString().padEnd(10)} |`);
  console.log(`| .audio-player count   | ${localhostResults.audioPlayerCount.toString().padEnd(9)} | ${prodResults.audioPlayerCount.toString().padEnd(10)} |`);
  console.log(`| <video> elements      | ${localhostResults.videoCount.toString().padEnd(9)} | ${prodResults.videoCount.toString().padEnd(10)} |`);
  console.log(`| <audio> elements      | ${localhostResults.audioCount.toString().padEnd(9)} | ${prodResults.audioCount.toString().padEnd(10)} |`);
  console.log('\n');

  if (localhostResults.audioHeaderCount !== prodResults.audioHeaderCount) {
    console.log('⚠️  DIFFERENCE DETECTED in .audio-header count!');
  }

  console.log('\n✅ Investigation complete\n');
})().catch(error => {
  console.error('\n❌ Test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
});
