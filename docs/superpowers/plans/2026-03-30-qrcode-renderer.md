# QR Code Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a styled SVG QR code generator with dot-style modules, center logo, frame, labels, and option badges — served via API with raw, content, and command modes.

**Architecture:** The `qrcode` npm package generates the raw binary matrix. A custom SVG renderer in `1_rendering/qrcode/` builds styled output (dots, finder patterns, logo, frame, labels). An Express router in `4_api/v1/routers/qrcode.mjs` handles three modes: raw data encoding, content metadata resolution (via existing info/queue APIs), and command auto-detection (via `BarcodeCommandMap`).

**Tech Stack:** Node.js (ES modules), `qrcode` npm package, Express, SVG, Jest

**Spec:** `docs/superpowers/specs/2026-03-30-qrcode-renderer-design.md`

---

## File Structure

| Layer | File | Change | Responsibility |
|-------|------|--------|----------------|
| Rendering | `backend/src/1_rendering/qrcode/index.mjs` | Create | Export `createQRCodeRenderer` |
| Rendering | `backend/src/1_rendering/qrcode/QRCodeRenderer.mjs` | Create | Factory — matrix generation, SVG rendering (dots, finders, logo, frame, labels) |
| Rendering | `backend/src/1_rendering/qrcode/qrcodeTheme.mjs` | Create | Default theme constants |
| API | `backend/src/4_api/v1/routers/qrcode.mjs` | Create | Express router — raw/content/command modes |
| API | `backend/src/4_api/v1/routers/api.mjs` | Modify | Add `/qrcode` to route map |
| System | `backend/src/app.mjs` | Modify | Create renderer, wire to router, mount |
| Test | `tests/isolated/rendering/qrcode/QRCodeRenderer.test.mjs` | Create | Renderer unit tests |
| Test | `tests/isolated/api/qrcode-router.test.mjs` | Create | Router logic tests |

---

### Task 1: Install qrcode package

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the qrcode npm package**

```bash
npm install qrcode
```

- [ ] **Step 2: Verify it works**

```bash
node -e "const QRCode = require('qrcode'); const qr = QRCode.create('test', { errorCorrectionLevel: 'H' }); console.log('modules:', qr.modules.size, 'data length:', qr.modules.data.length);"
```

Expected output: `modules: 25 data length: 625` (25x25 matrix for short data at H level)

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add qrcode npm package for QR matrix generation"
```

---

### Task 2: Theme constants

**Files:**
- Create: `backend/src/1_rendering/qrcode/qrcodeTheme.mjs`

- [ ] **Step 1: Create the theme file**

```javascript
// backend/src/1_rendering/qrcode/qrcodeTheme.mjs

/**
 * Default theme for QR code SVG rendering.
 * @module rendering/qrcode/qrcodeTheme
 */
export const qrcodeTheme = {
  // QR code area
  qr: {
    size: 300,            // Default QR code size in pixels
    margin: 20,           // Margin around QR inside frame
    dotScale: 0.85,       // Dot radius as fraction of half module size (< 1 = spacing between dots)
    errorCorrection: 'H', // H = 30% redundancy, allows logo overlay
  },

  // Finder patterns (3 corner squares)
  finder: {
    outerRadius: 4,       // Border radius on outer rect
    innerRadius: 2,       // Border radius on inner rect
  },

  // Center logo
  logo: {
    sizeRatio: 0.22,      // Logo diameter as fraction of QR size
    padding: 4,           // White padding around logo
    borderRadius: '50%',  // Circular clip
  },

  // Frame (outer border)
  frame: {
    borderRadius: 12,
    strokeWidth: 2,
    strokeColor: '#e0e0e0',
  },

  // Label area
  label: {
    height: 60,           // Space below QR for labels
    fontSize: 16,
    sublabelFontSize: 12,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    lineSpacing: 20,
    color: '#000000',
    sublabelColor: '#666666',
  },

  // Option badges
  badge: {
    iconSize: 14,
    gap: 4,
  },

  // Colors
  colors: {
    foreground: '#000000',
    background: '#ffffff',
  },
};

