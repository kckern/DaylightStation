# Piano Producer — Architecture Reference

> **Status (2026-08-10):** Release candidate. The direct route is enabled, but
> the Piano home-menu tile remains intentionally disabled until the mounted
> schema/prefab writes and the physical SM-T590 audio/WebView check pass.
> **Design:** [`docs/_wip/plans/2026-07-01-piano-producer-overhaul-design.md`](../../_wip/plans/2026-07-01-piano-producer-overhaul-design.md)
> **Requirements:** [`docs/_wip/plans/2026-07-01-piano-producer-song-builder-requirements.md`](../../_wip/plans/2026-07-01-piano-producer-song-builder-requirements.md)
> **Delivery history:** [`docs/_wip/plans/2026-07-01-piano-producer-overhaul-STATUS.md`](../../_wip/plans/2026-07-01-piano-producer-overhaul-STATUS.md)
> This is the durable map. The design doc is the frozen intent; this describes
> what the code actually does. It is a sibling of [README.md](./README.md) (the
> whole-kiosk map) and [performance.md](./performance.md).

---

## 1. Overview

Producer is the Piano Kiosk's **jam-first, multi-instrument song builder**. It
replaced a single-section loop-jam mode with a touch-first DAW: pick a chord
loop, stack a bass voice and a groove on top, mix them live (gain / mute / solo
/ transpose / tap-tempo), record your own passes over the top, and — only if you
want to — promote what you're playing into named sections and arrange them into
a saveable song. Nobody faces a blank page unless they choose one; every
stage (jam, My Loops, song, saved song) is a valid final destination.

### The two-tree state model

State is deliberately split into two unequal trees:

- **`workspace`** — always exists, in-memory reducer, "what's live right now":
  the layers you're jamming, their channels/voices/gains/mute/solo, key shift,
  bpm, metronome. Every jam action mutates only this. There is no song, no
  title, no hidden "section 1 of 1".
  (`producer/workspaceReducer.js`)
- **`draft`** — starts `null`. It materializes the first time you promote a jam
  into a section (or load a saved/example song). It holds `sections`,
  `arrangement`, a shared `carriedLayers` continuity pool, and song-global
  `meta` (title/author/key/bpm).
  (`producer/draftReducer.js`)

The two trees never reach into each other — they meet only in the shell
(`modes/Producer/Producer.jsx`), connected by a small set of explicit verbs:
`PROMOTE` (jam → section), `OPEN_SECTION` (section → workspace for editing),
`SLOT_FILL` (crate/prefab → structure slot), and crystallize (draft → saved
song via the store).

### Layer stack

```
                     shared/music/  (pure engine, node:test)
  harmonicTimeline ─ consonance ─ melodyFit ─ loopScheduler ─
  arrangementScheduler ─ percussion
                              │  events { t, type, note, velocity, channel }
                              ▼
  useProducerTransport (rAF wall-clock, bar-aligned)  ──►  voiceRouter
                              ▲                                 │ per-channel
     workspaceReducer / draftReducer                           ▼
        (toTransportLayers seam)                    [ onboardGmTier ] tier 1
                              ▲                      [ gmSynthTier  ] tier 2 (guaranteed)
              Producer.jsx shell + UI band          (APK sfizz tier — future)
```

---

## 2. Engine layer (`shared/music/`)

Pure functions, no DOM/React/timers. These are the reusable music primitives;
the React transport consumes their output.

### Harmonic timelines & enrichment — `harmonicTimeline.mjs`

`harmonicTimeline(notes, ppq, opts)` → `{ slots, root, specificity }`. A slot is
one beat (quarter by default); every note contributes its pitch class to every
slot it sounds in. Slots are normalized **root-relative** (pc 0 = the detected
or declared root). `specificity` grades the densest slot:
`root` → `fifth` → `triad` → `extended`.

Root detection is a single documented, deterministic heuristic (duration-weighted
pc scoring with a strong-beat bonus and a slot-0 bass anchor for tie-breaks) — no
probabilistic key-finding. The production library does not trust that heuristic
to decide playback transposition.

**Runtime enrichment (`backend/.../piano/loopManifest.mjs`)** walks the five
MusicXML brick folders, parses the notes and metadata, joins the conversion
ledger by output path, recovers the authored tonic from the first analyzed chord
root plus first Roman degree, and builds the manifest served at
`GET /api/v1/piano/loop-manifest`:

| Field | Meaning |
|---|---|
| `timeline` | array of root-relative pc sets, one per beat (flow-style `- [0, 4, 7]`) |
| `timelineRoot` | absolute root pitch class 0..11 |
| `specificity` | `root` \| `fifth` \| `triad` \| `extended` |
| `needsReview` (+ `needsReviewReason`) | only on parse-fail or engine-throw; excludes the entry from guardrailed browse |
| `harmonyVerified` | ledger `yes`/`no` propagated as a real boolean; explicit failures are excluded from **Best** |

The library is **not uniformly in C**. Each entry keeps `tonicPc`; its timeline is
normalized relative to that tonic, and playback uses `target tonic - source tonic`.
Grooves/percussion skip harmonic analysis and never transpose. Missing or corrupt
material is marked `needsReview`; an analyzer verdict of `no` cannot disappear
between ledger and UI.

### Union-consonance guardrail — `consonance.mjs`

