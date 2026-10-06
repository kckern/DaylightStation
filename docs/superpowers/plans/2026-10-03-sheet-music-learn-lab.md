# Sheet Music Learn Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the full score the Learn roadmap and run each selected numbered segment as a focused one- or two-system ExerciseRun lab with part-aware engraving, configurable progression, and MusicXML-tempo mastery.

**Architecture:** Resolve built-in, category, piece, user, and user-piece inputs into one immutable Learn plan. The score consumes that plan to render native segment overlays and recommendation state; the lab extracts a standalone MusicXML excerpt and delegates grading, sets, reps, timing, and persistence to ExerciseRun. Keep assessment identity stable across context rerenders and retain the existing revisioned Learn progress store.

**Tech Stack:** React 18, JavaScript, Vitest/Testing Library, OpenSheetMusicDisplay, SCSS, existing piano practice API/YAML persistence.

**Spec:** `docs/superpowers/specs/2026-10-03-sheet-music-learn-lab-design.md`

## Global Constraints

- The full score is the canonical roadmap; the lab hides all unrelated score content.
- Segments are numbered first and show their bar range second; an authored musical name is optional.
- Excerpts prefer one system and must never exceed two systems at the declared 1280×800 kiosk viewport.
- RH removes the lower staff, LH removes the upper staff, and together retains both.
- Mastery and Test Out always use 100% of the complete MusicXML tempo map.
- Every segment is selectable by default; sequential locking is opt-in at any configuration layer.
- All behavior is config-driven with overridable defaults; no piece, category, or user conditionals belong in UI components.
- ExerciseRun remains the grading/runtime engine, and its identity must survive MIDI/context rerenders.
- Existing unrelated Plex CLI working-tree changes must remain untouched.

## Review Focus

- A pickup, nonnumeric measure label, or noncontiguous printed numbering must still extract the canonical selected indices and display honest bar text.
- A mid-piece segment must inherit divisions, key, time, clefs, staves, transpose, and current tempo context from preceding measures.
- A score whose five dense bars cannot fit two readable systems must reject or repartition the generated segment rather than crop notation.
- A multi-part score with more than two staves must preserve explicitly selected parts and never assume every lower staff is LH.
- Invalid authored enrichment or an absent tempo must degrade predictably without stranding the learner or awarding false mastery.

---

### Task 1: Stabilize Learn Run Identity

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnRoadmap.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnRoadmap.test.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.component.test.jsx`

**Interfaces:**
- Consumes: `ExerciseRun`'s existing stable `score` prop contract.
- Produces: a memoized score-run descriptor `{...score, measures, rangeIndices, activeParts}` whose identity changes only when the score, segment boundaries, or selected parts change.

- [ ] **Step 1: Write failing rerender tests**

Add `keeps the same score descriptor while MIDI/context state rerenders the lab` and an ExerciseRun regression that asserts one runtime installation across note-on/note-off rerenders.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnRoadmap.test.jsx src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.component.test.jsx` from `frontend/`.

Expected: descriptor identity/runtime-installation assertion fails because `LearnPassageSession` creates a fresh score object.

- [ ] **Step 3: Memoize the score-run descriptor**

Use `useMemo` in `LearnPassageSession`; do not suppress ExerciseRun dependencies or special-case active notes.

- [ ] **Step 4: Run the focused tests and verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnRoadmap.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnRoadmap.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.component.test.jsx
git commit -m "fix(piano): preserve Learn assessment runtime"
```

### Task 2: Extract Standalone MusicXML Segments

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/scorePassageXml.js`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/scorePassageXml.test.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ScorePassage.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ScorePassage.test.jsx`

**Interfaces:**
- Produces: `excerptMusicXml(musicXml: string, range: {start:number,end:number} | null): {musicXml:string, originalMeasureIndices:number[], inheritedTempoMap:object[]}`.
- Consumes later: ScorePassage engraves `result.musicXml` and remaps extracted local measure indices through `originalMeasureIndices`.

- [ ] **Step 1: Write failing extraction tests**

Cover exactly five selected bars across every `<part>`, inherited attribute categories, a tempo instruction before the range, removed `new-system`/`new-page`, pickup/non-numeric printed labels selected by canonical position, malformed XML fallback, and an out-of-range empty result.

- [ ] **Step 2: Run the utility and ScorePassage tests and verify RED**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Exercises/scorePassageXml.test.js src/modules/Piano/PianoKiosk/modes/Exercises/ScorePassage.test.jsx`.

Expected: missing utility/excerpt assertions fail; existing dimmed-context behavior fails the new contract.

- [ ] **Step 3: Implement `excerptMusicXml`**

Parse with `DOMParser`, select measures by zero-based canonical position, synthesize the effective opening `<attributes>` and tempo direction per part, preserve printed measure attributes, remove inherited forced breaks, serialize with `XMLSerializer`, and return an explicit invalid/empty result instead of silently engraving the full score.

- [ ] **Step 4: Wire ScorePassage to the excerpt**

Compile the whole excerpt while remapping local geometry to original canonical indices; remove out-of-range dimming and report invalid/empty excerpts through `onUnrunnable`.

