# Rendering Layer Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract canvas renderers from `1_adapters/` into a new `1_rendering/` DDD layer with shared primitives and domain logic properly separated.

**Architecture:** Create `backend/src/1_rendering/` as a peer to `1_adapters/` at dependency tier 1. Shared drawing primitives live in `lib/`. Domain logic (stats computation, weighted selection) moves to `2_domains/`. Renderers become thin layout-only modules receiving pre-computed data via DI.

**Tech Stack:** Node.js `canvas` (node-canvas), moment-timezone, ES modules (.mjs)

**Design doc:** `docs/_wip/plans/2026-02-11-rendering-layer-design.md`

---

## Task 1: Add `#rendering` Import Alias

**Files:**
- Modify: `package.json` (line ~37, inside `"imports"` block)

**Step 1: Add the alias**

In `package.json`, add `#rendering/*` to the `imports` object, after the `#adapters/*` line:

```json
"#adapters/*": "./backend/src/1_adapters/*",
"#rendering/*": "./backend/src/1_rendering/*",
```

**Step 2: Verify Node resolves it**

```bash
node -e "console.log(import.meta.resolve('#rendering/lib/index.mjs'))" --input-type=module 2>&1 || echo "Expected: fails until directory exists"
```

Expected: Error (directory doesn't exist yet — that's fine, alias is registered).

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add #rendering/* import alias to package.json"
```

---

## Task 2: Create Shared Rendering Primitives

**Files:**
- Create: `backend/src/1_rendering/lib/TextRenderer.mjs`
- Create: `backend/src/1_rendering/lib/LayoutHelpers.mjs`
- Create: `backend/src/1_rendering/lib/CanvasFactory.mjs`
- Create: `backend/src/1_rendering/lib/index.mjs`
- Create: `tests/unit/rendering/lib/TextRenderer.test.mjs`
- Create: `tests/unit/rendering/lib/LayoutHelpers.test.mjs`

### Step 1: Write failing test for `wrapText`

`tests/unit/rendering/lib/TextRenderer.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { wrapText } from '#rendering/lib/TextRenderer.mjs';

describe('wrapText', () => {
  // Mock ctx with measureText
  const mockCtx = (charWidth = 8) => ({
    measureText: (text) => ({ width: text.length * charWidth }),
  });

  it('returns single line when text fits', () => {
    const lines = wrapText(mockCtx(), 'hello world', 200);
    expect(lines).toEqual(['hello world']);
  });

  it('wraps text exceeding maxWidth', () => {
    const lines = wrapText(mockCtx(10), 'one two three four five', 100);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('one two three four five');
  });

  it('returns empty array for empty string', () => {
    const lines = wrapText(mockCtx(), '', 200);
    expect(lines).toEqual([]);
  });

  it('handles null/undefined text', () => {
    const lines = wrapText(mockCtx(), null, 200);
    expect(lines).toEqual([]);
  });

  it('handles single long word exceeding maxWidth', () => {
    const lines = wrapText(mockCtx(10), 'superlongword', 50);
    expect(lines).toEqual(['superlongword']);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/rendering/lib/TextRenderer.test.mjs
```

Expected: FAIL — module not found.

### Step 3: Implement `TextRenderer.mjs`

`backend/src/1_rendering/lib/TextRenderer.mjs`:

```javascript
/**
 * Text rendering utilities for canvas-based output.
 * @module 1_rendering/lib/TextRenderer
 */

/**
 * Wrap text into lines that fit within maxWidth.
 *
 * @param {Object} ctx - Canvas 2D context (needs measureText)
 * @param {string|null} text - Text to wrap
 * @param {number} maxWidth - Maximum line width in pixels
 * @returns {string[]} Wrapped lines
 */
export function wrapText(ctx, text, maxWidth) {
  const words = String(text || '').split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/rendering/lib/TextRenderer.test.mjs
```

Expected: PASS.

### Step 5: Write failing test for `drawDivider` and `formatDuration`

`tests/unit/rendering/lib/LayoutHelpers.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { formatDuration } from '#rendering/lib/LayoutHelpers.mjs';

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(125)).toBe('2m 5s');
  });

  it('formats minutes only when no seconds', () => {
    expect(formatDuration(120)).toBe('2m');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(3720)).toBe('1h 2m');
  });

  it('returns -- for null', () => {
    expect(formatDuration(null)).toBe('--');
  });

  it('returns -- for undefined', () => {
    expect(formatDuration(undefined)).toBe('--');
  });
});
```

**Step 6: Run test to verify it fails**

```bash
npx vitest run tests/unit/rendering/lib/LayoutHelpers.test.mjs
```

Expected: FAIL — module not found.

### Step 7: Implement `LayoutHelpers.mjs`

`backend/src/1_rendering/lib/LayoutHelpers.mjs`:

```javascript
/**
 * Layout drawing utilities for canvas-based rendering.
 * @module 1_rendering/lib/LayoutHelpers
 */

