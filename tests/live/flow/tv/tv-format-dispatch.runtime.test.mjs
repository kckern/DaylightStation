// tests/live/flow/tv/tv-format-dispatch.runtime.test.mjs
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE = BACKEND_URL;

test.describe.configure({ mode: 'serial' });

let sharedPage, sharedContext;

test.describe('Format-based dispatch', () => {
  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    // Enable autoplay for audio/video
    try {
      const cdp = await sharedContext.newCDPSession(await sharedContext.newPage());
      await cdp.send('Emulation.setAutoplayPolicy', { autoplayPolicy: 'no-user-gesture-required' });
      await (await sharedContext.pages())[0].close();
    } catch (e) {
      console.log('Could not set autoplay policy:', e.message);
    }
    sharedPage = await sharedContext.newPage();
  });

  test.afterAll(async () => {
    await sharedPage?.close();
    await sharedContext?.close();
  });

  test('singalong format renders SingalongScroller', async () => {
    await sharedPage.goto(`${BASE}/tv?play=singalong:hymn/166`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await sharedPage.waitForTimeout(5000);
    // SingalongScroller should be present (it has specific CSS classes)
    const scroller = await sharedPage.$('[class*="singing"], [class*="singalong"], [class*="Scroller"]');
    expect(scroller).toBeTruthy();
  });

  test('video format renders VideoPlayer', async () => {
    await sharedPage.goto(`${BASE}/tv?play=plex:457385`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await sharedPage.waitForTimeout(5000);
    const video = await sharedPage.$('video');
    expect(video).toBeTruthy();
  });

  test('legacy hymn prop still works', async () => {
    await sharedPage.goto(`${BASE}/tv?hymn=166`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await sharedPage.waitForTimeout(5000);
    const scroller = await sharedPage.$('[class*="singing"], [class*="singalong"], [class*="Scroller"]');
    expect(scroller).toBeTruthy();
  });

  test('legacy scripture prop still works', async () => {
    await sharedPage.goto(`${BASE}/tv?scripture=alma-32`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await sharedPage.waitForTimeout(5000);
    const scroller = await sharedPage.$('[class*="narrated"], [class*="readalong"], [class*="Scroller"]');
    expect(scroller).toBeTruthy();
  });

  test('readalong talk renders scroller', async () => {
    await sharedPage.goto(`${BASE}/tv?talk=ldsgc`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await sharedPage.waitForTimeout(5000);
    const scroller = await sharedPage.$('[class*="narrated"], [class*="readalong"], [class*="Scroller"]');
    expect(scroller).toBeTruthy();
  });

  test('hymn via alias play param works', async () => {
    await sharedPage.goto(`${BASE}/tv?play=hymn:166`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await sharedPage.waitForTimeout(5000);
    const scroller = await sharedPage.$('[class*="singing"], [class*="singalong"], [class*="Scroller"]');
    expect(scroller).toBeTruthy();
  });
});
