# Exercise Library Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the dormant exercise corpus into two consumers — a `FitnessInstruction`
browse/build/run module in FitnessApp, and an anatomy/health shelf in SchoolApp — through one
shared adapter and domain.

**Architecture:** The corpus moves out of `media/apps/fitness/` to `media/library/exercise/`
because two apps read it. A CLI pre-builds a single index manifest (the corpus lives on a
cloud-synced tree where per-file reads can stall for minutes, so nothing may walk 1,287 YAML
files at boot). One adapter serves that manifest. `2_domains/exercise/` holds the shared
vocabulary; `2_domains/fitness/workout/` holds Fitness-only workout structure. School plugs in
through its existing pluggable `materials.sources` registry — one new file, no `SchoolApp.jsx`
edit.

**Tech Stack:** Node ESM (`.mjs`), Express, vitest (colocated `.test.mjs` / `.test.jsx`),
React + Mantine, Playwright for live flows, YAML via `#system/utils/FileIO.mjs`.

**Design doc:** `docs/_wip/plans/2026-08-11-exercise-library-design.md` — read it first.

---

## Before you start

**Work in a worktree.** Project convention is `git worktree` over branches for feature work
(see `CLAUDE.md` → Branch Management). REQUIRED SUB-SKILL:
use superpowers:using-git-worktrees.

```bash
git worktree add ../DaylightStation-exercise-library -b feat/exercise-library
```

**Sync first.** Local `main` is frequently behind the deployed homeserver tree. Follow the
sync procedure in `CLAUDE.local.md` before writing any code.

### Things you need to know about this codebase

- **Import aliases** (from `package.json` → `imports`): `#system/*` → `backend/src/0_system/*`,
  `#adapters/*` → `1_adapters`, `#domains/*` → `2_domains`, `#apps/*` → `3_applications`,
  `#api/*` → `4_api`, `#composition/*` → `5_composition`. Use these, never deep relative paths
  across layers. `npm run audit:layers` enforces the layering.
- **Layer rule:** dependencies point inward only. `2_domains/` imports nothing from
  `1_adapters/` or `3_applications/`. Domain code is pure — no file I/O, no clock reads.
- **File I/O** goes through `#system/utils/FileIO.mjs` (`loadYamlSafe`, `saveYamlToPathAtomic`,
  `listFiles`, `fileExists`, `ensureDir`, …). Do not `import fs` directly in adapters.
- **Paths** come from `ConfigService` (`getDataDir()`, `getMediaDir()`). Never hardcode an
  absolute path — this plan uses `{mediaDir}` / `{dataDir}` as placeholders.
- **Tests** are colocated `.test.mjs` beside the unit under test (see
  `backend/src/2_domains/school/attempt.test.mjs`). Run one with
  `npx vitest run <path> -t '<name>'`.
- **Frontend logging:** never use raw `console.*`. Use the framework in
  `frontend/src/lib/logging/`. New features must ship with log events — see `CLAUDE.md`
  → Logging.
- **Fitness UI convention:** interactive controls use `onPointerDown`, not `onClick` (the
  target is a large touchscreen; see the note at the top of `FitnessApp.jsx`).

---

## Phase 0 — Move the corpus and build the index

### Task 1: Move the corpus directory

**Files:**
- Move: `{mediaDir}/apps/fitness/library/` → `{mediaDir}/library/exercise/`

**Step 1: Verify nothing references the old path**

```bash
grep -rn "apps/fitness/library\|fitness/library" --include="*.mjs" --include="*.js" \
  --include="*.jsx" --include="*.yml" --include="*.md" . | grep -v node_modules
```

Expected: no output. If anything appears, stop and reconcile it before moving.

**Step 2: Size — ALREADY MEASURED, do not re-measure**

`437 MB across 5,352 files`; YAML is only `2.5 MB` of it (1,363 files) and media is the other
~434 MB. Full breakdown in the design doc's Risks section (risk 2).

**Never measure a cloud-mounted tree with local `du`** — it reports hydrated blocks, not real
size, and was wrong here by ~670x. Measure on the homeserver, where the same Dropbox tree is
local:

```bash
ssh homeserver.local 'du -sh <basePath>/media/apps/fitness/library'
```

**For local development, hydrate ONLY the YAML** — the 434 MB of images and video are never
needed to build the index, and pulling them down takes hours:

```bash
find "{mediaDir}/library/exercise" \( -name "*.yaml" -o -name "*.yml" \) -exec cat {} + > /dev/null
```

**Step 3: Move**

```bash
mkdir -p "{mediaDir}/library"
mv "{mediaDir}/apps/fitness/library" "{mediaDir}/library/exercise"
```

**Step 4: Verify structure survived**

```bash
ls "{mediaDir}/library/exercise"
```

Expected: `assets  equipment  exercises  hevy_videos  muscle_groups  muscles`

No commit — this is data outside the repo.

---

### Task 2: Index manifest builder — the shape test

This is the highest-risk component, so it is built first and test-driven.

**Files:**
- Create: `cli/exercise-library.cli.mjs`
- Create: `cli/exerciseLibraryIndex.lib.mjs`
- Test: `cli/exerciseLibraryIndex.test.mjs`
- Create fixture: `tests/_fixtures/exercise-library/` (see Step 1)

**Step 1: Build a tiny fixture tree**

Real corpus reads are too slow for tests. Create this by hand:

```
tests/_fixtures/exercise-library/
  exercises/push-up.yaml
  exercises/barbell-bench-press.yaml
  muscles/pectorals.yaml
  muscles/abs.yaml
  muscle_groups/chest.yaml
  equipment/barbell.yaml
  equipment/body-weight.yaml
```

`tests/_fixtures/exercise-library/exercises/push-up.yaml`:

```yaml
id: 11111111-1111-1111-1111-111111111111
name: Push-Up
slug: push-up
image: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
description: A bodyweight pressing movement.
target_groups:
  - chest
target_muscles:
  - pectorals
equipment:
  - body-weight
instructions:
  - Start in a plank position with hands under the shoulders.
  - Lower your chest toward the floor with elbows tracking back.
  - Press back to the start.
```

`tests/_fixtures/exercise-library/exercises/barbell-bench-press.yaml` — same shape, with
`slug: barbell-bench-press`, `target_groups: [chest]`, `target_muscles: [pectorals]`,
`equipment: [barbell]`, `id`/`image` as distinct uuids.

`tests/_fixtures/exercise-library/muscles/pectorals.yaml`:

```yaml
id: 33333333-3333-3333-3333-333333333333
name: Pectorals
slug: pectorals
group: chest
image: cccccccc-cccc-cccc-cccc-cccccccccccc
description: The chest pressing muscles.
full_description: |
  A longer anatomy essay used as School reader content.
```

`tests/_fixtures/exercise-library/muscles/abs.yaml` — **this one reproduces the taxonomy
defect**: `slug: abs`, `group: core`, and there is deliberately **no**
`muscle_groups/core.yaml`.

`tests/_fixtures/exercise-library/muscle_groups/chest.yaml`:

```yaml
id: 44444444-4444-4444-4444-444444444444
name: Chest
slug: chest
description: Chest muscle group.
muscles:
  - pectorals
```

`equipment/barbell.yaml` and `equipment/body-weight.yaml`: `id`, `name`, `slug`, `description`.

**Step 2: Write the failing test**

