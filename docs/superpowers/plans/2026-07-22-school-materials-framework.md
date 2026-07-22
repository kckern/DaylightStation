# School Materials Framework (Sub-project 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the materials framework — source adapters normalised to `Material { units[] }`, closed pedagogy categories, quiz gates, per-child progress and sequential locking — proven against BOTH the video case (Art/Kids courses) and the audio case (Shakespeare Tales, I Survived), surfaced as category sections in the School home grid.

**Architecture:** Spec `docs/superpowers/specs/2026-07-22-school-materials-framework-design.md` §2–§9 governs. Three layers: sources (`3_applications/school/sources/`) produce normalised materials; `2_domains/school/` holds the closed category table and pure lock/completion policy; the school router exposes catalog/units/progress; the frontend adds category sections to the 2a home grid with a grid → detail → player flow wrapping the shared Player from the consumer side.

**Tech Stack:** Node ESM backend (DDD layers), vitest (`tests/isolated/**` and frontend co-located tests), React + SCSS frontend, shared `modules/Player`.

## Global Constraints

- Spec §3 category table is **verbatim law** — closed set in code, config only selects by name. Unknown/omitted `category` → `reference` + a **warning log naming the source and bad value** (convention 6).
- `UserVideoProgressStore`: parameterise app name + filename only; **Piano defaults (`piano`, `video-progress`) and behavior unchanged; Piano tests pass untouched.** School treats the store as playhead/percent only — `completedAt`/`engaged`/`userWatched` are INERT for School (spec §6); School completion is computed in `materialPolicy.mjs`.
- `PlexShowSource` may consume `FitnessPlayableService.getPlayableEpisodes(showId, householdId)` for ordering/metadata/resume but must **discard its watch fields** (`isWatched`, `viewCount` — Plex-account-global, leaks across children; spec §4).
- **Never modify** `modules/Player`, `lib/Player`, `modules/Piano` (except nothing — Piano is untouched entirely; the store lives in `3_applications/piano/` and is the single shared file), `2_domains/gameshow`, `2_domains/journalist`.
- Frontend logging via `schoolLog` facade only; backend logging via injected `logger` (structured event names `school.materials.*`). No raw `console.*`.
- Touch UI: ≥64px targets, no animation/transitions, no drag, no unicode-glyph icons; SCSS extends `School.scss` with the existing `--school-*` tokens and BEM blocks.
- Backend school tests: `npx vitest run tests/isolated/domain/school/ tests/isolated/application/school/ tests/isolated/api/school/`. Frontend: `npx vitest run frontend/src/modules/School/`. Piano regression: `npx vitest run tests/unit/applications/piano/GetCourseProgress.char.test.mjs tests/unit/applications/piano/GetPlayableUnits.char.test.mjs` plus any test file that imports `UserVideoProgressStore` (find them: `grep -rl UserVideoProgressStore tests/`).
- **Named deferrals (documented, not silent):** (a) video forward-clamp (§7) — the quiz gate is the completion enforcement; clamp is anti-skip UX, deferred; (b) `ReadalongSource` and the readalong *gate-step UI* — no configured source or bank uses them yet; bank validation DOES accept+return `readalong` now so banks can carry it, and a gate runner encountering a readalong step logs `school.materials.gate-step-unsupported` (warn) and treats the step as unsatisfied (fail-closed, never auto-passes). Both recorded in README §3 as not-built.
- Commit per task. Worktree; merge to main at the end; deploy gates HALT.

## Interface Contracts (all tasks)

```
Material  { id:'plex:619844', title, poster /*plex thumb path or null*/,
            source:'plex-album'|'plex-show', medium:'audio'|'video',
            category:'course'|'reference'|'listening', durationMs|null,
            unitCount|null }
Unit      { id:'plex:619845', index /*1-based*/, title, durationMs|null,
            group /*season label or null*/ }
UnitState { ...Unit, percent|null, playhead|null, completed:bool,
            locked:bool, current:bool, lockReason:string|null,
            quiz:{bankId}|null }
```

API (extends `createSchoolRouter`; all under `/api/v1/school`):
- `GET /materials` → `{ sections:[{category,label}], materials:[Material] }` — sections derived from categories present among configured sources, labels `{course:'Courses', reference:'Reference', listening:'Listening'}`, in that fixed order.
- `GET /materials/:materialId/units?userId=` → `{ material:Material, units:[UnitState] }` (userId optional; absent → no per-user fields, nothing locked-by-progress is computed as if a fresh user: `percent:null`, completion false, locks per category rule).
- `PUT /materials/:materialId/units/:unitId/progress` body `{userId, percent, playhead, durationMs}` → `{ok:true}`. No `userId` → `{ok:true, recorded:false}` and **no write** (guests record nothing).

