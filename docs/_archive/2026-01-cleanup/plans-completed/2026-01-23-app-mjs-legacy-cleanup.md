# App.mjs Legacy Import Cleanup

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove remaining legacy imports from `backend/src/app.mjs` where migrated alternatives exist.

**Architecture:**
- Task 1 is a direct swap (migrated ArchiveService has identical interface)
- Task 2 removes a parity fallback (DDD service should be primary)
- Task 3 is deferred (canvas utility extraction is out of scope)

**Tech Stack:** ES modules, Express routers

---

## Task 1: Use migrated ArchiveService in app.mjs

**Files:**
- Modify: `backend/src/app.mjs:286`

**Step 1: Update the import**

Change line 286:
```javascript
const ArchiveService = (await import('../_legacy/lib/ArchiveService.mjs')).default;
```

To:
```javascript
const ArchiveService = (await import('./1_domains/content/services/ArchiveService.mjs')).default;
```

**Step 2: Verify no runtime errors**

Run: `node -e "import('./backend/src/app.mjs').then(() => console.log('OK')).catch(e => console.error(e.message))"`

Expected: Module loads (may fail on missing server, but import should resolve)

**Step 3: Commit**

```bash
git add backend/src/app.mjs
git commit -m "refactor(app): use migrated ArchiveService instead of legacy

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Remove legacy entropy parity mode

**Files:**
- Modify: `backend/src/app.mjs:396`
- Modify: `backend/src/4_api/routers/entropy.mjs` (remove legacyGetEntropyReport parameter)

**Step 1: Remove legacy import from app.mjs**

Delete line 396:
```javascript
const { getEntropyReport: legacyGetEntropyReport } = await import('../_legacy/lib/entropy.mjs');
```

**Step 2: Update the router creation**

Change lines 397-402:
```javascript
v1Routers.entropy = createEntropyApiRouter({
  entropyServices,
  configService,
  legacyGetEntropyReport,  // <-- Remove this line
  logger: rootLogger.child({ module: 'entropy-api' })
});
```

To:
```javascript
v1Routers.entropy = createEntropyApiRouter({
  entropyServices,
  configService,
  logger: rootLogger.child({ module: 'entropy-api' })
});
```

**Step 3: Update entropy router to remove parity fallback**

In `backend/src/4_api/routers/entropy.mjs`, remove the `legacyGetEntropyReport` parameter and fallback logic:

1. Remove from config destructuring (line 23)
2. Remove the conditional block (lines 66-74)

The router should now only use the DDD service.

**Step 4: Verify entropy endpoint works**

Run the dev server and test: `curl http://localhost:3112/api/v1/entropy/report`

Expected: Returns entropy report from DDD service

**Step 5: Commit**

```bash
git add backend/src/app.mjs backend/src/4_api/routers/entropy.mjs
git commit -m "refactor(entropy): remove legacy parity mode, use DDD service only

The DDD EntropyService is now the sole implementation.
Legacy getEntropyReport fallback removed.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Extract prayer card canvas renderer from legacy printer

**Files:**
- Create: `backend/src/0_infrastructure/rendering/PrayerCardRenderer.mjs`
- Modify: `backend/src/app.mjs:493-500`

**Step 1: Create PrayerCardRenderer module**

Create `backend/src/0_infrastructure/rendering/PrayerCardRenderer.mjs`:

```javascript
/**
 * Prayer Card Canvas Renderer
 *
 * Renders gratitude/hopes selections to a canvas image for thermal printing.
 * Extracted from: backend/_legacy/routers/printer.mjs
 *
 * @module infrastructure/rendering/PrayerCardRenderer
 */

import { createLogger } from '../logging/logger.js';

const logger = createLogger({ source: 'backend', app: 'prayer-card-renderer' });

/**
 * Select items for printing using weighted bucket selection
 * Items are bucketed by age and randomly selected with age-based weighting
 *
 * @param {Array} items - Items with datetime property
 * @param {number} count - Number of items to select
 * @returns {Array} Selected items
 */
