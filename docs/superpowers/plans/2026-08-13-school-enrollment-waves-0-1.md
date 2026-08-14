# School Enrollment — Waves 0 and 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `school.course-enrollment/v1` creatable and editable from the teacher console, by introducing a *syllabus* — a saved, named, reusable set of arguments to `createCourseEnrollment` — and fixing the bug that silently deletes hand-authored enrollments.

**Architecture:** No new runtime path. `createCourseEnrollment` already exists, is tested, and is fully honored by `planner.mjs` and the worksheet issue path — it simply has no callers. A syllabus stores `{courseId, profile, policy, passing}`; enrolling calls `createCourseEnrollment` with those plus the course's units, and writes the returned record onto the learner's assignment entry exactly where the planner already reads it. Materialization is a one-time snapshot, because `lessonOrder` is persisted specifically so a shuffle cannot move under a learner.

**Tech Stack:** Node ESM (`.mjs`), Express 5, js-yaml, React 18 (`.jsx`), Vitest 4.

**Design reference:** [`docs/reference/school/enrollment.md`](../../reference/school/enrollment.md)

## Global Constraints

- **Layer rules.** `2_domains/` is pure — no I/O, no clock, no `node:` imports. `1_adapters/` does persistence. `3_applications/` orchestrates. `4_api/` is HTTP only and must not import domain classes.
- **Test command (portable, works from a worktree):**
  `npx vitest run --config vitest.config.mjs <path/to/test>`
- **Tests are colocated** next to the module under test (`enrollment.mjs` → `enrollment.test.mjs`), matching `backend/src/2_domains/school/curriculum/`.
- **Every mutating school route asserts `TeacherGate`** (see `SetAssignments.mjs:55`) and carries the `baseUpdatedAt` stale-save guard (`SetAssignments.mjs:97-108`, 409 `STALE_SAVE`).
- **Never use raw `console.*` in frontend code.** Use `teacherLog` (`frontend/src/modules/School/teacher/teacherLog.js`).
- **Wave 1 is whole-course syllabi only.** The `modules` subset field is deliberately NOT in the schema — the planner cannot honor a subset until wave 2 (`planner.mjs:90-95` takes membership from the catalog, and `planner.mjs:137-138` computes module completion over all catalog siblings). Adding the field now would create data the planner silently ignores.
- **`felix.yml` must keep working untouched** throughout. It holds a hand-authored enrollment with no `syllabusId`.

---

## File Structure

**Wave 0 — the blocking bug**
- Modify: `frontend/src/modules/School/teacher/panels/AssignmentsView.jsx`
- Create: `frontend/src/modules/School/teacher/panels/AssignmentsView.test.jsx`

**Wave 1 — backend**
- Create: `backend/src/2_domains/school/curriculum/syllabus.mjs` — pure validation/normalization
- Create: `backend/src/2_domains/school/curriculum/syllabus.test.mjs`
- Create: `backend/src/1_adapters/persistence/yaml/YamlSyllabusStore.mjs`
- Create: `backend/src/3_applications/school/usecases/EnrollLearner.mjs`
- Create: `backend/src/3_applications/school/usecases/EnrollLearner.test.mjs`
- Create: `backend/src/3_applications/school/usecases/UnenrollLearner.mjs`
- Modify: `backend/src/4_api/v1/routers/schoolLifecycle.mjs` — routes
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs` — store + use case wiring
- Modify: `backend/src/app.mjs` — pass through to the router
- Modify: `backend/src/3_applications/school/usecases/GetReportCard.mjs` — multi-enrollment guard

**Wave 1 — frontend**
- Modify: `frontend/src/modules/School/schoolApi.js` — client methods
- Modify: `frontend/src/modules/School/teacher/panels/SchoolMatrix.jsx` — enrollment-aware model + cells
- Modify: `frontend/src/modules/School/teacher/panels/SchoolMatrix.test.jsx`
- Create: `frontend/src/modules/School/teacher/panels/EnrollmentDrawer.jsx`
- Modify: `frontend/src/modules/School/teacher/tabs/PlanningTab.jsx` — standalone group

---

## Task 1: AssignmentsView must not delete enrollments (Wave 0)

`AssignmentsView` reads assignment entries, normalizes each to a bare id string (`idOf`, lines 20-21), and saves back a list of bare ids (`save`, lines 56-61). An entry carrying `profile` and a `school.course-enrollment/v1` block is therefore flattened to `"the-elements-ted-gray"` on any save — silently destroying a hand-authored enrollment. This blocks every other task.

**Files:**
- Modify: `frontend/src/modules/School/teacher/panels/AssignmentsView.jsx:20-21, 43-61`
- Test: `frontend/src/modules/School/teacher/panels/AssignmentsView.test.jsx` (create)

**Interfaces:**
- Consumes: nothing
- Produces: `mergeEntries(originalEntries, checkedIds, key)` — exported from `AssignmentsView.jsx`. Returns an array where a checked id that had an original object entry keeps that whole object, a checked id with no original becomes a bare string, and an unchecked id is dropped.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/School/teacher/panels/AssignmentsView.test.jsx
import { describe, it, expect } from 'vitest';
import { mergeEntries } from './AssignmentsView.jsx';

const ENROLLED = {
  courseId: 'young-peoples-atlas-us',
  profile: 'upper',
  enrollment: {
    schema: 'school.course-enrollment/v1',
    enrollmentId: 'enr-felix-young-peoples-atlas-us',
    courseId: 'young-peoples-atlas-us',
    profile: 'upper',
    moduleOrder: ['united-states', 'midwest'],
    optionalModules: ['bonus'],
    lessonOrder: { midwest: ['atlas-us-p012-midwest'] },
  },
};

describe('mergeEntries — a save must never flatten an enrollment', () => {
  it('keeps the whole object entry for a course that stays checked', () => {
    const out = mergeEntries([ENROLLED], ['young-peoples-atlas-us'], 'courseId');
    expect(out).toEqual([ENROLLED]);
    expect(out[0].enrollment.lessonOrder.midwest).toEqual(['atlas-us-p012-midwest']);
  });

  it('drops an entry the teacher unchecked', () => {
    expect(mergeEntries([ENROLLED], [], 'courseId')).toEqual([]);
  });

  it('adds a newly checked id as a bare string', () => {
    const out = mergeEntries([ENROLLED], ['young-peoples-atlas-us', 'math-fractions'], 'courseId');
    expect(out).toEqual([ENROLLED, 'math-fractions']);
  });

  it('preserves a bare string entry as a bare string', () => {
    expect(mergeEntries(['math-fractions'], ['math-fractions'], 'courseId')).toEqual(['math-fractions']);
  });

  it('preserves unknown fields on an object entry it does not understand', () => {
    const odd = { courseId: 'x', elective: true, somethingNew: 42 };
    expect(mergeEntries([odd], ['x'], 'courseId')).toEqual([odd]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/School/teacher/panels/AssignmentsView.test.jsx`
Expected: FAIL — `mergeEntries is not a function` (it is not exported yet).

- [ ] **Step 3: Add `mergeEntries` and use it in `save`**

Add below the existing `idsOf` helper (after line 21):

```jsx
/**
 * A save must round-trip whatever the record already held. An entry may carry
 * `profile` and a `school.course-enrollment/v1` block (module order, optional
 * modules, a frozen lessonOrder) which this panel neither renders nor
 * understands — flattening it to a bare id silently destroys the enrollment.
 * Checked ids that already had an object entry keep that entire object.
 */
export function mergeEntries(originalEntries, checkedIds, key) {
  const byId = new Map();
  (originalEntries ?? []).forEach((entry) => {
    const id = idOf(entry, key);
    if (id) byId.set(id, entry);
  });
  return checkedIds.map((id) => byId.get(id) ?? id);
}
```

Replace the body of `save` (lines 56-61) with:

```jsx
  const save = () => run('save', ({ actorId, pin }) => schoolApi.putAssignments(learnerId, {
    courses: mergeEntries(record.data?.courses, draft.courses, 'courseId'),
    units: mergeEntries(record.data?.units, draft.units, 'unitId'),
    assignedBy: actorId,
    pin,
    // Concurrent-edit guard (B14): what we LOADED; a stale save is refused
    // with a friendly reload message instead of silently clobbering.
    baseUpdatedAt: record.data?.updatedAt ?? null,
  }), { onSuccess: () => { setEditing(false); record.retry(); } });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/School/teacher/panels/AssignmentsView.test.jsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Add a visible marker for entries this panel cannot edit**

In the editing block, after the course checkbox `<label>` mapping, the object entries are now preserved but invisible. Add a note directly under the Courses group's checkbox list (inside the same `<div className="teacher-assignments__group">`, after the `.map(...)`):

```jsx
            {idsOf(record.data?.courses, 'courseId')
              .filter((id) => (record.data.courses ?? []).some(
                (e) => typeof e === 'object' && e?.courseId === id && e.enrollment,
              ))
              .map((id) => (
                <p key={`enr-${id}`} className="teacher-assignments__enrolled-note">
                  {labelize(id)} has an enrollment — order and profile are edited from The whole school.
                </p>
              ))}
```

- [ ] **Step 6: Run the full School frontend test set**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/School`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/School/teacher/panels/AssignmentsView.jsx \
        frontend/src/modules/School/teacher/panels/AssignmentsView.test.jsx
git commit -m "fix(school): stop AssignmentsView flattening enrollments on save

