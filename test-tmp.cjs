const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // Test series-level URL (should auto-select first talk WITH video file)
  await page.goto('http://localhost:3111/tv?talk=ldsgc', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(5000);

  const hasVideo = await page.evaluate(() => {
    const v = document.querySelector('video');
    return v ? { found: true, src: v.src || v.currentSrc, readyState: v.readyState } : { found: false };
  });
  console.log('Video element:', JSON.stringify(hasVideo));

  const hasText = await page.evaluate(() => {
    const talkText = document.querySelector('.talk-text, .narrated-text');
    return talkText ? { found: true, textLength: talkText.textContent.length } : { found: false };
  });
  console.log('Talk text:', JSON.stringify(hasText));
  console.log('Errors:', errors.length ? errors.join('; ') : 'none');

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
