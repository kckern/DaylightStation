# Skeleton Loader Sizing Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix skeleton-to-hydrated layout shift across all office screen widgets so skeleton loaders occupy the same space as hydrated content.

**Architecture:** Each widget's skeleton must match its hydrated state's flex participation. The root cause is that skeletons use hardcoded pixel dimensions while hydrated content uses flex-grow to fill containers. Fix each widget individually — the framework `flexGrow: 1` default is intentional and correct; the widgets just need to respect it in both states.

**Tech Stack:** React, SCSS, Highcharts, Playwright

**Audit:** `docs/_wip/audits/2026-04-17-skeleton-loader-sizing-discrepancy-audit.md`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `frontend/src/modules/Health/Weight.jsx` | Modify | Fix skeleton chart area to flex-grow instead of fixed 160px |
| `frontend/src/modules/Health/Weight.scss` | Modify | Add skeleton chart wrapper rule for negative margins |
| `frontend/src/modules/Finance/Finance.jsx` | Modify | Fix skeleton to match table+chart structure |
| `frontend/src/modules/Finance/Finance.scss` | Modify | Add root `.finance` flex layout |
| `frontend/src/modules/Upcoming/Upcoming.jsx` | Modify | Fix skeleton list item heights to match hydrated |
| `frontend/src/modules/Entropy/EntropyPanel.jsx` | Modify | Use dynamic column count constant |
| `tests/live/flow/screen/office-skeleton-sizing.runtime.test.mjs` | Create | Playwright test comparing skeleton vs hydrated sizing |

---

### Task 1: Fix Weight widget skeleton sizing

**Files:**
- Modify: `frontend/src/modules/Health/Weight.jsx:34-55`
- Modify: `frontend/src/modules/Health/Weight.scss`

The Weight skeleton uses a hardcoded `height: 160px` div for the chart area. The hydrated state uses `flex-grow: 1` on `.weight > div` (Weight.scss:31-36), which also has `margin-bottom: -2rem; margin-right: -1.5rem`. The skeleton doesn't participate in flex or apply those margins.

- [ ] **Step 1: Fix the skeleton chart area in Weight.jsx**

Replace the hardcoded height div with a flex-growing div that matches the hydrated chart wrapper's behavior. In `Weight.jsx`, replace lines 51-53:

```jsx
// BEFORE (lines 51-53):
<div style={{height: '160px', marginTop: '20px'}}>
    <div className="skeleton rect" style={{width: '100%', height: '100%'}}></div>
</div>

// AFTER:
<div>
    <div className="skeleton rect" style={{width: '100%', height: '100%'}}></div>
</div>
```

The parent `<div>` is a direct child of `.weight`, so Weight.scss's `.weight > div { flex-grow: 1; margin-bottom: -2rem; margin-right: -1.5rem; }` rule already applies — we just need to stop overriding it with inline styles.

- [ ] **Step 2: Also fix the skeleton table to use flex-grow: 0**

The skeleton table uses inline width but doesn't explicitly set `flex-grow: 0`. This is already handled by Weight.scss `.weight table { flex-grow: 0 }`, but the skeleton table lacks `borderCollapse` on the `<table>` compared to the hydrated version. Confirm the skeleton table matches the hydrated table structure:

The skeleton already has `<table style={{width: "100%", borderCollapse: "collapse"}}>` — this matches the hydrated version at line 74. No change needed here.

- [ ] **Step 3: Verify visually**

Run the dev server and navigate to `/screen/office`. Compare the Weight widget skeleton (block the API with DevTools throttling or network interception) against the hydrated state. The chart skeleton should now fill the same vertical space as the Highcharts chart.

Run: Open browser to `http://localhost:3112/screen/office`, throttle `/api/v1/lifelog/weight` in DevTools Network tab.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Health/Weight.jsx
git commit -m "fix(skeleton): Weight chart skeleton uses flex-grow instead of fixed 160px

The skeleton chart placeholder was hardcoded to 160px while the hydrated
Highcharts chart uses flex-grow: 1 via Weight.scss. Remove inline height
so the existing CSS rule applies to both states.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Fix Finance widget skeleton sizing and root layout