/**
 * Draw a horizontal divider line.
 *
 * @param {Object} ctx - Canvas 2D context
 * @param {number} y - Y position
 * @param {number} width - Canvas width
 * @param {Object} [options]
 * @param {number} [options.offset=10] - Inset from edges
 * @param {number} [options.height=2] - Line thickness
 * @param {string} [options.color='#000000'] - Line color
 */
export function drawDivider(ctx, y, width, options = {}) {
  const { offset = 10, height = 2, color = '#000000' } = options;
  ctx.fillStyle = color;
  ctx.fillRect(offset, y, width - offset * 2, height);
}

/**
 * Draw a border rectangle.
 *
 * @param {Object} ctx - Canvas 2D context
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @param {Object} [options]
 * @param {number} [options.offset=10] - Inset from edges
 * @param {number} [options.lineWidth=3] - Border thickness
 * @param {string} [options.color='#000000'] - Border color
 */
export function drawBorder(ctx, width, height, options = {}) {
  const { offset = 10, lineWidth = 3, color = '#000000' } = options;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(offset, offset, width - offset * 2, height - offset * 2);
}

/**
 * Flip a canvas 180 degrees for upside-down mounted printers.
 *
 * @param {Function} createNodeCanvas - Canvas constructor function
 * @param {Object} canvas - Source canvas
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @returns {Object} Flipped canvas
 */
export function flipCanvas(createNodeCanvas, canvas, width, height) {
  const flipped = createNodeCanvas(width, height);
  const fctx = flipped.getContext('2d');
  fctx.translate(width, height);
  fctx.scale(-1, -1);
  fctx.drawImage(canvas, 0, 0);
  return flipped;
}

/**
 * Format duration in seconds to human-readable string.
 *
 * @param {number|null} seconds - Duration in seconds
 * @returns {string} Formatted duration ("Xm Ys", "Xh Ym", or "--")
 */
export function formatDuration(seconds) {
  if (seconds == null) return '--';
  const s = Math.round(seconds);
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
}
```

**Step 8: Run test to verify it passes**

```bash
npx vitest run tests/unit/rendering/lib/LayoutHelpers.test.mjs
```

Expected: PASS.

### Step 9: Implement `CanvasFactory.mjs`

`backend/src/1_rendering/lib/CanvasFactory.mjs`:

```javascript
/**
 * Canvas creation and font registration.
 * @module 1_rendering/lib/CanvasFactory
 */

/**
 * Create a node-canvas instance with optional font registration.
 *
 * @param {Object} config
 * @param {number} config.width - Canvas width in pixels
 * @param {number} config.height - Canvas height in pixels
 * @param {string} [config.fontDir] - Font directory path
 * @param {string} [config.fontFile] - Font filename within fontDir
 * @param {string} [config.fontFamily] - CSS font family name to register
 * @returns {Promise<{canvas: Object, ctx: Object, createNodeCanvas: Function}>}
 */
