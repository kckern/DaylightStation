# Piano Course Sequence (pre-enrollment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `piano-course` enrollment can name the courses that follow it, and the moment the current course is finished the next one becomes the course the day is judged against, with no adult involved. The switch is backdated, starts the next study day, and comes from an explicit list.

**Architecture:** The plan file gains an ordered `then:` list on the piano program. The ACTIVE course is never stored. `PianoCourseProgramLauncher` derives it on every `status()` / `issueLaunchTarget()` call from completion evidence. It walks the chain `[courseId, ...then]` and skips every course whose credited lessons were all completed on a study day **before** the one being judged. Because the answer is a pure function of evidence and the day asked about, backdating and "starts the next day" fall out of the same rule, and past-day replay (the term grid) re-scores itself. Every existing caller (agenda status collection, kiosk lesson gate, ceremony bridge, reconcile) already calls `launcher.status({ userId, programInstance: <enrolled courseId> })`, so they inherit the active course. Only the ceremony bridge needs a one-line change so its announcements name the course actually played.

**Tech Stack:** Node ESM backend (`.mjs`), vitest, YAML plan files under the data volume.

**Spec:** This document, section *Spec* below (from the 2026-09-30 session; there is no separate spec file).

## Spec

**Evidence (2026-09-30 log store + data volume):**
- `data/household/school/plans/learners/${LEARNER}.yml` holds one `piano-course` program: `courseId: plex:695598` ("Reading Music", a season of the Plex show "My Music Workshop"). Siblings in that show: `plex:694771` "Piano", `plex:694718` "Singing".
- The learner finished Reading Music on the evening of 2026-09-28: `school.piano-ceremony.satisfied` for "Reading Music - Eighth Notes (Piano/Forte)" at 23:58Z (16:58 PDT), and the agenda preview now reads 53/53.
- From 2026-09-29 he moved on by himself to the Piano season: `plex:694788` "Lesson 15" was stamped complete at 2026-09-29T14:43Z (engaged, 90%), and `plex:694789` "Lesson 16" was at 75% (engaged) on 09-30. None of it counts: the term grid reads `2026-09-29 none 0/2` and `2026-09-30 none 0/2`.
- `PianoCourseProgramLauncher.status()` for a fully watched course returns `doneToday: false` with `"53/53 — course complete"`, and `issueLaunchTarget` throws `piano-course has no unfinished lesson`. A finished course is therefore a debt nothing can pay. The kiosk gate already copes (`gated: false, reason: course-complete`); School's verdict does not.
- `YamlUserVideoProgressStore` stamps `completedAt` ONCE (re-watches never move it). That makes "finished before day D" a sound question to ask of the evidence.

**Requirements (decided by the user):**
1. **Explicit list.** Follow-on courses are named in the plan: `then: [plex:694771, …]`. Never inferred from the show's season order.
2. **Next-day start.** The course that finishes on study day D stays the course for day D (its finishing lesson credits the day). The successor is owed from D+1.
3. **Backdate.** A day after the finish is judged against the successor even if that day is already past. 09-29 must re-score as served by Lesson 15.
4. Auto-advance continues through the whole list. After the last course is finished, the existing "course complete" behaviour is unchanged.
5. Every advance is visible in the log store by name.

## Global Constraints

- Study day boundary: `BOUNDARY_HOUR = 4` in the household timezone, via `#domains/school/studyDay.mjs` (`studyDayForInstant`). Never compare raw calendar dates.
- A course id is `plex:<digits>` (`/^plex:\d+$/`), the same rule `validatePianoCourseEnrollment` already enforces.
- Nothing about the active course is persisted. The plan file stores only the explicit `then` list.
- The enrollment's `unitId` (`piano-course:<courseId>`) and `programInstance` (`<courseId>`) stay the HEAD course, so agenda rows, day bypasses and work sessions keep a stable identity across an advance.
- Backend logging goes through the injected `logger` (`this.#logger`); never `console`.
- Data-volume writes go through `sudo docker exec daylight-station sh -c "cat > … << 'EOF' … EOF"` with the COMPLETE file. Never `sed -i`, never `rm` (move to `data/_deleteme/` instead).
- Match the surrounding comment style: the WHY, with the incident that bought it.

## Review Focus

1. **A finished course with no `then`.** Must behave exactly as today ("course complete", `nextLesson: null`), not error. Pinned in Task 2.
2. **A successor the child already partly did.** The learner did Piano lessons 1–14 before this enrollment existed, so the successor must resume at its first UNWATCHED lesson, not lesson 1. Pinned in Task 2.
3. **The plan file cannot be read for the sequence** (corrupt YAML mid-edit, store throws). Must fall back to the head course with a warn, never `error: true` and never "done". Pinned in Task 2.
4. **A bad `then` list** (duplicates, the head course repeated, a non-plex id, a non-array). Rejected by the validator with a named error, so it never reaches the launcher. Pinned in Task 1.
5. **The ceremony after an advance.** A successor lesson must chime and record evidence under the SUCCESSOR's course id. A re-watch of an already-finished head lesson must not re-satisfy anything. Pinned in Task 3.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `backend/src/3_applications/school/SchoolProgramEnrollmentValidators.mjs` | Modify `validatePianoCourseEnrollment` | Accept and normalise `then` |
| `backend/src/3_applications/school/SchoolProgramEnrollmentValidators.test.mjs` | Add tests | Pin the validator |
| `backend/src/3_applications/school/PianoCourseProgramLauncher.mjs` | Add `courseSequence` dep, `#resolveCourse`, use it in `status` + `issueLaunchTarget`, expose `activeCourseId` / `sequence` | Derive the active course |
| `tests/isolated/application/school/pianoCourseProgramLauncher.test.mjs` | Add a `describe` block | Pin derivation, backdating, next-day start |
| `backend/src/5_composition/modules/schoolLifecycle.mjs:633` | Pass `courseSequence` | Read `then` from the assignment store |
| `backend/src/3_applications/school/PianoLessonCeremonyBridge.mjs` | Use `status.activeCourseId` | Announce the course actually played |
| `tests/isolated/application/school/pianoLessonCeremonyBridge.test.mjs` | Add tests | Pin the bridge |
| `docs/reference/school/programs.md` | Add "Course sequences" subsection | Reference doc |
| `data/household/school/plans/learners/${LEARNER}.yml` (data volume) | Add `then: [plex:694771]` | Turn it on for the learner |

