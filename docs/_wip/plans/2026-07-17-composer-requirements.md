# Composer mode — requirements gathering (WIP notes)

> **Status: superseded by the committed spec** — see
> `docs/reference/piano/composer.md` (written 2026-07-17 from these
> requirements). This file remains as background: the raw decisions and the
> research passes (UX benchmark + engine evaluation) behind the spec.
>
> Date: 2026-07-17. Distinct from the **Composers** mode (great-composers reference).

---

## 1. What it is

A tactile, kid-friendly music-notation / songwriting editor at the piano — a
simplified Sibelius/Finale for children. Runs as a mode on the shared **piano
kiosk** (the yellow-room FKB tablet + MIDI piano).

**Inputs, in priority order:**
1. **MIDI keyboard** — pitch.
2. **Compact Bluetooth numpad** — rhythm / note-length / navigation, with custom
   printed stickers (Sibelius paradigm: numpad key = duration, MIDI = pitch).
   Hardware: ~21-key numpad block + 4 arrow keys + a 6–9 key Ins/Home/PgUp/Del/
   End/PgDn cluster + 3 iconed keys. Generous key budget — no need to overload
   nav onto modes.
3. **Touchscreen** — used sparingly. **Tactile input is preferred in all cases**;
   touch is only welcome in the deliberate, slow focus-editor context (§5).

---

## 2. Scope & growth ceiling

- Configurable ceiling — **all** of these must be reachable eventually:
  single-line melody → melody+chords (lead sheet) → two-hand grand-staff piano.
- **Single-staff melody ships first.** The data model must be grand-staff- and
  chord-capable from day one even though v1 UX only exposes single-line entry.
- **Save format: MusicXML** (also the interchange format — opens in
  MuseScore/Finale/Sibelius/Noteflight).

## 3. v1 notation floor (single-line melody)

All in scope for v1:
- Durations (whole→16th) + dot + rests + ties.
- Key signature, time signature, clef, tempo.
- Triplets / tuplets (clean in step-time; the mess is only in record mode).
- Lyrics, dynamics, articulations.
- **Full CRUD on every inputable element** (create/read/update/delete each
  note, rest, marking).

---

## 4. Making notes

**Step-time is primary.** Sibelius/Finale-Speedy model:
- The active duration is a **big, always-visible, sticky** state. Pick a duration
  key once; then just play pitches — each MIDI note commits at the current
  duration and the **cursor auto-advances**. Only re-touch a duration key when the
  length changes.
- Quarter anchored at numpad-center (home key); shorter below, longer above, so
  the key grid itself teaches relative duration.
- **0 = rest** at the current duration (rests are not a separate tool).
- **Replay a pitch already on the beat = delete it** (add and remove are one
  gesture).
- The **cursor is the critical through-line** for both entry and editing.

**Record is secondary** (real-time capture; flagged as "always a mess" in
practice):
- **N-bar take, configurable, default 4 bars.** Count-in → play to the metronome
  → notes snap to a **fixed config quantize grid (1/8 default)** → **auto-open the
  focus editor for cleanup**.
- Never capture raw millisecond timing; grid is chosen before playing. Hand-split
  (which staff) is a later grand-staff concern — one split pitch, "high notes up
  top, low notes down low," fixed afterward, never mid-capture.

**Auto-barring during entry:**
- Barlines and new bars appear automatically as you play.
- A note that overflows the current bar is resolved by a **configurable
  threshold**: small spillover **clamps** to fit (no ugly tiny tied remainder);
  large spillover **ties across** the barline (preserves the intended long note).

---

## 5. Editing — two tiers, cursor-driven, full CRUD

**Tier 1 — inline quick-edit** (on the score, tactile-only, no mode switch):
- **←/→** move the cursor to select a note (it highlights).
- Selected note: **play MIDI** = replace pitch · **↑/↓** = nudge pitch a step
  (MODE/modifier = octave) · **duration key** = relength · **dot/tie/rest** =
  toggle · **Del** or replay-same-pitch = remove.
