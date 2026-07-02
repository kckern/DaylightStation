# Piano Producer Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite the Piano Kiosk Producer mode into a jam-first, multi-instrument,
section/arrangement-capable song builder per the validated design.

**Design doc (read first):** `docs/_wip/plans/2026-07-01-piano-producer-overhaul-design.md`
**Requirements:** `docs/_wip/plans/2026-07-01-piano-producer-song-builder-requirements.md`

**Architecture:** Pure music engine additions in `shared/music/` (harmonic timelines,
union-consonance stacking guardrail, arrangement scheduler) + a tiered GM `VoiceRouter`
on the frontend (onboard Roland → browser GM synth → APK later) + a two-tree state model
(`workspace` always, `draft` lazily) + full UI rewrite + household-pool persistence via
the piano API router.

**Tech stack:** React (jsx, hooks/reducers), plain JS engine modules (`.mjs`, node:test),
vitest for frontend tests, jest for API tests, Express router, YAML persistence,
`@tonejs/midi`, a self-hosted GM soundfont player (webaudiofont or equivalent).

---

## Test commands (exact)

| What | Command | Notes |
|---|---|---|
| Engine (`shared/music/*.test.mjs`) | `node --test shared/music/` | node:test + `assert/strict`; 72 tests pass at baseline |
| One engine file | `node --test shared/music/harmonicTimeline.test.mjs` | |
| Frontend colocated (vitest) | `npx vitest run <path> --config vitest.config.mjs` | run from repo root of the worktree |
| API (jest) | `node --experimental-vm-modules node_modules/.bin/jest tests/isolated/api/piano-producer.test.mjs` | mirror `tests/isolated/api/piano-router.test.mjs` conventions |
| Full isolated sweep | `npm run test:isolated` | **Baseline is dirty (pre-existing):** 347 suites "failed to run" (jest/vitest Symbol clash) + 4 failing tests, identical on main. Judge your work by the targeted commands above, and by "no NEW failures" on the sweep. |

**Commit policy:** commit after every green task (feature branch — per-task commits authorized).
Conventional style: `feat(piano-producer): …`, `test(…)`, `docs(…)`.

**Logging:** every new component/hook uses the structured logger (see CLAUDE.md → Logging).
No raw console.

---

## Phase 0 — Hardware spikes (do first; results gate tier wiring)

### Task 0.1: MDG-400 GM capability spike (manual + script)

**Files:** Create `cli/piano-gm-probe.cli.mjs`

A tiny CLI that sends, via the Jamcorder REST/BLE path is NOT available from this
machine — instead use ADB on the tablet? No: simplest is Web MIDI from the kiosk.
Write a probe page instead:

- Create `frontend/src/modules/Piano/PianoKiosk/modes/Test/GmProbe.jsx` (the Test mode
  folder already exists) that, on tap: sends Program Change (bass=33) on ch 2 + a short
  note run, then ch-10 notes 36/38/42 (kick/snare/hat), using the existing
  `useWebMidiBLE` raw output (`outputRef.current.send([...])`).
- KC (or a listener at the piano) reports: distinct bass timbre? drums audible?
- Record result in `data/household[-hid]/config/piano.yml` under
  `producer.voiceTiers.onboardGm: true|false` (config read via
  `usePianoKioskConfig`). **Default assumption if spike can't run yet: `false`** —
  tier 2 carries everything; tier 1 wiring is behind the flag either way.

**Step 1:** Build the probe component (no test needed — throwaway diagnostic).
**Step 2:** Commit: `chore(piano-producer): GM capability probe in Test mode`.
**Step 3:** Ask KC to run it at the piano; park the answer in piano.yml. DO NOT BLOCK —
proceed with tier 2 as the guaranteed path.

### Task 0.2: Browser GM synth spike (SM-T590 WebView)

**Files:** Create `frontend/src/modules/Piano/PianoKiosk/producer/gmSynth.js` + probe hook-in to the Test mode page.

