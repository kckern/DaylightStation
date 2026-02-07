# Menu Skeleton Loader Proposal

Status: Completed 2026-02-07.

## Context
Currently, the TV and Office apps use `PlayerOverlayLoading` (a spinner/throbber) or return `null` when fetching menu data. This creates a jarring experience during navigation or initial load, as the interface dramatically changes or goes blank before content appears.

Affected files:
- `frontend/src/modules/Menu/Menu.jsx` (`TVMenu`, `KeypadMenu`)
- `frontend/src/modules/Menu/MenuStack.jsx` (`LoadingFallback`)
- `frontend/src/Apps/TVApp.jsx` (Initial root list loading)

## Goal
Replace the generic spinner and blank states with a "Skeleton Loader" (shimmer effect) that mimics the layout of the menu (header + grid of items). This provides better perceived performance and a smoother visual transition.

## Design

### 1. New Component: `MenuSkeleton`
We will create a new component `frontend/src/modules/Menu/MenuSkeleton.jsx`.

**Structure:**
- **Header Skeleton:** Matches `MenuHeader` layout (Title bar, clock placeholder).
- **Grid Skeleton:** Matches `MenuItems` layout (Grid of cards).
- **Animation:** Use a CSS animation (shimmer/pulse) on the background of these skeleton elements.

**Component Interface:**
```jsx
export function MenuSkeleton() {
  return (
    <div className="menu-items-container skeleton">
      <div className="menu-header skeleton-header">
         {/* ... structural divs ... */}
      </div>
      <div className="menu-items skeleton-items">
         {/* ... render N skeleton items ... */}
      </div>
    </div>
  );
}
```

### 2. Styling (`Menu.scss`)
Add `.skeleton` classes to `Menu.scss`.
- Use a reusable `@mixin skeleton-shimmer` for the effect.
- Style `skeleton-item` to match `.menu-item` dimensions and border radius exactly.
- Style `skeleton-header` to match `.menu-header` height.

### 3. Integration Plan

#### A. Update `TVMenu` in `Menu.jsx`
Current:
```jsx
if (!loaded) {
  return null;
}
```
Proposed:
```jsx
if (!loaded) {
  return <MenuSkeleton />;
}
```

#### B. Update `KeypadMenu` in `Menu.jsx`
Current:
```jsx
if (!loaded || !menuItems.length) {
  return <PlayerOverlayLoading shouldRender isVisible />;
}
```
Proposed:
```jsx
if (!loaded) {
  return <MenuSkeleton />;
}
// Keep PlayerOverlayLoading or empty state if loaded but empty? 
// Or render empty menu state. The skeleton is specifically for loading.
```

