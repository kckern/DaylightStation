# Fitness Overlay Audio Mute During Voice Memo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Silence the governance lock/init background music (`GovernanceAudioPlayer`) while a voice-memo overlay is open, and resume it when the memo closes — so a memo recorded over a screen lock isn't recorded against music.

**Architecture:** `GovernanceAudioPlayer` is a self-contained `<audio>` element with no external pause control. Add a `paused` prop that pauses/resumes the element without resetting playback position. `GovernanceStateOverlay` (which renders all `GovernanceAudioPlayer` instances) gets a `voiceMemoOpen` prop and forwards it as `paused`. `FitnessPlayerOverlay` (the parent) already knows `voiceMemoOverlayOpen` and passes it down. No new context wiring.

**Tech Stack:** React, Vitest + @testing-library/react (jsdom). Note: jsdom does not implement `HTMLMediaElement.play/pause`, so the unit test mocks them via `vi.spyOn(window.HTMLMediaElement.prototype, …)`.

**Source audit:** `docs/_wip/audits/2026-05-28-fitness-session-multi-issue-postmortem-audit.md` (Issue 1).

**Run a single Vitest spec (repo root):** `frontend/node_modules/.bin/vitest run --config vitest.config.mjs <path-to-spec>`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `frontend/src/modules/Fitness/player/overlays/GovernanceAudioPlayer.jsx` | The `<audio>` element for governance sounds | Add `paused` prop (pause/resume without reset); include `paused` in the `React.memo` comparator |
| `frontend/src/modules/Fitness/player/overlays/GovernanceAudioPlayer.test.jsx` | Unit test | Create |
| `frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.jsx` | Renders the audio players | Accept `voiceMemoOpen`; forward `paused={voiceMemoOpen}` to every `<GovernanceAudioPlayer>` |
| `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx` | Parent overlay | Pass `voiceMemoOpen={voiceMemoOverlayOpen}` to `<GovernanceStateOverlay>` |

---

## Task 1: Add a `paused` prop to GovernanceAudioPlayer

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/GovernanceAudioPlayer.jsx`
- Test: `frontend/src/modules/Fitness/player/overlays/GovernanceAudioPlayer.test.jsx` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/player/overlays/GovernanceAudioPlayer.test.jsx`:

```jsx
import React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import GovernanceAudioPlayer from './GovernanceAudioPlayer.jsx';

let playSpy, pauseSpy;
beforeAll(() => {
  // jsdom doesn't implement these — mock so the component can call them.
  playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => { playSpy.mockClear(); pauseSpy.mockClear(); });

describe('GovernanceAudioPlayer — paused prop', () => {
  it('pauses the audio when paused becomes true, and resumes when false', () => {
    const { rerender } = render(<GovernanceAudioPlayer trackKey="locked" paused={false} />);
    // Initial play attempt happened (track loaded, not paused).
    expect(playSpy).toHaveBeenCalled();

    pauseSpy.mockClear();
    rerender(<GovernanceAudioPlayer trackKey="locked" paused={true} />);
    expect(pauseSpy).toHaveBeenCalled();

    playSpy.mockClear();
    rerender(<GovernanceAudioPlayer trackKey="locked" paused={false} />);
    expect(playSpy).toHaveBeenCalled();
  });

  it('does not auto-play a freshly-loaded track while paused', () => {
    playSpy.mockClear();
    render(<GovernanceAudioPlayer trackKey="locked" paused={true} />);
    expect(playSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/GovernanceAudioPlayer.test.jsx`
Expected: FAIL — `paused` is ignored today (the second test fails: a paused track still auto-plays; and the memo comparator skips re-render so the pause/resume test fails too).

- [ ] **Step 3: Implement the `paused` prop**

In `GovernanceAudioPlayer.jsx`:

(a) Add `paused = false` to the destructured props:
```jsx
const GovernanceAudioPlayer = React.memo(function GovernanceAudioPlayer({
  trackKey,
  volume = 0.85,
  loop = true,
  paused = false
}) {
```