export async function initCanvas(config) {
  const { width, height, fontDir, fontFile, fontFamily } = config;
  const { createCanvas: createNodeCanvas, registerFont } = await import('canvas');

  if (fontDir && fontFile && fontFamily) {
    const fontPath = `${fontDir}/${fontFile}`;
    try {
      registerFont(fontPath, { family: fontFamily });
    } catch { /* fall back to system fonts */ }
  }

  const canvas = createNodeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'top';

  return { canvas, ctx, createNodeCanvas };
}
```

### Step 10: Create barrel export

`backend/src/1_rendering/lib/index.mjs`:

```javascript
/**
 * Shared rendering primitives.
 * @module 1_rendering/lib
 */

export { wrapText } from './TextRenderer.mjs';
export { drawDivider, drawBorder, flipCanvas, formatDuration } from './LayoutHelpers.mjs';
export { initCanvas } from './CanvasFactory.mjs';
```

### Step 11: Run all primitive tests

```bash
npx vitest run tests/unit/rendering/
```

Expected: All PASS.

### Step 12: Commit

```bash
git add backend/src/1_rendering/lib/ tests/unit/rendering/
git commit -m "feat: add shared rendering primitives (TextRenderer, LayoutHelpers, CanvasFactory)"
```

---

## Task 3: Extract `selectItemsForPrint` to Gratitude Domain

**Files:**
- Create: `backend/src/2_domains/gratitude/services/PrintSelectionService.mjs`
- Create: `tests/unit/domains/gratitude/PrintSelectionService.test.mjs`

### Step 1: Write failing test

`tests/unit/domains/gratitude/PrintSelectionService.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { selectItemsForPrint } from '#domains/gratitude/services/PrintSelectionService.mjs';

describe('selectItemsForPrint', () => {
  const makeItem = (id, daysOld = 1, printCount = 0) => ({
    id,
    datetime: new Date(Date.now() - daysOld * 86400000).toISOString(),
    printCount,
    item: { text: `Item ${id}` },
  });

  it('returns all items if count >= items.length', () => {
    const items = [makeItem('a'), makeItem('b')];
    const result = selectItemsForPrint(items, 5);
    expect(result).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(selectItemsForPrint([], 3)).toEqual([]);
    expect(selectItemsForPrint(null, 3)).toEqual([]);
  });

  it('returns requested count', () => {
    const items = Array.from({ length: 10 }, (_, i) => makeItem(`item-${i}`, i + 1));
    const result = selectItemsForPrint(items, 3);
    expect(result).toHaveLength(3);
  });

  it('prioritizes items with lower printCount', () => {
    const items = [
      makeItem('printed-5x', 1, 5),
      makeItem('printed-0x', 1, 0),
      makeItem('printed-3x', 1, 3),
    ];
    // Run multiple times — printed-0x should appear most often
    const counts = { 'printed-5x': 0, 'printed-0x': 0, 'printed-3x': 0 };
    for (let i = 0; i < 100; i++) {
      const result = selectItemsForPrint(items, 1);
      counts[result[0].id]++;
    }
    expect(counts['printed-0x']).toBeGreaterThan(counts['printed-5x']);
  });

  it('returns items with correct structure', () => {
    const items = [makeItem('a')];
    const result = selectItemsForPrint(items, 1);
    expect(result[0]).toHaveProperty('id', 'a');
    expect(result[0]).toHaveProperty('datetime');
    expect(result[0]).toHaveProperty('printCount');
  });
});
```

### Step 2: Run test to verify it fails

```bash
npx vitest run tests/unit/domains/gratitude/PrintSelectionService.test.mjs
```

Expected: FAIL — module not found.

### Step 3: Implement — copy `selectItemsForPrint` from GratitudeCardRenderer

`backend/src/2_domains/gratitude/services/PrintSelectionService.mjs`:

Copy lines 22–117 from `backend/src/1_adapters/gratitude/rendering/GratitudeCardRenderer.mjs` into this new file. The function is already pure (no external dependencies). Wrap it as:

```javascript
/**
 * Weighted print selection for gratitude items.
 *
 * Items bucketed by age (0-7d, 7-14d, 14-30d, 30+d) with weights (50, 20, 15, 15).
 * Within each bucket, items with lowest printCount are prioritized.
 *
 * @module 2_domains/gratitude/services/PrintSelectionService
 */

