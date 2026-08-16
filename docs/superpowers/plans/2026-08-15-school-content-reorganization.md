# School Content Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `data/content/school/` hold only abstract, live coursework — nine subject shelves at the root — by moving artifacts, staging material, and infrastructure config out to trees that match their lifecycle.

**Architecture:** Data moves first, code second. Both datastores already union the root-shelf layout with the legacy `curriculum/` layout, so the two live courses can move with zero code change and zero downtime. Only after the disk is correct do we delete the `curriculum/` branches. Three roots that are hardcoded (two of them bypassing config) change in the same commits as the directories they point at.

**Tech Stack:** Node ESM (`.mjs`), vitest 4, js-yaml, Docker (`daylight-station`), Dropbox-synced data volume.

## Global Constraints

- **The data volume is NOT writable by the `claude` user.** Every create/move/delete under `data/` must run as `sudo docker exec daylight-station sh -c '<cmd>'`. The container's working directory is `/usr/src/app`, so paths are written `data/content/school/...`.
- **`docker exec` runs as root; the volume is owned by `node:node`.** `mv` preserves ownership, but any directory created with `mkdir` is root-owned and must be followed by `chown node:node`.
- **Validation invariant: `161 units (161 publishable)`.** That is 58 atlas lessons + 103 elements lessons. Every task that touches data re-runs the validator and must still see 161/161.
- **Baseline command:** `node cli/school-catalog.cli.mjs validate --data-dir /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data` → exit 0.
- **Test command:** `npx vitest run <file> --reporter=dot`. Do not pass `--reporter=basic`; it was removed in vitest 4 and crashes the runner.
- **Never redeploy while the garage is in use.** The gate is its own step in Task 10 — never chain it onto the deploy command.
- **The live units endpoint is `GET /api/v1/school/lifecycle/curriculum/units`.** The router is mounted under `/lifecycle` (`app.mjs:3552`); the path without it returns 404.
- **Expect Dropbox sync churn.** About 5,500 files move. Run the data steps when nobody is printing or studying, and let sync settle between tasks.
- **The nine subject ids are unchanged:** `english writing math civilization scripture science language skills arts`. `history` is not among them.
- **No file renames and no schema changes in this plan.** `index.yml` stays `index.yml`; `school.unit/v1` stays as it is. Those are deferred to the standards spec.

---

### Task 1: Branch, and rehearse the whole move on a throwaway copy

Nothing touches production until the target layout has been proven end-to-end on a copy.

**Files:**
- Create: `scripts/school-reorg-rehearse.sh`

**Interfaces:**
- Produces: a rehearsal script later tasks re-run after edits; no runtime code.

- [ ] **Step 1: Create the working branch**

The spec landed on `piano/challenge-attempt-telemetry`, which is the wrong home for school work.

```bash
git switch -c school/content-reorg
git branch --show-current   # expect: school/content-reorg
```

- [ ] **Step 2: Write the rehearsal script**

Create `scripts/school-reorg-rehearse.sh`:

```bash
#!/usr/bin/env bash
# Rehearse the school content reorganization on a throwaway copy of the data
# tree. Proves the target layout validates BEFORE production is touched.
#
#   ./scripts/school-reorg-rehearse.sh /tmp/reorg-fixture
set -euo pipefail

SRC="${SRC:-/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data}"
DEST="${1:?usage: school-reorg-rehearse.sh <fixture-dir>}"

rm -rf "$DEST"
mkdir -p "$DEST/content" "$DEST/household/apps" "$DEST/household/config"
cp -r "$SRC/content/school" "$DEST/content/school"
cp -r "$SRC/household/apps/school" "$DEST/household/apps/school"

S="$DEST/content/school"
C="$S/curriculum"
STAGE="$DEST/content/_staging/school"
mkdir -p "$STAGE"

# 1. Conforming courses to root shelves.
mkdir -p "$S/civilization" "$S/science"
mv "$C/civilization/young-peoples-atlas-us" "$S/civilization/"
mv "$C/science/the-elements-ted-gray"       "$S/science/"

# 2. Quizzes era and the unfinished Big Fat Notebook courses to staging.
mv "$C/english/shakespeare-tales" "$STAGE/"
find "$C" -maxdepth 2 -type d -name 'big-fat-notebook-*' -exec mv {} "$STAGE/" \;

# 3. The July import to staging.
mv "$C/_inbox" "$STAGE/_inbox"

# 4. Print artifacts to the household app tree.
mv "$S/print-documents" "$DEST/household/apps/school/print-documents"

# 5. Split the catalog shelf by lifecycle.
mkdir -p "$DEST/household/config/school"
mv "$S/catalog/surfaces"    "$DEST/household/config/school/surfaces"
mv "$S/catalog/ti86-packs"  "$DEST/household/apps/school/ti86-packs"
mv "$S/catalog"             "$S/learning-catalog"

# 6. Retire the emptied scaffolding.
find "$C" -type d -empty -delete 2>/dev/null || true
rmdir "$C" 2>/dev/null || true

echo "--- resulting content/school ---"
ls -1 "$S"
```

