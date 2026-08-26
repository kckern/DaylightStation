# Cross-Subject Receipt Implementation Plan (Slice 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a learner passes a lesson, the result receipt offers the next unserved *subject* on today's agenda instead of always offering one more of the same course.

**Architecture:** A pure domain function decides which of three mutually-exclusive offers to make, given the agenda sections `CloseSessionOutcome#settle` already projects. `#settle` calls it and mints exactly one `subject_next` token from the result. No new token class, no planner change, no timing change.

**Tech Stack:** Node ESM (`.mjs`), vitest, existing `#domains/*` and `#apps/*` import aliases.

## Global Constraints

- Slice 1 must not touch `planner.mjs`, `timing.mjs`, `enrollment.mjs`, or any enrollment data shape. Those belong to Slice 2.
- Exactly ONE forward action is minted per settle. The tiers are mutually exclusive.
- Do NOT change `#projectPlan`'s flags. It passes `assignedPrograms: false, programStatuses: []` and is built with **no launchers** by design (`CloseSessionOutcome.mjs:119-126`, and composition keeps it that way in `schoolLifecycle.mjs`). Tier 1 skips program subjects instead.
- Token class stays `subject_next`. Tier 1 mints for a *different* subject with `continueToday: false`; tiers 2 and 3 mint for the current subject with `continueToday: true`.
- Backlog in this slice means the EXISTING module-level notion — `entry.timing?.mode === 'catch_up' || entry.timingState === 'catch_up'` (`agenda.mjs:355`). Slice 2 widens it; this slice must not.
- Run tests with `npx vitest run <path>`. Never bare `npx jest`.

---

### Task 1: The pure tier chooser

**Files:**
- Create: `backend/src/2_domains/school/documents/forwardAction.mjs`
- Test: `tests/unit/domains/school/forwardAction.test.mjs`

**Interfaces:**
- Consumes: nothing (pure; no imports).
- Produces: `chooseForwardAction({ sections, subject, backlog, unlocked })` returning
  `{ tier: 1|2|3, subject: string, continueToday: boolean, eyebrow: string, title: string, description: string, icon: string, unitId: string|null, taxonomy: object|null }` or `null`.

**Why a separate module:** `CloseSessionOutcome.mjs` is already ~700 lines and `#settle` is the longest method in it. The decision is pure and has six branches worth testing directly; testing it through the use case would need a full fake catalog per branch.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/domains/school/forwardAction.test.mjs
import { describe, it, expect } from 'vitest';
import { chooseForwardAction } from '#domains/school/documents/forwardAction.mjs';

const section = (subject, over = {}) => ({
  subject, servedToday: false, next: null, ...over,
});
const curriculumNext = (unitId, title) => ({ unitId, title, program: null });
const programNext = (unitId, title) => ({ unitId, title, program: 'piano' });

