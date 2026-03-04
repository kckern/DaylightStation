// tests/live/flow/feed/feed-reader-youtube-render.runtime.test.mjs
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Feed Reader – YouTube rendering path', () => {

  let upwardThoughtArticle;

  test.beforeAll(async ({ request }) => {
    // Fetch stream and find the Upward Thought article
    const res = await request.get(`${BACKEND_URL}/api/v1/feed/reader/stream?days=3&count=100`);
    expect(res.ok(), 'Reader stream API should be healthy').toBe(true);
    const data = await res.json();
    upwardThoughtArticle = data.items.find(
      i => i.feedTitle === 'Upward Thought' || i.author === 'upwardthought'
    );
    expect(upwardThoughtArticle, 'Should find an Upward Thought article in stream').toBeTruthy();
    console.log(`Found: "${upwardThoughtArticle.title}" (contentType=${upwardThoughtArticle.contentType}, videoId=${upwardThoughtArticle.meta?.videoId})`);
  });

  test('opening Upward Thought short renders via RemuxPlayer or iframe', async ({ page }) => {
    // Track network calls to the detail endpoint
    const detailRequests = [];
    page.on('request', req => {
      if (req.url().includes('/feed/detail/')) detailRequests.push(req.url());
    });
    const detailResponses = [];
    page.on('response', async res => {
      if (res.url().includes('/feed/detail/')) {
        try {
          const json = await res.json();
          detailResponses.push({ url: res.url(), status: res.status(), body: json });
        } catch { detailResponses.push({ url: res.url(), status: res.status() }); }
      }
    });

    await page.goto('/feed/reader', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('.article-row').first()).toBeVisible({ timeout: 10000 });

    // Find the Upward Thought row by title text
    const rows = page.locator('.article-row');
    const count = await rows.count();
    let targetIndex = -1;
    for (let i = 0; i < count; i++) {
      const title = await rows.nth(i).locator('.article-title').textContent();
      if (title.includes(upwardThoughtArticle.title.substring(0, 30))) {
        targetIndex = i;
        break;
      }
    }

    if (targetIndex === -1) {
      // Might need to scroll to find it
      console.log('Upward Thought article not in initial viewport, scrolling...');
      const inbox = page.locator('.reader-inbox');
      for (let attempt = 0; attempt < 5; attempt++) {
        await inbox.evaluate(el => el.scrollTo(0, el.scrollHeight));
        await page.waitForTimeout(2000);
        const newCount = await rows.count();
        for (let i = 0; i < newCount; i++) {
          const title = await rows.nth(i).locator('.article-title').textContent();
          if (title.includes(upwardThoughtArticle.title.substring(0, 30))) {
            targetIndex = i;
            break;
          }
        }
        if (targetIndex !== -1) break;
      }
    }

    expect(targetIndex, 'Should find Upward Thought row in reader').toBeGreaterThanOrEqual(0);
    console.log(`Found Upward Thought at row index ${targetIndex}`);

    const targetRow = rows.nth(targetIndex);

    // Click to expand
    await targetRow.locator('.article-row-header').click();
    await expect(targetRow).toHaveClass(/expanded/, { timeout: 5000 });
    console.log('Article expanded');

    // Wait for the detail API call to complete
    await page.waitForTimeout(5000);

    // Log what detail endpoint returned
    console.log(`Detail requests made: ${detailRequests.length}`);
    for (const dr of detailResponses) {
      console.log(`Detail response: ${dr.url} (${dr.status})`);
      if (dr.body) {
        const sections = dr.body.sections || [];
        for (const s of sections) {
          console.log(`  Section type=${s.type}, provider=${s.data?.provider || 'n/a'}`);
          if (s.data?.videoUrl) console.log(`  → videoUrl present (split/RemuxPlayer path)`);
          if (s.data?.url && !s.data?.videoUrl) console.log(`  → single url present (combined stream path)`);
          if (s.data?.embedFallback) console.log(`  → embedFallback: ${s.data.embedFallback}`);
          if (s.type === 'embed') console.log(`  → EMBED ONLY (Piped failed, iframe fallback)`);
        }
      }
    }

    // Check what actually rendered
    const expanded = targetRow.locator('.article-expanded');

    // Check for RemuxPlayer: has a muted <video> + hidden <audio>
    const remuxVideo = expanded.locator('video[muted]');
    const remuxAudio = expanded.locator('audio');
    const hasRemux = (await remuxVideo.count()) > 0 && (await remuxAudio.count()) > 0;

    // Check for combined <video> (single src, not muted)
    const combinedVideo = expanded.locator('video:not([muted])');
    const hasCombined = (await combinedVideo.count()) > 0;

    // Check for FeedPlayer wrapper (covers both remux and combined)
    const feedPlayer = expanded.locator('.feed-player');
    const hasFeedPlayer = (await feedPlayer.count()) > 0;

    // Check for YouTube iframe embed
    const iframe = expanded.locator('iframe.youtube-embed, iframe[src*="youtube.com/embed"]');
    const hasIframe = (await iframe.count()) > 0;

    // Check for loading dots (still fetching)
    const loadingDots = expanded.locator('.scroll-loading-dots');
    const isLoading = (await loadingDots.count()) > 0;

    console.log('\n=== RENDER RESULT ===');
    console.log(`FeedPlayer wrapper: ${hasFeedPlayer}`);
    console.log(`RemuxPlayer (video+audio): ${hasRemux}`);
    console.log(`Combined video (single stream): ${hasCombined}`);
    console.log(`YouTube iframe embed: ${hasIframe}`);
    console.log(`Still loading: ${isLoading}`);

    if (hasRemux) {
      const videoSrc = await remuxVideo.getAttribute('src');
      const audioSrc = await remuxAudio.getAttribute('src');
      console.log(`\nRemuxPlayer video src: ${videoSrc?.substring(0, 80)}...`);
      console.log(`RemuxPlayer audio src: ${audioSrc?.substring(0, 80)}...`);
    }
    if (hasCombined) {
      const src = await combinedVideo.getAttribute('src');
      console.log(`\nCombined video src: ${src?.substring(0, 80)}...`);
    }
    if (hasIframe) {
      const src = await iframe.getAttribute('src');
      console.log(`\nIframe src: ${src}`);
    }

    // At least one rendering method should be present
    expect(hasRemux || hasCombined || hasIframe || hasFeedPlayer, 'Should render video via RemuxPlayer, combined video, or iframe').toBe(true);
  });

});