// Paste the existing selectItemsForPrint function here unchanged.
// It's lines 22-117 from GratitudeCardRenderer.mjs.

export function selectItemsForPrint(items, count) {
  // ... (exact code from GratitudeCardRenderer.mjs lines 23-117)
}
```

### Step 4: Run test to verify it passes

```bash
npx vitest run tests/unit/domains/gratitude/PrintSelectionService.test.mjs
```

Expected: PASS.

### Step 5: Commit

```bash
git add backend/src/2_domains/gratitude/services/PrintSelectionService.mjs tests/unit/domains/gratitude/
git commit -m "feat: extract selectItemsForPrint to gratitude domain service"
```

---

## Task 4: Extract Fitness Participant Stats to Domain

**Files:**
- Create: `backend/src/2_domains/fitness/services/SessionStatsService.mjs`
- Create: `tests/unit/domains/fitness/SessionStatsService.test.mjs`

### Step 1: Write failing test

`tests/unit/domains/fitness/SessionStatsService.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { computeParticipantStats } from '#domains/fitness/services/SessionStatsService.mjs';

describe('computeParticipantStats', () => {
  it('computes peak HR', () => {
    const stats = computeParticipantStats({
      hr: [100, 150, 120, null, 160],
      zones: ['cool', 'warm', 'warm', null, 'hot'],
      coins: [0, 5, 10, 10, 20],
      intervalSeconds: 5,
      participant: {},
    });
    expect(stats.peakHr).toBe(160);
  });

  it('computes avg HR', () => {
    const stats = computeParticipantStats({
      hr: [100, 200],
      zones: ['cool', 'hot'],
      coins: [0, 10],
      intervalSeconds: 5,
      participant: {},
    });
    expect(stats.avgHr).toBe(150);
  });

  it('computes zone seconds', () => {
    const stats = computeParticipantStats({
      hr: [100, 120, 140, 160],
      zones: ['cool', 'cool', 'warm', 'hot'],
      coins: [0, 0, 5, 10],
      intervalSeconds: 10,
      participant: {},
    });
    expect(stats.zoneSeconds.cool).toBe(20);
    expect(stats.zoneSeconds.warm).toBe(10);
    expect(stats.zoneSeconds.hot).toBe(10);
  });

  it('computes warm+ ratio', () => {
    const stats = computeParticipantStats({
      hr: [100, 120, 160, 180],
      zones: ['cool', 'active', 'warm', 'hot'],
      coins: [0, 0, 5, 10],
      intervalSeconds: 5,
      participant: {},
    });
    // 2 warm+ out of 4 active = 0.5
    expect(stats.warmPlusRatio).toBe(0.5);
  });

  it('handles empty arrays', () => {
    const stats = computeParticipantStats({
      hr: [],
      zones: [],
      coins: [],
      intervalSeconds: 5,
      participant: {},
    });
    expect(stats.peakHr).toBeNull();
    expect(stats.avgHr).toBeNull();
    expect(stats.totalCoins).toBe(0);
  });
});
```

### Step 2: Run test to verify it fails

```bash
npx vitest run tests/unit/domains/fitness/SessionStatsService.test.mjs
```

Expected: FAIL — module not found.

### Step 3: Implement — extract stats computation from FitnessReceiptRenderer

`backend/src/2_domains/fitness/services/SessionStatsService.mjs`:

Extract the stats computation logic from FitnessReceiptRenderer.mjs lines 183–256 into a pure function:

```javascript
/**
 * Participant statistics computation for fitness sessions.
 *
 * Pure domain logic — no rendering, no external dependencies.
 *
 * @module 2_domains/fitness/services/SessionStatsService
 */