- Pick the library: `webaudiofont` (npm) — pure JS GM player, per-instrument JS files
  we can self-host under `frontend/public/webaudiofont/` (NO CDN at runtime — kiosk
  must work offline). Install in `frontend/`: `cd frontend && npm install webaudiofont --legacy-peer-deps`.
- `gmSynth.js` exports `createGmSynth({ audioContext })` with:
  `load(program)` (lazy-loads + caches an instrument), `noteOn(ch, note, vel)`,
  `noteOff(ch, note)`, `setChannelProgram(ch, program)`, `setChannelGain(ch, 0..1)`,
  channel 10 → percussion preset map.
- Add a Test-mode button: play a C major arpeggio on piano/bass/strings + a drum bar.
  Measure: audible latency acceptable? polyphony ≥ 32 without glitching?

**Step 1:** Write `gmSynth.test.js` (vitest, colocated) asserting the shim's channel
bookkeeping with a mocked player (program per channel, gain scaling, ch-10 → drum path).
**Step 2:** `npx vitest run frontend/src/modules/Piano/PianoKiosk/producer/gmSynth.test.js --config vitest.config.mjs` → FAIL.
**Step 3:** Implement; re-run → PASS.
**Step 4:** Manual check in the Test mode page on desktop dev, then on the tablet.
**Step 5:** Commit: `feat(piano-producer): browser GM synth (tier-2 voice output)`.

---

## Phase 1 — Engine (`shared/music/`, pure, node:test, TDD throughout)

### Task 1.1: Harmonic timeline extraction

**Files:** Create `shared/music/harmonicTimeline.mjs` + `harmonicTimeline.test.mjs`

API:
```js
// notes: [{ticks, durationTicks, midi}], ppq, {slotsPerBar=4, timeSig=[4,4]}
// → { slots: [[pc,…], …], root: 0-11, specificity: 'root'|'fifth'|'triad'|'extended' }
export function harmonicTimeline(notes, ppq, opts = {})
```
Rules: slot = beat (quarter) by default; a note contributes its pitch class to every
slot it sounds in; slots normalized relative to detected root (reuse
`bestTonic`/existing roman helpers where sensible — check `romanAnalysis.mjs` first,
DRY). Specificity = max slot cardinality mapped: 1→root, {0,7}-only→fifth, ≤3→triad,
else extended.

**Steps (TDD loop):**
1. Write failing tests: octave loop → all slots `[0]`, specificity `root`;
   C–F–G triads over 4 beats → per-slot triad sets; sustained whole-note chord fills
   all slots. `node --test shared/music/harmonicTimeline.test.mjs` → FAIL.
2. Implement minimal. → PASS.
3. `node --test shared/music/` (no regressions). Commit:
   `feat(music): harmonic timeline extraction`.

### Task 1.2: Union-consonance `stackable()`

**Files:** Create `shared/music/consonance.mjs` + `consonance.test.mjs`

API:
```js
export function slotConsonant(pcs /* Set|array of pitch classes, root-relative */) // → bool
export function stackable(timelineA, timelineB) // → { ok, worstSlot, score }
```
- `slotConsonant`: union must be a subset of a nameable chord-quality template on the
  shared root. Template table (root-relative pc sets): maj `{0,4,7}`, min `{0,3,7}`,
  maj7 `{0,4,7,11}`, dom7 `{0,4,7,10}`, min7 `{0,3,7,10}`, m7b5 `{0,3,6,10}`, sus2
  `{0,2,7}`, sus4 `{0,5,7}`, add9 variants `{0,2,4,7}`/`{0,2,3,7}`, 9ths maj9/dom9
  `{0,2,4,7,11|10}` + min9 `{0,2,3,7,10}`, dim `{0,3,6}`, dim7 `{0,3,6,9}`, aug
  `{0,4,8}`, power `{0,7}`, root `{0}`.
- `stackable`: phase-align timelines (tile shorter to LCM of lengths — same whole-bar
  logic as `loopLengthTicks`), per-slot union, **worst slot decides** (`ok = every slot
  consonant`), score = fraction of consonant slots (for ranking near-misses later).

