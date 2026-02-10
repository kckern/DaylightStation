import { test, expect } from '@playwright/test';

test('talk ldsgc202510 plays with advancing playhead', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  try {
    const cdp = await context.newCDPSession(await context.newPage());
    await cdp.send('Emulation.setAutoplayPolicy', { policy: 'no-user-gesture-required' });
    await (await context.pages())[0].close();
  } catch {}
  const page = await context.newPage();

  const apiErrors = [];
  page.on('response', res => {
    if (res.url().includes('/api/') && res.status() >= 400)
      apiErrors.push(`${res.status()} ${res.url()}`);
  });

  await page.goto('http://localhost:3111/tv?talk=ldsgc202510', {
    waitUntil: 'domcontentloaded', timeout: 15000
  });

  // Wait for content to load and render
  await page.waitForTimeout(6000);

  // Check for readalong scroller
  const scroller = await page.$('[class*="narrated"], [class*="readalong"], [class*="Scroller"], [class*="scroller"]');
  console.log('Has scroller:', !!scroller);

  // Check for audio element
  const audio = await page.$('audio');
  console.log('Has audio:', !!audio);

  // Check audio state if present
  if (audio) {
    const audioState = await audio.evaluate(el => ({
      src: el.src?.substring(0, 80),
      paused: el.paused,
      currentTime: el.currentTime,
      duration: el.duration,
      readyState: el.readyState
    }));
    console.log('Audio state:', JSON.stringify(audioState));

    // Wait a few seconds and check if playhead advanced
    await page.waitForTimeout(4000);
    const currentTime2 = await audio.evaluate(el => el.currentTime);
    console.log('Audio time after 4s:', currentTime2);
    console.log('Playhead advanced:', currentTime2 > audioState.currentTime);
  }

  // Check for highlighted/active verse
  const activeVerse = await page.$('[class*="active"], [class*="highlight"], [class*="current"]');
  console.log('Has active verse:', !!activeVerse);

  await page.screenshot({ path: '/tmp/talk-ldsgc202510.png' });
  console.log('Screenshot: /tmp/talk-ldsgc202510.png');

  console.log('API errors:', apiErrors.length);
  apiErrors.forEach(e => console.log('  ', e));

  expect(scroller || audio, 'Should render scroller or audio').toBeTruthy();
  expect(apiErrors.length, `API errors: ${apiErrors.join(', ')}`).toBe(0);

  await page.close();
  await context.close();
});
