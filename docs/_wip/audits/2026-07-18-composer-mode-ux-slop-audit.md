# Composer Mode — UX & Input-Architecture Slop Audit

**Date:** 2026-07-18
**Scope:** `frontend/src/modules/Piano/PianoKiosk/modes/Composer/` (Composer.jsx, EditorSurface.jsx, DurationPalette.jsx, ComposerBar.jsx, useComposerInput.js, model/, Composer.scss) vs. its own spec, `docs/reference/piano/composer.md`
**Lens:** frontend-design + UX/usability + spec-conformance
**Field report:** "the staff crashes and regens on input instead of smooth note input" — confirmed below, root-caused, and it was *predicted in writing by this mode's own spec*.
**Verdict:** This is the rare audit where the defense is already in the docket. The spec did the hard thinking: it named OSMD's full-teardown re-engrave as the central hazard, declared the wet-ink PendingLayer "the entry feedback path (default design, not a contingency)," and set a measured P0 gate of pending-note-visible-in-under-100ms on an aged page. The build then shipped engrave-per-edit anyway, labeled itself "P2: no wet-ink pending layer" in its own header comment, and called it a mode. What landed is a demo of the serializer, not an instrument: a postage-stamp staff on a mostly blank screen, a full engraving teardown on every keypress, no caret on the blank sheet, no way to delete a note by touch, no playback button, and a toggle labeled **Play** that does not play anything. Every one of these is cheap to name because the spec already named it. Shipping the shortcut is a choice; shipping the shortcut *after writing down why the shortcut fails on this hardware* is slop.

---

## A. Experience failures (what a kid at the piano actually hits)

### A1. Every keypress detonates the staff — **the reported bug, and the spec called the shot**

The build engraves per edit: each note-on serializes the whole score → `osmd.load(xml)` → full re-engrave, and `osmdEngrave` clears the host with `innerHTML = ''` first. The user watches their sheet music get demolished and rebuilt for every single note. `EditorSurface.jsx:2-3` admits the architecture in its own header: *"P2: engrave-per-edit, no wet-ink pending layer."*

Now read the spec this code claims to implement (`composer.md` §2.1):

> **"PendingLayer is the entry feedback path (default design, not a contingency).** Uncommitted/just-committed notes in the caret's measure paint instantly via the existing hand-rolled `SvgStaffRenderer` … 'Press a key → see the note' never waits on OSMD."
> **"OSMD engraves on measure-exit / ~600 ms idle."**
> **"A fresh-page benchmark is therefore not evidence."**

The spec cataloged the exact kiosk pathology — aged pages decay toward 10 fps, the OS episodically clamps the WebView to 4–8 fps, and BLE-MIDI input does not count as "user activity" to Android, so playing the piano cannot even lift the throttle. Under those conditions, full-teardown-per-keypress is not a rough edge; it is the one architecture the design document exists to forbid. The P0 gate (§2.1: pending note visible < 100 ms on a > 30-minute-old page) was never run, because the thing it gates was never built.