An assignment entry may carry profile and a school.course-enrollment/v1
block that this panel neither renders nor understands. It normalized every
entry to a bare id and saved bare ids back, so any save through the console
destroyed a hand-authored enrollment. Checked ids now round-trip their
original entry object verbatim."
```

---

## Task 2: Syllabus validation (pure domain)

**Files:**
- Create: `backend/src/2_domains/school/curriculum/syllabus.mjs`
- Test: `backend/src/2_domains/school/curriculum/syllabus.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces: `validateSyllabus(raw, { courseIds, profileIds } = {})` → `{ errors: string[], syllabus?: object }`. `errors` empty means valid and `syllabus` is present. The normalized syllabus is `{ schema, syllabusId, title, courseId, profile, policy, passing, term }` where `profile`, `policy`, `passing` and `term` are `null` when absent.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/2_domains/school/curriculum/syllabus.test.mjs
import { describe, expect, it } from 'vitest';
import { validateSyllabus } from './syllabus.mjs';

const VALID = {
  schema: 'school.syllabus/v1',
  syllabusId: 'elements-lower',
  title: 'The Elements — lower',
  courseId: 'the-elements-ted-gray',
  profile: 'lower',
  policy: { lesson_order: 'sequence' },
  passing: 60,
  term: '2026-fall',
};
const SETS = { courseIds: new Set(['the-elements-ted-gray']), profileIds: new Set(['lower', 'upper']) };