- Covers ~90% of fixes without leaving the staff.

**Tier 2 — focus / "surgical" editor** (a dedicated key drills in; **touch
permitted here** — it's a slow, deliberate, one-thing context):
- **Bar first:** zoom to the selected measure, blown up big, selected note
  emphasized in context (needed for rhythm fixes, retiming, tuplets, record
  cleanup, and later moving notes between staves).
- **Tap a note → go deeper** to that note's property card (pitch, length, dot,
  tie, accidental, staff). Two nested levels; back out one at a time.

**Undo:** full **multi-level undo/redo** across everything — entries, edits,
deletes, record takes, focus-editor tweaks. (The one-key "delete last note and
step back" during entry is separate, on the numpad.) Implies a history/command
stack on the document model.

---

## 6. Songs, people, persistence

- **Per-kid gallery** — each kid has their own editable song shelf. An active-kid
  picker selects who's working.
- **Others' work is view-only**, surfaced into a separate gallery section when the
  author applies a **share tag**. (Remix-by-duplicate into your own shelf = a
  natural later affordance.)
- **Flat gallery, silent autosave** — no Save button, no folders. **Tags** do the
  organizing; group/filter by tag + recency.
- **New song:** quick setup (key / time / clef / tempo) with a prominent
  **skip → default 4/4 C major, treble, ~100bpm** escape. Never force the choices.
- **Persistence is backend-only.** Autosave and loads go through the backend API,
  which owns the per-user MusicXML files (`users/{id}/apps/piano/composer/`).
  No direct frontend file writes / no localStorage as the source of truth.
  (Silent autosave + an unsaved-work guard is the target UX.)

## 7. Playback

- **Reuse SheetMusic's playback primitives** (follow cursor / bouncing ball,
  count-in, tempo, transport) as **shared building blocks** — adapt, do **not**
  fork-and-copy. Routed through the existing piano **voice bridge**.
- Default instrument = piano via the voice bridge; other voices a later config.

## 8. Look / scaffolding

- **Big high-contrast caret + per-beat grid** in the current measure ("where am I"
  / "where does the beat fall").
- Otherwise **plain engraving — no gimmicks.** No letter-name noteheads, no chroma
  pitch colors. Some meta-structure help is fine; nothing cutesy.
- Follows the established **Piano-kiosk chrome grammar**: `PianoChrome` breadcrumb
  + a pinned bottom control bar, shared inline-SVG icons (no text glyphs/emoji),
  **blue = a setting is on**, **green = the transport is running**, ≥48px touch
  targets.

---

## 9. Reference notes (technical leaning — NOT committed)

### 9a. Editable-score engine — current leaning
No open-source library edits notation for you (OSMD and Verovio are render-only).
An editor **owns a document model and drives a renderer**. Leaning, grounded in a
first-hand read of `frontend/src/modules/MusicNotation/`:

- **Own a note-document model → serialize to MusicXML → render via the existing
  OSMD path (`renderers/MusicXmlRenderer.jsx` / `renderers/osmdRender.js`), with
  our own SVG caret/selection overlay.**
- Why: **MusicXML is both the save format and OSMD's input format**, so one
  serializer serves render + save (vs a serializer *plus* a converter hop for any
  other renderer). And the hard machinery already exists in SheetMusic mode:
  - per-notehead SVG element access (`osmd...getSVGGElement()` in `osmdRender.js`),
  - per-notehead screen boxes + a caret overlay (drawn today in
    `SheetMusic/ScorePlayer.jsx`),
  - notehead recolor without re-render (`SheetMusic/NoteHighlightLayer.jsx`) →
    reuse for selection highlight + tap hit-testing,
  - MIDI-input step loop (`SheetMusic/useFollowTracker.js`).
- **The one genuinely-new module: a `serializeMusicXml(model)` — the exact inverse
  of `parseMusicXml.js`** (same Score model: `parts → measures → notes{pitch,
  duration, type, dots, tie, staff, chord…}`). None exists in the repo today.
