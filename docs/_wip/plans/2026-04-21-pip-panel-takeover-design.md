# PIP Panel Takeover — Design

**Status:** Design validated, ready for implementation
**Date:** 2026-04-21

## Problem

The current PIP framework (`frontend/src/screen-framework/pip/PipManager.jsx`) renders a small picture-in-picture overlay anchored to a screen corner. Some screens — notably the office dashboard — want an incoming event (e.g. doorbell ring) to take over an entire layout region instead of showing a small corner overlay. Concretely for office: keep the 25% sidebar (clock/weather/forecast/entropy) intact, but replace the whole right column (calendar on top, finance+health on bottom) with the camera view while the event is active.

## Goals

- Add a `panel` display mode to the PIP system that replaces a named layout slot with the overlay content
- Keep hidden widgets mounted (no state loss, no remount cost)
- Reuse the existing subscription → show/dismiss/promote flow; no new actions needed
- Coexist cleanly with existing `mode: pip` (corner) — same mutex, same lifecycle

## Non-Goals

- No support for multiple simultaneous pip-family displays (single-slot mutex stays)
- No panel ↔ panel transitions or demote-from-fullscreen-back-to-panel
- No support for replacing arbitrary deeply-nested widgets; only layout nodes that carry an explicit `id:`

## Decisions

| # | Question | Decision |
|---|---|---|
| Q1 | Fate of existing widgets during takeover | Keep mounted, CSS-hidden (preserves state, cheap to restore) |
| Q2 | How to specify the target region | Named slots — layout nodes opt in via `id:` |
| Q3 | Visual treatment | Fill slot + chrome (border, shadow, radius) to signal overlay |
| Q4 | Interactions | Dismiss + promote (same as corner pip) |
| Q5 | Corner pip vs panel coexistence | Mode-per-subscription, global single-slot mutex |
| Q6 | Missing target slot | Warn + no-op (per-screen flexibility; missing slot ≠ bug) |

---

## 1. YAML Config

### Layout nodes get an optional `id:`

```yaml
layout:
  direction: row
  children:
    - direction: column
      basis: 25%
      # ...sidebar widgets — no id needed
    - id: main-content         # NEW: named slot
      direction: column
      grow: 1
      children:
        - widget: calendar
        - direction: row
          children:
            - widget: finance
            - widget: health
```

### Subscriptions get `mode: panel` + `target:`

```yaml
subscriptions:
  doorbell:
    on: { event: ring }
    response:
      overlay: camera
      mode: panel              # NEW mode
      target: main-content     # required when mode is panel
      panel:                   # panel-specific config
        timeout: 30
    dismiss: { inactivity: 30 }
```

- Existing `mode: pip` keeps working unchanged; its `pip:` config block stays
- Panel config schema is smaller — `timeout` only (slot dictates geometry, so no position/size/margin)
- A screen can declare both panel and corner subscriptions; they share the single-display mutex

---

## 2. State Machine

`PipManager` state expands with a `mode` discriminator. State transitions remain the same.

```js
state:   'idle' | 'visible' | 'fullscreen'
mode:    null   | 'corner'  | 'panel'          // NEW
content: { Component, props, config, target? }
```

**`show()` signature** gains a mode discriminator:

```js
pip.show(Component, props, { mode: 'corner', position, size, timeout, margin })
pip.show(Component, props, { mode: 'panel',  target, timeout })
```

- `show()` during `visible` refreshes content + timer (same as today)
- `show()` during `fullscreen` is ignored (same as today)
- `promote()` hands content to `showOverlay()` regardless of mode
- `dismiss()` cleans up whichever surface is active

**Filename stays `PipManager.jsx`** — no module rename churn.

---

## 3. Slot Registry + Portals

The slot nodes live deep inside `PanelRenderer`, but `PipManager` sits above it. Bridge with a registry + portals.

### PipManager exposes

```js
registerSlot(id, domNode) / unregisterSlot(id)
```

on its context.

### PanelRenderer behavior

When rendering a layout node with `id:`:
- attach a ref to the container `<div>`
- call `registerSlot(id, ref.current)` on mount
- call `unregisterSlot(id)` on unmount
- always render normal children inside

### Rendering a panel takeover

1. PipManager looks up `target` in the registry
2. **Found:** `ReactDOM.createPortal(<PipPanel/>, slotNode)` renders the takeover inside the slot
3. **Not found:** log `pip.slot-not-found` warn, return without state change

### Hiding native children

Slot container gets `data-pip-occupied="true"` when a panel takeover is active. CSS:

```css
[data-pip-occupied="true"] > :not(.pip-panel) {
  visibility: hidden;
}
```

Children stay mounted (state, timers, API subscriptions intact) — just invisible. On dismiss, attribute is removed and they reappear with zero remount cost.

