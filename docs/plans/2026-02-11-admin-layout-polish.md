# Admin UI Layout Polish — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the Admin UI's spatial design — scrolling, max-widths, padding, and inline styles — so every page shares a single, predictable layout rhythm using the existing design token system.

**Architecture:** The Admin UI uses Mantine AppShell (sidebar 260px, header 48px, scrollable main). Most pages let AppShell.Main own scrolling, but ContentLists introduced a nested scroll context with a hardcoded viewport calc. The fix is to remove nested scrolling, unify max-widths, and consistently apply the existing `--ds-space-*` tokens that are already defined but underused.

**Tech Stack:** React, Mantine v7, SCSS, CSS custom properties (design tokens)

---

### Task 1: Eliminate Nested Scrolling in ContentLists

ContentLists creates a second scroll context (`.sections-scroll` with `overflow-y: auto`) inside the already-scrollable `AppShell.Main`. This causes double scrollbars and unpredictable scroll behavior. The `height: calc(100vh - 120px)` is a magic number that will break if the header changes.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ContentLists.scss` (lines ~1-30, the `.lists-view` block)
- Modify: `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx` (the `.sections-scroll` wrapper div)

**Step 1: Remove the viewport-clamped height from `.lists-view`**

In `ContentLists.scss`, find the `.lists-view` block and remove the fixed-height viewport layout:

```scss
// BEFORE
.lists-view {
  width: 100%;
  max-width: 1000px;
  table-layout: fixed;
  height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
  overflow: hidden;

  .sections-scroll {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
}

// AFTER
.lists-view {
  width: 100%;
  max-width: var(--ds-content-max);
}
```

Remove the entire `.sections-scroll` sub-block. The content will now scroll naturally within AppShell.Main.

**Step 2: Remove the `.sections-scroll` wrapper in ListsFolder.jsx**

In `ListsFolder.jsx`, find the `<div className="sections-scroll">` wrapper and unwrap its children — remove the div but keep its contents in place. The sections should be direct children of `.lists-view`.

**Step 3: Verify visually**

Run the dev server and navigate to any content list folder (e.g., `/admin/content/lists/menus/tvapp`). Confirm:
- Single scrollbar on the right (AppShell.Main's scrollbar)
- No inner scrollbar on the content area
- All rows visible by scrolling the main area
- Header/breadcrumb stays within the scroll (not sticky — that's fine)

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ContentLists.scss frontend/src/modules/Admin/ContentLists/ListsFolder.jsx
git commit -m "fix(admin): remove nested scrolling in ContentLists, use AppShell.Main as single scroll owner"
```

---

### Task 2: Unify Scrollbar Styling

Custom scrollbar CSS (6px track, DS-themed colors) is only on `.mantine-AppShell-main`. Any other scrollable element (e.g., modals, dropdowns, image picker grids) gets the default browser scrollbar.

**Files:**
- Modify: `frontend/src/modules/Admin/Admin.scss` (extract scrollbar styles)
- Modify: `frontend/src/modules/Admin/Admin.variables.scss` (add mixin or utility class)

**Step 1: Create a scrollbar mixin in Admin.variables.scss**

Add at the bottom of `Admin.variables.scss`:

```scss
/* ── Scrollbar mixin ── */
@mixin ds-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: var(--ds-scrollbar-thumb) var(--ds-scrollbar-track);

  &::-webkit-scrollbar {
    width: var(--ds-scrollbar-width);
  }
  &::-webkit-scrollbar-track {
    background: var(--ds-scrollbar-track);
  }
  &::-webkit-scrollbar-thumb {
    background-color: var(--ds-scrollbar-thumb);
    border-radius: 3px;
    &:hover {
      background-color: var(--ds-scrollbar-thumb-hover);
    }
  }
}
```

**Step 2: Use the mixin in Admin.scss**

Replace the inline scrollbar CSS on `.mantine-AppShell-main` with `@include ds-scrollbar;`.

Also apply it globally to any scrollable context inside `.admin-layout`:

```scss
.admin-layout {
  .mantine-AppShell-main {
    @include ds-scrollbar;
    // ... rest of styles
  }

  // Apply to any scrollable element inside admin
  .mantine-ScrollArea-viewport,
  .mantine-Modal-body,
  .image-picker-grid {
    @include ds-scrollbar;
  }
}
```

**Step 3: Verify visually**

Open a modal or any area that might scroll (e.g., the image picker in a content list item). Confirm the scrollbar matches the themed 6px style.

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/Admin.scss frontend/src/modules/Admin/Admin.variables.scss
git commit -m "refactor(admin): extract scrollbar styling into reusable mixin, apply globally"
```

---

### Task 3: Rationalize Max-Width System

Three max-widths exist with no clear relationship:
- `--ds-content-max: 1200px` (global)
- `--ds-table-max: 1000px` (lists)
- `--ds-form-max: 720px` (config forms)

The 1000px table width is awkwardly close to 1200px and creates inconsistent visual gutters. The lists should use the same content-max as everything else.

**Files:**
- Modify: `frontend/src/modules/Admin/Admin.variables.scss` (simplify tokens)
- Modify: `frontend/src/modules/Admin/Admin.scss` (update references)
- Modify: `frontend/src/modules/Admin/ContentLists/ContentLists.scss` (if any direct 1000px refs remain)

**Step 1: Remove `--ds-table-max` token**

In `Admin.variables.scss`, remove the `--ds-table-max: 1000px;` line. Tables and lists should use `--ds-content-max` like everything else.

**Step 2: Update any references to `--ds-table-max`**

Search for `--ds-table-max` across all files. Replace with `--ds-content-max`.

In Task 1, we already changed `.lists-view` to use `--ds-content-max`. Check if any other file references `--ds-table-max` and update.

**Step 3: Verify**

Navigate to content lists, scheduler, members — confirm they all share the same max-width and the layout feels consistently guttered.

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/Admin.variables.scss frontend/src/modules/Admin/Admin.scss frontend/src/modules/Admin/ContentLists/ContentLists.scss
git commit -m "refactor(admin): remove --ds-table-max, unify all content areas to --ds-content-max"
```

---

### Task 4: Adopt Spacing Tokens for Vertical Rhythm

The spacing token scale (`--ds-space-1` through `--ds-space-10`) exists but is underused. Hardcoded pixel values create inconsistent rhythm. The goal: all page-level and section-level spacing uses tokens.

**Files:**
- Modify: `frontend/src/modules/Admin/Admin.scss`
- Modify: `frontend/src/modules/Admin/ContentLists/ContentLists.scss`

**Step 1: Audit and replace hardcoded values in Admin.scss**

The main area padding is already tokenized (`var(--ds-space-6) var(--ds-space-8) var(--ds-space-10)`), which is good. But the asymmetric `24px 32px 40px` (top/sides/bottom) is unusual. Normalize to symmetric padding:

```scss
.mantine-AppShell-main {
  padding: var(--ds-space-6) var(--ds-space-6); // 24px all around
}
```

This gives consistent breathing room. The extra bottom padding (40px) was compensating for the lack of a last-element margin — instead add `padding-bottom: var(--ds-space-8)` only if needed after testing.

**Step 2: Fix table cell padding in ContentLists.scss**

The `2px 4px` padding on `.item-row` cells is extremely tight. Increase to the minimum readable spacing:

```scss
.item-row {
  // Was: padding: 2px 4px;
  padding: var(--ds-space-1) var(--ds-space-2); // 4px 8px
}
```

**Step 3: Standardize section spacing**

In the `.lists-folder-header` (in ContentLists.scss), replace hardcoded `20px 24px` with tokens:

```scss
.lists-folder-header {
  padding: var(--ds-space-4) var(--ds-space-5); // 16px 20px — tighter for header bar
}
```

**Step 4: Verify**

Check ListsFolder, ListsIndex, Scheduler, Members — all should feel evenly spaced with consistent gutters. Table rows should have comfortable breathing room.

**Step 5: Commit**

```bash
git add frontend/src/modules/Admin/Admin.scss frontend/src/modules/Admin/ContentLists/ContentLists.scss
git commit -m "refactor(admin): replace hardcoded padding with spacing tokens for consistent rhythm"
```

---

### Task 5: Extract Inline Layout Styles to SCSS

Several components use `style={{}}` for layout concerns that belong in CSS. This makes the width/spacing system hard to audit.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx` (search width inline style)
- Modify: `frontend/src/modules/Admin/ContentLists/ContentLists.scss` (add classes)
- Modify: `frontend/src/modules/Admin/shared/ConfigFormWrapper.jsx` (sticky bar inline styles)
- Modify: `frontend/src/modules/Admin/Admin.scss` (add sticky bar class)
- Modify: `frontend/src/modules/Admin/Apps/ShoppingConfig.jsx` (field width inline styles)

**Step 1: Extract the search input width in ListsFolder.jsx**

Find `style={{ width: 200 }}` on the search TextInput. Replace with a CSS class:

In `ContentLists.scss`:
```scss
.lists-folder-search {
  width: 200px;
}
```

In `ListsFolder.jsx`, replace `style={{ width: 200 }}` with `className="lists-folder-search"`.

**Step 2: Extract the sticky action bar in ConfigFormWrapper.jsx**

The entire sticky bar is inline-styled. Move to `Admin.scss`:

```scss
.ds-action-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  background-color: var(--ds-bg-surface);
  padding: var(--ds-space-4) 0;
  margin-bottom: var(--ds-space-4);
  border-bottom: 1px solid transparent;
  transition: border-color var(--ds-transition-base);

  &.ds-action-bar--dirty {
    border-bottom-color: var(--ds-border);
  }
}
```

In `ConfigFormWrapper.jsx`, replace the inline `style={{...}}` with `className={`ds-action-bar ${dirty ? 'ds-action-bar--dirty' : ''}`}` and remove the style prop entirely.

**Step 3: Extract field width constraints in ShoppingConfig.jsx**

Find `style={{ maxWidth: 180 }}` and `style={{ maxWidth: 360 }}`. Replace with utility classes:

In `Admin.scss`:
```scss
.ds-field--id { max-width: 180px; }
.ds-field--select { max-width: 360px; }
```

Or better: use the existing `.ds-config-body` NumberInput/TextInput constraints from Admin.scss if the widths are close enough.

**Step 4: Verify**

Navigate to shopping config, any config form with the action bar, and ListsFolder. Confirm no visual regressions.

**Step 5: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsFolder.jsx frontend/src/modules/Admin/ContentLists/ContentLists.scss frontend/src/modules/Admin/shared/ConfigFormWrapper.jsx frontend/src/modules/Admin/Admin.scss frontend/src/modules/Admin/Apps/ShoppingConfig.jsx
git commit -m "refactor(admin): extract inline layout styles to SCSS classes"
```

