# ContentScroller — Honor Screen-Framework Master Volume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ContentScroller` (and therefore `ReadalongScroller` + `SingalongScroller`) apply the screen-framework software master volume to its main `<audio>` / `<video>` element, so vol-up / vol-down / mute on the screen numpad actually affect scripture/talk/poetry/hymn/primary-song playback.

**Architecture:**
- The bug is in `frontend/src/modules/Player/renderers/ContentScroller.jsx`. `handleLoadedMetadata` sets `mainEl.volume = processedVolume` directly, ignoring `useScreenVolume().master`. There is no live re-apply effect either, so vol-up mid-playback does nothing.
- Fix mirrors the existing pattern in `frontend/src/modules/Player/hooks/useCommonMediaController.js:324-336` and `frontend/src/modules/Player/components/AudioLayer.jsx`: read `master` via `useScreenVolume()`, multiply it into the element volume on first apply, and add an effect that re-applies `mainEl.volume = adjusted × master` when either `master` or `mainVolume` changes.
- Outside any `ScreenVolumeProvider` (e.g. when `Player` is mounted in Fitness/Feed hosts), the context default is `master: 1`, so the change is a no-op there — no other module needs touching.

**Tech Stack:** React 18, vitest, @testing-library/react, jsdom.

---

## File Structure

**Modify:**
- `frontend/src/modules/Player/renderers/ContentScroller.jsx` — add `useScreenVolume` import, read `master`, multiply into the volume set in `handleLoadedMetadata`, add a re-apply effect.

**Create:**
- `frontend/src/modules/Player/renderers/ContentScroller.volume.test.jsx` — colocated vitest unit test that mounts `ContentScroller` in jsdom, fires `loadedmetadata`, and asserts `mainEl.volume === mainVolume × master` initially and after master changes.

No other files change. `ReadalongScroller.jsx` and `SingalongScroller.jsx` already forward `mainVolume` correctly; they get the fix for free.

---

## Task 1: Failing test — initial volume honors master

**Files:**
- Create: `frontend/src/modules/Player/renderers/ContentScroller.volume.test.jsx`

- [ ] **Step 1: Write the failing test file**

Create `frontend/src/modules/Player/renderers/ContentScroller.volume.test.jsx` with the following content:

```jsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import ContentScroller from './ContentScroller.jsx';
import { ScreenVolumeProvider } from '../../../screen-framework/providers/ScreenVolumeProvider.jsx';
import { _resetForTests, useScreenVolume } from '../../../lib/volume/ScreenVolumeContext.js';

// Minimal parseContent stub — ContentScroller calls it but the return is not
// asserted here.
const parseContent = () => <div data-testid="content" />;

// Fire the named event on the first <audio> or <video> in the container.
function fireMediaEvent(container, type) {
  const el = container.querySelector('audio, video');
  if (!el) throw new Error(`no media element found in container for "${type}"`);
  el.dispatchEvent(new Event(type));
  return el;
}

describe('ContentScroller — master volume integration', () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetForTests();
  });

  afterEach(() => {
    window.localStorage.clear();
    _resetForTests();
  });

  it('applies mainVolume × master on loadedmetadata', () => {
    const { container } = render(
      <ScreenVolumeProvider defaultMaster={0.5}>
        <ContentScroller
          type="readalong"
          title="Test"
          assetId="test-1"
          mainMediaUrl="https://example.test/audio.mp3"
          isVideo={false}
          mainVolume={0.8}
          contentData={{ data: [] }}
          parseContent={parseContent}
        />
      </ScreenVolumeProvider>
    );

    let mediaEl;
    act(() => {
      mediaEl = fireMediaEvent(container, 'loadedmetadata');
    });

    // 0.8 × 0.5 = 0.4
    expect(mediaEl.volume).toBeCloseTo(0.4, 5);
  });

  it('defaults to master = 1 when rendered without a ScreenVolumeProvider', () => {
    const { container } = render(
      <ContentScroller
        type="readalong"
        title="Test"
        assetId="test-2"
        mainMediaUrl="https://example.test/audio.mp3"
        isVideo={false}
        mainVolume={0.6}
        contentData={{ data: [] }}
        parseContent={parseContent}
      />
    );

    let mediaEl;
    act(() => {
      mediaEl = fireMediaEvent(container, 'loadedmetadata');
    });

    expect(mediaEl.volume).toBeCloseTo(0.6, 5);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails as expected**

Run: `cd /opt/Code/DaylightStation && frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Player/renderers/ContentScroller.volume.test.jsx`

Expected: The first test (`applies mainVolume × master on loadedmetadata`) FAILS with `expected 0.8 to be close to 0.4` (or similar) because `ContentScroller` currently sets `mainEl.volume = processedVolume` with no master multiplier. The second test (no provider) PASSES because `mainVolume = 0.6` already maps straight onto `el.volume`.

If both pass, the test is wrong — recheck that the assertion really exercises the bug path.

- [ ] **Step 3: Commit the failing test**

```bash
git add frontend/src/modules/Player/renderers/ContentScroller.volume.test.jsx
git commit -m "test(player): failing test — ContentScroller ignores master volume on loadedmetadata"
```

---

## Task 2: Implement master multiplier in `handleLoadedMetadata`

**Files:**
- Modify: `frontend/src/modules/Player/renderers/ContentScroller.jsx` (add import; read `master`; multiply into volume)

- [ ] **Step 1: Add the `useScreenVolume` import**

In `frontend/src/modules/Player/renderers/ContentScroller.jsx`, find the import block near the top (lines 1-16). After the line:

```jsx
import { useMediaReporter } from '../hooks/useMediaReporter.js';
```

add:

```jsx
import { useScreenVolume } from '../../../lib/volume/ScreenVolumeContext.js';
```

- [ ] **Step 2: Read `master` inside the component body**

In the same file, locate the top of the component body (around line 72, immediately after the `mainRef` declaration: `const mainRef = useRef(null);`). Insert:

```jsx
// Screen-framework software master volume. Outside a ScreenVolumeProvider
// (e.g. Fitness host) the context default is master=1, so this is a no-op.
const { master: masterVolume } = useScreenVolume();
```

- [ ] **Step 3: Multiply `master` into `handleLoadedMetadata`**

Find `handleLoadedMetadata` (around lines 224-238). Replace:

```jsx
    const handleLoadedMetadata = useCallback(() => {
      const mainEl = mainRef.current;
      if (mainEl) {
        setDuration(mainEl.duration);

        if (mainVolume !== undefined) {
          let processedVolume = parseFloat(mainVolume || 100);
          if (processedVolume > 1) processedVolume = processedVolume / 100;
          mainEl.volume = Math.min(1, Math.max(0, processedVolume));
        }
        mainEl.play().catch(() => {});
        applyPendingSeek();
        reportPlaybackMetrics();
      }
    }, [mainVolume, applyPendingSeek, reportPlaybackMetrics, isVideo]);