```bash
chmod +x scripts/school-reorg-rehearse.sh
```

- [ ] **Step 3: Run the rehearsal**

```bash
./scripts/school-reorg-rehearse.sh /tmp/claude-1001/reorg-fixture
```

Expected `ls` output — exactly these entries, and no `catalog` or `curriculum`:

```
README.md
WORK-CONFIG.md
civilization
learning-catalog
science
```

- [ ] **Step 4: Validate the rehearsed tree**

```bash
node cli/school-catalog.cli.mjs validate --data-dir /tmp/claude-1001/reorg-fixture
```

Expected: `units 161 (161 publishable)` and `OK — catalog is clean`, exit 0. If the count differs from 161, **stop** — a course was moved to a shelf the datastore does not walk. Do not proceed to production.

- [ ] **Step 5: Commit**

```bash
git add scripts/school-reorg-rehearse.sh
git commit -m "chore(school): rehearsal script for the content reorganization"
```

---

### Task 2: Lock root-shelf resolution with a characterization test

Both datastores already read the root layout. This test proves it and keeps proving it — it must pass now and after every later task.

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/CoursePackageV2.test.mjs`

**Interfaces:**
- Consumes: `YamlCurriculumDatastore`, `YamlSchoolDatastore` — both constructed as `new X({ configService })` where `configService` is `{ getDataDir: () => root }`.
- Produces: `fixture(layout)` — `layout` is `'root'` or `'curriculum'`; returns a configService stub. Task 8 reuses it.

- [ ] **Step 1: Rewrite the fixture to take a layout, and add the root-shelf test**

Replace the whole contents of `backend/src/1_adapters/persistence/yaml/CoursePackageV2.test.mjs` with:

```javascript
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlCurriculumDatastore } from './YamlCurriculumDatastore.mjs';
import { YamlSchoolDatastore } from './YamlSchoolDatastore.mjs';

const roots = [];

/**
 * Build a one-lesson v2 course package.
 *
 * `layout: 'root'` puts it on the subject shelf (`content/school/<subject>/…`),
 * which is where the reorganization lands every course. `layout: 'curriculum'`
 * uses the retired `content/school/curriculum/<subject>/…` nesting.
 */
const fixture = (layout = 'root') => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'course-v2-')); roots.push(root);
  const shelf = layout === 'curriculum'
    ? path.join(root, 'content/school/curriculum/civilization/atlas')
    : path.join(root, 'content/school/civilization/atlas');
  const lesson = path.join(shelf, 'units/10-northeast/lessons/maine');
  fs.mkdirSync(lesson, { recursive: true });
  fs.writeFileSync(path.join(shelf, 'index.yml'), 'schema: school.course/v2\nwork: atlas\ntitle: Atlas\nsubject: civilization\ncategory: course\nmedium: paper\nstructure: { shape: modules, module: region, items: { from: units, order: sequence } }\ngrading: { gate: omr, scope: item, pass_percent: 80, exit: Done }\n');
  fs.writeFileSync(path.join(lesson, 'index.yml'), 'schema: school.unit/v1\nunitId: maine\ntitle: Maine\nsubject: civilization\ncourseId: atlas\nsequence: 1\ngrades: [lower, upper]\nobjectives: [Learn Maine]\nbank: civilization/atlas/maine/worksheet\npassing: { percent: 80 }\n');
  fs.writeFileSync(path.join(lesson, 'worksheet.yml'), 'schema: school.question-bank/v2\nid: civilization/atlas/maine/worksheet\ntitle: Maine worksheet\nitems: []\n');
  fs.writeFileSync(path.join(lesson, 'flashcards.yml'), 'schema: school.question-bank/v2\nid: civilization/atlas/maine/flashcards\ntitle: Maine flashcards\nitems: []\n');
  return { getDataDir: () => root };
};

afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe('school.course/v2 package discovery', () => {
  it('projects lesson indexes as units and discovers arbitrary typed YAML artifacts', async () => {
    const configService = fixture('curriculum');
    const curriculum = new YamlCurriculumDatastore({ configService });
    const school = new YamlSchoolDatastore({ configService });
    expect((await curriculum.listWorks()).items[0].raw.schema).toBe('school.course/v2');
    expect((await curriculum.listUnits()).items.map((entry) => entry.id)).toEqual(['maine']);
    expect(await curriculum.getUnit('maine')).toMatchObject({ unitId: 'maine' });
    expect(school.listBankIds()).toEqual(['civilization/atlas/maine/flashcards', 'civilization/atlas/maine/worksheet']);
    expect(school.readBankRaw('civilization/atlas/maine/worksheet')).toMatchObject({ title: 'Maine worksheet' });
  });

  it('discovers a course package on the subject shelf itself, with identical bank ids', async () => {
    const configService = fixture('root');
    const curriculum = new YamlCurriculumDatastore({ configService });
    const school = new YamlSchoolDatastore({ configService });
    expect((await curriculum.listWorks()).items.map((entry) => entry.id)).toEqual(['atlas']);
    expect((await curriculum.listUnits()).items.map((entry) => entry.id)).toEqual(['maine']);
    expect(await curriculum.getUnit('maine')).toMatchObject({ unitId: 'maine' });
    expect(school.listBankIds()).toEqual(['civilization/atlas/maine/flashcards', 'civilization/atlas/maine/worksheet']);
    expect(school.readBankRaw('civilization/atlas/maine/worksheet')).toMatchObject({ title: 'Maine worksheet' });
  });
});
```

The bank ids are asserted to be **identical** across both layouts. That is the property that makes the whole migration safe: ids carry no directory prefix, so attempt history survives the move.

- [ ] **Step 2: Run the tests**

```bash
npx vitest run backend/src/1_adapters/persistence/yaml/CoursePackageV2.test.mjs --reporter=dot
```

Expected: PASS, 2 tests. Both layouts resolve today — that is exactly the property Task 3 depends on.

- [ ] **Step 3: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/CoursePackageV2.test.mjs
git commit -m "test(school): assert a course package resolves on the subject shelf"
```

---

### Task 3: Move the two conforming courses to root shelves

No code change. The union in `#works()` covers both locations, so this is invisible to the running container.

**Files:**
- Data only: `data/content/school/curriculum/{civilization,science}/` → `data/content/school/{civilization,science}/`

- [ ] **Step 1: Confirm the deploy/print gate is quiet**

```bash
sudo docker logs --since 75s daylight-station 2>&1 | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
```

Expected: `0`. A move mid-print could leave a worksheet render reading a path that vanished.

- [ ] **Step 2: Create the shelves and move**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  mkdir -p data/content/school/civilization data/content/school/science
  chown node:node data/content/school/civilization data/content/school/science
  mv data/content/school/curriculum/civilization/young-peoples-atlas-us data/content/school/civilization/
  mv data/content/school/curriculum/science/the-elements-ted-gray       data/content/school/science/
  ls -1 data/content/school/civilization data/content/school/science
