# WebView Paint Performance — Shield TV Guidelines

## Context

The living room TV runs DaylightStation in Fully Kiosk Browser (FKB) on an NVIDIA Shield TV (Android 11, Cortex-A57 CPU, Tegra X1 GPU). The WebView (Chrome 145) renders web content at 960x539 CSS pixels (DPR 2). Performance bottlenecks are almost always in the browser's **paint/composite pipeline**, not in JavaScript.

## The Problem

When the browser scrolls or transforms a container, it must **repaint every element** that enters or exits the viewport. Each element's paint cost depends on its CSS properties. On Shield TV's CPU, expensive paints cause 500-1000ms frames.

## Paint Cost by CSS Property

| Property | Cost | Why |
|----------|------|-----|
| `box-shadow` (multi-layer) | **Very High** | Each layer is a separate blur pass. 3 layers x 17 items = 51 blur operations per frame. |
| `linear-gradient` | **High** | Per-pixel color interpolation during rasterization. Can't be cached when parent transforms change. |
| `backdrop-filter: blur()` | **Very High** | Reads and blurs pixels behind the element. Forces compositing of everything underneath. |
| `filter: blur()` | **High** | Full-element blur pass. |
| `filter: brightness() contrast()` | **Medium** | Per-pixel color math. |
| `::before` / `::after` pseudo-elements | **Medium** | Extra nodes to layout + paint. Worse when combined with box-shadow or gradients. |
| `border-radius` with overflow | **Medium** | Clip path calculation per element. |
| `border` width change | **Medium** | Triggers layout recalculation for the element AND siblings in flex/grid. |
| `outline` | **Low** | Does not trigger layout. Paint-only, simple rectangle. |
| `transform: scale/translate` | **Free** | Compositor-only. No paint, no layout. GPU handles it. |
| `opacity` | **Free** | Compositor-only. |
| Solid `background-color` | **Negligible** | Single fill, no interpolation. |

## Rules for Shield TV Menu

### Do

- **Use flat solid colors** instead of gradients (`rgba(30,30,30,0.7)` not `linear-gradient(...)`)
- **Use `outline`** for selection highlight (no layout shift, minimal paint)
- **Use `transform`** for scroll (`translateY`) and animations (`scale`, `translate`) — GPU-composited
- **Use `opacity`** for fade effects — GPU-composited
- **Limit animations to the active item only** — 1 element animating is free, 34 is not
- **Cache layout positions** after initial render — avoid `offsetTop`/`offsetHeight` queries during navigation

### Don't

- **No `box-shadow`** on repeated elements (menu items, cards, list rows)
- **No `linear-gradient`** backgrounds on elements that scroll or transform
- **No `backdrop-filter`** or `filter: blur()` on elements in scrollable containers
- **No `::after`/`::before`** pseudo-elements with paint-heavy styles on repeated elements
- **No `border` width changes** for selection state (causes layout recalculation)
- **No CSS transitions** on paint-triggering properties during navigation (the blanket `transition-duration: 0s !important` exists for this reason)

### The Blanket Animation Kill

```scss
.menu-items-container {
  *, *::before, *::after {
    animation-duration: 0s !important;
    transition-duration: 0s !important;
  }
}
```

This exists because ANY transition/animation on menu items multiplied across 17+ elements overwhelms the Shield's paint pipeline. Specific animations can be whitelisted with `!important` — but only if they use compositor-only properties (`transform`, `opacity`).

## Measured Impact

From Shield TV perf logs (`media/logs/screens/*.jsonl`):

| Configuration | Frame janks (>100ms) | Steady-state FPS | Long tasks |
|--------------|---------------------|------------------|------------|
| Gradients + 3-layer shadows + pseudo-elements | 68 | 9-30 | 14,477ms |
| Flat colors + outline + no pseudo-elements | 3 | 60 | 513ms |
| Flat + cover zoom/pan animation (active only) | 11 | 60 | 0ms |

## Navigation Architecture

Arrow key navigation bypasses React entirely to avoid reconciliation overhead:

1. **Keydown handler** reads `activeIndexRef` (ref, not state)
2. **`classList.remove/add("active")`** swaps the highlight — direct DOM, O(1)
3. **`style.transform = translateY(...)`** scrolls using cached positions — no DOM reads
4. **React state only updates on Enter** (selection) — navigation never triggers re-render

This is equivalent to how Android's RecyclerView handles focus changes: direct view manipulation, no virtual DOM diffing.

## Perf Monitoring

The `useMenuPerfMonitor` hook writes structured logs to `media/logs/screens/{session}.jsonl`:

- `menu-perf.snapshot` — periodic FPS, frame time percentiles, dropped frames, long tasks, node count
- `menu-perf.jank` — individual frames >100ms
- `menu-perf.nav` — per-keystroke render time (when React renders)

Analyze with:
```bash
sudo docker exec daylight-station sh -c 'cat media/logs/screens/*.jsonl' | \
  python3 -c "import sys,json; [print(json.loads(l)['event'], json.loads(l)['data']) for l in sys.stdin if l.strip()]"
```

## When to Re-evaluate

- **WebView updates** — Chrome WebView improvements may allow gradients/shadows. Test after major Chrome version bumps.
- **New hardware** — Shield TV Pro 2025+ may have faster CPU. Re-benchmark.
- **Fewer items** — If the menu drops below ~10 items, gradients may become affordable. Test with the perf monitor.