**Fixture table (from design, MUST all be tests):**
- octaves `[{0}]` over any timeline sharing the root → ok
- open fifth under a dom7 → ok (union = dom7)
- dim7 over sus2 → NOT ok
- I–V–vi–IV triads over same-progression 7ths → ok
- I–V–vi–IV over ii–V–I → NOT ok (slot clash)

Same TDD loop; commit `feat(music): union-consonance stackable() guardrail`.

### Task 1.3: Melody-over-harmony fit

**Files:** Create `shared/music/melodyFit.mjs` + test.

```js
export function melodyFit(melodyTimeline, harmonyTimeline) // → 0..1
```
Per slot: melody pcs that are chord tones of the harmony slot count full, diatonic
non-chord-tones half, chromatic clashes zero; weight by slot occupancy; return mean.
Tests: chord-tone arpeggio over its own triad → 1.0; chromatic run → low; passing
tones → mid. Commit `feat(music): melody-over-harmony fit scorer`.

### Task 1.4: Channels + gain in the loop scheduler

**Files:** Modify `shared/music/loopScheduler.mjs` (+ its test).

- `loopToEvents(notes, {…, channel=0, gain=1})` → events gain
  `channel`, velocity = `round(velocity * gain)` clamped 1..127.
- `buildLoopCycle(layers, …)`: pass each layer's `channel`/`gain` through.
- Back-compat: defaults keep old call sites working (Studio!). Run
  `node --test shared/music/` → all green including old tests.
Commit `feat(music): per-layer channel and gain in loop scheduler`.

### Task 1.5: Arrangement scheduler

**Files:** Create `shared/music/arrangementScheduler.mjs` + test.

API (pure — the React transport consumes this):
```js
export function buildSectionCycle(section, {bpm})        // stack tiled/truncated to lengthBars
export function compileArrangement(sections, arrangement, {bpm})
//   → { blocks: [{sectionId, repeatIdx, startMs, lengthMs, events}], totalMs }
export function nextJumpPoint(positionMs, blocks, mode /* 'repeat'|'bar' */, barMs)
//   → ms timestamp where a queued section switch may land
```
Tests: 2-bar section × 3 repeats → 3 blocks, correct offsets; truncation of a 4-bar
layer into a 2-bar section; `nextJumpPoint` lands on repeat boundary vs next bar.
Commit `feat(music): arrangement scheduler (sections, repeats, live jumps)`.

### Task 1.6: Metronome + drum-map constants

**Files:** Create `shared/music/percussion.mjs` + test.

`GM_DRUM = { kick:36, snare:38, hatClosed:42, hatOpen:46, crash:49, ride:51, tomLo:45, tomMid:47, tomHi:50 }`;
`metronomeEvents(bars, {bpm, timeSig})` → ch-10 tick pattern (accented beat 1);
`isDrumTrack(midiTrackChannel)` helper for the ingest CLI.
Commit `feat(music): percussion constants + metronome pattern`.

---

## Phase 2 — Enrichment + percussion library (CLI)

### Task 2.1: Loop-enrichment CLI

**Files:** Create `cli/loop-enrich.cli.mjs`; add root dep `@tonejs/midi` if not present
at root (`npm install @tonejs/midi --legacy-peer-deps` — it currently lives in
frontend; check `node -p "require('@tonejs/midi/package.json').version"` first).

Behavior:
- Reads `<dataDir>/media/midi/loops/index.yml` + each `.mid` (resolve data dir the same
  way other CLIs do — see `cli/midi-ingest.mjs` for the pattern).
- For each harmonic/bass/melody entry: compute `harmonicTimeline` → write `timeline`
  (compact: array of pc-arrays), `root`, `specificity` back into the entry.
- Ambiguity rule: if root detection confidence is low (bestTonic tie) → set
  `needsReview: true`, skip timeline.
- `--dry-run` prints distribution: analyzed / flagged / failed, by type. Idempotent.
- **Backup index.yml before writing** (`index.yml.bak-<date>`).