'
```

Expected: `young-peoples-atlas-us` and `the-elements-ted-gray`.

- [ ] **Step 3: Validate — the invariant must hold**

```bash
node cli/school-catalog.cli.mjs validate --data-dir /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data
```

Expected: `units 161 (161 publishable)`, `OK — catalog is clean`, exit 0.

- [ ] **Step 4: Confirm the live course still resolves through the running app**

```bash
curl -s http://localhost:3111/api/v1/school/lifecycle/curriculum/units | head -c 400; echo
```

Expected: JSON containing `atlas-us-` unit ids. If the response is an empty list, **stop and move the directories back** — the running container is the real test, not the validator.

- [ ] **Step 5: Commit the plan progress**

No repo files changed by this task; record the checkpoint.

```bash
git commit --allow-empty -m "chore(school): move atlas and elements onto root subject shelves"
```

---

### Task 4: Park the quizzes era and the unfinished courses in staging

**Files:**
- Data only: Shakespeare Tales and six `big-fat-notebook-*` directories → `data/content/_staging/school/`

- [ ] **Step 1: Record what is about to move**

```bash
sudo docker exec daylight-station sh -c '
  find data/content/school/curriculum -maxdepth 2 -type d -name "big-fat-notebook-*" | sort
  echo "--- shakespeare ---"
  find data/content/school/curriculum/english/shakespeare-tales -name "*.yml" | wc -l
'
```

Expected: six `big-fat-notebook-*` directories, and `79` Shakespeare YAML files (plus `work.yml` = 80 files total).

- [ ] **Step 2: Move them**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  mkdir -p data/content/_staging/school
  chown -R node:node data/content/_staging
  mv data/content/school/curriculum/english/shakespeare-tales data/content/_staging/school/
  find data/content/school/curriculum -maxdepth 2 -type d -name "big-fat-notebook-*" \
    -exec mv {} data/content/_staging/school/ \;
  ls -1 data/content/_staging/school
'
```

Expected: seven entries — `shakespeare-tales` plus six `big-fat-notebook-*`.

- [ ] **Step 3: Validate**

```bash
node cli/school-catalog.cli.mjs validate --data-dir /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data
```

Expected: **still** `161 units (161 publishable)`, exit 0. Neither Shakespeare nor any BFN course contributed a publishable unit, so the count is unchanged. A drop here means a live course was moved by mistake.

- [ ] **Step 4: Commit the checkpoint**

```bash
git commit --allow-empty -m "chore(school): park the quizzes era and six unfinished courses in staging"
```

---

### Task 5: Move the July import to staging and rebase the drift manifest

`ContentTreeManifest#walk()` has no skip list, so `_inbox` leaving `content/school/` is the entire fix for the drift report.

**Files:**
- Data only: `data/content/school/curriculum/_inbox/` → `data/content/_staging/school/_inbox/`

- [ ] **Step 1: Count before**

```bash
sudo docker exec daylight-station sh -c 'find data/content/school -name "*.yml" -o -name "*.md" | wc -l'
```

Record this number. Expected: roughly `5880`.

- [ ] **Step 2: Move `_inbox`**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  mv data/content/school/curriculum/_inbox data/content/_staging/school/_inbox
  find data/content/school -name "*.yml" -o -name "*.md" | wc -l
'
```

Expected: roughly `1300` — a drop of about 4,580 files.

- [ ] **Step 3: Validate**

```bash
node cli/school-catalog.cli.mjs validate --data-dir /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data
```

Expected: `161 units (161 publishable)`, exit 0.

- [ ] **Step 4: Rebase the manifest so tonight's diff is not pure noise**

The manifest is a plain YAML record of path → hash. Deleting it makes the next run treat the new tree as the first run rather than reporting ~4,580 removals.

```bash
sudo docker exec daylight-station sh -c '
  ls -l data/household/apps/school/content-manifest.yml 2>/dev/null || echo "no manifest yet"
  rm -f data/household/apps/school/content-manifest.yml
'
```

- [ ] **Step 5: Commit the checkpoint**

```bash
git commit --allow-empty -m "chore(school): move the July quiz import out of the hashed content tree"
```

---

### Task 6: Move print artifacts to the household app tree

The directory and the code that points at it change together. There is a brief window between the move and the deploy in which the print system would read a missing directory — Step 1 is what makes that window safe.

**Files:**
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs:534-542`
- Data: `data/content/school/print-documents/` → `data/household/apps/school/print-documents/`

