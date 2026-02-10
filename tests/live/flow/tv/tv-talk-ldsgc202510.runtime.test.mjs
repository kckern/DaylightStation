// tests/live/flow/tv/tv-talk-ldsgc202510.runtime.test.mjs
// Runtime test: specific talk from ldsgc202510 conference — audio plays, text scrolls, playhead advances
// Uses talk 12 (first talk with confirmed media file) rather than the container
import { test, expect } from '@playwright/test';

// Direct talk URL (talk 12 has confirmed .mp4 file)
const TV_URL = '/tv?play=talk:ldsgc/ldsgc202510/12';

test.describe.configure({ mode: 'serial' });

let sharedPage, sharedContext;

test.describe('Talk playback: ldsgc202510/12', () => {
  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    sharedPage = await sharedContext.newPage();
  });

  test.afterAll(async () => {
    await sharedPage?.close();
    await sharedContext?.close();
  });

  test('page loads and resolves to playable talk', async () => {
    const apiCalls = [];
    const apiErrors = [];

    sharedPage.on('response', res => {
      if (res.url().includes('/api/')) {
        apiCalls.push(`${res.status()} ${res.url().replace(/http:\/\/[^/]+/, '')}`);
        if (res.status() >= 400) {
          apiErrors.push(`${res.status()} ${res.url()}`);
        }
      }
    });

    await sharedPage.goto(TV_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for audio element to appear (readalong content uses <audio>, not <video>)
    let media = null;
    for (let i = 0; i < 20; i++) {
      media = await sharedPage.$('audio[src], video[src]');
      if (media) break;
      await sharedPage.waitForTimeout(1000);
    }

    console.log(`API calls made: ${apiCalls.length}`);
    for (const call of apiCalls) console.log(`  ${call}`);

    expect(apiErrors.length, `API errors: ${apiErrors.join(', ')}`).toBe(0);
    expect(media, 'Audio/video element with src should appear').toBeTruthy();
  });

  test('media is playing', async () => {
    await sharedPage.waitForTimeout(3000);

    const mediaState = await sharedPage.evaluate(() => {
      const el = document.querySelector('audio[src], video[src]');
      if (!el) return null;
      return {
        tag: el.tagName,
        currentTime: el.currentTime,
        paused: el.paused,
        readyState: el.readyState,
        src: (el.src || el.currentSrc || '').substring(0, 100),
        duration: el.duration,
      };
    });

    console.log('Media state:', JSON.stringify(mediaState, null, 2));
    expect(mediaState, 'Media element should exist').not.toBeNull();
    expect(mediaState.readyState, 'Media should have loaded data').toBeGreaterThan(0);
    expect(mediaState.paused, 'Media should not be paused').toBe(false);
  });

  test('text content is visible (readalong scroller)', async () => {
    const textContent = await sharedPage.evaluate(() => {
      const allEls = document.querySelectorAll('p, h4, [class*="verse"]');
      const texts = [];
      for (const el of allEls) {
        const text = el.textContent?.trim();
        if (text && text.length > 20 && el.offsetParent !== null) {
          texts.push(text.substring(0, 120));
        }
      }
      return texts;
    });

    console.log(`Found ${textContent.length} text blocks`);
    if (textContent.length > 0) console.log('First:', textContent[0]);
    expect(textContent.length, 'Should have visible text paragraphs').toBeGreaterThan(0);
  });

  test('playhead advances over 5 seconds', async () => {
    const time1 = await sharedPage.evaluate(() => {
      const el = document.querySelector('audio[src], video[src]');
      return el?.currentTime ?? null;
    });
    expect(time1, 'Media should exist').not.toBeNull();

    await sharedPage.waitForTimeout(5000);

    const time2 = await sharedPage.evaluate(() => {
      const el = document.querySelector('audio[src], video[src]');
      return el?.currentTime ?? null;
    });
    console.log(`Playhead: ${time1.toFixed(1)}s → ${time2.toFixed(1)}s (Δ${(time2 - time1).toFixed(1)}s)`);
    expect(time2 - time1, 'Playhead should advance at least 3s in 5s window').toBeGreaterThanOrEqual(3);
  });

  test('video renders with talk layout (video + text panel)', async () => {
    // Talks render video on left with text on right (split layout)
    const layout = await sharedPage.evaluate(() => {
      const video = document.querySelector('video');
      const textpanel = document.querySelector('.textpanel');
      const scroller = document.querySelector('.content-scroller');
      return {
        hasVideo: !!video,
        hasTextPanel: !!textpanel,
        scrollerClasses: scroller?.className || '',
        videoWidth: video?.getBoundingClientRect()?.width || 0,
        panelWidth: textpanel?.getBoundingClientRect()?.width || 0,
      };
    });

    console.log('Layout:', JSON.stringify(layout));
    expect(layout.hasVideo, 'Should render <video> element for talks').toBe(true);
    expect(layout.hasTextPanel, 'Should have text panel alongside video').toBe(true);
    expect(layout.scrollerClasses, 'CSS class should contain "talk"').toContain('talk');
    expect(layout.videoWidth, 'Video should have non-zero width').toBeGreaterThan(0);
    expect(layout.panelWidth, 'Text panel should have non-zero width').toBeGreaterThan(0);
  });
});