const ZONE_ORDER = ['cool', 'active', 'warm', 'hot', 'fire'];

function zoneIntensity(zone) {
  const idx = ZONE_ORDER.indexOf(zone);
  return idx === -1 ? -1 : idx;
}

/**
 * Compute statistics for a single participant from decoded timeline data.
 *
 * @param {Object} params
 * @param {Array<number|null>} params.hr - Decoded heart rate array
 * @param {Array<string|null>} params.zones - Decoded zone name array
 * @param {Array<number|null>} params.coins - Decoded cumulative coins array
 * @param {number} params.intervalSeconds - Seconds per tick
 * @param {Object} params.participant - Participant metadata (coins_earned, active_seconds, display_name)
 * @returns {Object} Computed stats
 */
export function computeParticipantStats({ hr, zones, coins, intervalSeconds, participant }) {
  const p = participant || {};
  const hrValid = (hr || []).filter(v => v != null && v > 0);
  const peakHr = hrValid.length > 0 ? Math.max(...hrValid) : null;
  const avgHr = hrValid.length > 0 ? Math.round(hrValid.reduce((s, v) => s + v, 0) / hrValid.length) : null;
  const stdDevHr = hrValid.length > 1
    ? Math.round(Math.sqrt(hrValid.reduce((s, v) => s + (v - avgHr) ** 2, 0) / hrValid.length))
    : null;

  const zoneArr = zones || [];
  const coinArr = coins || [];
  const lastCoin = coinArr.length > 0 ? (coinArr[coinArr.length - 1] || 0) : 0;
  const totalCoins = p.coins_earned != null ? p.coins_earned : lastCoin;
  const activeTicks = zoneArr.filter(z => z != null).length;
  const activeSeconds = p.active_seconds != null ? p.active_seconds : activeTicks * intervalSeconds;
  const joinTick = (hr || []).findIndex(v => v != null && v > 0);
  const warmPlusTicks = zoneArr.filter(z => z === 'warm' || z === 'hot' || z === 'fire').length;
  const warmPlusRatio = activeTicks > 0 ? warmPlusTicks / activeTicks : 0;

  // Zone seconds
  const zoneTicks = {};
  for (const z of zoneArr) {
    if (z != null) zoneTicks[z] = (zoneTicks[z] || 0) + 1;
  }
  const zoneSeconds = {};
  for (const [z, count] of Object.entries(zoneTicks)) {
    zoneSeconds[z] = count * intervalSeconds;
  }

  // Zone HR boundaries
  const zoneBounds = {};
  for (let i = 0; i < (hr || []).length && i < zoneArr.length; i++) {
    const h = hr[i];
    const z = zoneArr[i];
    if (h != null && h > 0 && z != null) {
      if (!zoneBounds[z]) zoneBounds[z] = { min: h, max: h };
      else {
        if (h < zoneBounds[z].min) zoneBounds[z].min = h;
        if (h > zoneBounds[z].max) zoneBounds[z].max = h;
      }
    }
  }

  // Per-zone coins (delta from cumulative)
  const zoneCoins = {};
  for (let i = 0; i < zoneArr.length && i < coinArr.length; i++) {
    const z = zoneArr[i];
    if (z != null) {
      const cur = coinArr[i] || 0;
      const prev = i > 0 ? (coinArr[i - 1] || 0) : 0;
      const delta = Math.max(0, cur - prev);
      if (delta > 0) zoneCoins[z] = (zoneCoins[z] || 0) + delta;
    }
  }

  return {
    peakHr,
    avgHr,
    stdDevHr,
    totalCoins,
    activeSeconds,
    joinTick,
    warmPlusRatio,
    zoneSeconds,
    zoneBounds,
    zoneCoins,
    hrValues: hrValid,
  };
}

