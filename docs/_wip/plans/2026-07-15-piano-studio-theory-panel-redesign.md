# Piano Studio + ambient monitor — theory panel & record redesign

**Date:** 2026-07-15
**Status:** Spec v2 (post adversarial review — supersedes v1)
**Scope:**
- Studio mode top pane (`modes/Studio/`).
- The shared theory triptych `components/TheoryPanel.jsx` + `MusicNotation/`,
  rendered in **Studio Play** (`StudioPlay`), **Studio Playback**
  (`StudioPlayback`), and the **Videos** sidebar (`PianoVideoPlayer`, column).
- The **ambient monitor view** `modules/Piano/PianoVisualizer.jsx` (the
  screen-framework `piano` widget, `builtins.js:24`) — upgraded to the full
  theory panel.
- Key-detection model `MusicNotation/model/keySignature.js` (now **in scope**).

> **v1 was reviewed and rejected as unsafe.** This version fixes: the headroom
> math (BLOCKER), the chord-centering approach (BLOCKER — now dropped in favor of
> whole-staff centering), the conditional-hook trap (MAJOR), the key-detection
> blind spot for one-accidental keys (MAJOR), record-on-playback (MAJOR), and the
> tab-bar CSS underestimate (MAJOR). See "Review deltas" at the end.

---

## Problem statement

On Studio Play (inherited by every `TheoryPanel` consumer):

1. **Staff clips at the top** — tall chords / ledger lines above the treble are cut
   off by the card's top edge.
2. **Chord leans hard left** — a lone chord parked after the key signature on a
   stave stretched edge-to-edge, stranded against the left.
3. **Circle of fifths is stuck in C** — never rotates to the key being played.
4. **Record button placement is bad** — floats over the staff card, clipped.

And a new requirement:

5. **The ambient monitor view is impoverished** — `PianoVisualizer` shows only a
   lone staff in its header; it should present the same theory panel (circle ·
   staff · chord speller) as Studio, over the waterfall + display keyboard, with
   no tabs and no touch input.

### Root causes (verified against source + VexFlow 4.2.5)

| # | Root cause | Location |
|---|-----------|----------|
| 1 | `TOP_ROOM = 14`, **and** `chordNote()` builds `StaveNote` with no `auto_stem` → VexFlow forces stem-UP (`Stem.HEIGHT = 35`). A high unshifted chord's notehead lands at negative Y and clips before the stem is even counted. | `chordStaff.js:20`, `chordStaff.js:64-67` |
| 2 | Stave width stretched to fill the box aspect with **no upper cap**; chord left-parked via `NOTE_INSET`. | `chordStaff.js:36-43, 131-139` |
| 3 | `TheoryPanel` computes its **own** key from the **instantaneous** held notes, re-seeding `'C'` each render (`detectKey(pitchClasses, 'C')`), so it never accumulates history; the staff meanwhile keeps a separate rolling detection → the two disagree. | `TheoryPanel.jsx:30` vs `CurrentChordStaff.jsx:27-57` |
| 3b | Even the staff's rolling `detectKey` uses pure scale-membership + a 0.2 hysteresis margin. C shares 6/7 tones with G and F, so **one-accidental keys never win** — play in G/F all day, it reads C. | `keySignature.js:41-76` |
| 4 | Record button absolutely positioned over the staff card, inside `StudioPlay`. | `StudioPlay.jsx:33-45`, `PianoApp.scss:862-885` |
| 5 | `PianoVisualizer` header renders a bare `CurrentChordStaff`, no circle/speller. | `PianoVisualizer.jsx:105-107` |

---

## Decisions (confirmed with user, 2026-07-15)

- **Record → right end of the tab bar**, hidden on the playback route.
- **Circle key → auto-detect, shared** with the staff (no manual UI).
- **Key detection → improved** (tonic-weighted profile) so G/F and other near-C
  keys register — `keySignature.js` is in scope.
- **Staff → natural width, centered** via a width cap + `meet` (no per-note
  centering), with real headroom so tall chords don't clip.
- **Ambient monitor → `PianoVisualizer`** gets the full `TheoryPanel`.

---

## A. One shared, improved key detection

### A1. Improve `detectKey` — tonic-weighted profile

`MusicNotation/model/keySignature.js`. Replace pure scale-membership scoring with a
**Krumhansl–Kessler major-key profile** correlation so the tonic/dominant carry
weight (this is what lets G beat C when you actually play *in* G):

```js
// KK major profile, index 0 = tonic:
const MAJOR_PROFILE = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
// score(keyTonic) = Σ_pc counts[pc] * MAJOR_PROFILE[(pc - keyTonic + 12) % 12]
// (optionally Pearson-correlate counts vs the rotated profile for scale-invariance)
```

