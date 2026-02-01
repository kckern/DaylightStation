# Rendering Layer Separation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract domain-specific renderers from 0_system/ to proper adapter layer, create system-level canvas utilities, and separate presentation factors from rendering logic.

**Architecture:**
- System layer (`0_system/canvas/`) provides pure canvas utilities (create canvas, drawing primitives)
- Adapter layer (`2_adapters/{domain}/rendering/`) contains domain-specific renderers
- Each renderer has a companion theme file for all presentation factors (sizes, fonts, colors, layouts)
- Renderers import theme + canvas utilities, focus only on composition logic

**Tech Stack:** node-canvas, ES modules

---

## Pre-Flight Checks

Before starting, verify:
- [ ] Working tree is clean (`git status`)
- [ ] All tests pass (`npm test`)
- [ ] Dev server is not running

---

## Task 1: Create System Canvas Service

**Files:**
- Create: `backend/src/0_system/canvas/index.mjs`
- Create: `backend/src/0_system/canvas/CanvasService.mjs`
- Create: `backend/src/0_system/canvas/drawingUtils.mjs`

**Step 1: Create CanvasService.mjs**

```javascript
/**
 * Canvas Service
 * @module 0_system/canvas/CanvasService
 *
 * System-level service for canvas instance management.
 * Handles font registration and canvas creation.
 */

import { createCanvas, registerFont } from 'canvas';
import fs from 'fs';
import path from 'path';

/**
 * Canvas service for creating and managing canvas instances
 */
export class CanvasService {
  #fontDir;
  #registeredFonts = new Set();
  #logger;

  /**
   * @param {Object} options
   * @param {string} options.fontDir - Path to fonts directory
   * @param {Object} [options.logger] - Logger instance
   */
  constructor({ fontDir, logger = console }) {
    if (!fontDir) {
      throw new Error('CanvasService requires fontDir');
    }
    this.#fontDir = fontDir;
    this.#logger = logger;
  }

  /**
   * Register a font for canvas rendering
   * @param {string} fontPath - Relative path from fontDir (e.g., 'roboto-condensed/RobotoCondensed-Regular.ttf')
   * @param {string} family - Font family name
   * @returns {boolean} Whether registration succeeded
   */
  registerFont(fontPath, family) {
    const fullPath = path.join(this.#fontDir, fontPath);
    const key = `${fullPath}:${family}`;

    if (this.#registeredFonts.has(key)) {
      return true;
    }

    if (!fs.existsSync(fullPath)) {
      this.#logger.warn?.('canvas.font.notFound', { path: fullPath });
      return false;
    }

    try {
      registerFont(fullPath, { family });
      this.#registeredFonts.add(key);
      this.#logger.debug?.('canvas.font.registered', { family, path: fullPath });
      return true;
    } catch (error) {
      this.#logger.warn?.('canvas.font.failed', { family, error: error.message });
      return false;
    }
  }

  /**
   * Create a new canvas instance
   * @param {number} width - Canvas width in pixels
   * @param {number} height - Canvas height in pixels
   * @returns {Canvas} Node-canvas instance
   */
  create(width, height) {
    return createCanvas(width, height);
  }

  /**
   * Create a canvas and return with 2D context
   * @param {number} width - Canvas width in pixels
   * @param {number} height - Canvas height in pixels
   * @returns {{ canvas: Canvas, ctx: CanvasRenderingContext2D }}
   */
  createWithContext(width, height) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    return { canvas, ctx };
  }
}

export default CanvasService;
```

**Step 2: Create drawingUtils.mjs**