- **Weak spot:** OSMD has no incremental-edit API — every structural change is
  serialize → `load(xml)` → full re-engrave. Mitigate with **render-on-commit
  (not per-keystroke) + debounce**; the kid's own caret moves instantly meanwhile.
- **Instant-preview fallback already in-repo** if the tablet needs it (dual-path):
  `renderers/SvgStaffRenderer.jsx` (hand-rolled, instant) and
  `renderers/AbcRenderer.jsx` (abcjs; `collectStaffNotes` already maps note→SVG
  el→MIDI, and `renderers/abc.js` already generates notation from a model). Draw
  the in-progress note instantly on one of these; OSMD engraves on commit.
- abcjs as the *authoritative* engine is rejected: ABC can't cleanly express the
  full v1 floor (lyrics/dynamics/tuplets) and needs an ABC↔MusicXML converter on
  the save hot path.

**Biggest risk, de-risk day 1 before writing model code:** time a full OSMD
re-engrave of a 4/8/16-measure single-staff score **on the actual SM-T590 tablet**.
Under ~120ms at commit cadence → ship the simple path; over → promote the
dual-path. One measurement gates the architecture.

### 9b. `MusicNotation/` — existing assets to reuse
- `Notation.jsx` — "one model, four renderers" facade (`chord`/`abc`/`svg`/
  `musicxml`).
- `parseMusicXml.js` — MusicXML → renderer-agnostic Score model (mirror its shape;
  the serializer is its inverse). Import-only today.
- `model/` — `pitch.js` (`getStaffPosition`), `keySignature.js`, `handSplit.js`
  (`splitByHand` for later grand-staff), `drillTranspose.js`.
- `scoreTimeline.js` / `scaleTimeline` — timing/tempo for playback.

### 9c. Draft numpad sticker map (to refine)
Durations on the 3×3 with **quarter dead-center (key 5)**, short below / long
above. `0` = rest of current value; `.` = dot; `+`/Enter = tie; `−`/Backspace =
delete-last-and-step-back; NumLk = MODE (octave/settings); `/ * -` = accidental
up/nat/down. Dedicated nav cluster: **←/→** select prev/next, **↑/↓** pitch nudge,
**Home/End** = bar start/end, **PgUp/PgDn** = prev/next bar, **Del** = delete
selected, **Ins** = insert-vs-overwrite. A dedicated key opens the focus editor.

### 9d. Benchmark UX lessons (from tool research)
- **Sticky duration** (Sibelius/Flat/MuseScore) — the defining ergonomic; a kid
  usually answers only "which pitch."
- **0 = rest, one-key undo, toggle-to-delete** (Soundslice/MuseScore).
- **Auto-advance toggle** spans "type a melody" (on) vs "stack a chord" (off).
- **Repitch mode** (MuseScore) — lock rhythm, change only pitch ("play it again
  but higher"). Candidate later feature.
- **Silent autosave + unsaved-work guard, tags not folders** (Noteflight).
- **For record:** set the grid before playing; never post-hoc guess raw timing;
  hand-split = one split pitch. Kids-safe = bounded takes + fixed grid.
- **Omit for kids:** multiple voices per staff, enharmonic-spelling choices, free
  real-time capture with post-hoc quantize, cross-staff/beaming controls, file
  management/export dialogs, and any modal duration *palette* that hides the
  current sticky state.

---

## 10. Open / deferred

- Numpad sticker map: draft only (§9c) — refine against the physical device.
- Engine: leaning only (§9a) — gate on the day-1 tablet latency test.
- Auto-advance toggle, Repitch mode — noted, not yet decided for v1.
- Remix-by-duplicate of others' shared songs — later affordance.
- File-level export / print beyond the in-app family-share view — deferred;
  MusicXML-on-disk is the artifact.
- Instrument voices beyond piano default — later config.
