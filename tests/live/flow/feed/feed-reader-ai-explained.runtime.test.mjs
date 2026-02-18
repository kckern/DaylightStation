// tests/live/flow/feed/feed-reader-ai-explained.runtime.test.mjs
import { test, expect } from '@playwright/test';

test('open reader, expand Tech, filter AI Explained, count articles', async ({ page }) => {
  await page.goto('/feed/reader', { waitUntil: 'networkidle', timeout: 30000 });
  await expect(page.locator('.article-row').first()).toBeVisible({ timeout: 10000 });

  const totalBefore = await page.locator('.article-row').count();
  console.log('Total articles before filter:', totalBefore);

  // Find and expand the Tech category
  const categoryHeaders = page.locator('.reader-category-header');
  const catCount = await categoryHeaders.count();
  let techHeader = null;
  for (let i = 0; i < catCount; i++) {
    const text = await categoryHeaders.nth(i).textContent();
    if (text.trim().replace(/^▾\s*/, '').startsWith('Tech')) {
      techHeader = categoryHeaders.nth(i);
      console.log(`Found Tech category: "${text.trim()}"`);
      break;
    }
  }
  expect(techHeader, 'Tech category should exist in sidebar').not.toBeNull();
  // Click the arrow to expand (label now filters by category)
  await techHeader.locator('.reader-category-arrow').click();

  // Find AI Explained feed item
  const feedItems = page.locator('.reader-feed-item');
  await page.waitForTimeout(300);
  let aiBtn = null;
  const feedCount = await feedItems.count();
  for (let i = 0; i < feedCount; i++) {
    const text = await feedItems.nth(i).textContent();
    if (text.trim().toLowerCase().includes('ai explained')) {
      aiBtn = feedItems.nth(i);
      break;
    }
  }
  expect(aiBtn, '"AI Explained" feed should exist in Tech category').not.toBeNull();

  // Click to filter
  const streamResp = page.waitForResponse(
    r => r.url().includes('/reader/stream') && r.status() === 200,
    { timeout: 10000 }
  );
  await aiBtn.click();
  await expect(aiBtn).toHaveClass(/active/);
  await streamResp;
  await page.waitForTimeout(500);

  const filteredCount = await page.locator('.article-row').count();
  console.log(`Articles from AI Explained: ${filteredCount}`);
  expect(filteredCount, 'Filtered feed should have articles from backlog').toBeGreaterThan(0);

  // Log article titles
  const titles = page.locator('.article-title');
  for (let i = 0; i < Math.min(filteredCount, 5); i++) {
    const t = await titles.nth(i).textContent();
    console.log(`  ${i + 1}. ${t}`);
  }
  if (filteredCount > 5) console.log(`  ... and ${filteredCount - 5} more`);

  // Adaptive grouping: sparse feed should use week or month groups, not daily
  const groupHeaders = page.locator('.reader-day-header');
  const groupCount = await groupHeaders.count();
  console.log(`\nGroup headers: ${groupCount}`);
  for (let i = 0; i < groupCount; i++) {
    const label = await groupHeaders.nth(i).textContent();
    const count = await groupHeaders.nth(i).locator('..').locator('.article-row').count();
    console.log(`  "${label}" — ${count} articles`);
  }

  // Sparse feed (15 articles across ~15 different days) should NOT have 15 day groups
  // Adaptive grouping should consolidate into fewer groups (weeks or months)
  expect(groupCount, 'Sparse feed should use coarser grouping').toBeLessThan(filteredCount);

  // Should show "End of Available Articles" since this feed is exhausted
  const endIndicator = page.locator('.reader-end');
  await expect(endIndicator).toBeVisible({ timeout: 3000 });
  const endText = await endIndicator.textContent();
  console.log(`\nEnd indicator: "${endText}"`);
});