**Interfaces:**
- Consumes: `dataDir` (already in scope in `createSchoolLifecycle`).
- Produces: `printDocumentsRoot` — consumed by `YamlPrintDocumentRepository({ directory })` and `YamlAllocationStore({ directory })`. Path only; no signature change.

- [ ] **Step 1: Confirm nothing is printing**

```bash
sudo docker exec daylight-station sh -c 'ls data/household/apps/school/sessions/ 2>/dev/null | wc -l'
sudo docker logs --since 120s daylight-station 2>&1 | grep -ciE 'IssueDocument|print-job|RenderPrintDocument' || true
```

Expected: `0` recent print activity. If non-zero, wait.

- [ ] **Step 2: Change the root**

In `backend/src/5_composition/modules/schoolLifecycle.mjs`, replace this line:

```javascript
  const printDocumentsRoot = path.join(dataDir, 'content/school/print-documents');
```

with:

```javascript
  const printDocumentsRoot = path.join(dataDir, 'household/apps/school/print-documents');
```

Then update the comment above it (line ~534) so it names the new location:

```javascript
  // Published revisions, derived banks, and the answer-card ledger — machine
  // written artifacts, so they live with the rest of School's household state
  // (`<dataDir>/household/apps/school/print-documents`) rather than on the
  // authored content mount.
```

- [ ] **Step 3: Verify the wiring test still passes**

```bash
npx vitest run tests/isolated/composition/schoolLifecycleWiring.test.mjs --reporter=dot
```

Expected: PASS, unchanged. This test does not assert the print-documents literal, so no test edit is needed — it is here to catch a wiring break in `createSchoolLifecycle`.

- [ ] **Step 4: Move the directory**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  mv data/content/school/print-documents data/household/apps/school/print-documents
  ls -1 data/household/apps/school/print-documents
'
```

Expected: `README.md`, `allocations`, `derived-banks`, `published`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/5_composition/modules/schoolLifecycle.mjs tests/isolated/composition/schoolLifecycleWiring.test.mjs
git commit -m "refactor(school): read print artifacts from the household app tree"
```

The deploy that makes this live happens in Task 10. Until then the running container reads the old path — which is why Task 10 must follow promptly and why Step 1 checked for print activity.

---

### Task 7: Split the catalog shelf by lifecycle

`catalog/` holds four unrelated things. Two are not coursework and leave; the Learning Catalog authoring shelf stays under a name that says what it is.

**Files:**
- Modify: `backend/src/5_composition/modules/schoolCatalog.mjs:31`
- Modify: `backend/src/3_applications/school/documents/RenderPrintDocument.mjs:108`
- Data: `catalog/surfaces/` → `household/config/school/surfaces/`; `catalog/ti86-packs/` → `household/apps/school/ti86-packs/`; `catalog/` → `learning-catalog/`

**Interfaces:**
- Consumes: `config.content?.root` (unchanged, still honoured); `resolveFromData(dataDirectory, …)`.
- Produces: `contentRoot` — the base for `catalogs/`, `documents/`, `question-banks/`, `actions/` subdirectories. Default value changes only.

- [ ] **Step 1: Change the configurable default**

In `backend/src/5_composition/modules/schoolCatalog.mjs`, replace:

```javascript
    const contentRoot = resolveFromData(dataDirectory, config.content?.root ?? 'content/school/catalog');
```

with:

```javascript
    const contentRoot = resolveFromData(dataDirectory, config.content?.root ?? 'content/school/learning-catalog');
```

- [ ] **Step 2: Change the hardcode that bypasses that config**

This is the trap: `RenderPrintDocument` resolves the same shelf independently, so changing only Step 1 would leave bank-select questions failing at print time rather than at boot.

In `backend/src/3_applications/school/documents/RenderPrintDocument.mjs`, replace:

```javascript
  const directory = path.resolve(resolvedDataDir, 'content/school/catalog/question-banks');
```

with:

```javascript
  const directory = path.resolve(resolvedDataDir, 'content/school/learning-catalog/question-banks');
```