**Fix (all three, they compose):**
1. Build the PendingLayer as spec'd — instant `SvgStaffRenderer` wet ink in the caret's measure; OSMD engraves on measure-exit / idle.
2. Double-buffer the deferred engrave: render into an offscreen host, swap on completion. Even the once-a-bar engrave should never flash a blank page. (The spec doesn't demand this; the hardware does.)
3. Run the P0 gate as written before calling the mode done again.

### A2. Translucent pre-commit notes are missing — and they were never optional

Restating A1 from the product side because it keeps getting framed as an enhancement request: "notes appear on the staff before they're committed" is not a feature idea to evaluate. It is §2.1, verbatim, styled and named — wet ink, accent-colored, slightly bold, drying into engraved notation on settle. The current build has zero feedback between keypress and full re-engrave. On a throttled page, that gap is the entire perceived product.

### A3. The blank sheet has no caret and no invitation — the landing screen is inert

Three facts conspire (`EditorSurface.jsx:26-41, 57-69`):
- The caret positions itself off engraved `steps`.
- `buildSteps` excludes rests.
- The blank draft is displayed as a single render-only whole rest.

Net: on a fresh draft, `steps` is empty and **the caret does not render at all**. The `.composer-caret` styling (`Composer.scss:287-296`) is dead code on the one screen every session starts on. There is also no empty-state copy — nothing says "pick a note length, then play a key." And since the arm toggle defaults *off*, a kid who sits down and plays the piano sees **nothing happen on screen**. An editor that opens with no insertion point, no instructions, and no response to the instrument in front of it reads as broken, because functionally it is.

**Fix:** synthetic caret geometry for the empty measure (the spec's PendingLayer already requires synthetic pending geometry — same mechanism), plus one line of empty-state copy on the paper itself.

### A4. The button labeled "Play" doesn't play — and nothing else does either

`DurationPalette.jsx:86-96`: the arm toggle renders "Play" when *unarmed* and "Armed" when armed. So the most transport-looking control on screen — a pill with a dot and the word **Play** — is (a) not a playback control, (b) labeled with its current *state* rather than its action (the classic ambiguous toggle: does tapping "Play" start playing, or am I already in Play?), and (c) sitting in a UI that has **no actual playback control anywhere**, despite the spec's keymap assigning `NumpadEnter` = play/pause from caret. A kid taps Play expecting to hear their song. Nothing happens. That is the second "nothing happens" in the first minute of use (see A3).

**Fix:** the toggle becomes **Write ●** (on/off, action-labeled); a real **▶ Play** transport button appears, wired to the spec's playback path.

### A5. You cannot delete a note by touch. At all.

The model supports it — `useComposerInput.js:54-55, 75` maps `NumpadSubtract` to delete-before-caret and `Delete` to delete-at-caret. The screen does not: the palette offers durations, dot, rest, arm — **no delete button** (`DurationPalette.jsx`). Plain-keyboard `Backspace` isn't mapped either. Wrong notes are the single most frequent event in a children's composition tool, and the touch UI's answer is a shrug. The spec's own degradation story ("a dead pad degrades to touch-editing, not a bricked mode") is false as built: a dead pad degrades to write-only.

**Fix:** ⌫ button in the palette (SVG, per the directive — see B1); alias `Backspace` to delete-before-caret.

### A6. One blank bar is not a blank sheet

`model/score.js:19` creates a single measure; the display fallback (`EditorSurface.jsx:57-69`) fills it with one whole rest. The kid faces a lonely bar fragment adrift on a large empty white card — the maximum of dead space with the minimum of invitation. Real manuscript paper shows ruled systems waiting to be filled; that is what makes it legible as *paper*. The fix is nearly free: the editor already auto-appends measures on overflow (`model/editor.js:121`), and the render-only rest trick already exists for bar 1. Pad the **display** with 4–8 rest-filled bars across one or two systems, never serialized; trailing display bars become real as the kid writes into them. Model stays honest, page stops being a void.

### A7. The score — the entire point of the mode — gets ~5% of the pixels

`MusicXmlRenderer` mounts at `scale: 1` (`EditorSurface.jsx:179`); `.composer-page` is a fixed `max-width: 60rem` slab regardless of content (`Composer.scss:272-281`). On the 8″ kiosk tablet the result is a tiny staff in the top-left corner of a big blank card floating in a bigger dark void, with the lower two-thirds of the viewport doing nothing. Notation for a child should be the largest, boldest element on screen. Scale the engraving up substantially and size the paper to its content (A6's display bars absorb the rest).

### A8. The number badges read as piano fingering

`DurationPalette.jsx:12-18` prints 1/3/5/9/7 under noteheads. Bare digits attached to notes are, in every piano method book on earth, **fingering numbers** — the worst possible collision for a piano-teaching household app. They are numpad hints, but the legend explaining that lives behind the (i) button. Style them as keycaps (bordered, key-shaped), or show them only when a numpad is attached.

### A9. An untitled piece has no name and no way to get one

The editor shows no title for a draft and offers no naming affordance; the breadcrumb only surfaces a title for already-named songs (`Composer.jsx:64-68`). The spec's own framing — "a kid's work deserves a life outside the kiosk screen" — starts with the work having a name the kid gave it, discoverable from the editor, not from a gallery two taps away.

---

## B. Design-language sins

### B1. Four icon languages in one toolbar row — including the exact tofu risk this file already litigated

`DurationPalette.jsx` opens with a comment explaining that note glyphs are hand-drawn SVG *because Unicode music symbols render as tofu on the kiosk's Firefox*. Then, in the same component: the dot button is Unicode `♩.` (`:73`), Rest is the *word* "Rest" (`:76-84`) where a rest glyph belongs — a symbol the kid is supposed to be learning — and the arm toggle is text. One file over, undo/redo are text arrows `↶ ↷` (`EditorSurface.jsx:169-170`) and the bottom bar uses `☰` and `ⓘ`. The household directive is SVG-only icons (established during the sheet-music overhaul, for this same kiosk, for this same reason). The palette proves the point and violates it in the same 100 lines.

### B2. Three interaction semantics, one pill costume

Duration buttons and the dot are **sticky modes**. Rest is a **one-shot insert**. Play/Armed is a **global input toggle** that changes what the physical piano does. All three render as near-identical pills in one row (`Composer.scss:225-241` styles mod and arm from the same block). Nothing about shape, grouping, or placement tells the kid which taps *do something now* versus *change what happens later*. Modes, actions, and switches need distinct silhouettes.

### B3. Four chrome strips starve the content they frame

Browser bar + kiosk breadcrumb header + editor toolbar + a full-width bottom bar containing exactly two lonely buttons ("Songs", (i) — `ComposerBar`). The bottom bar spends ~70px of the scarcest resource on the device to host controls that fit in the header with room to spare. Meanwhile the score is a postage stamp (A7). Fold the bar into the top chrome.

### B4. Touch targets sized for a mouse, disabled states dimmed to invisibility

Palette buttons bottom out at `min-height: 2.9rem` (~42px on this device — below comfortable kid-tablet targets), undo/redo at 2.6rem with thin dark-gray glyphs on a darker background, and `:disabled { opacity: 0.32 }` (`Composer.scss:164`) renders the history buttons as ghosts a child will not register as controls at all.

---

## C. Spec-vs-build ledger

| Spec commitment (`composer.md`) | As built | Status |
|---|---|---|
| PendingLayer wet-ink entry feedback, "default design, not a contingency" (§2.1) | Engrave-per-edit, full teardown per keypress | **Absent; inverse shipped** |
| OSMD engraves on measure-exit / ~600 ms idle (§2.1) | OSMD engraves on every edit | **Absent** |
| Caret rides synthetic pending geometry until layout resolves (§2.1) | Caret nonexistent on blank staff; no synthetic geometry | **Absent** |
| P0 gate: pending note < 100 ms on a > 30-min-old throttled page (§2.1, §14) | Never run (nothing to gate) | **Not run** |
| `NumpadEnter` = play/pause from caret | No playback control, on screen or mapped | **Absent** |
| Dead numpad "degrades to touch-editing, not a bricked mode" | Touch cannot delete; plain Backspace unmapped | **False as built** |
| Kid-legible self-documenting controls | "Play" that doesn't play; digits that read as fingering; the word "Rest" instead of the symbol | **Missed** |
| SVG-only icon directive (household, 2026-07) | `♩.` `↶` `↷` `☰` `ⓘ` Unicode glyphs | **Violated** |

What *does* conform, credit where due: the blank-staff-first landing with no gallery gate and no junk drafts (Composer.jsx's draft-materialization dance is careful and correct), the model's auto-appending measures, delete semantics in the model, autosave with flush-on-exit, and thorough structured logging throughout. The plumbing is real. The product on top of it is not.

---

## C-bis. Bug found during remediation, NOT in the original audit — the staff blanks whenever a kid fills a bar

**Status: confirmed in currently-shipped code, root cause isolated 2026-07-18. Fixed as part of Task 5.**

Filling a bar exactly blanks the staff. `insertNote`'s exact-fill branch calls `ensureMeasure` (`model/editor.js:119-123`), so the note that completes a 4/4 bar immediately creates an **empty trailing measure** — verified: the model goes to 2 measures with note counts `[4, 0]`, and `serializeFromEditor` emits a literal `<measure number="2"></measure>`.

The failure is **not** in engraving, which is why it is easy to misdiagnose. Measured against real OSMD 2.0:

| Path | Empty trailing measure | With a display rest |
|---|---|---|
| `osmd.load()` + `render()` | **succeeds**, paints 2 bars, no error | succeeds |
| Geometry-extraction **cursor walk** | **throws** `Cannot read properties of undefined (reading 'StaffEntries')` after 3 steps | walks 5 steps clean |

So the sheet paints, then the cursor walk that extracts note geometry throws, `MusicXmlRenderer` catches it and sets `failed`, and `failed` both hides the host and **stops rendering its children** — taking the staff, the caret, and any overlay with it.

Today this presents as a *flicker*: the old engrave-per-keypress behavior re-serialized on the next keystroke, by which point bar 2 held a note and extraction succeeded. It self-healed so fast it read as jank rather than a bug — which is likely why it survived the original audit. Under the two-plane split it would have persisted for a **whole bar**, so the architecture change surfaced a defect that was always there.

**Fix:** `serializeForDisplay` now gives *every* note-less measure a display rest, generalizing the blank-draft fallback that already existed for bar 1. Render-only; never serialized to storage.

**Lesson worth keeping:** a minimal repro of `load()`+`render()` shows no problem at all and would have "disproven" this. The bug lives in the extraction cursor walk. When `MusicXmlRenderer` blanks, suspect extraction before engraving.

---

## D. Remediation priorities

**P0 — the instrument must feel like an instrument**
1. PendingLayer wet ink + engrave-on-measure-exit/idle (A1/A2, per spec §2.1).
2. Double-buffered engrave swap — no blank flash, ever (A1).
3. Caret on the blank staff via synthetic geometry + one line of empty-state copy (A3).
4. Run the spec's P0 aged-page gate and record the numbers.

**P1 — complete the basic edit loop**
5. ⌫ delete in the palette; map `Backspace` (A5).
6. Real ▶ Play transport; arm toggle relabeled **Write ●** (A4).
7. Blank sheet displays 4–8 render-only rest bars as real manuscript paper (A6).

**P2 — give the score the screen**
8. Scale engraving up; size paper to content; fold ComposerBar into top chrome (A7, B3).
9. Keycap-style numpad badges, or hide when no pad attached (A8).
10. Title affordance in the editor (A9).

**P3 — one visual language**
11. SVG icon set across the mode: rest glyph, dot glyph, undo/redo, songs, info (B1).
12. Distinct silhouettes for mode vs action vs toggle (B2); touch targets ≥ 48px; legible disabled states (B4).

---

*Related: `2026-06-22-piano-kiosk-design-ux-sins-audit.md` (kiosk-wide design tells), `2026-07-13-sheetmusic-mode-audit.md`, spec at `docs/reference/piano/composer.md`.*
