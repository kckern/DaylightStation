# Office Course Sequence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the office course slot advance from Abundance to Nietzsche to Maps of Meaning, then to another unfinished office-menu course, while removing Bob Iger from that menu.

**Architecture:** Add a pure course-sequence selector over resolved course children and shared media progress, then expose it through the existing list adapter/program resolver. Keep ordered courses and fallback menu membership in content YAML; do not add frontend state or a second progress store.

**Tech Stack:** Node.js ESM, Vitest, YAML content lists, existing ContentRegistry/ListAdapter/QueueService and media-progress ports

**Spec:** `docs/superpowers/specs/2026-10-06-office-course-sequence-design.md`

## Global Constraints

- Completed courses never relax back to their first lesson in this program slot.
- Course completion uses existing duration-aware watched rules and shared media progress.
- The office course slot retains 2x playback.
- Exhausting both ordered and fallback pools skips only this slot.
- Manual browsing behavior is unchanged.
- No host-specific paths enter reference documentation.

## Review Focus

- Progress-store failure must return no selection, not restart a completed course; pin in Task 1.
- A resolvable container with zero children is unavailable, not completed; pin in Task 1.
- A course duplicated between ordered and fallback pools is evaluated once; pin in Task 1.
- A stale/non-container Plex ID must be rejected without blocking later valid courses; pin in Task 2.
- An exhausted course slot must not remove or reorder neighboring office-program items; pin in Task 3.

---

### Task 1: Pure course-sequence selection

**Files:**
- Create: `backend/src/2_domains/content/services/CourseSequenceService.mjs`
- Create: `backend/src/2_domains/content/services/CourseSequenceService.test.mjs`

**Interfaces:**
- Consumes: `QueueService.isWatched(item)` and resolved course records shaped as `{ id, status, items }`, where status is `available | missing | empty` and items carry progress.
- Produces: `CourseSequenceService.select({ ordered, fallback }): { courseId, item } | null` and `CourseSequenceService.uniqueCourseIds(orderedIds, fallbackIds): string[]`.

- [ ] **Step 1: Write failing selection tests**

Cover first unfinished course, in-progress-before-unwatched lesson selection, completed-course advancement, ordered-to-fallback advancement, deduplication, total exhaustion, missing course continuation, and empty-container refusal.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npx vitest run backend/src/2_domains/content/services/CourseSequenceService.test.mjs`

Expected: FAIL because `CourseSequenceService.mjs` does not exist.

- [ ] **Step 3: Implement the pure service**

Implement the two interfaces above. Never apply the generic watched-filter fallback. Throw a typed/identified selection error when the caller supplies `progressStatus: 'failed'`; Task 2 converts it to a closed slot and structured warning.

- [ ] **Step 4: Run the focused test and verify pass**

Run: `npx vitest run backend/src/2_domains/content/services/CourseSequenceService.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat(content): select across ordered course sequences`

### Task 2: YAML adapter and list-registry integration

**Files:**
- Create: `backend/src/1_adapters/content/list/CourseSequenceAdapter.mjs`
- Create: `backend/src/1_adapters/content/list/CourseSequenceAdapter.test.mjs`
- Modify: `backend/src/1_adapters/content/list/ListAdapter.mjs`
- Modify: the content registry/composition file that registers list source prefixes, identified by the existing `program`, `menu`, and `watchlist` registrations
- Test: existing `backend/src/1_adapters/content/list/ListAdapter.pickViaStrategy.test.mjs`

**Interfaces:**
- Consumes: `CourseSequenceService.select`, content registry `resolve(contentId)`, child adapters' `resolvePlayables(contentId)`, and media-progress `listProgress(storagePath)`.
- Produces: registered `course-sequence:` list source with `resolvePlayables('course-sequence:<name>'): Promise<Item[]>`, returning zero or one item.

- [ ] **Step 1: Write failing adapter contract tests**

Assert valid YAML resolution; malformed schema rejection; later-course continuation after missing/non-container IDs; empty-container warning and refusal; progress-read failure returning `[]`; ordered/fallback deduplication; and propagation of the selected lesson's playable fields.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run backend/src/1_adapters/content/list/CourseSequenceAdapter.test.mjs backend/src/1_adapters/content/list/ListAdapter.pickViaStrategy.test.mjs`

