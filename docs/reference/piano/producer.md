# Piano Producer — Architecture Reference

> **Status:** Implemented on `feature/piano-producer-overhaul`.
> **Design:** [`docs/_wip/plans/2026-07-01-piano-producer-overhaul-design.md`](../../_wip/plans/2026-07-01-piano-producer-overhaul-design.md)
> **Requirements:** [`docs/_wip/plans/2026-07-01-piano-producer-song-builder-requirements.md`](../../_wip/plans/2026-07-01-piano-producer-song-builder-requirements.md)
> **Delivery status + human checklist:** [`docs/_wip/plans/2026-07-01-piano-producer-overhaul-STATUS.md`](../../_wip/plans/2026-07-01-piano-producer-overhaul-STATUS.md)
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
stage (jam, Crate, song, saved song) is a valid final destination.

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

Pure functions, no DOM/React/timers, tested with `node --test`
(`node --test shared/music/` — 204 tests). These are the reusable music
primitives; the React transport consumes their output.

### Harmonic timelines & enrichment — `harmonicTimeline.mjs`

`harmonicTimeline(notes, ppq, opts)` → `{ slots, root, specificity }`. A slot is
one beat (quarter by default); every note contributes its pitch class to every
slot it sounds in. Slots are normalized **root-relative** (pc 0 = the detected
or declared root). `specificity` grades the densest slot:
`root` → `fifth` → `triad` → `extended`.

Root detection is a single documented, deterministic heuristic (duration-weighted
pc scoring with a strong-beat bonus and a slot-0 bass anchor for tie-breaks) — no
probabilistic key-finding. Ambiguity is the **caller's** problem: the enrichment
CLI flags loops it can't trust rather than guessing.

**Enrichment (`cli/loop-enrich.cli.mjs`)** runs the timeline over every harmonic
loop in the served index and writes flat keys back into each entry:

| Field | Meaning |
|---|---|
| `timeline` | array of root-relative pc sets, one per beat (flow-style `- [0, 4, 7]`) |
| `timelineRoot` | absolute root pitch class 0..11 |
| `specificity` | `root` \| `fifth` \| `triad` \| `extended` |
| `rootSource` | `declared` \| `detected` |
| `needsReview` (+ `needsReviewReason`) | only on parse-fail or engine-throw; excludes the entry from guardrailed browse |

The library is **canonical-C by construction**, so a declared `canonicalKey` is
ground truth: its relative-major tonic is passed to the engine as a root override
and recorded `rootSource: declared` (a heuristic disagreement is a heuristic
miss, not content ambiguity). The pass is idempotent and backs up `index.yml`
before writing. Grooves/percussion are skipped (no harmonic content).

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
`SET_BPM`, `TOGGLE_METRONOME`, `TOGGLE_CARRIED`, `LOAD_STACK`, `CLEAR`. Solo is a
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
- **Band 2 — Stage**: `Mix | Song` tabs. Mix shows front-door entry cards when the
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
- **Press-to-peek** (`usePeek.js`) — press-and-hold on a card (150 ms arm) auditions
  it over the jam (or solo + metronome if stopped), conformed to the current
  key/tempo; release silences and never adds (a peek is a listen, adding takes a
  fresh tap). A tiny second playback path on a reserved channel (15 melodic, 9 groove).
- **`ChannelStrip.jsx`** — glyph · identity (roman/contour or title) · voice chip
  (→ `VoicePicker`) · latching M/S · `GainStrip` (segmented tap-to-set, log curve,
  adapted from the `TouchVolumeButtons` pattern) · carry pin · 2-tap remove. Groove
  strips get a disabled "Drums" chip and an "all drums" hint (grooves share channel 9,
  so a gain change affects every groove).
- **`SongView.jsx`** — the structure rail: slot cards (`Intro ×1 · 8 bars`) with glyph
  stacks; tap → fill or open-in-Mix; long-press → repeats/bars steppers; active slot
  glows and auto-advances during playback; tapping another queues a scene-launch jump.
  Empty state = the structure-template picker.
- **`MaterialGlyph.jsx`** — deterministic local SVG identity (FNV-1a hash → symmetric
  identicon grid + seeded HSL). Same material → same picture forever, no network. Seed
  = roman signature (harmonic) / degree contour (melodic) / onset pattern (groove) /
  composite (stack/section/song). Human titles shown when they exist; never fabricated.

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
  other; "Keep to Crate" persists it (§7). Recorded loops are promoted to real
  `/producer/loops` records when a song or crate item that references them is saved.