`cli/exerciseLibraryIndex.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import path from 'path';
import { buildExerciseIndex } from './exerciseLibraryIndex.lib.mjs';

const FIXTURE = path.resolve('tests/_fixtures/exercise-library');

describe('buildExerciseIndex', () => {
  it('indexes every exercise by slug', () => {
    const index = buildExerciseIndex(FIXTURE);
    expect(Object.keys(index.exercises).sort()).toEqual(['barbell-bench-press', 'push-up']);
    expect(index.exercises['push-up'].name).toBe('Push-Up');
    expect(index.exercises['push-up'].instructions).toHaveLength(3);
  });

  it('resolves the demo image uuid to an asset path', () => {
    const index = buildExerciseIndex(FIXTURE);
    expect(index.exercises['push-up'].image).toBe('assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.gif');
  });

  it('derives group membership from muscle records, not exercise hints', () => {
    const index = buildExerciseIndex(FIXTURE);
    // pectorals declares group: chest, so both chest exercises land there
    expect(index.byGroup.chest.sort()).toEqual(['barbell-bench-press', 'push-up']);
  });

  it('records unresolvable groups instead of throwing', () => {
    const index = buildExerciseIndex(FIXTURE);
    // muscles/abs.yaml declares group: core, but no muscle_groups/core.yaml exists
    expect(index.warnings).toContainEqual(
      expect.objectContaining({ kind: 'unknown-group', group: 'core' })
    );
    expect(index.byGroup.core).toBeUndefined();
  });

  it('indexes by muscle and by equipment', () => {
    const index = buildExerciseIndex(FIXTURE);
    expect(index.byMuscle.pectorals.sort()).toEqual(['barbell-bench-press', 'push-up']);
    expect(index.byEquipment.barbell).toEqual(['barbell-bench-press']);
  });

  it('carries the muscle anatomy essay through for School', () => {
    const index = buildExerciseIndex(FIXTURE);
    expect(index.muscles.pectorals.fullDescription).toContain('anatomy essay');
  });
});
```

**Step 3: Run it and confirm it fails**

```bash
npx vitest run cli/exerciseLibraryIndex.test.mjs
```

Expected: FAIL — `Cannot find module './exerciseLibraryIndex.lib.mjs'`.

**Step 4: Implement `buildExerciseIndex`**

`cli/exerciseLibraryIndex.lib.mjs`. Requirements:

- Read with `listFiles` + `loadYamlSafe` from `#system/utils/FileIO.mjs`.
- Walk `muscle_groups/`, `muscles/`, `equipment/`, then `exercises/`.
- **Group derivation:** for each exercise, map `target_muscles` → the muscle record → that
  record's `group`. Keep the group only if a `muscle_groups/<group>.yaml` exists. Ignore the
  exercise's own `target_groups` for membership (hint only).
- Every unresolvable reference (unknown group, unknown muscle, unknown equipment, missing
  asset) is recorded in `index.warnings` — **once per distinct defect, not once per
  reference.** A missing group referenced by 400 exercises is ONE entry carrying a `count`
  and an example referrer; per-reference rows would bloat the very manifest this module
  exists to keep small. Every warning uses the same skeleton, so a consumer can read "what
  was missing" generically: `{ kind, subject, referrer, referencedBy, count }`. The builder
  **never throws** — a corpus full of defects still yields a usable index.
- **Keyed maps must be `Object.create(null)`.** Slugs are third-party scraped strings; a
  record named `constructor` or `__proto__` against a plain object literal either throws or
  silently vanishes, breaking the never-throw contract.
- Emit `{ exercises, muscles, muscleGroups, equipment, byGroup, byMuscle, byEquipment,
  warnings, builtAt, version, assetsResolved }`. `assetsResolved` tells the adapter whether
  image paths are authoritative or guessed from a missing `assets/` dir.
- `builtAt` is passed in, not read from a clock inside the function — keeps it testable.

**Step 5: Run the test to verify it passes**

```bash
npx vitest run cli/exerciseLibraryIndex.test.mjs
```

Expected: 6 passing.

**Step 6: Commit**

```bash
git add cli/exerciseLibraryIndex.lib.mjs cli/exerciseLibraryIndex.test.mjs \
        tests/_fixtures/exercise-library
git commit -m "feat(exercise): index builder for the shared exercise corpus"
```

---

### Task 3: The CLI wrapper

**Files:**
- Create: `cli/exercise-library.cli.mjs`
- Modify: `package.json` (scripts)

**Step 1: Write the CLI**

Follow the conventions in the sibling CLIs (`cli/schoolcalc-catalog.cli.mjs`,
`cli/school-certify.cli.mjs`) — `cli/_bootstrap.mjs` for config, `cli/_output.mjs` for
reporting.

Commands:
- `build` — read `{mediaDir}/library/exercise`, write
  `{dataDir}/household/apps/fitness/exercise-index.yml` via `saveYamlToPathAtomic`, print
  counts and the full warning list.