The **hard gate** for what the library offers as stackable. `stackable(A, B)`
phase-aligns the two timelines (LCM tiling, same alignment the scheduler uses)
and, for each overlapping slot, takes the **union** of their sounding pitch
classes; the pair is stackable iff *every* slot's union still spells a nameable
chord quality. **Worst slot decides** — one clashing bar disqualifies the pair;
`score` (fraction of consonant slots) survives only as a ranking signal.

`slotConsonant(pcs)` is the per-slot test. It accepts a set iff **some rotation**
of it is a subset of some chord-quality template (`CHORD_TEMPLATES`: root, power,
maj/min/dim/aug, sus2/4, the 7ths, add9s, 9ths). The rotation rule is load-bearing:
templates are written on their own chord root, but slot sets are root-relative to
the *loop* root, so a V triad rel-C = `{2,7,11}` matches only when re-rooted on G.

**Key assumption:** timelines carry root-relative pcs and the app transposes loops
to a shared root *before* stacking — `stackable` unions root-relative sets directly
and never consults `timeline.root`. Feeding it un-conformed loops is meaningless.
Known deliberate leniencies: bare dyads (tritone, semitone) read as incomplete-chord
shells rather than clashes; the specificity grading upstream keeps such bare dyads
rare.

This supersedes `harmonicSignature.areStackable` (roman-label matching) as the
gate; `areStackable` survives only inside `layerMatch` as a same-signature ranking
signal.

### Melody-over-harmony fit — `melodyFit.mjs`

`melodyFit(melodyTimeline, harmonyTimeline)` → `0..1`. A **ranking** signal, not
a gate: it *orders* melodic candidates over the current harmonic stack; nothing is
excluded by a low score. Per aligned slot each sounding melody pc earns 1.0 (chord
tone), 0.5 (diatonic on the shared root), or 0.0 (chromatic); the final score is a
pc-weighted mean (busier slots weigh more — the "emphasized degrees" intent).
Major/minor character is a simple documented heuristic (pc 3 present without pc 4
→ natural minor). Same root-conformed assumption as `consonance`.

### Loop scheduler channels + gain — `loopScheduler.mjs`

Turns a canonical loop's notes into timed `{ t, type, note, velocity, channel }`
events for the kiosk's existing `scheduleNotes`. Each layer carries a `channel`
(0..15) and `gain` (0..1). **Gain scales note-on velocity**, clamped 1..127
(velocity-0 note-ons would read as note-offs downstream); gain ≤ 0 emits *no*
events at all. Defaults keep the existing Studio call sites working.

### Arrangement scheduler — `arrangementScheduler.mjs`

Section/song playback, layered on `loopScheduler`:

- `buildSectionCycle(section, {bpm})` — a stack with a forced `lengthBars`; layers
  shorter than the section tile, longer layers are truncated at the boundary with
  synthesized note-offs so nothing sticks.
- `compileArrangement(sections, arrangement, {bpm})` → `{ blocks, totalMs }` —
  compiles `(section × repeats)` into block descriptors the transport walks; repeats
  share one events array (never mutate).
- `nextJumpPoint(positionMs, blocks, mode, barMs)` — the **scene-launch** primitive:
  where a live-queued section switch may land. `mode: 'repeat'` = end of current
  block; `'bar'` = next bar boundary (tap-and-hold).

### Percussion + metronome — `percussion.mjs`

`GM_DRUM` (kick 36, snare 38, hats 42/46, crash 49, ride 51, toms 45/47/50) —
the 9-piece kit the Producer ships. `metronomeEvents(bars, {bpm, timeSig})`
builds a channel-9 click stream (accented beat 1) the transport overlays for
count-ins and blank-page recording. `isDrumTrack` / `detectFeel` (straight vs
swing via offbeat-displacement analysis) serve the ingest CLI's groove labeling.