#### C. Update `MenuStack.jsx`
Update `LoadingFallback` to generic usage. Since `MenuStack` lazy loads `Player` and `AppContainer` as well, we might want to keep `PlayerOverlayLoading` for those, but for menu transitions, the `Suspense` fallback might be triggered.
However, since `TVMenu` handles its own data fetching (it doesn't suspend), the skeleton inside `TVMenu` will handle the "fetching data" state.
The `Suspense` wrapper in `MenuStack` is for code splitting. We can leave `LoadingFallback` as is or switch it to a generic skeleton if we want unified design, but prioritizing `TVMenu` internal state first is safer.

#### D. Update `TVApp.jsx`
Current:
```jsx
if (!list) {
  return <TVAppWrapper><PlayerOverlayLoading shouldRender isVisible /></TVAppWrapper>;
}
```
Proposed:
```jsx
if (!list) {
  return <TVAppWrapper><MenuSkeleton /></TVAppWrapper>;
}
```

## Implementation Steps
1.  **Draft SCSS:** Add skeleton styles to `frontend/src/modules/Menu/Menu.scss`.
2.  **Create Component:** Implement `MenuSkeleton.jsx`.
3.  **Refactor `Menu.jsx`:** Import and use `MenuSkeleton` in `TVMenu` and `KeypadMenu`.
4.  **Refactor `TVApp.jsx`:** Use `MenuSkeleton` for initial load.
5.  **Verify:** Check visual regression and transition smoothness.

## CSS Implementation Detail
```scss
@mixin shimmer {
  background: linear-gradient(90deg, 
    rgba(255, 255, 255, 0.05) 25%, 
    rgba(255, 255, 255, 0.1) 50%, 
    rgba(255, 255, 255, 0.05) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

---

## Addendum: Second Opinion & Recommendations

*Added 2026-02-07 by AI review after codebase audit.*

### Overall Assessment

The proposal is sound and addresses a real UX gap — TVMenu returning `null` during load is the single worst offender, giving users a blank screen. The integration plan is well-targeted. Below are refinements and concerns based on what's actually in the codebase.

### 1. Don't Reinvent — Unify Existing Skeleton Infrastructure

The proposal suggests creating new `.skeleton` SCSS classes in `Menu.scss` and a new shimmer mixin. However, there are **three separate skeleton/shimmer implementations already shipping**:

| Location | Mechanism | Used By |
|---|---|---|
| `OfficeApp.scss` | `@keyframes skeleton-pulse` + `.skeleton` utility classes (`.text`, `.rect`, `.circle`) | Weather, Upcoming, WeatherForecast |
| `Menu.scss` line ~393 | `@keyframes shimmer` on `.menu-item-img.loading` | Individual menu item images |
| Proposal | New `@mixin shimmer` with different gradient values | MenuSkeleton |

**Recommendation:** Extract the existing `OfficeApp.scss` skeleton classes into a shared `_skeleton.scss` partial (or `frontend/src/styles/_skeleton.scss`), and extend it for the menu use case. The per-image shimmer in Menu.scss already uses a `@keyframes shimmer` — reuse that exact animation rather than introducing a third variant with subtly different colors/timing. Consistency matters for perceived quality.

### 2. Skeleton Item Count Should Be Contextual, Not Hardcoded

The proposal renders "N skeleton items" but doesn't specify N. Since the grid is 5 columns, the skeleton should render **10 items** (2 full rows) as a sensible default — enough to fill the viewport without overshooting. However, consider:

- **Root menu** typically has a known, stable number of items (e.g., 6-8 top-level categories). If this count is available early (cached, or from a prior session), render that exact count for a tighter match.
- **Sub-menus** vary wildly. 10 is a safe default, but an optional `count` prop would allow callers that *do* know the expected size to pass it through.

```jsx
export function MenuSkeleton({ count = 10 }) { ... }
```

### 3. The `KeypadMenu` Path Needs More Thought

The proposal notes uncertainty about KeypadMenu's empty-but-loaded state:

> *"Keep PlayerOverlayLoading or empty state if loaded but empty?"*

The answer: **Don't conflate "loading" with "empty."** The skeleton is strictly for `!loaded`. If `loaded && !menuItems.length`, that's a data/state problem (empty list), not a loading problem. Render a distinct empty state (e.g., "No items" message or just the header with no grid). Never show a skeleton for a state that will persist indefinitely — it creates the impression of an infinite load.

### 4. `TVApp.jsx` Has Two Distinct Loading Paths — Treat Them Differently

The proposal lumps both `TVApp.jsx` loading checks into one `<MenuSkeleton />` swap. But there are actually three states:

1. `!list && (isQueueOrPlay || appParam)` — User navigated to a deep link (queue/play/specific app). They expect **player content**, not a menu. A menu skeleton here would be misleading. Keep `PlayerOverlayLoading` or use a content-area skeleton.
2. `!list` (no deep link) — User is landing on the root menu. **This is the correct place for MenuSkeleton.**
3. `autoplay && !autoplayed` — Autoplay pending. This is a playback concern. Keep `PlayerOverlayLoading`.

**Recommendation:** Only replace the second path (`!list` with no deep link params) with `MenuSkeleton`. The other two are player-context loading states where a menu skeleton would be visually wrong.

### 5. Suspense Fallback in `MenuStack.jsx` — Leave It Alone (For Now)

The proposal correctly identifies that `MenuStack`'s `<Suspense fallback={<LoadingFallback />}>` is for **code-splitting**, not data fetching. Since `TVMenu` handles its own data state internally, the Suspense boundary only fires on first lazy-load of Player, AppContainer, etc. A menu skeleton there would flash incorrectly when navigating *to* the player.

**Recommendation:** Don't touch `MenuStack.jsx` in this PR. If we later want a unified transition system, that's a separate effort involving route-level transition animations.

### 6. Transition Smoothness: Consider `key` and Layout Shift

When the skeleton replaces itself with real content, there will be a hard cut unless we handle the transition. Two concerns:

- **Layout shift:** If the skeleton grid dimensions don't match the real grid exactly, there will be a visible jump. The skeleton items must use the *exact same* CSS as `.menu-item` (width calc, aspect-ratio, gap, border-radius). Don't approximate — reuse the same class with an additional modifier.
- **Fade transition:** Consider wrapping the skeleton ↔ content swap in a brief CSS `opacity` transition (150–200ms). This softens the hard cut without adding complexity. A simple approach:

```scss
.menu-items-container {
  animation: fadeIn 0.2s ease-in;
}
@keyframes fadeIn {
  from { opacity: 0.7; }
  to { opacity: 1; }
}
```

### 7. Minor: `PlayerOverlayLoading` Is Over-Engineered for Menu Contexts

`PlayerOverlayLoading` includes stall detection, diagnostics logging, and retry logic designed for media playback buffering. Using it as a generic "loading" indicator outside the player is wasteful and semantically misleading. This migration is a good opportunity to stop leaking player-specific components into non-player contexts. After this work, audit remaining non-player uses of `PlayerOverlayLoading` and replace them too.

### Revised Implementation Steps

1. Extract shared skeleton SCSS into `frontend/src/styles/_skeleton.scss`, consolidating OfficeApp's pulse classes and Menu's shimmer keyframes.
2. Create `MenuSkeleton.jsx` with a `count` prop, reusing `.menu-item` dimensions exactly.
3. Update `TVMenu` in `Menu.jsx`: `!loaded` → `<MenuSkeleton />`.
4. Update `KeypadMenu` in `Menu.jsx`: `!loaded` → `<MenuSkeleton />`; `loaded && empty` → distinct empty state.
5. Update `TVApp.jsx`: Only the bare `!list` path (no deep link) → `<MenuSkeleton />`. Leave the other two paths as-is.
6. Add a subtle fade-in on `.menu-items-container` to smooth the skeleton→content transition.
7. **Do not touch** `MenuStack.jsx` or Suspense fallbacks.
8. Verify visual regression, especially item dimensions matching between skeleton and real grid.

---

## Phased Implementation Plan

### Phase 1: Foundation (Est. 1–2 hours)
**Goal:** Shared skeleton infrastructure with zero integration risk.

| Step | Task | Files | Acceptance |
|------|------|-------|------------|
| 1a | Extract skeleton SCSS into `frontend/src/styles/_skeleton.scss` — move `@keyframes skeleton-pulse` and `.skeleton` utility classes out of `OfficeApp.scss`, consolidate with the existing `@keyframes shimmer` from `Menu.scss` into one file. | `_skeleton.scss` (new), `OfficeApp.scss`, `Menu.scss` | Existing Weather/Upcoming/WeatherForecast skeletons render identically. No visual diff. |
| 1b | `@import '_skeleton'` from both `OfficeApp.scss` and `Menu.scss`. Remove duplicated keyframes/classes from originals. | `OfficeApp.scss`, `Menu.scss` | `npm run build` passes. No SCSS compile errors. |
| 1c | Verify existing skeleton consumers (Weather, Upcoming, WeatherForecast, menu item images) still work. | — | Manual spot check on Office and TV apps. |

**Merge gate:** This phase is a pure refactor. Ship it independently before touching any loading states.

---

### Phase 2: MenuSkeleton Component (Est. 1–2 hours)
**Goal:** Build the component in isolation; no integration yet.

| Step | Task | Files | Acceptance |
|------|------|-------|------------|
| 2a | Create `frontend/src/modules/Menu/MenuSkeleton.jsx`. Accept `count` prop (default 10). Render header placeholder + grid of skeleton items using `.menu-item` dimensions exactly. | `MenuSkeleton.jsx` (new) | Component renders in Storybook or dev tools isolation. |
| 2b | Add `.menu-skeleton` styles to `Menu.scss` — skeleton item uses same `calc(20% - 0.8 * 0.75rem)` width, `1 / 1.19` aspect-ratio, `0.75rem` border-radius. Import shared shimmer from `_skeleton.scss`. | `Menu.scss` | Skeleton items are pixel-identical in size to real `.menu-item` cards. |
| 2c | Add fade-in keyframe on `.menu-items-container` (200ms opacity 0.7→1). | `Menu.scss` | Smooth transition when swapping skeleton → real content. |

**Merge gate:** Component exists and is styled, but nothing imports it yet. Safe to ship.

---

### Phase 3: TVMenu Integration (Est. 30 min)
**Goal:** Eliminate the worst offender — blank screen on root menu load.

| Step | Task | Files | Acceptance |
|------|------|-------|------------|
| 3a | In `TVMenu`: replace `if (!loaded) return null` with `if (!loaded) return <MenuSkeleton />`. | `Menu.jsx` | Root menu shows skeleton grid instead of blank screen during load. |
| 3b | In `TVApp.jsx`: replace `<PlayerOverlayLoading>` with `<MenuSkeleton />` **only** for the bare `!list` path (no `isQueueOrPlay` or `appParam`). Leave the other two loading paths unchanged. | `TVApp.jsx` | Initial app launch shows menu skeleton. Deep links and autoplay still show spinner. |

**Merge gate:** Covers the primary user-facing improvement. Deploy and observe for one cycle before proceeding.

---

### Phase 4: KeypadMenu + Empty States (Est. 30 min–1 hour)
**Goal:** Complete menu coverage; clean up semantic loading vs. empty distinction.

| Step | Task | Files | Acceptance |
|------|------|-------|------------|
| 4a | In `KeypadMenu`: split the guard into two: `!loaded` → `<MenuSkeleton />`; `loaded && !menuItems.length` → new empty state component or message. | `Menu.jsx` | Keypad menu shows skeleton during load, "No items" when genuinely empty. |
| 4b | Create `MenuEmpty` component or inline empty state (header + centered message). | `Menu.jsx` or `MenuEmpty.jsx` | Empty state is visually distinct from loading — no animation, clear messaging. |

**Merge gate:** All menu loading paths now use skeleton loaders. `PlayerOverlayLoading` is no longer imported in any menu context.

---

### Phase 5: Cleanup & Polish (Est. 30 min)
**Goal:** Remove debt, verify, document.

| Step | Task | Files | Acceptance |
|------|------|-------|------------|
| 5a | Audit remaining non-player uses of `PlayerOverlayLoading` across the codebase. File issues or fix inline if trivial. | Codebase-wide grep | No non-player files import `PlayerOverlayLoading` (or issues filed for remaining ones). |
| 5b | Visual regression check: root menu load, sub-menu navigation, keypad menu, deep link entry, autoplay flow. | — | No layout shift, no flash of wrong skeleton, no regressions. |
| 5c | Update `docs/reference/tv/5-features.md` (or create `docs/reference/tv/features/skeleton-loader.md`) documenting the skeleton system and how to use `MenuSkeleton` in new contexts. | Docs | Reference docs current. |
| 5d | Move this plan from `docs/_wip/plans/` to `docs/_archive/` with completion date. | Docs | WIP cleared. |

---

### Timeline Summary

| Phase | Scope | Est. Time | Risk | Ships Independently |
|------|-------|-----------|------|---------------------|
| 1 | SCSS consolidation | 1–2h | Low (pure refactor) | Yes |
| 2 | MenuSkeleton component | 1–2h | Low (no integration) | Yes |
| 3 | TVMenu + TVApp integration | 30min | Medium (user-facing change) | Yes |
| 4 | KeypadMenu + empty states | 30min–1h | Low | Yes |
| 5 | Cleanup & docs | 30min | None | Yes |

**Total estimated effort: 3.5–6 hours across 5 independently shippable phases.**

Each phase is a safe, atomic unit of work. If any phase reveals issues, subsequent phases can be deferred without leaving the codebase in a broken state.