**Files:**
- Modify: `frontend/src/modules/Finance/Finance.jsx:87-93`
- Modify: `frontend/src/modules/Finance/Finance.scss`

Two issues: (1) The `.finance` class has no root flex layout, so the hydrated content doesn't fill its container either. (2) The skeleton is a single 240px rect, but the hydrated state is a table (~60px) plus a 240px chart — structurally different.

- [ ] **Step 1: Add root flex layout to Finance.scss**

Add `display: flex; flex-direction: column; height: 100%;` to the `.finance` class so the hydrated content fills its widget container. In `Finance.scss`, add a root rule before line 2:

```scss
// BEFORE (line 2):
.finance table{

// AFTER:
.finance {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.finance table{
```

- [ ] **Step 2: Add flex-grow to the chart wrapper**

The `.budget-block-content` div wraps the Highcharts chart. It needs `flex-grow: 1` so it fills the space below the table. Add to `Finance.scss` after the table td rule:

```scss
// After the .finance table td block (after line 24), add:

.finance .budget-block-content {
  flex-grow: 1;
  position: relative;
}
```

- [ ] **Step 3: Fix the skeleton to match the table+chart structure**

Replace the single-rect skeleton with a two-part skeleton that matches the hydrated layout. In `Finance.jsx`, replace lines 87-93:

```jsx
// BEFORE (lines 87-93):
if(!monthData || Object.keys(monthData).length === 0) {
    return (
        <div style={{width: '100%', height: '240px', position: 'relative'}}>
            <div className="skeleton rect" style={{width: '100%', height: '100%'}}></div>
        </div>
    )
}

// AFTER:
if(!monthData || Object.keys(monthData).length === 0) {
    return (
        <div className="finance">
            <table style={{width: "100%", borderCollapse: "collapse"}}>
                <thead style={{textAlign: "left"}}>
                    <tr>
                        {Array.from({length: 4}).map((_, i) => (
                            <th key={i} style={{border: "1px solid black", width: "20%", padding: "8px"}}>
                                <div className="skeleton text" style={{width: '70%', height: '0.8rem'}}></div>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        {Array.from({length: 4}).map((_, i) => (
                            <td key={i} style={{border: "1px solid black", padding: "8px"}}>
                                <div className="skeleton text" style={{width: '60%', height: '1.2rem'}}></div>
                            </td>
                        ))}
                    </tr>
                </tbody>
            </table>
            <div className="budget-block-content">
                <div className="skeleton rect" style={{width: '100%', height: '100%'}}></div>
            </div>
        </div>
    )
}
```

This skeleton now uses the same `.finance` root (with flex column layout), the same table structure (with matching styles), and a `.budget-block-content` wrapper (with `flex-grow: 1`) for the chart placeholder.

- [ ] **Step 4: Verify visually**

Run: Open browser to `http://localhost:3112/screen/office`, throttle `/api/v1/finance/data/daytoday` in DevTools Network tab. The skeleton should show a table header row + shimmer body row above a chart-area skeleton that fills the remaining vertical space.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Finance/Finance.jsx frontend/src/modules/Finance/Finance.scss
git commit -m "fix(skeleton): Finance skeleton matches hydrated table+chart structure

The Finance widget had no root flex layout (.finance class was empty) and
the skeleton was a single 240px rect vs the hydrated table+chart. Add
flex column layout to .finance root, flex-grow to .budget-block-content,
and restructure the skeleton to match the hydrated DOM.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Fix Upcoming/Calendar skeleton item sizing

**Files:**
- Modify: `frontend/src/modules/Upcoming/Upcoming.jsx:122-145`

The skeleton list items use `padding: 10px` with flex layout, but hydrated items use `height: 2.8rem; line-height: 2.8rem` from Upcoming.scss. The skeleton main panel uses `padding: 20px` while hydrated items have specific h2/h3/h4/p structure.

- [ ] **Step 1: Fix skeleton list items to match hydrated sizing**

