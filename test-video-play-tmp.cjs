const { chromium } = require('playwright');

async function testUrl(browser, url, label) {
  console.log('\n========================================');
  console.log('Testing: ' + label);
  console.log('URL: ' + url);
  console.log('========================================');

  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setAutoplayPolicy', { autoplayPolicy: 'no-user-gesture-required' });
  } catch (e) {}

  const apiCalls = [];
  page.on('response', function(res) {
    var u = res.url();
    if (u.includes('/api/v1/') || res.status() >= 400) {
      apiCalls.push(res.status() + ' ' + u.substring(0, 250));
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(8000);

  var ms = await page.evaluate(function() {
    var v = document.querySelector('video');
    var a = document.querySelector('audio');
    var m = v || a;
    if (m === null) {
      var errEls = document.querySelectorAll('[class*="error"], [class*="Error"], .vite-error-overlay');
      var errs = [];
      for (var i = 0; i < errEls.length; i++) {
        errs.push(errEls[i].textContent ? errEls[i].textContent.substring(0, 200) : '');
      }
      return { exists: false, errorElements: errs, title: document.title };
    }
    return {
      exists: true,
      type: v ? 'video' : 'audio',
      paused: m.paused,
      currentTime: m.currentTime,
      duration: m.duration,
      src: m.src ? m.src.substring(0, 250) : null,
      readyState: m.readyState,
      networkState: m.networkState,
      error: m.error ? { code: m.error.code, message: m.error.message } : null
    };
  });

  console.log('Media State:', JSON.stringify(ms, null, 2));

  if (ms.exists && ms.paused) {
    console.log('Attempting play...');
    await page.evaluate(function() {
      var m = document.querySelector('video') || document.querySelector('audio');
      if (m) return m.play().catch(function(e) { return e.message; });
    });
    await page.waitForTimeout(3000);
    var s2 = await page.evaluate(function() {
      var m = document.querySelector('video') || document.querySelector('audio');
      if (m === null) return null;
      return {
        paused: m.paused,
        currentTime: m.currentTime,
        readyState: m.readyState,
        error: m.error ? { code: m.error.code, message: m.error.message } : null
      };
    });
    console.log('After play:', JSON.stringify(s2, null, 2));
  }

  var ssPath = '/private/tmp/claude-501/-Users-kckern-Documents-GitHub-DaylightStation/a6831504-e072-40d2-b063-a6acdcb31313/scratchpad/' + label.replace(/[^a-zA-Z0-9]/g, '-') + '.png';
  await page.screenshot({ path: ssPath });
  console.log('Screenshot: ' + ssPath);

  console.log('API/Failed requests:');
  apiCalls.forEach(function(c) { console.log('  ' + c); });

  await context.close();
}

(async () => {
  var browser = await chromium.launch({ headless: true });

  await testUrl(browser, 'http://localhost:3111/fitness/play/662045', 'fitness-play-662045');
  await testUrl(browser, 'http://localhost:3111/tv?play=663034', 'tv-play-663034');

  await browser.close();
  process.exit(0);
})();