- `validate` — build in memory, print warnings, exit non-zero if any exercise resolves to zero
  groups.

**Warning field names:** every warning uses the uniform skeleton
`{ kind, subject, referrer, referencedBy, count }`. The offending identifier is always
`subject` — never a per-kind key like `group` or `muscle`. Read `warning.subject`.

**Step 2: Add the npm scripts**

In `package.json` → `scripts`, beside the other domain CLIs:

```json
"exercise:index": "node cli/exercise-library.cli.mjs build",
"exercise:validate": "node cli/exercise-library.cli.mjs validate"
```

**Step 3: Run it against the real corpus**

```bash
npm run exercise:index
```

Expected: roughly 1,287 exercises, 24 muscles, 11 groups, 29 equipment, plus a warning list.
**This is the first real read of the full corpus and may be very slow on a cold cloud tree.**
Run it in the background and let it finish.

**Step 4: Review the warnings — do not skip this**

Read every distinct warning `kind`. The `core` group mismatch is expected and already handled.
Anything else is new information about the corpus: fold it into the design doc's data-defect
section and decide whether the builder should handle it before continuing.

**Step 5: Commit**

```bash
git add cli/exercise-library.cli.mjs package.json
git commit -m "feat(exercise): exercise-library CLI — build and validate the index"
```

---

## Phase 1 — The shared corpus domain

### Task 4: Domain entities

**Files:**
- Create: `backend/src/2_domains/exercise/index.mjs`
- Create: `backend/src/2_domains/exercise/entities.mjs`
- Test: `backend/src/2_domains/exercise/entities.test.mjs`

Pure functions and value objects only — no I/O, no clock. This is the vocabulary both
FitnessApp and SchoolApp share.

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { makeExercise, exerciseMatchesFilter } from './entities.mjs';

describe('makeExercise', () => {
  it('normalizes a raw index record', () => {
    const ex = makeExercise({
      slug: 'push-up', name: 'Push-Up', image: 'assets/a.gif',
      targetMuscles: ['pectorals'], equipment: ['body-weight'],
      groups: ['chest'], instructions: ['Step one.'],
    });
    expect(ex.slug).toBe('push-up');
    expect(ex.instructions).toEqual(['Step one.']);
  });

  it('defaults missing collections to empty arrays, never undefined', () => {
    const ex = makeExercise({ slug: 'x', name: 'X' });
    expect(ex.targetMuscles).toEqual([]);
    expect(ex.equipment).toEqual([]);
    expect(ex.instructions).toEqual([]);
  });
});