- Signature unchanged: `detectKey(pitchClasses, currentKey = 'C') → keyName`.
- Guards unchanged: `< 5` notes or `< 3` unique → return `currentKey`.
- Hysteresis: keep `currentKey` unless another key's score beats it by a margin
  (`HYSTERESIS`, tuned so ordinary G/F material flips but noise doesn't — start
  ~3–5% of the current score; unit-test the boundary).
- Still **major-key only** (matches `KEY_SIGNATURES`); returns a key name in
  `KEY_SIGNATURES`.
- **Producer is a downstream consumer** (`Producer.jsx:884`,
  `detectKey(notes.map(n => n.midi % 12))`, one-shot, no `currentKey`) — the new
  argmax must still give a sensible whole-song key. Covered by a test.

### A2. Extract `useDetectedKey` hook (unconditional)

New file `components/useDetectedKey.js`. Lifts the rolling buffer out of
`CurrentChordStaff`:

- Maintains `{ pitchClass, timestamp }` for **new** notes only;
  `KEY_BUFFER_MAX_AGE = 10_000`, `KEY_BUFFER_MAX_NOTES = 30`.
- On the new-note edge: prune (age + size), call `detectKey(pcs, prevKey)`, set
  state. Releases/decay never perturb the key.
- Returns the current key (seeded `'C'`).

### A3. `CurrentChordStaff` — unconditional hook, prop override

`components/CurrentChordStaff.jsx`:

- **Always** call `const internalKey = useDetectedKey(activeNotes);` (never
  conditional — Rules of Hooks). Use `const key = detectedKey ?? internalKey;`.
- New optional prop `detectedKey`. When the parent passes it, the internal hook
  still runs but its result is ignored (accepted minor waste; keeps hooks honest).
- Remove the internal `noteBufferRef` + `detectKey` call + `detectedKey` **state**
  (now in the hook); keep **all** note-decay + peak-chord logic. `detectedKey`
  leaves the decay `useEffect` dep array (no stale-closure exposure — verified).

### A4. `TheoryPanel` owns one key

`components/TheoryPanel.jsx`:

- Delete `import { detectKey }` and the broken instantaneous `useMemo`.
- `const detectedKey = useDetectedKey(activeNotes);`
- Pass to **both** `<CircleOfFifths … detectedKey={detectedKey} />` and
  `<CurrentChordStaff activeNotes={activeNotes} detectedKey={detectedKey} />`.
- `pitchClasses` / `rootPc` (instantaneous active-bubble + root emphasis) unchanged
  — they *should* reflect the current chord, not the key.

No change to `CircleOfFifths.jsx` / `circleOfFifths.js`.

---

## B. Natural-width, centered, un-clipped staff

All in `MusicNotation/renderers/chordStaff.js`. The SVG already uses
`preserveAspectRatio="xMidYMid meet"` and fills 100% of the host — a viewBox
narrower than the pane auto-centers horizontally, so **whole-staff centering is the
centering mechanism** (no per-note math).

### B1. Real headroom — `auto_stem` + symmetric room

- `chordNote()`: build `new StaveNote({ …, auto_stem: true })` so high chords stem
  **down** and low chords stem **up** (stems point toward the staff), halving the
  vertical overhang to just noteheads + ledger lines.