```

with:

```jsx
    const handleLoadedMetadata = useCallback(() => {
      const mainEl = mainRef.current;
      if (mainEl) {
        setDuration(mainEl.duration);

        if (mainVolume !== undefined) {
          let processedVolume = parseFloat(mainVolume || 100);
          if (processedVolume > 1) processedVolume = processedVolume / 100;
          const adjusted = Math.min(1, Math.max(0, processedVolume));
          mainEl.volume = Math.min(1, Math.max(0, adjusted * masterVolume));
        }
        mainEl.play().catch(() => {});
        applyPendingSeek();
        reportPlaybackMetrics();
      }
    }, [mainVolume, masterVolume, applyPendingSeek, reportPlaybackMetrics, isVideo]);
```

- [ ] **Step 4: Run the test and verify both cases pass**

Run: `cd /opt/Code/DaylightStation && frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Player/renderers/ContentScroller.volume.test.jsx`

Expected: Both tests PASS. The `0.8 × 0.5 = 0.4` assertion now succeeds because `handleLoadedMetadata` multiplies by `masterVolume`. The no-provider case still passes (context default master = 1 → `0.6 × 1 = 0.6`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Player/renderers/ContentScroller.jsx
git commit -m "fix(player): ContentScroller multiplies mainVolume by screen-framework master on load"
```

---

## Task 3: Failing test — live master changes re-apply during playback

**Files:**
- Modify: `frontend/src/modules/Player/renderers/ContentScroller.volume.test.jsx` (append a third test)

- [ ] **Step 1: Append the failing test**

Open `frontend/src/modules/Player/renderers/ContentScroller.volume.test.jsx`. Inside the existing `describe('ContentScroller — master volume integration', …)` block, immediately before the closing `});` of that describe, add this test:

```jsx
  it('re-applies master × mainVolume when master changes mid-playback', () => {
    // Probe lets the test reach the provider's `setMaster` from outside.
    let api;
    const Probe = () => {
      const v = useScreenVolume();
      React.useEffect(() => { api = v; }, [v]);
      return null;
    };

    const { container } = render(
      <ScreenVolumeProvider defaultMaster={0.5}>
        <Probe />
        <ContentScroller
          type="readalong"
          title="Test"
          assetId="test-3"
          mainMediaUrl="https://example.test/audio.mp3"
          isVideo={false}
          mainVolume={0.8}
          contentData={{ data: [] }}
          parseContent={parseContent}
        />
      </ScreenVolumeProvider>
    );

    let mediaEl;
    act(() => {
      mediaEl = fireMediaEvent(container, 'loadedmetadata');
    });
    // 0.8 × 0.5 = 0.4
    expect(mediaEl.volume).toBeCloseTo(0.4, 5);

    // User presses vol-up — master changes mid-playback.
    act(() => api.setMaster(1.0));
    // 0.8 × 1.0 = 0.8
    expect(mediaEl.volume).toBeCloseTo(0.8, 5);

    // Mute — master → 0.
    act(() => api.toggleMute());
    expect(mediaEl.volume).toBeCloseTo(0, 5);
  });
```

