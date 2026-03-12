# Feed Playback contentId Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix broken audio/video playback in the feed by passing `contentId` through the play callback chain, with a Playwright test that proves the fix on prod (localhost:3111).

**Architecture:** `PlayerSection` has `data.contentId` but only passes `item` to `onPlay()`. The fix threads `contentId` through `PlayerSection → Scroll.handlePlay → FeedPlayerContext.play`, so `PersistentPlayer` receives a truthy `contentId` and mounts the Player component.

**Tech Stack:** React (JSX), Playwright (test)

**Audit:** `docs/_wip/audits/2026-03-12-feed-session-image-playback-audit.md`

---

### Task 1: Write the Failing Playwright Test

**Files:**
- Create: `tests/live/flow/feed/feed-detail-playback.runtime.test.mjs`

**Step 1: Write the test**

This test navigates to a Plex-filtered feed, clicks into a detail view, hits the player section's Play button, and asserts that PersistentPlayer mounts (an `<audio>` or `<video>` element exists in the DOM). It is designed to **fail before the fix** (playerRef stays null, no media element) and **pass after**.

```javascript
// tests/live/flow/feed/feed-detail-playback.runtime.test.mjs
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Feed Detail – Player section playback', () => {

  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/v1/feed/scroll`);
    expect(res.ok(), 'Feed scroll API should be healthy').toBe(true);
  });

  test('clicking Play in a detail player section mounts a media element', async ({ page }) => {
    // Capture player-related console output for diagnostics
    const playerLogs = [];
    page.on('console', msg => {
      const text = msg.text();
      if (/player|contentId|PersistentPlayer|mount/i.test(text)) {
        playerLogs.push(`[${msg.type()}] ${text.slice(0, 200)}`);
      }
    });

    // Load feed filtered to plex (guarantees playable items with player sections)
    await page.goto('/feed/scroll?filter=plex', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('.scroll-item-wrapper').first()).toBeVisible({ timeout: 15000 });

    // Click the first feed card to open detail view
    const firstCard = page.locator('.feed-card').first();
    await firstCard.click();

    // Wait for detail view with sections loaded
    const detail = page.locator('.detail-view');
    await expect(detail, 'Detail view should open').toBeVisible({ timeout: 10000 });
    await expect(
      detail.locator('.detail-section').first(),
      'Detail sections should load'
    ).toBeVisible({ timeout: 10000 });

    // Find the Play button inside a player section (PlayerSection renders button[aria-label="Play"])
    const detailPlayBtn = detail.locator('.detail-section button[aria-label="Play"]').first();
    await expect(
      detailPlayBtn,
      'Plex detail should have a player section with a Play button'
    ).toBeVisible({ timeout: 5000 });

    // Click Play in the detail player section
    await detailPlayBtn.click();

    // CRITICAL ASSERTION: PersistentPlayer should mount a media element.
    // Before the fix, contentId is undefined → PersistentPlayer returns null → no media element.
    // After the fix, contentId flows through → Player mounts → audio/video element exists.
    await expect(async () => {
      const mediaCount = await page.evaluate(() =>
        document.querySelectorAll('audio, video').length
      );
      expect(mediaCount, 'PersistentPlayer should mount a media element (audio or video)').toBeGreaterThan(0);
    }).toPass({ timeout: 15000 });

    // Bonus: the mini bar should appear (proves activeMedia has real contentId)
    const miniBar = page.locator('.feed-mini-bar');
    await expect(miniBar, 'Mini bar should appear after play').toBeVisible({ timeout: 5000 });

    if (playerLogs.length > 0) {
      console.log('Player logs:', playerLogs.join('\n'));
    }

    console.log('Detail player section playback verified');
  });
});
```

**Step 2: Run the test against prod (localhost:3111) to verify it fails**

Run:
```bash
BASE_URL=http://localhost:3111 npx playwright test tests/live/flow/feed/feed-detail-playback.runtime.test.mjs --reporter=line
```

Expected: FAIL — `PersistentPlayer should mount a media element` assertion fails because `contentId` is undefined and PersistentPlayer returns null.

---

### Task 2: Fix PlayerSection to Pass contentId

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/detail/sections/PlayerSection.jsx:15`

**Step 1: Thread contentId through the onPlay callback**

At line 15, change:
```jsx
onPlay?.(item);
```
to:
```jsx
onPlay?.(item, data.contentId);
```

At line 86, the stop button calls `onPlay?.(null)` — this is correct as-is (no contentId needed for stop).

**Step 2: Verify no syntax errors**

Run:
```bash
node -e "import('./frontend/src/modules/Feed/Scroll/detail/sections/PlayerSection.jsx')" 2>&1 || echo "Syntax check via build"
npx vite build --mode development 2>&1 | tail -5
```

---

### Task 3: Fix Scroll.handlePlay to Forward contentId

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx:137-141`

**Step 1: Update handlePlay signature and forwarding**

Change:
```jsx
const handlePlay = useCallback((item) => {
  if (!item) { feedLog.player('clear activeMedia'); contextStop(); return; }
  feedLog.player('play', { id: item.id, title: item.title, source: item.source });
  contextPlay(item);
}, [contextPlay, contextStop]);
```
to:
```jsx
const handlePlay = useCallback((item, contentId) => {
  if (!item) { feedLog.player('clear activeMedia'); contextStop(); return; }
  feedLog.player('play', { id: item.id, title: item.title, source: item.source, contentId });
  contextPlay(item, contentId);
}, [contextPlay, contextStop]);
```

**Step 2: Verify the build succeeds**

Run:
```bash
npx vite build --mode development 2>&1 | tail -5
```

Expected: Build succeeds with no errors.

---

### Task 4: Run Test to Verify Fix

**Step 1: Run the Playwright test against prod (localhost:3111)**

Run:
```bash
BASE_URL=http://localhost:3111 npx playwright test tests/live/flow/feed/feed-detail-playback.runtime.test.mjs --reporter=line
```

Expected: PASS — PersistentPlayer mounts, media element exists, mini bar appears.

**Step 2: Run the existing minibar playback test to confirm no regressions**

Run:
```bash
BASE_URL=http://localhost:3111 npx playwright test tests/live/flow/feed/feed-minibar-playback.runtime.test.mjs --reporter=line
```

Expected: PASS (this test clicks the card-level play button, which goes through a different path — verify it still works).

---

### Task 5: Commit

**Step 1: Stage and commit**

```bash
git add \
  frontend/src/modules/Feed/Scroll/detail/sections/PlayerSection.jsx \
  frontend/src/modules/Feed/Scroll/Scroll.jsx \
  tests/live/flow/feed/feed-detail-playback.runtime.test.mjs

git commit -m "$(cat <<'EOF'
fix(feed): pass contentId through play callback chain

PlayerSection had data.contentId but only passed `item` to onPlay(),
dropping contentId. This meant FeedPlayerContext received
contentId=undefined, PersistentPlayer never mounted, and all
audio/video playback from detail view was broken.

Thread contentId through PlayerSection → Scroll.handlePlay →
FeedPlayerContext.play so PersistentPlayer gets a truthy contentId
and mounts the Player component.

Add Playwright test that asserts a media element mounts after
clicking Play in a detail player section.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```