- [ ] **Step 5: Run focused tests and verify GREEN**

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Exercises/scorePassageXml.js frontend/src/modules/Piano/PianoKiosk/modes/Exercises/scorePassageXml.test.js frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ScorePassage.jsx frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ScorePassage.test.jsx
git commit -m "feat(piano): engrave focused Learn excerpts"
```

### Task 3: Enforce Lab Engraving Geometry and Parts

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ScorePassage.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/Exercises.scss`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.measure.test.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ScorePassage.test.jsx`

**Interfaces:**
- Produces: `fitPassageLayout({ layout, scale, minScale, maxSystems }): {accepted:boolean,nextScale:number|null}` and a ScorePassage `activeParts` engraving filter.
- Consumes: `excerptMusicXml` from Task 2 and MusicXmlRenderer layout `staves[].system` geometry.

- [ ] **Step 1: Write failing geometry and part tests**

Assert a five-bar excerpt produces at most two unique systems at the declared 1280×800 kiosk viewport; a synthetic three-system first pass scales and re-engraves before publishing an expectation; below-minimum readability reports `passage-too-dense`; RH/LH output contains no inactive staff geometry; together and explicit third-part selection retain requested staves.

- [ ] **Step 2: Run focused unit and Chromium measurement tests and verify RED**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Exercises/ScorePassage.test.jsx src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.measure.test.jsx`.

- [ ] **Step 3: Implement system fitting and staff removal**

Re-engrave at a smaller bounded scale before publishing layout when system count exceeds two. Filter inactive MusicXML parts/staves before engraving; do not hide them with opacity or crop overflow.

- [ ] **Step 4: Verify GREEN at every measured viewport**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ScorePassage.jsx frontend/src/modules/Piano/PianoKiosk/modes/Exercises/Exercises.scss frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.measure.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ScorePassage.test.jsx
git commit -m "feat(piano): fit Learn labs to focused staves"
```

### Task 4: Resolve Layered Learn Plans

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/resolveLearnPlan.js`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/resolveLearnPlan.test.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/sheetMusicConfig.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/sheetMusicConfig.test.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/learnRoadmap.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/learnRoadmap.test.js`

**Interfaces:**
- Produces: `resolveLearnPlan({ defaults, category, piece, user, userPiece, score }): LearnPlan`.
- `LearnPlan`: `{revision, navigation:{sequential}, segments, ladder, testOut, tempoMap, tempoSource}` with numbered stable segment IDs and fully normalized rung values.
- Consumes later: ScorePlayer, score overlays, lab, and persistence use only `LearnPlan`.

ScorePlayer supplies layers from `sheetmusic.learn`, `sheetmusic.learn.categories[scoreMeta.category]`, `scoreMeta.learn ?? sheetmusic.learn.pieces[scoreMeta.id]`, `config.user?.piano?.learn`, and `config.user?.piano?.learn?.pieces?.[scoreMeta.id]`, respectively. Missing layers are empty objects.

- [ ] **Step 1: Write failing precedence and normalization tests**

Assert exact precedence, deep merging without prototype pollution, open navigation default, authored-boundary priority, invalid-enrichment fallback, numbered labels/bar subtitles, single-staff rung omission, full-tempo-map percentages, invariant 100% mastery/Test Out, absent-tempo inferred fallback, and deterministic revision changes only for behavior-affecting fields.

- [ ] **Step 2: Run resolver/config tests and verify RED**

- [ ] **Step 3: Implement resolver and migrate existing defaults**

Keep UI-free pure functions. Preserve the current ladder as overridable defaults, adding explicit timed percentages and mastery invariants.

- [ ] **Step 4: Run tests and verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/resolveLearnPlan.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/resolveLearnPlan.test.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/sheetMusicConfig.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/sheetMusicConfig.test.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/learnRoadmap.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/learnRoadmap.test.js
git commit -m "feat(piano): resolve layered Learn plans"
```

### Task 5: Make the Score the Roadmap

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnSegmentRail.jsx`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnSegmentRail.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnPassageLayer.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnPassageLayer.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/SheetMusic.scss`

**Interfaces:**
- Consumes: `LearnPlan.segments` from Task 4 and existing engraved measure geometry.
- Produces: score-native accessible segment controls and optional compact rail; selection writes the existing `learnPassage`/`learnRung` route state.

- [ ] **Step 1: Write failing score-map tests**

Assert numbered segment controls, bar-range subtitle, optional authored name, independent Next/in-progress/mastered/tested-out/locked states, all segments selectable by default, sequential lock behavior, keyboard/touch labels, and rail collapse without losing score controls.

- [ ] **Step 2: Run layer/ScorePlayer tests and verify RED**

- [ ] **Step 3: Replace generic passage cards with score-native controls**

Retain `LearnRoadmap` only as a compatibility surface for `roadmap:false`; make overlays and the compact rail the default Learn navigation.