describe('exerciseMatchesFilter', () => {
  const ex = makeExercise({
    slug: 'push-up', name: 'Push-Up', groups: ['chest'],
    targetMuscles: ['pectorals'], equipment: ['body-weight'],
  });

  it('matches an empty filter', () => {
    expect(exerciseMatchesFilter(ex, {})).toBe(true);
  });

  it('filters by group, muscle, and equipment', () => {
    expect(exerciseMatchesFilter(ex, { group: 'chest' })).toBe(true);
    expect(exerciseMatchesFilter(ex, { group: 'back' })).toBe(false);
    expect(exerciseMatchesFilter(ex, { muscle: 'pectorals' })).toBe(true);
    expect(exerciseMatchesFilter(ex, { equipment: 'barbell' })).toBe(false);
  });

  it('matches a case-insensitive name substring', () => {
    expect(exerciseMatchesFilter(ex, { q: 'push' })).toBe(true);
    expect(exerciseMatchesFilter(ex, { q: 'PUSH' })).toBe(true);
    expect(exerciseMatchesFilter(ex, { q: 'squat' })).toBe(false);
  });

  it('ANDs multiple filter terms', () => {
    expect(exerciseMatchesFilter(ex, { group: 'chest', equipment: 'barbell' })).toBe(false);
  });
});
```

**Step 2: Run it, confirm it fails**

```bash
npx vitest run backend/src/2_domains/exercise/entities.test.mjs
```

**Step 3: Implement** `entities.mjs`, then re-export from `index.mjs`.

**Step 4: Run tests, confirm green. Step 5: Verify layering**

```bash
npx vitest run backend/src/2_domains/exercise/entities.test.mjs
npm run audit:layers
```

**Step 6: Commit**

```bash
git add backend/src/2_domains/exercise
git commit -m "feat(exercise): shared corpus domain entities and filtering"
```

---

## Phase 2 — The adapter

### Task 5: `YamlExerciseLibraryRepository`

**Files:**
- Create: `backend/src/1_adapters/reference/exercise-library/YamlExerciseLibraryRepository.mjs`
- Create: `backend/src/1_adapters/reference/exercise-library/index.mjs`
- Test: `backend/src/1_adapters/reference/exercise-library/YamlExerciseLibraryRepository.test.mjs`

**Critical constraint:** this class loads the **prebuilt manifest** from Task 3 and nothing
else. It must never list or read the `exercises/` directory. If the manifest is missing it
logs a warning and serves an empty corpus — a missing index degrades the feature, it never
blocks boot.

**Second critical constraint — restore the null prototype on load.** The index builder keys
its maps with `Object.create(null)` because corpus slugs are third-party strings and a slug
named `constructor` or `__proto__` against a plain object either throws or vanishes. **That
protection does not survive serialization**: parsing the manifest hands back
`Object.prototype`-backed objects, so a bare `manifest.byMuscle[slug]` in this adapter
re-opens the exact bug the builder fixed. On load, rebuild every keyed map
(`exercises`, `muscles`, `muscleGroups`, `equipment`, `byGroup`, `byMuscle`, `byEquipment`)
with `Object.create(null)`, or read them only through `Object.hasOwn`-guarded accessors.
Write a test with a hostile slug that proves it.

**Step 1: Write the failing test**

Point the repository at a small manifest fixture written into a temp dir by the test. Cover:

```javascript
it('serves exercises from the prebuilt manifest', …)
it('never touches the corpus directory', …)   // pass a non-existent mediaDir; still works
it('returns an empty corpus and warns when the manifest is missing', …)
it('filters by group / muscle / equipment / q via the domain', …)
it('resolves an image path to a media URL', …)
it('returns null for an unknown slug rather than throwing', …)
```

**Step 2: Run it, confirm it fails.**

**Step 3: Implement.** Public surface:

```javascript
class YamlExerciseLibraryRepository {
  constructor({ indexPath, mediaBase, logger }) {}
  load() {}                      // idempotent; parses the manifest once, caches in memory
  listGroups() {}
  listMuscles() {}
  listEquipment() {}
  findExercises(filter) {}       // { group, muscle, equipment, q } → Exercise[]
  getExercise(slug) {}           // Exercise | null
  getMuscle(slug) {}             // includes fullDescription, for School
}
```

**Step 4: Green. Step 5: `npm run audit:layers`. Step 6: Commit.**

```bash
git add backend/src/1_adapters/reference/exercise-library
git commit -m "feat(exercise): manifest-backed exercise library repository"
```

---

## Phase 3 — Read API and the Browse UI

### Task 6: Browse use-case and API endpoints

**Files:**
- Create: `backend/src/3_applications/fitness/usecases/BrowseExerciseLibrary.mjs`
- Test: `backend/src/3_applications/fitness/usecases/BrowseExerciseLibrary.test.mjs`
- Modify: `backend/src/4_api/v1/routers/fitness.mjs` (add routes + header docblock entries)
- Modify: `backend/src/app.mjs` (compose the repository, inject into the router)

Endpoints:

```
GET /api/v1/fitness/exercises?group=&muscle=&equipment=&q=   → { exercises: [...] }
GET /api/v1/fitness/exercises/taxonomy                        → { groups, muscles, equipment }
GET /api/v1/fitness/exercises/:slug                           → one exercise, 404 if unknown
```

**Filter terms are multi-value.** `group`, `muscle`, and `equipment` each accept a scalar or a
list, with **OR within a facet and AND across facets** — `?group=chest&group=back` matches an
exercise in either, while `?group=chest&equipment=barbell` requires both. An empty list imposes
no constraint. The domain implements this; the endpoint just forwards.

This is not optional polish. Express's default `qs` parser turns repeated query keys into
arrays, so an endpoint that forwards `req.query` to a scalar-only filter would silently return
the entire 1,287-record corpus instead of a filtered set — no throw, no log. Add an endpoint
test that passes a repeated query key and asserts the result is actually narrowed.

**Forward `req.query` values through untouched.** The domain already handles scalars and lists;
coercing on the way in breaks it. `String(req.query.group)` turns `['chest','back']` into the
string `'chest,back'`, which matches no group at all — failing closed instead of open, but
still wrong and still silent. Don't normalize, don't stringify, don't default. A malformed
term is already handled: the domain matches nothing rather than everything.

TDD as above: use-case test first with a stub repository, then the implementation, then wire
the routes. Follow the existing `asyncHandler` pattern in the router. **Add the new endpoints
to the docblock at the top of `fitness.mjs`** — it is a maintained index of every route.

**Commit:** `feat(exercise): browse API for the exercise library`

---

### Task 7: The FitnessInstruction module skeleton

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/FitnessInstruction/index.jsx`
- Create: `frontend/src/modules/Fitness/widgets/FitnessInstruction/FitnessInstructionContainer.jsx`
- Create: `frontend/src/modules/Fitness/widgets/FitnessInstruction/FitnessInstructionContainer.scss`
- Test: `frontend/src/modules/Fitness/widgets/FitnessInstruction/FitnessInstructionContainer.test.jsx`
- Modify: `frontend/src/modules/Fitness/index.js`