`CaptureCard.jsx` is the UI: count-in dial, cycling bar indicator, three big
buttons (Undo pass / Clear / Keep), snap toggle, confirmable kind chip. An open
capture session forces stack mode (it reads the jam cycle length as its geometry).

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
/:id` returns the full record. `PATCH` is a shallow curate merge (title/favorite).

Required heavy field per family: `loops → notes`, `crate → layers`, `songs → sections`.

### Frontend store — `useProducerStore.js`

API client + local cache. Light lists fetched on mount; full records on demand.
Author from `PianoUserContext` (falls back to `'household'` when no player is
selected — the pool *is* household-shared).

**Crystallize (`saveSong`)** persists the draft's structural payload verbatim
(`{ sections, arrangement, meta, carriedLayers }`) so `loadSong → HYDRATE`
round-trips losing nothing. The one transform: recorded-take layers can't live
inside a song record, so `saveSong` **auto-persists each embedded take as a
`/producer/loops` record first**, then rewrites those layers to `{ kind:'loop',
loopId }` refs (takes shared across sections dedupe to one loop). `loadSong`
reverses it. The Crate uses the same take→loop rewrite.

> **Product decision flagged:** re-saving a song creates a **new** record
> (immutable crystallize), not an update-in-place. See the STATUS doc's pending
> items — decide whether update-in-place is wanted.

### Resume snapshot — `useResumeSnapshot.js`

The lazy safety net: while the transport plays, the whole `workspace` + `draft`
snapshot to `localStorage` (`piano.producer.snapshot.v1`) every 4 bars. On the
next visit a quiet "Resume where you left off?" chip appears (within a 24 h
window); it never auto-applies, and starting anything new clears it. Quota-safe:
falls back to dropping `notesById`, then skips with a warn (all access try/catch'd).

### Prefabs — `usePrefabs.js` + `prefabHydrate.js`

Curated, **read-only** example stacks and songs authored as YAML in the media tree,
served through the same local-stream route as the loop index
(`/api/v1/local/stream/midi/prefabs/...`) — no backend change needed. References are
by library slug, resolved at load time against the live index (`prefabHydrate`), so
prefabs never embed fat timelines. The only catalog difference from household material
is the absence of a Delete button. Structure **templates** (the 5 basics) live in code
(`producer/structureTemplates.js`) as the SSOT, not in the data prefabs.

### Data-tree layout

```
<householdDataDir>/apps/piano/producer/
  loops/{id}.yml     # recorded loops: note events + kind, harmonic timeline, author, created
  crate/{id}.yml     # kept stacks/sections: layer refs (library by slug, recorded by id) + voices/gains/lengthBars
  songs/{id}.yml     # crystallized songs: sections, arrangement, meta, carriedLayers

<mediaDir>/midi/loops/index.yml           # curated loop index (enriched in place)
<mediaDir>/midi/loops/percussion/         # ingested grooves
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

`loop-enrich` backs up `index.yml` before writing and is idempotent (a clean
recompute clears stale `needsReview` flags). `make-piano-prefabs` and
`make-starter-grooves` are deterministic (no randomness). On Dropbox CloudStorage a
read failure may just be an online-only file — materialize and rerun.

---

## 9. Data-model quick reference

**Recorded loop** (`producer/loops/{id}.yml`)
```yaml
id: <dot-free>
kind: groove | harmonic | melodic
author: <userId | household>
created: <iso>
notes: [{ ticks, durationTicks, midi, velocity }, ...]
ppq: 480
lengthBars: <n>
# harmonic loops also carry timeline/timelineRoot/specificity; grooves carry drumMode
```

**Crate item** (`producer/crate/{id}.yml`)
```yaml
id: <dot-free>
kind: stack | section
author: <userId>
lengthBars: <n>
layers: [{ source:{kind:'library',entry}|{kind:'loop',loopId}, role, channel, gmProgram, gain, muted, soloed }, ...]
```

**Song** (`producer/songs/{id}.yml`)
```yaml
id: <dot-free>
author: <userId>
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
| Engine (pure) | `node --test shared/music/` | 204 |
| Frontend (vitest, colocated) | `npx vitest run <path> --config vitest.config.mjs` | ~1270 across the Piano sweep |
| API (jest) | `node --experimental-vm-modules node_modules/.bin/jest tests/isolated/api/piano-producer.test.mjs` | 26 |
| Flow (Playwright) | `npx playwright test tests/live/flow/piano/ --reporter=line` | 1 |

`shared/music` stays pure (no React/fetch/`Date.now` in logic paths); every new
component/hook uses the structured logger (CLAUDE.md → Logging). See the STATUS doc
for the full task ledger and the on-device verification checklist.
