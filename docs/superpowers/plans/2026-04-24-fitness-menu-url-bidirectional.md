# /fitness/menu/:id URL Bidirectional Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Direct-loading `/fitness/menu/<id>` (or `/fitness/menu/<id1>,<id2>`) must render the requested menu instead of snapping back to the home/default screen.

**Architecture:** Two `useEffect`s in `FitnessApp.jsx` race on mount: (A) parses `urlState` and sets component state (`setActiveCollection`, `setCurrentView`, `setUrlInitialized(true)`); (B) auto-defaults to the first screen if nothing is selected. Effect B's early-return guard at line 1038 depends on `urlInitialized`, which is `false` during the first effect pass — so it reads the stale initial state (`activeCollection == null`), hits the auto-default branch, and calls `navigate('/fitness/${screenIds[0]}')`, overwriting the user's URL. Fix: make the guard read `urlState` directly instead of gating on `urlInitialized`.

**Tech Stack:** React, React Router, Playwright.

---

### Task 1: Playwright regression test (reproduce the bug)

**Files:**
- Create: `tests/live/flow/fitness/menu-url-direct-load.runtime.test.mjs`

- [ ] **Step 1: Write failing test**

```js
// tests/live/flow/fitness/menu-url-direct-load.runtime.test.mjs
import { test, expect } from '@playwright/test';

test.describe('Direct-load /fitness/menu/:id', () => {
  test('single id: URL must NOT snap back to a screen/home', async ({ page }) => {
    await page.goto('/fitness/menu/674571'); // Short Episodes playlist
    await page.waitForSelector('.fitness-app-container', { timeout: 15000 });
    await page.waitForTimeout(2000); // let any auto-navigation finish firing

    const finalUrl = page.url();
    expect(finalUrl).toContain('/fitness/menu/674571');
    expect(finalUrl).not.toMatch(/\/fitness\/(home|plugin|users)(\/|$|\?)/);
  });

  test('comma-separated ids: URL preserved, menu content rendered', async ({ page }) => {
    await page.goto('/fitness/menu/674570,674571');
    await page.waitForSelector('.fitness-app-container', { timeout: 15000 });
    await page.waitForTimeout(2000);

    expect(page.url()).toContain('/fitness/menu/674570,674571');
  });
});
```

- [ ] **Step 2: Run to confirm failure (bug still present)**

Run: `npx playwright test tests/live/flow/fitness/menu-url-direct-load.runtime.test.mjs --reporter=line`
Expected: FAIL — `finalUrl` contains `/fitness/home` or similar.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/live/flow/fitness/menu-url-direct-load.runtime.test.mjs
git commit -m "test(fitness): add failing repro for /fitness/menu/:id snap-back"
```

---

### Task 2: Fix the auto-default guard

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx:1037-1040`

- [ ] **Step 1: Change the guard in the auto-default useEffect**

Replace:

```js
    // Don't auto-navigate if URL already set up the initial state
    if (urlInitialized && (urlState.view !== 'menu' || urlState.id || urlState.ids)) {
      return;
    }
```

With:

```js
    // Don't auto-navigate if the URL wants something specific. Check urlState
    // directly — `urlInitialized` is false during the first effect pass on
    // mount, so gating on it caused the auto-default to race Effect A and
    // overwrite the URL (GitHub issue: /fitness/menu/:id snap-back).
    if (urlState.view !== 'menu' || urlState.id || urlState.ids) {
      return;
    }
```

- [ ] **Step 2: Run the repro test — expect PASS**

Run: `npx playwright test tests/live/flow/fitness/menu-url-direct-load.runtime.test.mjs --reporter=line`
Expected: both tests PASS.

- [ ] **Step 3: Run the other fitness URL tests — expect no regressions**

Run: `npx playwright test tests/live/flow/fitness/fitness-url-routing.runtime.test.mjs tests/live/flow/fitness/playlist-sort-order.runtime.test.mjs --reporter=line`
Expected: all PASS.

- [ ] **Step 4: Commit the fix**

```bash
git add frontend/src/Apps/FitnessApp.jsx
git commit -m "fix(fitness): stop /fitness/menu/:id from snapping to home

The auto-default useEffect gated on urlInitialized (false on first mount),
so it ran with stale closure state (activeCollection == null) and called
navigate() to the first screen before Effect A committed its URL-derived
state. Gate on urlState.view/id/ids directly instead."
```

---

### Task 3: Build, deploy, verify

- [ ] **Step 1: Docker build**

```bash
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  .
```

- [ ] **Step 2: Deploy**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

- [ ] **Step 3: Wait for API + confirm fix live**

```bash
until curl -sf -m 2 http://localhost:3111/api/v1/fitness/show/674570/playable > /dev/null; do sleep 2; done
npx playwright test tests/live/flow/fitness/menu-url-direct-load.runtime.test.mjs --reporter=line
```
Expected: both tests PASS against the live container.

- [ ] **Step 4: Push deploy tag if desired (user discretion)** — no action.
