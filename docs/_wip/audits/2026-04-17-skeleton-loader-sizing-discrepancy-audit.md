# Skeleton Loader Sizing Discrepancy Audit

**Date:** 2026-04-17
**Screen:** Office (`/screen/office`, 1280x720)
**Problem:** Skeleton loaders render at significantly different scale/height/width than hydrated content. Layout shifts on hydration.

---

## Root Cause Summary

There are **two systemic issues**, not just per-widget bugs:

1. **Framework default `flexGrow: 1`** — `PanelRenderer.jsx:16` sets `flexGrow: node.grow ?? 1`. Every widget and container that doesn't explicitly set `grow: 0` expands to fill available space. Skeletons inherit this expansion but have no intrinsic content to constrain them, so they balloon to fill whatever the flex container offers.

2. **Skeleton loaders use fixed dimensions inside flex-expanding containers** — Widgets like Weight and Finance use hardcoded pixel heights (`160px`, `240px`) for their skeleton chart areas, but their hydrated state uses `flex-grow: 1` to fill the remaining space. The skeleton is a fixed island in an expanding sea.

---

## Per-Widget Findings

### 1. Weight (`modules/Health/Weight.jsx`)

**Severity: HIGH** — largest visual discrepancy on office screen.

| Property | Skeleton State | Hydrated State |
|----------|---------------|----------------|
| Root | `.weight` with `flex-grow: 1; flex-direction: column` | Same |
| Table | Inline `<table>` (no flex-grow) | Same + `flex-grow: 0` via CSS |
| Chart area | `height: 160px` (hardcoded div) | `flex-grow: 1` (expands to fill remaining) |

**What happens:** The `.weight` root flex-grows to fill its container (the `screen-widget` div, which also flex-grows per PanelRenderer defaults). During skeleton, the chart area is locked at 160px, so the remaining flex space is **empty/collapsed**. On hydration, the Highcharts chart expands via `flex-grow: 1` to fill all remaining vertical space — a dramatic size jump.

**Additionally:** Weight.scss line 31-36 applies `margin-bottom: -2rem; margin-right: -1.5rem` to the chart wrapper. The skeleton doesn't apply these negative margins, causing further layout shift.

### 2. Finance (`modules/Finance/Finance.jsx`)

**Severity: HIGH**

| Property | Skeleton State | Hydrated State |
|----------|---------------|----------------|
| Root | No class, no flex properties | `.finance` — no explicit sizing |
| Wrapper | `height: 240px` (hardcoded) | No wrapper — table + chart div |
| Chart | `.skeleton.rect` (100% x 100%) | Highcharts with `height: 240` in options |

**What happens:** The skeleton renders a single 240px-tall rect. The hydrated state renders a table (variable height ~60px) PLUS a 240px chart. Total hydrated height is ~300px vs skeleton's 240px. But worse: the `screen-widget` wrapper has `flexGrow: node.grow ?? 1` from the office config (`grow: 1`), so the skeleton rect fills the entire flex-allocated space while the hydrated content is content-sized within that space.

**Missing:** The `.finance` class has NO root sizing CSS (no `display: flex`, no `flex-direction: column`, no `height: 100%`). The skeleton fills the container, but the hydrated content doesn't.

### 3. Calendar/Upcoming (`modules/Upcoming/Upcoming.jsx`)

**Severity: MEDIUM**

| Property | Skeleton State | Hydrated State |
|----------|---------------|----------------|
| Root | `.upcoming` with `flex-grow: 1; height: 100%` | Same |
| Main panel | `padding: 20px`, 3 skeleton text lines | Content-driven (h2/h3/h4/p elements) |
| List panel | 4 items with `padding: 10px`, flex row | Items with `height: 2.8rem; flex-shrink: 0` |

**What happens:** The skeleton list items use padded flex rows (~44px each) while hydrated items use fixed `height: 2.8rem` (~45px) — close but not identical. The main panel skeleton uses generous padding (20px) with small text placeholders, while hydrated content fills with large text (`font-size: 3rem`). The skeleton appears sparse/empty compared to the dense hydrated layout.

**Also:** The skeleton uses `skeleton-container` class that doesn't exist in any CSS — it's just a marker with no styles.

### 4. WeatherForecast (`modules/Weather/WeatherForecast.jsx`)

**Severity: LOW-MEDIUM**

| Property | Skeleton State | Hydrated State |
|----------|---------------|----------------|
| Container | `width: 100%; height: 100%` | Same |
| Content | 6 skeleton bars (flex row, `alignItems: flex-end`) | Highcharts chart using ResizeObserver |

**What happens:** The skeleton shows bars aligned to bottom of container. The chart renders using ResizeObserver to measure `offsetHeight` and set Highcharts dimensions. During the skeleton-to-chart transition, there can be a brief frame where the chart hasn't measured yet and renders at default size before snapping to the measured dimensions.

### 5. Entropy (`modules/Entropy/EntropyPanel.jsx`)

**Severity: LOW**

| Property | Skeleton State | Hydrated State |
|----------|---------------|----------------|
| Root | `.entropy-panel` with `width: 100%; height: 100%` | Same |
| Grid | `gridTemplateColumns: repeat(4, 1fr)` (hardcoded) | `repeat(${cols}, 1fr)` where `cols = Math.ceil(Math.sqrt(n))` |

**What happens:** Skeleton always shows 4 columns x 3 rows (12 items). Hydrated content calculates columns dynamically. If the real data has, say, 9 items, it renders 3x3 instead of 4x3. Individual cells resize accordingly. This is a column-count mismatch, not a container sizing issue.

### 6. Weather (`modules/Weather/Weather.jsx`)