```javascript
/**
 * Canvas Drawing Utilities
 * @module 0_system/canvas/drawingUtils
 *
 * Pure functions for common canvas drawing operations.
 * No state, no side effects - just drawing primitives.
 */

/**
 * Measure text width
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @returns {number}
 */
export function measureTextWidth(ctx, text) {
  return ctx.measureText(text).width;
}

/**
 * Measure text height
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @returns {number}
 */
export function measureTextHeight(ctx, text) {
  const metrics = ctx.measureText(text);
  return metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
}

/**
 * Draw a filled rectangle with optional centered label
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} options
 * @param {number} options.x
 * @param {number} options.y
 * @param {number} options.width
 * @param {number} options.height
 * @param {string} options.fillColor
 * @param {string} [options.label]
 * @param {string} [options.labelFont]
 * @param {string} [options.labelColor]
 * @param {string} [options.labelPosition] - 'center' | 'left' | 'right' | 'top' | 'bottom'
 */
export function drawRect(ctx, { x, y, width, height, fillColor, label, labelFont, labelColor = '#000', labelPosition = 'center' }) {
  if (!width || !height) return;

  ctx.save();
  ctx.fillStyle = fillColor;
  ctx.fillRect(x, y, width, height);

  if (label) {
    if (labelFont) ctx.font = labelFont;
    ctx.fillStyle = labelColor;

    const labelWidth = measureTextWidth(ctx, label);
    const labelHeight = measureTextHeight(ctx, label);

    let labelX = x + width / 2 - labelWidth / 2;
    let labelY = y + height / 2 + labelHeight / 4;

    if (/left/.test(labelPosition)) labelX = x + 4;
    else if (/right/.test(labelPosition)) labelX = x + width - labelWidth - 4;
    if (/top/.test(labelPosition)) labelY = y + labelHeight;
    else if (/bottom/.test(labelPosition)) labelY = y + height - 4;

    ctx.fillText(label, labelX, labelY);
  }
  ctx.restore();
}

/**
 * Draw a pie chart
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} options
 * @param {number} options.centerX
 * @param {number} options.centerY
 * @param {number} options.radius
 * @param {Array<{value: number, color: string, label?: string, subLabel?: string}>} options.slices
 * @param {string} [options.labelFont]
 * @param {string} [options.subLabelFont]
 */
export function drawPieChart(ctx, { centerX, centerY, radius, slices, labelFont, subLabelFont }) {
  const total = slices.reduce((acc, s) => acc + s.value, 0);
  if (total === 0) return;

  let startAngle = -Math.PI / 2;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const slice of slices) {
    const percentage = slice.value / total;
    if (percentage === 0) continue;

    const endAngle = startAngle + percentage * 2 * Math.PI;

    // Draw wedge
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = slice.color;
    ctx.fill();

    // Draw label in wedge center
    if (slice.label) {
      const midAngle = startAngle + (endAngle - startAngle) / 2;
      const labelRadius = radius * 0.6;
      const labelX = centerX + Math.cos(midAngle) * labelRadius;
      const labelY = centerY + Math.sin(midAngle) * labelRadius;

      ctx.save();
      if (labelFont) ctx.font = labelFont;
      ctx.fillStyle = '#000';
      ctx.fillText(slice.label, labelX, labelY - (slice.subLabel ? 12 : 0));

      if (slice.subLabel && subLabelFont) {
        ctx.font = subLabelFont;
        ctx.fillText(slice.subLabel, labelX, labelY + 24);
      }
      ctx.restore();
    }

    startAngle = endAngle;
  }
}

/**
 * Draw a horizontal progress bar
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} options
 * @param {number} options.x
 * @param {number} options.y
 * @param {number} options.width
 * @param {number} options.height
 * @param {number} options.progress - 0 to 1
 * @param {string} options.fillColor
 * @param {string} options.backgroundColor
 */
export function drawProgressBar(ctx, { x, y, width, height, progress, fillColor, backgroundColor }) {
  ctx.save();

  // Background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(x, y, width, height);

  // Fill
  const fillWidth = width * Math.min(Math.max(progress, 0), 1);
  if (fillWidth > 0) {
    ctx.fillStyle = fillColor;
    ctx.fillRect(x, y, fillWidth, height);
  }

  ctx.restore();
}

/**
 * Draw a dashed horizontal line
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} options
 * @param {number} options.x1
 * @param {number} options.y
 * @param {number} options.x2
 * @param {string} options.color
 * @param {number} [options.lineWidth]
 * @param {number[]} [options.dashPattern]
 */
export function drawDashedLine(ctx, { x1, y, x2, color, lineWidth = 2, dashPattern = [5, 5] }) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(dashPattern);
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Draw centered text
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} options
 * @param {string} options.text
 * @param {number} options.x - Center X position
 * @param {number} options.y
 * @param {string} [options.font]
 * @param {string} [options.color]
 */
export function drawCenteredText(ctx, { text, x, y, font, color = '#000' }) {
  ctx.save();
  if (font) ctx.font = font;
  ctx.fillStyle = color;
  const width = measureTextWidth(ctx, text);
  ctx.fillText(text, x - width / 2, y);
  ctx.restore();
}
```