- [ ] **Step 3: Prove no other reference to the old path survives**

```bash
grep -rn "content/school/catalog" backend cli frontend scripts --include=*.mjs --include=*.js --include=*.jsx | grep -v node_modules
```

Expected: no output. Any hit is a third copy of the same path and must be changed now.

- [ ] **Step 4: Run the catalog composition tests**

```bash
npx vitest run backend/src/5_composition/modules/schoolCatalog.test.mjs --reporter=dot
```

Expected: PASS, unchanged. The one path assertion in that file (`schoolCatalog.test.mjs:14`) checks a **config-supplied** root (`/data/mounted/learning`), not the default literal, so it is unaffected by this change.

- [ ] **Step 5: Move the three directories**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  mkdir -p data/household/config/school
  chown node:node data/household/config/school
  mv data/content/school/catalog/surfaces   data/household/config/school/surfaces
  mv data/content/school/catalog/ti86-packs data/household/apps/school/ti86-packs
  mv data/content/school/catalog            data/content/school/learning-catalog
  ls -1 data/content/school/learning-catalog
'
```

Expected: `catalogs`, `documents`, `question-banks`, `schoolcalc-content-sources.yml`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/5_composition/modules/schoolCatalog.mjs \
        backend/src/3_applications/school/documents/RenderPrintDocument.mjs \
        backend/src/5_composition/modules/schoolCatalog.test.mjs
git commit -m "refactor(school): name the learning-catalog shelf, move surfaces and device packs out"
```

---

### Task 8: Delete the `curriculum/` branches from both datastores

The logic is duplicated byte-for-byte in two files. Removing one and not the other leaves a reader pointed at a directory that no longer exists.

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlSchoolDatastore.mjs:98-111`
- Modify: `backend/src/1_adapters/persistence/yaml/YamlCurriculumDatastore.mjs:73-86`
- Modify: `backend/src/1_adapters/persistence/yaml/CoursePackageV2.test.mjs`

**Interfaces:**
- Consumes: `fixture(layout)` from Task 2.
- Produces: `#workDir(subject, work)` in both classes now returns `path.join(this.#schoolDir(), subject, work)` unconditionally. `#curriculumWorks()` is removed from both.

- [ ] **Step 1: Write the failing test**

In `backend/src/1_adapters/persistence/yaml/CoursePackageV2.test.mjs`, replace the first test (`'projects lesson indexes as units and discovers arbitrary typed YAML artifacts'`, which uses `fixture('curriculum')`) with:

```javascript
  it('ignores a package left under the retired curriculum/ nesting', async () => {
    const configService = fixture('curriculum');
    const curriculum = new YamlCurriculumDatastore({ configService });
    const school = new YamlSchoolDatastore({ configService });
    expect((await curriculum.listWorks()).items).toEqual([]);
    expect((await curriculum.listUnits()).items).toEqual([]);
    expect(school.listBankIds()).toEqual([]);
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run backend/src/1_adapters/persistence/yaml/CoursePackageV2.test.mjs --reporter=dot
```

Expected: FAIL — `listWorks()` still returns `atlas` because `#curriculumWorks()` finds it.

- [ ] **Step 3: Remove the branch from `YamlSchoolDatastore.mjs`**

Delete the `#curriculumWorks` method entirely:

```javascript
  #curriculumWorks(subject) {
    const root = path.join(this.#schoolDir(), 'curriculum', subject);
    try {
      return fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name);
    } catch { return []; }
  }
```

Replace `#workDir` with:

```javascript
  #workDir(subject, work) {
    return path.join(this.#schoolDir(), subject, work);
  }
```

Replace `#works` with:

```javascript
  #works(subject) {
    try {
      return fs.readdirSync(path.join(this.#schoolDir(), subject), { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name);
    } catch { return []; /* empty shelf */ }
  }
```

- [ ] **Step 4: Make the identical change in `YamlCurriculumDatastore.mjs`**

Delete its `#curriculumWorks` (lines 73-80) and replace `#workDir` (82-86) and `#works` (93-101) with exactly the three forms above. Keep the existing doc comment on `#works`.