---

### Task 1: The enrollment validator accepts an explicit `then` list

**Files:**
- Modify: `backend/src/3_applications/school/SchoolProgramEnrollmentValidators.mjs:73-86` (`validatePianoCourseEnrollment`)
- Test: `backend/src/3_applications/school/SchoolProgramEnrollmentValidators.test.mjs`

**Interfaces:**
- Produces: a validated piano enrollment may carry `then: string[]` (plex ids, order kept, never containing `courseId`, no duplicates). Absent or empty means the field is omitted entirely.

- [ ] **Step 1: Read the existing test file's setup** so the new cases use its factory call

Run: `sed -n 1,60p backend/src/3_applications/school/SchoolProgramEnrollmentValidators.test.mjs`
Note how it builds validators (it calls `createSchoolProgramEnrollmentValidators({ pianoCourseLauncher: {...} })` or similar) and reuse that exact call below as `pianoValidator()`.

- [ ] **Step 2: Write the failing tests** (append to the test file; adapt only the `pianoValidator` factory line to match Step 1)

```javascript
describe('piano-course — a course sequence (then:)', () => {
  const pianoValidator = () => createSchoolProgramEnrollmentValidators({ pianoCourseLauncher: {} }).get('piano-course');

  it('keeps an explicit list of follow-on courses, in order', async () => {
    const result = await pianoValidator()({
      programId: 'piano-course', courseId: 'plex:695598', then: ['plex:694771', 'plex:694718'],
    });
    expect(result.errors).toEqual([]);
    expect(result.enrollment.then).toEqual(['plex:694771', 'plex:694718']);
  });

  it('omits the field entirely when there is no sequence', async () => {
    const result = await pianoValidator()({ programId: 'piano-course', courseId: 'plex:695598', then: [] });
    expect(result.errors).toEqual([]);
    expect('then' in result.enrollment).toBe(false);
  });

  it.each([
    [['plex:694771', 'plex:694771'], 'piano-course then must not repeat a course'],
    [['plex:695598'], 'piano-course then must not include the enrolled course itself'],
    [['694771'], 'piano-course then entries must be of the form plex:<ratingKey>'],
    ['plex:694771', 'piano-course then must be a list of course ids'],
  ])('refuses a bad sequence %j', async (then, message) => {
    const result = await pianoValidator()({ programId: 'piano-course', courseId: 'plex:695598', then });
    expect(result.errors).toEqual([message]);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run backend/src/3_applications/school/SchoolProgramEnrollmentValidators.test.mjs`
Expected: the four new cases FAIL (`then` is dropped today, and no error is raised).

- [ ] **Step 4: Implement.** Replace `validatePianoCourseEnrollment` with:

```javascript
/**
 * `then` — THE COURSES THAT FOLLOW THIS ONE, named explicitly.
 *
 * A piano enrollment used to be one course and nothing after it, so the day a
 * child finished it the obligation became a debt nothing could pay: on
 * 2026-09-28 a learner finished Reading Music (53/53), moved on to the next
 * season by himself, and none of that work counted. The launcher walks
 * `[courseId, ...then]` and judges each day against the first course not
 * already finished before it (see `PianoCourseProgramLauncher#resolveCourse`).
 *
 * EXPLICIT, never inferred from season order: the learner skipped a season,
 * and a guessed successor would have assigned the wrong one.
 */
function validateCourseSequence(then, courseId) {
  if (then === undefined || then === null) return { errors: [], then: [] };
  if (!Array.isArray(then)) return { errors: ['piano-course then must be a list of course ids'] };
  if (then.some((id) => typeof id !== 'string' || !/^plex:\d+$/.test(id))) {
    return { errors: ['piano-course then entries must be of the form plex:<ratingKey>'] };
  }
  if (then.includes(courseId)) return { errors: ['piano-course then must not include the enrolled course itself'] };
  if (new Set(then).size !== then.length) return { errors: ['piano-course then must not repeat a course'] };
  return { errors: [], then: [...then] };
}