---

## 4. DOM, Chrome & Animation

### DOM during takeover

```html
<div id="slot-main-content" data-pip-occupied="true" style="position: relative">
  <!-- existing widgets (visibility: hidden via CSS selector) -->
  <div class="panel-calendar">...</div>
  <div class="panel-finance-health">...</div>

  <!-- portal-rendered overlay (sibling) -->
  <div class="pip-panel" style="position: absolute; inset: 0">
    <div class="pip-panel-chrome">
      <CameraOverlay cameraId="doorbell" ... />
    </div>
  </div>
</div>
```

- Slot container gets `position: relative` injected when registered
- `.pip-panel-chrome` matches the corner pip's visual language: same `border-radius`, `box-shadow`, slightly heavier shadow to fit the larger scale

### Animation

- ~200ms fade + scale-in on mount, fade-out on dismiss
- **Uses Web Animations API (`element.animate()`)**, NOT CSS transitions
- Reason: `TVApp.scss` has a global `animation-duration: 0s !important` kill inside `.tv-app-container` (kiosk perf), so CSS transitions never run in the TV route. WAA is immune

### Escape / promote

- Escape key → `pip.dismiss()` → fade out → remove `data-pip-occupied`
- `pip:promote` action → panel fades out, content handed to `showOverlay()` as fullscreen (existing unchanged flow)

---

## 5. Subscription Routing

### Entry normalization (`useScreenSubscriptions.js:45-61`)

Adds two fields to the normalized entry:

```js
target:      cfg?.response?.target ?? null,
panelConfig: cfg?.response?.panel ?? null,
```

### Routing (currently `useScreenSubscriptions.js:148`)

```js
// BEFORE — only corner pip routed through PipManager
if (entry.mode === 'pip' && pipRef.current) {
  pipRef.current.show(Component, props, entry.pipConfig || {});
}

// AFTER — both pip and panel routed through PipManager
if ((entry.mode === 'pip' || entry.mode === 'panel') && pipRef.current) {
  const surfaceConfig = entry.mode === 'panel'
    ? { mode: 'panel', target: entry.target, ...(entry.panelConfig || {}) }
    : { mode: 'corner', ...(entry.pipConfig || {}) };
  pipRef.current.show(
    Component,
    { ...data, onClose, onSessionEnd },
    surfaceConfig
  );
}
```

### ScreenActionHandler

Unchanged. `pip:promote` / `pip:dismiss` / `pip:doorbell` all query `pip.state` / `pip.hasPip` which are mode-agnostic.

---

## Logging

Following the structured-logging requirement in `CLAUDE.md`:

| Component | Event | Level | Data |
|---|---|---|---|
| `PipManager` | `pip.show` | info | add `mode` field; for panel also `target`, `slotFound` |
| `PipManager` | `pip.slot-not-found` | warn | `{ target }` |
| `ScreenSubscriptions` | `subscription.show-panel` | info | `{ topic, overlay, target, event }` |
| `PanelRenderer` | `slot.registered` | debug | `{ id }` |
| `PanelRenderer` | `slot.unregistered` | debug | `{ id }` |

---

## Verification Plan

Same approach we just used to verify the corner pip end-to-end:

1. Add `id: main-content` to office.yml's right column
2. Change office.yml's `doorbell` subscription to `mode: panel`, `target: main-content`
3. Fire: `ssh homeserver.local 'curl -sS -X POST http://localhost:3111/api/v1/camera/doorbell/event -H "Content-Type: application/json" -d "{\"event\":\"ring\"}"'`
4. Expected log sequence on office client:
   - `subscription.show-panel` (topic=doorbell, target=main-content)
   - `slot.registered` earlier, then `pip.show` with `mode=panel, target=main-content, slotFound=true`
   - `cameraOverlay.direct` (cameraId=doorbell)
   - `hls.start` → `hls.playing`
5. Visually: right column replaced by camera with chrome; left sidebar unchanged; calendar/finance/health return on dismiss without remount.

## Files Touched

- `frontend/src/screen-framework/pip/PipManager.jsx` — add mode, target, slot registry, portal rendering
- `frontend/src/screen-framework/pip/PipManager.css` — `.pip-panel`, `.pip-panel-chrome`, `[data-pip-occupied]` rule
- `frontend/src/screen-framework/ScreenRenderer.jsx` or `PanelRenderer` — call `registerSlot`/`unregisterSlot` for `id:`-bearing layout nodes
- `frontend/src/screen-framework/subscriptions/useScreenSubscriptions.js` — normalize `target` + `panelConfig`, route panel mode
- `data/household/screens/office.yml` — add `id: main-content`, flip doorbell subscription to `mode: panel`

No backend changes. Existing camera webhook + broadcast work unchanged.
