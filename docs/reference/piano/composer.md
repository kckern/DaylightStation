# Composer — technical spec

A kid-friendly notation/songwriting editor mode for the piano kiosk: a
simplified Sibelius/Finale driven by the piano's MIDI (pitch) + a compact
Bluetooth numpad (rhythm/navigation, Sibelius sticky-duration paradigm) +
sparing touch. Lives at
`frontend/src/modules/Piano/PianoKiosk/modes/Composer/` (placeholder today;
menu entry already registered in `PianoMenu.jsx` under id `composer`).
Distinct from the **Composers** educational-reference mode.

Provenance: requirements gathered 2026-07-17
(`docs/_wip/plans/2026-07-17-composer-requirements.md` — UX benchmark +
engine research), spec revised same day after an adversarial design review
whose confirmed findings are folded in throughout (data-fidelity round-trip,
aged-page latency protocol, entry disarm state, persistence hardening).

---

## 1. Scope

**v1 (ships first): single-staff melody.** The document model and the
MusicXML round-trip are grand-staff-, chord-, and lyric-capable from day one;
the v1 UX exposes single-line entry. Later tiers (config-gated): melody +
chord symbols (lead sheet), two-hand grand staff, lyrics entry.

v1 **editable floor** — full CRUD through the tactile surface:

- Durations whole→16th, augmentation dot, rests, ties
- Triplets (8th-triplet; sticky modifier)
- Key signature, time signature, clef, tempo
- Dynamics + articulations — via the tier-2 NoteCard's **tap palettes**
  (touch-sanctioned context; no text input involved)

**Schema floor ≥ editable floor.** Lyrics, chords, multi-staff exist in the
model, serializer, **and parser** from day one so that loading a richer file
and editing one note never destroys elements the UI can't yet edit
(see §4 — the data-loss invariant). Lyric *entry* is a later tier: it needs
the soft-keyboard story, which v1 confines to titles/tags (§9.3).

Non-goals for v1: multiple voices per staff, enharmonic respelling UI,
cross-staff beaming, range (multi-note) selection, instrument voices beyond
the default piano. Print/audio artifacts are **Later** (named, not dropped —
§14): a kid's work deserves a life outside the kiosk screen.

## 2. Architecture overview

```
                    ┌───────────────────────────────────────────┐
 BT numpad (HID) ──▶│ input command layer (useComposerInput)    │
 MIDI (noteStore) ─▶│  keymap → EditorCommand dispatch          │
                    └──────────────┬────────────────────────────┘
                                   ▼
                    ┌───────────────────────────────────────────┐
                    │ EditorState (pure, tested)                │
                    │  score model · caret · selection · armed  │
                    │  sticky duration · undo/redo history      │
                    └───────┬───────────────────────┬───────────┘
                    each    ▼ commit                ▼ autosave (validated)
              ┌─────────────────────────┐   backend /piano/users/:id/
              │ PendingLayer (instant)  │      compositions API
              │ SvgStaffRenderer notes  │
              └───────────┬─────────────┘
        idle / bar-exit   ▼
              serializeMusicXml(score)
                          ▼
              MusicXmlRenderer (OSMD) ──onLayout──▶ overlays re-bind:
                                                    caret · selection ·
                                                    beat grid · hit-test
```

The engine decision (from the research): **no open-source library provides an
editable notation surface** — OSMD/Verovio are render-only. Composer owns a
document model and drives the existing OSMD path. MusicXML is simultaneously
the save format and OSMD's input format, so the serializer serves both.

### 2.1 Rendering: dual-path by default, gated honestly

OSMD has no incremental-edit API: every structural change is
`serializeMusicXml` → `load(xml)` → full re-engrave, and `osmdEngrave` clears
the host (`innerHTML = ''`), destroying every live `note.el` reference. The
repo's own `performance.md` documents the kiosk reality: pages decay from
60 fps toward ~10 as they age, the OS episodically clamps the WebView to
4–8 fps, and **BLE-MIDI input is not "user activity"** to Android — playing
the piano does not lift the throttle. A fresh-page benchmark is therefore not
evidence. Design accordingly:

- **PendingLayer is the entry feedback path (default design, not a
  contingency).** Uncommitted/just-committed notes in the caret's measure
  paint instantly via the existing hand-rolled `SvgStaffRenderer` — styled as
  visibly "wet ink" (the mode's accent blue, slightly bolder) so the
  preview→engraved handoff reads as the note *drying* into the score, not as
  two renderers disagreeing. "Press a key → see the note" never waits on
  OSMD.
- **OSMD engraves on measure-exit / ~600 ms idle**, replacing the wet-ink
  notes with engraved ones. During a continuous run of entry the kid sees
  wet-ink notes accumulate in the current bar; the settled score is always
  ≤ one bar behind.
- **Overlay identity is model-anchored.** Caret, selection, and hit-test
  boxes key off `{measureIdx, noteIdx}`, never off retained DOM nodes. After
  each engrave's geometry extraction completes, overlays re-resolve their
  screen positions from the fresh layout (`steps[].notes[]`); until then the
  caret rides the PendingLayer's own synthetic geometry (last engraved x +
  accumulated pending widths). Selection survives engraves by definition.
- **P0 gate — measured honestly (§14):** on a **> 30-minute-old page** under
  the documented throttle, at continuous-entry cadence, the gate metric is
  *felt feedback* — pending note visible < 100 ms after keypress, engraved
  settle < 1 s after idle. The `pbctl kiosk` beat probe is the instrument.
  If the aged-page engrave is catastrophic (> ~2 s), the fallback is
  coarser engrave cadence (engrave on line-exit or explicit pause), not a
  different architecture.

### 2.2 Reused machinery (verified in-repo, with the adaptation honestly priced)

| Need | Existing asset | Adaptation required |
|---|---|---|
| Engrave MusicXML | `MusicNotation/renderers/MusicXmlRenderer.jsx` + `osmdRender.js` (OSMD 2.0) | none |
| Per-notehead boxes + SVG els | `osmdRender.js` layout extraction (`steps[].notes[]`) | re-resolve after every engrave (§2.1) |
| Caret overlay pattern | `SheetMusic/ScorePlayer.jsx` cursor-band overlay | + synthetic pending-geometry mode |
| Selection recolor | `SheetMusic/NoteHighlightLayer.jsx` | model-anchored re-binding |
| Instant preview staff | `MusicNotation/renderers/SvgStaffRenderer.jsx` | extend: durations/rests/dots layout in a measure |
| MIDI note-on loop | pattern in `SheetMusic/useFollowTracker.js` | new consumer |
| Pitch/staff/key math | `MusicNotation/model/` | none |
| Count-in, click, transport | `SheetMusic/` `countIn.js`, `clickScheduler.js`, `useScoreTransport.js` | **promote to shared** (below) |
| Playback timeline | `SheetMusic/playParts.js` `buildPlayTimeline` | **adapter required**: it consumes the OSMD geometry extract, not a model — see §10 |

**Reuse discipline:** SheetMusic-local pieces Composer needs (count-in, click
scheduler, transport) get **promoted to a shared location** (e.g.
`PianoKiosk/score/`) and imported by both modes — never fork-copied. Each
promotion moves the file + colocated test and updates SheetMusic's imports.

## 3. Document model (`modes/Composer/model/`)

Matches the **extended** parser's output shape (§4), so parse and serialize
are true inverses:

```js
Score {
  title, composerName, tempo,
  timeSig: { beats, beatType }, key: { fifths, mode },
  clef: { sign, line }, divisions,
  parts: [ Part { id, staves,
    measures: [ Measure {
      number,
      attributes?,                       // key/time/clef changes AT this bar
      notes: [ Note {
        rest: bool,
        pitch?: { step, octave, alter }, midi?,
        duration, type, dots,
        tie?: 'start'|'stop'|'both',
        tuplet?: { actual, normal },
        chord: bool, staff, voice,
        lyric?, dynamics?, articulations?: []
      } ] } ] } ] }
```

`EditorState` — pure JS, no React, fully unit-tested:

```js
EditorState {
  score,
  caret: { measureIdx, noteIdx },        // insertion point (insert-only; no
                                         // overwrite mode — replace = select+play)
  selection: { measureIdx, noteIdx } | null,
  armed: bool,                           // MIDI-entry live? (§5.2)
  stickyDuration: { type, dots, triplet },
  dirty: bool, revision: int
}
```

