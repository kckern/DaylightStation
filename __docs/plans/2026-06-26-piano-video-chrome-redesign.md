# Piano Video Chrome Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the piano video player's bottom control bar from a two-row sprawl into a single fixed-width row with a mix flyout, a restart button, and cleaner grouping of A/B loop controls.

**Architecture:** All changes are confined to `PianoVideoChrome.jsx` (presentational), `PianoVideoPlayer.jsx` (wires new `onRestart` prop), and `PianoApp.scss` (styles). `MixControls.jsx` is unchanged — it moves from inline to a flyout, keeping the same props contract. No new context providers, no new hooks.

**Tech Stack:** React 18, Vitest + @testing-library/react, SCSS (BEM with existing `piano-video-chrome__` namespace)

---

## Reference: What the bottom chrome looks like today

```
PianoVideoChrome renders one flex row (but flex-wrap: wrap causes it to overflow into two):

Row 1: [time]  [◀30] [◀15] [▶▶] [▶15] [▶30]  [1×] [A] [B] [↻] [✕]  [mix controls inline]  [⌨]
Row 2: (MixControls overflow): [🎹 vol- 100 vol+]  [♪ vol- 100 vol+]
```

**What we're building:**

```
Single row, no wrap:

[|◀]  [◀15]  [▶▶]  [▶15]   [1×]  [ A  B  ↻  ✕ ]  [🎚]  [⌨]
                                    ─────────────
                                    loop group
```

MixControls only appear when the 🎚 button is tapped — as a flyout panel above the row.

---

## Task 1: Find and remove the "1.00" ghost

The screenshot shows `1.00` floating in the top-left corner of the video area with no label. Two likely sources: `AmbientLayer.jsx` renders something with `upscaleRatio`, or a Player internal overlay leaks text. Investigate and remove.

**Files:**
- Investigate: `frontend/src/modules/Player/components/AmbientLayer.jsx`
- Investigate: `frontend/src/modules/Player/hooks/useUpscaleEffects.js`
- Investigate: `frontend/src/modules/Player/Player.jsx` (search for what is rendered at the very top of the Player tree before the main content)

**Step 1: Search for what renders a numeric value at position top-left**

```bash
grep -rn "position.*absolute\|top.*0\|left.*0" \
  frontend/src/modules/Player/components/AmbientLayer.jsx \
  frontend/src/modules/Player/components/PlayerOverlayLoading.jsx \
  2>/dev/null | head -30
```

Also grep for the exact string `1.00` or any `toFixed(2)` whose result could be `1.00`:
```bash
grep -rn "toFixed\|upscaleRatio\|volume\|\.00" \
  frontend/src/modules/Player/ \
  --include="*.jsx" --include="*.js" \
  | grep -v test | grep -v README \
  | head -40
```

**Step 2: Once the source is identified, remove or gate the render**

If it's a debug/diagnostic value: remove the render or wrap in `{process.env.NODE_ENV === 'development' && ...}`.  
If it's a legitimate value that needs to exist but not be visible: give it `display: none` or move it off-screen.

**Step 3: Verify visually**

Run `npm run dev`, open the piano video player, confirm no floating number in the corner.

**Step 4: Commit**

```bash
git add <changed files>
git commit -m "fix(piano-player): remove floating debug value from video area"
```

---

## Task 2: Wire `onRestart` through the component tree

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx` (around line 136–200)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx` (line 18)

**Step 1: Write the failing test for the restart button**

In `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx`, add to the existing `describe('PianoVideoChrome')` block:

```jsx
it('calls onRestart when the restart button is clicked', () => {
  const onRestart = vi.fn();
  render(<PianoVideoChrome {...baseProps} onRestart={onRestart} />);
  fireEvent.click(screen.getByLabelText('Restart from beginning'));
  expect(onRestart).toHaveBeenCalledTimes(1);
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx
```

Expected: FAIL — "Unable to find an element with the label text: Restart from beginning"

**Step 3: Add `onRestart` handler in PianoVideoPlayer.jsx**