export function selectItemsForPrint(items, count) {
  if (!items || items.length === 0) return [];
  if (items.length <= count) return [...items];

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const bucketDefs = [
    { maxDays: 7, weight: 50 },
    { maxDays: 14, weight: 20 },
    { maxDays: 30, weight: 15 },
    { maxDays: Infinity, weight: 15 }
  ];

  const buckets = bucketDefs.map(() => []);

  for (const item of items) {
    const itemDate = new Date(item.datetime).getTime();
    const ageMs = now - itemDate;
    const ageDays = ageMs / DAY_MS;

    let prevMax = 0;
    for (let i = 0; i < bucketDefs.length; i++) {
      if (ageDays >= prevMax && ageDays < bucketDefs[i].maxDays) {
        buckets[i].push(item);
        break;
      }
      prevMax = bucketDefs[i].maxDays;
    }
  }

  const selected = [];
  const totalWeight = bucketDefs.reduce((sum, b) => sum + b.weight, 0);

  for (let i = 0; i < count; i++) {
    let rand = Math.random() * totalWeight;
    let bucketIdx = 0;

    for (let j = 0; j < bucketDefs.length; j++) {
      rand -= bucketDefs[j].weight;
      if (rand <= 0) {
        bucketIdx = j;
        break;
      }
    }

    // Find non-empty bucket
    let attempts = 0;
    while (buckets[bucketIdx].length === 0 && attempts < bucketDefs.length) {
      bucketIdx = (bucketIdx + 1) % bucketDefs.length;
      attempts++;
    }

    if (buckets[bucketIdx].length > 0) {
      const randIdx = Math.floor(Math.random() * buckets[bucketIdx].length);
      const [item] = buckets[bucketIdx].splice(randIdx, 1);
      selected.push(item);
    }
  }

  return selected;
}

/**
 * Create prayer card canvas renderer
 *
 * @param {Object} config
 * @param {Function} config.getSelectionsForPrint - Function to get selections
 * @param {string} [config.fontDir] - Font directory path
 * @returns {Object} Renderer with createCanvas method
 */
export function createPrayerCardRenderer(config) {
  const { getSelectionsForPrint, fontDir } = config;

  /**
   * Render prayer card to canvas
   * @param {boolean} [upsidedown=false] - Flip image for mounted printer
   * @returns {Promise<{canvas: Canvas, width: number, height: number, selectedIds: Object}>}
   */
  async function createCanvas(upsidedown = false) {
    const width = 580;
    const fontFamily = 'Roboto Condensed';
    const fontPath = fontDir
      ? `${fontDir}/roboto-condensed/RobotoCondensed-Regular.ttf`
      : './backend/journalist/fonts/roboto-condensed/roboto-condensed/RobotoCondensed-Regular.ttf';

    const selections = await getSelectionsForPrint();

    const selectedGratitude = selections.gratitude.length > 0
      ? selectItemsForPrint(selections.gratitude, 2).map(s => ({
          id: s.id,
          text: s.item.text,
          displayName: s.displayName
        }))
      : [];

    const selectedHopes = selections.hopes.length > 0
      ? selectItemsForPrint(selections.hopes, 2).map(s => ({
          id: s.id,
          text: s.item.text,
          displayName: s.displayName
        }))
      : [];

    const { createCanvas: nodeCreateCanvas, registerFont } = await import('canvas');

    try {
      registerFont(fontPath, { family: fontFamily });
    } catch (fontError) {
      logger.warn?.('prayer-card.font_load_failed', { fontFamily, error: fontError.message });
    }

    const margin = 25;
    const lineHeight = 42;
    const height = 600;

    const canvas = nodeCreateCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';

    // White background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    // Border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, width - 20, height - 20);

    let yPos = margin;

    // Helper to draw wrapped text
    const drawWrappedText = (text, x, maxWidth, fontSize) => {
      ctx.font = `${fontSize}px "${fontFamily}"`;
      const words = text.split(' ');
      let line = '';

      for (const word of words) {
        const testLine = line + (line ? ' ' : '') + word;
        const metrics = ctx.measureText(testLine);

        if (metrics.width > maxWidth && line) {
          ctx.fillText(line, x, yPos);
          yPos += lineHeight;
          line = word;
        } else {
          line = testLine;
        }
      }
      if (line) {
        ctx.fillText(line, x, yPos);
        yPos += lineHeight;
      }
    };

    // Title
    ctx.fillStyle = '#000000';
    ctx.font = `bold 36px "${fontFamily}"`;
    ctx.fillText('Prayer Card', margin, yPos);
    yPos += 50;

    // Gratitude section
    if (selectedGratitude.length > 0) {
      ctx.font = `bold 24px "${fontFamily}"`;
      ctx.fillText('Gratitude:', margin, yPos);
      yPos += 35;

      for (const item of selectedGratitude) {
        ctx.fillStyle = '#333333';
        drawWrappedText(`• ${item.text}`, margin + 15, width - margin * 2 - 15, 20);
        ctx.fillStyle = '#666666';
        ctx.font = `italic 16px "${fontFamily}"`;
        ctx.fillText(`— ${item.displayName}`, margin + 30, yPos);
        yPos += 30;
      }
      yPos += 10;
    }

    // Hopes section
    if (selectedHopes.length > 0) {
      ctx.fillStyle = '#000000';
      ctx.font = `bold 24px "${fontFamily}"`;
      ctx.fillText('Hopes & Prayers:', margin, yPos);
      yPos += 35;

      for (const item of selectedHopes) {
        ctx.fillStyle = '#333333';
        drawWrappedText(`• ${item.text}`, margin + 15, width - margin * 2 - 15, 20);
        ctx.fillStyle = '#666666';
        ctx.font = `italic 16px "${fontFamily}"`;
        ctx.fillText(`— ${item.displayName}`, margin + 30, yPos);
        yPos += 30;
      }
    }

    // Flip if needed for mounted printer
    if (upsidedown) {
      const tempCanvas = nodeCreateCanvas(width, height);
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.translate(width, height);
      tempCtx.rotate(Math.PI);
      tempCtx.drawImage(canvas, 0, 0);
      return {
        canvas: tempCanvas,
        width,
        height,
        selectedIds: {
          gratitude: selectedGratitude.map(g => g.id),
          hopes: selectedHopes.map(h => h.id)
        }
      };
    }

    return {
      canvas,
      width,
      height,
      selectedIds: {
        gratitude: selectedGratitude.map(g => g.id),
        hopes: selectedHopes.map(h => h.id)
      }
    };
  }

  return { createCanvas };
}