export default qrcodeTheme;
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/1_rendering/qrcode/qrcodeTheme.mjs
git commit -m "feat(qrcode): add default theme constants"
```

---

### Task 3: QRCodeRenderer — core SVG generation

**Files:**
- Create: `backend/src/1_rendering/qrcode/QRCodeRenderer.mjs`
- Create: `tests/isolated/rendering/qrcode/QRCodeRenderer.test.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/isolated/rendering/qrcode/QRCodeRenderer.test.mjs
import { describe, it, expect, beforeAll } from '@jest/globals';
import { createQRCodeRenderer } from '../../../../backend/src/1_rendering/qrcode/QRCodeRenderer.mjs';

describe('QRCodeRenderer', () => {
  let renderer;

  beforeAll(() => {
    renderer = createQRCodeRenderer({ mediaPath: '/tmp' });
  });

  describe('renderSvg', () => {
    it('returns a valid SVG string', () => {
      const svg = renderer.renderSvg('test-data');
      expect(svg).toContain('<svg');
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('</svg>');
    });

    it('contains circle elements for dot style', () => {
      const svg = renderer.renderSvg('test-data', { style: 'dots' });
      expect(svg).toContain('<circle');
    });

    it('contains rect elements for square style', () => {
      const svg = renderer.renderSvg('test-data', { style: 'squares' });
      // Squares style uses rect for data modules
      expect(svg).toMatch(/<rect[^>]*class="module"/);
    });

    it('renders finder patterns as rounded rects', () => {
      const svg = renderer.renderSvg('test-data');
      // Finder patterns have rx attribute for rounded corners
      expect(svg).toMatch(/<rect[^>]*class="finder"/);
    });

    it('respects custom foreground and background colors', () => {
      const svg = renderer.renderSvg('test-data', { fg: '#ff0000', bg: '#00ff00' });
      expect(svg).toContain('fill="#ff0000"');
      expect(svg).toContain('fill="#00ff00"');
    });

    it('respects custom size', () => {
      const svg = renderer.renderSvg('test-data', { size: 500 });
      expect(svg).toContain('width="540"'); // size + 2*margin
    });

    it('includes label text when provided', () => {
      const svg = renderer.renderSvg('test-data', { label: 'My Label' });
      expect(svg).toContain('My Label');
    });

    it('includes sublabel text when provided', () => {
      const svg = renderer.renderSvg('test-data', { label: 'Title', sublabel: 'Subtitle' });
      expect(svg).toContain('Subtitle');
    });

    it('skips logo area modules when logo is disabled', () => {
      const svgWithLogo = renderer.renderSvg('test-data-1234567890', { logo: false });
      const svgDefault = renderer.renderSvg('test-data-1234567890');
      // With logo disabled, more modules are rendered (no center mask)
      const dotsWithout = (svgWithLogo.match(/<circle/g) || []).length;
      const dotsWith = (svgDefault.match(/<circle/g) || []).length;
      expect(dotsWithout).toBeGreaterThanOrEqual(dotsWith);
    });

    it('embeds logo image when logoData is provided', () => {
      const svg = renderer.renderSvg('test-data', {
        logoData: 'data:image/png;base64,iVBOR',
      });
      expect(svg).toContain('<image');
      expect(svg).toContain('data:image/png;base64,iVBOR');
      expect(svg).toContain('clipPath');
    });

    it('adds option badge SVGs when options provided', () => {
      const svg = renderer.renderSvg('test-data', {
        label: 'Test',
        optionBadges: ['<path d="M10 10"/>'],
      });
      expect(svg).toContain('M10 10');
    });

    it('increases total height when label is present', () => {
      const svgNoLabel = renderer.renderSvg('test-data');
      const svgWithLabel = renderer.renderSvg('test-data', { label: 'Title' });
      // Extract height from SVG
      const heightNo = parseInt(svgNoLabel.match(/height="(\d+)"/)[1]);
      const heightWith = parseInt(svgWithLabel.match(/height="(\d+)"/)[1]);
      expect(heightWith).toBeGreaterThan(heightNo);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/isolated/rendering/qrcode/QRCodeRenderer.test.mjs --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write the QRCodeRenderer implementation**

```javascript
// backend/src/1_rendering/qrcode/QRCodeRenderer.mjs

/**
 * QRCodeRenderer - Generates styled SVG QR codes.
 *
 * Uses the `qrcode` npm package for matrix generation and renders
 * custom SVG with dot-style modules, rounded finder patterns,
 * center logo, frame, labels, and option badges.
 *
 * @module rendering/qrcode/QRCodeRenderer
 */

import QRCode from 'qrcode';
import { qrcodeTheme } from './qrcodeTheme.mjs';

/**
 * Create a QR code renderer.
 * @param {Object} config
 * @param {string} [config.mediaPath] - Path to media directory (for icon loading)
 * @returns {{ renderSvg: (data: string, options?: Object) => string }}
 */
export function createQRCodeRenderer(config = {}) {
  const theme = qrcodeTheme;

  /**
   * Render a QR code as an SVG string.
   * @param {string} data - Data to encode
   * @param {Object} [options]
   * @param {number} [options.size=300] - QR code size in pixels
   * @param {string} [options.style='dots'] - 'dots' or 'squares'
   * @param {string} [options.fg='#000000'] - Foreground color
   * @param {string} [options.bg='#ffffff'] - Background color
   * @param {string} [options.label] - Primary label text
   * @param {string} [options.sublabel] - Secondary label text
   * @param {string|false} [options.logoData] - Base64 data URI for logo, or false to disable
   * @param {boolean} [options.logo=true] - Enable/disable logo area masking
   * @param {string[]} [options.optionBadges] - SVG path strings for option badges
   * @returns {string} SVG markup
   */
  function renderSvg(data, options = {}) {
    const size = options.size || theme.qr.size;
    const style = options.style || 'dots';
    const fg = options.fg || theme.colors.foreground;
    const bg = options.bg || theme.colors.background;
    const margin = theme.qr.margin;
    const logoEnabled = options.logo !== false;
    const logoData = options.logoData || null;
    const label = options.label || null;
    const sublabel = options.sublabel || null;
    const optionBadges = options.optionBadges || [];

    // Generate QR matrix
    const qr = QRCode.create(data, {
      errorCorrectionLevel: theme.qr.errorCorrection,
    });
    const modules = qr.modules;
    const moduleCount = modules.size;
    const moduleSize = size / moduleCount;

    // Calculate SVG dimensions
    const totalWidth = size + margin * 2;
    const labelHeight = label ? theme.label.height : 0;
    const totalHeight = size + margin * 2 + labelHeight;

    // Logo mask area (center circle)
    const logoRadius = logoEnabled ? (size * theme.logo.sizeRatio) / 2 : 0;
    const centerX = size / 2;
    const centerY = size / 2;

    // Build SVG parts
    const parts = [];

    // SVG header
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">`);

    // Frame background
    parts.push(`<rect width="${totalWidth}" height="${totalHeight}" rx="${theme.frame.borderRadius}" fill="${bg}" stroke="${theme.frame.strokeColor}" stroke-width="${theme.frame.strokeWidth}"/>`);

    // QR code group (offset by margin)
    parts.push(`<g transform="translate(${margin}, ${margin})">`);

    // Render data modules
    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (!modules.get(row, col)) continue;

        // Skip finder pattern areas (rendered separately)
        if (isFinderPattern(row, col, moduleCount)) continue;

        const x = col * moduleSize + moduleSize / 2;
        const y = row * moduleSize + moduleSize / 2;

        // Skip modules inside logo mask
        if (logoEnabled) {
          const dx = x - centerX;
          const dy = y - centerY;
          if (Math.sqrt(dx * dx + dy * dy) < logoRadius + theme.logo.padding) continue;
        }

        if (style === 'dots') {
          const r = (moduleSize / 2) * theme.qr.dotScale;
          parts.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}" fill="${fg}"/>`);
        } else {
          const rectSize = moduleSize * theme.qr.dotScale;
          const offset = (moduleSize - rectSize) / 2;
          parts.push(`<rect class="module" x="${(col * moduleSize + offset).toFixed(2)}" y="${(row * moduleSize + offset).toFixed(2)}" width="${rectSize.toFixed(2)}" height="${rectSize.toFixed(2)}" fill="${fg}"/>`);
        }
      }
    }

    // Render finder patterns
    renderFinderPattern(parts, 0, 0, moduleSize, fg, bg);
    renderFinderPattern(parts, 0, moduleCount - 7, moduleSize, fg, bg);
    renderFinderPattern(parts, moduleCount - 7, 0, moduleSize, fg, bg);

    // Render logo
    if (logoEnabled && logoData) {
      const logoSize = logoRadius * 2;
      const logoX = centerX - logoRadius;
      const logoY = centerY - logoRadius;

      // White circle background
      parts.push(`<circle cx="${centerX.toFixed(2)}" cy="${centerY.toFixed(2)}" r="${(logoRadius + theme.logo.padding).toFixed(2)}" fill="${bg}"/>`);

      // Clip path for circular logo
      parts.push(`<defs><clipPath id="logo-clip"><circle cx="${centerX.toFixed(2)}" cy="${centerY.toFixed(2)}" r="${logoRadius.toFixed(2)}"/></clipPath></defs>`);

      // Logo image
      parts.push(`<image href="${escapeAttr(logoData)}" x="${logoX.toFixed(2)}" y="${logoY.toFixed(2)}" width="${logoSize.toFixed(2)}" height="${logoSize.toFixed(2)}" clip-path="url(#logo-clip)" preserveAspectRatio="xMidYMid slice"/>`);
    } else if (logoEnabled) {
      // White circle placeholder (modules already masked)
      parts.push(`<circle cx="${centerX.toFixed(2)}" cy="${centerY.toFixed(2)}" r="${(logoRadius + theme.logo.padding).toFixed(2)}" fill="${bg}"/>`);
    }

    parts.push('</g>'); // Close QR group

    // Label area
    if (label) {
      const labelY = size + margin * 2 + theme.label.fontSize + 4;
      parts.push(`<text x="${totalWidth / 2}" y="${labelY}" text-anchor="middle" font-family="${theme.label.fontFamily}" font-size="${theme.label.fontSize}" font-weight="bold" fill="${theme.label.color}">${escapeXml(label)}</text>`);

      if (sublabel) {
        const sublabelY = labelY + theme.label.lineSpacing;
        parts.push(`<text x="${totalWidth / 2}" y="${sublabelY}" text-anchor="middle" font-family="${theme.label.fontFamily}" font-size="${theme.label.sublabelFontSize}" fill="${theme.label.sublabelColor}">${escapeXml(sublabel)}</text>`);
      }

      // Option badges (small icons next to sublabel)
      if (optionBadges.length > 0) {
        const badgeY = labelY + (sublabel ? theme.label.lineSpacing : 0) + 4;
        const badgeStartX = totalWidth / 2 + 40;
        optionBadges.forEach((pathData, i) => {
          const bx = badgeStartX + i * (theme.badge.iconSize + theme.badge.gap);
          parts.push(`<g transform="translate(${bx}, ${badgeY - theme.badge.iconSize}) scale(${theme.badge.iconSize / 24})">${pathData}</g>`);
        });
      }
    }

    parts.push('</svg>');
    return parts.join('\n');
  }

  return { renderSvg };
}

