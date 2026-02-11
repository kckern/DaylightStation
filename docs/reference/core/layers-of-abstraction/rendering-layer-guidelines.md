# Rendering Layer Guidelines

> Guidelines for `backend/src/1_rendering/` - the server-side presentation layer in DDD architecture.

---

## Core Principle

**The rendering layer produces visual output for non-browser targets (thermal printer, PDF) using shared primitives and domain data received via dependency injection.**

Rendering is a server-side presentation concern — parallel to what `frontend/` does for browsers, but targeting output formats like PNG canvases and PDF documents. It is NOT an adapter (adapters translate between your domain and external systems). It is a presentation layer that composes visual output from pre-computed domain data.

| Layer | Responsibility | Example |
|-------|---------------|---------|
| **Rendering** | Visual output: layout, typography, charts | Fitness receipt canvas, gratitude card |
| **Adapter** | External system translation | Plex API, YAML persistence, Telegram |
| **Domain** | Business logic and computation | Session stats, weighted item selection |

**The Presentation Test:** If your code decides *what data to show*, it's domain logic. If it decides *how to show it* (fonts, spacing, charts, layout), it's rendering.

**The Shared Primitives Test:** If two renderers would duplicate the same drawing code, extract it to `1_rendering/lib/`.

---

## Layer Placement

Rendering sits at the same dependency tier as adapters (`1_`):

```
0_system/        → imports nothing
1_adapters/      → imports from 0, 2, 3(ports)
1_rendering/     → imports from 0, 2
2_domains/       → imports from 0 (minimal)
3_applications/  → imports from 0, 1_adapters, 1_rendering, 2
4_api/           → imports from 0, 1, 2, 3
```

The `1_` prefix indicates dependency tier. `1_adapters/` and `1_rendering/` are peers.

---

## File Structure

```
1_rendering/
├── lib/                             # Shared rendering primitives
│   ├── CanvasFactory.mjs            # Canvas creation, font registration
│   ├── TextRenderer.mjs             # Text wrapping, measurement
│   ├── LayoutHelpers.mjs            # Dividers, borders, sections, rotation
│   └── index.mjs
├── {domain}/                        # Per-domain layouts
│   ├── {Output}Renderer.mjs         # Layout + drawing logic
│   ├── {output}Theme.mjs            # Theme constants
│   └── index.mjs
```

### Current Renderers

| Domain | Renderer | Output |
|--------|----------|--------|
| `fitness/` | `FitnessReceiptRenderer` | Thermal receipt PNG |
| `gratitude/` | `GratitudeCardRenderer` | Thermal card PNG |

---

## Import Rules

### ALLOWED imports in `1_rendering/`

| Source | Purpose | Examples |
|--------|---------|---------|
| `0_system/utils/` | System utilities | Font paths, file I/O |
| `2_domains/` | Domain utilities | `decodeSingleSeries` for RLE data |
| `1_rendering/lib/` | Shared primitives | `CanvasFactory`, `TextRenderer` |

### FORBIDDEN imports in `1_rendering/`

| Forbidden | Why | Instead |
|-----------|-----|---------|
| `1_adapters/*` | Peer layer, no cross-imports | Extract shared needs to `0_system/` |
| `3_applications/*` | Rendering doesn't orchestrate | Application calls rendering |
| `0_system/config/ConfigService` | Receives config via DI | Pass font paths via constructor |

### Import Direction

```
0_system <── 1_rendering ──> 2_domains
                 │
                 └── 1_rendering/lib/ (internal)
```

Rendering imports DOWN to system and domains. No sideways imports to adapters.

---

## Shared Primitives (`lib/`)

Shared drawing code that multiple renderers compose:

| Primitive | Purpose |
|-----------|---------|
| `CanvasFactory` | Canvas creation, font registration, upside-down rotation |
| `TextRenderer` | Text wrapping, measurement, multi-line rendering |
| `LayoutHelpers` | Dividers, borders, section spacing, visual separators |

### CanvasFactory Pattern

```javascript
// 1_rendering/lib/CanvasFactory.mjs

/**
 * Create a node-canvas instance with font registration.
 *
 * @param {Object} config
 * @param {number} config.width - Canvas width in pixels
 * @param {number} config.height - Canvas height in pixels
 * @param {string} [config.fontDir] - Font directory path
 * @param {string} [config.fontFile] - Font filename
 * @param {string} [config.fontFamily] - CSS font family name
 * @returns {Promise<{canvas, ctx}>}
 */
export async function createCanvas(config) {
  const { createCanvas: create, registerFont } = await import('canvas');
  // ... font registration, canvas setup
}

/**
 * Rotate a canvas 180 degrees for upside-down mounted printers.
 */
export function flipCanvas(canvas) {
  // ... rotation logic
}
```