- [ ] **Step 5: Drop the now-unused `COURSE_V2` import if the linter flags it**

`#workDir` was the only user of `COURSE_V2` in `YamlCurriculumDatastore.mjs`. Check before removing:

```bash
grep -n "COURSE_V2" backend/src/1_adapters/persistence/yaml/YamlCurriculumDatastore.mjs
grep -n "COURSE_V2" backend/src/1_adapters/persistence/yaml/YamlSchoolDatastore.mjs
```

Remove the import only from a file where the grep shows no remaining use. `YamlSchoolDatastore` still uses it in `#courseV2()`, so its import stays.

- [ ] **Step 6: Run the tests**

```bash
npx vitest run backend/src/1_adapters/persistence/yaml/CoursePackageV2.test.mjs --reporter=dot
```

Expected: PASS, 2 tests — the retired nesting is ignored, the subject shelf resolves.

- [ ] **Step 7: Run the wider school suite for regressions**

```bash
npx vitest run backend/src/1_adapters/persistence/yaml backend/src/2_domains/school backend/src/5_composition/modules/schoolCatalog.test.mjs --reporter=dot
```

Expected: all PASS. Report any failure with its output rather than proceeding.

- [ ] **Step 8: Delete the emptied directories**

```bash
sudo docker exec daylight-station sh -c '
  set -e
  find data/content/school/curriculum -type d -empty -delete 2>/dev/null || true
  rmdir data/content/school/curriculum 2>/dev/null || true
  ls -1 data/content/school
'
```

Expected exactly: `README.md`, `WORK-CONFIG.md`, `civilization`, `learning-catalog`, `science`. No `curriculum`, no `catalog`, no `history`, no `print-documents`.

- [ ] **Step 9: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/
git commit -m "refactor(school): resolve courses from the subject shelf only"
```

---

### Task 9: Make the documentation describe the tree that now exists

**Files:**
- Modify: `docs/reference/school/authoring/content-layout.md`
- Rewrite: `data/content/school/README.md` (via `docker exec`)
- Delete: `data/content/school/WORK-CONFIG.md` (via `docker exec`)

- [ ] **Step 1: Update the canonical layout doc**

In `docs/reference/school/authoring/content-layout.md`:

1. The nine-subject list currently reads `english writing math history scripture science language skills arts`. Replace `history` with `civilization` — the code has always said `civilization`, and the stale list is why an unreachable `history/` shelf was created.
2. Add this section after the opening layout block:

```markdown
## Where each kind of thing lives

`content/school/` holds authored, live coursework and nothing else.

| tree | holds | written by |
|---|---|---|
| `content/school/<subject>/<course>/` | course packages | a person |
| `content/school/learning-catalog/` | `school.catalog/v1` catalogs, documents, question banks | a person |
| `content/_staging/school/` | imports, drafts, unfinished courses — **not live** | a person |
| `household/apps/school/print-documents/` | published revisions, derived banks, allocations | `school-docs publish` |
| `household/apps/school/ti86-packs/` | SchoolCalc device builds | the pack publisher |
| `household/config/school/surfaces/` | surface profiles | a person |

`content/_staging/` is a **sibling** of `content/school/`, not a child. That is
what keeps it out of `ContentTreeManifest`, which walks the school content tree
with no skip list.
```

3. Replace the "Which validator owns which tree" table's first two rows with the new paths (`content/school/<subject>/<course>/…` and `content/school/learning-catalog/…`).

- [ ] **Step 2: Rewrite the data-volume README**

```bash
sudo docker exec daylight-station sh -c "cat > data/content/school/README.md << 'EOF'
# content/school — abstract coursework