**Steps:** test the pure pieces in shared/music (already done 1.1); CLI itself gets a
smoke run: `node cli/loop-enrich.cli.mjs --dry-run` → prints distribution, exits 0.
Then real run. Commit the CLI (`feat(cli): loop harmonic-timeline enrichment pass`).
Report the distribution numbers back to KC in the session (content-hygiene sizing).

### Task 2.2: Percussion ingest support

**Files:** Modify `cli/midi-ingest.mjs` (read it first end-to-end).

- Detect drum material: MIDI channel 10 tracks, or all-notes-in-GM-drum-range with no
  harmonic spread. Tag `type: groove`, `feel` (straight/swing via onset-grid analysis:
  swung 8ths → offbeat displacement ≥ 20%), `bpm`, NO roman/key/transpositions.
- Groove entries keep the same identity fields (slug/path/mood).
Test: engine-level feel detection goes in `shared/music/percussion.mjs` tests
(`detectFeel(onsets, ppq)`); CLI smoke-run on a fixture .mid checked into
`tests/_fixtures/midi/groove-straight.mid` (generate with a tiny script — do not
hand-craft binary in the plan; write `tests/_fixtures/midi/make-groove-fixture.mjs`
using @tonejs/midi to emit it).
Commit `feat(cli): percussion (groove) ingest with feel detection`.

### Task 2.3: Seed grooves

- Source: download a free GM drum-MIDI starter pack (drum-patterns.com or similar,
  license-check: must allow redistribution) into `<dataDir>/media/midi/loops/percussion/`.
  If network/licensing blocks: **generate** 5 starter grooves programmatically
  (rock 8ths, pop 16ths, waltz, latin/clave, brush-swing) with a
  `cli/make-starter-grooves.mjs` script emitting proper ch-10 MIDI.
- Run ingest → index gains `type: groove` entries. Verify:
  `grep -c 'type: groove' <dataDir>/media/midi/loops/index.yml` ≥ 5.
Commit script only (media tree is data, not git): `feat(cli): starter groove generator`.

---

## Phase 3 — VoiceRouter (frontend)

### Task 3.1: `voiceRouter.js`

**Files:** Create `frontend/src/modules/Piano/PianoKiosk/producer/voiceRouter.js` + vitest test.

```js
createVoiceRouter({ tiers, policy })  // tiers: ordered [{id, supports(ch), noteOn, noteOff, setProgram, setGain, allNotesOff}]
// router.noteOn(ch, note, vel) → dispatches to first tier whose supports(ch) is true
// router.configureLayer(ch, {program, gain})
// router.panic() → allNotesOff on every tier
```
Tests (mocked tiers): ch routing honors tier order; onboardGm flag off → tier 1
`supports()` false for all ch; drums (ch 10) route to tier 2 when tier 1 off; panic
fans out. Commit `feat(piano-producer): tiered GM voice router`.

### Task 3.2: Tier adapters