export { zoneIntensity, ZONE_ORDER };
```

### Step 4: Run test to verify it passes

```bash
npx vitest run tests/unit/domains/fitness/SessionStatsService.test.mjs
```

Expected: PASS.

### Step 5: Commit

```bash
git add backend/src/2_domains/fitness/services/SessionStatsService.mjs tests/unit/domains/fitness/
git commit -m "feat: extract participant stats computation to fitness domain service"
```

---

## Task 5: Move Gratitude Renderer to `1_rendering/`

**Files:**
- Create: `backend/src/1_rendering/gratitude/GratitudeCardRenderer.mjs`
- Create: `backend/src/1_rendering/gratitude/gratitudeCardTheme.mjs`
- Create: `backend/src/1_rendering/gratitude/index.mjs`

### Step 1: Copy theme file

Copy `backend/src/1_adapters/gratitude/rendering/gratitudeCardTheme.mjs` to `backend/src/1_rendering/gratitude/gratitudeCardTheme.mjs`. Update the `@module` JSDoc tag from `2_adapters/gratitude/rendering/gratitudeCardTheme` to `1_rendering/gratitude/gratitudeCardTheme`.

### Step 2: Copy renderer and refactor

Copy `backend/src/1_adapters/gratitude/rendering/GratitudeCardRenderer.mjs` to `backend/src/1_rendering/gratitude/GratitudeCardRenderer.mjs`.

Apply these changes to the new copy:

1. **Update `@module` JSDoc** tag to `1_rendering/gratitude/GratitudeCardRenderer`

2. **Replace `selectItemsForPrint` with domain import.** Remove lines 22–117 (the entire function) and add this import at the top:

   ```javascript
   import { selectItemsForPrint } from '#domains/gratitude/services/PrintSelectionService.mjs';
   ```

3. **Replace duplicate `wrapText` with shared primitive.** Remove the two `wrapText` functions (lines 174–192 and 246–261). Add import:

   ```javascript
   import { wrapText } from '#rendering/lib/TextRenderer.mjs';
   ```

   Update call sites:
   - `wrapText(text, maxWidth, font)` calls (line ~196, ~271) → `wrapText(ctx, text, maxWidth)` (set `ctx.font` before calling)
   - `wrapTextCtx(text, maxWidth)` calls → `wrapText(ctx, text, maxWidth)` (ctx is already in scope)

4. **Replace upside-down rotation with shared primitive.** Remove the manual flip block (lines 345–351). Add import:

   ```javascript
   import { flipCanvas } from '#rendering/lib/LayoutHelpers.mjs';
   ```

   Replace the manual flip code with:
   ```javascript
   if (upsidedown) {
     const flipped = flipCanvas(createNodeCanvas, canvas, width, height);
     return { canvas: flipped, width, height, selectedIds };
   }
   ```

5. **Update theme import** path:

   ```javascript
   import { gratitudeCardTheme as theme } from './gratitudeCardTheme.mjs';
   ```

### Step 3: Create barrel export

`backend/src/1_rendering/gratitude/index.mjs`:

```javascript
/**
 * Gratitude rendering module.
 * @module 1_rendering/gratitude
 */