Replace the skeleton list items to use the same `.list-panel-item` class and height. In `Upcoming.jsx`, replace lines 136-141:

```jsx
// BEFORE (lines 136-141):
{Array.from({length: 4}).map((_, i) => (
    <div key={i} className="list-panel-item skeleton-container" style={{display: 'flex', alignItems: 'center', padding: '10px'}}>
        <div className="skeleton rect" style={{width: '60px', height: '24px', borderRadius: '12px', marginRight: '10px'}}></div>
        <div className="skeleton text" style={{flex: 1, height: '1.2rem'}}></div>
    </div>
))}

// AFTER:
{Array.from({length: 4}).map((_, i) => (
    <div key={i} className="list-panel-item" style={{display: 'flex', alignItems: 'center', gap: '0.5ex'}}>
        <div className="skeleton rect" style={{width: '60px', height: '24px', borderRadius: '12px', flexShrink: 0}}></div>
        <div className="skeleton text" style={{flex: 1, height: '1.2rem'}}></div>
    </div>
))}
```

Key changes: removed `skeleton-container` (unused class), removed `padding: 10px` override (the `.list-panel-item` CSS already defines `padding: 0 0.5ex`), used `gap` instead of `marginRight`. The `.list-panel-item` class provides `height: 2.8rem; line-height: 2.8rem; flex-shrink: 0` — matching the hydrated state.

- [ ] **Step 2: Fix skeleton main panel to use realistic structure**

Replace the main panel skeleton to approximate the hydrated h2/h3/p structure. In `Upcoming.jsx`, replace lines 127-131:

```jsx
// BEFORE (lines 127-131):
<div className="main-panel-item skeleton-container" style={{padding: '20px'}}>
    <div className="skeleton text" style={{width: '40%', height: '1.5rem'}}></div>
    <div className="skeleton text" style={{width: '30%', height: '1.2rem'}}></div>
    <div className="skeleton text" style={{width: '80%', height: '3rem', marginTop: '1rem'}}></div>
</div>

// AFTER:
<div className="main-panel-item noslide">
    <h2><div className="skeleton text" style={{width: '50%', height: '1.8rem', margin: '0 auto'}}></div></h2>
    <h3><div className="skeleton text" style={{width: '40%', height: '1.5rem', margin: '0 auto'}}></div></h3>
    <p><div className="skeleton text" style={{width: '60%', height: '3rem'}}></div></p>
</div>
```

This uses the actual `main-panel-item` class (which has `display: flex; flex-direction: column`) and the real h2/h3/p elements (which have their own padding and background styles from Upcoming.scss). The `noslide` class prevents animation interference.

- [ ] **Step 3: Verify visually**

Run: Open browser to `http://localhost:3112/screen/office`, throttle `/api/v1/home/events` in DevTools Network tab. Skeleton should show the same panel proportions as hydrated content.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Upcoming/Upcoming.jsx
git commit -m "fix(skeleton): Upcoming skeleton uses real item classes and sizing

Skeleton list items now use .list-panel-item class (height: 2.8rem) instead
of padding-based sizing. Main panel skeleton uses real h2/h3/p elements
to match hydrated DOM structure and CSS rules.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Fix Entropy skeleton column count

**Files:**
- Modify: `frontend/src/modules/Entropy/EntropyPanel.jsx:27-39`

The skeleton hardcodes `gridTemplateColumns: repeat(4, 1fr)` and 12 items. The hydrated state calculates columns as `Math.ceil(Math.sqrt(numItems))`. The typical office entropy report has ~9-12 items.

- [ ] **Step 1: Read the hydrated column calculation**

First, find the column calculation in EntropyPanel.jsx to understand the hydrated logic.

Run: Read `frontend/src/modules/Entropy/EntropyPanel.jsx` fully to find the `gridTemplateColumns` calculation for the hydrated state.

- [ ] **Step 2: Use a default constant for skeleton grid**

Replace the hardcoded 4 columns / 12 items with a constant that can be referenced by both skeleton and hydrated states. In `EntropyPanel.jsx`, update the skeleton rendering:

```jsx
// BEFORE (lines 27-39):
if (loading) {
    return (
      <div className="entropy-panel">
        <div className="entropy-grid" style={{ gridTemplateColumns: `repeat(4, 1fr)` }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="entropy-item skeleton">
              <div className="item-icon" />
              <div className="item-value" />
            </div>
          ))}
        </div>
      </div>
    );
  }

// AFTER:
if (loading) {
    const defaultCols = 3;
    const defaultItems = 9;
    return (
      <div className="entropy-panel">
        <div className="entropy-grid" style={{ gridTemplateColumns: `repeat(${defaultCols}, 1fr)` }}>
          {Array.from({ length: defaultItems }).map((_, i) => (
            <div key={i} className="entropy-item skeleton">
              <div className="item-icon" />
              <div className="item-value" />
            </div>
          ))}
        </div>
      </div>
    );
  }
```

Using 3 columns / 9 items because `Math.ceil(Math.sqrt(9)) = 3`, which is the most common real data shape. This minimizes the grid column shift on hydration.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Entropy/EntropyPanel.jsx
git commit -m "fix(skeleton): Entropy skeleton uses 3x3 grid to match typical data

Hardcoded 4-column/12-item skeleton replaced with 3-column/9-item grid
that matches the most common hydrated layout (Math.ceil(Math.sqrt(9))=3).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Add Playwright test for office screen skeleton sizing

**Files:**
- Create: `tests/live/flow/screen/office-skeleton-sizing.runtime.test.mjs`

This test intercepts API calls to hold widgets in skeleton state, measures their bounding boxes, then releases APIs and measures hydrated dimensions. Asserts the ratio is within tolerance.

The existing `skeleton-episode-width.runtime.test.mjs` test uses the same API-hold pattern — we follow that approach.

- [ ] **Step 1: Create the test file**