After `handleSkip` (around line 136), add:

```jsx
const handleRestart = useCallback(() => {
  ctrl.seek(0);
  getLogger().child({ component: 'piano-video-player' }).info('piano.video.restart');
}, [ctrl]);
```

Then add `onRestart={handleRestart}` to the `<PianoVideoChrome ... />` call (around line 184):

```jsx
<PianoVideoChrome
  ...
  onRestart={handleRestart}
  ...
/>
```

**Step 4: Add the restart button to PianoVideoChrome.jsx**

Add `onRestart` to the destructured props (line 18):

```jsx
export default function PianoVideoChrome({
  isPlaying, currentTime, duration, rate, loop, playAlong,
  onToggle, onSkip, onRestart, onCycleRate, onMarkA, onMarkB, onToggleLoop, onClearLoop, onSeek, onTogglePlayAlong,
}) {
```

Add the restart button as the **first** button in `__row`, before the skip buttons:

```jsx
<button
  type="button"
  className="piano-video-chrome__btn piano-video-chrome__btn--restart"
  onClick={onRestart}
  aria-label="Restart from beginning"
>
  <Icon name="skip-to-start" />
</button>
```

**Step 5: Add the icon** (check what icon names exist first)

```bash
grep -rn "skip-to-start\|restart\|rewind\|back-to\|go-to-start" \
  frontend/src/modules/Piano/PianoKiosk/icons/ 2>/dev/null | head -10
```

If `skip-to-start` doesn't exist, use the closest available icon name or inline an SVG. The `Icon` component lives at `frontend/src/modules/Piano/PianoKiosk/icons/Icon.jsx` — read it to find available names.

**Step 6: Run tests to verify they pass**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx
```

Expected: All tests PASS.

**Step 7: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx \
        frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx \
        frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx
git commit -m "feat(piano-video): add restart-from-beginning button"
```

---

## Task 3: Drop ±30s skip buttons, keep only ±15s

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx`

**Step 1: Update the test — remove the ±30s assertions, keep ±15s**

The existing test at line 32–39:

```jsx
it('skips by the labeled amounts', () => {
  const onSkip = vi.fn();
  render(<PianoVideoChrome {...baseProps} onSkip={onSkip} />);
  fireEvent.click(screen.getByLabelText('Back 15 seconds'));
  fireEvent.click(screen.getByLabelText('Forward 15 seconds'));
  expect(onSkip).toHaveBeenCalledWith(-15);
  expect(onSkip).toHaveBeenCalledWith(15);
});
```

Also add a test that confirms the ±30s buttons do NOT exist:

```jsx
it('does not render skip-30 buttons', () => {
  render(<PianoVideoChrome {...baseProps} onSkip={vi.fn()} />);
  expect(screen.queryByLabelText('Back 30 seconds')).toBeNull();
  expect(screen.queryByLabelText('Forward 30 seconds')).toBeNull();
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx
```

Expected: the "does not render skip-30 buttons" test FAILS.

**Step 3: Remove the ±30s buttons from PianoVideoChrome.jsx**

Delete these two lines (currently lines 47 and 51):

```jsx
<button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(-30)} aria-label="Back 30 seconds"><Icon name="skip-back-30" /> 30</button>
```

```jsx
<button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(30)} aria-label="Forward 30 seconds"><Icon name="skip-forward-30" /> 30</button>
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx
```

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx \
        frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx
git commit -m "fix(piano-video): remove redundant ±30s skip buttons, keep ±15s only"
```

---