**Files:** Create `producer/tiers/onboardGmTier.js`, `producer/tiers/gmSynthTier.js` (wraps Task 0.2's synth), + tests.

- `onboardGmTier({ sendMidi, enabled })` — raw channel messages via
  `useWebMidiBLE`'s output (`[0x90|ch, note, vel]`, program change `[0xC0|ch, pgm]`);
  gain approximated by velocity scale. `supports(ch)` = `enabled`.
- `gmSynthTier({ synth })` — thin binding, `supports()` always true (the guaranteed tier).
- Keyboard visualization: the router exposes an `onNotes(cb)` tap; Producer will feed
  `loopNotes` for harmonic/bass channels ONLY (design §2). Test the channel filter.
Commit `feat(piano-producer): onboard + browser-synth voice tiers`.

---

## Phase 4 — Workspace + Mix (the jam MUST be excellent before moving on)

### Task 4.1: `workspaceReducer.js`

**Files:** Create `producer/workspaceReducer.js` + vitest test. Shape per design §1
(layers with `{id, source, channel, gmProgram, gain, muted, soloed, carried}`,
keyShift, bpm, metronome, editingSectionId).

Actions: `ADD_LAYER` (auto-assigns next free channel; grooves get 10),
`REMOVE_LAYER`, `SET_GAIN`, `TOGGLE_MUTE`, `TOGGLE_SOLO`, `SET_VOICE`, `SET_KEY`,
`SET_BPM`, `TOGGLE_METRONOME`, `LOAD_STACK`, `CLEAR`.
TDD every action, incl. channel exhaustion (>15 layers rejected) and solo-implies-
effective-mute logic as a selector `effectiveMuted(state, id)`.
Commit `feat(piano-producer): workspace reducer`.

### Task 4.2: `useProducerTransport`

**Files:** Create `producer/useProducerTransport.js` + test.

Wraps the rAF wall-clock pattern from `useLoopTransport.js` (read it; copy the proven
skeleton) but: consumes `buildLoopCycle`/`compileArrangement` events **with channels**,
emits through the VoiceRouter, supports **bar-aligned mutation** (layer changes apply at
next bar: keep current cycle playing, swap `cycleRef` at bar boundary — test with fake
timers), metronome overlay, and count-in. Exposes `positionRef` `{normalized, bar, beat}`.
Commit `feat(piano-producer): producer transport (bar-aligned, multi-channel)`.

### Task 4.3: `MaterialGlyph`

**Files:** Create `producer/MaterialGlyph.jsx` + test.

Deterministic local SVG: seed = roman signature / degree contour / onset pattern
(passed in as `seedString`); hash → 5×5 symmetric identicon grid + HSL color
(`hue = hash % 360`, fixed s/l for the dark stage). Test: same seed → identical
markup; different seed → different. NO network. Commit
`feat(piano-producer): deterministic material glyphs`.

### Task 4.4: Producer shell rewrite

**Files:** Rewrite `modes/Producer/Producer.jsx` + `Producer.scss`; update
`modes/Producer/Producer.test.jsx`.

Three bands (design §7): TransportBar (play/stop, bar:beat, BPM stepper + tap-tempo,
key stepper, metronome, record-arm), Stage (Mix|Song tabs + full-screen surfaces
portal), PianoKeyboard band (existing component, `loopNotes` from the router tap,
user notes via existing `usePianoMidi`). Keep `useKeepScreenAwake`,
`PianoEmpty` loading/error states, structured logging events
(`piano.producer.mounted`, `.layer-add`, `.play`, …).
Entry state (no base picked): the four front doors as big cards — Browse, Jam from
a loop, Record my own (metronome), Songs/Resume.
Component tests: renders entry cards; adding a layer shows a channel strip; play
toggles. Commit `feat(piano-producer): shell rewrite (transport/stage/keys)`.

### Task 4.5: ChannelStrip + gain strip + voice picker

**Files:** Create `producer/ChannelStrip.jsx`, `producer/GainStrip.jsx`,
`producer/VoicePicker.jsx` (+ tests, + scss).

- `GainStrip`: adapt the `TouchVolumeButtons` pattern
  (`frontend/src/modules/Fitness/player/panels/TouchVolumeButtons.jsx`) — segmented
  tap-to-set, log curve, pointer-capture; DO NOT import the fitness component
  (different domain); extract the level/curve helpers into the new file.
- `ChannelStrip`: glyph, roman/contour identity, voice chip → `VoicePicker`
  (full-screen surface, GM programs grouped by family: Piano/Bass/Guitar/Strings/
  Organ/Synth/…), latching M/S, gain strip, remove.
- ≥48px touch targets; Roboto Condensed; latching buttons not drags.
Commit `feat(piano-producer): DAW channel strips (touch-first)`.

**CHECKPOINT: manual jam test on dev server** — pick harmonic loop, stack bass with a
bass voice + a groove, adjust gains, mute/solo, transpose, tap tempo. The jam must
feel great before Phase 5. `npm run dev`, open `/piano?mode=producer` (verify actual
route from `PianoMenu.jsx`).

---

## Phase 5 — Library surface

### Task 5.1: Full-screen `LibraryBrowser`

**Files:** Create `producer/LibraryBrowser.jsx` + test + scss.

Full-bleed surface (reclaims transport+keys rows; compact now-playing pill; Close/Add
bar). Facet chips from `lib.facets` + kind (incl. groove) + "Ours" + prefabs; search;
glyph-forward cards (roman for harmonic, staff thumb for melodic — reuse
`MelodicStaffThumb` idea, step-dots for grooves). When workspace has layers:
hard-filter by `stackable()` (timelines from the enriched index; entries without
timelines and `needsReview` ones are excluded from guardrailed results), rank by
existing `rankLayerCandidates` within the compatible set; melodic candidates ranked by
`melodyFit`. "Goes with →" pivot on every card.
Commit `feat(piano-producer): full-screen library with consonance guardrails`.

### Task 5.2: Press-to-peek audition

**Files:** `producer/usePeek.js` + wire into LibraryBrowser cards.

Pointer-down → load notes, start preview layer(s) over current stack (or solo +
metronome), conformed to current key/tempo; pointer-up/leave/cancel → stop + release
all. Debounce 150ms to avoid scroll-touch false triggers. Test with fake pointer
events. Commit `feat(piano-producer): press-and-hold audition`.

---

## Phase 6 — Recording

### Task 6.1: `useLoopCapture`

**Files:** Create `producer/useLoopCapture.js` + test (this is the heart — TDD hard).

Consumes the transport clock (`positionRef` + bar events). Model:
`arm({lengthBars})` → count-in → cycling; incoming MIDI (from `usePianoMidi` events)
timestamped against the cycle; at each cycle boundary current **pass** merges into
**take**; `undoPass()`, `clearTake()`, `keep()` → returns
`{notes:[{ticks,durationTicks,midi,velocity}], ppq, lengthBars}` normalized to
ticks (ppq 480). Snap option: `'off' | 'sixteenth'`. Kind inference:
all-notes-in-drum-map + armed-drum-mode → groove; else polyphony heuristic.
Tests with a scripted clock + fake note events: pass merge, undo, quantize snap,
drum-mode mapping (white keys C2 octave → GM_DRUM per design).
Commit `feat(piano-producer): loop capture engine (pass/take overdub)`.

### Task 6.2: Capture card UI + drum pads

**Files:** `producer/CaptureCard.jsx` (+ test/scss); drum-pad overlay for keyboard band.

Count-in dial, cycling bar indicator, three big buttons (Undo pass / Clear / Keep),
snap toggle, kind chip (confirmable). Keep → layer lands in workspace (channel per
kind), take stored in-memory with `takeRef`; "Keep to Crate" appears on the layer
strip (wired for real in Phase 8).
Commit `feat(piano-producer): capture card + drum pads`.

---

## Phase 7 — Sections & arrangement

### Task 7.1: `draftReducer.js` + verbs

**Files:** Create `producer/draftReducer.js` + test.

Design §1 shape. Actions: `PROMOTE` (workspace stack → new/replacing section, stack
COPIED; carried layers by ref), `OPEN_SECTION` (returns stack for workspace LOAD_STACK
+ sets editingSectionId), `SET_ARRANGEMENT`, `SET_REPEATS`, `SET_LENGTH_BARS`,
`SLOT_FILL` (crate/prefab item → slot), `APPLY_TEMPLATE` (structure template → empty
sections), `RENAME_SECTION`, `DELETE_SECTION` (with arrangement cleanup).
TDD all verbs incl. carried-layer ref semantics (mutating the carried groove in one
section reflects in the other; non-carried copies don't).
Commit `feat(piano-producer): draft reducer (sections/arrangement verbs)`.

### Task 7.2: Song view (structure rail)

**Files:** Create `producer/SongView.jsx` + test + scss.

Slot cards (`Intro ×1 · 8 bars`) with glyph stacks; tap → fill (opens Crate/prefab
picker or "use current jam") or open-in-Mix; long-press → steppers for repeats/bars;
play-through: active slot glows, auto-advances (transport arrangement mode); tapping
another slot queues jump (`nextJumpPoint`), tap-and-hold = next-bar jump. Empty state
= template picker (full-screen). Commit
`feat(piano-producer): song builder (structure rail + scene launch)`.

---

## Phase 8 — Persistence

### Task 8.1: API endpoints

**Files:** Modify `backend/src/4_api/v1/routers/piano.mjs`; test
`tests/isolated/api/piano-producer.test.mjs` (copy the harness/DI pattern from
`tests/isolated/api/piano-router.test.mjs` EXACTLY — read it first).

Routes (household pool — NOT under /users/): `GET|POST /producer/loops`,
`GET|PATCH|DELETE /producer/loops/:id`, same trio for `/producer/crate` and
`/producer/songs`. Files per design §6 under the household data dir
(`…/apps/piano/producer/{loops,crate,songs}/{id}.yml` — follow however
`userPianoDir` resolves paths, but household-scoped; find the household-dir helper in
the router/ConfigService). Author field comes from request body (`author: userId`) —
kiosk sends current player. Listings are light (no notes); `GET :id` returns full.
**Watch the DataService dotted-filename gotcha** (MEMORY.md): ids are ULID-ish, no
dots — enforce `[a-z0-9-]` on ids.
TDD: list-empty, save→list→get roundtrip, patch title/favorite, delete, id
validation 400. Commit `feat(api): piano producer loops/crate/songs endpoints`.

### Task 8.2: Frontend persistence + resume

**Files:** Create `producer/useProducerStore.js` (fetch/save wrappers + household
catalog merge into LibraryBrowser "Ours" facet); localStorage snapshot
(`piano.producer.snapshot`, workspace+draft, every 4 bars while playing, restore
chip on mount); Save flows: "Keep to Crate" (loop/stack/section), "Save song"
(crystallize), "Load song".
Vitest: snapshot round-trip; store mock-fetch tests.
Commit `feat(piano-producer): save/load, crate, resume snapshot`.

---

## Phase 9 — Prefabs, polish, verification

### Task 9.1: Prefab content + loader

**Files:** Create `<mediaDir>/midi/prefabs/{stacks,sections,templates,songs}/*.yml`
(5 structure templates: pop, verse-chorus, AABA, 12-bar, loop-jam; 3 example stacks;
1-2 example songs using library slugs); loader merge into the catalog
(`producer/usePrefabs.js`). Commit generator/loader; content lives in the data tree.

### Task 9.2: Playwright flow

**Files:** Create `tests/live/flow/piano/producer-happy-path.runtime.test.mjs`
(follow an existing flow test's structure — see `tests/live/flow/fitness/`).

Flow: open producer → browse → add base → stackable-filtered add → play → promote to
section → template → save song → reload → play arrangement. Run:
`npx playwright test tests/live/flow/piano/ --reporter=line` (dev server per
playwright.config webServer). No skipped assertions (Test Discipline — CLAUDE.md).

### Task 9.3: Docs + final sweep

- Update design doc status → implemented; add
  `docs/reference/piano/producer.md` (architecture: engine modules, VoiceRouter tiers,
  state trees, API, data locations).
- `node --test shared/music/` green; targeted vitest files green;
  `npm run test:isolated` shows **no new** failures vs the recorded baseline
  (347 failed suites / 4 failed tests).
- REQUIRED SUB-SKILL before claiming done: superpowers:verification-before-completion.
- Then: superpowers:finishing-a-development-branch (merge to main per repo policy —
  no PRs; delete branch; document in deleted-branches.md).

---

## Standing orders for the executor

1. TDD: failing test → minimal code → green → commit. No skipped assertions ever.
2. Read the file you're about to modify IN FULL first. Match its idiom.
3. `shared/music` stays pure — no React, no fetch, no Date.now in logic paths.
4. Every new component/hook: structured logging at lifecycle points (CLAUDE.md).
5. Don't touch `apps/piano/config.yml` (stale stub — see MEMORY). Runtime config is
   `config/piano.yml`, cached at startup (restart dev server after edits).
6. Never commit real FKB passwords or PII in fixtures (use `test-user`).
7. If the sweep shows a failure you didn't cause, check it against baseline
   (`347 failed suites / 4 failed tests`) before investigating.