**Step 3: Create index.mjs**

```javascript
/**
 * Canvas System Module
 * @module 0_system/canvas
 *
 * Exports canvas service and drawing utilities.
 */

export { CanvasService } from './CanvasService.mjs';
export * from './drawingUtils.mjs';

export default { CanvasService };
```

**Step 4: Verify files exist**

```bash
ls -la backend/src/0_system/canvas/
# Expected: CanvasService.mjs, drawingUtils.mjs, index.mjs
```

**Step 5: Commit**

```bash
git add backend/src/0_system/canvas/
git commit -m "$(cat <<'EOF'
feat(canvas): add system-level canvas service and drawing utilities

- CanvasService: font registration, canvas creation
- drawingUtils: pure drawing primitives (rect, pie, progress bar, etc.)
- Follows system layer guidelines (no domain logic)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create NutriReport Theme

**Files:**
- Create: `backend/src/2_adapters/nutribot/rendering/nutriReportTheme.mjs`

**Step 1: Extract presentation factors from NutriReportRenderer**

Create the theme file with all visual constants:

```javascript
/**
 * NutriReport Theme
 * @module 2_adapters/nutribot/rendering/nutriReportTheme
 *
 * Presentation factors for nutrition report rendering.
 * Contains all sizes, fonts, colors, and layout constants.
 */

export const nutriReportTheme = {
  // Canvas dimensions
  canvas: {
    width: 1080,
    height: 1400,
    scale: 1.2,
  },

  // Layout
  layout: {
    topMargin: 100,
    sideMargin: 54, // (width * 0.05)
    foodListWidthRatio: 0.6,
    barChartWidthRatio: 0.9,
    barChartHeight: 460,
    progressBarHeight: 48,
    pieChartPadding: 10,
    sectionGap: 30,
    statRowHeight: 45,
    lineHeight: 44,
    iconSize: 32,
    macroRectWidth: 46,
    macroRectHeight: 30,
    barWidthRatio: 0.7,
  },

  // Fonts
  fonts: {
    family: 'Roboto Condensed',
    title: '64px "Roboto Condensed"',
    subtitle: '36px "Roboto Condensed"',
    pieLabel: '48px "Roboto Condensed"',
    default: '32px "Roboto Condensed"',
    small: '20px "Roboto Condensed"',
    foodItem: '32px "Roboto Condensed"',
    macroLabel: '18px "Roboto Condensed"',
  },

  // Colors
  colors: {
    background: '#ffffff',
    text: '#000000',
    protein: '#fe938c',    // Pink/salmon
    carbs: '#a3b18a',      // Sage green
    fat: '#f6bd60',        // Golden yellow
    chartBg: '#FAF3ED',    // Light cream
    barBase: '#CCC',       // Gray base for bars
    gridLine: '#AAA',      // Grid lines
    overGoal: '#b00020',   // Red - over budget
    underGoal: '#7da87a',  // Green - under minimum
    caution: '#f6bd60',    // Yellow - approaching goal
    brand: '#666',         // Secondary text
  },

  // Nutrition constants
  nutrition: {
    defaultGoalCalories: 2000,
    minRecommendedCalories: 1200,
    caloriesPerGramProtein: 4,
    caloriesPerGramCarbs: 4,
    caloriesPerGramFat: 9,
  },

  // Chart settings
  chart: {
    barCount: 7,
    headroomMultiplier: 1.1,
  },
};