function validatePianoCourseEnrollment(raw) {
  const courseId = raw?.courseId ?? raw?.corpusId;
  if (typeof courseId !== 'string' || !/^plex:\d+$/.test(courseId)) {
    return { errors: ['piano-course requires a courseId of the form plex:<ratingKey>'] };
  }
  const subject = raw?.subject ?? 'arts';
  if (typeof subject !== 'string' || !subject) return { errors: ['piano-course subject must be a string'] };
  const sequence = validateCourseSequence(raw?.then, courseId);
  if (sequence.errors.length) return { errors: sequence.errors };
  const videosLockedAfter = raw?.videosLockedAfter;
  return { errors: [], enrollment: {
    programId: 'piano-course', corpusId: courseId, courseId, subject,
    ...(raw?.title ? { title: String(raw.title) } : {}),
    ...(Number.isInteger(videosLockedAfter) && videosLockedAfter > 0 ? { videosLockedAfter } : {}),
    ...(sequence.then.length ? { then: sequence.then } : {}),
  } };
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run backend/src/3_applications/school/SchoolProgramEnrollmentValidators.test.mjs backend/src/3_applications/school/usecases/SetAssignments.readingPrograms.test.mjs`
Expected: PASS, all tests (the existing SetAssignments suite proves nothing else moved).

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(school): piano-course enrollments may name the courses that follow (then:)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- backend/src/3_applications/school/SchoolProgramEnrollmentValidators.mjs backend/src/3_applications/school/SchoolProgramEnrollmentValidators.test.mjs
```

---

### Task 2: The launcher derives the active course from the sequence

**Files:**
- Modify: `backend/src/3_applications/school/PianoCourseProgramLauncher.mjs` (constructor ~line 158; `status` lines 197-220; `issueLaunchTarget` lines 368-375; new private `#resolveCourse`)
- Test: `tests/isolated/application/school/pianoCourseProgramLauncher.test.mjs`

**Interfaces:**
- Consumes: Task 1's `then` field (read by composition in Task 3, not here).
- Produces:
  - constructor option `courseSequence: (args: {learnerId: string, courseId: string}) => Promise<string[]>|string[]`, defaulting to `null` (no sequence).
  - every `status()` answer that reads a course carries `activeCourseId: string` and `sequence: {position: number, total: number, courseIds: string[]}` (1-based position). The early `No piano course assigned` and `{ error: true }` answers do not.
  - `issueLaunchTarget` resolves against the active course for the current study day.
  - log line `school.piano-course.sequence-active` (info), once per learner+course per process, `{ userId, enrolledCourseId, activeCourseId, position, total }`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/isolated/application/school/pianoCourseProgramLauncher.test.mjs` (it already defines `TZ`, `lesson()`):

```javascript
/**
 * A COURSE SEQUENCE. The active course is DERIVED from evidence on every call:
 * the first course in `[courseId, ...then]` not finished on a study day BEFORE
 * the one being judged. Timestamps mirror the 2026-09-28 field case: head
 * finished 16:58 PDT on the 28th, successor Lesson 15 at 07:43 PDT on the 29th.
 */
describe('PianoCourseProgramLauncher — a course sequence', () => {
  const HEAD = 'plex:695598';
  const NEXT = 'plex:694771';
  const LAST = 'plex:694718';
  const HEAD_DONE = '2026-09-28T23:58:00Z';   // 16:58 PDT, study day 09-28
  const NEXT_L15 = '2026-09-29T14:43:00Z';     // 07:43 PDT, study day 09-29

  const finishedHead = { compoundId: HEAD, items: [
    lesson('plex:1', { completedAt: '2026-09-20T18:00:00Z', title: 'Quarter Notes' }),
    lesson('plex:2', { completedAt: HEAD_DONE, title: 'Eighth Notes' }),
  ] };
  const successor = ({ l15 = NEXT_L15 } = {}) => ({ compoundId: NEXT, items: [
    lesson('plex:14', { completedAt: '2026-08-01T18:00:00Z', title: 'Lesson 14' }),
    lesson('plex:15', { completedAt: l15, title: 'Lesson 15' }),
    lesson('plex:16', { title: 'Lesson 16' }),
  ] });

  const sequenced = ({ byCourse, now, then = [NEXT], courseSequence } = {}) => {
    const asked = [];
    const logs = [];
    const launcher = new PianoCourseProgramLauncher({
      getPlayableUnits: { execute: async ({ courseId }) => {
        asked.push(courseId);
        const result = byCourse[courseId];
        return result ? { ok: true, result } : { ok: false, reason: 'not-found' };
      } },
      courseSequence: courseSequence ?? (async ({ courseId }) => (courseId === HEAD ? then : [])),
      timezone: TZ,
      clock: () => new Date(now),
      logger: { warn: (event, data) => logs.push({ event, data }), info: (event, data) => logs.push({ event, data }) },
    });
    return { launcher, asked, logs };
  };

  it('judges the day after the finish against the successor — backdated, on replay', async () => {
    const { launcher } = sequenced({ byCourse: { [HEAD]: finishedHead, [NEXT]: successor() }, now: '2026-09-30T18:00:00Z' });
    const status = await launcher.status({ userId: 'user_4', programInstance: HEAD, day: '2026-09-29' });
    expect(status.activeCourseId).toBe(NEXT);
    expect(status.doneToday).toBe(true);
    expect(status.servedWork).toEqual([{ unitId: 'plex:15', title: 'Lesson 15' }]);
    expect(status.sequence).toEqual({ position: 2, total: 2, courseIds: [HEAD, NEXT] });
  });

  it('keeps the finishing course for the finishing day — the successor starts the NEXT study day', async () => {
    const { launcher } = sequenced({ byCourse: { [HEAD]: finishedHead, [NEXT]: successor() }, now: '2026-09-30T18:00:00Z' });
    const status = await launcher.status({ userId: 'user_4', programInstance: HEAD, day: '2026-09-28' });
    expect(status.activeCourseId).toBe(HEAD);
    expect(status.doneToday).toBe(true);
  });

  it('owes the successor\'s first UNWATCHED lesson today, not its first lesson', async () => {
    const { launcher } = sequenced({ byCourse: { [HEAD]: finishedHead, [NEXT]: successor() }, now: '2026-09-30T18:00:00Z' });
    const status = await launcher.status({ userId: 'user_4', programInstance: HEAD });
    expect(status.activeCourseId).toBe(NEXT);
    expect(status.doneToday).toBe(false);
    expect(status.nextLesson.lesson.title).toBe('Lesson 16');
    expect(status.progressLabel).toBe('2/3 · next: Lesson 16');
  });

  it('stays on the head while it is unfinished, whatever the successor holds', async () => {
    const unfinished = { compoundId: HEAD, items: [...finishedHead.items, lesson('plex:3', { title: 'Accent' })] };
    const { launcher, asked } = sequenced({ byCourse: { [HEAD]: unfinished, [NEXT]: successor() }, now: '2026-09-29T18:00:00Z' });
    const status = await launcher.status({ userId: 'user_4', programInstance: HEAD });
    expect(status.activeCourseId).toBe(HEAD);
    expect(status.nextLesson.lesson.title).toBe('Accent');
    expect(asked).toEqual([HEAD]); // the successor is never read while the head is live
  });

  it('walks the whole chain and reports "course complete" only after the LAST course', async () => {
    const finishedNext = { compoundId: NEXT, items: [lesson('plex:15', { completedAt: '2026-09-29T14:43:00Z' })] };
    const finishedLast = { compoundId: LAST, items: [lesson('plex:40', { completedAt: '2026-09-30T15:00:00Z' })] };
    const { launcher } = sequenced({
      byCourse: { [HEAD]: finishedHead, [NEXT]: finishedNext, [LAST]: finishedLast },
      then: [NEXT, LAST], now: '2026-10-02T18:00:00Z',
    });
    const status = await launcher.status({ userId: 'user_4', programInstance: HEAD });
    expect(status.activeCourseId).toBe(LAST);
    expect(status.doneToday).toBe(false);
    expect(status.nextLesson).toBeNull();
    expect(status.progressLabel).toBe('1/1 — course complete');
  });

  it('with no sequence, a finished course behaves exactly as before', async () => {
    const { launcher } = sequenced({ byCourse: { [HEAD]: finishedHead }, then: [], now: '2026-09-30T18:00:00Z' });
    const status = await launcher.status({ userId: 'user_4', programInstance: HEAD });
    expect(status.activeCourseId).toBe(HEAD);
    expect(status.progressLabel).toBe('2/2 — course complete');
    expect(status.nextLesson).toBeNull();
  });

  it('counts a lesson watched with no timestamp as finished long ago', async () => {
    const legacyHead = { compoundId: HEAD, items: [lesson('plex:1', { watched: true })] };
    const { launcher } = sequenced({ byCourse: { [HEAD]: legacyHead, [NEXT]: successor() }, now: '2026-09-30T18:00:00Z' });
    expect((await launcher.status({ userId: 'user_4', programInstance: HEAD })).activeCourseId).toBe(NEXT);
  });

  it('falls back to the head, with a warning, when the sequence cannot be read', async () => {
    const { launcher, logs } = sequenced({
      byCourse: { [HEAD]: finishedHead, [NEXT]: successor() }, now: '2026-09-30T18:00:00Z',
      courseSequence: async () => { throw new Error('plan mid-edit'); },
    });
    const status = await launcher.status({ userId: 'user_4', programInstance: HEAD });
    expect(status.error).toBeUndefined();
    expect(status.activeCourseId).toBe(HEAD);
    expect(logs.some((l) => l.event === 'school.piano-course.sequence-read-failed')).toBe(true);
  });

  it('reports error (never the head in disguise) when the successor cannot be read', async () => {
    const { launcher } = sequenced({ byCourse: { [HEAD]: finishedHead }, now: '2026-09-30T18:00:00Z' });
    expect(await launcher.status({ userId: 'user_4', programInstance: HEAD })).toEqual({ error: true });
  });

  it('names the advance in the log once, not on every read', async () => {
    const { launcher, logs } = sequenced({ byCourse: { [HEAD]: finishedHead, [NEXT]: successor() }, now: '2026-09-30T18:00:00Z' });
    await launcher.status({ userId: 'user_4', programInstance: HEAD });
    await launcher.status({ userId: 'user_4', programInstance: HEAD });
    const advances = logs.filter((l) => l.event === 'school.piano-course.sequence-active');
    expect(advances).toHaveLength(1);
    expect(advances[0].data).toEqual({ userId: 'user_4', enrolledCourseId: HEAD, activeCourseId: NEXT, position: 2, total: 2 });
  });

  it('launches the successor\'s next lesson', async () => {
    const withParents = { ...successor(), items: successor().items.map((item, i) => ({ ...item, parentId: 'season', parentIndex: 1, itemIndex: i + 14 })) };
    const { launcher } = sequenced({ byCourse: { [HEAD]: finishedHead, [NEXT]: withParents }, now: '2026-09-30T18:00:00Z' });
    const target = await launcher.issueLaunchTarget({ userId: 'user_4', programInstance: HEAD });
    expect(target).toMatchObject({ kind: 'course-lesson', courseId: NEXT, lessonId: 'plex:16', lessonTitle: 'Lesson 16' });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/isolated/application/school/pianoCourseProgramLauncher.test.mjs`
Expected: the new block FAILS (`activeCourseId` undefined; `courseSequence` ignored). Existing tests PASS.

- [ ] **Step 3: Implement — constructor.** Add the field and option:

```javascript
  #getPlayableUnits; #donow; #dayBypasses; #challengeCompletion; #courseSequence; #timezone; #clock; #logger;
  /** learner\0course pairs already announced as active, so the log names an advance once. */
  #announcedActive = new Set();
```

In the constructor signature add `courseSequence = null,` after `challengeCompletion = null,`, and in the body `this.#courseSequence = courseSequence;`. Add to the JSDoc:

```javascript
   * @param {(a: {learnerId: string, courseId: string}) => Promise<string[]>|string[]} [config.courseSequence]
   *   - the enrollment's explicit follow-on courses (`then:`). Optional: absent,
   *   an enrollment is one course, exactly as before.
```

- [ ] **Step 4: Implement — `#resolveCourse`.** Add below `issueLaunchTarget`:

```javascript
  /**
   * WHICH COURSE IS TODAY'S — derived, never stored.
   *
   * Walk `[courseId, ...then]` and stop at the first course NOT finished on a
   * study day before the one being judged. "Finished" means every crediting
   * lesson watched, and every completion stamped before `studyDay` (a lesson
   * watched with no stamp predates the stamps and counts as long finished).
   * `completedAt` is written once and never moved by a re-watch
   * (`YamlUserVideoProgressStore`), so this is a question the evidence can
   * answer for ANY day — which is what makes the switch backdated for free.
   *
   * THE FINISHING DAY KEEPS ITS COURSE. A course finished on day D is not
   * finished "before" D, so D is still judged against it and its last lesson
   * credits the day; the successor is owed from D+1. On 2026-09-28 a learner
   * finished Reading Music at 16:58; 09-29 is Piano's first day.
   *
   * A SUCCESSOR THAT CANNOT BE READ IS AN ERROR, never the head in disguise:
   * silently judging a finished course would report "course complete" and owe
   * the child nothing on a transient Plex fault.
   *
   * @returns {Promise<{courseId: string, answer: object, position: number, chain: string[]}>}
   */
  async #resolveCourse({ userId, programInstance, nowMs }) {
    const chain = [programInstance, ...(await this.#followOn({ userId, courseId: programInstance }))];
    const today = studyDayForInstant(nowMs, { timezone: this.#timezone, boundaryHour: BOUNDARY_HOUR });
    for (let index = 0; index < chain.length; index += 1) {
      const courseId = chain[index];
      // eslint-disable-next-line no-await-in-loop
      const answer = await this.#getPlayableUnits.execute({ courseId, userId });
      const last = index === chain.length - 1;
      if (!answer?.ok) return { courseId, answer, position: index + 1, chain };
      if (last || !this.#finishedBefore(orderedCreditItems(answer.result), today)) {
        if (index > 0) this.#announceActive({ userId, enrolledCourseId: programInstance, courseId, index, chain });
        return { courseId, answer, position: index + 1, chain };
      }
    }
    return null; // unreachable: the last course always returns above
  }

  /** Every crediting lesson watched, each stamped on a study day before `today`. */
  #finishedBefore(credit, today) {
    if (!credit.length) return false;
    return credit.every((item) => {
      if (!item.userWatched) return false;
      if (!item.userCompletedAt) return true;
      const at = Date.parse(item.userCompletedAt);
      if (!Number.isFinite(at)) return true;
      return studyDayForInstant(at, { timezone: this.#timezone, boundaryHour: BOUNDARY_HOUR }) < today;
    });
  }

  /** The enrollment's `then:` list. A read failure is the head alone, said out loud. */
  async #followOn({ userId, courseId }) {
    if (typeof this.#courseSequence !== 'function') return [];
    try {
      const then = await this.#courseSequence({ learnerId: userId, courseId });
      return Array.isArray(then) ? then.filter((id) => typeof id === 'string' && id && id !== courseId) : [];
    } catch (err) {
      this.#logger.warn?.('school.piano-course.sequence-read-failed', {
        userId, courseId, error: err?.message ?? String(err),
      });
      return [];
    }
  }

  #announceActive({ userId, enrolledCourseId, courseId, index, chain }) {
    const key = `${userId}\0${courseId}`;
    if (this.#announcedActive.has(key)) return;
    this.#announcedActive.add(key);
    this.#logger.info?.('school.piano-course.sequence-active', {
      userId, enrolledCourseId, activeCourseId: courseId, position: index + 1, total: chain.length,
    });
  }
```

- [ ] **Step 5: Implement — `status`.** Replace lines 202-222 (from `let result;` through `const nowMs = this.#nowMs(day);`) with:

```javascript
    const nowMs = this.#nowMs(day);
    let result;
    let resolved;
    try {
      resolved = await this.#resolveCourse({ userId, programInstance, nowMs });
      const answer = resolved.answer;
      // A rejected user is a wiring/roster problem, not "no lesson today" —
      // surface it as an error so the agenda degrades to `program_unavailable`
      // rather than silently telling a child their piano is done.
      if (!answer?.ok) {
        this.#logger.warn?.('school.piano-course.status-rejected', {
          userId, courseId: resolved.courseId, enrolledCourseId: programInstance, reason: answer?.reason ?? 'unknown',
        });
        return { error: true };
      }
      result = { ...answer.result, compoundId: answer.result?.compoundId ?? resolved.courseId };
    } catch (err) {
      sampledWarning(this.#logger, 'school.piano-course.status-failed', {
        userId, courseId: programInstance, error: err?.message ?? String(err),
      });
      return { error: true };
    }
```

Then add the two fields to `common` (the object built at line ~248), first in the literal:

```javascript
    const common = {
      // WHICH course this answer is about. `programInstance` stays the head of
      // the sequence (the enrollment's identity); this is the course actually
      // judged, and what the ceremony bridge must name.
      activeCourseId: resolved.courseId,
      sequence: { position: resolved.position, total: resolved.chain.length, courseIds: resolved.chain },
      score,
```

(Leave every other line of `status` unchanged — `completedToday`, `next`, bypass, lock, challenge all now read the active course's `result`.)

- [ ] **Step 6: Implement — `issueLaunchTarget`.** Replace its first four lines after the guard:

```javascript
  async issueLaunchTarget({ userId, programInstance = null, corpusId = null } = {}) {
    const headId = programInstance ?? corpusId;
    if (!userId || !headId) throw new Error('piano-course launch requires learner and course');
    const { answer, courseId } = await this.#resolveCourse({ userId, programInstance: headId, nowMs: this.#nowMs() });
    if (!answer?.ok) throw new Error(`piano-course is unavailable: ${answer?.reason ?? 'unknown'}`);
    const result = { ...answer.result, compoundId: answer.result?.compoundId ?? courseId };
```

(the rest of the method is unchanged).

- [ ] **Step 7: Run to verify all pass**

Run: `npx vitest run tests/isolated/application/school/pianoCourseProgramLauncher.test.mjs tests/isolated/application/school/getPianoLessonGate.test.mjs`
Expected: PASS, every test in both files. If an existing test asserts the exact shape of a `status()` answer with `toEqual`, update it to include `activeCourseId` and `sequence`, because those fields are now part of the contract. Do not loosen it to `toMatchObject`.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(school): piano-course derives its active course from the enrollment's sequence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- backend/src/3_applications/school/PianoCourseProgramLauncher.mjs tests/isolated/application/school/pianoCourseProgramLauncher.test.mjs
```

---

### Task 3: Wire the sequence in, and make the ceremony name the course actually played

**Files:**
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs:633-636`
- Modify: `backend/src/3_applications/school/PianoLessonCeremonyBridge.mjs` (the `#handle` loop ~lines 170-183, and the challenge loop ~245-248)
- Test: `tests/isolated/application/school/pianoLessonCeremonyBridge.test.mjs`

**Interfaces:**
- Consumes: Task 2's `courseSequence` option and `status.activeCourseId`.
- Produces: `school.piano-ceremony.satisfied`, the broadcast and the HA hook carry `courseId = status.activeCourseId ?? enrolledCourseId`. The `ignored` log gains `activeCourseIds`.

- [ ] **Step 1: Read the bridge test's `build()` helper** (lines 40-67) to learn its `status` option.

Run: `sed -n 40,70p tests/isolated/application/school/pianoLessonCeremonyBridge.test.mjs`

- [ ] **Step 2: Write the failing tests** (append inside the existing `describe('PianoLessonCeremonyBridge', …)`, using `build`, `fakeBus` and `completion` as that file defines them. Adapt the event-emit line to the one the existing "announces on both limbs" test uses):

```javascript
  it('names the SUCCESSOR course when a sequenced enrollment has advanced', async () => {
    const successorLesson = { ...completion('plex:694788', 'Lesson 15'), course: { id: 'plex:694771', title: 'Piano' } };
    const r = build({
      status: {
        doneToday: true, activeCourseId: 'plex:694771',
        completedLessonsToday: [successorLesson], completedLessons: [successorLesson],
        servedWork: [{ unitId: 'plex:694788', title: 'Lesson 15' }],
      },
    });
    await r.emitCompletion({ userId: 'learner4', plexId: 'plex:694788', title: 'Lesson 15' });
    const satisfied = r.logs.find((l) => l.event === 'school.piano-ceremony.satisfied');
    expect(satisfied.data.courseId).toBe('plex:694771');
  });

  it('ignores a re-watch of a finished head lesson once the sequence has moved on', async () => {
    const r = build({
      status: { doneToday: false, activeCourseId: 'plex:694771', completedLessonsToday: [], completedLessons: [] },
    });
    await r.emitCompletion({ userId: 'learner4', plexId: 'plex:695651', title: 'Eighth Notes' });
    const ignored = r.logs.find((l) => l.event === 'school.piano-ceremony.ignored');
    expect(ignored.data).toMatchObject({ reason: 'not-in-enrolled-course', activeCourseIds: ['plex:694771'] });
    expect(r.logs.find((l) => l.event === 'school.piano-ceremony.satisfied')).toBeUndefined();
  });
```

If `build()` exposes different names for the log sink or the emit call, use the file's own names. The assertions (course id on `satisfied`; `activeCourseIds` on `ignored`) are the contract.

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/isolated/application/school/pianoLessonCeremonyBridge.test.mjs`
Expected: FAIL (`courseId` is the head; `activeCourseIds` absent).

- [ ] **Step 4: Implement the bridge.** In `#handle`, after `const candidateStatus = await …`, collect the active id and use it when the candidate matches:

```javascript
    const activeCourseIds = [];
    for (const candidate of enrollments) {
      const candidateCourseId = candidate.courseId ?? candidate.corpusId ?? null;
      if (!candidateCourseId) continue;
      // eslint-disable-next-line no-await-in-loop
      const candidateStatus = await this.#launcher.status({ userId: learnerId, programInstance: candidateCourseId });
      // A SEQUENCED enrollment judges its ACTIVE course, which after an
      // advance is not the one the plan names first. The ceremony, the hook
      // and the evidence must all name the course the child actually played.
      const activeCourseId = candidateStatus?.activeCourseId ?? candidateCourseId;
      activeCourseIds.push(activeCourseId);
      const candidateCompletion = (candidateStatus?.completedLessonsToday ?? [])
        .find((row) => row?.lesson?.id === payload?.plexId);
      if (!candidateCompletion) continue;
      enrollment = candidate;
      courseId = activeCourseId;
      status = candidateStatus;
      completion = candidateCompletion;
      break;
    }
```

and add `activeCourseIds,` to the `school.piano-ceremony.ignored` log payload next to `enrolledCourseIds`. In the challenge loop (~line 245-252), after `const status = …` set `const activeCourseId = status?.activeCourseId ?? courseId;` and pass `courseId: activeCourseId` to `#recordChallengeEvidence`, the `satisfied` log, `#broadcast` and `#fireHook` in that block.

- [ ] **Step 5: Implement the composition.** In `schoolLifecycle.mjs`, extend the launcher construction:

```javascript
    pianoCourseLauncher = new PianoCourseProgramLauncher({
      getPlayableUnits: pianoPlayableUnits, donow, dayBypasses: programDayBypassStore,
      challengeCompletion: schoolPianoChallengeCompletionService, timezone, clock, logger,
      // The enrollment's explicit follow-on courses. Read per call — the
      // assignment store re-reads the plan file every time — so adding `then:`
      // to a learner's plan takes effect on the next status read, no restart.
      courseSequence: async ({ learnerId, courseId }) => {
        const assignment = await stores.assignments.get(learnerId);
        const row = (assignment?.programs ?? []).find((program) => program?.programId === 'piano-course'
          && (program.courseId ?? program.corpusId) === courseId);
        return Array.isArray(row?.then) ? row.then : [];
      },
    });
```

(`stores` is in scope at line 539 where `stores.assignments` is created. Confirm with `grep -n "stores.assignments" backend/src/5_composition/modules/schoolLifecycle.mjs` before editing.)

- [ ] **Step 6: Run to verify**

Run: `npx vitest run tests/isolated/application/school/pianoLessonCeremonyBridge.test.mjs tests/isolated/application/school/pianoCourseProgramLauncher.test.mjs tests/isolated/application/school/getPianoLessonGate.test.mjs backend/src/5_composition/composition-contract-registry.test.mjs`
Expected: PASS, all.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(school): wire the piano course sequence; ceremonies name the course played

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- backend/src/5_composition/modules/schoolLifecycle.mjs backend/src/3_applications/school/PianoLessonCeremonyBridge.mjs tests/isolated/application/school/pianoLessonCeremonyBridge.test.mjs
```

---

### Task 4: Reference doc

**Files:**
- Modify: `docs/reference/school/programs.md` (append a subsection after the `status()` order table in "Piano course — a program backed by another app's evidence", before "### The kiosk menu gate")

- [ ] **Step 1: Add the subsection**

```markdown
### Course sequences — what comes after this course

An enrollment may name the courses that follow it:

​```yaml
- programId: piano-course
  courseId: plex:695598      # the head — the enrollment's identity, never changes
  then: [plex:694771]        # explicit follow-ons, in order
​```

The ACTIVE course is derived, never stored. On every `status()` and launch,
the launcher walks `[courseId, ...then]` and judges the day against the first
course **not finished on a study day before it**: every crediting lesson
watched, each `completedAt` earlier than the day being judged.
`completedAt` is stamped once and a re-watch never moves it, so the rule holds
for any past day, and the term grid re-scores history by itself.

- **The finishing day keeps its course.** Its last lesson credits that day, and
  the successor is owed from the next study day.
- **Backdated.** Work done in the successor after the finish counts on the day
  it was done, even if the sequence was added to the plan later.
- **A successor already partly done** resumes at its first unwatched lesson.
- **After the last course,** the answer is the old "course complete".
- `status()` carries `activeCourseId` and `sequence {position, total, courseIds}`.
  The agenda row's `unitId` / `programInstance` stay the head, so day bypasses
  and sessions keep one identity across an advance.
- An advance logs `school.piano-course.sequence-active` once per learner+course
  per process. A plan that cannot be read for the list logs
  `school.piano-course.sequence-read-failed` and judges the head alone. A
  successor Plex cannot read is `error: true`, never "complete".

Why it exists: on 2026-09-28 a learner finished Reading Music (53/53). His
enrollment had nothing after it, so from the next day the program owed a
lesson that did not exist, and the Piano-season lessons he moved on to by
himself earned nothing.
```

(Remove the zero-width characters before each inner fence; they only stop this plan's own fence from closing early.)

- [ ] **Step 2: Commit**

```bash
git commit -m "docs(school): piano course sequences

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- docs/reference/school/programs.md
```

---

### Task 5: Turn it on for the learner, ship, and verify on the real data

> **`LEARNER`.** This repo is public, so the plan does not name the child. The
> learner id is in the session handoff (the learner whose plan holds
> `courseId: plex:695598`). Every command below expects it exported first:
> `export LEARNER=<learner id>`. The commands are double-quoted on purpose so
> the HOST shell expands it before `docker exec` runs.

**Files:**
- Modify (data volume): `data/household/school/plans/learners/${LEARNER}.yml`

- [ ] **Step 1: Run the full affected suites**

Run: `npx vitest run backend/src/3_applications/school/SchoolProgramEnrollmentValidators.test.mjs backend/src/3_applications/school/usecases/SetAssignments.readingPrograms.test.mjs tests/isolated/application/school/pianoCourseProgramLauncher.test.mjs tests/isolated/application/school/pianoLessonCeremonyBridge.test.mjs tests/isolated/application/school/getPianoLessonGate.test.mjs backend/src/5_composition/composition-contract-registry.test.mjs`
Expected: PASS, all. Capture the real exit code (`; echo EXIT=$?`); a green summary with a nonzero exit is a failure.

- [ ] **Step 2: Build and deploy through the gate**, as ONE chained command after the build (a clear gate is a moment, not a state):

```bash
./scripts/deploy-gate.sh && ./scripts/build-daylight.sh
./scripts/deploy-gate.sh && sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

Confirm the deployed commit: `curl -s http://localhost:3111/build.txt` must name this branch's HEAD SHA.

- [ ] **Step 3: Write the learner's plan with the sequence.** Read it first (`sudo docker exec daylight-station sh -c "cat data/household/school/plans/learners/${LEARNER}.yml"`) and confirm it still matches the block below apart from `then`. If it differs, keep its current values and add only `then`. Then write the COMPLETE file:

```bash
sudo docker exec daylight-station sh -c "cat > data/household/school/plans/learners/${LEARNER}.yml << 'EOF'
learnerId: ${LEARNER}
enrollments: []
standaloneWork: []
programs:
  - programId: story-time
    corpusId: null
    target: 2
    subject: english
    title: Story time
    schedule:
      daysOfWeek:
        - 1
        - 2
        - 3
        - 4
        - 5
  - programId: piano-course
    corpusId: plex:695598
    courseId: plex:695598
    then:
      - plex:694771
    subject: arts
    title: Reading Music lesson
    videosLockedAfter: 2
    schedule:
      daysOfWeek:
        - 1
        - 2
        - 3
        - 4
        - 5
assignedBy: kckern
updatedAt: '2026-09-30T19:30:00.000Z'
EOF"
```

(`title` stays "Reading Music lesson" because the agenda row shows the live lesson title from `programContext`, not this string. Rename it to "Piano lesson" only if the printed slip should say so.)

- [ ] **Step 4: Verify the live answer.** Each must hold:

```bash
B=http://localhost:3111/api/v1/school/lifecycle/learners/${LEARNER}
curl -s "$B/piano-lesson-gate" | jq -c .
# expect reason "owed" with Lesson 16 (plex:694789), or "done" if Lesson 16 finished today — NOT "course-complete"
curl -s "$B/agenda/preview?format=json" | jq -c '[.. | objects | select(.programInstance? == "plex:695598")][0] | {title, courseId}'
# expect the title of a Piano-season lesson and courseId plex:694771
curl -s "$B/term" | jq -r '.days[] | select(.studyDay >= "2026-09-28") | "\(.studyDay) \(.state) \(.served)/\(.asked)"'
# expect 2026-09-29 to have served >= 1 (Lesson 15 at 07:43 PDT) — no longer "none 0/2"
curl -s http://localhost:9428/select/logsql/query -d 'query=_time:30m AND _msg:"school.piano-course.sequence-active"' | jq -c '{t:._time, d:."data.activeCourseId"}'
# expect one line naming plex:694771
```

The term grid recomputes today and yesterday on read (`docs/reference/school/term-grid.md`, "The cache"). If this runs after the 04:00 rollover on 2026-10-01, 09-29 is no longer "yesterday" and stays cached. In that case move the cache aside and read again (never `rm` in the data tree):

```bash
sudo docker exec daylight-station sh -c "mkdir -p data/_deleteme && mv data/household/school/records/verdicts/${LEARNER}/2026-fall.yml data/_deleteme/verdicts-${LEARNER}-2026-fall-pre-sequence.yml"
curl -s "$B/term" > /dev/null; sleep 20; curl -s "$B/term" | jq -r '.days[] | select(.studyDay >= "2026-09-28") | "\(.studyDay) \(.state) \(.served)/\(.asked)"'
```

- [ ] **Step 5: Verify the ceremony on the next real lesson.** When the learner next completes a Piano-season lesson, the log store must show `school.piano-ceremony.satisfied` with `courseId: plex:694771`:

```bash
curl -s http://localhost:9428/select/logsql/query -d "query=_time:24h AND _msg:\"school.piano-ceremony.satisfied\" AND data.learnerId:${LEARNER}" | jq -c '{t:._time, c:."data.courseId", l:."data.lesson"}'
```

- [ ] **Step 6: Commit nothing for the data write** (the data volume is not in git). Record the change in the final report: which file, the added `then` list, and the verification output.

---

## Self-Review (done while writing)

- **Spec coverage:** explicit list → Task 1 plus the Task 5 data write. Next-day start → Task 2 "keeps the finishing course". Backdate → Task 2 replay test, plus Task 5 term-grid check. Auto-advance through the list → Task 2 "walks the whole chain". Visible advance → Task 2 log test. Ceremony names the successor → Task 3.
- **Placeholders:** none. The two "adapt to the file's own helper names" notes point at test rigs whose exact helper names must be read, not guessed; the assertions are fixed.
- **Type consistency:** `courseSequence({learnerId, courseId}) → string[]` (Tasks 2, 3). `activeCourseId: string` and `sequence: {position, total, courseIds}` (Tasks 2, 3, 4). Log event names `school.piano-course.sequence-active` / `sequence-read-failed` are identical in the code, tests and docs.
- **Review Focus:** each of the five lines has a test in its owning task (1, 2 "first UNWATCHED" + "no sequence", 2 "cannot be read", 1 bad lists, 3 successor + re-watch).