Mutations go through **EditorCommands** (`commands.js`): `insertNote`,
`insertRest`, `replacePitch`, `nudgePitch`, `setDuration`, `toggleDot`,
`toggleTriplet`, `toggleTie`, `deleteNote`, `setAttribute`
(key/time/clef/tempo), `setDynamic`, `setArticulation`, `applyTake`, caret
moves. Each returns a new state (immutable update).

**Undo/redo:** bounded ring of full score snapshots (cap ~200) — kid-scale
scores are small; snapshots beat command inversion for correctness. Caret
moves don't push history; every score mutation does. `applyTake` is one
entry (a take undoes atomically).

**Auto-barring — duration is intent; never silently rewrite it.** New
measures appear on demand; the score always ends with one open measure. A
note longer than the space left in the bar **splits and ties across the
barline** — always. (The earlier clamp-below-threshold rule is dropped: it
silently shortened what the kid asked for, and clamping to "space remaining"
can produce durations like 3.5 beats that the floor can't even notate.) The
split itself decomposes each side into expressible values (e.g. 3.5 beats →
dotted-half tied to eighth) via a `decomposeDuration` helper — also used by
the quantizer (§7).

## 4. MusicXML round-trip — TWO modules, one invariant

**The data-loss invariant (the canonical test of this whole design):**
*load any supported song → edit one note → autosave → reload: every element
survives.* Everything below serves that.

1. **`serializeMusicXml(score)`** — new; pure string-building (it's on the
   engrave hot path). Emits `score-partwise`: header, `part-list`,
   per-measure `attributes` (`divisions`/`key`/`time`/`clef`), per-note
   `pitch|rest`, `duration`, `type`, `dot`, `accidental`, `tie` +
   `notations/tied`, `time-modification` + tuplet notations, `lyric`,
   `dynamics`/`articulations`, `direction/sound tempo`; `backup` + `staff`
   and `<chord/>` for the later tiers — in the schema and tests from day one.
2. **`parseMusicXml` extension** — equally real work, named and budgeted
   (P1). The current parser stops at the ~80% display floor: it emits **no
   tie, tuplet, lyric, dynamics, or articulations**, and folds key/time
   changes into score-level last-wins fields. Composer requires
   full-fidelity parse of the schema floor plus faithful per-measure
   `attributes`. Extend the shared parser (SheetMusic benefits too — ties
   currently render but don't reach its model); round-trip tests pin the
   inverse property both ways:
   `parse(serialize(model)) ≡ model` for generated models, and
   `serialize(parse(fixture))` re-parses equal for the `__fixtures__` corpus.

Both live in `MusicNotation/` beside each other, exported via `index.js`.

**Save validation gate:** autosave never writes XML the app can't read back.
Before `PUT`, the client re-parses its own serialized output (cheap, pure);
a parse failure blocks the save, keeps the last-good payload, and raises a
visible error state — not a log line. The backend independently re-validates
on write. OSMD veto (engrave failure of valid-parsing XML) keeps the last
successful engrave on screen with a retry banner; it never blanks the score
and never blocks the (parse-validated) save.

## 5. Input command layer (`useComposerInput.js`)

Two sources, one dispatcher:

- **Numpad** — pairs as an HID keyboard; keys arrive as `keydown` in the FKB
  WebView. Map by **`event.code`** (`Numpad1`, `NumpadAdd`, …), never
  `event.key`; **NumLock must be ON** (off flips numpad codes to nav codes).
  The mode detects nav-codes-where-digits-expected and shows a full-screen
  "press the ⇭ key" prompt (a kid-legible picture of the pad, not the word
  "NumLock"). P0 verifies keycode delivery *and* the three iconed keys'
  actual codes in the FKB WebView before stickers are printed (§14).
- **MIDI** — note-on subscription via the existing kiosk pipeline (same
  pattern as `useFollowTracker`).

### 5.1 Key map (sticker map v1 — final pass against the physical device in P0)

Durations on the 3×3 with **quarter dead-center**, shorter below, longer
above:

| Key (code) | Entry context | Selection context |
|---|---|---|
| `Numpad1` | 16th (sticky) | relength → 16th |
| `Numpad2` | triplet toggle (sticky, HUD-lit) | same |
| `Numpad3` | 8th (sticky) | relength → 8th |
| `Numpad4` | **ARM / DISARM** MIDI entry (§5.2) | same |
| `Numpad5` | **quarter** (sticky, default) | relength → quarter |
| `Numpad6` | — (blank sticker; reserved: lead-sheet chords) | — |
| `Numpad7` | half (sticky) | relength → half |
| `Numpad8` | — (blank sticker; reserved) | — |
| `Numpad9` | whole (sticky) | relength → whole |
| `Numpad0` | **rest** at sticky duration | toggle selected ↔ rest |
| `NumpadDecimal` | dot toggle (sticky) | toggle dot |
| `NumpadAdd` | **tie** to previous | toggle tie |
| `NumpadSubtract` | delete last note, step back | — |
| `NumpadEnter` | play/pause from caret | same |
| `NumpadDivide` / `NumpadMultiply` | accidental ♯ / ♮ (♭ via MODE) | respell selected |
| `ArrowLeft/Right` | caret ↔ selection walk | move selection |
| `ArrowUp/Down` | — | nudge pitch ±step (MODE: ±octave) |
| `Home` / `End` | caret to bar start / end | same |
| `PageUp` / `PageDown` | previous / next bar | same |
| `Delete` | delete at caret | delete selected |
| `Insert` | — (blank; no overwrite mode in v1) | — |
| iconed key 1 | **MODE** (held modifier: octave, ♭, redo) | same |
| iconed key 2 | **focus editor** open/close | same |
| iconed key 3 | **undo** (MODE+: redo) | same |

Dropped from the earlier draft, deliberately: the **insert/overwrite mode**
(insert-only; "overwrite" = select + play — one fewer invisible state) and
the **replay-a-pitch-to-delete toggle** (it made *confirming* a note by ear
and *destroying* it the same gesture; deletion is `Delete`/`−` only).

**All sticky/invisible state is always visible** in the `StickyDurationHud`:
duration glyph, dot, triplet, ♯/♭ latch, ARMED/disarmed, record-armed. If it
isn't on the HUD, it isn't a state the design may have.

### 5.2 Armed / disarmed — the piano is not always a weapon

`Numpad4` (large, labeled sticker) toggles whether MIDI writes:

- **Armed** (HUD badge, mode-accent blue): entry context — note-on commits
  at sticky duration and advances; selection context — note-on **replaces**
  the selected note's pitch.
- **Disarmed**: MIDI is **audition-only** everywhere — the piano just
  sounds. Kids find notes by ear; hunting must never edit. Numpad
  navigation/duration keys still work.
- Auto-disarm on: entering the gallery, opening focus editor's NoteCard
  (audition there commits via an explicit ✓ tap), playback start, and
  record-take pipeline transitions. Opening a song lands **disarmed** — the
  first act in a session is looking, not writing.

This is the mode's Esc: one press returns the piano to a safe state, and the
HUD always shows which world you're in.

### 5.3 Numpad resilience

BT numpads sleep; a swallowed wake-keypress in a sticky-duration model would
silently mis-length subsequent notes. Mitigations: the HUD *is* the truth
(the kid can always see the active duration before playing); a
`numpad-last-seen` heartbeat dims the HUD's numpad indicator after ~60 s of
key silence (visual "give it a poke" affordance); all duration/nav functions
are reachable by touch in the focus editor, so a dead pad degrades to
touch-editing, not a bricked mode. Battery/pairing surfaced on the existing
kiosk diagnostics page, not in the kid UI.

## 6. Editing tiers

**Tier 1 — inline quick-edit** (no mode switch): `←/→` walks
caret/selection (selection = model-anchored recolor). Armed MIDI replaces
pitch; duration keys relength; dot/tie/rest/`Delete` as mapped. Tap a
notehead (hit-test against current layout boxes) = select. Covers ~90% of
fixes.

**Tier 2 — focus editor** (`FocusBar.jsx` → `NoteCard.jsx`; iconed key 2 or
tap-selected-again; **touch is welcome here**):

- **Bar level:** the selected measure engraved big (one-measure excerpt
  through the same serializer→renderer path), per-beat grid, oversized tap
  targets, bar tools: retime, triplet grouping, insert/remove beats,
  (grand-staff tier) move note to other staff. Record cleanup lands here,
  with the raw-take strip (§7).
- **Note level:** tap a note → property card: pitch (steppers or
  audition-then-✓ commit), duration/dot/triplet, tie, accidental spelling,
  **dynamics and articulation tap-palettes** (picker chips — the v1 path for
  expressive marks), lyric field (later tier). Back out one level at a time.

All focus-editor mutations are the same EditorCommands — one undo stack.

## 7. Record-a-take (`useRecordTake.js`)

Bounded and honest about what it is — and it never discards the performance:

1. Arm from the caret's bar; take length = `take_bars` (config, default 4).
2. Count-in (shared machinery) → metronome at song tempo (shared click).
3. Note-ons/offs captured with beat-clock timestamps. **The raw capture is
   retained** on the song (`takes[]`, capped at the last N) — quantization
   is a *view* of the take, not a replacement for it.
4. Onsets snap to `quantize_grid` (default `1/8`); durations from snapped
   onset→release via `decomposeDuration`, minimum one grid unit; gaps become
   rests; same-slot simultaneities collapse to the highest-velocity note
   (v1 melody).
5. `applyTake` writes the bars (one undo entry) → focus editor opens on the
   first take bar with a **raw-take strip**: ▶ *what I played* vs ▶ *what it
   wrote*, plus **re-snap at a different grid** and **revert bars** — the
   cleanup tools acknowledge the transcription is a guess.

Hand-split (grand-staff tier): single split-pitch rule, applied after
snapping, fixed in the focus editor — never negotiated mid-capture.

## 8. Persistence — backend-only, built to survive children

Frontend never writes files. Mirrors the studio CRUD in
`backend/src/4_api/v1/routers/piano.mjs` and the per-user store pattern
(`UserVideoProgressStore`, `YamlPianoStudioDatastore`):

```
GET    /api/v1/piano/users/:userId/compositions          → [{ id, title, tags, updatedAt, bars }]
GET    /api/v1/piano/users/:userId/compositions/:id      → { meta, musicxml }
POST   /api/v1/piano/users/:userId/compositions          → create → { id }
PUT    /api/v1/piano/users/:userId/compositions/:id      → save { musicxml, meta, revision }
DELETE /api/v1/piano/users/:userId/compositions/:id      → author + confirm gated
GET    /api/v1/piano/compositions/shared                 → view-only, share-tagged, across users
```

- **Store:** `ComposerSongStore` in `backend/src/3_applications/piano/`
  (ConfigService `getUserDir`), under
  `data/users/{userId}/apps/piano/composer/`:
  - `{id}.musicxml` — the score. `{id}.meta.yml` — **truth** for title,
    tags, share flag, revision, timestamps. (Meta is NOT derivable from
    MusicXML — the earlier "rebuildable index" claim was wrong for exactly
    the fields that matter.)
  - `index.yml` — a genuine cache now: derived purely from the `.meta.yml`
    files, rebuilt by the store on boot and after every write.
  - `{id}.versions/` — the **last-good ring**: every accepted save rotates
    the prior `.musicxml` in (keep `versions_keep`, default 5). Recovery is
    a store/API concern (admin + "restore" in the gallery's long-press
    menu), invisible to the child until needed.
- **Autosave:** client debounce (~3 s idle, 30 s max while dirty) + flush on
  mode exit/blur and on **kid-switch** (switching the active kid flushes,
  closes the editor, and re-scopes the gallery — no cross-kid dirty state).
  Saves pass the §4 validation gate before writing. `revision` mismatch
  (stale client): the write is **rejected**, the client reloads and replays
  the kid's dirty delta on top where trivially safe, else surfaces "someone
  else changed this song" — never silent last-write-wins on creative work.
- **Delete:** only the authoring kid's active session sees delete, and it's
  hold-to-confirm (the fitness lockdown pattern). Shared view is read-only.
- **Sharing:** `share_tag` (config, default `family`) in meta floats a song
  into the shared endpoint. Remix-by-duplicate: later affordance.

## 9. Mode UI composition

```
Composer.jsx                 mode root: gallery ⇄ editor switch, breadcrumb
├─ Gallery.jsx               per-kid shelf: tiles (recency), tag chips,
│                            shared section, New Song, long-press → restore
├─ NewSongSetup.jsx          quick setup (key/time/clef/tempo/title) with a
│                            prominent "Skip → 4/4 · C · treble · 100bpm"
├─ EditorSurface.jsx         MusicXmlRenderer + overlay stack
│  ├─ PendingLayer.jsx       wet-ink instant notes (SvgStaffRenderer-based)
│  ├─ CaretLayer.jsx         big caret + per-beat grid (engraved OR synthetic
│  │                         pending geometry — §2.1)
│  ├─ SelectionLayer.jsx     model-anchored recolor + tap hit-testing
│  └─ StickyDurationHud.jsx  ALL sticky state: duration·dot·triplet·accidental
│                            ·ARMED·record — plus numpad-alive indicator
├─ ComposerBar.jsx           pinned bottom bar, SheetMusic three-zone grammar:
│                            [gallery/back] · [play/pause · record-arm · position]
│                            · [song settings · focus editor · undo/redo]
├─ FocusBar.jsx / NoteCard.jsx   tier-2 editor (touch-friendly)
└─ useRecordTake.js / useComposerInput.js / useAutosave.js
```

Chrome follows the kiosk grammar: `PianoChrome` breadcrumb, shared
inline-SVG icons only, **blue = setting on** (armed, record-armed), **green =
transport running**, ≥48 px targets, controls disable-in-place. Engraving is
**plain** — big caret + beat grid, wet-ink accent for pending notes, no
letter-noteheads, no pitch colors.

### 9.1 First-run & empty states

- **Empty gallery** ships with one seeded demo song ("Twinkle" — openable,
  editable, deletable) so the first tap lands on something real, not a void.
- **First editor open** (per kid, once): a three-beat coach overlay teaching
  the one unusual idea — *"the numpad picks HOW LONG"* (duration keys pulse)
  → *"the piano picks WHICH NOTE"* (play anything; it enters wet-ink) →
  *"arrows walk, this key makes it safe"* (Numpad4/ARM shown). Dismiss by
  doing, not by reading.
- **Entry echo** (`entry_echo` config): **off by default on the kiosk** —
  the piano itself already sounds acoustically; double-sounding is specced
  away, and the echo exists only for silent/headphone setups.

### 9.2 Two kids, one bench

The active-kid picker (existing `/api/v1/piano/users` list) scopes shelf and
saves. Switching kids: flush + close editor (§8). A song open in the editor
is locked to the session that opened it; the shared section never exposes
edit affordances. There is no auth — this is a household instrument — but
every destructive action is author-scoped + confirm-gated, and the versions
ring (§8) is the backstop for sibling mischief.

### 9.3 Text input (the soft-keyboard boundary)

Free text exists in exactly two v1 places — **song title** (setup wizard /
song settings) and **tag names** (gallery chip editor) — both rare,
deliberate, touch contexts where the Android soft keyboard in the FKB
WebView is acceptable. P0 verifies the soft keyboard actually presents and
commits in this WebView. Nothing in the entry loop ever requires text; lyric
entry stays a later tier until it has a real input design.

## 10. Playback

Playback is **model-driven**: a new `buildTimelineFromModel(score)` adapter
produces the timeline directly from the document model (the existing
`buildPlayTimeline` in `playParts.js` consumes the OSMD *geometry extract*
and would couple play-start to engrave/extraction completion — wrong for an
editor). Output scheduling reuses the shared transport + voice bridge as in
Listen mode. Follow-cursor consumes layout geometry when available and
degrades to measure-highlight while an engrave is settling. v1 transport:
play/pause from caret (`NumpadEnter`), play-from-top (`Home Home`).
Loop-a-selection: post-v1 via SheetMusic's loop machinery.

## 11. Config (`piano.yml` → `composer:`)

```yaml
composer:
  take_bars: 4                 # record take length
  take_history: 3              # raw takes retained per song
  quantize_grid: eighth        # record snap grid (re-snap offered in cleanup)
  autosave_idle_ms: 3000
  versions_keep: 5             # last-good ring depth
  share_tag: family
  entry_echo: false            # kiosk piano already sounds; echo for silent rigs
  defaults: { time: 4/4, key: C, clef: treble, tempo: 100 }
  ceiling: melody              # melody | leadsheet | grand  (feature gate)
```

## 12. Logging

Child logger `piano-composer` (framework rules; no raw console):
`composer.mounted`, `composer.song.{created,opened,saved,save-rejected,
save-invalid-xml,deleted,restored}`, `composer.entry.note` (debug, sampled),
`composer.edit.command` (debug), `composer.armed`/`composer.disarmed`,
`composer.take.{armed,captured,applied,resnap,reverted}`,
`composer.focus.{opened,closed}`, `composer.undo/redo` (debug),
`composer.numlock.warning`, `composer.numpad.stale` (warn),
`composer.render.{pending-ms,engrave-ms}` (sampled — live telemetry behind
§2.1's felt-feedback budget), `composer.engrave.failed` (error — the OSMD
veto path).

## 13. Testing

- **Unit (vitest, colocated):** EditorCommands (insert/split-tie/delete/
  tie/triplet), `decomposeDuration` (incl. the 3.5-beat class), undo ring,
  quantizer (snap, rest fill, min duration, collapse), keymap dispatch per
  context incl. armed/disarmed, autosave debounce + validation gate.
- **Round-trip (the spine):** generated-model ≡ and fixture re-parse ≡ across
  the FULL schema floor (tie/tuplet/lyric/dynamics/articulations/attributes).
  **Canonical data-loss test:** load fixture-with-everything → edit one note
  → autosave payload → reload → deep-equal minus the edit.
- **API:** `piano.compositions.test.mjs` — CRUD, revision-conflict
  rejection, versions ring rotation + restore, shared-tag filtering, index
  rebuild from meta files.
- **Flow (Playwright):** gallery → new song (skip) → step-enter a bar
  (pending → engraved) → arrow-select → repitch (armed) → audition
  (disarmed, no edit) → autosave → reload → survives. MIDI via the
  `modes/apiShim.mjs` pattern.
- On-kiosk verification on the tablet remains a release gate.

## 14. Build order

| Phase | Deliverable | Gate |
|---|---|---|
| **P0** *(pending)* | Kiosk reality harness: aged-page (>30 min, throttled) engrave timings at entry cadence via the beat probe; numpad keycodes + the 3 iconed keys' codes in the FKB WebView; soft-keyboard presents/commits | Felt-feedback budget met (pending <100 ms, settle <1 s) → §2.1 cadence confirmed; iconed-key codes known **before sticker printing** |
| **P1** ✅ **DONE** (2026-07-17) | Model + EditorCommands + undo + `serializeMusicXml` + **`parseMusicXml` full-fidelity extension** — round-trip suite incl. the canonical data-loss test | all round-trips green ✅ (`feature/composer-core`; only the 4 pre-existing `chordStaff.test.js` VexFlow/jsdom failures remain, unrelated to the pure core) |
| **P2** | EditorSurface: PendingLayer + engrave loop, caret, sticky entry, auto-bar(split-tie), armed/disarmed; backend store (meta truth, versions ring, validation gate) + autosave; minimal gallery | enter + reload a melody end-to-end, data-loss test green against the live API |
| **P3** | Tier-1 editing, model-driven playback (`buildTimelineFromModel`) | |
| **P4** | Focus editor (bar → NoteCard incl. dynamics/articulation palettes) + song settings + first-run coach | |
| **P5** | Record-a-take: capture, snap, raw-take strip, re-snap/revert | |
| **P6** | Gallery polish: tags (soft-keyboard), shared section, kid picker flows, restore UI, seeded demo | on-kiosk gate |
| Later | Lyrics entry (input design first), auto-advance-off chords, repitch mode, lead sheet (keys 6/8), grand staff (split-pitch), remix-duplicate, loop-selection, **holdable artifacts** — PDF via the backend's existing SVG→PDF rendering layer (`backend/src/1_rendering/`, svg-to-pdfkit — never rasterize) and an audio bounce | per `ceiling` gate |

## 15. Open items

- Sticker layout final pass once P0 pins the physical pad's iconed keys.
- `SvgStaffRenderer` extension scope for PendingLayer (durations/dots/rests
  in-measure) — sized in P0/P1 boundary.
- Raw-take strip playback UX (two-lane compare) — design during P5.
- Lyric entry input design (the gating question for the lyrics tier).

### Known limitations (v1)

Arbitrary external MusicXML import is **not** a v1 flow — the gallery only ever
holds Composer-created files, and the save/reload data-loss invariant is proven
against that self-produced content. If an arbitrary external score were ever
loaded and saved, these paths would silently corrupt (the parser reads them into
the model, but the serializer cannot faithfully reproduce them): notes finer than
a 16th (32nd and below), typeless whole-measure rests, grace notes, and rehearsal
marks / practice `<sections>` (parsed but not re-serialized). These are acceptable
in v1 precisely because it never imports. If library import is ever added (a later
tier), each of these needs a round-trip test or a loud guard before it ships —
never a silent best-effort save.