## Task 4: Fix speed button to fixed width

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss`

**Step 1: Add `__btn--rate` class to the speed button in PianoVideoChrome.jsx**

Change:

```jsx
<button type="button" className="piano-video-chrome__btn" onClick={onCycleRate} aria-label="Playback speed">{rate}×</button>
```

To:

```jsx
<button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--rate" onClick={onCycleRate} aria-label="Playback speed">{rate}×</button>
```

**Step 2: Add the fixed-width modifier in PianoApp.scss**

Inside `.piano-video-chrome { ... }`, after the `&__btn--play` rule (around line 1106), add:

```scss
&__btn--rate { width: 4rem; flex-shrink: 0; }
```

`width` (not just `min-width`) locks it so "0.5×", "0.75×", "1.25×", "1.5×" all occupy the same horizontal space.

**Step 3: Verify visually**

Run `npm run dev`, open the video player, cycle through playback rates. Confirm the button does not change width and adjacent buttons don't shift.

**Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx \
        frontend/src/Apps/PianoApp.scss
git commit -m "fix(piano-video): lock speed button to fixed width so layout doesn't shift on rate change"
```

---

## Task 5: Visually group A/B loop controls into a cluster

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss`

**Step 1: Wrap A/B buttons in a group div in PianoVideoChrome.jsx**

Replace the four standalone A/B buttons:

```jsx
<button type="button" className={`piano-video-chrome__btn${loop?.a != null && loop?.b == null ? ' is-arming' : ''}`} onClick={onMarkA} aria-label="Mark loop start">A</button>
<button type="button" className="piano-video-chrome__btn" onClick={onMarkB} aria-label="Mark loop end">B</button>
<button type="button" className={`piano-video-chrome__btn${loopActive ? ' is-on' : ''}`} onClick={onToggleLoop} disabled={!bothMarks} aria-label="Toggle A-B loop"><Icon name="repeat" /></button>
<button type="button" className="piano-video-chrome__btn" onClick={onClearLoop} disabled={!hasLoop} aria-label="Clear loop"><Icon name="clear-loop" /></button>
```

With a grouped wrapper:

```jsx
<div className={`piano-video-chrome__loop-group${hasLoop ? ' has-marks' : ''}`}>
  <button type="button" className={`piano-video-chrome__btn${loop?.a != null && loop?.b == null ? ' is-arming' : ''}`} onClick={onMarkA} aria-label="Mark loop start">A</button>
  <button type="button" className="piano-video-chrome__btn" onClick={onMarkB} aria-label="Mark loop end">B</button>
  <button type="button" className={`piano-video-chrome__btn${loopActive ? ' is-on' : ''}`} onClick={onToggleLoop} disabled={!bothMarks} aria-label="Toggle A-B loop"><Icon name="repeat" /></button>
  <button type="button" className="piano-video-chrome__btn" onClick={onClearLoop} disabled={!hasLoop} aria-label="Clear loop"><Icon name="clear-loop" /></button>
</div>
```

**Step 2: Style the loop group in PianoApp.scss**

Inside `.piano-video-chrome { ... }`, add after `&__btn--rate`:

```scss
&__loop-group {
  display: flex; align-items: center; gap: 0;
  border: 1px solid var(--piano-border);
  border-radius: var(--r-md);
  overflow: hidden;

  // When marks are set, the group border gets an amber tint
  &.has-marks { border-color: var(--piano-warn); }

  // Remove individual borders between buttons in the group; outer border provides the chrome
  .piano-video-chrome__btn {
    border: none;
    border-radius: 0;
    border-right: 1px solid var(--piano-border);
    &:last-child { border-right: none; }
  }
}
```

**Step 3: Verify the existing loop tests still pass**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx
```

Expected: All tests PASS (the aria-labels are unchanged, so the button queries still work).

**Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx \
        frontend/src/Apps/PianoApp.scss
git commit -m "fix(piano-video): group A/B loop controls into a visual cluster"
```

---

## Task 6: Move MixControls to a flyout panel

This is the core declutter change: remove MixControls from the inline transport row and put it behind a toggle icon that shows a small panel above the button.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx`

**Step 1: Write the failing tests for the flyout**

Add to `PianoVideoChrome.test.jsx`:

```jsx
describe('PianoVideoChrome — mix flyout', () => {
  it('does not show mix controls until the mix button is tapped', () => {
    render(<PianoVideoChrome {...baseProps} />);
    // Mix controls exist in the DOM only when flyout is open
    expect(screen.queryByLabelText('Piano volume down')).toBeNull();
  });

  it('shows mix controls after tapping the mix toggle button', () => {
    render(<PianoVideoChrome {...baseProps} />);
    fireEvent.click(screen.getByLabelText('Toggle mix controls'));
    expect(screen.getByLabelText('Piano volume down')).toBeInTheDocument();
  });

  it('hides mix controls after tapping the mix toggle button twice', () => {
    render(<PianoVideoChrome {...baseProps} />);
    fireEvent.click(screen.getByLabelText('Toggle mix controls'));
    fireEvent.click(screen.getByLabelText('Toggle mix controls'));
    expect(screen.queryByLabelText('Piano volume down')).toBeNull();
  });
});
```

**Step 2: Update the existing mix tests** (they currently assume controls are always visible):

The existing `describe('PianoVideoChrome — mix balance')` tests click "Piano volume down" etc. They need to open the flyout first:

```jsx
describe('PianoVideoChrome — mix balance', () => {
  const openMix = (renderResult) => {
    fireEvent.click(renderResult.getByLabelText('Toggle mix controls'));
  };

  it('drives the piano level down/up from the mix context', () => {
    mix.setPianoLevel.mockReset();
    const result = render(<PianoVideoChrome {...baseProps} />);
    openMix(result);
    fireEvent.click(screen.getByLabelText('Piano volume down'));
    fireEvent.click(screen.getByLabelText('Piano volume up'));
    expect(mix.setPianoLevel).toHaveBeenCalledTimes(2);
  });

  it('drives the media level down/up from the mix context', () => {
    mix.setMediaLevel.mockReset();
    const result = render(<PianoVideoChrome {...baseProps} />);
    openMix(result);
    fireEvent.click(screen.getByLabelText('Media volume down'));
    fireEvent.click(screen.getByLabelText('Media volume up'));
    expect(mix.setMediaLevel).toHaveBeenCalledTimes(2);
  });
});
```

**Step 3: Run tests to verify they fail as expected**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx
```

Expected: The new flyout tests FAIL; existing mix tests FAIL ("Piano volume down" found when it shouldn't be visible).

**Step 4: Add `mixOpen` state and the flyout to PianoVideoChrome.jsx**

Add `useState` to the import (it's already imported in the Player, but Chrome currently only imports `useRef`):

```jsx
import { useRef, useState } from 'react';
```

Add `mixOpen` state at the top of the component:

```jsx
const [mixOpen, setMixOpen] = useState(false);
```

Replace the inline `<MixControls ... />` with a flyout structure. Remove the MixControls from `__row`. In its place, put a toggle button + conditional panel:

```jsx
<div className="piano-video-chrome__mix-wrap">
  <button
    type="button"
    className={`piano-video-chrome__btn${mixOpen ? ' is-on' : ''}`}
    onClick={() => setMixOpen((v) => !v)}
    aria-label="Toggle mix controls"
  >
    <Icon name="volume" />
  </button>
  {mixOpen && (
    <div className="piano-video-chrome__mix-flyout">
      <MixControls
        pianoLevel={pianoLevel}
        mediaLevel={mediaLevel}
        onPiano={(d) => setPianoLevel(pianoLevel + d)}
        onMedia={(d) => setMediaLevel(mediaLevel + d)}
        btnClass="piano-video-chrome__btn"
      />
    </div>
  )}
</div>
```

Also check what icon name to use: `volume`, `sliders`, `equalizer`, or `mix` — grep `Icon.jsx` first:
```bash
grep -n "volume\|sliders\|equalizer\|mix" \
  frontend/src/modules/Piano/PianoKiosk/icons/Icon.jsx | head -10
```

**Step 5: Style the mix flyout in PianoApp.scss**

Inside `.piano-video-chrome { ... }`:

```scss
&__mix-wrap {
  position: relative;
}