`index.jsx` mirrors `widgets/CycleGame/index.jsx` exactly:

```jsx
import FitnessInstructionContainer from './FitnessInstructionContainer.jsx';

export default FitnessInstructionContainer;

export const manifest = {
  id: 'fitness_instruction',
  name: 'Exercise Library',
  icon: '💪',
  description: 'Browse exercises, build a workout, run it.'
};
```

Register in `frontend/src/modules/Fitness/index.js` in **both** maps:
- `REGISTRY_KEYS`: `'fitness:instruction': FitnessInstruction`
- `LEGACY_ID_MAP`: `'fitness_instruction': 'fitness:instruction'`

The container holds a three-state machine — `browse` | `build` | `run` — and nothing else yet.
Create the child logger once via `useMemo`, per `CLAUDE.md`:

```javascript
const logger = useMemo(() => getLogger().child({ component: 'fitness-instruction' }), []);
```

Log `mounted`, and every state transition at `debug` with `{ from, to }`.

**Test:** it renders in `browse` by default and registers under `fitness:instruction`.

**Commit:** `feat(exercise): FitnessInstruction module skeleton`

---

### Task 8: Browse UI

**Files:**
- Create: `.../FitnessInstruction/ExerciseBrowser.jsx` + `.scss` + `.test.jsx`
- Create: `.../FitnessInstruction/ExerciseDetail.jsx` + `.scss` + `.test.jsx`

Browser: muscle-group rail, muscle + equipment chips, search box, card grid (looping GIF +
name). Detail: large GIF, numbered `instructions`, muscle/equipment chips that push back into
the filter, and the `hevy_videos` MP4 when one exists (only 66 of ~1,287 do — the fallback to
the GIF is the normal path, not an error state).

All interactive controls use `onPointerDown`. Keep keyboard access (Enter/Space) on focusable
elements.

Test the filtering and the empty state. Do not assert on GIF loading.

**Commit:** `feat(exercise): browse and detail views`

---

## Phase 4 — Build and save

### Task 9: Workout domain

**Files:**
- Create: `backend/src/2_domains/fitness/workout/workout.mjs`
- Test: `backend/src/2_domains/fitness/workout/workout.test.mjs`

Pure. `Workout { id, title, author, groups[] }`, `ExerciseGroup { exercises[], rounds }`,
per-exercise `{ slug, sets, reps, seconds, load, restSeconds }`.

The important function is `expandWorkout(workout)` → a flat ordered step list the Run player
consumes. Test all three group shapes explicitly:

- 1 exercise, 3 sets, 1 round → 3 steps of the same exercise
- 2 exercises, 1 set each, 3 rounds → A B A B A B (superset alternates)
- 3 exercises, 1 set each, 2 rounds → A B C A B C (circuit)
- rest steps interleave correctly and the final rest is dropped
- a zero-round or empty group yields no steps rather than throwing

