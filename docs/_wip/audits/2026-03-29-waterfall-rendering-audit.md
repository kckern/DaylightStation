# NoteWaterfall Rendering & Timing Audit

**Date:** 2026-03-29
**Severity:** High — visual artifacts visible during normal piano play
**Status:** Needs redesign

---

## Reported Issues

1. Notes appear to "grow" while key is held down
2. Notes "snap" to a different size on key release
3. Notes "detach from base" before key is released
4. Segments "double up" (duplicate visual bars for the same note)

---

## Verified: Input Pipeline Is Clean

MIDI events arrive without duplication. Confirmed by log analysis:
- Each physical note_on produces exactly 1 `piano.visualizer.midi` callback
- Each note_off produces exactly 1 callback
- No duplicate WebSocket broadcasts
- No double-subscription in `useMidiSubscription`

The problem is entirely in the **rendering layer** (NoteWaterfall.jsx + useMidiSubscription.js state management).

---

## Current Architecture

### Data Flow

```
useMidiSubscription.js
  ├── activeNotes: Map<noteNum, {velocity, timestamp}>    (currently pressed)
  ├── noteHistory: Array<{note, velocity, startTime, endTime|null}>  (all notes, max 500)
  └── activeNoteIds: Ref<Map<noteNum, startTime>>         (cross-reference for note_off matching)

NoteWaterfall.jsx
  ├── tick: state (incremented every rAF frame — ~60Hz)
  ├── visibleNotes: useMemo (recomputed every frame)
  │     filter: active notes always visible; released notes visible for 8s after release
  │     map: computes duration, bottomPercent, heightPercent, isActive
  └── render: absolute-positioned divs with CSS custom properties
```

### Per-Frame Computation (visibleNotes memo)

For each note in `noteHistory`, every frame:

1. **Filter**: Is note visible?
   - Active (in `activeNotes` map with matching timestamp): always visible
   - Released (has `endTime`): visible if `now - endTime < 8000ms`
   - Orphaned (no `endTime`, not active): visible if `now - startTime < 8000ms`

2. **Map**: Compute rendering properties
   - `duration`: active → `now - startTime` (GROWS EVERY FRAME); released → `endTime - startTime`
   - `bottomPercent`: active → `0` (keyboard); released → rises over 8s
   - `heightPercent` (in render): `Math.min(95, Math.max(1, duration / 8000 * 100))`

---

## Bug Analysis

### Bug 1: Active Notes Grow

**Root cause:** `duration = now - note.startTime` for active notes (line 71). This is recomputed every rAF frame. `heightPercent` is derived from `duration / DISPLAY_DURATION * 100`, so a note held for 4 seconds is 50% of the waterfall height. 8 seconds = 100%.

**Visible effect:** The bar starts small and grows upward from the keyboard the entire time the key is held.

**Was this always there?** Yes — this is the original code. The user may not have noticed before because:
- Short staccato notes grow minimally (250ms hold → 3% height)
- Sustained notes were rare in previous usage
- The perspective CSS transform may have masked it at certain screen sizes

### Bug 2: Snap on Release

**Root cause:** When key releases, `duration` changes from `now - startTime` (continuously growing) to `endTime - startTime` (fixed). If there's any timing difference between the actual release and the state update, the height snaps.

Additionally, `bottomPercent` transitions from `0` (anchored) to `timeSinceRelease / 8000 * 100` (rising). So the note simultaneously: (a) changes height, (b) detaches from bottom, (c) starts rising. This triple visual transition looks jarring.

### Bug 3: Detach Before Release

**Root cause:** The `isStillActive` check (line 68):
```js
const isStillActive = activeNote && activeNote.timestamp === note.startTime;
```