&__mix-flyout {
  position: absolute;
  bottom: calc(100% + 0.5rem);
  right: 0;
  background: var(--piano-surface-2);
  border: 1px solid var(--piano-border);
  border-radius: var(--r-md);
  padding: 0.75rem 1rem;
  z-index: 20;
  white-space: nowrap;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
```

**Step 6: Run tests to verify they pass**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx
```

Expected: All tests PASS.

**Step 7: Verify visually**

Run `npm run dev`. Open the video player. Confirm:
- The bottom row is now single-line (no overflow row)
- A volume/mix icon button is present
- Tapping it reveals the mix controls in a panel above
- Tapping again closes it

**Step 8: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx \
        frontend/src/Apps/PianoApp.scss \
        frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx
git commit -m "feat(piano-video): move mix controls out of transport row into a toggle flyout"
```

---

## Task 7: Lock the chrome row to single-line

With MixControls gone from the row, this is now straightforward.

**Files:**
- Modify: `frontend/src/Apps/PianoApp.scss`

**Step 1: Remove `flex-wrap: wrap` from `__row`**

Find (around line 1093):

```scss
&__row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; row-gap: 0.4rem; }
```

Replace with:

```scss
&__row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: nowrap; overflow: hidden; }
```

`overflow: hidden` prevents any button from spilling visually if the window is unusually narrow; `flex-wrap: nowrap` enforces the single-row contract.

**Step 2: Run tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx
```

Expected: All tests PASS (SCSS changes don't affect unit tests).

**Step 3: Verify visually**

Open the video player in the browser. Confirm:
- The chrome is a single row
- No buttons disappear or collapse
- On narrower containers, buttons are still accessible

**Step 4: Commit**

```bash
git add frontend/src/Apps/PianoApp.scss
git commit -m "fix(piano-video): enforce single-row chrome layout, no flex-wrap"
```

---

## Task 8: Final layout review and button height unification

The play button is currently `height: 3.5rem` while all others are `height: 3rem`. This is a deliberate hierarchy but also adds 0.5rem of passive bulk. Decision: unify to `3rem` (all buttons same height, play button stays visually prominent via its accent color and wider `min-width`).

**Files:**
- Modify: `frontend/src/Apps/PianoApp.scss`

**Step 1: Update `__btn--play` height**

Find:

```scss
&__btn--play { min-width: 4.5rem; height: 3.5rem; font-size: 1.3rem; background: var(--piano-accent); color: var(--piano-accent-ink); border-color: var(--piano-accent); }
```

Change `height: 3.5rem` to `height: 3rem`:

```scss
&__btn--play { min-width: 4.5rem; height: 3rem; font-size: 1.2rem; background: var(--piano-accent); color: var(--piano-accent-ink); border-color: var(--piano-accent); }
```

**Step 2: Verify visually**

Open the video player. Confirm the row height is consistent and the play button still has clear visual dominance from its accent color.

**Step 3: Commit**

```bash
git add frontend/src/Apps/PianoApp.scss
git commit -m "fix(piano-video): unify button heights to 3rem for consistent chrome row height"
```

---

## Completion Checklist

- [ ] `1.00` ghost removed from video area
- [ ] Restart (|◀) button present and wired, on far left
- [ ] Only two skip buttons (◀15, ▶15) — ±30s gone
- [ ] Speed button fixed width (doesn't shift on rate change)
- [ ] A/B loop controls in a visually bordered group
- [ ] MixControls live in a flyout — not visible by default
- [ ] Chrome is one row, no wrapping
- [ ] All button heights unified
- [ ] All existing tests pass
- [ ] New tests pass: restart button, mix flyout open/close

## Icon Name Sanity Check

Before starting, run this to know what icon names are available:

```bash
grep -n "case \|name ==\|'[a-z]" \
  frontend/src/modules/Piano/PianoKiosk/icons/Icon.jsx | head -40
```

Use these for: restart button, mix/volume toggle. If the right icon doesn't exist, use an inline SVG or a Unicode glyph (`⏮`, `🎚`, etc.) as a temporary stand-in inside the button's children.