### Rules for Primitives

- **Stateless** — No internal state between calls
- **Theme-agnostic** — Receive colors, fonts, dimensions as parameters
- **No domain knowledge** — Primitives don't know about sessions, gratitude items, or zones
- **Composable** — Each primitive does one thing; renderers compose them

---

## Renderer Pattern

Renderers are factory functions that return canvas creators:

```javascript
// 1_rendering/{domain}/{Output}Renderer.mjs

/**
 * Create a {domain} renderer.
 *
 * @param {Object} config
 * @param {Function} config.getData - Async function returning pre-computed domain data
 * @param {string} [config.fontDir] - Font directory path
 * @returns {{ createCanvas: Function }}
 */
export function create{Domain}Renderer(config) {
  const { getData, fontDir } = config;

  async function createCanvas(params) {
    const data = await getData(params);
    // Layout + drawing using shared primitives
    return { canvas, width, height };
  }

  return { createCanvas };
}
```

### Key Constraints

- **No data fetching** — Renderers receive data via callbacks, never import services
- **No business logic** — Stats, selection algorithms, and computations belong in `2_domains/`
- **Theme-driven** — All magic numbers live in theme files, not inline
- **Factory pattern with DI** — Same pattern as adapters: constructor receives dependencies

---

## Theme Files

Each renderer has a companion theme file with presentation constants:

```javascript
// 1_rendering/{domain}/{output}Theme.mjs

export const fitnessReceiptTheme = {
  canvas: { width: 580 },
  fonts: {
    family: 'Roboto Condensed',
    fontPath: 'RobotoCondensed-Regular.ttf',
    title: 'bold 42px "Roboto Condensed"',
    body: '18px "Roboto Condensed"',
  },
  colors: {
    background: '#FFFFFF',
    text: '#000000',
    border: '#000000',
  },
  layout: {
    margin: 30,
    sectionGap: 15,
  },
};
```

### Theme Rules

- **No business logic** — Themes contain only presentation constants
- **Renderers import their own theme** — No cross-domain theme sharing
- **Shared visual constants** — If multiple themes need the same value, extract to `lib/`

---

## Naming Conventions

| Type | Pattern | Examples |
|------|---------|---------|
| **Renderer** | `{Output}Renderer.mjs` | `FitnessReceiptRenderer.mjs`, `GratitudeCardRenderer.mjs` |
| **Theme** | `{output}Theme.mjs` | `fitnessReceiptTheme.mjs`, `gratitudeCardTheme.mjs` |
| **Primitive** | `PascalCase.mjs` | `CanvasFactory.mjs`, `TextRenderer.mjs` |
| **Factory function** | `create{Domain}Renderer` | `createFitnessReceiptRenderer`, `createGratitudeCardRenderer` |

---

## Error Handling

Renderers fail gracefully when data is missing:

```javascript
async function createCanvas(sessionId) {
  const data = await getData(sessionId);
  if (!data) return null;  // No data = no canvas
  // ... render
}
```

- **Return null** for missing data — let the API layer decide the HTTP response
- **Log warnings** for unexpected data shapes — don't silently produce broken output
- **Let canvas errors propagate** — font registration failures, canvas creation errors bubble up

---

## Anti-Patterns Summary

| Anti-Pattern | Example | Fix |
|--------------|---------|-----|
| **Business logic in renderer** | `selectItemsForPrint()` in renderer | Move to domain service |
| **Stats computation in renderer** | Avg HR, std dev, zone distribution | Move to domain value object or service |
| **Direct service imports** | `import { SessionService } from '#domains/...'` | Receive data via DI callback |
| **Duplicated drawing code** | Two renderers with identical `wrapText()` | Extract to `1_rendering/lib/TextRenderer` |
| **Hardcoded values** | `ctx.font = 'bold 42px Roboto'` inline | Use theme constants |
| **Cross-domain theme import** | Fitness renderer importing gratitude theme | Each renderer uses its own theme |
| **Adapter import** | `import { ... } from '#adapters/...'` | Peer layers don't import each other |
| **Data fetching in renderer** | `await sessionStore.findById(id)` | Receive pre-fetched data via callback |

---

## Import Alias

```json
{
  "imports": {
    "#rendering/*": "./backend/src/1_rendering/*"
  }
}
```

---

## Related Documentation

- [Rendering Layer Design](../../_wip/plans/2026-02-11-rendering-layer-design.md) — Design decision and migration plan
- [Adapter Layer Guidelines](../adapter-layer-guidelines.md) — Peer layer guidelines
- [Backend Architecture](../backend-architecture.md) — Overall layer structure