describe('chooseForwardAction', () => {
  it('offers the first unserved curriculum subject (tier 1)', () => {
    const out = chooseForwardAction({
      sections: [
        section('scripture', { servedToday: true }),
        section('civilization', { next: curriculumNext('atlas-p100', 'South Dakota') }),
      ],
      subject: 'scripture',
      backlog: null,
      unlocked: { unitId: 'cfm-d4', title: 'Psalm 78', taxonomy: {} },
    });
    expect(out.tier).toBe(1);
    expect(out.subject).toBe('civilization');
    expect(out.continueToday).toBe(false);
    expect(out.eyebrow).toBe('Next up');
    expect(out.title).toBe('South Dakota');
  });

  it('never offers a program subject in tier 1', () => {
    const out = chooseForwardAction({
      sections: [
        section('scripture', { servedToday: true }),
        section('arts', { next: programNext('piano-course', 'Piano') }),
      ],
      subject: 'scripture',
      backlog: null,
      unlocked: { unitId: 'cfm-d4', title: 'Psalm 78', taxonomy: {} },
    });
    expect(out.tier).toBe(3);
    expect(out.subject).toBe('scripture');
  });

  it('falls to backlog in this subject when every subject is served (tier 2)', () => {
    const out = chooseForwardAction({
      sections: [section('scripture', { servedToday: true })],
      subject: 'scripture',
      backlog: { unitId: 'cfm-d2', title: 'Psalms 62-69' },
      unlocked: { unitId: 'cfm-d4', title: 'Psalm 78', taxonomy: {} },
    });
    expect(out.tier).toBe(2);
    expect(out.subject).toBe('scripture');
    expect(out.continueToday).toBe(true);
    expect(out.eyebrow).toBe('Catch up');
    expect(out.title).toBe('Psalms 62-69');
  });

  it('fires tier 2 even when nothing is unlocked (the Friday-d5 case)', () => {
    const out = chooseForwardAction({
      sections: [section('scripture', { servedToday: true })],
      subject: 'scripture',
      backlog: { unitId: 'cfm-d2', title: 'Psalms 62-69' },
      unlocked: null,
    });
    expect(out.tier).toBe(2);
  });

  it('offers one more in this subject only when nothing else applies (tier 3)', () => {
    const out = chooseForwardAction({
      sections: [section('scripture', { servedToday: true })],
      subject: 'scripture',
      backlog: null,
      unlocked: { unitId: 'cfm-d4', title: 'Psalm 78', taxonomy: { course: 'CFM' } },
    });
    expect(out.tier).toBe(3);
    expect(out.eyebrow).toBe('One more?');
    expect(out.description).toBe('Today is already complete. Scan only if you want one more.');
    expect(out.taxonomy).toEqual({ course: 'CFM' });
  });

  it('offers nothing when the day is done and there is no backlog or next lesson', () => {
    expect(chooseForwardAction({
      sections: [section('scripture', { servedToday: true })],
      subject: 'scripture',
      backlog: null,
      unlocked: null,
    })).toBeNull();
  });

  it('ignores a section that is unserved but has no next action', () => {
    const out = chooseForwardAction({
      sections: [
        section('scripture', { servedToday: true }),
        section('civilization', { next: null }),
      ],
      subject: 'scripture',
      backlog: null,
      unlocked: { unitId: 'cfm-d4', title: 'Psalm 78', taxonomy: {} },
    });
    expect(out.tier).toBe(3);
  });

  it('does not offer the subject just passed as its own tier 1', () => {
    const out = chooseForwardAction({
      sections: [section('scripture', { servedToday: false, next: curriculumNext('cfm-d3', 'Psalms 70-77') })],
      subject: 'scripture',
      backlog: null,
      unlocked: null,
    });
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/domains/school/forwardAction.test.mjs`
Expected: FAIL — `Failed to resolve import "#domains/school/documents/forwardAction.mjs"`

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/2_domains/school/documents/forwardAction.mjs
/**
 * Which single forward action a result receipt offers after a pass.
 *
 * Pure: no clock, no I/O. It consumes the agenda sections `CloseSessionOutcome`
 * already projects and returns at most ONE offer.
 *
 * THE TIERS ARE MUTUALLY EXCLUSIVE, and that is load-bearing rather than tidy.
 * Tiers 2 and 3 mint the same token shape — `subject_next {learnerId, subject,
 * continueToday: true}` — and resolution picks a single winner out of
 * `[...inProgress, ...available]`. If both printed, the "One more?" QR would
 * resolve to the catch-up lesson and its label would be a lie.
 *
 * TIER 1 SKIPS PROGRAM SUBJECTS. `CloseSessionOutcome` builds its projection
 * with no launchers, by design and by comment, so program sections in it carry
 * no daily status. Offering one would be a guess about whether piano was
 * already done today. A program subject is therefore never offered here; the
 * limitation is deliberate and documented in the spec (§4).
 */

/** The subject just passed is not its own "next subject". */
const isOfferableSection = (section, passedSubject) => (
  section
  && section.subject !== passedSubject
  && !section.servedToday
  && !!section.next
  && !section.next.program
);

/**
 * @param {object} args
 * @param {Array}  args.sections  agenda sections, already in fixed subject order
 * @param {string} args.subject   the subject whose lesson was just passed
 * @param {{unitId: string, title: string}|null} args.backlog
 *   an unfinished backlog lesson in `subject`, or null
 * @param {{unitId: string, title: string, description?: string|null,
 *          taxonomy?: object}|null} args.unlocked
 *   the next lesson this pass opened up in `subject`, or null
 * @returns {{tier: number, subject: string, continueToday: boolean,
 *            eyebrow: string, title: string, description: string,
 *            icon: string, unitId: string|null, taxonomy: object|null}|null}
 */
export function chooseForwardAction({ sections = [], subject, backlog = null, unlocked = null } = {}) {
  const tier1 = (Array.isArray(sections) ? sections : [])
    .find((section) => isOfferableSection(section, subject));
  if (tier1) {
    return {
      tier: 1,
      subject: tier1.subject,
      continueToday: false,
      eyebrow: 'Next up',
      title: tier1.next.title ?? tier1.next.unitId,
      description: `Still to do today: ${tier1.subject}.`,
      icon: tier1.subject,
      unitId: tier1.next.unitId ?? null,
      taxonomy: tier1.next.taxonomy ?? null,
    };
  }

  if (backlog) {
    return {
      tier: 2,
      subject,
      continueToday: true,
      eyebrow: 'Catch up',
      title: backlog.title ?? backlog.unitId,
      description: 'You still owe this one. Scan to catch up.',
      icon: subject,
      unitId: backlog.unitId ?? null,
      taxonomy: backlog.taxonomy ?? null,
    };
  }

  if (unlocked) {
    return {
      tier: 3,
      subject,
      continueToday: true,
      eyebrow: 'One more?',
      title: unlocked.title ?? unlocked.unitId,
      description: 'Today is already complete. Scan only if you want one more.',
      icon: subject,
      unitId: unlocked.unitId ?? null,
      taxonomy: unlocked.taxonomy ?? null,
    };
  }

  return null;
}

export default chooseForwardAction;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/domains/school/forwardAction.test.mjs`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/school/documents/forwardAction.mjs tests/unit/domains/school/forwardAction.test.mjs
git commit -m "feat(school): pure chooser for the receipt's one forward action

Three mutually exclusive tiers: the first unserved curriculum subject, then
backlog in this subject, then one more in this subject. Exclusivity matters
because tiers 2 and 3 mint the same token shape, so a stacked tier 3 QR would
resolve to tier 2's lesson and mislabel it.

Program subjects are skipped in tier 1: CloseSessionOutcome's projection is
built with no launchers by design, so it cannot honestly say whether a program
was already done today."
```

---

### Task 2: Wire the chooser into `#settle`

**Files:**
- Modify: `backend/src/3_applications/school/usecases/CloseSessionOutcome.mjs` (the `#settle` mint gate, currently `if (passed && unlocked && state.learnerId && unit?.subject)`)
- Test: `tests/isolated/application/school/closeOutcome.test.mjs`

**Interfaces:**
- Consumes: `chooseForwardAction` from Task 1.
- Produces: no new exports. `#settle`'s `actions` array gains at most one entry, shaped exactly as today (`{token, label, presentation, eyebrow, title, description, icon, taxonomy, accessCode}`).

**Two changes, both required:**

1. **The gate.** Today it is `passed && unlocked && ...`. `unlocks` is null on a module's last lesson (pinned by `tests/isolated/domain/school/planner.test.mjs`), so tier 2 — backlog with no next lesson — could never fire. The gate becomes `passed && state.learnerId && unit?.subject`, and the chooser decides whether an action exists.

2. **`projected` must be fetched for the chooser.** Today it is `unit?.courseId ? await this.#projectPlan(...) : null`. Keep that condition — a unit with no course has no agenda position — but read `sections` and `plan` off it.

- [ ] **Step 1: Write the failing test**

Add to `tests/isolated/application/school/closeOutcome.test.mjs`. The existing `build()` helper seeds `FakeAssignmentStore([{ learnerId: 'kid1', courses: ['math-fractions'] }])`.

**Use the real fixtures — do not invent course ids.** `tests/_fixtures/school/curriculum/units/` contains exactly these, and only `math-fractions` has four units:

| Fixture | subject | shape |
| --- | --- | --- |
| `math-fractions.01…04` | `math` | course `math-fractions` |
| `how-chemistry-surrounds-you.01` | `science` | course `how-chemistry-surrounds-you` |
| `language-daily` | `language` | **program** `language`, no courseId |
| `pe-daily.act` | `skills` | **program** `pe-daily`, no courseId |

So `how-chemistry-surrounds-you` is the tier-1 subject and `language-daily` is the program that tier 1 must skip. A program unit has no `courseId`, so it is assigned under `units:`, not `courses:`.

**Use the file's existing idiom.** Passing a lesson is `await graded({ unitId, percent: 100 })` then `await close.execute({ sessionId: SID })`. The result exposes `document.blocks`, `unlocked` and `nextSubjectToken`. Do not invent a new helper — the sibling test `'offers the newly unlocked unit as an optional one-more beyond today's cap'` is the template to copy.

`MEDIA_UNIT` (`math-fractions.01`) unlocks `WORKSHEET_UNIT` (`.02`), which is why the existing tier-3 test passes `MEDIA_UNIT`.

```javascript
  it('offers the next UNSERVED subject rather than one more of the same course', async () => {
    // kid1 is assigned two COURSES in different subjects. Passing a math
    // lesson must point the receipt at science, not at the next math unit.
    build({ assignments: new FakeAssignmentStore([
      { learnerId: 'kid1', courses: ['math-fractions', 'how-chemistry-surrounds-you'] },
    ]) });
    await graded({ unitId: MEDIA_UNIT, percent: 100 });
    const result = await close.execute({ sessionId: SID });

    expect(result.document.blocks.find((b) => b.type === 'scan_action')).toMatchObject({
      eyebrow: 'Next up',
      description: expect.stringContaining('Still to do today'),
    });
    expect(await tokens.get(result.nextSubjectToken)).toMatchObject({
      tokenClass: 'subject_next',
      subject: { learnerId: 'kid1', subject: 'science', continueToday: false },
    });
  });

  it('never offers a program subject as the next subject', async () => {
    // language-daily is a PROGRAM, and this projection has no launchers, so it
    // cannot know whether language was already done today. Tier 1 must skip it
    // and fall through to one-more-in-math.
    build({ assignments: new FakeAssignmentStore([
      { learnerId: 'kid1', courses: ['math-fractions'], units: ['language-daily'] },
    ]) });
    await graded({ unitId: MEDIA_UNIT, percent: 100 });
    const result = await close.execute({ sessionId: SID });

    expect(result.document.blocks.find((b) => b.type === 'scan_action'))
      .toMatchObject({ eyebrow: 'One more?' });
    expect(await tokens.get(result.nextSubjectToken))
      .toMatchObject({ subject: { subject: 'math', continueToday: true } });
  });

  it('mints exactly one forward action, never a stack of tiers', async () => {
    build({ assignments: new FakeAssignmentStore([
      { learnerId: 'kid1', courses: ['math-fractions', 'how-chemistry-surrounds-you'] },
    ]) });
    await graded({ unitId: MEDIA_UNIT, percent: 100 });
    const result = await close.execute({ sessionId: SID });

    const scanActions = result.document.blocks.filter((b) => b.type === 'scan_action');
    expect(scanActions).toHaveLength(1);
  });
```

`build()` must accept an `assignments` override. Add it to the existing destructured options and use it in place of the hardcoded store:

```javascript
const build = ({
  economyEnabled = true, throwOn = null, receiptPrinter = undefined, wireReviewQueue = true,
  passOverrides = null, teacherGate = null, eventBus = null,
  receiptCapture = null, receiptArtifactPrinter = null,
  assignments = null,                                    // NEW
} = {}) => {
  // …
  const assignmentStore = assignments
    ?? new FakeAssignmentStore([{ learnerId: 'kid1', courses: ['math-fractions'] }]);
  // …then pass `assignments: assignmentStore` into `new CloseSessionOutcome({…})`
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/school/closeOutcome.test.mjs -t "next UNSERVED subject"`
Expected: FAIL — `expected 'One more?' to be 'Next up'`

- [ ] **Step 3: Write minimal implementation**

In `#settle`, replace the `let nextSubjectToken = null; if (passed && unlocked && …) { … }` block with:

```javascript
    let nextSubjectToken = null;
    // The gate is NOT `unlocked && …` any more. `unlocks` is null on a module's
    // last lesson, so a d5-passed-Friday learner with d2 unfinished would never
    // be offered the catch-up — the one moment it matters most. The chooser
    // decides whether an action exists; this only decides whether we may ask.
    const offer = (passed && state.learnerId && unit?.subject)
      ? chooseForwardAction({
        sections: projected?.sections ?? [],
        subject: unit.subject,
        backlog: this.#backlogIn({ projected, subject: unit.subject }),
        unlocked,
      })
      : null;
    if (offer) {
      const accessCode = await this.#mintNextSubjectAccessCode({ sessionId, nowIso });
      const record = mintToken({
        tokenClass: 'subject_next',
        subject: {
          learnerId: state.learnerId,
          subject: offer.subject,
          continueToday: offer.continueToday,
        },
        at: nowIso,
        rng: this.#rng,
        ...(accessCode ? { accessCode, accessCodeExpiresAt: this.#accessCodeExpiryFor(nowIso) } : {}),
      });
      await this.#tokens.put(record);
      nextSubjectToken = record.token;
      actions.push({
        token: record.token,
        label: offer.title,
        presentation: 'lesson',
        eyebrow: offer.eyebrow,
        title: offer.title,
        description: offer.description,
        icon: offer.icon,
        ...(offer.taxonomy ? { taxonomy: offer.taxonomy } : {}),
        accessCode: record.accessCode ?? null,
      });
    }
```

Add the private helper beside `#nextUnlocked`:

```javascript
  /**
   * An unfinished BACKLOG lesson in this subject, or null.
   *
   * Slice 1 uses the module-level notion of backlog that already exists — a
   * lesson belonging to a closed dated module (`agenda.mjs`'s `isBacklog`).
   * Read off `plan.available` rather than `section.next`, because the section
   * for the subject just passed is `servedToday` and its `next` is therefore
   * null by the time this runs.
   */
  #backlogIn({ projected, subject }) {
    const entries = projected?.plan?.available ?? [];
    const found = entries.find((entry) => entry.subject === subject
      && (entry.timing?.mode === 'catch_up' || entry.timingState === 'catch_up'));
    return found ? { unitId: found.unitId, title: found.title } : null;
  }
```

Add the import at the top of the file, beside the other `#domains` imports:

```javascript
import { chooseForwardAction } from '#domains/school/documents/forwardAction.mjs';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/school/closeOutcome.test.mjs`
Expected: PASS. The pre-existing assertion at line 282 (`description: 'Today is already complete…'`) still passes — that test uses a single-course learner, so it lands on tier 3.

- [ ] **Step 5: Run the surrounding suites for regressions**

Run: `npx vitest run tests/isolated/application/school tests/unit/domains/school`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/school/usecases/CloseSessionOutcome.mjs tests/isolated/application/school/closeOutcome.test.mjs
git commit -m "feat(school): the result receipt offers the day's next subject

On a pass it minted one forward action, always for the subject just finished,
captioned 'Today is already complete' while other subjects sat untouched. It
now asks the agenda sections it was already projecting.

The mint gate no longer requires \`unlocked\`: unlocks is null on a module's
last lesson, so backlog-with-no-next-lesson — d5 passed on Friday with d2
unfinished — could never have been offered."
```

---

### Task 3: Fix the pinned copy in the e2e test

**Files:**
- Modify: `tests/isolated/e2e/school/lifecycle.e2e.test.mjs:105`

**Interfaces:**
- Consumes: the behaviour from Task 2.
- Produces: nothing.

**Why this is its own task:** the e2e test drives the whole lifecycle, so whether it lands on tier 1 or tier 3 depends on the fixture learner's assignments — which the earlier tasks do not control. It must be read and re-asserted, not blindly edited.

- [ ] **Step 1: Run the e2e test and read the actual failure**

Run: `npx vitest run tests/isolated/e2e/school/lifecycle.e2e.test.mjs`
Expected: either PASS (the fixture learner has one course → tier 3 → copy unchanged) or FAIL showing which eyebrow it now produces.

- [ ] **Step 2: If it passed, do nothing and skip to Step 4**

No edit is needed. Record in the commit message that the e2e fixture is single-course and therefore still tier 3.

- [ ] **Step 3: If it failed, assert the tier the fixture actually reaches**

Replace line 105. If the receipt now shows `Next up`:

```javascript
    expect(receipt).toContain('Still to do today');
```

If it shows `Catch up`:

```javascript
    expect(receipt).toContain('You still owe this one. Scan to catch up.');
```

Do **not** weaken the assertion to a substring that would pass for any tier — the point of this line is that the receipt says something specific and true.

- [ ] **Step 4: Run the full gate**

Run: `npm run test:unit:vitest`
Expected: `0 NEW failing file(s)`. Read the tail of the output — the wrapper's exit code is not the gate's; the gate prints its own verdict.

- [ ] **Step 5: Commit**

```bash
git add tests/isolated/e2e/school/lifecycle.e2e.test.mjs
git commit -m "test(school): re-pin the receipt copy the e2e lifecycle actually produces"
```

---

## Self-Review

**Spec coverage (§2–§6 of the spec):**

| Spec | Task |
| --- | --- |
| §3 three tiers, fixed shelf order | Task 1 |
| §3 mutual exclusivity | Task 1 (test) + Task 2 (test) |
| §3 token shapes / `continueToday` | Task 2 |
| §4 program subjects skipped, flags unchanged | Task 1 (`isOfferableSection`), Global Constraints |
| §5 mint gate restructured so tier 2 can fire with `unlocks === null` | Task 2 |
| §6 copy; no action when the day is done | Task 1 (returns null), Task 3 |

No spec requirement in Slice 1 is unassigned.

**Placeholders:** none — every code step is literal.

**Type consistency:** `chooseForwardAction` returns `{tier, subject, continueToday, eyebrow, title, description, icon, unitId, taxonomy}` in Task 1 and Task 2 reads exactly those names. `#backlogIn` returns `{unitId, title}`, which matches the `backlog` parameter Task 1 documents.

**Known gap, deliberately left:** in Slice 1 `#backlogIn` can only find closed-module backlog, so on a household with no dated courses tier 2 never fires. That is correct — overdue-lesson backlog does not exist until Slice 2 gives lessons due dates. Task 1's tier-2 tests cover the chooser directly, which is why they do not depend on a dated fixture.

**Verified against source while writing this plan** (so the implementer does not have to rediscover it):

- `close.execute` returns `{ document, unlocked, nextSubjectToken, … }` — `CloseSessionOutcome.mjs:448-449`.
- `graded({ unitId, percent })` already exists in the test file at line 58; no new helper is needed.
- The fixture catalogue has exactly one multi-unit course. An earlier draft of this plan used a fictitious `atlas-us`, which would have failed as a planner error (`assigned but no published units belong to it`) rather than as the assertion under test. The table in Task 2 is the real inventory.
- `FakeAssignmentStore` seeds records keyed by `learnerId`, so an assignment record may carry both `courses` and `units` — which is how the program-skip test assigns `language-daily`.