export default nutriReportTheme;
```

**Step 2: Verify file exists**

```bash
ls backend/src/2_adapters/nutribot/rendering/
# Expected: nutriReportTheme.mjs
```

**Step 3: Commit**

```bash
git add backend/src/2_adapters/nutribot/rendering/
git commit -m "$(cat <<'EOF'
feat(nutribot): add nutriReport theme with presentation factors

Extracted all visual constants from NutriReportRenderer:
- Canvas dimensions and scale
- Layout measurements
- Font definitions
- Color palette
- Nutrition constants

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Move and Refactor NutriReportRenderer

**Files:**
- Move: `backend/src/0_system/rendering/NutriReportRenderer.mjs` → `backend/src/2_adapters/nutribot/rendering/NutriReportRenderer.mjs`
- Modify: `backend/src/2_adapters/nutribot/rendering/NutriReportRenderer.mjs`

**Step 1: Move the file**

```bash
mkdir -p backend/src/2_adapters/nutribot/rendering
git mv backend/src/0_system/rendering/NutriReportRenderer.mjs backend/src/2_adapters/nutribot/rendering/
```

**Step 2: Refactor to use theme and canvas service**

Update the renderer to:
1. Import theme for all presentation constants
2. Accept CanvasService via dependency injection
3. Use drawing utilities where applicable
4. Remove hardcoded constants

Key changes to make:

```javascript
// At top of file, add imports:
import { nutriReportTheme as theme } from './nutriReportTheme.mjs';
import { drawRect, drawPieChart, measureTextWidth, measureTextHeight } from '../../../0_system/canvas/index.mjs';

// Remove hardcoded constants (TITLE_FONT, COLORS, etc.)
// Replace with theme references:
// - TITLE_FONT → theme.fonts.title
// - COLORS.background → theme.colors.background
// - width: 1080 → theme.canvas.width

// Constructor should accept canvasService (optional for backwards compat):
constructor(options = {}) {
  // ... existing validation ...
  this.#canvasService = options.canvasService; // Optional
}

// Update createCanvas calls to use service if available:
const canvas = this.#canvasService
  ? this.#canvasService.create(width, height)
  : createCanvas(width, height);
```

**Step 3: Verify the move**

```bash
ls backend/src/2_adapters/nutribot/rendering/
# Expected: NutriReportRenderer.mjs, nutriReportTheme.mjs
```

**Step 4: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(nutribot): move NutriReportRenderer to adapters layer

- Moved from 0_system/rendering/ to 2_adapters/nutribot/rendering/
- Imports theme for presentation factors
- Accepts optional CanvasService for canvas creation
- Uses drawing utilities where applicable

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Create PrayerCard Theme

**Files:**
- Create: `backend/src/2_adapters/gratitude/rendering/prayerCardTheme.mjs`

**Step 1: Extract presentation factors from PrayerCardRenderer**