Expected: FAIL because the adapter/source is absent.

- [ ] **Step 3: Implement the adapter and registry wiring**

Load `content/lists/course-sequences/<name>.yml`; validate `courses`, `fallback.menu`, `fallback.strategy === 'first-unfinished'`, and `on_exhausted === 'skip'`; resolve children and enrich progress without Plex-specific calls. Emit structured warnings containing sequence and content ID.

- [ ] **Step 4: Run focused tests and verify pass**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat(content): resolve course-sequence list sources`

### Task 3: Office data and program integration

**Files:**
- Create: `{DAYLIGHT_DATA_PATH}/content/lists/course-sequences/office-lectures.yml`
- Modify: `{DAYLIGHT_DATA_PATH}/content/lists/programs/office-program.yml`
- Modify: the live office lecture-menu source found by tracing the current Bob Iger launch; if it is an Infinity-backed source, update it through `InfinityHarvester`'s supported write path rather than editing harvested cache
- Create or modify: integrated program-resolution fixture/test under `tests/integrated/flow/content/`

**Interfaces:**
- Consumes: `course-sequence:office-lectures` from Task 2.
- Produces: ordered IDs for `plex:649182`, `plex:447151`, and the exact Plex Lectures container titled `Maps of Meaning`; fallback points to the office lecture menu; office program course slot remains labeled `Masterclass` with `playbackrate: 2`.

- [ ] **Step 1: Trace and capture the live identifiers**

Use the live menu/launch endpoint and Plex exact-title lookup to identify Bob Iger's menu record and the Maps of Meaning container. Assert Maps of Meaning is a container in the Lectures library before writing YAML.

- [ ] **Step 2: Write the failing integrated test**

With Abundance complete and Nietzsche unfinished, assert the office program selects a Nietzsche lesson, retains surrounding program item order, and never emits an Abundance lesson. Add an exhausted-pool case asserting only the Masterclass slot is absent.

- [ ] **Step 3: Run the integrated test and verify failure**

Run: the narrow Vitest command for the test created in Step 2.

Expected: FAIL because office data still points directly to `plex:649182`.

- [ ] **Step 4: Reconcile live menu and program data**

Create the sequence YAML with concrete IDs, switch the program input, remove Bob Iger, and add Nietzsche (`plex:447151`) in the same menu position. Preserve unrelated menu fields and entries.

- [ ] **Step 5: Run integrated and adapter tests**

Run the Task 2 focused tests plus the Step 3 integrated command.

Expected: PASS.

- [ ] **Step 6: Commit**

Commit code-owned fixtures/tests/docs. Runtime household data is verified in place and committed only if that data root is version-controlled.

### Task 4: Documentation, production verification, and deployment

**Files:**
- Modify: `docs/reference/content/content-configuration.md`
- Modify: `docs/reference/content/content-progress.md`
- Modify: `docs/docs-last-updated.txt`

**Interfaces:**
- Consumes: final course-sequence schema and behavior from Tasks 1–3.
- Produces: generic reference documentation and live verification evidence.

- [ ] **Step 1: Document schema and completion semantics**

Document ordered courses, fallback menu, `first-unfinished`, `skip`, failure behavior, and the distinction from generic `sequential` fallback.

- [ ] **Step 2: Run verification**

Run focused tests, `npm run audit:layers`, `npm run check:parse`, and the smallest existing content integration suite covering list/program resolution.

Expected: all commands pass with no baseline regression.

- [ ] **Step 3: Commit documentation**

Commit: `docs(content): document course-sequence programs`

- [ ] **Step 4: Build and gate deployment**

Run `./scripts/build-daylight.sh`, then `./scripts/deploy-gate.sh`. If clear, replace the container using the documented local deployment commands; if active, wait and re-run the gate without overriding it.

- [ ] **Step 5: Verify production**

Confirm `/build.txt` names the new commit; resolve the live office program and verify its course is Nietzsche; open the live office lecture menu and verify Bob Iger is absent and Nietzsche present; inspect logs for configuration or progress failures.

- [ ] **Step 6: Final commit if the docs marker changed after prior commits**

Commit only the marker/reference changes belonging to this feature and preserve all pre-existing fitness worktree changes.