- Size the room from the worst **unshifted** extreme the ottava logic permits
  (`handSplit.getOttavaInfo` shifts treble > A6 / bass below its floor): about
  9 diatonic steps × 5 units ≈ 45 + notehead ≈ **~52 units** each side.
  Set `TOP_ROOM = 52`, `BOTTOM_ROOM = 52`.
  New `logicalH = 52 + 66 + 40 + 52 = 210` (≈ the old 192 → negligible size change,
  which also answers the review's "8% shrink" concern).
- **Verify empirically** with the screenshot's B-dim chord — no clip top or bottom.

### B2. Width cap → natural, centered stave

`computeChordStaffLayout(accCount, aspect)`:

- `const MAX_STAVE_ASPECT = 1.7;` (viewBox w:h)
- `const maxStaveW = Math.round(logicalH * MAX_STAVE_ASPECT) - PAD * 2;`
- When `aspect` is valid: `staveW = Math.max(minStaveW, Math.min(target, maxStaveW))`.
  The `minStaveW` fallback (null/garbage aspect) is unchanged.
- Effect: on a wide pane the stave stops at ~1.7:1 and `meet` centers it with air
  on both sides — natural width, centered. In the Videos **column** sidebar the box
  can also exceed 1.7 on wide screens; the cap engages there too, benignly (still a
  centered staff). *(v1 wrongly claimed "no change in column".)*

### B3. Chord position — **left-parked, unchanged**

Keep the existing single `NOTE_INSET` shift for **both** voices. Do **not** center
per-note: treble/bass format independently, so per-note centering staggers the two
hands (BLOCKER). Whole-staff centering (B2) delivers the "not leaning left" the user
asked for while keeping both hands at an identical offset. Update the `chordStaff.js`
header + `computeChordStaffLayout` doc + `:126` comment to describe the cap and that
centering is done by the viewBox, not the note.

### B4. Card padding

Reclaim a little of the top-pane vertical padding if B1's taller viewBox visibly
shrinks the engraving in the 16rem card (`PianoApp.scss:844`, `2rem 0`) — tune to
taste during live-verify. No change to `ChordStaffRenderer.jsx`.

---

## C. Record button → tab bar (not on playback route)

### C1. Button lives in `Studio.jsx`

- Render a `<RecordButton>` (extract to `modes/Studio/RecordButton.jsx`:
  `{ recording, elapsedMs, onToggle }`, owns the `mmss` helper + `Icon`) inside the
  `<nav className="piano-studio__tabs">`, after the NavLinks.
- **Hide it on the playback route.** The nav sits above `<Routes>`, so on
  `recordings/:id` (StudioPlayback) a visible Record would re-record the synthesized
  playback (its `pressNote` feeds the recorder's `subscribe` stream). Gate with the
  route: render the button only when not on `recordings/:id` (match via
  `useLocation`/`useMatch`, or lift the button into the Play/Recordings branch).
- Remove the redundant `piano-studio__rec-dot` on the Recordings NavLink.

### C2. `StudioPlay.jsx` sheds the button

- Delete the record `<button>` block, `mmss`, and the `Icon` import.
- Drop props `recording`, `elapsedMs`, `onRecordToggle`; `Studio.jsx` stops passing
  them.

### C3. SCSS — real tab-bar work (`PianoApp.scss`)

The tabs (`~:715-740`) are `display:flex; gap; padding:.75rem 1.5rem 0;
border-bottom:1px solid` with rounded-top tabs that **merge into** the bottom border
(no `align-items`). A pill dropped in with only `margin-left:auto` stretches full
height and welds to the underline. Required:

- Push the button right (`margin-left:auto`) **and** `align-self:center`, with
  bottom clearance so it clears the tab underline; verify against the active-tab
  background/border trick.
- Rehome styles `.piano-studio-play__record*` → `.piano-studio__record` (same pill:
  idle grey, `is-recording` = red + pulsing white dot + stop glyph, tabular-nums).
- Drop the now-unused `.piano-studio-play__record*` rules and the
  `position:relative` "anchors the floating Record button" comment on
  `.piano-studio-play`.

---

## D. Ambient monitor — `PianoVisualizer` gets the theory panel

`modules/Piano/PianoVisualizer.jsx` + `PianoVisualizer.scss`. Goal: Studio's visual
core (theory panel · waterfall · display keyboard) with **no tabs, no touch, no
record**. Keyboard is already display-only (no `onNoteOn/off` passed) — keep it.

- Replace the header's lone `<CurrentChordStaff activeNotes={activeNotes} />`
  (`:105-107`) with `<TheoryPanel activeNotes={activeNotes} layout="row" />`,
  promoted to a proper top band (like `StudioTopPane`) rather than a cramped header
  slot, so the circle has height. Keep the session timer / note-count / sustain /
  inactivity bar as a small corner overlay, not competing with the panel.
- Preserve **all** existing behavior: spam warning/blackout overlays, game
  activation + fullscreen game replace-layout, inactivity countdown, session
  tracking, `configureLogger` session-log wiring. None of that moves.
- `TheoryPanel` benefits from A + B automatically (shared improved key + un-clipped
  centered staff).
- `PianoVisualizer.scss`: give the new top band a definite height so
  `TheoryPanel`/`ChordStaffRenderer`'s absolute SVG has a box to fill (same contract
  as `.piano-studio-toppane`).

**Not touched:** the tablet kiosk `PianoApp.jsx`, its routing/menu/connect-gate.

---

## Consumers of the shared pieces (complete list)

| Consumer | Uses | Gets A? | Gets B? |
|----------|------|:--:|:--:|
| `StudioPlay` (row) | `TheoryPanel` | ✓ | ✓ |
| `StudioPlayback` (row, `:170`) | `TheoryPanel` | ✓ | ✓ |
| `PianoVideoPlayer` (column, `:323`) | `TheoryPanel` | ✓ | ✓ |
| `PianoVisualizer` (§D) | `TheoryPanel` (new) | ✓ | ✓ |
| `StudioTopPane` default slot (`:20`) | `CurrentChordStaff` standalone | ✓ (internal hook) | ✓ |

`CurrentChordStaff` standalone keeps working via the unconditional internal hook
(A3). Verified no other direct `CurrentChordStaff` consumers.

---

## Test impact

| Test | Change |
|------|--------|
| `MusicNotation/model/keySignature.test.js` | Update for the KK algorithm. New/changed cases: a G-major run (with F#, and a scale run without C-natural) now resolves to **'G'**; F-major → **'F'**; D-major arpeggio → **'D'**; `<5` notes / `<3` unique hold `currentKey`; hysteresis boundary (a few out-of-key notes don't flip). Producer one-shot whole-song detection still returns a sane key. |
| `MusicNotation/renderers/chordStaff.test.js` | `LOGICAL_H` 192 → **210**; the `aspect=10` "no gutter" case now **caps** → assert `logicalW/logicalH ≈ 1.7`; add an explicit cap case; `550/500` stays valid (target 229/210 ≈ 1.09 < cap); `minStaveW`/garbage-aspect cases unchanged. Optional: assert `auto_stem` path renders (paths > threshold) for a high chord. |
| `components/useDetectedKey.test.js` (new) | Buffer + hysteresis via the hook; age/size pruning; new-note-edge only. |
| `components/TheoryPanel.test.jsx` | Structural cases pass as-is. Add: an all-sharp cluster (C scores 0) rotates the circle's diatonic window off C, and the **same** key reaches both circle + staff. Detection now runs in an effect → use `act`/flush. |
| `components/CurrentChordStaff.*` | Passing `detectedKey` overrides internal detection; omitting it self-detects (back-compat). |
| `modes/Studio/StudioPlay.test.jsx` | Drop the `props` record fields; assert the record button is **absent** from `StudioPlay`; triptych still renders. |
| `modes/Studio/RecordButton.test.jsx` (new) | Toggles `onToggle`; shows `M:SS` while recording; idle shows "Record". |
| `modes/Studio/Studio.test.jsx` (new) | Record button present on Play/Recordings, **absent** on `recordings/:id`. Needs a `MemoryRouter` wrapper + recorder/MIDI mocks. |
| `PianoVisualizer` test (if present) | Header now renders circle + speller (TheoryPanel), not just a staff; overlays/game paths still render. |

New unit tests ship with the change (repo testing discipline).

---

## Out of scope / non-goals (YAGNI)

- No manual key-lock UI (auto-detect only).
- No minor-key detection (major profiles only, matching `KEY_SIGNATURES`).
- No change to `NoteWaterfall`, `PianoKeyboard`, the Recordings list, or playback
  transport.
- No change to `ChordNamePanel` (chord speller reads the instantaneous chord).
- No change to the tablet kiosk shell (`PianoApp.jsx`).

---

## Implementation order

1. **A1** — improve `detectKey` (KK profile + hysteresis) + tests. Verify Producer
   unaffected.
2. **A2–A4** — `useDetectedKey` hook (+ test); thread through `CurrentChordStaff` +
   `TheoryPanel`. Verify circle rotates to G/F/D and matches the staff.
3. **B** — `auto_stem`, `TOP_ROOM`/`BOTTOM_ROOM`, width cap; fix `chordStaff.test.js`;
   sweep stale "fill / no cap / never clips" comments. Live-verify: no clip,
   centered, natural width.
4. **C** — `RecordButton.jsx`; move into `Studio.jsx` nav, hide on playback route;
   `StudioPlay.jsx` + tests + SCSS.
5. **D** — `PianoVisualizer` header → `TheoryPanel` band; SCSS; preserve overlays.
6. Full `vitest` on `modules/Piano` + `modules/MusicNotation`; live-verify Studio
   Play, Studio Playback, Videos sidebar, and the ambient monitor via screenshot.

---

## Review deltas (v1 → v2)

- **B1 (BLOCKER):** added `auto_stem: true` + worst-case arithmetic; `TOP_ROOM`
  30→52 and `BOTTOM_ROOM`→52 (logicalH 210, no net shrink). v1's "30" clipped the
  motivating chord.
- **B3 (BLOCKER):** **dropped** per-note centering (VexFlow `getBoundingBox` throws,
  not null; independent treble/bass shifts stagger the hands). Centering is now done
  by the width cap + `meet`.
- **A3 (MAJOR):** hook is **unconditional** (`detectedKey ?? internalKey`), not a
  prop-conditional call.
- **A1/A3b (MAJOR):** key detection improved (tonic-weighted) so G/F register;
  `keySignature.js` pulled into scope; test scenarios made hysteresis-aware.
- **C1 (MAJOR):** record button **hidden on the playback route** (re-record footgun).
- **C3 (MAJOR):** concrete tab-bar CSS (`align-self:center` + underline clearance),
  not "adapt".
- **Scope:** `StudioPlayback` and `PianoVisualizer` explicitly enumerated; line refs
  corrected (`TOP_ROOM` at `:20`); stale-comment sweep listed.