**Commit:** `feat(exercise): workout domain and step expansion`

---

### Task 10: Save and list workouts

**Files:**
- Create: `backend/src/1_adapters/fitness/YamlWorkoutRepository.mjs` + test
- Create: `backend/src/3_applications/fitness/usecases/SaveWorkout.mjs` + test
- Modify: `backend/src/4_api/v1/routers/fitness.mjs`
- Modify: `backend/src/app.mjs`

Persist to `{dataDir}/household/apps/fitness/workouts/{id}.yml` — household-scoped with an
`author` field, per the design decision. Write with `saveYamlToPathAtomic`.

```
GET    /api/v1/fitness/workouts        → summaries
GET    /api/v1/fitness/workouts/:id    → one workout, 404 if unknown
POST   /api/v1/fitness/workouts        → create/update, returns { id }
DELETE /api/v1/fitness/workouts/:id
```

Validate on write: reject an unknown exercise slug with a 400 naming the slug. A workout that
references an exercise missing from the index must not be silently persisted.

**Commit:** `feat(exercise): workout persistence and API`

---

### Task 11: Build UI

**Files:**
- Create: `.../FitnessInstruction/WorkoutBuilder.jsx` + `.scss` + `.test.jsx`
- Create: `.../FitnessInstruction/GroupEditor.jsx` + `.scss` + `.test.jsx`

`+` on a browse card appends to the tray. `GroupEditor` edits one `ExerciseGroup`: round count,
and per-exercise sets / reps-or-seconds / load / rest. Reorder by drag. The group label derives
from its size — 1 = "Sets", 2 = "Superset", 3+ = "Circuit" — it is not user-entered.

Save posts to `POST /api/v1/fitness/workouts` and transitions to `run`.

Log `workout-saved` at `info` with `{ groupCount, exerciseCount }`.

**Commit:** `feat(exercise): workout builder UI`

---

## Phase 5 — Run

### Task 12: The Run player

**Files:**
- Create: `.../FitnessInstruction/WorkoutRunner.jsx` + `.scss` + `.test.jsx`
- Create: `.../FitnessInstruction/RestTimer.jsx` + `.scss` + `.test.jsx`

Renders `expandWorkout` output one step at a time inside the existing `FitnessFrame` /
`FitnessModuleContainer` shell: large looping GIF, exercise name, `Set 2 of 4`, target reps and
load, next-up strip, one large Done target.

**Audio — read this before writing `RestTimer`.** The garage Firefox kiosk ships
`media.autoplay.default=1`, which blocks audible autoplay until a user gesture. Route every cue
through the **existing shared unlock-on-gesture audio element**:

```
frontend/src/modules/Fitness/player/hooks/audioCuePlayer.js:53
  export function installCueAudioUnlock(target = window)
```

Already used by `FitnessPlayer.jsx`; see `audioCuePlayer.test.js` for its contract. Do not
create a fresh `Audio` object — a new element has not been unlocked by the gesture and stays
muted. Browse and Build both begin with taps, so a gesture always
precedes Run — preserve that ordering and cues work without touching the browser profile.

Test with fake timers: the rest timer counts down and auto-advances; Done mid-rest skips ahead;
the last step ends the run instead of resting.

**Commit:** `feat(exercise): guided workout runner`

---

### Task 13: Log runs into the existing session record

**Files:**
- Modify: `backend/src/3_applications/fitness/usecases/` (the existing session-save path)
- Test: colocated

Strength runs must land in the **same** session record as cycle work so session detail, recaps,
and the longitudinal widget pick them up with no new plumbing. Attribution comes through the
existing `IdentityProvider` / presence — do not add a parallel identity path.

Use `getPresentParticipantIds()` for presence. **Do not call `getRoster()`** and do not memoize
it — it is expensive and memoizing it has caused bugs before.

Add a `strength` block to the session payload: workout id, title, completed groups, per-exercise
sets actually completed. Write a characterization test first pinning the **current** saved-session
shape, so you can prove the addition is additive and breaks no existing reader.