```javascript
/**
 * Prayer Card Theme
 * @module 2_adapters/gratitude/rendering/prayerCardTheme
 *
 * Presentation factors for prayer card rendering.
 * Contains all sizes, fonts, colors, and layout constants.
 */

export const prayerCardTheme = {
  // Canvas dimensions
  canvas: {
    width: 580,
    height: 600,
  },

  // Layout
  layout: {
    margin: 25,
    borderWidth: 3,
    borderOffset: 10,
    lineHeight: 42,
    headerYOffset: 5,
    headerHeight: 85,
    timestampHeight: 35,
    dividerHeight: 2,
    sectionGap: 15,
    sectionHeaderHeight: 65,
    bulletIndent: 15,
  },

  // Fonts
  fonts: {
    family: 'Roboto Condensed',
    fontPath: 'roboto-condensed/RobotoCondensed-Regular.ttf',
    header: 'bold 72px "Roboto Condensed"',
    timestamp: '24px "Roboto Condensed"',
    sectionHeader: 'bold 48px "Roboto Condensed"',
    item: '36px "Roboto Condensed"',
  },

  // Colors
  colors: {
    background: '#FFFFFF',
    text: '#000000',
    border: '#000000',
  },

  // Selection settings
  selection: {
    gratitudeCount: 2,
    hopesCount: 2,
  },
};

export default prayerCardTheme;
```

**Step 2: Verify file exists**

```bash
mkdir -p backend/src/2_adapters/gratitude/rendering
ls backend/src/2_adapters/gratitude/rendering/
# Expected: prayerCardTheme.mjs
```

**Step 3: Commit**

```bash
git add backend/src/2_adapters/gratitude/rendering/
git commit -m "$(cat <<'EOF'
feat(gratitude): add prayerCard theme with presentation factors

Extracted all visual constants for prayer card rendering:
- Canvas dimensions
- Layout measurements (margins, spacing)
- Font definitions
- Colors
- Selection counts

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Move and Refactor PrayerCardRenderer

**Files:**
- Move: `backend/src/0_system/rendering/PrayerCardRenderer.mjs` → `backend/src/2_adapters/gratitude/rendering/PrayerCardRenderer.mjs`
- Modify: `backend/src/2_adapters/gratitude/rendering/PrayerCardRenderer.mjs`

**Step 1: Move the file**

```bash
git mv backend/src/0_system/rendering/PrayerCardRenderer.mjs backend/src/2_adapters/gratitude/rendering/
```

**Step 2: Refactor to use theme**

Update the renderer to:
1. Import theme for all presentation constants
2. Accept optional CanvasService
3. Replace hardcoded values with theme references

Key changes:

```javascript
// At top of file:
import { prayerCardTheme as theme } from './prayerCardTheme.mjs';

// In createPrayerCardRenderer:
export function createPrayerCardRenderer(config) {
  const { getSelectionsForPrint, fontDir, canvasService } = config;

  async function createCanvas(upsidedown = false) {
    const { width, height } = theme.canvas;
    // ... use theme.fonts.*, theme.colors.*, theme.layout.*
  }
}
```

**Step 3: Verify the move**

```bash
ls backend/src/2_adapters/gratitude/rendering/
# Expected: PrayerCardRenderer.mjs, prayerCardTheme.mjs
```

**Step 4: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(gratitude): move PrayerCardRenderer to adapters layer

- Moved from 0_system/rendering/ to 2_adapters/gratitude/rendering/
- Imports theme for presentation factors
- Accepts optional CanvasService
- selectItemsForPrint algorithm stays with renderer (domain logic)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update Import Paths in app.mjs

**Files:**
- Modify: `backend/src/app.mjs`

**Step 1: Find current imports**

```bash
grep -n "rendering/NutriReportRenderer\|rendering/PrayerCardRenderer" backend/src/app.mjs
```

**Step 2: Update import paths**

Change:
```javascript
// FROM:
import('./0_system/rendering/PrayerCardRenderer.mjs')
import('./0_system/rendering/NutriReportRenderer.mjs')

// TO:
import('./2_adapters/gratitude/rendering/PrayerCardRenderer.mjs')
import('./2_adapters/nutribot/rendering/NutriReportRenderer.mjs')
```

**Step 3: Verify imports work**

```bash
node -e "import('./backend/src/2_adapters/gratitude/rendering/PrayerCardRenderer.mjs').then(m => console.log('PrayerCard OK'))"
node -e "import('./backend/src/2_adapters/nutribot/rendering/NutriReportRenderer.mjs').then(m => console.log('NutriReport OK'))"
```

**Step 4: Commit**

```bash
git add backend/src/app.mjs
git commit -m "$(cat <<'EOF'
refactor(app): update renderer imports to adapters layer

