# NoteWaterfall Two-Layer Redesign

**Date:** 2026-03-29
**Status:** Approved
**Audit:** `docs/_wip/audits/2026-03-29-waterfall-rendering-audit.md`

---

## Problem

The NoteWaterfall conflates active (held) and released notes in a single rendering path. This causes:

1. Active notes grow in height every frame (`duration = now - startTime`)
2. On release, height and position snap discontinuously
3. One-frame orphan flicker when React state updates are split across renders
4. Duplicate visual bars when rapid re-strikes overwrite `activeNoteIds` ref

## Solution

Split free-play note rendering into two layers, both inside `.waterfall-perspective` (preserving 3D tilt):

1. **Active layer** — renders from `activeNotes` Map directly
2. **History layer** — renders from `noteHistory`, only entries with `endTime` set

A note is never in both layers simultaneously. Game mode rendering is unchanged.

---

## Active Layer

**Data source:** `activeNotes: Map<noteNum, {velocity, timestamp}>` prop

**Rendering:** One div per held note.

| Property | Value | Notes |
|----------|-------|-------|
| key | `active-${noteNum}` | One entry per note number max |
| x | `getNotePosition(noteNum)` | Same as today |
| width | `getNoteWidth(noteNum)` | Same as today |
| height | `3%` | Fixed, never changes |
| bottom | `0` | Anchored at keyboard |
| hue | `getNoteHue(noteNum)` | Same as today |
| velocity | `velocity / 127` | For glow intensity |
| class | `waterfall-note active` | Reuses existing pulse animation |

**No `tick` dependency.** This layer re-renders only when `activeNotes` changes (key press/release events). No rAF polling.

**No duration, no progress, no orphan detection.**

---

## History Layer

**Data source:** `noteHistory` prop, filtered to entries where `endTime` is set and `(now - endTime) < DISPLAY_DURATION`

**Rendering:** One div per released note, animated via rAF `tick`.

| Property | Computation | Notes |
|----------|-------------|-------|
| key | `hist-${note}-${startTime}` | Unique per note instance |
| x | `getNotePosition(note)` | Same as today |
| width | `getNoteWidth(note)` | Same as today |
| height | `min(95, max(1, holdDuration / DISPLAY_DURATION * 100))%` | Static per note — `holdDuration = endTime - startTime` |
| bottom | `(timeSinceRelease / DISPLAY_DURATION) * 100%` | Rises over 8 seconds |
| hue | `getNoteHue(note)` | Same as today |
| velocity | `velocity / 127` | For gradient intensity |
| progress | `timeSinceRelease / DISPLAY_DURATION` | For opacity fade |
| class | `waterfall-note` | No `active` class |

**Depends on `tick`** for the rising animation. Filters and maps only released notes — no `isStillActive` branching.

---

## What Changes

### NoteWaterfall.jsx

**Remove:** The single `visibleNotes` useMemo that handles both active and released notes with `isStillActive` branching.

**Add:** Two separate rendering blocks inside `.waterfall-perspective`:

1. Active notes block — iterates `activeNotes` Map entries, renders fixed-height bars
2. History notes block — its own `useMemo` driven by `[noteHistory, startNote, endNote, tick]`, filters for `endTime`, computes rising position

**Keep unchanged:**
- `tick` state and rAF effect (still needed for history layer)
- `gameNotes` useMemo
- `gameLasers` useMemo
- All game mode JSX (falling notes, explosions, lasers, hit feedback, hit line)
- Component signature and props

### useMidiSubscription.js

**No changes.** The `activeNoteIds` ref matching issue becomes harmless — history entries without `endTime` simply don't render. They'll either get their `endTime` set on the next note_off, or age out of the 500-entry history cap.

### NoteWaterfall.scss

**No changes.** The existing `.waterfall-note` and `.waterfall-note.active` styles already have the right visuals. Active notes get the pulse animation; history notes get the gradient + fade. The `--height`, `--bottom`, `--progress` custom properties are set by JS in both layers.

---

## What Stays the Same

- Component props interface
- Game mode rendering (gameNotes, gameLasers, explosions, hit feedback)
- SCSS styles and animations
- `useMidiSubscription` hook
- `PianoVisualizer` parent — no changes needed
- `noteUtils.js` functions
- 8-second display duration
- 500-note history cap
- Perspective transform and 3D tilt

---

## Testing

| Scenario | Expected |
|----------|----------|
| Short tap (staccato) | Small fixed bar at keyboard → on release, small bar rises |
| Long hold (sustain) | Fixed 3% bar at keyboard, pulsing → on release, tall bar spawns and rises |
| Rapid repeated same key | Each release produces one rising bar. No duplicates, no orphans |
| Chord (multiple keys) | Multiple active bars at keyboard simultaneously, all release cleanly |
| Trill (alternating fast) | Clean alternating bars, no visual artifacts |
| Game mode active | Free-play notes hidden via CSS (existing behavior), game rendering unchanged |
| 500+ notes in session | No frame drops, history cap enforced |