// ─── Helpers ─────────────────────────────────────────────

function isFinderPattern(row, col, moduleCount) {
  // Top-left 7x7
  if (row < 7 && col < 7) return true;
  // Top-right 7x7
  if (row < 7 && col >= moduleCount - 7) return true;
  // Bottom-left 7x7
  if (row >= moduleCount - 7 && col < 7) return true;
  return false;
}

function renderFinderPattern(parts, startRow, startCol, moduleSize, fg, bg) {
  const { outerRadius, innerRadius } = qrcodeTheme.finder;
  const x = startCol * moduleSize;
  const y = startRow * moduleSize;
  const outerSize = 7 * moduleSize;
  const midSize = 5 * moduleSize;
  const innerSize = 3 * moduleSize;
  const midOffset = moduleSize;
  const innerOffset = 2 * moduleSize;

  // Outer dark square
  parts.push(`<rect class="finder" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${outerSize.toFixed(2)}" height="${outerSize.toFixed(2)}" rx="${outerRadius}" fill="${fg}"/>`);
  // Middle light square
  parts.push(`<rect x="${(x + midOffset).toFixed(2)}" y="${(y + midOffset).toFixed(2)}" width="${midSize.toFixed(2)}" height="${midSize.toFixed(2)}" rx="${innerRadius}" fill="${bg}"/>`);
  // Inner dark square
  parts.push(`<rect x="${(x + innerOffset).toFixed(2)}" y="${(y + innerOffset).toFixed(2)}" width="${innerSize.toFixed(2)}" height="${innerSize.toFixed(2)}" rx="${innerRadius}" fill="${fg}"/>`);
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/rendering/qrcode/QRCodeRenderer.test.mjs --no-coverage`
Expected: All 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_rendering/qrcode/QRCodeRenderer.mjs tests/isolated/rendering/qrcode/QRCodeRenderer.test.mjs
git commit -m "feat(qrcode): add QRCodeRenderer with dot-style SVG generation"
```

---

### Task 4: Renderer index export

**Files:**
- Create: `backend/src/1_rendering/qrcode/index.mjs`

- [ ] **Step 1: Create the index file**

```javascript
// backend/src/1_rendering/qrcode/index.mjs
export { createQRCodeRenderer } from './QRCodeRenderer.mjs';
export { qrcodeTheme } from './qrcodeTheme.mjs';
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/1_rendering/qrcode/index.mjs
git commit -m "feat(qrcode): add renderer index export"
```

---

### Task 5: API Router — raw mode and command auto-detect

**Files:**
- Create: `backend/src/4_api/v1/routers/qrcode.mjs`

- [ ] **Step 1: Create the router**

```javascript
// backend/src/4_api/v1/routers/qrcode.mjs

/**
 * QR Code API Router
 *
 * Generates styled SVG QR codes with three modes:
 * - Raw: encode any string
 * - Content: resolve contentId metadata for label/logo
 * - Command: auto-detect barcode commands, use matching icon
 *
 * @module api/v1/routers/qrcode
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { KNOWN_COMMANDS } from '#domains/barcode/BarcodeCommandMap.mjs';

const COMMAND_ICON_MAP = {
  pause: 'pause.svg',
  play: 'play.svg',
  next: 'next.svg',
  prev: 'prev.svg',
  ffw: 'ffw.svg',
  rew: 'rew.svg',
  stop: 'stop.svg',
  off: 'off.svg',
  blackout: 'blackout.svg',
  volume: 'vol_up.svg',
  speed: 'speed.svg',
};

const OPTION_ICON_MAP = {
  shuffle: 'shuffle.svg',
  continuous: 'continuous.svg',
};

/**
 * @param {Object} config
 * @param {Object} config.renderer - QRCodeRenderer instance
 * @param {Object} [config.contentIdResolver] - ContentIdResolver for content mode
 * @param {string} config.mediaPath - Path to media directory
 * @param {string} [config.defaultLogoPath] - Path to default logo (favicon)
 * @param {Object} [config.logger]
 */
export function createQRCodeRouter(config) {
  const { renderer, contentIdResolver, mediaPath, defaultLogoPath, logger = console } = config;
  const router = express.Router();

  const buttonsDir = path.join(mediaPath, 'img/buttons');

  /**
   * GET /api/v1/qrcode
   */
  router.get('/', async (req, res) => {
    try {
      const {
        data,
        content,
        options: optionsStr,
        screen,
        label: labelOverride,
        sublabel: sublabelOverride,
        logo: logoParam,
        size: sizeParam,
        style,
        fg,
        bg,
      } = req.query;

      if (!data && !content) {
        return res.status(400).json({ error: 'Either "data" or "content" query param is required' });
      }

      let encodeData;
      let label = labelOverride || null;
      let sublabel = sublabelOverride || null;
      let logoData = null;
      let optionBadges = [];
      const size = sizeParam ? parseInt(sizeParam, 10) : undefined;

      if (content) {
        // ── Content mode ──────────────────────────────────
        const result = await resolveContent({
          contentId: content,
          options: optionsStr,
          screen,
          contentIdResolver,
          mediaPath,
          logger,
        });

        encodeData = result.encodeData;
        if (!label) label = result.label;
        if (!sublabel) sublabel = result.sublabel;
        if (result.logoData) logoData = result.logoData;
        optionBadges = result.optionBadges || [];

      } else {
        // ── Raw / Command mode ────────────────────────────
        encodeData = data;

        // Normalize delimiters for command detection
        const normalized = data.replace(/[; ]/g, ':');
        const segments = normalized.split(':');

        // Check for command auto-detect
        const commandMatch = detectCommand(segments);
        if (commandMatch) {
          if (!label) label = commandMatch.label;
          logoData = loadCommandIcon(commandMatch.command, buttonsDir);
        }

        // Check for option badges in raw data
        const plusIdx = data.indexOf('+');
        if (plusIdx !== -1) {
          const opts = data.slice(plusIdx + 1).split('+').filter(Boolean);
          optionBadges = loadOptionBadges(opts, buttonsDir);
        }
      }

      // Load default logo if none resolved
      if (logoData === null && logoParam !== 'false') {
        logoData = loadDefaultLogo(defaultLogoPath || path.join(mediaPath, 'img/favicon.ico'));
      }

      const svg = renderer.renderSvg(encodeData, {
        size,
        style,
        fg,
        bg,
        label,
        sublabel,
        logoData: logoParam === 'false' ? false : logoData,
        logo: logoParam !== 'false',
        optionBadges,
      });

      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(svg);

    } catch (err) {
      logger.error?.('qrcode.render.failed', { error: err.message });
      res.status(500).json({ error: 'QR code generation failed' });
    }
  });

  return router;
}

// ─── Helpers ─────────────────────────────────────────────

function detectCommand(segments) {
  // 1 segment: bare command
  if (segments.length === 1 && KNOWN_COMMANDS.includes(segments[0])) {
    return { command: segments[0], label: segments[0].toUpperCase() };
  }
  // 2 segments: command:arg or screen:command
  if (segments.length === 2) {
    if (KNOWN_COMMANDS.includes(segments[0])) {
      return { command: segments[0], label: `${segments[0].toUpperCase()} ${segments[1]}` };
    }
    if (KNOWN_COMMANDS.includes(segments[1])) {
      return { command: segments[1], label: segments[1].toUpperCase() };
    }
  }
  // 3 segments: screen:command:arg
  if (segments.length === 3 && KNOWN_COMMANDS.includes(segments[1])) {
    return { command: segments[1], label: `${segments[1].toUpperCase()} ${segments[2]}` };
  }
  return null;
}

function loadCommandIcon(command, buttonsDir) {
  const iconFile = COMMAND_ICON_MAP[command];
  if (!iconFile) return null;
  const iconPath = path.join(buttonsDir, iconFile);
  try {
    const svgContent = fs.readFileSync(iconPath, 'utf-8');
    return `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`;
  } catch {
    return null;
  }
}

function loadOptionBadges(opts, buttonsDir) {
  const badges = [];
  for (const opt of opts) {
    const key = opt.split('=')[0];
    const iconFile = OPTION_ICON_MAP[key];
    if (!iconFile) continue;
    const iconPath = path.join(buttonsDir, iconFile);
    try {
      const svgContent = fs.readFileSync(iconPath, 'utf-8');
      // Extract the path/content inside the SVG for inline embedding
      const pathMatch = svgContent.match(/<path[^>]*\/>/g);
      if (pathMatch) badges.push(pathMatch.join(''));
    } catch {
      // Skip missing icons
    }
  }
  return badges;
}

function loadDefaultLogo(logoPath) {
  try {
    const buf = fs.readFileSync(logoPath);
    const ext = path.extname(logoPath).slice(1);
    const mime = ext === 'ico' ? 'image/x-icon' : ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

async function resolveContent({ contentId, options, screen, contentIdResolver, mediaPath, logger }) {
  let encodeData = contentId;
  let label = null;
  let sublabel = null;
  let logoData = null;
  let optionBadges = [];

  // Build encode string with screen prefix and options
  if (screen) encodeData = `${screen}:${encodeData}`;
  if (options) {
    encodeData = `${encodeData}+${options}`;
    const opts = options.split('+').filter(Boolean);
    const buttonsDir = path.join(mediaPath, 'img/buttons');
    optionBadges = loadOptionBadges(opts, buttonsDir);
  }

  if (!contentIdResolver) {
    return { encodeData, label, sublabel, logoData, optionBadges };
  }

  try {
    // Resolve content metadata
    const resolved = contentIdResolver.resolve(contentId);
    if (!resolved?.adapter) {
      logger.warn?.('qrcode.content.unresolved', { contentId });
      return { encodeData, label, sublabel, logoData, optionBadges };
    }

    const item = await resolved.adapter.getItem(resolved.localId);
    if (!item) {
      logger.warn?.('qrcode.content.notFound', { contentId });
      return { encodeData, label, sublabel, logoData, optionBadges };
    }

    // Extract metadata for labels
    const meta = item.metadata || {};
    const type = meta.type || item.itemType || 'unknown';

    // Auto-generate label from content type
    switch (type) {
      case 'movie':
        label = item.title;
        sublabel = meta.year ? String(meta.year) : null;
        break;
      case 'episode':
        label = meta.grandparentTitle || item.title;
        sublabel = meta.parentIndex != null && meta.itemIndex != null
          ? `S${String(meta.parentIndex).padStart(2, '0')}E${String(meta.itemIndex).padStart(2, '0')} — ${item.title}`
          : item.title;
        break;
      case 'track':
        label = meta.album || meta.parentTitle || item.title;
        sublabel = meta.artist || meta.grandparentTitle || null;
        break;
      case 'album':
        label = item.title;
        sublabel = meta.artist || meta.grandparentTitle || meta.parentTitle || null;
        break;
      case 'artist':
        label = item.title;
        sublabel = meta.librarySectionTitle || null;
        break;
      default:
        label = item.title;
        sublabel = meta.parentTitle || null;
    }

    // Fetch thumbnail for logo
    const thumbUrl = item.thumbnail || meta.thumbnail;
    if (thumbUrl) {
      logoData = await fetchThumbnailAsBase64(thumbUrl, logger);
    }

  } catch (err) {
    logger.warn?.('qrcode.content.error', { contentId, error: err.message });
  }

  return { encodeData, label, sublabel, logoData, optionBadges };
}

async function fetchThumbnailAsBase64(url, logger) {
  try {
    // Internal URL — fetch from self
    const baseUrl = `http://localhost:${process.env.PORT || 3111}`;
    const fullUrl = url.startsWith('/') ? `${baseUrl}${url}` : url;
    const response = await fetch(fullUrl);
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch (err) {
    logger.debug?.('qrcode.thumbnail.fetchFailed', { url, error: err.message });
    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/4_api/v1/routers/qrcode.mjs
git commit -m "feat(qrcode): add API router with raw, content, and command modes"
```

---

### Task 6: Bootstrap wiring and route mount

**Files:**
- Modify: `backend/src/app.mjs`
- Modify: `backend/src/4_api/v1/routers/api.mjs`

- [ ] **Step 1: Add route to api.mjs route map**

In `backend/src/4_api/v1/routers/api.mjs`, add `'/qrcode': 'qrcode'` to the `routeMap` object, after the `'/weekly-review': 'weekly-review'` line:

```javascript
    '/weekly-review': 'weekly-review',
    '/qrcode': 'qrcode'
```

- [ ] **Step 2: Wire renderer and router in app.mjs**

Add import near the other rendering imports:

```javascript
import { createQRCodeRenderer } from '#rendering/qrcode/QRCodeRenderer.mjs';
import { createQRCodeRouter } from '#api/v1/routers/qrcode.mjs';
```

Note: Check how `#rendering` alias is configured. If it doesn't exist, use a relative path like `'./1_rendering/qrcode/QRCodeRenderer.mjs'`.

After the gratitude router wiring block (around line 1328), add:

```javascript
  // QR Code renderer and router
  const qrcodeRenderer = createQRCodeRenderer({ mediaPath: mediaBasePath });
  v1Routers.qrcode = createQRCodeRouter({
    renderer: qrcodeRenderer,
    contentIdResolver,
    mediaPath: mediaBasePath,
    defaultLogoPath: `${mediaBasePath}/img/favicon.ico`,
    logger: rootLogger.child({ module: 'qrcode' }),
  });
```

Verify `mediaBasePath` and `contentIdResolver` are in scope at this point in the file. Search for where they're defined to confirm.

- [ ] **Step 3: Commit**

```bash
git add backend/src/app.mjs backend/src/4_api/v1/routers/api.mjs
git commit -m "feat(qrcode): wire renderer and router in bootstrap"
```

---

### Task 7: Integration test — verify endpoint works

**Files:** None created — manual verification.

- [ ] **Step 1: Run all QR code tests**

```bash
npx jest tests/isolated/rendering/qrcode/ --no-coverage
```

Expected: All tests PASS

- [ ] **Step 2: Start dev server and test raw mode**

```bash
curl -s "http://localhost:3112/api/v1/qrcode?data=test-data&label=Test" | head -5
```

Expected: SVG output starting with `<svg`

- [ ] **Step 3: Test command auto-detect**

```bash
curl -s "http://localhost:3112/api/v1/qrcode?data=pause" | head -5
```

Expected: SVG with "PAUSE" label

- [ ] **Step 4: Test content mode**

```bash
curl -s "http://localhost:3112/api/v1/qrcode?content=plex:595084&screen=office&options=shuffle" | head -5
```

Expected: SVG with album title label and thumbnail logo

- [ ] **Step 5: Commit any fixes**

```bash
git status
# If fixes were needed, commit them
```

---

### Task 8: Documentation

**Files:**
- Modify: `docs/reference/integrations/barcode-screen-pipeline.md`

- [ ] **Step 1: Add QR code generation section**

Add a section to the barcode pipeline reference doc after the "Testing" section:

```markdown
## QR Code Generation

Generate styled SVG QR codes for barcode cards via the API.

### API

```
# Raw mode — encode any string
GET /api/v1/qrcode?data=office;plex;595104+shuffle&label=My+Album

# Content mode — auto-resolve metadata
GET /api/v1/qrcode?content=plex:595104&screen=office&options=shuffle

# Command — auto-detect icon
GET /api/v1/qrcode?data=pause
GET /api/v1/qrcode?data=office;volume;30
```

Response: `Content-Type: image/svg+xml`

### Parameters

| Param | Default | Description |
|-------|---------|-------------|
| `data` | — | Raw string to encode |
| `content` | — | ContentId to resolve metadata |
| `options` | — | Content options (`shuffle`, `shader=dark`) |
| `screen` | — | Screen prefix |
| `label` | auto | Override label |
| `sublabel` | auto | Override sublabel |
| `logo` | favicon | Logo path or `false` |
| `size` | 300 | QR size in pixels |
| `style` | dots | `dots` or `squares` |
| `fg` | #000 | Foreground color |
| `bg` | #fff | Background color |
```

- [ ] **Step 2: Commit**

```bash
git add docs/reference/integrations/barcode-screen-pipeline.md
git commit -m "docs: add QR code generation API to pipeline reference"
```