\`\`\`
<subject>/<course>/
\`\`\`

This tree holds authored, live coursework and nothing else. Instances, printed
artifacts, device builds, and staging material live elsewhere — see
\`docs/reference/school/authoring/content-layout.md\` in the repo, which is the
canonical copy of this document.

Nine subject shelves, fixed in code (\`frontend/src/modules/School/home/subjects.js\`
and \`SUBJECT_IDS\` in \`2_domains/school/curriculum/unitValidation.mjs\`):

\`\`\`
english  writing  math  civilization  scripture  science  language  skills  arts
\`\`\`

A shelf with no courses is the normal state, not a gap.

\`learning-catalog/\` is the authoring shelf for the \`school.catalog/v1\`
subsystem (catalogs, learning documents, question banks).

## Not here

| looking for | it is at |
|---|---|
| published sheets, answers, card ledger | \`household/apps/school/print-documents/\` |
| sessions, instances, tokens, assignments | \`household/apps/school/\` |
| imports, drafts, unfinished courses | \`content/_staging/school/\` |
| surface profiles | \`household/config/school/surfaces/\` |
| per-student progress | \`users/{id}/apps/school/\` |
EOF
chown node:node data/content/school/README.md
rm -f data/content/school/WORK-CONFIG.md
ls -1 data/content/school"
```

Expected: `README.md`, `civilization`, `learning-catalog`, `science`.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/school/authoring/content-layout.md
git commit -m "docs(school): describe the reorganized content tree"
```

---

### Task 10: Build, gate, deploy, and verify in production

**Files:** none — build and deploy only.

- [ ] **Step 1: Full test suite**

```bash
npm run test:isolated 2>&1 | tail -20
```

Expected: pass. Capture the real result; if anything fails, report the output and stop.

- [ ] **Step 2: Build the image**

```bash
./scripts/build-daylight.sh 2>&1 | tail -5
```

Expected: image built.

- [ ] **Step 3: THE DEPLOY GATE — run this alone and read it**

Do not chain this to the deploy. Run it, read both outputs, and stop if either is active.

```bash
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' \
  | sort | uniq -c
```

Clear to deploy means: zero render lines, no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`. If either gate is active, **wait** — do not deploy.

- [ ] **Step 4: Deploy**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 5: Verify the reorganized tree serves**

```bash
sleep 20
curl -s http://localhost:3111/api/v1/school/curriculum/units | head -c 300; echo
curl -s http://localhost:3111/build.txt
```

Expected: unit JSON containing `atlas-us-` ids, and a `build.txt` whose commit hash matches `git rev-parse HEAD`.

- [ ] **Step 6: Verify the print path against its new root**

```bash
sudo docker exec daylight-station sh -c 'ls data/household/apps/school/print-documents/published/civilization/young-peoples-atlas-us/'
node cli/school-docs.cli.mjs list-cards 2>&1 | tail -10
```

Expected: the published atlas revision is listed, and `list-cards` reports the four allocations without error.

- [ ] **Step 7: Final validation**

```bash
node cli/school-catalog.cli.mjs validate --data-dir /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data
```

Expected: `161 units (161 publishable)`, `OK — catalog is clean`, exit 0 — the same numbers this migration started with.

- [ ] **Step 8: Merge to main and clean up**

```bash
git switch main && git merge --no-ff school/content-reorg -m "merge: school content tree reorganization"
git push origin main
```

Then record the branch in `docs/_archive/deleted-branches.md` and delete it:

```bash
git branch -d school/content-reorg
```

---

## Rollback

Every step is a directory move; nothing is deleted except the emptied
scaffolding, the manifest baseline, and `WORK-CONFIG.md`. To reverse:

```bash
sudo docker exec daylight-station sh -c '
  set -e
  mkdir -p data/content/school/curriculum/civilization data/content/school/curriculum/science data/content/school/curriculum/english
  mv data/content/school/civilization/young-peoples-atlas-us data/content/school/curriculum/civilization/
  mv data/content/school/science/the-elements-ted-gray       data/content/school/curriculum/science/
  mv data/content/_staging/school/shakespeare-tales          data/content/school/curriculum/english/
  mv data/content/_staging/school/_inbox                     data/content/school/curriculum/_inbox
  mv data/household/apps/school/print-documents              data/content/school/print-documents
  mv data/content/school/learning-catalog                    data/content/school/catalog
  mv data/household/config/school/surfaces                   data/content/school/catalog/surfaces
  mv data/household/apps/school/ti86-packs                   data/content/school/catalog/ti86-packs
'
git revert <merge-sha>
```

Re-deploy after reverting the code, and re-run the validator to confirm 161/161.
