# Admin Row Thumbnail Loading State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an admin user saves a new image/content value to a row (e.g. `canvas:religious/sianai.jpg` → `canvas:religious/serpent.jpg`), the row's thumbnail must show a visible loading state (shimmer skeleton) during the transition — instead of continuing to render the old image and then abruptly swapping to the new one once it finishes downloading.

**Architecture:** A `ShimmerAvatar` component already exists in `ListsItemRow.jsx:377-429` and does exactly the right thing — it preloads the image via `new Image()`, tracks `loaded`/`error` via state, resets on `src` change, and renders a shimmer `<div className="avatar-shimmer">` while loading. Four other spots in the same file already use it. The row-level thumbnail at line 2648 is the only holdout — it uses plain Mantine `<Avatar>`, which swaps the `<img>` src but doesn't react to load timing. The fix is a direct component swap. We will also add `image.load.*` log events to the `ShimmerAvatar` for future observability, and verify the CSS shimmer animation is well-defined.

**Tech Stack:** React (`useState`, `useEffect`), browser `Image` preloader, Mantine `Avatar`, CSS keyframe animation (`.avatar-shimmer`), DaylightStation structured logger.

**Worktree note:** This plan should execute in a dedicated git worktree off `main`. Create one via superpowers:using-git-worktrees before Task 1.

---

## File Structure

**Modify:**
- `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:2648` — swap `<Avatar>` for `<ShimmerAvatar>`.
- `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:377-429` (`ShimmerAvatar`) — add `image.load.start/end/error` log events; surface optional `onLoad`/`onError` props so callers can observe.

**Verify (no change):**
- `frontend/src/modules/Admin/ContentLists/*.css` (or wherever `.avatar-shimmer` is defined) — confirm the keyframe animation exists and is visible. Fix if missing.

**Test (new file):**
- `tests/isolated/modules/Admin/shimmerAvatar.test.mjs` — unit tests for ShimmerAvatar state transitions using React Testing Library + jsdom.

---

## Task 1: Locate and verify the `.avatar-shimmer` CSS

**Files:**
- Discover: any CSS file under `frontend/src/modules/Admin/ContentLists/` or a global admin stylesheet.

- [ ] **Step 1: Find the CSS**

Run:
```
grep -rn "avatar-shimmer" frontend/src/
```

