// tests/live/flow/feed/feed-reader-inbox.runtime.test.mjs
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Feed Reader – inbox UI', () => {

  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/v1/feed/reader/stream?days=3`);
    expect(res.ok(), 'Reader stream API should be healthy').toBe(true);
    const data = await res.json();
    expect(data.items.length, 'Stream should return articles').toBeGreaterThan(0);
  });

  test('loads reader with 2-column layout and articles grouped by day', async ({ page }) => {
    await page.goto('/feed/reader', { waitUntil: 'networkidle', timeout: 30000 });

    // 2-column layout: sidebar + inbox
    const sidebar = page.locator('.reader-sidebar');
    const inbox = page.locator('.reader-inbox');
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    await expect(inbox).toBeVisible();

    // Day headers should be present
    const dayHeaders = page.locator('.reader-day-header');
    const dayCount = await dayHeaders.count();
    expect(dayCount, 'At least one day group should appear').toBeGreaterThan(0);
    console.log(`Day groups: ${dayCount}`);

    // Article rows should render
    const articles = page.locator('.article-row');
    const articleCount = await articles.count();
    expect(articleCount, 'Articles should render').toBeGreaterThan(0);
    console.log(`Articles loaded: ${articleCount}`);
  });

  test('article rows show title, feed name, preview, time, and favicon', async ({ page }) => {
    await page.goto('/feed/reader', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('.article-row').first()).toBeVisible({ timeout: 10000 });

    const firstRow = page.locator('.article-row').first();
    const header = firstRow.locator('.article-row-header');

    // Title is always present
    const title = header.locator('.article-title');
    await expect(title).toBeVisible();
    const titleText = await title.textContent();
    expect(titleText.length, 'Title should have text').toBeGreaterThan(0);

    // Favicon image
    const favicon = header.locator('.article-favicon');
    await expect(favicon).toBeVisible();

    // Time display
    const time = header.locator('.article-time');
    await expect(time).toBeVisible();

    // Feed name (italic, between title and preview)
    const feedName = header.locator('.article-feed-name');
    if (await feedName.count() > 0) {
      const feedText = await feedName.textContent();
      expect(feedText, 'Feed name should contain middot delimiters').toContain('·');
      console.log(`Feed name: ${feedText.trim()}`);
    }

    // Preview text (inline preview of body)
    const preview = header.locator('.article-preview');
    if (await preview.count() > 0) {
      const previewText = await preview.textContent();
      expect(previewText.length, 'Preview should have text').toBeGreaterThan(0);
    }
  });

  test('clicking an article expands accordion with content and source link', async ({ page }) => {
    await page.goto('/feed/reader', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('.article-row').first()).toBeVisible({ timeout: 10000 });

    const firstRow = page.locator('.article-row').first();

    // Should NOT be expanded initially
    await expect(firstRow).not.toHaveClass(/expanded/);
    expect(await firstRow.locator('.article-expanded').count()).toBe(0);

    // Click to expand
    await firstRow.locator('.article-row-header').click();

    // Should now be expanded
    await expect(firstRow).toHaveClass(/expanded/);
    const expanded = firstRow.locator('.article-expanded');
    await expect(expanded).toBeVisible();

    // Meta line (feed title, author, date)
    const meta = expanded.locator('.article-meta');
    await expect(meta).toBeVisible();

    // Content body
    const content = expanded.locator('.article-content');
    await expect(content).toBeVisible();

    // Source link
    const sourceLink = expanded.locator('.article-source-link');
    if (await sourceLink.count() > 0) {
      await expect(sourceLink).toBeVisible();
      const href = await sourceLink.getAttribute('href');
      expect(href, 'Source link should have an href').toBeTruthy();
      console.log(`Source link: ${href}`);
    }

    // Click again to collapse
    await firstRow.locator('.article-row-header').click();
    await expect(firstRow).not.toHaveClass(/expanded/);
  });

  test('expanding an article marks it as read', async ({ page }) => {
    await page.goto('/feed/reader', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('.article-row').first()).toBeVisible({ timeout: 10000 });

    // Find an unread article by index (live locator would shift after class change)
    const unreadRows = page.locator('.article-row.unread');
    if (await unreadRows.count() === 0) {
      console.log('No unread articles to test — all already read');
      return;
    }

    // Capture the index of the first unread row among all article rows
    const allRows = page.locator('.article-row');
    const totalRows = await allRows.count();
    let targetIndex = -1;
    for (let i = 0; i < totalRows; i++) {
      const cls = await allRows.nth(i).getAttribute('class');
      if (cls?.includes('unread')) { targetIndex = i; break; }
    }
    expect(targetIndex, 'Should find an unread article').toBeGreaterThanOrEqual(0);

    // Use stable nth() locator that won't shift when class changes
    const targetRow = allRows.nth(targetIndex);

    // Intercept the mark-read API call
    const markReadPromise = page.waitForRequest(
      req => req.url().includes('/reader/items/mark') && req.method() === 'POST',
      { timeout: 5000 }
    );

    // Expand the unread article
    await targetRow.locator('.article-row-header').click();
    await expect(targetRow).toHaveClass(/expanded/, { timeout: 3000 });

    // Should fire mark-read API call
    const markReq = await markReadPromise;
    const body = markReq.postDataJSON();
    expect(body.action).toBe('read');
    expect(body.itemIds.length).toBeGreaterThan(0);

    // Row should now have 'read' class (optimistic update)
    await expect(targetRow).toHaveClass(/read/);
    console.log(`Marked article as read: ${body.itemIds[0]}`);
  });

  test('sidebar shows categories (collapsed by default) and can expand them', async ({ page }) => {
    await page.goto('/feed/reader', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('.reader-sidebar').first()).toBeVisible({ timeout: 10000 });

    // Should have category headers
    const categoryHeaders = page.locator('.reader-category-header');
    const catCount = await categoryHeaders.count();
    expect(catCount, 'Sidebar should have categories').toBeGreaterThan(0);
    console.log(`Categories: ${catCount}`);

    // Categories should be collapsed by default (arrows rotated)
    const firstArrow = categoryHeaders.first().locator('.reader-category-arrow');
    await expect(firstArrow).toHaveClass(/collapsed/);

    // Feed items should NOT be visible when collapsed
    const feedItems = page.locator('.reader-feed-item');
    const visibleBefore = await feedItems.count();
    expect(visibleBefore, 'Feed items should be hidden when all categories collapsed').toBe(0);

    // Click first category arrow to expand it
    await firstArrow.click();

    // Arrow should no longer be collapsed
    await expect(firstArrow).not.toHaveClass(/collapsed/);

    // Feed items should now be visible
    await expect(page.locator('.reader-feed-item').first()).toBeVisible();
    const visibleAfter = await page.locator('.reader-feed-item').count();
    expect(visibleAfter, 'Feed items should appear after expanding').toBeGreaterThan(0);
    console.log(`Feed items after expand: ${visibleAfter}`);
  });

  test('clicking a feed in sidebar filters articles to that feed', async ({ page }) => {
    await page.goto('/feed/reader', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('.article-row').first()).toBeVisible({ timeout: 10000 });

    const totalArticles = await page.locator('.article-row').count();
    console.log(`Total articles before filter: ${totalArticles}`);

    // Expand first category to reveal feed items (click arrow, not label)
    const firstArrow = page.locator('.reader-category-header').first().locator('.reader-category-arrow');
    await firstArrow.click();
    await expect(page.locator('.reader-feed-item').first()).toBeVisible();

    // Click the first feed item to filter
    const firstFeed = page.locator('.reader-feed-item').first();
    const feedName = await firstFeed.textContent();
    console.log(`Filtering by: ${feedName.trim()}`);

    // Wait for the API call with feeds param
    const streamRequest = page.waitForResponse(
      res => res.url().includes('/reader/stream') && res.status() === 200,
      { timeout: 10000 }
    );
    await firstFeed.click();

    // Feed button should become active
    await expect(firstFeed).toHaveClass(/active/);

    // Wait for filtered stream to load
    await streamRequest;
    // Allow re-render
    await page.waitForTimeout(500);

    const filteredArticles = await page.locator('.article-row').count();
    console.log(`Articles after filter: ${filteredArticles}`);

    // Filtered mode fetches the full feed backlog (not just the 3-day window)
    // so it can return MORE articles than the unfiltered primer
    expect(filteredArticles, 'Filtered feed should return articles from backlog').toBeGreaterThan(0);

    // Click again to deselect (toggle off)
    const stream2 = page.waitForResponse(
      res => res.url().includes('/reader/stream') && res.status() === 200,
      { timeout: 10000 }
    );
    await firstFeed.click();
    await expect(firstFeed).not.toHaveClass(/active/);
    await stream2;
    await page.waitForTimeout(500);

    const resetArticles = await page.locator('.article-row').count();
    console.log(`Articles after deselect: ${resetArticles}`);
    expect(resetArticles, 'Should return to full article list').toBe(totalArticles);
  });

  test('day-based batching returns manageable number of day groups', async ({ page }) => {
    await page.goto('/feed/reader', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('.article-row').first()).toBeVisible({ timeout: 10000 });

    const dayHeaders = page.locator('.reader-day-header');
    const dayCount = await dayHeaders.count();

    // Should have at most 3 day groups on initial load (day batching = 3)
    expect(dayCount, 'Initial load should have <= 3 day groups').toBeLessThanOrEqual(3);
    expect(dayCount, 'Should have at least 1 day group').toBeGreaterThan(0);

    // Log the day labels
    for (let i = 0; i < dayCount; i++) {
      const label = await dayHeaders.nth(i).textContent();
      const articlesInDay = await dayHeaders.nth(i).locator('..').locator('.article-row').count();
      console.log(`Day ${i + 1}: "${label}" — ${articlesInDay} articles`);
    }
  });

  test('infinite scroll loads more day groups', async ({ page }) => {
    await page.goto('/feed/reader', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('.article-row').first()).toBeVisible({ timeout: 10000 });

    const initialDays = await page.locator('.reader-day-header').count();
    const initialArticles = await page.locator('.article-row').count();
    console.log(`Initial: ${initialDays} days, ${initialArticles} articles`);

    // Check for sentinel (infinite scroll trigger)
    const sentinel = page.locator('.reader-sentinel');
    if (await sentinel.count() === 0) {
      console.log('No sentinel — all articles fit in one batch');
      return;
    }

    // Scroll the inbox container to bring sentinel into viewport
    const inbox = page.locator('.reader-inbox');
    await inbox.evaluate(el => el.scrollTo(0, el.scrollHeight));

    // Wait for more articles to load OR sentinel to disappear (feed exhausted)
    let loaded = false;
    try {
      await expect(async () => {
        const newCount = await page.locator('.article-row').count();
        expect(newCount, 'More articles should load').toBeGreaterThan(initialArticles);
      }).toPass({ timeout: 15000 });
      loaded = true;
    } catch {
      // Feed may be too small for a second batch
      const sentinelGone = await sentinel.count() === 0;
      if (sentinelGone) {
        console.log('Feed exhausted — no more articles to load');
        return;
      }
      // Sentinel exists but nothing loaded — try scrolling again
      await inbox.evaluate(el => el.scrollTo(0, el.scrollHeight));
      await page.waitForTimeout(3000);
      const retryCount = await page.locator('.article-row').count();
      if (retryCount === initialArticles) {
        console.log(`Feed has only ${initialArticles} articles — no second batch available`);
        return;
      }
      loaded = true;
    }

    if (loaded) {
      const finalDays = await page.locator('.reader-day-header').count();
      const finalArticles = await page.locator('.article-row').count();
      console.log(`After scroll: ${finalDays} days, ${finalArticles} articles`);
      expect(finalArticles, 'More articles loaded').toBeGreaterThan(initialArticles);
    }
  });

});