- PrayerCardRenderer → 2_adapters/gratitude/rendering/
- NutriReportRenderer → 2_adapters/nutribot/rendering/

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Remove Empty System Rendering Directory

**Files:**
- Remove: `backend/src/0_system/rendering/` (if empty)

**Step 1: Check if directory is empty**

```bash
ls backend/src/0_system/rendering/
```

**Step 2: Remove if empty**

```bash
# Only if empty:
rmdir backend/src/0_system/rendering/
```

**Step 3: Commit if removed**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: remove empty 0_system/rendering directory

Renderers moved to domain-specific adapter folders.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Create Adapter Index Files

**Files:**
- Create: `backend/src/2_adapters/nutribot/rendering/index.mjs`
- Create: `backend/src/2_adapters/gratitude/rendering/index.mjs`

**Step 1: Create nutribot rendering index**

```javascript
/**
 * Nutribot Rendering Module
 * @module 2_adapters/nutribot/rendering
 */

export { NutriReportRenderer } from './NutriReportRenderer.mjs';
export { nutriReportTheme } from './nutriReportTheme.mjs';
```

**Step 2: Create gratitude rendering index**

```javascript
/**
 * Gratitude Rendering Module
 * @module 2_adapters/gratitude/rendering
 */

export { createPrayerCardRenderer, selectItemsForPrint } from './PrayerCardRenderer.mjs';
export { prayerCardTheme } from './prayerCardTheme.mjs';
```

**Step 3: Commit**

```bash
git add backend/src/2_adapters/nutribot/rendering/index.mjs backend/src/2_adapters/gratitude/rendering/index.mjs
git commit -m "$(cat <<'EOF'
feat(adapters): add rendering module index files

Provides clean exports for renderer modules:
- nutribot: NutriReportRenderer, theme
- gratitude: createPrayerCardRenderer, selectItemsForPrint, theme

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Verify and Test

**Step 1: Check for any remaining references to old paths**

```bash
grep -r "0_system/rendering" backend/src/
# Expected: No output
```

**Step 2: Run tests**

```bash
npm test
```

**Step 3: Start dev server and verify**

```bash
node backend/index.js
# Verify no import errors in logs
# Check that renderers initialize properly
```

**Step 4: Final commit if any fixes needed**

```bash
git status
# If clean, no action needed
```

---

## Summary

After completion:

```
backend/src/
├── 0_system/
│   └── canvas/
│       ├── index.mjs           # Module exports
│       ├── CanvasService.mjs   # Canvas creation, font registration
│       └── drawingUtils.mjs    # Pure drawing primitives
│
└── 2_adapters/
    ├── nutribot/
    │   └── rendering/
    │       ├── index.mjs
    │       ├── NutriReportRenderer.mjs  # Domain renderer
    │       └── nutriReportTheme.mjs     # Presentation factors
    │
    └── gratitude/
        └── rendering/
            ├── index.mjs
            ├── PrayerCardRenderer.mjs   # Domain renderer
            └── prayerCardTheme.mjs      # Presentation factors
```

**Benefits achieved:**
1. System layer contains only pure canvas utilities (no domain logic)
2. Renderers live in domain-specific adapter folders
3. Presentation factors (sizes, fonts, colors) separated into theme files
4. Themes are pure data - easy to modify, test, review
5. Renderers focus on composition logic, not magic numbers

---

## Out of Scope

- Macro calculations in renderers (already in applications layer via use cases)
- Legacy code updates
- Additional renderer refactoring beyond theme extraction

---

## Rollback

If issues arise:
```bash
git revert HEAD~N  # Where N is number of commits to revert
```