describe('validateSyllabus', () => {
  it('accepts a full record and normalizes it', () => {
    const { errors, syllabus } = validateSyllabus(VALID, SETS);
    expect(errors).toEqual([]);
    expect(syllabus).toEqual(VALID);
  });

  it('accepts a minimal record, nulling the optional fields', () => {
    const { errors, syllabus } = validateSyllabus({
      schema: 'school.syllabus/v1', syllabusId: 'elements-full',
      title: 'The Elements', courseId: 'the-elements-ted-gray',
    }, SETS);
    expect(errors).toEqual([]);
    expect(syllabus.profile).toBeNull();
    expect(syllabus.policy).toBeNull();
    expect(syllabus.passing).toBeNull();
    expect(syllabus.term).toBeNull();
  });

  it('requires the schema discriminator', () => {
    const { errors } = validateSyllabus({ ...VALID, schema: 'school.syllabus/v2' }, SETS);
    expect(errors).toContain('schema must be school.syllabus/v1');
  });

  it('refuses a syllabusId that is not a slug', () => {
    expect(validateSyllabus({ ...VALID, syllabusId: '../escape' }, SETS).errors)
      .toContain('syllabusId must match ^[a-z0-9][a-z0-9-]*$, got: ../escape');
  });

  it('names an unknown course rather than accepting a ghost', () => {
    expect(validateSyllabus({ ...VALID, courseId: 'nope' }, SETS).errors)
      .toContain("unknown course: 'nope' is not in the published catalog");
  });

  it('names an unknown profile', () => {
    expect(validateSyllabus({ ...VALID, profile: 'middle' }, SETS).errors)
      .toContain("unknown profile: 'middle' is not offered by the-elements-ted-gray");
  });

  it('refuses a passing bar outside 1..100', () => {
    expect(validateSyllabus({ ...VALID, passing: 0 }, SETS).errors)
      .toContain('passing must be an integer between 1 and 100');
    expect(validateSyllabus({ ...VALID, passing: 101 }, SETS).errors)
      .toContain('passing must be an integer between 1 and 100');
  });

  it('refuses module subsetting — wave 1 is whole-course only', () => {
    expect(validateSyllabus({ ...VALID, modules: ['period-1'] }, SETS).errors)
      .toContain('modules is not supported yet — a syllabus covers its whole course');
  });

  it('refuses unknown policy keys and bad ordering values', () => {
    expect(validateSyllabus({ ...VALID, policy: { lesson_order: 'random' } }, SETS).errors)
      .toContain('policy.lesson_order must be sequence|shuffle_once, got: random');
    expect(validateSyllabus({ ...VALID, policy: { nope: 1 } }, SETS).errors)
      .toContain('policy has unknown keys: nope');
  });

  it('degrades to accepting when reference sets are unavailable', () => {
    const { errors } = validateSyllabus({ ...VALID, courseId: 'anything' }, {});
    expect(errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs backend/src/2_domains/school/curriculum/syllabus.test.mjs`
Expected: FAIL — cannot resolve `./syllabus.mjs`.

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/2_domains/school/curriculum/syllabus.mjs
/**
 * Pure validation + normalisation of a syllabus (see
 * docs/reference/school/enrollment.md §4). No I/O.
 *
 * A syllabus is a saved, named, reusable set of arguments to
 * `createCourseEnrollment` — which course, at what profile, under what
 * ordering policy, against what pass bar. It holds no learner: an ENROLLMENT
 * maps a learner to a syllabus, and materializes the result onto the
 * learner's assignment entry.
 *
 * Reference checks are ADVISORY IN POSTURE, the same rule `SetAssignments`
 * holds to: when the caller cannot supply the reference set, they are skipped
 * (a broken catalog must not lock syllabus edits shut), but a set that IS
 * supplied and does not know the id is a refusal that names the ghost.
 */
export const SYLLABUS_SCHEMA = 'school.syllabus/v1';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const ORDERINGS = ['sequence', 'shuffle_once'];
const POLICY_KEYS = ['module_order', 'lesson_order', 'required_opening_module'];

const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isPresent = (v) => v !== undefined && v !== null;

/**
 * @param {*} raw - one parsed syllabus record
 * @param {{courseIds?: Set<string>, profileIds?: Set<string>}} [sets]
 *   `profileIds` are the profiles the NAMED COURSE authors (`work.profiles`).
 * @returns {{errors: string[], syllabus?: object}}
 */
export function validateSyllabus(raw, sets = {}) {
  if (!isObj(raw)) return { errors: ['syllabus must be a mapping'] };
  const errors = [];

  if (raw.schema !== SYLLABUS_SCHEMA) errors.push(`schema must be ${SYLLABUS_SCHEMA}`);

  if (!isText(raw.syllabusId)) errors.push('syllabusId is required');
  else if (!SLUG.test(raw.syllabusId)) errors.push(`syllabusId must match ${SLUG.source}, got: ${raw.syllabusId}`);

  if (!isText(raw.title)) errors.push('title is required');

  if (!isText(raw.courseId)) {
    errors.push('courseId is required');
  } else if (sets.courseIds?.size && !sets.courseIds.has(raw.courseId)) {
    errors.push(`unknown course: '${raw.courseId}' is not in the published catalog`);
  }

  // Wave 1 is whole-course only: the planner takes membership from the catalog
  // (planner.mjs:90-95) and computes module completion over ALL catalog
  // siblings (planner.mjs:137-138), so a subset would be silently ignored.
  // Refuse the field rather than store data nothing honors.
  if (isPresent(raw.modules)) {
    errors.push('modules is not supported yet — a syllabus covers its whole course');
  }

  let profile = null;
  if (isPresent(raw.profile)) {
    if (!isText(raw.profile)) errors.push('profile must be a non-empty string');
    else if (sets.profileIds?.size && !sets.profileIds.has(raw.profile)) {
      errors.push(`unknown profile: '${raw.profile}' is not offered by ${raw.courseId}`);
    } else profile = raw.profile;
  }

  let policy = null;
  if (isPresent(raw.policy)) {
    if (!isObj(raw.policy)) {
      errors.push('policy must be an object');
    } else {
      const unknown = Object.keys(raw.policy).filter((k) => !POLICY_KEYS.includes(k));
      if (unknown.length) errors.push(`policy has unknown keys: ${unknown.join(', ')}`);
      ['module_order', 'lesson_order'].forEach((key) => {
        if (isPresent(raw.policy[key]) && !ORDERINGS.includes(raw.policy[key])) {
          errors.push(`policy.${key} must be ${ORDERINGS.join('|')}, got: ${raw.policy[key]}`);
        }
      });
      if (isPresent(raw.policy.required_opening_module) && !isText(raw.policy.required_opening_module)) {
        errors.push('policy.required_opening_module must be a non-empty string');
      }
      if (!unknown.length) policy = raw.policy;
    }
  }

  let passing = null;
  if (isPresent(raw.passing)) {
    if (!Number.isInteger(raw.passing) || raw.passing < 1 || raw.passing > 100) {
      errors.push('passing must be an integer between 1 and 100');
    } else passing = raw.passing;
  }

  let term = null;
  if (isPresent(raw.term)) {
    if (!isText(raw.term)) errors.push('term must be a non-empty string');
    else term = raw.term;
  }

  if (errors.length) return { errors };
  return {
    errors,
    syllabus: {
      schema: SYLLABUS_SCHEMA,
      syllabusId: raw.syllabusId,
      title: raw.title,
      courseId: raw.courseId,
      profile,
      policy,
      passing,
      term,
    },
  };
}

export default validateSyllabus;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs backend/src/2_domains/school/curriculum/syllabus.test.mjs`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/school/curriculum/syllabus.mjs \
        backend/src/2_domains/school/curriculum/syllabus.test.mjs
git commit -m "feat(school): add school.syllabus/v1 validation

A syllabus is a saved set of arguments to createCourseEnrollment: course,
profile, ordering policy, pass bar. Reference checks are advisory in posture
(skipped when the caller supplies no sets, naming the ghost when it does),
matching SetAssignments. The modules subset field is refused: the planner
cannot honor a subset until wave 2, and storing one would be data nothing
reads."
```

---

## Task 3: `YamlSyllabusStore`

Mirrors `YamlAssignmentStore` exactly: one file per record, atomic write-beside-and-rename, a serialized write chain, and refusal to overwrite a file that is currently corrupt.

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlSyllabusStore.mjs`

**Interfaces:**
- Consumes: `validateSyllabus` from Task 2.
- Produces: class `YamlSyllabusStore` with `async get(syllabusId)` → record or `null`; `async list()` → array of non-archived records sorted by `syllabusId`; `async put(record)` → the stored record (stamps `updatedAt`); `async archive(syllabusId, { archivedBy })` → the archived record or `null`. Stored records carry `updatedAt`, `archivedAt` and `archivedBy` alongside the validated fields.

- [ ] **Step 1: Write the implementation**

```javascript
// backend/src/1_adapters/persistence/yaml/YamlSyllabusStore.mjs
/**
 * YAML persistence for syllabi (docs/reference/school/enrollment.md §4).
 *
 *   <dataDir>/household/apps/school/syllabi/{syllabusId}.yml
 *
 * Same posture as the sibling `YamlAssignmentStore`: parent-editable by hand,
 * atomic replace, one serialized write chain, and a refusal to clobber a file
 * that is currently unparseable — a parent mid-edit must not lose their work
 * to a console save.
 *
 * Archival is a soft delete (`archivedAt`), never an unlink: an enrollment
 * keeps a `syllabusId` as provenance, and the drawer must still be able to
 * name where an enrollment came from after the syllabus stops being offered.
 */
import path from 'path';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const YAML_FILE_RE = /\.(yml|yaml)$/;

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });
const isSafeId = (id) => typeof id === 'string' && SLUG.test(id);
const stagingPathFor = (filePath) => `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export class YamlSyllabusStore {
  #configService;
  #logger;
  #writeChain = Promise.resolve();
  #corrupt = new Set();

  constructor(config = {}) {
    if (!config.configService || typeof config.configService.getHouseholdPath !== 'function') {
      throw new Error('YamlSyllabusStore: configService with getHouseholdPath() is required');
    }
    this.#configService = config.configService;
    this.#logger = config.logger || console;
  }

  #root() { return this.#configService.getHouseholdPath('apps/school/syllabi'); }

  #fileFor(syllabusId) { return path.join(this.#root(), `${syllabusId}.yml`); }

  async #read(syllabusId) {
    let text;
    try {
      text = await fs.readFile(this.#fileFor(syllabusId), 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT') { this.#corrupt.delete(syllabusId); return null; }
      this.#markCorrupt(syllabusId);
      return null;
    }
    let raw;
    try {
      raw = yaml.load(text);
    } catch {
      this.#markCorrupt(syllabusId);
      return null;
    }
    this.#corrupt.delete(syllabusId);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw;
  }

  #markCorrupt(syllabusId) {
    this.#corrupt.add(syllabusId);
    this.#logger.warn?.('school.syllabus.file-corrupt', { syllabusId, file: this.#fileFor(syllabusId) });
  }

  async #writeYamlAtomic(filePath, content) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const staging = stagingPathFor(filePath);
    try {
      await fs.writeFile(staging, dumpYaml(content), 'utf8');
      await fs.rename(staging, filePath);
    } catch (err) {
      await fs.unlink(staging).catch(() => {});
      throw err;
    }
  }

  async get(syllabusId) {
    if (!isSafeId(syllabusId)) return null;
    return this.#read(syllabusId);
  }

  async list() {
    let names;
    try {
      names = await fs.readdir(this.#root());
    } catch {
      return [];
    }
    const ids = names
      .filter((n) => YAML_FILE_RE.test(n))
      .map((n) => n.replace(YAML_FILE_RE, ''))
      .filter(isSafeId)
      .sort();
    const records = await Promise.all(ids.map((id) => this.#read(id)));
    return records.filter((r) => r && !r.archivedAt);
  }

  async put(record) {
    const { syllabusId } = record ?? {};
    if (!isSafeId(syllabusId)) throw new Error(`YamlSyllabusStore: unsafe syllabusId: ${syllabusId}`);
    const stored = { ...record, updatedAt: record.updatedAt ?? new Date().toISOString() };
    const queued = this.#writeChain.then(async () => {
      await this.#read(syllabusId); // for its side effect on #corrupt
      if (this.#corrupt.has(syllabusId)) {
        throw new DomainInvariantError(
          `syllabus file '${syllabusId}' is corrupt — refusing to overwrite it`,
          { code: 'SYLLABUS_CORRUPT', details: { syllabusId, file: this.#fileFor(syllabusId) } },
        );
      }
      await this.#writeYamlAtomic(this.#fileFor(syllabusId), stored);
      this.#corrupt.delete(syllabusId);
      return stored;
    });
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  async archive(syllabusId, { archivedBy = null, at = new Date().toISOString() } = {}) {
    const current = await this.get(syllabusId);
    if (!current) return null;
    return this.put({ ...current, archivedAt: at, archivedBy, updatedAt: at });
  }
}

export default YamlSyllabusStore;
```

- [ ] **Step 2: Verify it parses and the layer gate still passes**

Run: `npx vitest run --config vitest.config.mjs tests/unit/tooling/auditLayerImports.test.mjs`
Expected: PASS — an adapter importing `#domains/core/errors` is the same import `YamlAssignmentStore` already makes.

- [ ] **Step 3: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlSyllabusStore.mjs
git commit -m "feat(school): add YamlSyllabusStore

One file per syllabus under household/apps/school/syllabi/, with the same
posture as YamlAssignmentStore: atomic replace, a serialized write chain, and
refusal to clobber a file that is currently unparseable. Archival is a soft
delete, never an unlink -- an enrollment keeps syllabusId as provenance and
must still be able to name where it came from."
```

---

## Task 4: `EnrollLearner` use case

The heart of the wave. Loads a syllabus, loads the course's units and progression policy, calls `createCourseEnrollment`, and writes the result onto the learner's assignment entry where `planner.mjs` already reads it.

**Files:**
- Create: `backend/src/3_applications/school/usecases/EnrollLearner.mjs`
- Test: `backend/src/3_applications/school/usecases/EnrollLearner.test.mjs`

**Interfaces:**
- Consumes: `createCourseEnrollment` (`#domains/school/curriculum/enrollment.mjs`), `YamlSyllabusStore` (Task 3), `IAssignmentStore`, `CurriculumAccess` (`listUnits()`, `getWork(courseId)`), `IWorkSessionRepository` (`listOpenForLearner(learnerId)`), `TeacherGate`.
- Produces: class `EnrollLearner`, `async execute({ learnerId, syllabusId, enrolledBy, pin, rematerialize = false, baseUpdatedAt })` → the stored assignment record. Throws `ValidationError` for an unknown syllabus, an already-enrolled course without `rematerialize`, a stale `baseUpdatedAt` (409 `STALE_SAVE`), or open sessions blocking a re-materialize (409 `OPEN_SESSIONS`, with `err.details.sessions`).

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/3_applications/school/usecases/EnrollLearner.test.mjs
import { describe, expect, it, beforeEach } from 'vitest';
import { EnrollLearner } from './EnrollLearner.mjs';

const UNITS = [
  { unitId: 'el.01', courseId: 'elements', module: 'foundations', moduleRole: 'overview', sequence: 1 },
  { unitId: 'el.02', courseId: 'elements', module: 'period-1', moduleRole: 'lesson', sequence: 2 },
  { unitId: 'el.03', courseId: 'elements', module: 'period-1', moduleRole: 'lesson', sequence: 3 },
  { unitId: 'other.01', courseId: 'other-course', module: 'x', moduleRole: 'lesson', sequence: 1 },
];
const WORK = {
  work: 'elements',
  progression: { mode: 'module_blocks', required_opening_module: 'foundations', one_active_module: true, module_order: 'fixed', lesson_order: 'shuffle_once' },
};
const SYLLABUS = {
  schema: 'school.syllabus/v1', syllabusId: 'elements-lower', title: 'Elements — lower',
  courseId: 'elements', profile: 'lower', policy: null, passing: 60, term: null,
};

function harness({ assignment = null, open = [] } = {}) {
  const saved = [];
  return {
    saved,
    useCase: new EnrollLearner({
      syllabi: { get: async (id) => (id === 'elements-lower' ? SYLLABUS : null) },
      assignments: {
        get: async () => assignment,
        put: async (record) => { saved.push(record); return record; },
      },
      curriculum: { listUnits: async () => UNITS, getWork: async (id) => (id === 'elements' ? WORK : null) },
      sessions: { listOpenForLearner: async () => open },
      teacherGate: { assert: () => true },
      clock: () => new Date('2026-09-08T12:00:00.000Z'),
      rng: () => 0,
      logger: { info: () => {}, warn: () => {} },
    }),
  };
}

describe('EnrollLearner', () => {
  let h;
  beforeEach(() => { h = harness(); });

  it('materializes an enrollment onto a new assignment entry', async () => {
    await h.useCase.execute({ learnerId: 'milo', syllabusId: 'elements-lower', enrolledBy: 'kckern', pin: '7410' });
    const [record] = h.saved;
    expect(record.learnerId).toBe('milo');
    const entry = record.courses.find((c) => c.courseId === 'elements');
    expect(entry.profile).toBe('lower');
    expect(entry.syllabusId).toBe('elements-lower');
    expect(entry.passing).toBe(60);
    expect(entry.enrollment.schema).toBe('school.course-enrollment/v1');
    expect(entry.enrollment.moduleOrder[0]).toBe('foundations');
  });

  it('scopes materialization to the syllabus course only', async () => {
    await h.useCase.execute({ learnerId: 'milo', syllabusId: 'elements-lower', enrolledBy: 'kckern', pin: '7410' });
    const entry = h.saved[0].courses.find((c) => c.courseId === 'elements');
    expect(Object.keys(entry.enrollment.lessonOrder)).not.toContain('x');
  });

  it('refuses an unknown syllabus by name', async () => {
    await expect(h.useCase.execute({ learnerId: 'milo', syllabusId: 'ghost', enrolledBy: 'kckern', pin: '7410' }))
      .rejects.toThrow("unknown syllabus: 'ghost'");
  });

  it('refuses a second enrollment in the same course without rematerialize', async () => {
    const hh = harness({ assignment: { learnerId: 'milo', courses: [{ courseId: 'elements' }], units: [], updatedAt: null } });
    await expect(hh.useCase.execute({ learnerId: 'milo', syllabusId: 'elements-lower', enrolledBy: 'kckern', pin: '7410' }))
      .rejects.toThrow('milo is already enrolled in elements');
  });

  it('refuses a re-materialize while a session on that course is open', async () => {
    const hh = harness({
      assignment: { learnerId: 'milo', courses: [{ courseId: 'elements' }], units: [], updatedAt: null },
      open: [{ sessionId: 'ws_1', unitId: 'el.02', state: 'issued' }],
    });
    await expect(hh.useCase.execute({
      learnerId: 'milo', syllabusId: 'elements-lower', enrolledBy: 'kckern', pin: '7410', rematerialize: true,
    })).rejects.toThrow(/open session/i);
  });

  it('ignores an open session on a DIFFERENT course', async () => {
    const hh = harness({
      assignment: { learnerId: 'milo', courses: [{ courseId: 'elements' }], units: [], updatedAt: null },
      open: [{ sessionId: 'ws_2', unitId: 'other.01', state: 'issued' }],
    });
    await hh.useCase.execute({
      learnerId: 'milo', syllabusId: 'elements-lower', enrolledBy: 'kckern', pin: '7410', rematerialize: true,
    });
    expect(hh.saved).toHaveLength(1);
  });

  it('refuses a stale save', async () => {
    const hh = harness({ assignment: { learnerId: 'milo', courses: [], units: [], updatedAt: '2026-09-01T00:00:00.000Z' } });
    await expect(hh.useCase.execute({
      learnerId: 'milo', syllabusId: 'elements-lower', enrolledBy: 'kckern', pin: '7410', baseUpdatedAt: null,
    })).rejects.toThrow(/changed since you loaded/);
  });

  it('preserves other courses and standalone units untouched', async () => {
    const hh = harness({
      assignment: {
        learnerId: 'milo',
        courses: ['math-fractions'],
        units: ['language-daily'],
        updatedAt: null,
      },
    });
    await hh.useCase.execute({ learnerId: 'milo', syllabusId: 'elements-lower', enrolledBy: 'kckern', pin: '7410' });
    expect(hh.saved[0].courses[0]).toBe('math-fractions');
    expect(hh.saved[0].units).toEqual(['language-daily']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs backend/src/3_applications/school/usecases/EnrollLearner.test.mjs`
Expected: FAIL — cannot resolve `./EnrollLearner.mjs`.

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/3_applications/school/usecases/EnrollLearner.mjs
/**
 * EnrollLearner — materialize a syllabus onto a learner (see
 * docs/reference/school/enrollment.md §4).
 *
 * `createCourseEnrollment` already existed, was tested, and was called by
 * nothing: every enrollment in production was hand-typed YAML. This is its
 * caller. The record it returns is written onto the learner's assignment
 * entry, which is exactly where `planner.mjs` already reads it — so nothing
 * about the runtime changes.
 *
 * Materialization is a SNAPSHOT. `lessonOrder` is persisted precisely so a
 * `shuffle_once` order cannot move under a learner mid-course, which means a
 * later syllabus edit does not reach existing enrollments; re-materializing is
 * an explicit act, and it is refused while any session on that course is open
 * (a session on a lesson leaving the enrollment would strand).
 */
import { createCourseEnrollment } from '#domains/school/curriculum/enrollment.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

export class EnrollLearner {
  #syllabi; #assignments; #curriculum; #sessions; #teacherGate; #clock; #rng; #logger;

  constructor({ syllabi, assignments, curriculum, sessions = null, teacherGate = null, clock = () => new Date(), rng = Math.random, logger = console } = {}) {
    if (!syllabi) throw new Error('EnrollLearner requires a syllabi store');
    if (!assignments) throw new Error('EnrollLearner requires an assignments store');
    if (!curriculum) throw new Error('EnrollLearner requires curriculum access');
    this.#syllabi = syllabi;
    this.#assignments = assignments;
    this.#curriculum = curriculum;
    this.#sessions = sessions;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#rng = rng;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.learnerId
   * @param {string} args.syllabusId
   * @param {string} args.enrolledBy - a roster id that must pass TeacherGate
   * @param {string|null} [args.pin]
   * @param {boolean} [args.rematerialize] - re-run the materializer over an
   *   existing entry, re-shuffling any `shuffle_once` ordering
   * @param {string|null} [args.baseUpdatedAt] - the assignment `updatedAt` the
   *   caller loaded; a mismatch is a 409 rather than a silent clobber
   * @returns {Promise<object>} the stored assignment record
   */
  async execute({ learnerId, syllabusId, enrolledBy = null, pin = null, rematerialize = false, baseUpdatedAt = undefined } = {}) {
    this.#teacherGate?.assert({ userId: enrolledBy, pin, action: 'enrollment.put', context: { learnerId, syllabusId } });

    if (typeof learnerId !== 'string' || !learnerId.trim()) throw new ValidationError('learnerId is required');

    const syllabus = await this.#syllabi.get(syllabusId);
    if (!syllabus || syllabus.archivedAt) throw new ValidationError(`unknown syllabus: '${syllabusId}'`);
    const { courseId } = syllabus;

    const current = await this.#assignments.get(learnerId);
    if (baseUpdatedAt !== undefined && (current?.updatedAt ?? null) !== baseUpdatedAt) {
      const err = new ValidationError('Assignments changed since you loaded them — reload and try again.');
      err.code = 'STALE_SAVE';
      err.status = 409;
      throw err;
    }

    const courses = [...(current?.courses ?? [])];
    const indexOf = courses.findIndex((entry) => (typeof entry === 'string' ? entry : entry?.courseId) === courseId);
    if (indexOf !== -1 && !rematerialize) {
      throw new ValidationError(`${learnerId} is already enrolled in ${courseId} — re-materialize instead`);
    }

    const allUnits = (await this.#curriculum.listUnits()) ?? [];
    const courseUnits = allUnits.filter((u) => u?.courseId === courseId);
    if (!courseUnits.length) throw new ValidationError(`${courseId} publishes no units`);

    // Re-shuffling under a learner who is mid-worksheet would change the order
    // of work they are holding. Refuse, naming the sessions; the teacher can
    // close or abandon them and try again.
    if (rematerialize && this.#sessions) {
      const inCourse = new Set(courseUnits.map((u) => u.unitId));
      const open = ((await this.#sessions.listOpenForLearner(learnerId)) ?? [])
        .filter((row) => row?.unitId && inCourse.has(row.unitId));
      if (open.length) {
        const err = new ValidationError(
          `${learnerId} has ${open.length} open session${open.length === 1 ? '' : 's'} on ${courseId} — close or abandon them before re-materializing`,
        );
        err.code = 'OPEN_SESSIONS';
        err.status = 409;
        err.details = { sessions: open.map((r) => ({ sessionId: r.sessionId, unitId: r.unitId, state: r.state })) };
        throw err;
      }
    }

    const work = await this.#curriculum.getWork?.(courseId);
    const policy = { ...(work?.progression ?? {}), ...(syllabus.policy ?? {}) };
    const nowIso = this.#clock().toISOString();

    const enrollment = createCourseEnrollment({
      enrollmentId: `enr-${learnerId}-${courseId}`,
      courseId,
      profile: syllabus.profile,
      units: courseUnits,
      policy,
      rng: this.#rng,
    });

    const entry = {
      courseId,
      ...(syllabus.profile ? { profile: syllabus.profile } : {}),
      syllabusId: syllabus.syllabusId,
      ...(syllabus.passing !== null ? { passing: syllabus.passing } : {}),
      enrolledAt: nowIso,
      enrollment,
    };
    if (indexOf === -1) courses.push(entry); else courses[indexOf] = entry;

    const record = await this.#assignments.put({
      learnerId,
      courses,
      units: current?.units ?? [],
      assignedBy: enrolledBy,
      updatedAt: nowIso,
    });
    this.#logger.info?.('school.enrollment.materialized', {
      learnerId, courseId, syllabusId: syllabus.syllabusId, rematerialize,
      modules: enrollment.moduleOrder.length,
    });
    return record;
  }
}

export default EnrollLearner;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs backend/src/3_applications/school/usecases/EnrollLearner.test.mjs`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/school/usecases/EnrollLearner.mjs \
        backend/src/3_applications/school/usecases/EnrollLearner.test.mjs
git commit -m "feat(school): add EnrollLearner, the first caller of createCourseEnrollment

Materializes a syllabus onto a learner's assignment entry, where planner.mjs
already reads it -- no runtime path changes. Materialization is a snapshot,
since lessonOrder is persisted so a shuffle cannot move mid-course; a
re-materialize is explicit and is refused (409 OPEN_SESSIONS) while any
session on that course is open, because a session on a lesson leaving the
enrollment would strand. Other courses and standalone units round-trip
untouched."
```

---

## Task 5: `UnenrollLearner` use case

Same open-session refusal as re-materializing, for the same reason: removing the entry while a session is open strands it off-agenda.

**Files:**
- Create: `backend/src/3_applications/school/usecases/UnenrollLearner.mjs`
- Test: append to `backend/src/3_applications/school/usecases/EnrollLearner.test.mjs`

**Interfaces:**
- Consumes: same stores as Task 4.
- Produces: class `UnenrollLearner`, `async execute({ learnerId, courseId, removedBy, pin, baseUpdatedAt })` → the stored assignment record. Throws `ValidationError` when not enrolled, on a stale save, or on open sessions.

- [ ] **Step 1: Write the failing test**

Append to `EnrollLearner.test.mjs`:

```javascript
import { UnenrollLearner } from './UnenrollLearner.mjs';

function unenrollHarness({ assignment, open = [] }) {
  const saved = [];
  return {
    saved,
    useCase: new UnenrollLearner({
      assignments: { get: async () => assignment, put: async (r) => { saved.push(r); return r; } },
      curriculum: { listUnits: async () => UNITS },
      sessions: { listOpenForLearner: async () => open },
      teacherGate: { assert: () => true },
      clock: () => new Date('2026-09-08T12:00:00.000Z'),
      logger: { info: () => {}, warn: () => {} },
    }),
  };
}

describe('UnenrollLearner', () => {
  const enrolled = { learnerId: 'milo', courses: [{ courseId: 'elements' }, 'math-fractions'], units: ['language-daily'], updatedAt: null };

  it('removes the course entry and leaves everything else alone', async () => {
    const h = unenrollHarness({ assignment: enrolled });
    await h.useCase.execute({ learnerId: 'milo', courseId: 'elements', removedBy: 'kckern', pin: '7410' });
    expect(h.saved[0].courses).toEqual(['math-fractions']);
    expect(h.saved[0].units).toEqual(['language-daily']);
  });

  it('refuses when the learner is not enrolled in that course', async () => {
    const h = unenrollHarness({ assignment: { learnerId: 'milo', courses: [], units: [], updatedAt: null } });
    await expect(h.useCase.execute({ learnerId: 'milo', courseId: 'elements', removedBy: 'kckern', pin: '7410' }))
      .rejects.toThrow('milo is not enrolled in elements');
  });

  it('refuses while a session on that course is open', async () => {
    const h = unenrollHarness({ assignment: enrolled, open: [{ sessionId: 'ws_1', unitId: 'el.02', state: 'issued' }] });
    await expect(h.useCase.execute({ learnerId: 'milo', courseId: 'elements', removedBy: 'kckern', pin: '7410' }))
      .rejects.toThrow(/open session/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs backend/src/3_applications/school/usecases/EnrollLearner.test.mjs`
Expected: FAIL — cannot resolve `./UnenrollLearner.mjs`.

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/3_applications/school/usecases/UnenrollLearner.mjs
/**
 * UnenrollLearner — drop a course entry from a learner's assignment record.
 *
 * Carries the same open-session refusal as re-materializing (EnrollLearner):
 * removing the entry while a session on that course is open leaves the session
 * open forever and off the agenda, which is the ghost-session failure this
 * codebase has been bitten by before.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';

export class UnenrollLearner {
  #assignments; #curriculum; #sessions; #teacherGate; #clock; #logger;

  constructor({ assignments, curriculum, sessions = null, teacherGate = null, clock = () => new Date(), logger = console } = {}) {
    if (!assignments) throw new Error('UnenrollLearner requires an assignments store');
    if (!curriculum) throw new Error('UnenrollLearner requires curriculum access');
    this.#assignments = assignments;
    this.#curriculum = curriculum;
    this.#sessions = sessions;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#logger = logger;
  }

  async execute({ learnerId, courseId, removedBy = null, pin = null, baseUpdatedAt = undefined } = {}) {
    this.#teacherGate?.assert({ userId: removedBy, pin, action: 'enrollment.delete', context: { learnerId, courseId } });

    if (typeof learnerId !== 'string' || !learnerId.trim()) throw new ValidationError('learnerId is required');
    if (typeof courseId !== 'string' || !courseId.trim()) throw new ValidationError('courseId is required');

    const current = await this.#assignments.get(learnerId);
    if (baseUpdatedAt !== undefined && (current?.updatedAt ?? null) !== baseUpdatedAt) {
      const err = new ValidationError('Assignments changed since you loaded them — reload and try again.');
      err.code = 'STALE_SAVE';
      err.status = 409;
      throw err;
    }

    const courses = [...(current?.courses ?? [])];
    const indexOf = courses.findIndex((entry) => (typeof entry === 'string' ? entry : entry?.courseId) === courseId);
    if (indexOf === -1) throw new ValidationError(`${learnerId} is not enrolled in ${courseId}`);

    if (this.#sessions) {
      const inCourse = new Set(((await this.#curriculum.listUnits()) ?? [])
        .filter((u) => u?.courseId === courseId).map((u) => u.unitId));
      const open = ((await this.#sessions.listOpenForLearner(learnerId)) ?? [])
        .filter((row) => row?.unitId && inCourse.has(row.unitId));
      if (open.length) {
        const err = new ValidationError(
          `${learnerId} has ${open.length} open session${open.length === 1 ? '' : 's'} on ${courseId} — close or abandon them before unenrolling`,
        );
        err.code = 'OPEN_SESSIONS';
        err.status = 409;
        err.details = { sessions: open.map((r) => ({ sessionId: r.sessionId, unitId: r.unitId, state: r.state })) };
        throw err;
      }
    }

    courses.splice(indexOf, 1);
    const record = await this.#assignments.put({
      learnerId,
      courses,
      units: current?.units ?? [],
      assignedBy: removedBy,
      updatedAt: this.#clock().toISOString(),
    });
    this.#logger.info?.('school.enrollment.removed', { learnerId, courseId, removedBy });
    return record;
  }
}

export default UnenrollLearner;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs backend/src/3_applications/school/usecases/EnrollLearner.test.mjs`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/school/usecases/UnenrollLearner.mjs \
        backend/src/3_applications/school/usecases/EnrollLearner.test.mjs
git commit -m "feat(school): add UnenrollLearner with the same open-session refusal

Dropping a course entry while a session on it is open would leave that
session open forever and off the agenda -- the ghost-session failure mode
this codebase has hit before. Same 409 OPEN_SESSIONS refusal as
re-materializing."
```

---

## Task 6: API routes and composition wiring

**Files:**
- Modify: `backend/src/4_api/v1/routers/schoolLifecycle.mjs` — add `syllabi`, `enrollLearner`, `unenrollLearner` deps and their routes, next to the existing assignments routes (after line ~439)
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs` — build the store and use cases
- Modify: `backend/src/app.mjs` — pass them into the lifecycle router

**Interfaces:**
- Consumes: `YamlSyllabusStore` (Task 3), `EnrollLearner` (Task 4), `UnenrollLearner` (Task 5), `validateSyllabus` (Task 2).
- Produces: HTTP surface —
  - `GET  /api/v1/school/lifecycle/syllabi` → `{ syllabi: [...] }`
  - `GET  /api/v1/school/lifecycle/syllabi/:syllabusId` → the record, 404 if absent
  - `PUT  /api/v1/school/lifecycle/syllabi/:syllabusId` (guarded) body `{ ...syllabus, editedBy, pin }` → the stored record
  - `POST /api/v1/school/lifecycle/syllabi/:syllabusId/archive` (guarded) body `{ archivedBy, pin }`
  - `POST /api/v1/school/lifecycle/enrollments/:learnerId` (guarded) body `{ syllabusId, rematerialize, enrolledBy, pin, baseUpdatedAt }`
  - `DELETE /api/v1/school/lifecycle/enrollments/:learnerId/:courseId` (guarded) body `{ removedBy, pin, baseUpdatedAt }`

- [ ] **Step 1: Add the router parameters**

In `createSchoolLifecycleRouter`'s destructured parameter list (alongside `setAssignments = null,`), add:

```javascript
  syllabi = null,
  enrollLearner = null,
  unenrollLearner = null,
```

- [ ] **Step 2: Add the routes**

Insert immediately after the closing brace of the existing `if (setAssignments) { ... }` block:

```javascript
  // --- syllabi: the saved arguments a materialized enrollment is built from ---
  if (syllabi) {
    router.get('/syllabi', asyncHandler(async (_req, res) => {
      res.json({ syllabi: await syllabi.list() });
    }));

    router.get('/syllabi/:syllabusId', asyncHandler(async (req, res) => {
      const record = await syllabi.get(req.params.syllabusId);
      if (!record) {
        const err = new Error(`no syllabus ${req.params.syllabusId}`);
        err.status = 404;
        throw err;
      }
      res.json(record);
    }));

    router.put('/syllabi/:syllabusId', guarded(async (req, res) => {
      const { editedBy = null, pin = null, ...body } = req.body || {};
      res.json(await syllabi.save({
        raw: { ...body, syllabusId: req.params.syllabusId },
        editedBy,
        pin,
      }));
    }));

    router.post('/syllabi/:syllabusId/archive', guarded(async (req, res) => {
      const { archivedBy = null, pin = null } = req.body || {};
      const record = await syllabi.archiveGuarded({ syllabusId: req.params.syllabusId, archivedBy, pin });
      if (!record) {
        const err = new Error(`no syllabus ${req.params.syllabusId}`);
        err.status = 404;
        throw err;
      }
      res.json(record);
    }));
  }

  if (enrollLearner) {
    router.post('/enrollments/:learnerId', guarded(async (req, res) => {
      const { syllabusId, rematerialize = false, enrolledBy = null, pin = null, baseUpdatedAt } = req.body || {};
      res.json(await enrollLearner.execute({
        learnerId: req.params.learnerId, syllabusId, rematerialize: rematerialize === true,
        enrolledBy, pin, baseUpdatedAt,
      }));
    }));
  }

  if (unenrollLearner) {
    router.delete('/enrollments/:learnerId/:courseId', guarded(async (req, res) => {
      const { removedBy = null, pin = null, baseUpdatedAt } = req.body || {};
      res.json(await unenrollLearner.execute({
        learnerId: req.params.learnerId, courseId: req.params.courseId, removedBy, pin, baseUpdatedAt,
      }));
    }));
  }
```

- [ ] **Step 3: Add the guarded syllabus writer in composition**

The router calls `syllabi.save(...)` and `syllabi.archiveGuarded(...)` rather than the raw store, so the gate and validation live outside the HTTP layer. In `backend/src/5_composition/modules/schoolLifecycle.mjs`, next to where `passOverrides` is built, add:

```javascript
  const syllabusStore = new YamlSyllabusStore({ configService, logger });
  // The store is dumb; validation and the teacher gate belong to the write,
  // not to persistence — the same split SetAssignments/YamlAssignmentStore use.
  const syllabi = {
    get: (id) => syllabusStore.get(id),
    list: () => syllabusStore.list(),
    async save({ raw, editedBy, pin }) {
      teacherGate.assert({ userId: editedBy, pin, action: 'syllabus.put', context: { syllabusId: raw?.syllabusId } });
      const works = await curriculum.listWorks();
      const courseIds = new Set(works.map((w) => w.work).filter(Boolean));
      const profileIds = new Set(Object.keys(works.find((w) => w.work === raw?.courseId)?.profiles ?? {}));
      const { errors, syllabus } = validateSyllabus({ schema: 'school.syllabus/v1', ...raw }, { courseIds, profileIds });
      if (errors.length) {
        const err = new ValidationError(errors.join('; '));
        err.status = 400;
        throw err;
      }
      return syllabusStore.put({ ...syllabus, editedBy, updatedAt: clock().toISOString() });
    },
    archiveGuarded({ syllabusId, archivedBy, pin }) {
      teacherGate.assert({ userId: archivedBy, pin, action: 'syllabus.archive', context: { syllabusId } });
      return syllabusStore.archive(syllabusId, { archivedBy, at: clock().toISOString() });
    },
  };

  const enrollLearner = new EnrollLearner({
    syllabi: syllabusStore, assignments: stores.assignments, curriculum,
    sessions: stores.sessions, teacherGate, clock, logger,
  });
  const unenrollLearner = new UnenrollLearner({
    assignments: stores.assignments, curriculum, sessions: stores.sessions, teacherGate, clock, logger,
  });
```

These are the names already in that file's scope: `curriculum` is the `CurriculumAccess` built at line 393, `stores.assignments` and `stores.sessions` are the store bundle used at lines 636 and 654, and `teacherGate`, `clock`, `logger` and `configService` are already in scope where `passOverrides` is built.

Add the imports at the top of that file:

```javascript
import { YamlSyllabusStore } from '#adapters/persistence/yaml/YamlSyllabusStore.mjs';
import { validateSyllabus } from '#domains/school/curriculum/syllabus.mjs';
import { EnrollLearner } from '#apps/school/usecases/EnrollLearner.mjs';
import { UnenrollLearner } from '#apps/school/usecases/UnenrollLearner.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';
```

If `ValidationError` is already imported there, do not duplicate the import.

Then add `syllabi`, `enrollLearner`, `unenrollLearner` to that module's returned object, next to the existing `passOverrides,` entry (line ~723).

- [ ] **Step 4: Pass them into the router in `app.mjs`**

Find the `createSchoolLifecycleRouter({ ... })` call and add, alongside the existing `setAssignments`:

```javascript
    syllabi: schoolLifecycle.syllabi ?? null,
    enrollLearner: schoolLifecycle.enrollLearner ?? null,
    unenrollLearner: schoolLifecycle.unenrollLearner ?? null,
```

- [ ] **Step 5: Verify the app still boots and the routes answer**

```bash
# From the repo root, in a scratch terminal:
node backend/index.js > /tmp/enroll-boot.log 2>&1 &
sleep 8
curl -s localhost:3113/api/v1/school/lifecycle/syllabi
# Expected: {"syllabi":[]}
curl -s -o /dev/null -w '%{http_code}\n' localhost:3113/api/v1/school/lifecycle/syllabi/ghost
# Expected: 404
pkill -f 'node backend/index.js'
```

> Port: this host runs the dev backend on 3113 (see CLAUDE.md's multi-environment table). Check `ss -tlnp | grep 311` before starting, and do not start a second server if one is already listening.

- [ ] **Step 6: Run the layer-import gate**

Run: `npx vitest run --config vitest.config.mjs tests/unit/tooling/auditLayerImports.test.mjs`
Expected: PASS — the router must not import domain classes; it only receives them as deps.

- [ ] **Step 7: Commit**

```bash
git add backend/src/4_api/v1/routers/schoolLifecycle.mjs \
        backend/src/5_composition/modules/schoolLifecycle.mjs \
        backend/src/app.mjs
git commit -m "feat(school): expose syllabi and enrollment routes

GET/PUT/archive for syllabi and POST/DELETE for enrollments, all writes
behind TeacherGate with the baseUpdatedAt stale guard. Validation and the
gate live in composition rather than the router, matching the
SetAssignments/YamlAssignmentStore split -- the store stays dumb."
```

---

## Task 7: `schoolApi` client methods

**Files:**
- Modify: `frontend/src/modules/School/schoolApi.js`

**Interfaces:**
- Consumes: the routes from Task 6.
- Produces: `schoolApi.syllabi()`, `schoolApi.syllabus(id)`, `schoolApi.putSyllabus(id, body)`, `schoolApi.archiveSyllabus(id, body)`, `schoolApi.enroll(learnerId, body)`, `schoolApi.unenroll(learnerId, courseId, body)`. All return the standard `{ ok, status, data }`.

- [ ] **Step 1: Add the methods**

Insert next to the existing `putAssignments` entry:

```javascript
  syllabi: () => req('/lifecycle/syllabi'),
  syllabus: (id) => req(`/lifecycle/syllabi/${encodeURIComponent(id)}`),
  putSyllabus: (id, body) => req(`/lifecycle/syllabi/${encodeURIComponent(id)}`, body, 'PUT'),
  archiveSyllabus: (id, body) => req(`/lifecycle/syllabi/${encodeURIComponent(id)}/archive`, body, 'POST'),
  enroll: (learnerId, body) => req(`/lifecycle/enrollments/${encodeURIComponent(learnerId)}`, body, 'POST'),
  unenroll: (learnerId, courseId, body) => req(
    `/lifecycle/enrollments/${encodeURIComponent(learnerId)}/${encodeURIComponent(courseId)}`, body, 'DELETE',
  ),
```

- [ ] **Step 2: Run the existing schoolApi test**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/School/schoolApi.test.js`
Expected: PASS, no regressions.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/School/schoolApi.js
git commit -m "feat(school): add syllabus and enrollment client methods"
```

---

## Task 8: Make `deriveMatrix` enrollment-aware

`deriveMatrix` is already exported and unit-tested, so the model changes are pure and testable before any rendering work.

**Files:**
- Modify: `frontend/src/modules/School/teacher/panels/SchoolMatrix.jsx:23-52`
- Test: `frontend/src/modules/School/teacher/panels/SchoolMatrix.test.jsx`

**Interfaces:**
- Consumes: `schoolApi.syllabi()` (Task 7).
- Produces: `deriveMatrix({ assignments, units, kids, syllabi })` returns, in addition to today's `{courseIds, rows, unenrolled, orphanLearners}`, a `rows[].cells` map of `courseId → { enrolled, syllabusId, syllabusTitle, profile, managed }`. `managed` is `false` for an enrollment with no `syllabusId` (hand-authored). The `overrides`/`overriddenCourses` pair is removed — the global pass-override is retired in wave 3, and the matrix flag is the first piece to go.

- [ ] **Step 1: Write the failing test**

Append to `SchoolMatrix.test.jsx`:

```javascript
describe('deriveMatrix — enrollment cells', () => {
  const SYLLABI = [{ syllabusId: 'atlas-upper', title: 'Atlas — upper', courseId: 'history-capitals' }];

  it('names the syllabus and profile in the cell', () => {
    const m = deriveMatrix({
      kids: KIDS, units: UNITS, syllabi: SYLLABI,
      assignments: [{
        learnerId: 'felix',
        courses: [{ courseId: 'history-capitals', profile: 'upper', syllabusId: 'atlas-upper', enrollment: { schema: 'school.course-enrollment/v1' } }],
      }],
    });
    const cell = m.rows[0].cells['history-capitals'];
    expect(cell).toMatchObject({ enrolled: true, syllabusId: 'atlas-upper', syllabusTitle: 'Atlas — upper', profile: 'upper', managed: true });
  });

  it('marks a hand-authored enrollment as unmanaged rather than broken', () => {
    const m = deriveMatrix({
      kids: KIDS, units: UNITS, syllabi: SYLLABI,
      assignments: [{ learnerId: 'felix', courses: [{ courseId: 'history-capitals', profile: 'upper', enrollment: { schema: 'school.course-enrollment/v1' } }] }],
    });
    expect(m.rows[0].cells['history-capitals']).toMatchObject({ enrolled: true, managed: false, profile: 'upper' });
  });

  it('treats a bare-string course as enrolled with no enrollment record', () => {
    const m = deriveMatrix({
      kids: KIDS, units: UNITS, syllabi: [],
      assignments: [{ learnerId: 'milo', courses: ['math-fractions'] }],
    });
    expect(m.rows[1].cells['math-fractions']).toMatchObject({ enrolled: true, managed: false, syllabusId: null });
  });

  it('leaves an unassigned intersection absent from cells', () => {
    const m = deriveMatrix({ kids: KIDS, units: UNITS, syllabi: [], assignments: [] });
    expect(m.rows[0].cells['math-fractions']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/School/teacher/panels/SchoolMatrix.test.jsx`
Expected: FAIL — `cells` is undefined.

- [ ] **Step 3: Update `deriveMatrix`**

Replace the function body (lines 23-52) with:

```jsx
/** Pure model: rows per learner, columns per course, plus the flag sets. */
export function deriveMatrix({ assignments, units, kids, syllabi = [] }) {
  const courseIds = [...new Set((units ?? []).map((u) => u.courseId).filter(Boolean))].sort();
  const known = new Set(courseIds);
  const titleOf = new Map((syllabi ?? []).map((s) => [s.syllabusId, s.title]));
  const courseOf = (c) => (typeof c === 'string' ? c : c?.courseId);
  const byLearner = new Map((assignments ?? []).map((r) => [r.learnerId, r]));
  const rows = (kids ?? []).map((kid) => {
    const rec = byLearner.get(kid.id);
    const assigned = new Set((rec?.courses ?? []).map(courseOf).filter(Boolean));
    // One cell per assigned course. `managed` is false for an enrollment with
    // no syllabusId -- a hand-authored record, which renders first-class and
    // flagged, never as broken (felix.yml must keep working).
    const cells = {};
    (rec?.courses ?? []).forEach((entry) => {
      const id = courseOf(entry);
      if (!id) return;
      const obj = typeof entry === 'object' ? entry : {};
      cells[id] = {
        enrolled: true,
        syllabusId: obj.syllabusId ?? null,
        syllabusTitle: obj.syllabusId ? (titleOf.get(obj.syllabusId) ?? obj.syllabusId) : null,
        profile: obj.profile ?? null,
        passing: obj.passing ?? null,
        hasEnrollment: Boolean(obj.enrollment),
        managed: Boolean(obj.syllabusId),
      };
    });
    return {
      learnerId: kid.id,
      name: kid.name,
      assigned,
      cells,
      deadRefs: [...assigned].filter((id) => !known.has(id)).sort(),
    };
  });
  const kidIds = new Set((kids ?? []).map((k) => k.id));
  const orphanLearners = (assignments ?? [])
    .filter((r) => !kidIds.has(r.learnerId) && (r.courses ?? []).length)
    .map((r) => r.learnerId)
    .sort();
  const enrollment = new Map(courseIds.map((id) => [id, rows.filter((r) => r.assigned.has(id)).length]));
  const unenrolled = courseIds.filter((id) => enrollment.get(id) === 0);
  return { courseIds, rows, unenrolled, orphanLearners };
}
```

Then in the component, replace the `overrides` fetch and the header's `overriddenCourses` flag:

```jsx
  const assignments = usePanelFetch(() => schoolApi.allAssignments(), { panel: 'matrix-assignments' });
  const units = usePanelFetch(() => schoolApi.curriculumUnits(), { panel: 'matrix-units', notFoundAs: 'unavailable' });
  const syllabi = usePanelFetch(() => schoolApi.syllabi(), { panel: 'matrix-syllabi', nullAs: 'empty' });

  const model = useMemo(() => deriveMatrix({
    assignments: assignments.data?.assignments ?? [],
    units: units.data?.units ?? (Array.isArray(units.data) ? units.data : []),
    syllabi: syllabi.data?.syllabi ?? [],
    kids,
  }), [assignments.data, units.data, syllabi.data, kids]);
```

Delete the `overriddenCourses` `<span className="teacher-matrix__flag">` from the `<th>`, and drop `overrides.retry()` from the `retry` prop.

Update the existing tests in that file that pass `overrides: []` — remove that key; it is no longer read.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/School/teacher/panels/SchoolMatrix.test.jsx`
Expected: PASS — the pre-existing tests plus 4 new ones.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/School/teacher/panels/SchoolMatrix.jsx \
        frontend/src/modules/School/teacher/panels/SchoolMatrix.test.jsx
git commit -m "feat(school): make the whole-school matrix enrollment-aware

Each cell now carries its syllabus, profile and whether it is managed -- a
hand-authored enrollment with no syllabusId renders first-class and flagged,
never as broken. Drops the pass-override column flag, the first piece of the
global override's retirement."
```

---

## Task 9: The enrollment drawer

**Files:**
- Create: `frontend/src/modules/School/teacher/panels/EnrollmentDrawer.jsx`
- Modify: `frontend/src/modules/School/teacher/panels/SchoolMatrix.jsx` — clickable cells, drawer state

**Interfaces:**
- Consumes: `schoolApi.syllabi/enroll/unenroll` (Task 7), `useTeacherWrite` (`run(key, call, {onSuccess})`), `deriveMatrix` cells (Task 8).
- Produces: `<EnrollmentDrawer learner={{id, name}} courseId cell syllabi onClose onChanged />`. `onChanged()` is called after any successful write so the matrix refetches.

- [ ] **Step 1: Write the drawer**

```jsx
// frontend/src/modules/School/teacher/panels/EnrollmentDrawer.jsx
/**
 * The enrollment editor for one learner × one course. Enrolling materializes a
 * syllabus through `createCourseEnrollment`; the resulting order is a SNAPSHOT,
 * so editing the syllabus afterwards does not reach this learner —
 * re-materializing is the explicit act, and it is refused server-side while any
 * session on this course is open.
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { labelize } from '../labelize.js';
import { teacherLog } from '../teacherLog.js';

export default function EnrollmentDrawer({ learner, courseId, cell, syllabi = [], baseUpdatedAt = null, onClose, onChanged }) {
  const { run, busy, errors } = useTeacherWrite({ panel: 'enrollment' });
  const offered = syllabi.filter((s) => s.courseId === courseId);
  const [choice, setChoice] = useState(cell?.syllabusId ?? offered[0]?.syllabusId ?? '');

  const after = (event) => () => {
    teacherLog.fetch(event, { learnerId: learner.id, courseId });
    onChanged?.();
    onClose?.();
  };

  const enroll = (rematerialize) => run(rematerialize ? 'rematerialize' : 'enroll', ({ actorId, pin }) => schoolApi.enroll(learner.id, {
    syllabusId: choice, rematerialize, enrolledBy: actorId, pin, baseUpdatedAt,
  }), { onSuccess: after(rematerialize ? 'enrollment-rematerialized' : 'enrollment-created') });

  const unenroll = () => run('unenroll', ({ actorId, pin }) => schoolApi.unenroll(learner.id, courseId, {
    removedBy: actorId, pin, baseUpdatedAt,
  }), { onSuccess: after('enrollment-removed') });

  return (
    <aside className="teacher-drawer" data-testid="enrollment-drawer" role="dialog" aria-label={`${learner.name} — ${labelize(courseId)}`}>
      <header className="teacher-drawer__head">
        <h3>{learner.name} · {labelize(courseId)}</h3>
        <button type="button" onClick={onClose} aria-label="Close">✕</button>
      </header>

      {cell?.enrolled && (
        <dl className="teacher-drawer__facts">
          <dt>Syllabus</dt>
          <dd>{cell.syllabusTitle ?? <em>not managed by a syllabus</em>}</dd>
          <dt>Profile</dt>
          <dd>{cell.profile ?? <em>none</em>}</dd>
          <dt>Pass bar</dt>
          <dd>{cell.passing != null ? `${cell.passing}%` : <em>course default</em>}</dd>
        </dl>
      )}

      {!cell?.managed && cell?.enrolled && (
        <p className="teacher-drawer__note">
          This enrollment was written by hand. Enrolling from a syllabus below will replace its order.
        </p>
      )}

      {offered.length === 0 ? (
        <p className="teacher-panel__empty">No syllabus published for this course yet.</p>
      ) : (
        <label className="teacher-drawer__pick">
          Syllabus
          <select value={choice} onChange={(e) => setChoice(e.target.value)}>
            {offered.map((s) => <option key={s.syllabusId} value={s.syllabusId}>{s.title}</option>)}
          </select>
        </label>
      )}

      <div className="teacher-drawer__actions">
        {!cell?.enrolled && (
          <button type="button" disabled={!choice || busy === 'enroll'} onClick={() => enroll(false)}>Enroll</button>
        )}
        {cell?.enrolled && (
          <button type="button" disabled={!choice || busy === 'rematerialize'} onClick={() => enroll(true)}>Re-materialize</button>
        )}
        {cell?.enrolled && (
          <button type="button" disabled={busy === 'unenroll'} onClick={unenroll}>Unenroll</button>
        )}
      </div>

      {['enroll', 'rematerialize', 'unenroll'].map((key) => errors[key] && (
        <p key={key} className="teacher-panel__error">{errors[key]}</p>
      ))}
    </aside>
  );
}
```

- [ ] **Step 2: Wire clickable cells into the matrix**

In `SchoolMatrix.jsx`, add drawer state and make each `<td>` a button:

```jsx
  const [open, setOpen] = useState(null); // { learnerId, courseId }
```

Replace the `<td>` render inside the row map with:

```jsx
                {model.courseIds.map((id) => {
                  const cell = row.cells[id];
                  return (
                    <td key={id} className={cell ? 'is-assigned' : ''}>
                      <button
                        type="button"
                        className="teacher-matrix__cell"
                        onClick={() => setOpen({ learnerId: row.learnerId, courseId: id })}
                        aria-label={`${row.name}, ${labelize(id)}`}
                      >
                        {cell
                          ? `${cell.syllabusTitle ?? '—'}${cell.profile ? ` · ${cell.profile}` : ''}${cell.managed ? '' : ' ⚑'}`
                          : ''}
                      </button>
                    </td>
                  );
                })}
```

And render the drawer after the `</table>`:

```jsx
        {open && (
          <EnrollmentDrawer
            learner={kids.find((k) => k.id === open.learnerId) ?? { id: open.learnerId, name: open.learnerId }}
            courseId={open.courseId}
            cell={model.rows.find((r) => r.learnerId === open.learnerId)?.cells[open.courseId] ?? null}
            syllabi={syllabi.data?.syllabi ?? []}
            baseUpdatedAt={(assignments.data?.assignments ?? []).find((a) => a.learnerId === open.learnerId)?.updatedAt ?? null}
            onClose={() => setOpen(null)}
            onChanged={() => { assignments.retry(); }}
          />
        )}
```

Add the imports: `useState` to the existing `react` import, plus `EnrollmentDrawer` and `labelize` (already imported).

- [ ] **Step 3: Verify the panel tests still pass**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/School`
Expected: PASS. `deriveMatrix` is pure and unchanged by this step; the tests exercise the model, not the DOM.

- [ ] **Step 4: Verify in the running app**

```bash
# with the dev backend running (see Task 6 Step 5)
# open http://localhost:3113/school/teacher/planning
```
Check: a matrix cell opens the drawer; a course with no syllabus shows the empty state; Felix × atlas shows the ⚑ unmanaged marker and the hand-authored note.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/School/teacher/panels/EnrollmentDrawer.jsx \
        frontend/src/modules/School/teacher/panels/SchoolMatrix.jsx
git commit -m "feat(school): add the enrollment drawer to the whole-school matrix

A cell is now an enrollment: click to enroll from a syllabus, re-materialize,
or unenroll. Re-materialize and unenroll are refused server-side while a
session on that course is open."
```

---

## Task 10: Standalone units group

`assignments.units[]` holds work belonging to no course — live usage is one entry, a program unit with daily cadence. Programs cannot have a syllabus, so these never appear in the course × learner grid; they get their own group.

**Files:**
- Modify: `frontend/src/modules/School/teacher/tabs/PlanningTab.jsx`

**Interfaces:**
- Consumes: `schoolApi.assignments(learnerId)`, `usePanelFetch`, `PanelFrame`.
- Produces: a `StandaloneUnits` panel rendered under the matrix when a learner is selected.

- [ ] **Step 1: Add the panel inline in `PlanningTab.jsx`**

```jsx
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from '../panels/PanelFrame.jsx';
import { labelize } from '../labelize.js';

/**
 * Work belonging to no course — program units (daily language study) and
 * course-less curriculum units. These have no syllabus by construction, so
 * they are deliberately absent from the course × learner grid and listed here.
 */
function StandaloneUnits({ learnerId }) {
  const record = usePanelFetch(() => schoolApi.assignments(learnerId), {
    deps: [learnerId],
    panel: 'standalone-units',
    notFoundAs: 'empty',
    isEmpty: (d) => !(d?.units ?? []).length,
  });
  const idOf = (e) => (typeof e === 'string' ? e : e?.unitId);
  return (
    <PanelFrame
      title="Standalone work"
      state={record.state}
      retry={record.retry}
      emptyCopy="Nothing assigned outside a course."
    >
      <ul className="teacher-standalone">
        {(record.data?.units ?? []).map(idOf).filter(Boolean).map((id) => (
          <li key={id}>{labelize(id)}</li>
        ))}
      </ul>
    </PanelFrame>
  );
}
```

Render it inside the `learnerId ?` branch, after `<MilestonesPanel />`:

```jsx
          <StandaloneUnits learnerId={learnerId} />
```

- [ ] **Step 2: Run the tab test**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/School/teacher/tabs/PlanningTab.test.jsx`
Expected: PASS. If the test asserts an exact child list, extend it to include the new panel rather than removing the assertion.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/School/teacher/tabs/PlanningTab.jsx \
        frontend/src/modules/School/teacher/tabs/PlanningTab.test.jsx
git commit -m "feat(school): list standalone work outside the enrollment grid

Program and course-less units have no syllabus by construction, so they get
their own panel rather than a column in a course x learner matrix."
```

---

## Task 11: Report-card multi-enrollment guard

`GetReportCard` keys its course set on `courseId`. Two enrollments in one course inside one period would average two unrelated scopes into one meaningless number. Per-enrollment rows are deferred to wave 4 (they need terms and a real grading window, and the frozen `school.report-card/v1` schema should migrate once). Until then the merge must be *visible*.

**Files:**
- Modify: `backend/src/3_applications/school/usecases/GetReportCard.mjs`
- Test: `backend/src/3_applications/school/usecases/GetReportCard.multiEnrollment.test.mjs` (create)

**Interfaces:**
- Consumes: the assignment `history` records `GetReportCard` already loads (`this.#assignments.history(learnerId)`, line 116).
- Produces: `detectMultiEnrollment(history, period)` exported from `GetReportCard.mjs` → `[{ courseId, syllabusIds }]`. The report card gains `warnings: [{ code: 'multiple-enrollments', courseId, syllabusIds }]`, always an array (empty when clean).

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/3_applications/school/usecases/GetReportCard.multiEnrollment.test.mjs
import { describe, expect, it } from 'vitest';
import { detectMultiEnrollment } from './GetReportCard.mjs';

const PERIOD = { startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-12-31T00:00:00.000Z' };

describe('detectMultiEnrollment', () => {
  it('flags a course enrolled under two syllabi inside the period', () => {
    const history = [
      { recordedAt: '2026-09-08T00:00:00.000Z', courses: [{ courseId: 'elements', syllabusId: 'elements-p1-2' }] },
      { recordedAt: '2026-11-02T00:00:00.000Z', courses: [{ courseId: 'elements', syllabusId: 'elements-p3-4' }] },
    ];
    expect(detectMultiEnrollment(history, PERIOD)).toEqual([
      { courseId: 'elements', syllabusIds: ['elements-p1-2', 'elements-p3-4'] },
    ]);
  });

  it('does not flag the same syllabus recorded twice', () => {
    const history = [
      { recordedAt: '2026-09-08T00:00:00.000Z', courses: [{ courseId: 'elements', syllabusId: 'elements-p1-2' }] },
      { recordedAt: '2026-10-08T00:00:00.000Z', courses: [{ courseId: 'elements', syllabusId: 'elements-p1-2' }] },
    ];
    expect(detectMultiEnrollment(history, PERIOD)).toEqual([]);
  });

  it('ignores records outside the period', () => {
    const history = [
      { recordedAt: '2026-09-08T00:00:00.000Z', courses: [{ courseId: 'elements', syllabusId: 'a' }] },
      { recordedAt: '2027-02-08T00:00:00.000Z', courses: [{ courseId: 'elements', syllabusId: 'b' }] },
    ];
    expect(detectMultiEnrollment(history, PERIOD)).toEqual([]);
  });

  it('ignores bare-string and unmanaged entries', () => {
    const history = [
      { recordedAt: '2026-09-08T00:00:00.000Z', courses: ['elements', { courseId: 'atlas' }] },
    ];
    expect(detectMultiEnrollment(history, PERIOD)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs backend/src/3_applications/school/usecases/GetReportCard.multiEnrollment.test.mjs`
Expected: FAIL — `detectMultiEnrollment is not a function`.

- [ ] **Step 3: Add the detector and surface it**

Add near the top of `GetReportCard.mjs`, beside the existing `courseIdsFromAssignment` helper:

```javascript
/**
 * Two enrollments in one course inside one period average two unrelated
 * scopes into one number. Per-enrollment report-card rows are wave-4 work —
 * they need terms and a real grading window, and the frozen
 * school.report-card/v1 schema should migrate once, not twice. Until then the
 * merge is made VISIBLE rather than silent.
 */
export function detectMultiEnrollment(history, period) {
  const byCourse = new Map();
  (history ?? []).forEach((record) => {
    if (!withinPeriod(record?.recordedAt, period)) return;
    (record.courses ?? []).forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const { courseId, syllabusId } = entry;
      if (typeof courseId !== 'string' || typeof syllabusId !== 'string') return;
      if (!byCourse.has(courseId)) byCourse.set(courseId, new Set());
      byCourse.get(courseId).add(syllabusId);
    });
  });
  return [...byCourse.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([courseId, ids]) => ({ courseId, syllabusIds: [...ids].sort() }))
    .sort((a, b) => a.courseId.localeCompare(b.courseId));
}
```

In `execute`, after `courseIds` is computed, build the warnings and include them in the returned object:

```javascript
    const warnings = detectMultiEnrollment(history, period).map((hit) => ({
      code: 'multiple-enrollments', ...hit,
    }));
```

Add `warnings,` to the returned report-card object.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs backend/src/3_applications/school/usecases/GetReportCard.multiEnrollment.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Confirm no existing report-card test broke**

Run: `npx vitest run --config vitest.config.mjs backend/src/3_applications/school`
Expected: PASS — `warnings` is additive, always an array.

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/school/usecases/GetReportCard.mjs \
        backend/src/3_applications/school/usecases/GetReportCard.multiEnrollment.test.mjs
git commit -m "feat(school): flag a period holding two enrollments of one course

Report cards stay keyed on courseId until wave 4, when terms make the grading
window real and the frozen schema can migrate once. Meanwhile a course
enrolled under two syllabi inside one period is reported as a warning instead
of silently averaging two unrelated scopes."
```

---

## Final verification

- [ ] **Run the whole School test surface**

```bash
npx vitest run --config vitest.config.mjs backend/src/2_domains/school backend/src/3_applications/school frontend/src/modules/School
```
Expected: all PASS.

- [ ] **Run the layer gate**

```bash
npx vitest run --config vitest.config.mjs tests/unit/tooling/auditLayerImports.test.mjs
```
Expected: PASS.

- [ ] **Confirm `felix.yml` still round-trips**

With the dev backend running, fetch and re-save Felix's assignments through the console (Planning → pick Felix → Assignments → Edit → Save with no changes), then:

```bash
sudo docker exec daylight-station sh -c 'grep -c lessonOrder data/household/apps/school/assignments/felix.yml'
```
Expected: `1` — the enrollment survived. This is the wave-0 bug's regression check and the single most important line in this plan.

- [ ] **Update the design doc's status**

Mark waves 0 and 1 as built in `docs/reference/school/enrollment.md` §10, and move §2's "nothing creates an enrollment" into past tense.