export default { createPrayerCardRenderer, selectItemsForPrint };
```

**Step 2: Update app.mjs to use new renderer**

Replace lines 493-500:
```javascript
// Gratitude domain router - import legacy canvas function for card generation
let createPrayerCardCanvas = null;
try {
  const printerModule = await import('../_legacy/routers/printer.mjs');
  createPrayerCardCanvas = printerModule.createCanvasTypographyDemo;
} catch (e) {
  rootLogger.warn?.('gratitude.canvas.import_failed', { error: e.message });
}
```

With:
```javascript
// Gratitude domain router - prayer card canvas renderer
let createPrayerCardCanvas = null;
try {
  const { createPrayerCardRenderer } = await import('./0_infrastructure/rendering/PrayerCardRenderer.mjs');
  const householdId = configService.getDefaultHouseholdId();
  const renderer = createPrayerCardRenderer({
    getSelectionsForPrint: async () => {
      return gratitudeServices.gratitudeService.getSelectionsForPrint(
        householdId,
        (userId) => userService.resolveDisplayName(userId)
      );
    },
    fontDir: configService.getPath('font') || `${mediaBasePath}/fonts`
  });
  createPrayerCardCanvas = renderer.createCanvas;
} catch (e) {
  rootLogger.warn?.('gratitude.canvas.import_failed', { error: e.message });
}
```

**Step 3: Verify canvas rendering works**

Run dev server and test: `curl -o /tmp/card.png http://localhost:3112/api/v1/gratitude/card`

Expected: PNG image saved

**Step 4: Commit**

```bash
git add backend/src/0_infrastructure/rendering/PrayerCardRenderer.mjs backend/src/app.mjs
git commit -m "refactor(gratitude): extract prayer card renderer from legacy printer

Creates PrayerCardRenderer in infrastructure layer with:
- selectItemsForPrint() utility for weighted bucket selection
- createPrayerCardRenderer() factory with dependency injection

Removes last legacy import from app.mjs (printer.mjs).

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

| Task | Legacy Import | Action |
|------|---------------|--------|
| 1 | `_legacy/lib/ArchiveService.mjs` | Swap to migrated version |
| 2 | `_legacy/lib/entropy.mjs` | Remove parity mode |
| 3 | `_legacy/routers/printer.mjs` | Extract to infrastructure |

After all tasks:
- `app.mjs` will have **zero** legacy imports
- All DDD services are primary implementations
- Canvas rendering properly injected via infrastructure layer