**Commit:** `feat(exercise): log strength runs to the fitness session record`

---

## Phase 6 — The School projection

### Task 14: `ExerciseLibrarySource`

**Files:**
- Create: `backend/src/3_applications/school/sources/ExerciseLibrarySource.mjs`
- Test: `backend/src/3_applications/school/sources/ExerciseLibrarySource.test.mjs`
- Modify: `backend/src/app.mjs` (~line 2441, the `schoolMaterialSources` map)
- Modify: `{dataDir}/household/config/school.yml` (add a `materials.sources` entry)

Implement the same interface as `MediaAlbumSource` — read that file first, it is the reference
implementation. Required methods: `listMaterials(root)`, `listWorks(root)`,
`getMaterial(materialId)`.

Projection:

| Corpus | School | Rendered by |
|---|---|---|
| Muscle group | collection | subject shelf |
| Muscle | work | work listing |
| Muscle `fullDescription` | `lecture_notes` unit | `LearningContentReader` |
| Exercises targeting a muscle | `examples` units (GIF + instructions) | `LearningContentReader` |
| Equipment | second collection | subject shelf |

Register it beside the others:

```javascript
const schoolMaterialSources = {
  'media-album': mediaAlbumSource,
  'media-series': mediaSeriesSource,
  'media-label': new MediaLabelSource({ … }),
  'exercise-library': new ExerciseLibrarySource({
    library: exerciseLibraryRepository,
    logger: rootLogger.child({ module: 'school-materials' })
  })
};
```

**`SchoolApp.jsx` is not modified.** If you find yourself editing it, stop — the projection is
wrong. The catalog machinery already renders anything a source returns.

`resolveCategory` files the shelf under `reference`. Confirm that in the test rather than
assuming.

**Verify in the running app:** open School → the new shelf → a muscle → its essay renders in
`LearningContentReader`.

**Commit:** `feat(exercise): School materials source for anatomy content`

---

## Phase 7 — Live verification

### Task 15: Playwright flow test

**Files:**
- Create: `tests/live/flow/fitness/exercise-library.runtime.test.mjs`

Covers browse → filter → add two exercises → group them → save → run one step → verify the
session record gained a `strength` block.

Read `docs/ai-context/testing.md` first. Port comes from `tests/_lib/configHelper.mjs` — never
hardcode one, and never assume 5173.

**Test discipline** (`CLAUDE.md` → Test Discipline): if a precondition fails, return false and
let the assertion fail. No conditional assertion skipping, no vacuously-true returns.

```bash
npx playwright test tests/live/flow/fitness/exercise-library.runtime.test.mjs --reporter=line
```

**Commit:** `test(exercise): live flow for browse → build → run`

---

### Task 16: Docs and merge

**Files:**
- Create: `docs/reference/fitness/exercise-library.md`
- Modify: `CLAUDE.md` (Navigation table — add a row)
- Modify: `docs/_wip/plans/2026-08-11-exercise-library-design.md` (mark Implemented; fill in the
  measured corpus size from Task 1 Step 2)

Reference doc covers: the corpus layout and record shapes, the index-manifest CLI and **when it
must be re-run** (any corpus change), the two projections, and the known taxonomy defect.

**No instance-specific data in docs** — no absolute paths, hostnames, or ports. Use `{mediaDir}`
/ `{dataDir}` placeholders, per `CLAUDE.md` → Documentation Management rule 6.

Then: REQUIRED SUB-SKILL: use superpowers:finishing-a-development-branch.

Note the project's commit policy — merging to `main` and deploying are the user's calls, not
automatic.

---

## Verification checklist

Before claiming this is done, run these and read the output:

```bash
npm run exercise:validate          # index builds clean
npm run audit:layers               # no layer violations
npm run test:refactor              # the standing ratchet still passes
npx vitest run backend/src/2_domains/exercise backend/src/1_adapters/reference/exercise-library
npx playwright test tests/live/flow/fitness/exercise-library.runtime.test.mjs --reporter=line
```

REQUIRED SUB-SKILL: use superpowers:verification-before-completion. Evidence before assertions —
paste the actual output, do not summarize it as "passing".
