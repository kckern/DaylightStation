# Piano Producer Overhaul — Delivery Status

**Date:** 2026-07-02
**Branch:** `feature/piano-producer-overhaul` (HEAD `cebfe47d5` at time of writing)
**Design:** [`2026-07-01-piano-producer-overhaul-design.md`](./2026-07-01-piano-producer-overhaul-design.md)
**Plan:** [`2026-07-01-piano-producer-overhaul-plan.md`](./2026-07-01-piano-producer-overhaul-plan.md)
**Architecture reference:** [`docs/reference/piano/producer.md`](../../reference/piano/producer.md)

The Producer mode of the Piano Kiosk was rewritten from a single-section
loop-jam into a jam-first, multi-instrument, section/arrangement-capable song
builder. All 27 tasks across the 9-phase plan are implemented and committed on
the feature branch.

> **Scope note:** the final whole-branch verification sweep and code review are
> tracked separately (not covered by this doc). This is the delivery ledger +
> the human/on-device checklist.

---

## Test totals

| Suite | Command | Result |
|---|---|---|
| Engine (pure, node:test) | `node --test shared/music/` | ~204 pass |
| Frontend (vitest, colocated) | per-file `npx vitest run … --config vitest.config.mjs` | ~1270 across the Piano sweep |
| API (jest, isolated) | `tests/isolated/api/piano-producer.test.mjs` | 26 pass |
| Flow (Playwright) | `tests/live/flow/piano/producer-happy-path.runtime.test.mjs` | 1 |

The `npm run test:isolated` sweep has a **pre-existing dirty baseline** (347
suites "failed to run" via a jest/vitest Symbol clash + 4 failing tests,
identical on `main`) — judge by the targeted commands above and by "no NEW
failures".

---

## Tasks delivered (27)

**Phase 0 — Hardware spikes**
- 0.1 MDG-400 GM capability probe (Test-mode `GmProbe`, result → `piano.yml`)
- 0.2 Browser GM synth spike (`gmSynth.js` on webaudiofont, self-hosted presets)

**Phase 1 — Engine (`shared/music/`)**
- 1.1 Harmonic timeline extraction (`harmonicTimeline.mjs`)
- 1.2 Union-consonance `stackable()` guardrail (`consonance.mjs`)
- 1.3 Melody-over-harmony fit scorer (`melodyFit.mjs`)
- 1.4 Per-layer channel + gain in the loop scheduler (`loopScheduler.mjs`)
- 1.5 Arrangement scheduler — sections/repeats/live jumps (`arrangementScheduler.mjs`)
- 1.6 Percussion constants + metronome pattern (`percussion.mjs`)

**Phase 2 — Enrichment + percussion library (CLI)**
- 2.1 Loop-enrichment CLI (`cli/loop-enrich.cli.mjs`)
- 2.2 Percussion (groove) ingest with feel detection (`cli/midi-ingest.mjs`)
- 2.3 Starter groove generator (`cli/make-starter-grooves.mjs`)

**Phase 3 — VoiceRouter (frontend)**
- 3.1 Tiered GM voice router (`producer/voiceRouter.js`)
- 3.2 Onboard + browser-synth voice tiers (`producer/tiers/*`, `noteTapFilter.js`)

**Phase 4 — Workspace + Mix**
- 4.1 Workspace reducer (`producer/workspaceReducer.js`)
- 4.2 Producer transport — bar-aligned, multi-channel (`useProducerTransport.js`)
- 4.3 Deterministic material glyphs (`MaterialGlyph.jsx`)
- 4.4 Shell rewrite — transport/stage/keys (`modes/Producer/Producer.jsx`)
- 4.5 DAW channel strips (`ChannelStrip.jsx`, `GainStrip.jsx`, `VoicePicker.jsx`)

**Phase 5 — Library surface**
- 5.1 Full-screen library with consonance guardrails (`LibraryBrowser.jsx`, `libraryRanking.js`)
- 5.2 Press-and-hold audition (`usePeek.js`)

**Phase 6 — Recording**
- 6.1 Loop capture engine — pass/take overdub (`useLoopCapture.js`)
- 6.2 Capture card + drum pads (`CaptureCard.jsx`)

**Phase 7 — Sections & arrangement**
- 7.1 Draft reducer — sections/arrangement verbs (`draftReducer.js`)
- 7.2 Song builder — structure rail + scene launch (`SongView.jsx`, `SongPicker.jsx`)

**Phase 8 — Persistence**
- 8.1 Piano producer loops/crate/songs API endpoints (`backend/.../piano.mjs`)
- 8.2 Save/load, crate, resume snapshot (`useProducerStore.js`, `useResumeSnapshot.js`)

**Phase 9 — Prefabs, polish, verification**
- 9.1 Prefab content + loader (`cli/make-piano-prefabs.mjs`, `usePrefabs.js`, `prefabHydrate.js`)
- 9.2 Playwright happy-path flow (`tests/live/flow/piano/producer-happy-path.runtime.test.mjs`)
- 9.3 Docs (this doc + the reference) — *in progress; verification sweep + code review separate*

---

## Pending human verification

These need on-device / manual confirmation before the feature is fully signed
off. They are **not** automatable from the dev workstation:

- Run the GM capability probe at the piano (`/piano/test/gm-probe`) and set
  `producer.voiceTiers.onboardGm` in piano.yml accordingly.
- Check GM synth latency/polyphony on the SM-T590 tablet (`/piano/test/gm-synth`).
- The manual jam-feel test: pick a chord loop → stack bass (with a bass voice) +
  a groove → adjust gains/mute/solo → transpose + tap-tempo → play along. On dev
  server AND the tablet.
- Record-a-groove feel test (drum pads + pass/take overdub) on the tablet; note
  the drum-mode double-sound on physical keys (piano+drum unless local control
  off — CC122 out of scope).
- Confirm `config.screensaver.deviceId` (yellow-room-tablet) + the manual
  Turn-off-screen button; note the wake caveat (after blackout, touch is dead —
  wake via a MIDI note or FKB REST; the connect-screen blackout is the riskiest
  since no BLE = no MIDI wake, hence the 2-tap confirm).
- Prefabs/grooves generators must be run for a fresh/other-household tree
  (content lives in Dropbox media, not git).
- The worktree needs its own backend/node_modules (was symlinked to main for the
  e2e run) — a real merge to main moots this.
- Product decision flagged: songs re-save creates a NEW record (immutable
  crystallize) rather than update-in-place — decide if update-in-place is wanted.
