# FHE Charades Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Track steps below.

**Goal:** A working remote-controlled six-person Charades game on the living-room FHE screen, including two preschoolers using image clues.

**Architecture:** Extend activity-party authoritative rules, focused Charades presentation, and Party Games launch. Compile an external YAML clue bank into pinned game content. Reuse screen-framework remote input, a controlled FamilySelector wheel, Gaming Timer, and existing media resolution.

**Tech Stack:** React, SVG, YAML, shared JavaScript rules, Vitest, Playwright, existing Plex content API.

**Spec:** docs/_wip/plans/2026-09-13-fhe-charades-design.md

## Global Constraints

- Three rounds; six participants; each person acts once per round, independently shuffled: 18 turns.
- One clue and 60 seconds per turn, configurable; reading waits indefinitely for remote OK/Enter.
- Casual mode has no scores, ranking, correctness questions, teams, or winner semantics; preserve existing competitive behavior.
- Household IDs, music source, clue content, and game settings belong in external YAML configuration.
- User_4 and User_5 use decoder images, others decoder text; six illustrated entries and 30 text entries in separate pools.
- Guessing music starts on Go and stops on every exit from guessing.
- Use structured logging, existing architecture boundaries, no touch requirement, and physical decoder validation reported honestly.

### Task 1: Authoritative casual turns and clue selection

**Files:** shared/gaming/rulesets/activity-party/index.mjs; new shared/gaming/rulesets/activity-party/charadesSelection.mjs; tests beside these files; backend/src/3_applications/gaming/runtime/GamingApplication.mjs and its test.

**Interfaces:** Definition fields `competition: false`, `turn_selection: seeded-rounds`, `clues_per_turn: 1`, `presentation: { image_participants: [...] }`, `guessing_music: { source, volume }`. Challenge image uses `decoder.image`. Project these fields. State carries `competition`, persisted `turn_order`, `challenge_index` (turn index), `clue_index` within turn, `clue_presentation`, `challenge`, `deadline`, and existing phases. Preserve `challenge_order` for older definitions. Casual finish/expiry goes to `challenge-complete` with no outcome judgment or score mutation. `challenge.next` advances and eventually completes; more than one configured clue pauses remaining per-turn budget while reading. Result has empty scores and completed outcome in casual mode, including resumed sessions.

- [ ] Add tests executing actual commands through all 18 turns. Assert each six-turn slice is a permutation, image turns draw six unique images, and text turns never consume images. Test seeded replay and different seeds, duplicate commands, early expiry rejection, multi-clue budget, projection settings, competitive regressions.
```js
expect(roundTurns.sort()).toEqual(seats.map(s => s.id).sort());
expect(new Set(imageClues).size).toBe(6);
expect(state.scores).toEqual({});
expect(state.phase).toBe('complete');
```
- [ ] Run `npx vitest run shared/gaming/rulesets/activity-party backend/src/3_applications/gaming/runtime/GamingApplication.test.mjs`; establish failures before implementation.
- [ ] Implement deterministic selection helpers, validation, casual transitions, and projection/result contracts. Reject missing eligible pools and invalid settings; never silently switch a preschooler to words.
- [ ] Run same tests, self-review scope and compatibility, commit only task files; write test evidence to task report.

### Task 2: Remote game presentation and reusable primitives

**Files:** frontend/src/modules/Gaming/experiences/charades/Charades.jsx and styles/tests; Gaming platform UI Timer and tests; Fitness Timer compatibility export; AppContainer/Apps/FamilySelector components/tests; Gaming environment PartyGamesApp, flowReducer, TeamSetup, PartyGamesResults and tests; screen-framework semantic input helper if required.

**Interfaces:** Consume Task 1 projected state/definition. `FamilySelector` supports supplied `members`, `winner`, `autoSpin`, `onComplete`, `embedded`, and configurable `durationMs`; preserve standalone behavior. Gaming `Timer` preserves Fitness props and adds controlled `deadline`, `durationMs`, `onComplete`. PartyGamesApp accepts `param`/`appPath`/explicit definition launch and preserves shell dismiss. Remote OK operates the focused control once per press through screen-framework; directional controls traverse all setup/results choices.