---

### Task 6: Define Z-Index Layer Scale

Only one sticky element exists today (ConfigFormWrapper action bar, z-index: 10), but there's no system. Define a scale so future sticky elements and overlays don't conflict.

**Files:**
- Modify: `frontend/src/modules/Admin/Admin.variables.scss` (add z-index tokens)
- Modify: `frontend/src/modules/Admin/Admin.scss` (reference tokens)

**Step 1: Add z-index tokens**

In `Admin.variables.scss`, add:

```scss
/* ── Z-index layers ── */
--ds-z-base: 0;
--ds-z-sticky: 10;
--ds-z-dropdown: 100;
--ds-z-overlay: 200;
--ds-z-modal: 300;
--ds-z-toast: 400;
```

**Step 2: Use the token in the sticky bar class**

In `Admin.scss`, the `.ds-action-bar` (created in Task 5) should reference:

```scss
z-index: var(--ds-z-sticky);
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/Admin.variables.scss frontend/src/modules/Admin/Admin.scss
git commit -m "refactor(admin): add z-index layer scale tokens"
```

---

### Task 7: Add Responsive Padding Breakpoint

All padding is static. Add a single tablet breakpoint that tightens page padding on smaller screens.

**Files:**
- Modify: `frontend/src/modules/Admin/Admin.scss`
- Modify: `frontend/src/modules/Admin/Admin.variables.scss` (optional: add breakpoint token)