- [ ] **Step 4: Run tests and verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnSegmentRail.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnSegmentRail.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnPassageLayer.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnPassageLayer.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/SheetMusic.scss
git commit -m "feat(piano): make the score the Learn roadmap"
```

### Task 6: Build the Focused Lab Shell and Achievement Return

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnLab.jsx`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnLab.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnRoadmap.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/SheetMusic.scss`

**Interfaces:**
- Consumes: one resolved segment/rung, ExerciseRun, and ScorePlayer's stored scroll/selection anchor.
- Produces: full-screen focused lab with `onClose`, `onRungPassed`, `onMastered`, and a one-shot return achievement keyed by segment ID.

- [ ] **Step 1: Write failing interaction tests**

Assert the full score unmounts/hides completely in lab, the close control says `Close` with an accessible segment label, no “roadmap” copy appears, exit restores the prior score anchor, rung completion advances according to config, and return animates only the affected segment once.

- [ ] **Step 2: Run LearnLab/ScorePlayer tests and verify RED**

- [ ] **Step 3: Implement LearnLab and score return state**

Move the existing ExerciseRun adapter into LearnLab; keep notation dominant and expose only segment, rung, tempo, set, and rep chrome.

- [ ] **Step 4: Run tests and verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnLab.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnLab.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnRoadmap.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/SheetMusic.scss
git commit -m "feat(piano): add focused Learn lab flow"
```

### Task 7: Drive Timed Rungs from the MusicXML Tempo Map

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnRoadmap.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.timed.test.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnLab.test.jsx`

**Interfaces:**
- Consumes: normalized rung `{mode:'cued', tempoPercent:number, mastery:boolean}` and excerpt expectation tempo map.
- Produces: an assessment tempo map scaled for intermediate work or unchanged at 100% for mastery/Test Out, plus the existing metronome/count-in/cursor presentation.

- [ ] **Step 1: Write failing multi-tempo tests**

For a two-entry tempo map, assert 60% scales both entries, subsequent configured sets advance percentages, learner speed controls stay within plan bounds, mastery/Test Out reject any value other than 100%, and missing tempo displays the inferred-fallback label.

- [ ] **Step 2: Run timed/LearnLab tests and verify RED**

- [ ] **Step 3: Implement tempo-map scaling at assessment preparation**

Do not mutate the engraved/source expectation. Include effective percentage and tempo source in trace events and visible lab status.

- [ ] **Step 4: Run tests and verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnRoadmap.jsx frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.jsx frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.timed.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnLab.test.jsx
git commit -m "feat(piano): train Learn segments through score tempo"
```

### Task 8: Preserve Compatible Progress and Verify the Complete Journey

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/usePracticeRecord.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/usePracticeRecord.test.js`
- Modify: `backend/src/4_api/v1/routers/piano.practice.test.mjs`
- Modify: `docs/features/piano.md`

**Interfaces:**
- Consumes: `LearnPlan.revision`, stable authored/generated segment IDs, rung IDs, and existing practice API deep merge.
- Produces: compatible progress retention for unchanged segment/ladder identities and clean invalidation for changed boundaries/meaning.

- [ ] **Step 1: Write failing persistence tests**

Assert harmless name changes retain progress, boundary/ladder changes invalidate only incompatible Learn progress, guest local progress follows the same rules, deep merges retain sibling segments, and malicious keys remain rejected.

- [ ] **Step 2: Run frontend/backend persistence tests and verify RED**

- [ ] **Step 3: Implement compatibility metadata and update documentation**

Store plan revision plus per-segment boundary/rung fingerprints; migrate current revision-only records on first compatible write.

- [ ] **Step 4: Run all feature verification**

Run focused Learn, ScorePassage, ExerciseRun, ScorePlayer, config, persistence, and backend practice tests; then run the production frontend build and targeted lint for changed files.

Expected: zero failures; build exits 0. Record repository-wide pre-existing lint separately if it remains noisy.

- [ ] **Step 5: Run a real-browser journey**

Verify `score → Segment 1 lab → RH/LH/together/timed → close → same score position`, one/two-system bounds, removed inactive staff, moving timed cursor, 100% mastery tempo, Test Out shortcut, open and sequential navigation, and one-shot mastery return animation.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/usePracticeRecord.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/usePracticeRecord.test.js backend/src/4_api/v1/routers/piano.practice.test.mjs docs/features/piano.md
git commit -m "test(piano): verify score-to-lab Learn journey"
```

### Task 9: Review, Merge, and Deploy Safely

**Files:**
- Review all files changed by Tasks 1–8.

**Interfaces:**
- Consumes: completed implementation and verification evidence.
- Produces: reviewed merge commit and, only when explicitly requested, a gated production deployment.

- [ ] **Step 1: Request whole-branch review**

Review against the approved spec, with special attention to runtime identity, MusicXML state inheritance, staff removal, tempo invariants, and progress compatibility.

- [ ] **Step 2: Address findings test-first and rerun verification**

- [ ] **Step 3: Merge using the repository's approved branch workflow**

- [ ] **Step 4: If deployment is requested, run `./scripts/deploy-gate.sh` as a standalone command**

If clear, build, re-run the standalone gate, replace via `sudo deploy-daylight`, and verify container health plus `/build.txt`. Never interrupt an active piano session and never manually reload the piano tablet.