Record the path and line number. If it is defined, read the rule and confirm:
- It has a visible animation (keyframes that change opacity or background-position)
- The animation is `infinite` or `linear infinite` while loading
- The dimensions respect inline `style` (don't force width/height via CSS over inline)

- [ ] **Step 2: If missing, add minimal shimmer CSS**

If the grep returned no matches, add a rule to the nearest existing admin stylesheet (e.g. `frontend/src/modules/Admin/ContentLists/contentLists.css` — if none exists, create one and import it from `ListsItemRow.jsx` with `import './contentLists.css';`):

```css
.avatar-shimmer {
  background: linear-gradient(90deg, #2a2a2a 0%, #3a3a3a 50%, #2a2a2a 100%);
  background-size: 200% 100%;
  animation: avatar-shimmer-sweep 1.2s ease-in-out infinite;
}

@keyframes avatar-shimmer-sweep {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

- [ ] **Step 3: Visual check**

Restart the dev server. Open any admin page with ShimmerAvatar instances (the item detail view at line 2252 uses one with `size={80}` — large enough to see). Throttle network to "Slow 3G" in DevTools, reload, and confirm the shimmer is visible during image download.

- [ ] **Step 4: Commit (if CSS was added)**

```bash
git add frontend/src/modules/Admin/ContentLists/contentLists.css \
        frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "style(admin): ensure avatar-shimmer keyframe is defined"
```

If the CSS was already correct, skip this commit.

---

## Task 2: Add log events to ShimmerAvatar

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:377-429`

- [ ] **Step 1: Read current ShimmerAvatar**

Confirm lines 377-429 match:
```javascript
function ShimmerAvatar({ src, size = 36, radius = 'sm', color, children, ...props }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => { setLoaded(false); setError(false); }, [src]);

  useEffect(() => {
    if (!src) { setError(true); return; }
    const img = new Image();
    img.onload = () => setLoaded(true);
    img.onerror = () => setError(true);
    img.src = src;
  }, [src]);

  // ... render branches
}
```

- [ ] **Step 2: Add timing + logging**

Replace the component with:

```javascript
function ShimmerAvatar({ src, size = 36, radius = 'sm', color, children, onLoadEvent, ...props }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const log = useMemo(() => adminLog('ShimmerAvatar'), []);
  const loadStartRef = useRef(0);

  // Reset state when src changes
  useEffect(() => {
    setLoaded(false);
    setError(false);
  }, [src]);

  // Preload image
  useEffect(() => {
    if (!src) {
      setError(true);
      return;
    }
    loadStartRef.current = performance.now();
    log.debug('image.load.start', { src });
    const img = new Image();
    img.onload = () => {
      const durationMs = Math.round(performance.now() - loadStartRef.current);
      log.info('image.load.end', { src, durationMs });
      setLoaded(true);
      onLoadEvent?.({ ok: true, src, durationMs });
    };
    img.onerror = () => {
      const durationMs = Math.round(performance.now() - loadStartRef.current);
      log.warn('image.load.error', { src, durationMs });
      setError(true);
      onLoadEvent?.({ ok: false, src, durationMs });
    };
    img.src = src;
  }, [src, log, onLoadEvent]);

  // No src or error - show fallback avatar with optional color
  if (!src || error) {
    return (
      <Avatar size={size} radius={radius} color={color} {...props}>
        {children}
      </Avatar>
    );
  }

  // Still loading - show shimmer
  if (!loaded) {
    return (
      <div
        className="avatar-shimmer"
        data-shimmer-src={src}
        style={{
          width: size,
          height: size,
          minWidth: size,
          borderRadius: radius === 'sm' ? 4 : radius === 'md' ? 8 : radius
        }}
      />
    );
  }

  // Loaded - show actual avatar
  return (
    <Avatar src={src} size={size} radius={radius} {...props}>
      {children}
    </Avatar>
  );
}
```

Make sure `useMemo`, `useRef`, and `adminLog` are imported at the top of the file. `adminLog` is already used throughout this file; `useRef` and `useMemo` are already imported.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "feat(admin-shimmer-avatar): emit image.load.start/end/error events"
```

---

## Task 3: Unit-test ShimmerAvatar state transitions

**Files:**
- Create: `tests/isolated/modules/Admin/shimmerAvatar.test.mjs`

- [ ] **Step 1: Confirm React Testing Library availability**

Check `package.json` for `@testing-library/react` and `jsdom`. If absent, abort this task and record a follow-up. The vitest config for isolated tests must use the `jsdom` environment.

```bash
cat package.json | grep -E "testing-library|jsdom|vitest"
```

- [ ] **Step 2: If ShimmerAvatar is not exported, export it**

Read line 377. If the function is declared as `function ShimmerAvatar(...)` without `export`, the test cannot import it. Add a named export below the component body:

```javascript
export { ShimmerAvatar };
```

Re-commit with message: `refactor(admin): export ShimmerAvatar for testing`.

- [ ] **Step 3: Write the failing test**

```javascript
// tests/isolated/modules/Admin/shimmerAvatar.test.mjs
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { ShimmerAvatar } from '#frontend/modules/Admin/ContentLists/ListsItemRow.jsx';

// Intercept Image preloading so we can control load timing.
class FakeImage {
  constructor() { this.src = ''; this.onload = null; this.onerror = null; FakeImage.instances.push(this); }
}
FakeImage.instances = [];

beforeEach(() => {
  FakeImage.instances = [];
  vi.stubGlobal('Image', FakeImage);
});

describe('ShimmerAvatar', () => {
  it('shows shimmer placeholder while loading', () => {
    const { container } = render(<ShimmerAvatar src="/img/test.jpg" size={40} />);
    expect(container.querySelector('.avatar-shimmer')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('swaps to Avatar when image loads', async () => {
    const onLoadEvent = vi.fn();
    const { container } = render(<ShimmerAvatar src="/img/test.jpg" onLoadEvent={onLoadEvent} />);
    const fake = FakeImage.instances[0];
    fake.onload();
    await waitFor(() => expect(container.querySelector('.avatar-shimmer')).toBeNull());
    expect(onLoadEvent).toHaveBeenCalledWith(expect.objectContaining({ ok: true, src: '/img/test.jpg' }));
  });

  it('falls back to Avatar fallback on error', async () => {
    const onLoadEvent = vi.fn();
    const { container } = render(
      <ShimmerAvatar src="/img/missing.jpg" onLoadEvent={onLoadEvent}>A</ShimmerAvatar>
    );
    const fake = FakeImage.instances[0];
    fake.onerror();
    await waitFor(() => expect(container.querySelector('.avatar-shimmer')).toBeNull());
    expect(onLoadEvent).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it('resets to shimmer when src changes', async () => {
    const { container, rerender } = render(<ShimmerAvatar src="/img/a.jpg" />);
    FakeImage.instances[0].onload();
    await waitFor(() => expect(container.querySelector('.avatar-shimmer')).toBeNull());

    rerender(<ShimmerAvatar src="/img/b.jpg" />);
    expect(container.querySelector('.avatar-shimmer')).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails then passes**

Run: `npx vitest run tests/isolated/modules/Admin/shimmerAvatar.test.mjs`
Expected: PASS once imports resolve. If `@testing-library/react` is absent, install it as a devDependency:

```bash
npm install --save-dev @testing-library/react @testing-library/jest-dom jsdom
```

Then re-run.

- [ ] **Step 5: Commit**

```bash
git add tests/isolated/modules/Admin/shimmerAvatar.test.mjs
git commit -m "test(admin): cover ShimmerAvatar state transitions"
```

If this task requires `npm install`, include `package.json` and `package-lock.json` in the commit.

---

## Task 4: Swap row thumbnail to use `ShimmerAvatar`

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:2648`

- [ ] **Step 1: Read the row thumbnail block**

Confirm lines 2647-2651 match:
```javascript
      <div className="col-icon" onClick={() => { log.info('image_picker.open', { index: item.index }); setImagePickerOpen(true); }}>
        <Avatar src={rowThumbnail} size={28} radius="sm">
          {item.label ? item.label.charAt(0).toUpperCase() : '#'}
        </Avatar>
      </div>
```

- [ ] **Step 2: Replace Avatar with ShimmerAvatar**

```javascript
      <div className="col-icon" onClick={() => { log.info('image_picker.open', { index: item.index }); setImagePickerOpen(true); }}>
        <ShimmerAvatar src={rowThumbnail} size={28} radius="sm">
          {item.label ? item.label.charAt(0).toUpperCase() : '#'}
        </ShimmerAvatar>
      </div>
```

- [ ] **Step 3: Smoke build**

```bash
npx vite build --logLevel=warn 2>&1 | tail -30
```

Expected: build succeeds. No "ShimmerAvatar is not defined" errors — it is defined in the same file above the component that uses it.

- [ ] **Step 4: Manual verify**

Start dev server. In the admin UI, navigate to a ContentList with rows that have thumbnail images. Pick a row, open the combobox, change its value to something else (e.g. a different plex item or an image path via freeform enter on a `canvas:` value).

Expected:
1. The instant you press Enter, the row's thumbnail flips to the shimmer skeleton.
2. After ~100-500ms the new image fades in.
3. For rows where the new src returns 404, the fallback letter/hash renders.

Cross-check: tail the admin log file (`media/logs/admin/*.jsonl`) and confirm `image.load.start` and `image.load.end` (or `.error`) events fire with the new src.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "fix(admin-row-thumbnail): show shimmer placeholder during src transition"
```

---

## Task 5: Playwright verification — loading state visible on content swap

**Files:**
- Create: `tests/live/flow/admin/admin-row-thumbnail-loading.runtime.test.mjs`

- [ ] **Step 1: Write the flow test**

```javascript
// tests/live/flow/admin/admin-row-thumbnail-loading.runtime.test.mjs
import { test, expect } from '@playwright/test';
import { getAppUrl } from '../../../_lib/configHelper.mjs';

test('row thumbnail shows shimmer placeholder between save and new image load', async ({ page }) => {
  const base = await getAppUrl();
  await page.goto(`${base}/admin`);

  // Throttle image loads to make the shimmer state observable.
  await page.route('**/*.{png,jpg,jpeg,webp,gif}', async (route) => {
    await new Promise(resolve => setTimeout(resolve, 800));
    await route.continue();
  });

  // Navigate to a ContentList with a canvas-image row.
  await page.getByRole('link', { name: /menus|lists|fhe/i }).first().click();

  const row = page.locator('[data-content-value^="canvas:"]').first();
  await row.click();

  // Change the value via freeform enter.
  const input = page.locator('input[placeholder*="Search"], input[data-combobox]').first();
  await input.fill('canvas:religious/serpent.jpg');
  await input.press('Enter');

  // Immediately check for the shimmer placeholder on the row icon.
  const shimmer = page.locator('[data-content-value] .avatar-shimmer, .col-icon .avatar-shimmer').first();
  await expect(shimmer).toBeVisible({ timeout: 500 });

  // Eventually the shimmer should disappear (image loaded).
  await expect(shimmer).toBeHidden({ timeout: 3000 });
});
```

- [ ] **Step 2: Run the test**

```bash
npx playwright test tests/live/flow/admin/admin-row-thumbnail-loading.runtime.test.mjs --reporter=line
```

Adjust selectors with `--headed` if needed, then re-run.

- [ ] **Step 3: Commit**

```bash
git add tests/live/flow/admin/admin-row-thumbnail-loading.runtime.test.mjs
git commit -m "test(admin-row-thumbnail): verify shimmer visible during image transition"
```

---

## Task 6: Audit other `<Avatar src=>` usages in the admin

**Files:**
- Scan: `frontend/src/modules/Admin/` (all files)

- [ ] **Step 1: Grep for bare Avatar usages**

```
grep -rn "Avatar\s\+src=" frontend/src/modules/Admin/
```

For each hit:
- If the component is inside the admin and renders a user-editable thumbnail (changes in response to user action), it is a candidate for ShimmerAvatar.
- If the component is a one-shot display (e.g., a header that loads once), plain Avatar is fine.

- [ ] **Step 2: Swap candidates**

For each candidate, change `<Avatar src={...}>` → `<ShimmerAvatar src={...}>`. Keep props otherwise identical. If ShimmerAvatar is in a different file than the candidate, import it — or move ShimmerAvatar into a shared file like `frontend/src/modules/Admin/shared/ShimmerAvatar.jsx` first.

- [ ] **Step 3: Manual verify each swap**

Exercise each page where a swap was made. Change source and confirm shimmer appears briefly.

- [ ] **Step 4: Commit per-file if scope grows**

```bash
git add <files>
git commit -m "fix(admin): use ShimmerAvatar for user-editable thumbnails"
```

Skip this task (with a note in the commit message of Task 4) if the grep shows no other candidates.

---

## Final Verification

- [ ] Unit tests green: `npx vitest run tests/isolated/modules/Admin/shimmerAvatar.test.mjs`
- [ ] Playwright flow green: `npx playwright test tests/live/flow/admin/admin-row-thumbnail-loading.runtime.test.mjs --reporter=line`
- [ ] Manual QA:
  - [ ] Row thumbnail transitions show shimmer, not stale-then-pop
  - [ ] Fallback letter renders when src is bad or missing
  - [ ] No regressions on the other four existing ShimmerAvatar spots
- [ ] Log events: `image.load.start`, `image.load.end` (with durationMs), `image.load.error` (with durationMs) all visible in admin log file during a thumbnail swap
- [ ] CSS: `.avatar-shimmer` animation is visible at all sizes (20, 28, 32, 36, 80 — the actual sizes used in this file)