```javascript
/**
 * Office Screen Skeleton Sizing Test
 *
 * Holds API endpoints to keep widgets in skeleton state, measures bounding boxes,
 * then releases and compares against hydrated dimensions.
 *
 * Verifies that skeleton loaders occupy roughly the same space as hydrated content
 * to prevent layout shift.
 *
 * Usage:
 *   npx playwright test tests/live/flow/screen/office-skeleton-sizing.runtime.test.mjs --headed
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

// Skeleton should be at least 80% of hydrated size (allows minor differences)
const MIN_SIZE_RATIO = 0.80;
// Skeleton should be at most 120% of hydrated size
const MAX_SIZE_RATIO = 1.20;

// Widgets to measure and the API endpoints that gate their loading
const WIDGET_CONFIGS = [
  { name: 'weight', selector: '.weight', api: '**/api/v1/lifelog/weight' },
  { name: 'finance', selector: '.finance', api: '**/api/v1/finance/data/daytoday' },
  { name: 'upcoming', selector: '.upcoming', api: '**/api/v1/home/events' },
  { name: 'entropy', selector: '.entropy-panel', api: '**/api/v1/home/entropy' },
];

/**
 * Measure bounding box of a widget's root element.
 */
async function measureWidget(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height, top: rect.top, left: rect.left };
  }, selector);
}

test.describe.serial('Office Screen Skeleton Sizing', () => {
  /** @type {import('@playwright/test').Page} */
  let page;
  const resolvers = {};
  const skeletonDims = {};
  const hydratedDims = {};

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    page = await context.newPage();

    // Set up API interception — hold all widget APIs
    for (const config of WIDGET_CONFIGS) {
      const holdPromise = new Promise(resolve => {
        resolvers[config.name] = resolve;
      });
      await page.route(config.api, async (route) => {
        await holdPromise;
        await route.continue();
      });
    }
  });

  test.afterAll(async () => {
    if (page) await page.close();
  });

  test('navigate to office screen and wait for layout', async () => {
    await page.goto(`${FRONTEND_URL}/screen/office`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.screen-root', { timeout: 15000 });
    // Let the layout stabilize with skeletons rendered
    await page.waitForTimeout(1000);
  });

  test('measure skeleton dimensions', async () => {
    for (const config of WIDGET_CONFIGS) {
      const dims = await measureWidget(page, config.selector);
      skeletonDims[config.name] = dims;

      if (dims) {
        console.log(`  SKELETON ${config.name}: ${dims.width.toFixed(0)}x${dims.height.toFixed(0)}px`);
      } else {
        console.log(`  SKELETON ${config.name}: NOT FOUND`);
      }
    }
  });

  test('release APIs and measure hydrated dimensions', async () => {
    // Release all APIs
    for (const config of WIDGET_CONFIGS) {
      if (resolvers[config.name]) resolvers[config.name]();
    }

    // Wait for all widgets to hydrate
    await page.waitForTimeout(5000);

    for (const config of WIDGET_CONFIGS) {
      const dims = await measureWidget(page, config.selector);
      hydratedDims[config.name] = dims;

      if (dims) {
        console.log(`  HYDRATED ${config.name}: ${dims.width.toFixed(0)}x${dims.height.toFixed(0)}px`);
      } else {
        console.log(`  HYDRATED ${config.name}: NOT FOUND`);
      }
    }
  });

  test('skeleton and hydrated sizes are within tolerance', async () => {
    for (const config of WIDGET_CONFIGS) {
      const skeleton = skeletonDims[config.name];
      const hydrated = hydratedDims[config.name];

      if (!skeleton || !hydrated) {
        console.log(`  SKIP ${config.name}: missing measurements`);
        continue;
      }

      const widthRatio = skeleton.width / hydrated.width;
      const heightRatio = skeleton.height / hydrated.height;

      console.log(`  ${config.name}: width ${(widthRatio * 100).toFixed(0)}%, height ${(heightRatio * 100).toFixed(0)}%`);

      expect(widthRatio, `${config.name} width ratio ${widthRatio.toFixed(2)}`).toBeGreaterThanOrEqual(MIN_SIZE_RATIO);
      expect(widthRatio, `${config.name} width ratio ${widthRatio.toFixed(2)}`).toBeLessThanOrEqual(MAX_SIZE_RATIO);
      expect(heightRatio, `${config.name} height ratio ${heightRatio.toFixed(2)}`).toBeGreaterThanOrEqual(MIN_SIZE_RATIO);
      expect(heightRatio, `${config.name} height ratio ${heightRatio.toFixed(2)}`).toBeLessThanOrEqual(MAX_SIZE_RATIO);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it catches the current discrepancies**

Run: `npx playwright test tests/live/flow/screen/office-skeleton-sizing.runtime.test.mjs --headed --reporter=line`

Expected: FAIL — Weight and Finance height ratios should be well outside the 80-120% tolerance.

- [ ] **Step 3: Commit**

```bash
git add tests/live/flow/screen/office-skeleton-sizing.runtime.test.mjs
git commit -m "test(screen): add skeleton sizing comparison test for office widgets

Intercepts widget APIs to hold skeleton state, measures bounding boxes,
then releases and compares against hydrated dimensions. Asserts skeleton
size is within 80-120% of hydrated size.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Run all office screen tests and verify no regressions

- [ ] **Step 1: Run the skeleton sizing test after all widget fixes**

Run: `npx playwright test tests/live/flow/screen/office-skeleton-sizing.runtime.test.mjs --headed --reporter=line`

Expected: PASS — all four widget ratios should be within 80-120%.

- [ ] **Step 2: Run existing office screen tests**

Run: `npx playwright test tests/live/flow/screen/ --reporter=line`

Expected: All existing tests pass (office-input, office-menu, office-menu-switch, office-pip).

- [ ] **Step 3: Commit the full set if any fixup was needed**

If any test revealed an issue that required a fixup, commit the fix. Otherwise this step is a no-op.

---

## Execution Order

Tasks 1-4 are independent widget fixes and can be parallelized. Task 5 (test) depends on no specific fix but should be written early to validate. Task 6 is the final verification after all fixes are applied.

Recommended order for serial execution: **5 → 1 → 2 → 3 → 4 → 6** (write test first to confirm it catches the bugs, then fix widgets, then verify all pass).