- [ ] **Step 2: Run the test and verify the new case fails**

Run: `cd /opt/Code/DaylightStation && frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Player/renderers/ContentScroller.volume.test.jsx`

Expected: The first two tests still PASS. The new `re-applies master × mainVolume when master changes mid-playback` test FAILS — after `setMaster(1.0)` the element volume is still `0.4` because there is no effect propagating live master changes. The mute assertion also fails for the same reason.

- [ ] **Step 3: Commit the failing test**

```bash
git add frontend/src/modules/Player/renderers/ContentScroller.volume.test.jsx
git commit -m "test(player): failing test — ContentScroller does not re-apply master mid-playback"
```

---

## Task 4: Add the live re-apply effect

**Files:**
- Modify: `frontend/src/modules/Player/renderers/ContentScroller.jsx` (add a new useEffect after `handleLoadedMetadata`)

- [ ] **Step 1: Insert the re-apply effect**

In `frontend/src/modules/Player/renderers/ContentScroller.jsx`, find the end of `handleLoadedMetadata` (the closing of the `useCallback` you edited in Task 2). Immediately after it — before the next block (`// Seek bar click => set new currentTime`) — insert:

```jsx
    // Re-apply master × mainVolume to the active media element when either
    // changes mid-playback. Mirrors useCommonMediaController.js:327-336 so the
    // screen-framework numpad vol-up/down/mute affects scripture/talk/poetry/
    // hymn/primary-song playback the same way it affects standard player media.
    useEffect(() => {
      const mainEl = mainRef.current;
      if (!mainEl) return;
      if (mainVolume === undefined) return;
      let processed = parseFloat(mainVolume || 100);
      if (processed > 1) processed = processed / 100;
      const adjusted = Math.min(1, Math.max(0, processed));
      try {
        mainEl.volume = Math.min(1, Math.max(0, adjusted * masterVolume));
      } catch { /* element may not yet support volume */ }
    }, [masterVolume, mainVolume]);
```

- [ ] **Step 2: Run the test and verify all three cases pass**

Run: `cd /opt/Code/DaylightStation && frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Player/renderers/ContentScroller.volume.test.jsx`

Expected: All three tests PASS. After `setMaster(1.0)` the effect fires and sets `el.volume = 0.8 × 1.0 = 0.8`. After `toggleMute()` the effect fires with `master = 0` and sets `el.volume = 0`.

- [ ] **Step 3: Run the broader Player + screen-framework unit tests to confirm no regression**

Run: `cd /opt/Code/DaylightStation && frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Player frontend/src/screen-framework`

Expected: All tests PASS. Pay particular attention to `ScreenVolumeProvider.test.jsx`, `MasterVolumeToast.test.jsx`, and `VideoPlayer.hardReset.test.jsx` — none of them should regress.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Player/renderers/ContentScroller.jsx
git commit -m "fix(player): ContentScroller re-applies master volume mid-playback"
```

---

## Task 5: Manual smoke verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server if not already running**

Check first: `lsof -i :3112` (kckern-server backend port).

If nothing is listening, start it:

```bash
cd /opt/Code/DaylightStation && nohup node backend/index.js > /tmp/backend-dev.log 2>&1 &
```

If a server is already running, leave it alone.

- [ ] **Step 2: Verify readalong honors master volume**

Open the office screen (`http://localhost:3112/screen/office` or whatever route the local dev server exposes) and queue a scripture or talk via the normal flow. Once it starts playing:

- Press vol-up on the numpad. Confirm: (a) the `MasterVolumeToast` HUD appears with the new level, AND (b) the spoken audio gets louder.
- Press vol-down. Confirm both HUD and audio drop.
- Press mute. Confirm both HUD shows 🔇 Muted AND audio goes silent.
- Press vol-up again. Confirm audio unmutes and steps up in one action.

- [ ] **Step 3: Verify singalong honors master volume**

Queue a hymn or primary song. Repeat the vol-up / vol-down / mute / unmute checks. Confirm all four operations now actually affect the singing audio (previously they did not — that was the bug).

- [ ] **Step 4: Verify standard video playback still works (no regression)**

Queue a Plex video. Repeat vol-up / vol-down / mute / unmute. Confirm nothing changed for the standard path — `useCommonMediaController` was already doing the right thing and we did not touch it.

- [ ] **Step 5: Report status**

If all three flows behave as expected: announce manual verification passed.

If any flow misbehaves, do NOT push forward. Stop and report the discrepancy.

---

## Done When

- All three tests in `ContentScroller.volume.test.jsx` pass.
- Existing tests in `frontend/src/modules/Player/**` and `frontend/src/screen-framework/**` still pass.
- Manual verification: vol-up / vol-down / mute / unmute on the screen-framework numpad audibly affects readalong and singalong content during playback.
- Four commits land on the branch (failing test → fix → failing test → fix). No commit bundles a passing test with the code that makes it pass.