> **Note the drum channel is 0-indexed 9.** The design doc says "channel 10"
> (musician's 1-indexed GM percussion channel); everywhere in the code that is
> `DRUM_CHANNEL = 9`.

---

## 3. Sound layer — the tiered VoiceRouter

`producer/voiceRouter.js` replaces direct `pressNote` for **loop playback**. It
takes `(channel, note, velocity)` and delivers each event to the best available
**tier**, per-channel. The player's *own* keys are untouched — they still go
through the existing `pressNote`/`releaseNote` path; only backing loops route
through the router.

Tiers are supplied in priority order:

1. **`onboardGmTier`** (tier 1) — the Roland's onboard GM engine over BLE-MIDI.
   Gated by the capability flag `config.producer.voiceTiers.onboardGm` (set from
   the GM probe, §7). Sends raw channel note/PC/CC through `useWebMidiBLE`'s
   senders (keeping the BLE "one-turn-late" flush fix). Gain is approximated by
   velocity scaling — CC7 is *not* sent (unverified on this piano).
2. **`gmSynthTier`** (tier 2) — the **guaranteed** path. Wraps `gmSynth.js`, a
   browser General MIDI synth on `webaudiofont` that renders locally in Web Audio
   regardless of hardware. `supports()` is always true. Also the metronome's home.
3. **APK multi-channel sfizz** — future native tier; the router contract is designed
   so it drops in without touching Producer.

Channels are **0-indexed** (0..15), drums on 9. The router owns:
velocity-0 → note-off normalization; **sticky note-off** (the note-off goes to the
same tier that accepted the note-on, even if `supports()` has since flipped);
`configureLayer` fanning program/gain to every supporting tier; a never-throw
performance path (tier errors are sampled-logged, a failing note-on fails over to
the next tier); and an `onNotes` tap for keyboard visualization.

**Keyboard-visualization filter** — `noteTapFilter.js`. The router's tap is
unfiltered; the consumer decides what the on-screen keyboard shows. Per design,
harmonic/bass layers light the keys (so the backing "plays the piano"), percussion
and dense melody don't. `createNoteTapFilter({ visibleChannels })` + the sounding-set
tracker push a `loopNotes` Set to `PianoKeyboard`.

### gmSynth self-hosted presets

`gmSynth.js` self-hosts webaudiofont preset files under
`frontend/public/webaudiofont/` — **the kiosk must work offline, no CDN at
runtime.** Run the fetch script once per fresh checkout:

```
node frontend/scripts/fetch-webaudiofont-presets.mjs
```

The drum presets are derived from `percussion.GM_DRUM` (via `producer/presetManifest.js`);
if you change the kit, re-run the fetch script. `gmSynth`'s `AudioContext` is created
**lazily on the first user gesture** (FKB WebView starts contexts suspended) and
auto-resumes on note-on.

---

## 4. State + transport

### `workspaceReducer.js`

The `workspace` tree. Layer shape:

```js
{
  id,        // stable: library entry path, or take id ("#n" on repeats)
  source,    // { kind:'library', entry } | { kind:'take', takeId, notes, ppq, lengthBars? }
  role,      // 'chords' | 'melody' | 'bass' | 'idea' | 'groove'
  channel,   // 0..15, assigned at ADD. Grooves ALWAYS 9 (shared drum channel)
  gmProgram, // bass → 33 (fingered bass); other roles → 0 (grand); grooves → null
  gain,      // 0..1
  muted, soloed,
  carried,   // §4.1 continuity pin — PROMOTE stores a carried layer ONCE in the
             //   draft's shared pool instead of copying it per section
}
```

Actions: `ADD_LAYER` (auto-assigns lowest-free channel, grooves get 9),
`REMOVE_LAYER`, `SET_GAIN`, `TOGGLE_MUTE`, `TOGGLE_SOLO`, `SET_VOICE`, `SET_KEY`,
`SET_BPM`, `SET_LENGTH_BARS`, `TOGGLE_METRONOME`, `TOGGLE_CARRIED`, `LOAD_STACK`,
`CLEAR`, `RESTORE`, and `SET_EDITING_SECTION`. The shell keeps the last 50
workspace-and-note snapshots so **Undo restores audible material**, not merely
the channel-strip row. Solo is a
selector (`anySolo && !soloed` → effectively muted); channel exhaustion returns
state unchanged with a `lastError` the UI toasts. **`toTransportLayers`** is the
seam that projects workspace layers into scheduler inputs (applies the single
`keyShift` transpose, grooves pinned to 0).

### `draftReducer.js`

The `draft` tree (song structure). Shape once materialized:

```js
{
  sections: [{ id, name, lengthBars, stack }],
  carriedLayers: { [layerId]: workspaceLayer },  // shared continuity pool
  arrangement: [{ sectionId, repeats }],
  meta: { title, author, keyShift, bpm },
}
```

**Independence by default, continuity by reference:** a section's `stack` holds
deep *copies* of workspace layers, so editing one section never bleeds into
another. The exception is layers marked `carried` in the workspace — these are
stored *once* in `carriedLayers` and every referencing section's stack holds a
`{ carriedRef: layerId }` placeholder. All sections referencing the id share the
layer (a carried groove/bass persists while harmony changes; `MUTATE_CARRIED`
edits everywhere at once). Carried layers are GC'd when no section references them.

Key/tempo are **song-global** (`meta`), seeded from the workspace at first
promotion and never re-seeded — once a song exists, the workspace inherits its
key/tempo. Section names (`A`, `B`, `C`, …) are structural rehearsal marks, not
titles; human titles stay `null` until typed (design §3.1 never-fabricate rule).

Verbs: `PROMOTE`, `OPEN_SECTION` (returns state unchanged — resolving + loading
the stack is a *workspace* action via `resolveSectionStack`), `SET_ARRANGEMENT`,
`SET_REPEATS`, `SET_LENGTH_BARS`, `SLOT_FILL`, `APPLY_TEMPLATE`, `RENAME_SECTION`,
`DELETE_SECTION` (with arrangement cleanup). `toSchedulerInputs` projects a draft
into arrangement-scheduler inputs.

### `useProducerTransport.js`

Evolves `useLoopTransport`'s proven rAF wall-clock skeleton into a multi-channel,
bar-aligned transport that dispatches through the voiceRouter (never
pressNote/releaseNote):

- **Stack mode** (`arrangement == null`) — loops one `buildLoopCycle` forever.
- **Bar-aligned mutation** — layer/bpm changes mid-play do *not* restart playback;
  the old cycle keeps sounding until the next bar boundary, where the new cycle is
  swapped in phase-matched (all sounding loop notes released at the seam — a
  sub-frame gap at the bar line, musically acceptable).
- **Arrangement mode** — walks `compileArrangement` blocks by wall-clock; `onBlock`
  fires at every boundary; `queueJump` relocates live via `nextJumpPoint`.
- **Metronome** — one one-bar click stream, built once per bpm/timeSig change.
- **Count-in** — `play({ countInBars })` fires only the click for N bars, then
  content begins at bar 0.
- **Stop / unmount** — `router.panic()` *always* (CC123 through the flushed BLE
  sender), not just per-note offs: a lone terminal note-off can be swallowed by
  the onboard tier's one-turn-late bug.

Exposes `positionRef` (`{normalized, bar, beat}`) for the playhead, metronome flash,
and count-ins. Caller contract: `layers`/`arrangement` must be referentially stable
across renders unless they actually changed (memoize `toTransportLayers` upstream).

---

## 5. UI

Three bands (`modes/Producer/Producer.jsx` + `Producer.scss`):

- **Band 1 — TransportBar** (`producer/TransportBar.jsx`): play/stop, bar:beat
  readout, BPM stepper + tap-tempo, key stepper, metronome toggle, record-arm.
  Discrete taps, no drags.
- **Band 2 — Stage**: `Loop | Song` tabs. Loop shows front-door entry cards when the
  workspace is empty, DAW `ChannelStrip`s once it isn't. Song shows the structure
  rail (`SongView`). The library surface is full-bleed.
- **Band 3 — PianoKeyboard**: always live; the player's own playing goes through
  the untouched `pressNote` path, `loopNotes` from the router tap.

**Play mode is sticky:** what the play button starts depends on the *active tab at
play time* (Song tab with a playable arrangement plays the song, else the jam
stack), then locks until stop — switching tabs mid-play is a read, not a mode flip.

- **`LibraryBrowser.jsx`** — full-screen surface, reclaiming the transport + keyboard
  rows (a compact now-playing pill floats). Facet chips (store: Library/Ours/Prefabs;
  kind incl. groove; mood; feel) + search. When the workspace has a harmonic base,
  the grid **hard-filters by `stackable()`** ("Showing what fits your jam · N");
  "Show all" lifts the gate (non-stackable cards get a ⚠ but adding is *allowed* —
  guardrails are defaults, not prisons). Melodic candidates ranked by `melodyFit`.
  **"Goes with →"** re-anchors the browse with any card as the base. Capped at 120
  cards (simple + honest at ~3.2k entries).
- **Explicit audition** (`usePeek.js`) — every card has a visible Preview/Stop
  button. It auditions over the jam (or solo + metronome if stopped), conformed
  to the current key/tempo, and never adds the material. The older 150 ms hold
  gesture remains only as a backward-compatible shortcut. A tiny second playback
  path uses reserved channel 15 for pitched material and 9 for grooves.
- **`ChannelStrip.jsx`** — glyph · identity (roman/contour or title) · voice chip
  (→ `VoicePicker`) · latching M/S · `GainStrip` (segmented tap-to-set, log curve,
  adapted from the `TouchVolumeButtons` pattern) · carry pin · 2-tap remove. Groove
  strips get a disabled "Drums" chip and an "all drums" hint (grooves share channel 9,
  so a gain change affects every groove).
- **`SongView.jsx`** — the structure rail: slot cards (`Intro ×1 · 8 bars`) with glyph
  stacks; tap → fill or open in Loop; long-press → repeats/bars steppers; active slot
  glows and auto-advances during playback; tapping another queues a scene-launch jump.
  Empty state = the structure-template picker.
- **`MaterialGlyph.jsx`** — deterministic local SVG identity (FNV-1a hash → symmetric
  identicon grid + seeded HSL). Same material → same picture forever, no network. Seed
  = roman signature (harmonic) / degree contour (melodic) / onset pattern (groove) /
  composite (stack/section/song). Human titles shown when they exist; never fabricated.

The Loop stage also exposes the recovery and orientation verbs that were missing
from the disabled build: **New**, two-tap **Clear loop**, **Undo**, **Keep to My
Loops**, and **Add to song / Update section**. “Add a layer” opens one role-first
sheet (browse Chords/Bass/Drums/Melody, record, build drums, or build chords), so
the user no longer has to infer which disconnected surface creates which object.

---

## 6. Recording — the capture engine

`producer/useLoopCapture.js` is the pass/take overdub engine (DAW-loop-style,
never one-shot). `arm({ lengthBars, anchorWallMs })` fixes a cycle origin;
incoming MIDI notes land in the current **pass**; at each cycle boundary the pass
merges into the **take** and the cycle keeps rolling — you hear yourself
immediately and keep thickening. `undoPass()` / `clearTake()` / `keep()` → returns
`{ notes, ppq, lengthBars }` normalized to ppq 480.

It is a **wall-clock-anchored pure machine**, not a transport consumer: every
note/tick carries its own `wallMs` and the hook derives bar/tick math from the
anchor alone (works over a silent metronome, a playing jam, or a scripted test
clock). Integration prescription: every injected time must share one monotonic
`performance.now()` domain (re-stamp MIDI events; never mix in a `Date.now` anchor).

- **Snap:** `'off' | 'sixteenth'`.
- **Kind inference:** all-notes-in-drum-map + armed drum-mode → groove; else a
  polyphony heuristic → harmonic/melodic (one-tap confirmable).
- **Drum mode** (`CaptureCard.jsx` + drum-pad overlay): maps the keyboard (physical
  + on-screen pads) to GM drum pieces; output on channel 9.
- **Take citizenship:** a kept take becomes a first-class workspace layer like any
  other; **Keep to My Loops** persists it (§7). Recorded loops are promoted to real
  `/producer/loops` records when a song or crate item that references them is saved.

`CaptureCard.jsx` is the UI: count-in dial, cycling bar indicator, three big
buttons (Undo pass / Clear / Keep), snap toggle, confirmable kind chip. An open
capture session forces stack mode (it reads the jam cycle length as its geometry).
The main transport Stop also disarms capture: it drops only the incomplete pass,
keeps completed passes visible for Keep/Undo/Clear, releases drum monitors, and
offers Resume against a fresh aligned anchor instead of claiming a silent loop is
still recording.

### Builders and their audio contract

- `ChordBuilder.jsx` + `chordBuilderModel.js`: 1–16 bars, one diatonic choice per
  bar, nearest-inversion voice leading, Sustain/Quarter pulse/Syncopated rhythm,
  per-note dynamics, harmonic timeline, and builder provenance.
- `DrumSequencer.jsx` + `drumSequencerModel.js`: 1–16 bars, a one-bar-at-a-time
  16-step GM grid, Rock/House/Funk phrase presets, pickup fills, and accents.
- Both expose explicit Preview/Stop and feed `useTakePreview.js`, which uses the
  production `voiceRouter` (not a mock synth side path). Commit adds the same
  canonical take shape used by recording. Pitched builder output is canonical C;
  GM drum pitches are never transposed.

### One key model

`producer/keyModel.js` is authoritative for Loop, Preview, Song, save, and reload:

```text
keyShift = absolute target tonic relative to C
playback transpose = target tonic - source tonic
groove transpose = 0
```

Library entries retain their authored `tonicPc`; captured and builder takes are
normalized to canonical C. Exhaustive 12×12 tests pin all source/target pairs,
including non-C save/reload.

---

## 7. Persistence & API

### Backend — `backend/src/4_api/v1/routers/piano.mjs`

The Producer pool is a **household pool** (not per-user like Studio), author-tagged.
Three families, full CRUD each:

```
GET|POST         /api/v1/piano/producer/{loops|crate|songs}
GET|PATCH|DELETE /api/v1/piano/producer/{loops|crate|songs}/:id
```

Files land under the household data dir at
**`apps/piano/producer/{family}/{id}.yml`** (resolved via
`configService.getHouseholdPath(...)`). Ids are server-generated and **must be
dot-free** (`^[a-z0-9-]{1,64}$`) — FileIO appends `.yml` by inspecting the trailing
extension, so a dot would corrupt the filename (the DataService dotted-filename
gotcha); the same charset also blocks path traversal. Author comes from the request
body (the kiosk's current player, trusted per design §6). `GET /{family}` returns a
**light** listing (identity + kind + author + a small per-family signature); `GET
/:id` returns the full record.

Required heavy field per family: `loops → notes`, `crate → layers`, `songs → sections`.
Creates and updates are normalized through
`backend/src/3_applications/piano/producerRecords.mjs` to `schemaVersion: 2`; all
creates, reads, and updates are validated for shape, musical-content hash, and
referential integrity. Runtime reads never silently repair stored YAML: an invalid
direct read returns `422 PRODUCER_RECORD_INVALID`, while a light list quarantines
bad records in `invalidRecords` and preserves healthy cards. The frontend displays
a persistent repair warning with Retry instead of silently dropping saved work.
References must point to a loop that is itself schema- and hash-valid; mere file
existence is not enough. A song or crate item that points at corrupt material is
quarantined with it.
Records carry `revision`,
`contentHash`, timestamps, and a non-empty title. PATCH accepts
`expectedRevision`; a stale writer receives 409 instead of silently overwriting a
newer edit, and the response is the full validated record. Loop refs, carried refs,
section ids, arrangement entries, channels, roles, lengths, and song key/tempo are
all checked before a write.

### Frontend store — `useProducerStore.js`

API client + local cache. Light lists fetched on mount; full records on demand.
Author from `PianoUserContext` (falls back to `'household'` when no player is
selected — the pool *is* household-shared).

**Crystallize (`saveSong`)** persists the draft's structural payload verbatim
(`{ sections, arrangement, meta, carriedLayers }`) so `loadSong → HYDRATE`
round-trips losing nothing. The one transform: recorded-take layers can't live
inside a song record, so `saveSong` **auto-persists each embedded take as a
`/producer/loops` record first**, then rewrites those layers to `{ kind:'loop',
loopId }` refs (takes shared across sections dedupe by source identity plus stable
SHA-256 musical-content hash). `loadSong`
reverses it. The Crate uses the same take→loop rewrite.

Loading a saved song preserves its id and revision. **Update** patches that
record with optimistic concurrency; **Save As** deliberately creates a new id.
New capture/builder takes use `crypto.randomUUID()` where available, with a
collision-resistant old-WebView fallback; session-resetting `take-1` ids are gone.
Content hashing uses native Web Crypto where available and an exact-wire-compatible
`crypto-js` SHA-256 fallback on older Android WebViews.

Saved songs, crate stacks, prefabs, and resume snapshots load **all-or-nothing**.
Every referenced library layer is fetched and proven to contain playable notes
before the shell changes the draft or workspace. Missing, corrupt, unresolved,
or empty material leaves the current work intact and produces a visible
"Load stopped" explanation; it can no longer become a plausible-looking silent
layer or partial arrangement.

### Resume snapshot — `useResumeSnapshot.js`

The lazy safety net: while the transport plays, the whole `workspace` + `draft`
snapshot to `localStorage` (`piano.producer.snapshot.v1`) every 4 bars. On the
next visit a quiet "Resume where you left off?" chip appears (within a 24 h
window); it never auto-applies, and starting anything new clears it. Quota-safe:
falls back to dropping `notesById`, then skips with a warn (all access try/catch'd).
When cached notes are absent, resume strictly reloads every library layer before
applying the snapshot.

### Prefabs — `usePrefabs.js` + `prefabHydrate.js`

Curated, **read-only** example stacks and songs authored as YAML in the media tree,
served through the same local-stream route as the loop index
(`/api/v1/local/stream/midi/prefabs/...`) — no backend change needed. References are
by exact library path (legacy unique slugs remain supported), resolved at load time
against the live manifest (`prefabHydrate`), so prefabs never embed fat timelines.
Resolution fails closed if even one reference is missing; Producer never drops the
missing layer and plays the survivors as if the starter were healthy.
The only catalog difference from household material
is the absence of a Delete button. Structure **templates** (the 5 basics) live in code
(`producer/structureTemplates.js`) as the SSOT, not in the data prefabs.

Transport playback, generated-take Preview, and library audition each hold the
Piano screensaver awake for exactly as long as their audible path is active.
Stopping or unmounting releases both the notes and its named wake-lock hold, so
an indefinite solo preview cannot black out the kiosk while continuing to sound.

### Data-tree layout

```
<householdDataDir>/apps/piano/producer/
  loops/{id}.yml     # recorded loops: note events + kind, harmonic timeline, author, created
  crate/{id}.yml     # kept stacks/sections: layer refs (library by slug, recorded by id) + voices/gains/lengthBars
  songs/{id}.yml     # crystallized songs: sections, arrangement, meta, carriedLayers

<mediaDir>/midi/_workspace/_ledger.jsonl  # conversion source/output + analysis verdicts
<mediaDir>/midi/{chords,basslines,melodies,ideas,percussion}/  # MusicXML bricks
<mediaDir>/midi/prefabs/{index.yml,stacks/,songs/}   # curated prefabs
```

---

## 8. Content ops — growing the library

All content lives in the **Dropbox media tree, not the repo** — only the
generators/loaders are committed. To grow or seed a fresh/other-household tree:

| Goal | Tool |
|---|---|
| Ingest new loops (incl. grooves — detects channel-9 / GM-drum-range material, tags `type: groove`, `feel`, `bpm`) | `cli/midi-ingest.mjs` |
| Enrich harmonic loops with timelines (the browse guardrail data) | `cli/loop-enrich.cli.mjs` (`--dry-run` reports analyzed/flagged/failed) |
| Seed starter grooves (rock/pop/waltz/latin/brush, channel-9 MIDI) | `cli/make-starter-grooves.mjs` → then run `midi-ingest` |
| Seed example stacks + songs (prefabs) | `cli/make-piano-prefabs.mjs` (re-reads + asserts every referenced slug exists before reporting success) |

Production lifecycle tools added by the 2026-08 remediation:

| Gate | Command | Write behavior |
|---|---|---|
| Audit/migrate household records to v2 and repair stale library paths from the ingest ledger | `npm run piano:producer:migrate -- --root … --ledger … --media-root …` | Dry-run by default; `--apply` makes a sibling timestamped backup, validates the complete graph, then atomically replaces records; rerun with `--require-clean` to make any residual change fail the release gate |
| Curate starter prefab stacks/songs | `npm run piano:producer:prefabs -- --root …/midi/prefabs --media-root …/midi` | Dry-run by default; `--apply` validates every media ref, backs up the prefab tree, then writes atomically |
| Certify ledger, manifest, files, playable notes, harmony verdicts, grooves, prefab runtime hydration/refs/counts, and cold manifest-build time | `npm run piano:producer:certify -- --media-root … --ledger … --prefabs …` | Read-only; exits nonzero on any release failure, including empty grooves, structurally invalid prefabs, role/type mismatches, refs to failed/review material, or a cold build over 5 s |

The migrator reports duplicate musical content but does **not** delete it. Cleanup
is a separate product/data-retention decision, not a migration side effect.

`loop-enrich` backs up `index.yml` before writing and is idempotent (a clean
recompute clears stale `needsReview` flags). `make-piano-prefabs` and
`make-starter-grooves` are deterministic (no randomness). On Dropbox CloudStorage a
read failure may just be an online-only file — materialize and rerun.

---

## 9. Data-model quick reference

**Recorded loop** (`producer/loops/{id}.yml`)
```yaml
id: <dot-free>
schemaVersion: 2
revision: 1
contentHash: <sha256>
kind: groove | chords | bass | idea | melody
author: <userId | household>
created: <iso>
modified: <iso>
title: <non-empty>
notes: [{ ticks, durationTicks, midi, velocity }, ...]
ppq: 480
lengthBars: <n>
# pitched loops may carry timeline and builder provenance; grooves carry drumMode
```

**Crate item** (`producer/crate/{id}.yml`)
```yaml
id: <dot-free>
schemaVersion: 2
revision: 1
contentHash: <sha256>
kind: stack | section
author: <userId>
title: <non-empty>
lengthBars: <n>
layers: [{ source:{kind:'library',entry}|{kind:'loop',loopId}, role, channel, gmProgram, gain, muted, soloed }, ...]
```

**Song** (`producer/songs/{id}.yml`)
```yaml
id: <dot-free>
schemaVersion: 2
revision: 1
contentHash: <sha256>
author: <userId>
title: <non-empty>
sections: [{ id, name, lengthBars, stack:[...layers] }, ...]
carriedLayers: { <layerId>: <layer> }
arrangement: [{ sectionId, repeats }, ...]
meta: { title?, author, keyShift, bpm }
```

**Loop-index enrichment fields** (curated `index.yml`, harmonic entries):
`timeline`, `timelineRoot`, `specificity`, `rootSource`, and on failure
`needsReview` + `needsReviewReason`.

---

## 10. Testing

| Suite | Command | Count |
|---|---|---|
| Producer frontend (Vitest) | `cd frontend && npx vitest run src/modules/Piano/PianoKiosk/modes/Producer src/modules/Piano/PianoKiosk/producer --reporter=dot --silent` | 759 |
| Producer lint | `cd frontend && npx eslint src/modules/Piano/PianoKiosk/modes/Producer src/modules/Piano/PianoKiosk/producer --ext js,jsx --report-unused-disable-directives --max-warnings 0` | 0 errors, 0 warnings |
| Scheduler (node:test) | `node --test shared/music/loopScheduler.test.mjs` | 27 |
| Schema + API (Vitest/Supertest) | `npx vitest run tests/isolated/api/piano-producer.test.mjs backend/src/3_applications/piano/{producerRecords,loopManifest}.test.mjs` | 53 |
| Migration/prefab/catalog tools (node:test) | `node --test cli/piano-producer-migrate.cli.test.mjs cli/piano-producer-prefabs.cli.test.mjs cli/piano-producer-catalog.cli.test.mjs` | 10 |
| Read-only runtime at 1280×800 | `npm run piano:producer:test:runtime:readonly` | 6 pass, 3 persistence checks intentionally skipped |
| Production bundle | `npm run build --prefix frontend` | must exit 0 |

`shared/music` stays pure (no React/fetch/`Date.now` in logic paths); every new
component/hook uses the structured logger (CLAUDE.md → Logging).

### Seven hard release gates

These are binary product gates, not estimates of code completeness. Producer
stays out of the Piano menu until every row is **PASS**.

| Gate | End-user promise | Strict exit criterion | 2026-08-10 evidence/status |
|---|---|---|---|
| 1. One key model | Changing key never double-transposes, silently changes the source key, or moves drums | One authoritative target-minus-source function is used by Loop, Preview, Song, save, and reload; grooves always return zero; all 144 source/target pairs pass | **PASS** — `keyModel` and exhaustive tests |
| 2. Stable identity | Saving, reloading, or making two takes cannot accidentally merge different music | New takes have collision-resistant ids; musical content has a stable hash; same-session, reset-session, and save/reload identity tests pass | **PASS** — UUID/fallback ids plus SHA-256 content identity |
| 3. Trustworthy household data | Every saved loop, stack, and song opens without dangling material or silent loss | Every mounted record is schema v2, graph-valid, revisioned, and hashed; every library ref resolves exactly once; migration has a verified backup; post-apply dry run reports zero changes/errors | **PASS** — all 130 mounted records were migrated backup-first; 63 stale ref occurrences were repaired; `--require-clean` exits zero with `changed: []`, no repairs, and no errors/warnings |
| 4. Coherent first journey | A first-time player can start, audition without adding, layer, recover, and promote without guessing which screen owns the action | The 1280×800 read-only journey proves direct entry, capture Stop/paused/Resume, visible Preview/Stop, exact chord identity, layer add, guardrail, transport, tempo/key changes, and Add to song; component tests prove New/Clear/Undo and no hidden-gesture dependency | **PASS** — 6 browser checks pass; 3 write checks intentionally skipped |
| 5. Useful builders | Chord and drum builders produce musical, editable loops instead of disconnected demos | Both support 1–16 bars, explicit Preview/Stop through the production router, dynamics/accents, deterministic commit shape, and add the result to the same Loop workspace | **PASS (automated)** — component/model/router tests pass; audible acceptance belongs to gate 7 |
| 6. Honest starter catalog | Prefabs and search give a new player enough valid material to finish a loop and song | Ledger count equals manifest and files; every entry has playable notes; harmony failures remain visible; at least 8 grooves, 6 prefab stacks, and 3 prefab songs; every prefab hydrates through the runtime resolver with valid roles, carried refs, sections, repeats, and non-review/harmony-valid material; cold certification stays within budget; certifier exits zero | **PASS** — backup-first curation produced 7 stacks/4 songs and repaired the failed-harmony starter ref; the post-apply plan is empty and the full certifier exits zero in 1.002 s |
| 7. Ship what was tested | The enabled tile works as one musical journey on the actual kiosk, not merely as independently testable controls | Gates 1–6 pass; bundle and lint pass; the GM probe produces an explicit voice-tier verdict; browser-synth latency/polyphony pass; the dev browser and physical SM-T590 pass every row in the acceptance record below with audible confirmation; stop/panic leaves silence; only then enable and smoke-test the menu tile | **BLOCKED EXTERNALLY** — automated prerequisites pass, but the tablet is unreachable and no explicit onboard-GM verdict exists |

### Gate 7 physical acceptance record

Gate 7 is a release test, not a demo. Record the date, tester, build SHA, device,
and a short audible observation for every row. A screenshot or DOM assertion
cannot substitute for listening, and a row cannot be waived because its isolated
component test passed.

| Journey slice | Strict PASS evidence | Current status |
|---|---|---|
| Hardware voice verdict | At the piano, `/piano/test/gm-probe` produces a distinct channel-2 bass voice **and** channel-10 drum map before `producer.voiceTiers.onboardGm` is set `true`; otherwise it is explicitly set `false`. An absent value is safe at runtime—`Producer.jsx` coerces it to `false`—but is not a completed probe. | **PENDING** — mounted config has no explicit verdict; do not change it before listening |
| Browser synth fitness | On the SM-T590, `/piano/test/gm-synth` unlocks on the first tap, the piano/bass/strings overlap remains glitch-free, the drum bar is distinct, and tap-to-sound latency is acceptable for playing. | **PENDING** — requires the physical tablet and human hearing |
| Builder audition | Build both a chord loop and drum loop; Preview is audible through the production router, Stop is immediate, repeated Preview/Stop does not stack voices, and committing each result adds the exact auditioned material to Loop. | **PENDING** — automated routing/shape checks pass; audible check remains |
| Loop jam | In both the dev browser and SM-T590, start from a chord, add a bass with a bass voice and a groove, then exercise gain, mute, solo, transpose, tap tempo, and live piano playing while it loops. Every control must have an immediate, intelligible audible effect with no drum transposition, double transpose, phase jump, or stuck note. | **PENDING** — requires human musical-use evaluation |
| Capture and overdub | On the tablet, arm against silence and against a running jam; record two passes; verify count-in/alignment, Undo pass, Clear, Keep, and continued looping. Touch drum pads must monitor only drums. If physical piano keys also sound the piano in drum mode, that limitation must be visibly disclosed and judged acceptable before release. | **PENDING** — the physical-key local-control behavior is not yet accepted |
| Loop → Song journey | Add the current Loop to a song, create/fill sections, change repeats, play the arrangement, jump sections, return to Loop, and update a section. The audible layer identity and mix must survive every transition. | **PENDING** — requires audible device pass |
| Persistence round trip | Save As creates one song; Update preserves its id and advances its revision; reload restores sections, arrangement, sources, voices, gains, key, tempo, and audible output. A forced stale update must remain a visible conflict, not overwrite. | **PENDING** — gates 3 and 6 now pass; the controlled physical write/reload/conflict check and cleanup remain |
| Stop, panic, and teardown | Stop during Preview, Loop, Song, count-in, capture, and section transition; leave Producer and re-enter. Each path releases every browser/onboard note immediately, with no delayed or stuck sound. | **PENDING** — requires audible device pass |
| Kiosk ergonomics and recovery | At 1280×800, all primary controls and confirmations are readable, reachable, and reliably tappable without clipping or accidental gestures. The configured screensaver device, manual screen-off confirmation, MIDI wake, and non-MIDI recovery path all work, including the disconnected-piano case. | **PENDING** — config exists, but behavior still needs on-device confirmation |
| Menu release smoke test | Only after every earlier gate is PASS: enable the Producer menu item, enter via the tile, complete a short chord→bass→groove→song→save run, exit, and confirm silence. | **LOCKED** — `PianoMenu.jsx` intentionally remains disabled |

### Current mounted certification and release boundary (2026-08-10)

- Household mount: all 70 loops, 53 crate items, and 7 songs are now schema v2;
  63 stale library-reference occurrences were repaired from unique ledger-backed
  matches. Duplicate-content groups were reported and preserved. The backup-first
  apply created a 130-file sibling backup, live and backup counts agree, and
  `--require-clean` exits zero with `changed: []`, no repairs, no errors/warnings,
  and `valid: true`.
- Catalog: ledger 3,231 = manifest 3,231 with exact path-set parity; 1,655 chord progressions, 23 basslines,
  1,154 melodies, 391 ideas, 8 grooves; 307 explicit harmony failures propagate
  to the manifest; zero `needsReview`; recent strengthened-certifier builds take
  0.57–1.34 s against a 5 s budget.
- The mounted prefab tree now has 7 stacks and 4 songs. The backup-first apply
  added four stacks and two songs, repaired the exact failed-harmony reference in
  `lofi-groove-bed`, and preserved the prior six-file tree in a sibling backup.
  A second curation dry run reports no additions or updates. The complete catalog
  certifier exits zero with no errors or warnings and a 1.002 s cold build.
- The entire Producer directory lint scope is zero-warning, the production bundle
  succeeds, the schema/API suite passes 53/53, the data-tool suite passes 10/10,
  and the read-only 1280×800 journey passes (6 checks; 3 persistence writes remain
  intentionally skipped until the controlled physical round trip).
- Remaining hard stops before changing `PianoMenu.jsx`: complete every Gate 7 row.
  That includes the explicit GM capability verdict, browser-synth latency/polyphony, full
  chord+bass+groove mix manipulation, builder audition, capture/overdub, Loop→Song,
  persistence, stop/panic/teardown, and screensaver/touch recovery checks. Headless
  state checks are not accepted as a substitute for hearing the audio path. The
  tablet was rechecked from both the workstation and production container on
  2026-08-10; neither had an ADB device and the configured tablet endpoint was
  network-unreachable.