If `activeNotes` and `noteHistory` state updates happen on different React render cycles (which they will — they're separate `useState` calls), there's a frame where:
- `activeNotes` has already removed the note (note_off processed)
- `noteHistory` still has `endTime: null` (state update queued but not yet rendered)

During that frame: `isStillActive = false`, `note.endTime = null` → falls into the "orphaned" branch (line 88-91), which immediately starts rising from the keyboard. One frame later, `endTime` is set and the note is in the correct "released" state. But that one frame of orphan-mode causes a visible flicker/detach.

### Bug 4: Duplicate Segments

**Root cause:** `activeNoteIds` ref tracks one startTime per note number (line 80):
```js
activeNoteIds.current.set(note, startTime);
```

For rapid re-strikes of the same key (common in piano playing — trills, repeated notes), the second note_on overwrites the ref. When the first note_off arrives, it looks up the ref, finds the second note's startTime, doesn't match the first note's history entry, and the first entry never gets an `endTime`. This orphaned entry stays visible for 8 seconds, appearing as a duplicate.

**Note:** This doesn't happen with the simulator (clean on/off pairs with no overlap), but DOES happen with real piano input where note_on for the next strike can arrive before note_off for the previous strike on the same key.

---

## Architectural Issues

### 1. rAF-driven Re-render of Entire History

`tick` state increments every animation frame (~60fps). This triggers `useMemo` recomputation of `visibleNotes` — iterating and mapping the entire `noteHistory` (up to 500 entries) 60 times per second. This is wasteful and creates GC pressure from the new arrays/objects every frame.

### 2. Duration Computation Conflates Display State with Data State

`duration` means different things for active vs released notes but is computed in the same field. For active notes it's "time since press" (changes every frame), for released notes it's "how long was the key held" (static). This dual meaning causes the height to behave differently before and after release.

### 3. State Split Across useState and useRef

`activeNotes` (useState), `noteHistory` (useState), and `activeNoteIds` (useRef) are three independent stores that must stay synchronized. React batches state updates but not ref updates, creating consistency windows where the stores disagree.

### 4. No Visual Transition Model

The transition from "active" to "released" has no interpolation. Properties change discretely between frames:
- height: `growing` → `fixed`
- bottom: `0` → `small positive`
- opacity: `1` → `calc(1 - progress * 0.8)`

There's no CSS transition on `.waterfall-note` for these properties because the values change every frame via inline styles, which would fight any CSS transition.

---

## Redesign Recommendations

### Option A: Fixed-Height Active Notes (Minimal Change)

- Active notes render as a fixed-height indicator (e.g., 3%) anchored at `bottom: 0`
- On release, the note "spawns" into the rising waterfall at its actual duration height
- No growing, no snap — clean two-state model
- **Risk:** Loses the visual feedback of hold duration

### Option B: Growing Active Notes with Smooth Release (Medium Change)

- Active notes grow from the keyboard, but at a visually capped rate (e.g., max 20% height over any hold duration, using an easing curve like `Math.sqrt(duration / 8000) * 20`)
- On release, smoothly transition to the rising state over 2-3 frames
- Buffer one frame between "active" and "released" to prevent the orphan flicker
- **Risk:** More complex, still has a transition moment

### Option C: Separate Active Layer (Full Redesign)

- Split into two rendering layers:
  1. **Active layer** (bottom): Shows currently-held notes as fixed-height bars with glow/pulse. Pure reactive to `activeNotes` map. No history dependency.
  2. **History layer** (rising): Shows released notes only, computed from `noteHistory` entries that have `endTime`. Height = actual hold duration. Rises from keyboard over 8 seconds.
- `noteHistory` entries only become visible in the history layer AFTER `endTime` is set
- Eliminates all active/released transition glitches
- Eliminates orphan problem (no endTime = not rendered)
- **Risk:** Larger refactor, need to handle the visual handoff between layers

### Option D: Canvas Rendering (Full Rewrite)

- Replace DOM-based rendering with `<canvas>` or WebGL
- Single `requestAnimationFrame` loop draws all notes
- Complete control over timing, interpolation, and visual transitions
- Eliminates React re-render overhead entirely
- **Risk:** Largest effort, loses React dev tooling for this component

---

## Recommended Path

**Option C** — cleanest separation of concerns. The active/released conflation is the root of every bug. Splitting into two layers eliminates the entire class of problems.

### Implementation Sketch (Option C)

```jsx
// Active layer — driven directly by activeNotes prop
<div className="active-notes-layer">
  {[...activeNotes.entries()].map(([note, { velocity }]) => (
    <div key={note} className="active-note-bar" style={{
      '--x': getNotePosition(note),
      '--width': getNoteWidth(note),
      '--hue': getNoteHue(note),
      '--velocity': velocity / 127
    }} />
  ))}
</div>

// History layer — driven by noteHistory, only released notes
<div className="history-notes-layer">
  {noteHistory
    .filter(n => n.endTime && (now - n.endTime) < DISPLAY_DURATION)
    .map(n => {
      const holdDuration = n.endTime - n.startTime;
      const timeSinceRelease = now - n.endTime;
      const progress = timeSinceRelease / DISPLAY_DURATION;
      return (
        <div key={`${n.note}-${n.startTime}`} className="history-note-bar" style={{
          '--x': getNotePosition(n.note),
          '--width': getNoteWidth(n.note),
          '--height': `${(holdDuration / DISPLAY_DURATION) * 100}%`,
          '--bottom': `${progress * 100}%`,
          '--hue': getNoteHue(n.note),
          '--progress': progress
        }} />
      );
    })
  }
</div>
```

### Active Layer CSS

```scss
.active-note-bar {
  position: absolute;
  left: var(--x);
  width: var(--width);
  height: 3%;           // Fixed height — no growing
  bottom: 0;            // Always at keyboard
  background: radial-gradient(...);  // Glow effect
  opacity: calc(0.7 + 0.3 * var(--velocity));
  animation: pulse 0.5s ease-in-out infinite;
}
```

### History Layer CSS

```scss
.history-note-bar {
  position: absolute;
  left: var(--x);
  width: var(--width);
  height: var(--height);
  bottom: var(--bottom);
  opacity: calc(1 - var(--progress) * 0.8);
  // Gradient from bright (bottom) to fading (top)
  background: linear-gradient(to top, ...);
}
```

---

## Key Files

| File | Role |
|------|------|
| `frontend/src/modules/Piano/useMidiSubscription.js` | MIDI state management (activeNotes, noteHistory) |
| `frontend/src/modules/Piano/components/NoteWaterfall.jsx` | Waterfall renderer (the problem area) |
| `frontend/src/modules/Piano/components/NoteWaterfall.scss` | Waterfall CSS (perspective, gradients, animations) |
| `frontend/src/modules/Piano/PianoVisualizer.jsx` | Parent compositor — passes activeNotes + noteHistory down |
| `frontend/src/modules/Piano/noteUtils.js` | Position/width/hue calculations |

---

## Testing Plan

1. **Staccato notes** (short taps): Should appear as small fixed-height bars, immediately rise on release
2. **Sustained notes** (long holds): Active indicator stays at keyboard, no growing. On release, tall bar spawns and rises
3. **Rapid repeated notes** (same key): Each press/release should produce one bar. No orphans, no duplicates
4. **Chords**: Multiple simultaneous active indicators, all release cleanly
5. **Trills**: Alternating notes rapidly — no visual artifacts, no orphaned bars
6. **Performance**: 500-note history should not cause frame drops (current rAF re-render needs optimization)
