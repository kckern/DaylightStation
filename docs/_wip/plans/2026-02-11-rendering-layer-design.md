# Rendering Layer Design

**Date:** 2026-02-11
**Status:** Design
**Scope:** Extract rendering from adapters into dedicated `1_rendering/` layer

---

## Problem

Canvas renderers (`FitnessReceiptRenderer`, `GratitudeCardRenderer`) currently live in `1_adapters/{domain}/rendering/`. This placement has three problems:

1. **Leaked domain logic** — `GratitudeCardRenderer` contains `selectItemsForPrint()` (a weighted-bucket selection algorithm with age-based bucketing and print-count prioritization). `FitnessReceiptRenderer` computes avg HR, std dev, zone distribution, warm+ ratio, zone-seconds, zone-coins, and zone-HR boundaries. These are domain calculations living in an adapter.

2. **No shared primitives** — Both renderers duplicate patterns: text wrapping, dividers, font registration, canvas creation, upside-down rotation. A third renderer would copy-paste again. Adapters are domain-isolated by design — cross-adapter code sharing is an anti-pattern.

3. **1:N output formats blocked** — A fitness receipt as both thermal PNG and PDF requires two adapters with 90% duplicated layout logic. Adapters are one-per-vendor, not layout-then-format.

---

## Decision

Create `backend/src/1_rendering/` as a new DDD layer at the same dependency tier as `1_adapters/`. Rendering is a server-side presentation concern — the backend's equivalent of `frontend/` for non-browser output targets (thermal printer, PDF, etc.).

---

## Layer Placement

Rendering has the same dependency profile as adapters:

- **Needs:** `0_system/` (fonts, config paths), `2_domains/` (domain utilities like RLE decoding)
- **Consumed by:** `3_applications/` (orchestration), `4_api/` (response formatting)

```
0_system/        → imports nothing
1_adapters/      → imports from 0, 2, 3(ports)
1_rendering/     → imports from 0, 2
2_domains/       → imports from 0 (minimal)
3_applications/  → imports from 0, 1_adapters, 1_rendering, 2
4_api/           → imports from 0, 1, 2, 3
```

The `1_` prefix indicates dependency tier, not uniqueness — `1_adapters/` and `1_rendering/` are peers at the same level.

---

## Structure

```
1_rendering/
├── lib/                             # Shared rendering primitives
│   ├── CanvasFactory.mjs            # Canvas creation, font registration
│   ├── TextRenderer.mjs             # Text wrapping, measurement
│   ├── LayoutHelpers.mjs            # Dividers, borders, sections, rotation
│   └── index.mjs
├── fitness/                         # Fitness receipt
│   ├── FitnessReceiptRenderer.mjs   # Layout + drawing
│   ├── fitnessReceiptTheme.mjs      # Theme constants
│   └── index.mjs
└── gratitude/                       # Gratitude card
    ├── GratitudeCardRenderer.mjs    # Layout + drawing
    ├── gratitudeCardTheme.mjs       # Theme constants
    └── index.mjs
```

### Shared Primitives (`lib/`)

Extracted from duplicated code in both existing renderers:

| Primitive | Extracted From | Purpose |
|-----------|---------------|---------|
| `CanvasFactory` | Both renderers | `createCanvas()`, `registerFont()`, font path resolution, upside-down rotation |
| `TextRenderer` | Both `wrapText()` impls | Text wrapping, measurement, multi-line rendering |
| `LayoutHelpers` | Both renderers | `drawDivider()`, borders, section spacing |

### Domain Logic Extraction

Move business logic out of renderers into `2_domains/`:

| Logic | Current Location | New Location |
|-------|-----------------|--------------|
| `selectItemsForPrint()` — weighted bucket selection | `GratitudeCardRenderer.mjs` | `2_domains/gratitude/services/PrintSelectionService.mjs` |
| Per-participant stats (avg HR, std dev, warm+ ratio) | `FitnessReceiptRenderer.mjs` | `2_domains/fitness/services/SessionStatsService.mjs` |
| Zone-seconds, zone-coins, zone-HR-bounds computation | `FitnessReceiptRenderer.mjs` | `2_domains/fitness/value-objects/ParticipantStats.mjs` |

After extraction, renderers receive pre-computed data via DI callbacks — pure layout, no business logic.

---

## Import Rules

### ALLOWED imports in `1_rendering/`

| Source | Purpose | Examples |
|--------|---------|---------|
| `0_system/utils/` | System utilities | Font paths, file I/O |
| `2_domains/` | Domain utilities | `decodeSingleSeries` for RLE timeline data |
| `1_rendering/lib/` | Shared primitives | `CanvasFactory`, `TextRenderer`, `LayoutHelpers` |

### FORBIDDEN imports in `1_rendering/`

| Forbidden | Why | Instead |
|-----------|-----|---------|
| `1_adapters/*` | Peer layer, no cross-imports | Extract shared needs to `0_system/` |
| `3_applications/*` | Rendering doesn't orchestrate | Application calls rendering |
| `0_system/config/` | Receives config via DI | Pass font paths, config values via constructor |

---

## Wiring (Bootstrap)

No change to the existing DI pattern. Bootstrap creates renderers with callbacks:

```javascript
import { createFitnessReceiptRenderer } from '#rendering/fitness/index.mjs';

const renderer = createFitnessReceiptRenderer({
  getSessionData: async (sessionId) => {
    const session = await fitnessServices.sessionService.getSession(sessionId, householdId);
    return session ? session.toJSON() : null;
  },
  getSessionStats: async (sessionId) => {
    // NEW: domain service computes stats instead of renderer
    return fitnessServices.sessionStatsService.computeStats(sessionId, householdId);
  },
  resolveDisplayName: (slug) => userService.resolveDisplayName(slug),
  fontDir: configService.getPath('font')
});
```

---

## Future: 1:N Output Formats

When PDF support is needed, layouts stay shared — only drawing API differs:

```
1_rendering/
├── lib/
│   ├── CanvasFactory.mjs           # PNG canvas target
│   ├── PdfFactory.mjs              # PDF target (future)
│   ├── TextRenderer.mjs            # Works with both
│   └── LayoutHelpers.mjs           # Works with both
├── fitness/
│   ├── FitnessReceiptLayout.mjs    # Shared layout logic (sections, hierarchy)
│   ├── FitnessReceiptCanvas.mjs    # PNG-specific drawing
│   ├── FitnessReceiptPdf.mjs       # PDF-specific drawing (future)
│   └── fitnessReceiptTheme.mjs
```

---

## Import Alias

Add to `package.json`:

```json
{
  "imports": {
    "#rendering/*": "./backend/src/1_rendering/*"
  }
}
```

---

## Migration Steps

1. Create `backend/src/1_rendering/` directory structure
2. Extract shared primitives to `1_rendering/lib/`
3. Move renderers from `1_adapters/{domain}/rendering/` to `1_rendering/{domain}/`
4. Extract domain logic to `2_domains/` services
5. Update bootstrap wiring in `app.mjs`
6. Add `#rendering/*` import alias to `package.json`
7. Remove empty `rendering/` directories from `1_adapters/`
8. Update reference documentation