export { createGratitudeCardRenderer } from './GratitudeCardRenderer.mjs';
export { gratitudeCardTheme } from './gratitudeCardTheme.mjs';
```

### Step 4: Commit

```bash
git add backend/src/1_rendering/gratitude/
git commit -m "feat: move GratitudeCardRenderer to 1_rendering layer"
```

---

## Task 6: Move Fitness Renderer to `1_rendering/`

**Files:**
- Create: `backend/src/1_rendering/fitness/FitnessReceiptRenderer.mjs`
- Create: `backend/src/1_rendering/fitness/fitnessReceiptTheme.mjs`
- Create: `backend/src/1_rendering/fitness/index.mjs`

### Step 1: Copy theme file

Copy `backend/src/1_adapters/fitness/rendering/fitnessReceiptTheme.mjs` to `backend/src/1_rendering/fitness/fitnessReceiptTheme.mjs`. Update `@module` JSDoc.

### Step 2: Copy renderer and refactor

Copy `backend/src/1_adapters/fitness/rendering/FitnessReceiptRenderer.mjs` to `backend/src/1_rendering/fitness/FitnessReceiptRenderer.mjs`.

Apply these changes to the new copy:

1. **Update `@module` JSDoc** to `1_rendering/fitness/FitnessReceiptRenderer`

2. **Replace stats computation with domain import.** Remove the per-participant stats block (lines 183–256). Add import:

   ```javascript
   import { computeParticipantStats, zoneIntensity, ZONE_ORDER } from '#domains/fitness/services/SessionStatsService.mjs';
   ```

   Replace the removed block with a call to the domain service:

   ```javascript
   const stats = {};
   for (const slug of participantSlugs) {
     const p = participants[slug] || {};
     const d = decoded[slug] || { zones: [], hr: [], coins: [] };
     const computed = computeParticipantStats({
       hr: d.hr,
       zones: d.zones,
       coins: d.coins,
       intervalSeconds,
       participant: p,
     });
     stats[slug] = {
       displayName: p.display_name || (resolveDisplayName ? resolveDisplayName(slug) : null) || slug,
       ...computed,
     };
   }
   ```

3. **Remove duplicate helper functions** that are now in shared primitives:
   - Remove `wrapText` (lines 83–98) → import from `#rendering/lib/TextRenderer.mjs`
   - Remove `formatDuration` (lines 67–78) → import from `#rendering/lib/LayoutHelpers.mjs`
   - Remove `drawDivider` (lines 967–971) → import from `#rendering/lib/LayoutHelpers.mjs`
   - Remove `zoneIntensity` and `ZONE_ORDER` (lines 29–33) → imported from domain above

4. **Replace upside-down rotation** (lines 950–956) with:

   ```javascript
   import { flipCanvas } from '#rendering/lib/LayoutHelpers.mjs';
   // ...
   if (upsidedown) {
     const flipped = flipCanvas(createNodeCanvas, canvas, width, height);
     return { canvas: flipped, width, height };
   }
   ```

5. **Keep**: The `resolveZone`, `downsampleZones`, `downsampleValues` helpers — these are rendering-specific (downsampling for visual display) and stay in the renderer.

6. **Keep**: The `decodeSingleSeries` import from `#domains/fitness/services/TimelineService.mjs` — this is a legitimate domain import.

7. **Update theme import** path:

   ```javascript
   import { fitnessReceiptTheme as theme } from './fitnessReceiptTheme.mjs';
   ```

### Step 3: Create barrel export

`backend/src/1_rendering/fitness/index.mjs`:

```javascript
/**
 * Fitness rendering module.
 * @module 1_rendering/fitness
 */

export { createFitnessReceiptRenderer } from './FitnessReceiptRenderer.mjs';
export { fitnessReceiptTheme } from './fitnessReceiptTheme.mjs';
```

### Step 4: Commit

```bash
git add backend/src/1_rendering/fitness/
git commit -m "feat: move FitnessReceiptRenderer to 1_rendering layer"
```

---

## Task 7: Update Bootstrap Wiring

**Files:**
- Modify: `backend/src/app.mjs` (lines 730, 772)

### Step 1: Update gratitude renderer import

In `backend/src/app.mjs`, change line 730:

```javascript
// Old:
const { createGratitudeCardRenderer } = await import('#adapters/gratitude/rendering/GratitudeCardRenderer.mjs');

// New:
const { createGratitudeCardRenderer } = await import('#rendering/gratitude/GratitudeCardRenderer.mjs');
```

### Step 2: Update fitness renderer import

Change line 772:

```javascript
// Old:
const { createFitnessReceiptRenderer } = await import('#adapters/fitness/rendering/FitnessReceiptRenderer.mjs');

// New:
const { createFitnessReceiptRenderer } = await import('#rendering/fitness/FitnessReceiptRenderer.mjs');
```

### Step 3: Verify server starts

```bash
node backend/src/server.mjs &
sleep 3
curl -s http://localhost:3112/api/v1/health | head -c 200
kill %1
```