Config (data volume `data/household/config/school.yml`, replaces `courses:` block — written at deploy, Task 8): exactly the spec §3 `materials:` block (sources: Shakespeare Tales `plex-album` `plex:619778` course; Art Lessons `plex-show` `plex:685094` course; Kids Courses `plex-show` `plex:685095` course; I Survived `plex-album` `plex:483195` listening; scalars `completion_threshold_percent: 90`, `quiz_pass_percent: 80`).

---

### Task 1: Domain — categories + materialPolicy

**Files:**
- Create: `backend/src/2_domains/school/categories.mjs`
- Create: `backend/src/2_domains/school/materialPolicy.mjs`
- Modify: `backend/src/2_domains/school/index.mjs` (re-export both, grouped per the barrel's existing style)
- Test: `tests/isolated/domain/school/categories.test.mjs`, `tests/isolated/domain/school/materialPolicy.test.mjs`

**Interfaces:**
- Produces `CATEGORIES` — the spec §3 table **verbatim** (course/reference/listening with `sequential`, `gated`, `completion`, `credit`).
- Produces `resolveCategory(name, { logger, sourceLabel })` → `{ key, def }`; unknown/missing name → `{key:'reference', def:CATEGORIES.reference}` + `logger.warn('school.materials.category-unknown', { source: sourceLabel, category: name })`. Known name → no warning.
- Produces pure functions (no I/O, no Date):
  - `orderUnits(units)` → sorted copy by `index`.
  - `unitCompleted({ percent, gateSatisfied }, categoryDef, { completionThresholdPercent })` → bool. `completion:[]` → false (nothing completes). `'played'` → `percent >= threshold`. `'gate'` → `gateSatisfied` (a unit with no gate passes `gateSatisfied: true` — callers resolve that; this function just folds the list; ALL listed conditions must hold).
  - `annotateLocks(orderedUnits, completedFlags, categoryDef)` → array of `{locked, current, lockReason}` parallel to units. Non-sequential → all unlocked, none current. Sequential: first incomplete unit is `current`; every unit after it `locked` with `lockReason` naming the blocker: if the current unit has a quiz gate unsatisfied, `Pass the quiz for “<currentTitle>” first`; otherwise `Finish “<currentTitle>” first`. (Pass `gateInfo` per unit — `{hasQuiz:bool, gateSatisfied:bool}` — as a fourth arg so the reason can be computed.) All units complete → none locked, none current.
  - `quizSessionPassed(attempts, { bankId, itemCount, passPercent })` → bool. Filter `mode==='quiz' && bankId` matches; group by `sessionId`; a session's score = distinct correct `itemId`s ÷ itemCount × 100; passed if ANY session ≥ passPercent. Empty attempts / zero itemCount → false.

**Steps:** TDD per function. Test cases that MUST exist: unknown-category warns + falls back; known category does not warn; `completion:[]` never completes even at 100%; `['played','gate']` requires both; lock scan on 5 units with unit 3 first-incomplete → 1,2 unlocked, 3 current, 4,5 locked with reason naming unit 3; quiz-gate reason variant; single-unit material → no locks (spec §4 arity); non-sequential → nothing locked; `quizSessionPassed` — two sessions (40%, 80%) with pass bar 80 → true; repeated correct answers to ONE item in a 4-item bank → 25%, not 100% (distinct-item rule); mode 'flashcard' attempts ignored. Run: `npx vitest run tests/isolated/domain/school/`. Commit `feat(school): materials domain — closed categories and lock/completion policy`.

---

### Task 2: Bank backlinks + progress store parameterisation

**Files:**
- Modify: `backend/src/2_domains/school/questionBankValidation.mjs` — accept optional `unit` and `readalong` (non-empty strings when present, else validation error naming the field), **and include both in the returned bank object** (the whitelist return is the trap — spec §5).
- Modify: `backend/src/3_applications/piano/UserVideoProgressStore.mjs` — constructor gains `{ app = 'piano', filename = 'video-progress' }`; `#userDir` uses `apps/${app}`; the yaml path uses the filename param. **No other behavior change; config lookup stays piano's** (School never calls the threshold path — document with one comment line that School consumers use raw playhead/percent only).
- Test: extend `tests/isolated/domain/school/questionBankValidation.test.mjs`; add `tests/isolated/application/school/materialProgressStore.test.mjs` (constructs the store with `app:'school', filename:'material-progress'` against a temp dir via its config-service seam, writes percent/playhead, reads back raw; asserts piano defaults unchanged when params omitted).

**Interfaces:** later tasks construct `new UserVideoProgressStore({ configService, app:'school', filename:'material-progress' })` and use `record()`/raw read only. Bank objects now carry `unit`/`readalong` through `listBanks`/`getBank`.

**Steps:** TDD. Then Piano regression per Global Constraints (`grep -rl UserVideoProgressStore tests/` and run every hit + the two char tests) — all green, untouched. Commit `feat(school): bank unit/readalong backlinks; progress store app+filename params`.

---

### Task 3: Sources — PlexAlbumSource + PlexShowSource

**Files:**
- Create: `backend/src/3_applications/school/sources/PlexAlbumSource.mjs`
- Create: `backend/src/3_applications/school/sources/PlexShowSource.mjs`
- Test: `tests/isolated/application/school/plexAlbumSource.test.mjs`, `plexShowSource.test.mjs` (mocked collaborators, no network)

**Interfaces:** both expose `listMaterials(rootPlexId)` → `Material[]` (no units) and `getMaterial(materialPlexId)` → `Material & { units: Unit[] }`. Ids in/out use bare rating keys internally, `plex:<ratingKey>` externally.
- `PlexAlbumSource({ plexClient, logger })` — `plexClient.children(ratingKey)` → array of Plex metadata children (the constructor-injected seam; Task 5 wires it to the real adapter). artist→albums for list; album→tracks for units (`index` from track `index`, fallback array position +1; `durationMs` from track `duration`). **Album `duration` is absent in Plex — material.durationMs = sum of track durations** (spec §4 gotcha). `unitCount` from track count on getMaterial; on listMaterials use child `leafCount` if present else null. `poster` = album `thumb` or null.
- `PlexShowSource({ fitnessPlayableService, plexClient, logger, householdId = null })` — `listMaterials(collectionId)`: `plexClient.children(collectionId)` → shows. `getMaterial(showId)`: `fitnessPlayableService.getPlayableEpisodes(showId, householdId)` → map episodes to Units (`index` = absolute position in returned order, `group` = season/parent title field present on the playable item, `durationMs`), **omitting every watch-state field**. A test MUST assert the mapped units carry no `isWatched`/`watched`/`viewCount` keys.

**Steps:** TDD with fixture children shaped like real Plex responses (16-album artist, 5-track album with `index`; a 1-track album — the I Survived arity case; a 2-season show playable list). Run isolated application school tests. Commit `feat(school): plex album and show material sources`.

---

### Task 4: Use-cases — catalog, units, gate fold

**Files:**
- Create: `backend/src/3_applications/school/GetMaterialCatalog.mjs`
- Create: `backend/src/3_applications/school/GetMaterialUnits.mjs`
- Test: `tests/isolated/application/school/getMaterialCatalog.test.mjs`, `getMaterialUnits.test.mjs`

**Interfaces:**
- `GetMaterialCatalog({ sources, config, logger })` — `sources` = `{ 'plex-album': instance, 'plex-show': instance }`; `config` = the `materials` block (`{ sources:[...], completion_threshold_percent, quiz_pass_percent }`). `execute()` → `{ sections, materials }` per the API contract: walks configured source entries, `listMaterials(root)`, stamps `source`/`medium`/`category` (via `resolveCategory` — the warn path lives here), aggregates. A source entry whose adapter throws logs `school.materials.source-failed` (error, with label) and is skipped — one bad source must not blank the catalog.
- `GetMaterialUnits({ sources, config, progressStore, bankIndex, attemptsReader, logger })` — `execute({ materialId, sourceKey, category, userId })` → `{ material, units: UnitState[] }`. Flow: source.getMaterial → orderUnits → per-unit: progress (store raw read for userId; null-safe when absent), quiz gate = `bankIndex.byUnit(unitId)` → if bank exists, `gateSatisfied = quizSessionPassed(attemptsReader.read(userId), { bankId, itemCount, passPercent })` (no userId → false); no bank → gateSatisfied true; `unitCompleted` fold; `annotateLocks`. `bankIndex` is a tiny injected helper built from `listBanks()` output filtering banks with `unit` (build it in this file, export for Task 5).
- Resolution of `materialId → sourceKey/category`: catalog entries carry them; the router passes them as query params from the client OR the use-case re-derives by walking config sources' `listMaterials` — **derive server-side via a `findSource(materialId)` helper that walks configured roots' cached `listMaterials`** (correctness over cleverness; a 60s in-memory TTL cache on listMaterials results inside GetMaterialCatalog, shared via the container, keeps this cheap — plex requests serialize app-wide, do not fan out).

**Steps:** TDD with stub sources/store/attempts. Cases that MUST exist: ungated unit completes on played alone; quiz-gated unit at 100% watched but no passing session stays incomplete AND locks successors (R2.5); guest (`userId` absent) gets `percent:null`, nothing recorded-based, locks computed as fresh user; `reference` material — never locked, never completed; category-unknown source lands in reference section; failing source skipped with error log, catalog still returns others. Run isolated application school suite. Commit `feat(school): material catalog and unit-state use-cases with quiz gate fold`.

---

### Task 5: Wiring + router endpoints

**Files:**
- Modify: `backend/src/4_api/v1/routers/school.mjs` — the three endpoints per the API contract (thin shells, `wrap()` idiom, same error mapping as existing routes).
- Modify: wherever `createSchoolRouter`/`schoolService` are constructed (find: `grep -rn "createSchoolRouter" backend/src/`) — build the materials graph there: real `plexClient` (adapt from `PlexAdapter` or the fetch seam `FitnessPlayableService` uses — smallest adapter exposing `children(id)`), `FitnessPlayableService` instance already constructed for the app (reuse the existing instance — do NOT new one up if one is injectable), `UserVideoProgressStore` with `{app:'school', filename:'material-progress'}`, config from `getHouseholdAppConfig(null,'school').materials` (missing block → router serves empty catalog `{sections:[],materials:[]}` and logs `school.materials.config-missing` warn once — the panel must not 500 before Task 8 deploys config).
- Test: extend `tests/isolated/api/school/schoolRouter.test.mjs` — the three endpoints against stub use-cases (shapes, guest no-write path, 404 unknown material, empty-config catalog).

**Interfaces:** consumes Tasks 1–4 exactly as specified. Produces the live HTTP surface Task 6 consumes.

**Steps:** TDD on router tests; then full backend school suites green. Commit `feat(school): materials endpoints wired into the school router`.

---

### Task 6: Frontend — sections from catalog + grid/detail

**Files:**
- Modify: `frontend/src/modules/School/schoolApi.js` — `materials()`, `materialUnits(materialId, userId)`, `unitProgress(materialId, unitId, body)` following the existing fetch-wrapper idiom.
- Modify: `frontend/src/modules/School/home/sections.js` — export `sectionsFromCatalog(catalogSections)` → `[...SECTIONS, ...catalogSections.map(s => ({ id:`cat:${s.category}`, label:s.label, hint:CATEGORY_HINTS[s.category] }))]` with hints `{course:'Watch, listen, and pass the quiz', reference:'Look things up', listening:'Stories and audiobooks'}`.
- Modify: `frontend/src/modules/School/SchoolApp.jsx` — fetch catalog once on ready (`schoolApi.materials()`), derive sections; `section?.startsWith('cat:')` renders `<MaterialsSection category={...} materials={filtered} …/>`. Catalog fetch failure → home still renders built-ins (log `schoolLog.bank`-style warn via a new `schoolLog.materials` category).
- Modify: `frontend/src/modules/School/schoolLog.js` (+test) — add `materials: (detail, data) => emit('materials', detail, data)` and `materialsError` at error level.
- Create: `frontend/src/modules/School/materials/MaterialGrid.jsx` — poster/title/meta tiles (`unitCount`, duration rendered as `~N min`), tap → detail.
- Create: `frontend/src/modules/School/materials/MaterialDetail.jsx` — fetches units for `currentUser?.id`; renders ordered units grouped by `group` when present; locked units disabled + `lockReason` text; current unit highlighted; tap unlocked unit → `onPlay(unit)`.
- Create: SCSS blocks `.school-materials`, `.school-material-detail` in `School.scss` (tokens, ≥64px, no animation).
- Test: `frontend/src/modules/School/materials/MaterialGrid.test.jsx`, `MaterialDetail.test.jsx`, extend `SchoolApp.test.jsx` (catalog mock → category section tiles appear after built-ins; catalog failure → built-ins only; entering a category section shows its materials).

**Interfaces:** consumes API contract verbatim. Produces `MaterialsSection` internal flow: grid → detail → player; header back (2a) returns home from anywhere in the section; internal back affordances live in the section body (a `‹ All <label>` row on detail/player, 64px). Identity: unclaimed user tapping a `course` unit → `openPicker()` with a local pending-launch mirroring SchoolShell's banks pattern; explicit guest + `course` → notice `Sign in for courses — guests get the listening shelf.`; guest + `listening` plays without recording.

**Steps:** TDD. Full School frontend suite green. Commit `feat(school): materials sections — catalog-driven tiles, grid and detail`.

---

### Task 7: Frontend — material player + quiz handoff

**Files:**
- Create: `frontend/src/modules/School/materials/SchoolMaterialPlayer.jsx` — wraps the shared Player **modelled on `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx`** (lazy Player import, `usePlayerController`, boundary component — copy the *shape*, import nothing from `modules/Piano`). Plays a unit by plex id (audio and video both route through the shared Player exactly as the exemplar does for video). On progress ticks (the controller's progress callback): throttle to ≤1 write per 10s → `schoolApi.unitProgress(...)` with `{userId, percent, playhead, durationMs}` only when a user is claimed. On ended: if the unit has `quiz`, hand off to the existing `QuizRunner` with the bank (fetch via `schoolApi.bank(quiz.bankId)`); on quiz exit (pass or not) return to detail and refetch units (lock state may have changed). No quiz → return to detail + refetch.
- Modify: `MaterialDetail.jsx`/section plumbing from Task 6 to mount the player.
- Test: `frontend/src/modules/School/materials/SchoolMaterialPlayer.test.jsx` — mock the Player module; assert: progress writes throttled and only-when-claimed; ended-with-quiz mounts QuizRunner with the fetched bank; ended-without-quiz calls the return callback; guest never writes progress.

**Interfaces:** consumes Task 6's section flow and the existing `QuizRunner bank/onExit` contract (see `SchoolApp.jsx` usage).

**Steps:** TDD with module mocks. Full School frontend suite + `cd frontend && npx vite build` (tail must show `✓ built`). Commit `feat(school): material player with progress logging and quiz handoff`.

---

### Task 8 (controller-run): config, docs, deploy, verify

1. Merge to main (finishing-a-development-branch), record branch deletion.
2. **Data volume:** rewrite `data/household/config/school.yml` — replace the `courses:` block with the spec §3 `materials:` block (full-file base64 write-back + `chown node:node`, diff-verified; config is boot-cached so the deploy restart below picks it up).
3. Docs: README §2 gains "Materials framework" built subsection (present-tense; note the two named deferrals from Global Constraints as explicitly not built: forward-clamp, readalong source/step UI); §3 table row updated; §5 gotcha about `courses:` staging block replaced (it's live config now).
4. Deploy gates (HALT) → build → stop/rm → `sudo deploy-daylight` → `/build.txt` hash equals HEAD.
5. `node cli/fkb.cli.mjs reload` with `FKB_HOST=10.0.0.92:2323` + password from `data/household/auth/fullykiosk.yml`.
6. Headless verify (scratchpad playwright): `/screens/portal` home shows `Courses` and `Listening` tiles alongside `Quizzes & Flashcards`; entering Courses shows Shakespeare Tales & Art Lessons & Kids Courses posters; entering a Shakespeare play shows 5 acts with act 1 current and acts 2+ locked showing `Finish “…” first`; `/api/v1/school/materials` returns 2 sections + 20+ materials (16 Shakespeare + Art/Kids shows + 19 I Survived under Listening). Exit code captured.
7. Push main.

## Self-review notes (applied)

- Spec coverage: §2 model (T3/T4), §3 closed categories + fail-closed-loud (T1, warn path exercised in T4), §4 sources incl. duration-sum gotcha + arity case (T3), §5 gates — bank backlink return-whitelist fix (T2), quiz fold distinct-item rule (T1), no-bank-no-gate (T4), readalong accepted-not-run (T2 + deferral), §6 store-as-playhead-only + policy-owned completion (T2/T4), locking with named reasons (T1), §7 chrome minus named clamp deferral (T7), §8 category sections joining built-ins (T6), §9 file placement (all in `3_applications`/`2_domains` as corrected post-review).
- Credit (§6): completion *events* and coin earn are consumed by sub-projects 4/6; 2b records progress + derives completion on read. No completion-event store ships in 2b — deriving on read satisfies R6.5 (attempts remain the source of truth); revisit when curriculum lands (OPEN-C).
- Type consistency: `durationMs` everywhere (not `duration`); `cat:` section-id prefix; store filename `material-progress`.