- [ ] Add failing tests for controlled wheel completion, Timer deadline/resume, casual Charades decoder/Go/reveal, direct definition selection, remote-only setup/results and absent competition UI.
```js
expect(screen.queryByText(/wins|score committed/i)).toBeNull();
expect(screen.getByRole('button', {name: /go/i})).toBeEnabled();
```
- [ ] Implement controlled wheel and timer with compatibility, then connect Charades phases. Automatically animate performer announcement, reveal encoded clue when wheel completes, wait for Go, hide clue during acting, expose neutral finish/reveal. Prevent repeated input and in-flight commands from crossing phases.
- [ ] Reuse segmented decoder text and improve image bubbles using actual SVG masks; show asset failure and retry. No plain answer labels during reading.
- [ ] Consume `gamingServices.music.start(config)` returning a cleanup function for phase-scoped background music; root implements this service in Task 3. Surface recoverable music errors. No music source constants in source.
- [ ] Run targeted Vitest tests, self-review and commit task files with report.

### Task 3: Authored bank, media, and FHE configuration

**Files:** backend/src/1_adapters/persistence/yaml/gaming/YamlGamingDefinitionStore.mjs and tests; relevant Gaming composition factory; frontend Gaming environment effects/GuessingMusic.js and tests plus PartyGamesExperience; external content/games/charades/choices.yml and images/rabbit.svg; external household gaming Charades rules/content and manifest; external FHE menu.

**Interfaces:** Content artifact declares `clue_bank: charades/choices.yml`. Definition-store constructor receives `contentGamesDir`; resolve and validate the relative bank beneath that root. Bank is `version: 1, clues: [{id,text,image?}]`; compile to challenges `{id,activity:'charades',prompt,decoder?:{image: public media URL}}` before hashing and pinning. Resolve media through configured repository boundary. Music service `start({source,volume}, {onError} = {})` returns cleanup; resolve playable tracks through existing content API and cancel stale resolution/playback.

- [ ] Add failing loader tests proving bank edits affect current content hash while pinned sessions stay unchanged, invalid IDs/path traversal/missing images fail, and YAML compiles to correct challenges. Add music tests for start/stop, stale resolution, source errors and next track.
- [ ] Implement loader injection and content/media wiring; music service uses the actual list/play API contract verified from source, starts a randomly selected track, and cleans up listeners/source on stop.
- [ ] Seed 30 text entries listed in spec, six image entries, original rabbit SVG. Back up external edited files. Configure six household participants, image IDs, casual settings, source supplied by user, 60 seconds and three rounds. Add active Charades menu launch without replacing other FHE items.
- [ ] Run loader/music unit tests and inspect configured catalog/definition/media through running backend; document actual external paths only in gitignored evidence.

### Task 4: Integration, full runtime verification, and deployment

**Files:** tests/live/flow/gaming/fhe-charades.runtime.test.mjs; docs/reference/gaming/party-games.md; plan progress and evidence artifacts.

- [ ] Build a browser test that enters the FHE route, opens Charades with remote keys, confirms six participants, traverses 18 turns without pointer input, asserts six unique image turns plus 12 word turns, proves indefinite reading, early finish, actual timeout, and neutral results/return. Test reload during a turn, held OK, and cleanup on exit separately. Use configured runtime URLs, no port constants.
- [ ] Run targeted rules/frontend/loader/music tests and frontend build. Investigate failures using systematic-debugging; preserve competitive tests and Fitness compatibility.
- [ ] Obtain task and whole-branch code reviews; fix material findings and rerun affected checks.
- [ ] Merge into main per project rules, run deployment gate before and after build, deploy when idle. Never claim deployed behavior from local source or mocked tests.
- [ ] Verify all 18 turns at the requested HTTPS FHE route against deployed backend, check actual Plex audio readiness/playback and all image responses, capture screenshots. Simulate red-filter optics and record actual physical-card testing as unverified unless available.
- [ ] Update reference docs, report concrete evidence and any remaining limitation; only complete goal after scope is verified.