Expected: Server starts without import errors. Health endpoint responds.

### Step 4: Commit

```bash
git add backend/src/app.mjs
git commit -m "chore: update bootstrap to import renderers from 1_rendering layer"
```

---

## Task 8: Clean Up Old Adapter Rendering Directories

**Files:**
- Delete: `backend/src/1_adapters/gratitude/rendering/GratitudeCardRenderer.mjs`
- Delete: `backend/src/1_adapters/gratitude/rendering/gratitudeCardTheme.mjs`
- Delete: `backend/src/1_adapters/gratitude/rendering/index.mjs`
- Delete: `backend/src/1_adapters/fitness/rendering/FitnessReceiptRenderer.mjs`
- Delete: `backend/src/1_adapters/fitness/rendering/fitnessReceiptTheme.mjs`
- Delete: `backend/src/1_adapters/fitness/rendering/index.mjs`
- Modify: `backend/src/1_adapters/fitness/index.mjs` (remove rendering re-exports)

### Step 1: Verify no remaining imports of old paths

```bash
grep -r '#adapters/gratitude/rendering\|#adapters/fitness/rendering' backend/src/ --include='*.mjs'
```

Expected: No matches (all imports updated in Task 7).

### Step 2: Remove old gratitude rendering files

```bash
rm backend/src/1_adapters/gratitude/rendering/GratitudeCardRenderer.mjs
rm backend/src/1_adapters/gratitude/rendering/gratitudeCardTheme.mjs
rm backend/src/1_adapters/gratitude/rendering/index.mjs
rmdir backend/src/1_adapters/gratitude/rendering
```

### Step 3: Remove old fitness rendering files

```bash
rm backend/src/1_adapters/fitness/rendering/FitnessReceiptRenderer.mjs
rm backend/src/1_adapters/fitness/rendering/fitnessReceiptTheme.mjs
rm backend/src/1_adapters/fitness/rendering/index.mjs
rmdir backend/src/1_adapters/fitness/rendering
```

### Step 4: Update fitness adapter barrel

In `backend/src/1_adapters/fitness/index.mjs`, remove lines 10–11:

```javascript
// Remove these lines:
// Rendering
export { createFitnessReceiptRenderer, fitnessReceiptTheme } from './rendering/index.mjs';
```

### Step 5: Commit

```bash
git add -A backend/src/1_adapters/
git commit -m "chore: remove old rendering files from adapter layer"
```

---

## Task 9: End-to-End Verification

### Step 1: Start dev server

```bash
lsof -i :3111  # Check if already running
npm run dev     # If not running
```

### Step 2: Test gratitude card endpoint

```bash
curl -s -o /tmp/gratitude-card.png -w "%{http_code}" http://localhost:3112/api/v1/gratitude/card
```

Expected: HTTP 200, valid PNG file at `/tmp/gratitude-card.png`.

### Step 3: Test fitness receipt endpoint (needs a valid session ID)

```bash
# List recent sessions to get a session ID
curl -s http://localhost:3112/api/v1/fitness/sessions | head -c 500
# Then test with a real session ID:
# curl -s -o /tmp/receipt.png -w "%{http_code}" http://localhost:3112/api/v1/fitness/receipt/{sessionId}
```

### Step 4: Run unit tests

```bash
npx vitest run tests/unit/rendering/ tests/unit/domains/gratitude/ tests/unit/domains/fitness/SessionStatsService.test.mjs
```

Expected: All PASS.

### Step 5: Final commit

```bash
git commit --allow-empty -m "chore: rendering layer migration complete — verified end-to-end"
```

---

## Follow-Up (Not in Scope)

- **NutriReportRenderer** at `1_adapters/nutribot/rendering/NutriReportRenderer.mjs` — same migration pattern, do separately
- **PDF output driver** — add `1_rendering/lib/PdfFactory.mjs` when needed
- **Chart primitives** — extract zone chart, HR histogram, stacked bar to `lib/` if a third renderer needs them