**Step 1: Add a tablet breakpoint for main content padding**

In `Admin.scss`, after the `.mantine-AppShell-main` padding rule, add:

```scss
.mantine-AppShell-main {
  padding: var(--ds-space-6); // 24px all around (set in Task 4)

  @media (max-width: 768px) {
    padding: var(--ds-space-4); // 16px on tablet and below
  }
}
```

**Step 2: Optionally add a breakpoint token**

In `Admin.variables.scss`:

```scss
/* ── Breakpoints ── */
--ds-breakpoint-tablet: 768px;
```

Note: CSS custom properties can't be used in `@media` queries directly (they're not supported there). The token is for documentation/reference; the actual `@media` rule uses the literal value.

**Step 3: Verify**

Resize the browser to below 768px. Confirm padding tightens but content remains usable.

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/Admin.scss frontend/src/modules/Admin/Admin.variables.scss
git commit -m "feat(admin): add responsive padding breakpoint for tablet screens"
```

---

## Summary

| Task | Priority | Description |
|------|----------|-------------|
| 1 | Critical | Eliminate nested scrolling in ContentLists |
| 2 | High | Unify scrollbar styling with mixin |
| 3 | High | Rationalize max-width system (remove --ds-table-max) |
| 4 | High | Adopt spacing tokens for vertical rhythm |
| 5 | Medium | Extract inline layout styles to SCSS |
| 6 | Low | Define z-index layer scale |
| 7 | Low | Add responsive padding breakpoint |

Tasks 1–4 are the highest-impact changes. Tasks 5–7 are cleanup and future-proofing.