**Severity: NONE** — Skeleton and hydrated use identical table structure with matching negative margins.

### 7. Clock/Time (`modules/Time/Time.jsx`)

**Severity: NONE** — No skeleton state. Renders immediately (no API dependency).

---

## Framework-Level Issues

### Issue A: `flexGrow` defaults to 1 in PanelRenderer

**File:** `frontend/src/screen-framework/panels/PanelRenderer.jsx:16`
```js
function flexItemStyle(node) {
  return {
    flexGrow: node.grow ?? 1,   // <-- every node grows by default
    flexShrink: node.shrink ?? 1,
    flexBasis: node.basis || 'auto',
  };
}
```

This means every `screen-widget`, `screen-area`, and `screen-panel` div expands to fill available space unless explicitly told not to. When a skeleton has less intrinsic content than the hydrated widget, it still occupies the same flex-allocated space — but the content within it is undersized, creating a "small skeleton in a big box" effect.

### Issue B: `screen-widget` wrapper has no skeleton-awareness

**File:** `frontend/src/screen-framework/panels/PanelRenderer.css:39-52`

The `.screen-widget` class applies `display: flex; flex-direction: column` but has no mechanism to signal "this widget is still loading." The same flex container behavior applies whether the child is a skeleton placeholder or the real content, but skeletons rarely implement proper flex participation.

### Issue C: No contract between skeleton and hydrated content

There is no shared sizing specification between a widget's skeleton and its hydrated state. Each widget independently decides:
- Whether to have a skeleton at all
- What dimensions the skeleton uses
- How the hydrated state fills its container

This means every new widget can introduce a sizing discrepancy without any guardrail.

### Issue D: `.skeleton.rect` is `width: 100%; height: 100%` — depends on container

The `.skeleton.rect` class in `_skeleton.scss` uses `height: 100%`. This only works if the container has an explicit height. When the container's height comes from `flex-grow` (which is the case for most screen-widget wrappers), the skeleton rect fills the flex-allocated space — which may be much larger or smaller than the hydrated content's natural size.

---

## Office Layout Context

The office screen YAML defines a flex-heavy layout where the discrepancies compound:

```yaml
# Left column
- direction: column, basis: 25%, shrink: 0
  - clock:            grow: 0, shrink: 0   # Fixed size - OK
  - weather:          grow: 0, shrink: 0   # Fixed size - OK
  - weather-forecast: grow: 0, shrink: 1   # Can shrink but doesn't grow - OK
  - entropy:          basis: 40%, grow: 0   # Fixed basis - OK

# Right column
- direction: column, grow: 1
  - calendar:         grow: 1              # EXPANDS to fill
  - row (grow: 0, shrink: 0):
    - finance:        basis: 50%, grow: 1  # EXPANDS within row
    - health:         basis: 50%, grow: 1  # EXPANDS within row
```

The worst discrepancies are in **calendar** (grow:1 in a column), **finance**, and **health** (both grow:1 in a row) — precisely the widgets where skeleton content doesn't match hydrated flex behavior.

---

## Recommendations

### Quick Fixes (per-widget)

1. **Weight skeleton:** Replace `height: 160px` chart placeholder with a flex-growing div: `style={{ flexGrow: 1 }}`. Add the negative margins to match hydrated state.

2. **Finance skeleton:** Add `display: flex; flex-direction: column; height: 100%` to the skeleton root. Include a table-height placeholder (~60px) plus a flex-growing chart skeleton.

3. **Finance hydrated:** Add `height: 100%` and `display: flex; flex-direction: column` to `.finance` class so the hydrated content actually fills its container (currently it doesn't, which is also a bug).

4. **Upcoming skeleton:** Use the same `height: 2.8rem` on skeleton list items to match hydrated items.

5. **Entropy skeleton:** Calculate grid columns from a default item count constant rather than hardcoding 4.

### Structural Fix (framework-level)

6. **Widget skeleton contract:** Consider a standard pattern where widgets export a `Skeleton` component alongside their main component. The skeleton should use the same root CSS class and flex properties as the hydrated widget. The framework could render the skeleton inside the same `screen-widget` wrapper, ensuring identical flex participation.

7. **Reconsider `flexGrow: 1` default:** A default of `0` would make widgets only take their natural content size unless explicitly configured to expand. This is safer but would require updating every widget that intentionally grows (calendar, finance, health in the office config already set `grow: 1`, so those would be unaffected).

---

## Files Referenced

| File | Role |
|------|------|
| `frontend/src/screen-framework/panels/PanelRenderer.jsx` | flexItemStyle defaults, widget/panel rendering |
| `frontend/src/screen-framework/panels/PanelRenderer.css` | screen-widget/panel/area base styles |
| `frontend/src/styles/_skeleton.scss` | Global skeleton classes |
| `frontend/src/modules/Health/Weight.jsx` | Weight widget + skeleton |
| `frontend/src/modules/Health/Weight.scss` | Weight sizing (flex-grow, negative margins) |
| `frontend/src/modules/Finance/Finance.jsx` | Finance widget + skeleton |
| `frontend/src/modules/Finance/Finance.scss` | Finance table sizing |
| `frontend/src/modules/Upcoming/Upcoming.jsx` | Calendar widget + skeleton |
| `frontend/src/modules/Upcoming/Upcoming.scss` | Calendar panel/item sizing |
| `frontend/src/modules/Weather/WeatherForecast.jsx` | Forecast widget + skeleton |
| `frontend/src/modules/Entropy/EntropyPanel.jsx` | Entropy widget + skeleton |
| `frontend/src/modules/Entropy/EntropyPanel.scss` | Entropy grid sizing |
| `data/household/screens/office.yml` | Office layout config (flex grow/shrink/basis per widget) |
