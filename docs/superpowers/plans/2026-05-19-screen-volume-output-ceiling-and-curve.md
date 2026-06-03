# Screen Volume — Per-Screen Output Ceiling + Perceptual Curve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the screen-framework master volume actually useful by giving each screen a configurable output ceiling (cap on actual amplitude) and a perceptual power curve (so vol-up/down notches feel evenly spaced instead of cliff-diving past the bottom 10%).

**Architecture:**
- `ScreenVolumeProvider` keeps `master ∈ [0, 1]` as the **user-facing** level (still drives the HUD, persistence, keyboard step logic, and `master === 0` → mute). Adds two new props: `outputCeiling` (default `1.0`) and `curveExponent` (default `1.0`).
- A new derived value `effectiveMaster = (master ** curveExponent) * outputCeiling` is exposed on the context (and mirrored to module-level state for non-React consumers). When `outputCeiling = 1.0` and `curveExponent = 1.0`, `effectiveMaster === master` — full backwards-compat.
- Every audio-output consumer that currently multiplies by `master` switches to `effectiveMaster`. The HUD (`MasterVolumeToast`) keeps reading `master` because the user-facing model is "10 of 10 notches."
- Per-screen YAML at `data/household/screens/{screen}.yml` gets an optional `volume:` block; `ScreenRenderer` reads it and forwards to the provider.

**Tech Stack:** React 18, vitest, @testing-library/react, jsdom, js-yaml (already used by `backend/src/4_api/v1/routers/screens.mjs`).

---

## File Structure

**Modify:**
- `frontend/src/screen-framework/providers/ScreenVolumeProvider.jsx` — accept `outputCeiling` + `curveExponent`, compute `effectiveMaster`, expose in context value, publish to module state.
- `frontend/src/lib/volume/ScreenVolumeContext.js` — add `effectiveMaster: 1` to context default, add `getEffectiveMaster()` + `subscribeEffective()` module-state APIs, update `_publishMasterState` signature to also accept `effectiveMaster`. Update `useEffectiveVolume(local)` to use `effectiveMaster * local`.
- `frontend/src/screen-framework/ScreenRenderer.jsx` (line 354) — forward `config.volume?.outputCeiling`, `config.volume?.curveExponent`, `config.volume?.stepSize`, `config.volume?.defaultMaster` to `ScreenVolumeProvider`.
- `frontend/src/modules/Player/components/AudioLayer.jsx` — destructure `effectiveMaster` from `useScreenVolume()` and use that wherever the file currently uses `master`/`masterVolume`.
- `frontend/src/modules/Player/components/AmbientLayer.jsx` — same swap.
- `frontend/src/modules/Player/renderers/ContentScroller.jsx` — same swap (destructure rename in both `handleLoadedMetadata` and the re-apply effect added in the previous plan).
- `frontend/src/modules/Player/hooks/useCommonMediaController.js` — same swap.
- `frontend/src/modules/Input/hooks/useNativeAudioBridge.js` — same swap.
- `frontend/src/modules/Piano/PianoSpaceInvaders/useSpaceInvadersGame.js` — replace `getMasterVolume()` with `getEffectiveMaster()`.
- `frontend/src/screen-framework/providers/ScreenVolumeProvider.test.jsx` — append tests for `outputCeiling` and `curveExponent`.
- `frontend/src/modules/Player/renderers/ContentScroller.volume.test.jsx` — append one end-to-end integration test.
- `data/household/screens/living-room.yml` — add example `volume:` block with `outputCeiling: 0.25`.
- `data/household/screens/office.yml` — add example `volume:` block (tuned for office hardware).

**No new files.** No documentation file — the YAML examples serve as living docs and `ScreenVolumeProvider`'s prop signatures are self-describing.

---

## Task 1: Failing test — outputCeiling scales effectiveMaster

**Files:**
- Modify: `frontend/src/screen-framework/providers/ScreenVolumeProvider.test.jsx`

- [ ] **Step 1: Append the failing test block**

Open `/opt/Code/DaylightStation/frontend/src/screen-framework/providers/ScreenVolumeProvider.test.jsx`. Find the last closing `});` of the outer `describe('ScreenVolumeProvider', …)` block. Immediately BEFORE that final `});`, insert this new nested describe:

```jsx
  describe('outputCeiling', () => {
    it('exposes effectiveMaster = master × outputCeiling when ceiling < 1', () => {
      const onValue = vi.fn();
      render(
        <ScreenVolumeProvider defaultMaster={0.8} outputCeiling={0.25}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      const last = onValue.mock.calls.at(-1)[0];
      expect(last.master).toBeCloseTo(0.8, 5);
      expect(last.effectiveMaster).toBeCloseTo(0.2, 5); // 0.8 × 0.25
    });

    it('defaults effectiveMaster = master when outputCeiling is omitted', () => {
      const onValue = vi.fn();
      render(
        <ScreenVolumeProvider defaultMaster={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      const last = onValue.mock.calls.at(-1)[0];
      expect(last.effectiveMaster).toBeCloseTo(0.5, 5);
    });

    it('mute always yields effectiveMaster = 0 regardless of ceiling', () => {
      let api;
      const onValue = vi.fn((v) => { api = v; });
      render(
        <ScreenVolumeProvider defaultMaster={0.8} outputCeiling={0.25}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      act(() => api.toggleMute());
      const last = onValue.mock.calls.at(-1)[0];
      expect(last.master).toBe(0);
      expect(last.effectiveMaster).toBe(0);
    });

    it('mirrors effectiveMaster to module state for non-React consumers', () => {
      render(
        <ScreenVolumeProvider defaultMaster={0.6} outputCeiling={0.5}>
          <Probe onValue={() => {}} />
        </ScreenVolumeProvider>
      );
      // 0.6 × 0.5 = 0.3
      expect(getEffectiveMaster()).toBeCloseTo(0.3, 5);
    });
  });
```

Then update the top-of-file import to also bring in `getEffectiveMaster`. Find:

```jsx
import {
  useScreenVolume,
  useEffectiveVolume,
  getMasterVolume,
  getMasterMuted,
  subscribeMaster,
  _resetForTests,
} from '../../lib/volume/ScreenVolumeContext.js';
```

Replace with:

```jsx
import {
  useScreenVolume,
  useEffectiveVolume,
  getMasterVolume,
  getMasterMuted,
  getEffectiveMaster,
  subscribeMaster,
  _resetForTests,
} from '../../lib/volume/ScreenVolumeContext.js';
```

- [ ] **Step 2: Run the test and verify it fails for the right reasons**

Run: `cd /opt/Code/DaylightStation && frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/providers/ScreenVolumeProvider.test.jsx`

Expected: The four new tests in the `outputCeiling` describe FAIL. The first three fail because `effectiveMaster` does not yet exist on the context value (will be `undefined`, and `toBeCloseTo(0.2)` on `undefined` errors). The fourth fails because `getEffectiveMaster` doesn't exist yet (the import itself errors out — that's also a valid fail signal).

If the import error short-circuits the whole file (preventing the pre-existing tests from running too), that's OK — Task 2 will fix it.

If the test passes unexpectedly, stop and report DONE_WITH_CONCERNS — that would mean the feature is already partially in place.