(b) In the main load-and-play effect, guard the play attempt so a paused player doesn't auto-start. Replace the play-attempt block:
```jsx
    // Attempt to play (may fail due to autoplay policy)
    playAttemptRef.current = audio.play().catch((err) => {
```
with:
```jsx
    // Attempt to play (unless currently paused by an overlay, e.g. a voice memo)
    if (paused) return;
    playAttemptRef.current = audio.play().catch((err) => {
```
and add `paused` to that effect's dependency array (change `}, [audioSrc, volume, loop]);` → `}, [audioSrc, volume, loop, paused]);`).

(c) Add a dedicated pause/resume effect after the volume effect:
```jsx
  // Pause/resume in place (no position reset) when an overlay requests silence.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioSrc) return;
    if (paused) {
      if (!audio.paused) audio.pause();
    } else if (audio.paused) {
      audio.play().catch(() => {});
    }
  }, [paused, audioSrc]);
```

(d) Update the `React.memo` comparator so a `paused` change actually re-renders. In the comparator function, before `return true;` add:
```jsx
  if (prevProps.paused !== nextProps.paused) return false;
```

(e) Add `paused` to propTypes:
```jsx
GovernanceAudioPlayer.propTypes = {
  trackKey: PropTypes.oneOf(['init', 'locked', null]),
  volume: PropTypes.number,
  loop: PropTypes.bool,
  paused: PropTypes.bool
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/GovernanceAudioPlayer.test.jsx`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/GovernanceAudioPlayer.jsx frontend/src/modules/Fitness/player/overlays/GovernanceAudioPlayer.test.jsx
git commit -m "feat(fitness): GovernanceAudioPlayer paused prop (pause/resume in place)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Forward `voiceMemoOpen` → `paused` through GovernanceStateOverlay

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.jsx`

This is wiring; verified by Task 1's unit test plus the manual check in Task 4. (Rendering `GovernanceStateOverlay` in isolation requires substantial governance state, so we do not add a separate render test here.)

- [ ] **Step 1: Accept the prop**

Find the `GovernanceStateOverlay` component's prop destructuring (the main exported component) and add `voiceMemoOpen = false` to it. If the component reads props as a single `props`/named list, add `voiceMemoOpen` alongside the existing ones (e.g. it already receives `overlay`, `display`, etc.).

- [ ] **Step 2: Forward to every audio player**

There are 6 render sites of `<GovernanceAudioPlayer trackKey={audioTrackKey} />` (around lines 601, 634, 691, 701, 715, 726). Change each to:
```jsx
<GovernanceAudioPlayer trackKey={audioTrackKey} paused={voiceMemoOpen} />
```
(Use a global find/replace within this file: `<GovernanceAudioPlayer trackKey={audioTrackKey} />` → `<GovernanceAudioPlayer trackKey={audioTrackKey} paused={voiceMemoOpen} />`.)

- [ ] **Step 3: Add to propTypes** (if the component declares propTypes) — add `voiceMemoOpen: PropTypes.bool`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.jsx
git commit -m "feat(fitness): forward voiceMemoOpen to GovernanceAudioPlayer instances

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Pass `voiceMemoOverlayOpen` from FitnessPlayerOverlay

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx`

`voiceMemoOverlayOpen` is already computed at line 60 (`const voiceMemoOverlayOpen = Boolean(voiceMemoOverlayState?.open);`).

- [ ] **Step 1: Forward the prop**

Find the `<GovernanceStateOverlay` JSX (around line 205) and add the prop:
```jsx
    <GovernanceStateOverlay
      voiceMemoOpen={voiceMemoOverlayOpen}
      …existing props…
```

- [ ] **Step 2: Sanity — run the overlay-related suite**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/`
Expected: PASS (no regressions; the new prop is additive).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx
git commit -m "feat(fitness): mute governance overlay audio while a voice memo is open

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Manual verification

- [ ] On a deployed/dev build, drive a governance lock (HR drops below zone, or end a video while locked) so the lock-screen music plays, then open a voice memo. Confirm the music **pauses** when the memo overlay opens and **resumes** when it closes. (jsdom can't verify actual audio; this needs a real browser.)

---

## Notes
- The `init` track (challenge start music) is also covered automatically, since all 6 render sites get `paused`.
- Resume is driven purely by the overlay-open state going false (consistent with `FitnessContext.closeVoiceMemoOverlay` resuming `musicPlayerRef`); no recorder start/stop hook needed.