- [ ] **Step 3: Commit the failing test**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/screen-framework/providers/ScreenVolumeProvider.test.jsx && git commit -m "test(screen-framework): failing tests — ScreenVolumeProvider has no outputCeiling support"
```

Stage ONLY the test file.

---

## Task 2: Implement outputCeiling

**Files:**
- Modify: `frontend/src/lib/volume/ScreenVolumeContext.js`
- Modify: `frontend/src/screen-framework/providers/ScreenVolumeProvider.jsx`

- [ ] **Step 1: Add `effectiveMaster` to the context default and module state**

In `/opt/Code/DaylightStation/frontend/src/lib/volume/ScreenVolumeContext.js`:

Find the existing `DEFAULT_VALUE`:

```jsx
const DEFAULT_VALUE = Object.freeze({
  master: 1,
  muted: false,
  setMaster: noop,
  step: noop,
  toggleMute: noop,
});
```

Replace with:

```jsx
const DEFAULT_VALUE = Object.freeze({
  master: 1,
  effectiveMaster: 1,
  muted: false,
  setMaster: noop,
  step: noop,
  toggleMute: noop,
});
```

Find the existing module-state declaration:

```jsx
let _state = { master: 1, muted: false };
const _subscribers = new Set();
```

Replace with:

```jsx
let _state = { master: 1, effectiveMaster: 1, muted: false };
const _subscribers = new Set();
```

Find the existing `_publishMasterState`:

```jsx
export function _publishMasterState(master, muted) {
  _state = { master, muted };
  for (const fn of _subscribers) {
    try { fn(master, muted); } catch { /* ignore subscriber errors */ }
  }
}
```

Replace with:

```jsx
export function _publishMasterState(master, effectiveMaster, muted) {
  _state = { master, effectiveMaster, muted };
  for (const fn of _subscribers) {
    try { fn(master, muted); } catch { /* ignore subscriber errors */ }
  }
}
```

Add a new exported accessor immediately after `getMasterMuted`:

```jsx
export function getEffectiveMaster() {
  return _state.effectiveMaster;
}
```

Find `_resetForTests`:

```jsx
export function _resetForTests() {
  _state = { master: 1, muted: false };
  _subscribers.clear();
}
```

Replace with:

```jsx
export function _resetForTests() {
  _state = { master: 1, effectiveMaster: 1, muted: false };
  _subscribers.clear();
}
```

Find `useEffectiveVolume`:

```jsx
export function useEffectiveVolume(local = 1) {
  const { master } = useContext(ScreenVolumeContext);
  return master * local;
}
```

Replace with:

```jsx
export function useEffectiveVolume(local = 1) {
  const { effectiveMaster } = useContext(ScreenVolumeContext);
  return effectiveMaster * local;
}
```

- [ ] **Step 2: Add `outputCeiling` prop and compute `effectiveMaster` in the provider**

In `/opt/Code/DaylightStation/frontend/src/screen-framework/providers/ScreenVolumeProvider.jsx`:

Find the function signature:

```jsx
export function ScreenVolumeProvider({
  children,
  storageKey = 'screen-volume',
  defaultMaster = 0.5,
  stepSize = 0.1,
}) {
```

Replace with:

```jsx
export function ScreenVolumeProvider({
  children,
  storageKey = 'screen-volume',
  defaultMaster = 0.5,
  stepSize = 0.1,
  outputCeiling = 1,
}) {
```

Find the existing effect that mirrors state to module scope:

```jsx
  // Mirror state into module scope for non-React consumers (sound effects, etc).
  useEffect(() => {
    _publishMasterState(master, muted);
  }, [master, muted]);
```

Replace with:

```jsx
  // effectiveMaster is the output amplitude consumers should multiply by — it
  // applies the per-screen ceiling. master remains the user-facing [0,1] level
  // (drives the HUD, persistence, mute logic).
  const effectiveMaster = master * outputCeiling;

  // Mirror state into module scope for non-React consumers (sound effects, etc).
  useEffect(() => {
    _publishMasterState(master, effectiveMaster, muted);
  }, [master, effectiveMaster, muted]);
```

Find the `value` useMemo:

```jsx
  const value = useMemo(
    () => ({ master, muted, setMaster, step, toggleMute, stepSize }),
    [master, muted, setMaster, step, toggleMute, stepSize],
  );
```

Replace with:

```jsx
  const value = useMemo(
    () => ({ master, effectiveMaster, muted, setMaster, step, toggleMute, stepSize }),
    [master, effectiveMaster, muted, setMaster, step, toggleMute, stepSize],
  );
```

- [ ] **Step 3: Run the tests and verify all four `outputCeiling` tests pass**

Run: `cd /opt/Code/DaylightStation && frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/providers/ScreenVolumeProvider.test.jsx`

Expected: all tests pass (including the four new `outputCeiling` tests AND the pre-existing tests, which should be unchanged because `outputCeiling` defaults to 1).

If any pre-existing test fails, that's a regression — investigate before continuing.

- [ ] **Step 4: Run the wider volume + Player sweep to confirm no regressions**

Run: `cd /opt/Code/DaylightStation && frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework frontend/src/modules/Player frontend/src/lib/volume`

Expected: all tests pass. Pay attention to `MasterVolumeToast.test.jsx` and `ContentScroller.volume.test.jsx`.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/lib/volume/ScreenVolumeContext.js frontend/src/screen-framework/providers/ScreenVolumeProvider.jsx && git commit -m "feat(screen-framework): ScreenVolumeProvider exposes effectiveMaster with outputCeiling"
```

---

## Task 3: Failing test — curveExponent applies perceptual power curve

**Files:**
- Modify: `frontend/src/screen-framework/providers/ScreenVolumeProvider.test.jsx`

- [ ] **Step 1: Append the curveExponent test block**

In the same test file, immediately AFTER the `describe('outputCeiling', …)` block you added in Task 1, and BEFORE the closing `});` of the outer describe, insert:

```jsx
  describe('curveExponent', () => {
    it('exposes effectiveMaster = master ** curveExponent when ceiling = 1', () => {
      const onValue = vi.fn();
      render(
        <ScreenVolumeProvider defaultMaster={0.5} curveExponent={2}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      const last = onValue.mock.calls.at(-1)[0];
      // 0.5 ** 2 = 0.25
      expect(last.effectiveMaster).toBeCloseTo(0.25, 5);
    });

    it('combines curve and ceiling: (master ** curve) × ceiling', () => {
      const onValue = vi.fn();
      render(
        <ScreenVolumeProvider defaultMaster={0.5} curveExponent={2} outputCeiling={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      const last = onValue.mock.calls.at(-1)[0];
      // (0.5 ** 2) × 0.5 = 0.25 × 0.5 = 0.125
      expect(last.effectiveMaster).toBeCloseTo(0.125, 5);
    });

    it('defaults to linear (curveExponent = 1) so effectiveMaster = master × ceiling', () => {
      const onValue = vi.fn();
      render(
        <ScreenVolumeProvider defaultMaster={0.5} outputCeiling={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      const last = onValue.mock.calls.at(-1)[0];
      // 0.5 × 0.5 = 0.25, no curve
      expect(last.effectiveMaster).toBeCloseTo(0.25, 5);
    });

    it('preserves master = 0 → effectiveMaster = 0 (mute)', () => {
      let api;
      const onValue = vi.fn((v) => { api = v; });
      render(
        <ScreenVolumeProvider defaultMaster={0.5} curveExponent={3} outputCeiling={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      act(() => api.toggleMute());
      const last = onValue.mock.calls.at(-1)[0];
      expect(last.effectiveMaster).toBe(0);
    });
  });
```

- [ ] **Step 2: Run the test and verify all four curveExponent tests fail**

Run: `cd /opt/Code/DaylightStation && frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/providers/ScreenVolumeProvider.test.jsx`

Expected: The four new `curveExponent` tests fail. Specifically:
- Test 1 expects `0.25` but gets `0.5` (no curve applied yet).
- Test 2 expects `0.125` but gets `0.25` (`0.5 × 0.5` only — ceiling applies but not curve).
- Test 3 PASSES (linear default).
- Test 4 PASSES (mute still yields 0).

So expected: 2 fails + 2 passes within the new describe.

If different, stop and report.

- [ ] **Step 3: Commit the failing tests**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/screen-framework/providers/ScreenVolumeProvider.test.jsx && git commit -m "test(screen-framework): failing tests — ScreenVolumeProvider has no curveExponent support"
```

---

## Task 4: Implement curveExponent

**Files:**
- Modify: `frontend/src/screen-framework/providers/ScreenVolumeProvider.jsx`

- [ ] **Step 1: Accept the prop and apply the power curve**

In `frontend/src/screen-framework/providers/ScreenVolumeProvider.jsx`, find the function signature you edited in Task 2:

```jsx
export function ScreenVolumeProvider({
  children,
  storageKey = 'screen-volume',
  defaultMaster = 0.5,
  stepSize = 0.1,
  outputCeiling = 1,
}) {
```

Replace with:

```jsx
export function ScreenVolumeProvider({
  children,
  storageKey = 'screen-volume',
  defaultMaster = 0.5,
  stepSize = 0.1,
  outputCeiling = 1,
  curveExponent = 1,
}) {
```

Find the line you added in Task 2:

```jsx
  const effectiveMaster = master * outputCeiling;
```

Replace with:

```jsx
  // (master ** curveExponent) gives a perceptual curve — curveExponent=2 makes
  // the bottom half of the master range cover more of the audible amplitude
  // change humans perceive. curveExponent=1 is the pre-curve linear behavior.
  // Then × outputCeiling caps the maximum output amplitude.
  const effectiveMaster = Math.pow(master, curveExponent) * outputCeiling;
```

- [ ] **Step 2: Run the tests and verify all curveExponent tests now pass**

Run: `cd /opt/Code/DaylightStation && frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/providers/ScreenVolumeProvider.test.jsx`

Expected: All tests pass (including all four `curveExponent` tests AND all four `outputCeiling` tests AND all pre-existing tests).

- [ ] **Step 3: Run the wider sweep**

Run: `cd /opt/Code/DaylightStation && frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework frontend/src/modules/Player frontend/src/lib/volume`

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/screen-framework/providers/ScreenVolumeProvider.jsx && git commit -m "feat(screen-framework): ScreenVolumeProvider applies curveExponent perceptual curve"
```

---

## Task 5: Failing integration test — ContentScroller respects ceiling + curve end-to-end

**Files:**
- Modify: `frontend/src/modules/Player/renderers/ContentScroller.volume.test.jsx`

- [ ] **Step 1: Append the integration test**

In `/opt/Code/DaylightStation/frontend/src/modules/Player/renderers/ContentScroller.volume.test.jsx`, find the closing `});` of the existing outer describe block (`describe('ContentScroller — master volume integration', …)`). Immediately BEFORE that final `});`, insert:

```jsx
  it('applies outputCeiling and curveExponent to the audio element volume', () => {
    apiRef.current = null;
    const { container } = render(
      <ScreenVolumeProvider defaultMaster={0.5} outputCeiling={0.5} curveExponent={2}>
        <Probe />
        <ContentScroller
          type="readalong"
          title="Test"
          assetId="test-effective"
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

    // mainVolume × effectiveMaster = 0.8 × ((0.5 ** 2) × 0.5)
    //                              = 0.8 × (0.25 × 0.5)
    //                              = 0.8 × 0.125
    //                              = 0.1
    expect(mediaEl.volume).toBeCloseTo(0.1, 5);

    // Mid-playback master bump: 1.0 ** 2 × 0.5 = 0.5 → 0.8 × 0.5 = 0.4
    act(() => apiRef.current.setMaster(1.0));
    expect(mediaEl.volume).toBeCloseTo(0.4, 5);

    // Mute → effectiveMaster = 0 → el.volume = 0
    act(() => apiRef.current.toggleMute());
    expect(mediaEl.volume).toBeCloseTo(0, 5);
  });
```

- [ ] **Step 2: Run the test and verify it fails for the right reason**

Run: `cd /opt/Code/DaylightStation && frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Player/renderers/ContentScroller.volume.test.jsx`

Expected: The three existing tests PASS. The new test FAILS at the first assertion. With ceiling=0.5, curve=2.0, master=0.5, mainVolume=0.8, the current code computes `mainVolume × master = 0.8 × 0.5 = 0.4` (because consumers still multiply by `master`, not `effectiveMaster`). The expected value is `0.1`. The assertion `toBeCloseTo(0.1, 5)` will fail with "expected 0.4 to be close to 0.1".

This failure is the WHOLE POINT of Task 5 — it documents that consumers don't yet use `effectiveMaster`. Task 6 fixes them.

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/Player/renderers/ContentScroller.volume.test.jsx && git commit -m "test(player): failing test — consumers still use master instead of effectiveMaster"
```

---

## Task 6: Switch consumers from master to effectiveMaster

**Files (modify all):**
- `frontend/src/modules/Player/components/AudioLayer.jsx`
- `frontend/src/modules/Player/components/AmbientLayer.jsx`
- `frontend/src/modules/Player/renderers/ContentScroller.jsx`
- `frontend/src/modules/Player/hooks/useCommonMediaController.js`
- `frontend/src/modules/Input/hooks/useNativeAudioBridge.js`
- `frontend/src/modules/Piano/PianoSpaceInvaders/useSpaceInvadersGame.js`

The pattern is identical across all six files: where the current code reads `master` (or `masterVolume`) and multiplies into a media element volume / gain / sound-effect volume, replace it with `effectiveMaster`. The HUD (`MasterVolumeToast.jsx`) is NOT touched — it deliberately keeps showing the user-facing master percent.

- [ ] **Step 1: Update `AudioLayer.jsx`**

In `/opt/Code/DaylightStation/frontend/src/modules/Player/components/AudioLayer.jsx`, find:

```jsx
  const { master: masterVolume } = useScreenVolume();
```

Replace with:

```jsx
  const { effectiveMaster: masterVolume } = useScreenVolume();
```

We rename via destructure alias so the rest of the file (which reads `masterVolume`) needs no further changes.

- [ ] **Step 2: Update `AmbientLayer.jsx`**

In `/opt/Code/DaylightStation/frontend/src/modules/Player/components/AmbientLayer.jsx`, find (around line 29):

```jsx
  const { master: masterVolume } = useScreenVolume();
```

Replace with:

```jsx
  const { effectiveMaster: masterVolume } = useScreenVolume();
```

- [ ] **Step 3: Update `ContentScroller.jsx`**

In `/opt/Code/DaylightStation/frontend/src/modules/Player/renderers/ContentScroller.jsx`, find:

```jsx
    // Screen-framework software master volume. Outside a ScreenVolumeProvider
    // (e.g. Fitness host) the context default is master=1, so this is a no-op.
    const { master: masterVolume } = useScreenVolume();
```

Replace with:

```jsx
    // Screen-framework effective master (master after per-screen output ceiling
    // and perceptual curve). Outside a ScreenVolumeProvider (e.g. Fitness host)
    // the context default is effectiveMaster=1, so this is a no-op.
    const { effectiveMaster: masterVolume } = useScreenVolume();
```

- [ ] **Step 4: Update `useCommonMediaController.js`**

In `/opt/Code/DaylightStation/frontend/src/modules/Player/hooks/useCommonMediaController.js`, find:

```jsx
  // Screen-framework software master volume. When this hook is rendered outside
  // a ScreenVolumeProvider (e.g., Fitness, Feed, or any other host), master = 1
  // and behavior is unchanged. effective volume = adjustedVolume × master.
  const { master: masterVolume } = useScreenVolume();
```

Replace with:

```jsx
  // Screen-framework effective master (post-ceiling, post-curve). When this hook
  // is rendered outside a ScreenVolumeProvider (e.g., Fitness, Feed, or any
  // other host), effectiveMaster = 1 and behavior is unchanged.
  const { effectiveMaster: masterVolume } = useScreenVolume();
```

- [ ] **Step 5: Update `useNativeAudioBridge.js`**

In `/opt/Code/DaylightStation/frontend/src/modules/Input/hooks/useNativeAudioBridge.js`, find (around line 42):

```jsx
  const { master: masterVolume } = useScreenVolume();
```

Replace with:

```jsx
  const { effectiveMaster: masterVolume } = useScreenVolume();
```

- [ ] **Step 6: Update `useSpaceInvadersGame.js` (module-state consumer)**

In `/opt/Code/DaylightStation/frontend/src/modules/Piano/PianoSpaceInvaders/useSpaceInvadersGame.js`, find the import line:

```jsx
import { getMasterVolume } from '../../../lib/volume/ScreenVolumeContext.js';
```

Replace with:

```jsx
import { getEffectiveMaster } from '../../../lib/volume/ScreenVolumeContext.js';
```

Then find (around line 225):

```jsx
          errorAudioRef.current.volume = 0.4 * getMasterVolume();
```

Replace with:

```jsx
          errorAudioRef.current.volume = 0.4 * getEffectiveMaster();
```

- [ ] **Step 7: Run the integration test and verify all 4 ContentScroller tests pass**

Run: `cd /opt/Code/DaylightStation && frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Player/renderers/ContentScroller.volume.test.jsx`

Expected: all 4 tests pass.

- [ ] **Step 8: Run the wider regression sweep**

Run: `cd /opt/Code/DaylightStation && frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework frontend/src/modules/Player frontend/src/modules/Input frontend/src/modules/Piano frontend/src/lib/volume`

Expected: all tests pass. If any test fails, investigate — most likely a consumer wasn't updated correctly or a test was previously asserting on `master` semantics that no longer match.

- [ ] **Step 9: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/Player/components/AudioLayer.jsx frontend/src/modules/Player/components/AmbientLayer.jsx frontend/src/modules/Player/renderers/ContentScroller.jsx frontend/src/modules/Player/hooks/useCommonMediaController.js frontend/src/modules/Input/hooks/useNativeAudioBridge.js frontend/src/modules/Piano/PianoSpaceInvaders/useSpaceInvadersGame.js && git commit -m "fix(player+input+piano): consumers multiply by effectiveMaster instead of raw master"
```

---

## Task 7: Wire ScreenRenderer to forward per-screen volume config

**Files:**
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx`

- [ ] **Step 1: Pass volume props from screen config to the provider**

In `/opt/Code/DaylightStation/frontend/src/screen-framework/ScreenRenderer.jsx`, find (around line 354):

```jsx
          <ScreenVolumeProvider storageKey={`screen-volume-${screenId}`}>
```

Replace with:

```jsx
          <ScreenVolumeProvider
            storageKey={`screen-volume-${screenId}`}
            outputCeiling={config.volume?.outputCeiling}
            curveExponent={config.volume?.curveExponent}
            stepSize={config.volume?.stepSize}
            defaultMaster={config.volume?.defaultMaster}
          >
```

When a screen YAML has no `volume:` block, all four props are `undefined`. The provider's default values kick in (`outputCeiling=1`, `curveExponent=1`, `stepSize=0.1`, `defaultMaster=0.5`) — full backwards-compat.

- [ ] **Step 2: Run the screen-framework tests and confirm no regression**

Run: `cd /opt/Code/DaylightStation && frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework`

Expected: all tests pass. No tests directly assert on ScreenRenderer wiring of the provider, so this should be a no-op for the test suite. The change is verified end-to-end in Task 9 (smoke).

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/screen-framework/ScreenRenderer.jsx && git commit -m "feat(screen-framework): ScreenRenderer forwards per-screen volume config to provider"
```

---

## Task 8: Add `volume:` block to screen YAML files

**Files (modify via `sudo docker exec`):**
- `data/household/screens/living-room.yml` (inside the daylight-station container's data volume — note the hyphen in the filename)
- `data/household/screens/office.yml` (same)

The `claude` user cannot read the data volume directly — all reads/writes go through `sudo docker exec daylight-station sh -c '…'`. We APPEND a new top-level `volume:` block to the END of each file via heredoc. Append-at-top-level is safe regardless of preceding content because YAML mapping keys are unordered — a new key at column 0 always opens a fresh top-level entry. This preserves all existing comments and indentation. Do NOT use `sed -i` (it mangles multi-line YAML).

- [ ] **Step 1: Confirm the files exist and have no pre-existing `volume:` block**

```bash
sudo docker exec daylight-station sh -c 'ls data/household/screens/'
sudo docker exec daylight-station sh -c 'grep -n "^volume:" data/household/screens/living-room.yml data/household/screens/office.yml'
```

Expected: `ls` lists at least `living-room.yml` and `office.yml`. The `grep` should print NOTHING (exit 1 is fine — that means no `volume:` key exists yet).

If `grep` DOES find a `volume:` line, stop and report — the file already has a block. The implementer (or the user) should review whether to edit values or skip; do not blindly append a duplicate top-level key.

- [ ] **Step 2: Append `volume:` block to living-room.yml**

The living room is the loudest hardware — set a tight ceiling.

```bash
sudo docker exec daylight-station sh -c "cat >> data/household/screens/living-room.yml << 'YAML_EOF'

# Per-screen volume tuning — added 2026-05-19
# outputCeiling caps el.volume to this fraction of full amplitude (1.0 = no cap)
# curveExponent applies (master ** N) for perceptual response (1.0 = linear)
volume:
  outputCeiling: 0.25
  curveExponent: 2.0
  stepSize: 0.1
  defaultMaster: 0.5
YAML_EOF"
```

The blank line immediately after `<< 'YAML_EOF'` provides separation from any existing content (in case the file did not end with a trailing newline). The leading-space-free `volume:` line guarantees it lands as a top-level key.

Verify it parses correctly:

```bash
sudo docker exec daylight-station sh -c "cd /usr/src/app && node -e \"const y=require('js-yaml'),fs=require('fs');const d=y.load(fs.readFileSync('data/household/screens/living-room.yml','utf8'));console.log(JSON.stringify(d.volume));\""
```

Expected: `{"outputCeiling":0.25,"curveExponent":2,"stepSize":0.1,"defaultMaster":0.5}`.

If the output is `undefined` or the command errors with a YAML parse failure, the file is malformed. Re-read it (`cat`) and fix.

- [ ] **Step 3: Append `volume:` block to office.yml**

The office display speaker is much quieter — use a higher ceiling.

```bash
sudo docker exec daylight-station sh -c "cat >> data/household/screens/office.yml << 'YAML_EOF'

# Per-screen volume tuning — added 2026-05-19
volume:
  outputCeiling: 0.6
  curveExponent: 2.0
  stepSize: 0.1
  defaultMaster: 0.5
YAML_EOF"
```

Verify:

```bash
sudo docker exec daylight-station sh -c "cd /usr/src/app && node -e \"const y=require('js-yaml'),fs=require('fs');const d=y.load(fs.readFileSync('data/household/screens/office.yml','utf8'));console.log(JSON.stringify(d.volume));\""
```

Expected: `{"outputCeiling":0.6,"curveExponent":2,"stepSize":0.1,"defaultMaster":0.5}`.

- [ ] **Step 4: No commit**

These files live in the bind-mounted data volume, not the git repo. Nothing to commit. The new values take effect on the next screen-config fetch (next page reload).

- [ ] **Step 5: Live verification of the API response**

Confirm the new `volume:` block round-trips through the backend (the running container will already serve the updated YAML — no rebuild needed for data-volume changes):

```bash
curl -s http://localhost:3111/api/v1/screens/living-room | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('volume'), indent=2))"
curl -s http://localhost:3111/api/v1/screens/office | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('volume'), indent=2))"
```

Expected for living-room: `{"outputCeiling": 0.25, "curveExponent": 2.0, "stepSize": 0.1, "defaultMaster": 0.5}`. For office: ceiling `0.6`. If either is `null`, the YAML didn't parse — fix and retry.

---

## Task 9: Build, deploy, smoke verification

**Files:** none (build + deploy + verification only).

This host (`kckern-server`) IS prod. Per `CLAUDE.local.md`, deploying autonomously after landing commits is allowed.

- [ ] **Step 1: Build new Docker image with the latest commit**

```bash
cd /opt/Code/DaylightStation && sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
```

Allow up to 10 minutes (the vite build is the slow part). The build prints `DONE` on success and writes `/build.txt` inside the image with the commit hash.

- [ ] **Step 2: Replace the running container**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

Wait ~10 seconds, then verify:

```bash
sleep 8 && curl -s -o /dev/null -w "root=%{http_code}\n" http://localhost:3111/ && sudo docker exec daylight-station cat /build.txt
```

Expected: `root=200`, and `/build.txt` shows the new commit hash.

- [ ] **Step 3: Manual smoke on the kiosks**

Manual checks (require human ears):

1. **Living-room TV (`livingroom`)** — load a readalong scripture or talk. Press vol-up on the numpad. Confirm:
   - The HUD toast still shows `0`–`100` as 10 notches (user-facing percent unchanged).
   - At master = `100`, the actual audio is at the comfortable upper bound (not blown out).
   - At master = `50`, the audio is perceptually about half as loud as at `100` (curve effect — used to be ~85% loudness, now ~50%).
   - At master = `10`, you can still hear it clearly but it's quiet.
   - Mute (`0`) is silent.
2. **Office screen (`office`)** — same test with the office ceiling. Confirm the absolute loudness ceiling is higher than living room (because the office speaker is quieter hardware).
3. **Hymn / primary song (`SingalongScroller`)** — confirm vol-up/down/mute behave the same way (uses the same `ContentScroller` path).
4. **Standard Plex video** — confirm vol-up/down/mute behave the same way (uses `useCommonMediaController` path).
5. **Piano space invaders** (if accessible) — trigger an error sound; confirm it scales with master too.

- [ ] **Step 4: Report status**

If every check behaves as expected: announce smoke passed and the deploy is complete.

If any check misbehaves, do NOT roll back without first capturing the symptom. Note the master setting, the actual loudness, and which screen. Stop and report so the user can decide whether to tune the YAML (cheap) or revert the deploy (expensive).

---

## Done When

- ScreenVolumeProvider accepts `outputCeiling` and `curveExponent` props (and `stepSize`, `defaultMaster` were already there).
- All audio-output consumers (AudioLayer, AmbientLayer, ContentScroller, useCommonMediaController, useNativeAudioBridge, useSpaceInvadersGame) multiply by `effectiveMaster` instead of raw `master`.
- ScreenRenderer forwards the per-screen `volume:` block to the provider.
- `livingroom.yml` and `office.yml` have appropriate `volume:` blocks live in the data volume.
- Tests: all in `frontend/src/screen-framework`, `frontend/src/modules/Player`, `frontend/src/modules/Input`, `frontend/src/modules/Piano`, `frontend/src/lib/volume` pass.
- New build deployed to the daylight-station container.
- Manual smoke on at least two screens (living room + office) confirms the audio actually responds gracefully across the master range.

## Out of Scope (deferred)

- Adjusting other screens' YAML beyond `livingroom` and `office` (do them as needed when the user uses those kiosks).
- A dedicated `docs/reference/screen-framework/volume.md` reference doc — the YAML examples and `ScreenVolumeProvider` prop signatures are self-describing.
- A reactive "decibel" HUD readout (showing `effectiveMaster` alongside `master`) — YAGNI; the user's mental model is "10 of 10 notches" and that stays.
