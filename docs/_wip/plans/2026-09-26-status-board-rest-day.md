# Status Board Rest-Day Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a weekend or holiday, the Portal status board stops telling a child "No plan to show". It says "No school today" and, when optional work is on offer, "Scan your card for extra work".

**Architecture:** `summarize()` in `agendaStatusModel.js` already receives each section's `obligation`. It gains one derived field, `restDay`, which is set when every planned section is excused as `not_a_school_day`. `AgendaStatusBoard.jsx` reads that field where it currently prints "No plan to show" and picks the copy. There is no backend change: the agenda preview already returns the obligation reason, and a Saturday agenda print already carries every optional lesson with a code.

**Tech Stack:** React (JSX), Vitest + Testing Library (jsdom), SCSS.

**Spec:** No separate spec. The incident below is the requirement, and the governing rule is `docs/reference/school/timing-and-priority.md` → "What a non-school day does to the agenda": *"`next` is still offered … A presenter … must read the obligation reason rather than the presence of `next` to decide whether to say 'no school today'."*

### The incident (2026-09-26, Saturday)

A learner went to the Portal to do their Korean flashcards and reported "there's nothing for me to do". What actually happened:

- The agenda preview for that learner returned seven sections. Each was `obligation: {state: 'excused', reason: 'not_a_school_day'}` (scripture: `optional_backlog`; science: `elective_only`), and each still had a `next`. Language offered `flashcards:language/korean/week-01-classroom`, "3 new words · 8 to review".
- `summarize()` skips every excused section on purpose (see the comment above `if (section.obligation?.state === 'excused') continue;`). That rule is correct: optional work must not show up as required discs. The side effect is `total: 0`, and the board prints **"No plan to show"** on three of the four learner cards.
- The way in on a weekend is to scan their card. That prints the agenda, which carries a code for each optional lesson (confirmed from the preview PNG, including "3 new words · 8 to review — ON THE PORTAL"). They had printed agendas this way on 9/19 and 9/20. Nothing on the board said so. They typed a stale code from the night before instead, and the keypad said "Try again."

## Global Constraints

- Copy, verbatim: headline `No school today`; hint `Scan your card for extra work`. The hint phrasing matches the existing Portal copy in `selfService/useScanCeremony.js` ("Scan your card to print a fresh one…").
- Pinned past day (`day` prop set): headline `No school`, and **no** hint. Scanning now prints *today's* agenda, not that day's.
- Excused work must still never become a disc or count toward `total`. The existing `summarize` rule and its tests stay untouched.
- `summary.restDay` must be JSON-serialisable (`boardCache.js` persists `summary` to localStorage).
- No raw `console.*`. This change adds no new log events; it's a presentational branch.
- Run tests with the repo's Vitest: `npx vitest run <file>`. The CLI path acts as a filter, so pass the exact file.

## Review Focus

1. **A weekday where the plan read failed** (`agendaPreview` rejects or returns `ok:false`) must still say `No plan to show`, not `No school today`. We don't know it's a day off. Test in Task 2.
2. **A Saturday where the child already did something** (reading or fitness pins, or a served lesson): the discs keep drawing. If `total > 0` the meter shows as before; if only supplemental pins exist (`total === 0`), the rest-day copy shows under them, never "No plan to show". Tests in Tasks 1 and 2.
3. **A mixed day**, where one section is `not_a_school_day` and another is `obligated` (an unscheduled course beside a weekday-only one): this is NOT a rest day, so `restDay` must be null. Test in Task 1.
4. **Every section excused but none as `not_a_school_day`** (e.g. all `optional_backlog` / `elective_only`, or `suppressed_by_focus`): not a rest day, so the old copy stays. Test in Task 1.
5. **A holiday with nothing offered** (every section excused `not_a_school_day`, none with `next.unitId`): headline only, no hint. A hint pointing at an agenda with nothing on it would be a lie. Test in Tasks 1 and 2.

---

### Task 0: Branch and worktree

**Files:** none changed. This task sets up the workspace and brings in this plan file.

- [ ] **Step 1: Create the worktree from fresh origin/main**

Run from the main checkout (`/opt/Code/DaylightStation`):

```bash
git fetch origin main
git worktree add .claude/worktrees/status-board-rest-day -b fix/status-board-rest-day origin/main
cd .claude/worktrees/status-board-rest-day
```

- [ ] **Step 2: Bring this plan into the worktree**

```bash
cp ../encapsulate-piano-styles/docs/_wip/plans/2026-09-26-status-board-rest-day.md docs/_wip/plans/
git add docs/_wip/plans/2026-09-26-status-board-rest-day.md
git commit -m "docs(school): plan — status board says No school today on a rest day

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Then move the original out of the piano-styles worktree (`mv ../encapsulate-piano-styles/docs/_wip/plans/2026-09-26-status-board-rest-day.md ../encapsulate-piano-styles/_deleteme/`) so it isn't committed there by accident.

- [ ] **Step 3: Confirm the baseline is green**

Run: `npx vitest run frontend/src/modules/School/status/AgendaStatusBoard.test.jsx`
Expected: PASS (all existing tests). If anything fails before you touch code, stop and report it; don't build on a red baseline.

---

### Task 1: `summarize()` derives `restDay`

**Files:**
- Modify: `frontend/src/modules/School/status/agendaStatusModel.js`: the `summarize` doc comment (~line 24) and its `return` (~line 250)
- Test: `frontend/src/modules/School/status/AgendaStatusBoard.test.jsx`: new `describe('rest day', …)` block inside the model section, placed after the `'acknowledges reading and physical education independently'` test's enclosing `describe` closes (~line 704)

**Interfaces:**
- Consumes: the `sections` argument as it arrives today from `GET /api/v1/school/lifecycle/learners/:id/agenda/preview?format=json` (`section.obligation = {state, reason}`, `section.suppressed`, `section.next?.unitId`).
- Produces: `summarize(...)` returns `{ total, done, segments, restDay }`, where `restDay` is `null` or `{ optionalCount: number }`. `optionalCount` is the number of `not_a_school_day` sections whose `next.unitId` is set.

- [ ] **Step 1: Write the failing tests**

Add this block to `AgendaStatusBoard.test.jsx` (the file already imports `summarize`):

```jsx
describe('rest day', () => {
  const off = (subject, next = { unitId: `${subject}.next` }) => ({
    subject, next, obligation: { state: 'excused', reason: 'not_a_school_day' },
  });

  it('marks a day where every section is excused as not_a_school_day', () => {
    const summary = summarize([off('math'), off('language')], []);
    expect(summary.total).toBe(0);
    expect(summary.segments).toEqual([]);
    expect(summary.restDay).toEqual({ optionalCount: 2 });
  });

  it('still counts it as a rest day beside optional_backlog / elective_only sections', () => {
    // The real 2026-09-26 shape: scripture was optional_backlog, science elective_only.
    const summary = summarize([
      off('math'),
      { subject: 'scripture', next: { unitId: 'cfm.1' }, obligation: { state: 'excused', reason: 'optional_backlog' } },
      { subject: 'science', next: { unitId: 'sci.1' }, obligation: { state: 'excused', reason: 'elective_only' } },
    ], []);
    expect(summary.restDay).toEqual({ optionalCount: 1 });
  });

  it('is not a rest day when any section is still obligated', () => {
    const summary = summarize([off('math'), { subject: 'language', next: { unitId: 'fc.1' }, obligation: { state: 'obligated' } }], []);
    expect(summary.restDay).toBeNull();
    expect(summary.total).toBe(1);
  });

  it('is not a rest day when nothing is excused as not_a_school_day', () => {
    const summary = summarize([
      { subject: 'scripture', next: { unitId: 'cfm.1' }, obligation: { state: 'excused', reason: 'optional_backlog' } },
      { subject: 'math', next: { unitId: 'm.1' }, obligation: { state: 'excused', reason: 'suppressed_by_focus' } },
    ], []);
    expect(summary.restDay).toBeNull();
  });

  it('is not a rest day with no sections at all (plan failed or empty)', () => {
    expect(summarize([], []).restDay).toBeNull();
    expect(summarize(undefined, undefined).restDay).toBeNull();
  });

  it('ignores suppressed sections when deciding', () => {
    const summary = summarize([off('math'), { subject: 'art', suppressed: 'focus', obligation: { state: 'obligated' } }], []);
    expect(summary.restDay).toEqual({ optionalCount: 1 });
  });

  it('reports zero optional work on a holiday with nothing offered', () => {
    const summary = summarize([off('math', null), off('language', {})], []);
    expect(summary.restDay).toEqual({ optionalCount: 0 });
  });

  it('keeps drawing work the child already did on a rest day', () => {
    const summary = summarize([off('language', { unitId: 'fc.1' })],
      [{ unitId: 'fc.1', subject: 'language', state: 'issued', outcome: null }]);
    expect(summary.segments.map((s) => s.state)).toEqual(['in-progress']);
    expect(summary.total).toBe(1);
    expect(summary.restDay).toEqual({ optionalCount: 1 });
  });

  it('survives a JSON round-trip (the board caches summaries in localStorage)', () => {
    const summary = summarize([off('math')], []);
    expect(JSON.parse(JSON.stringify(summary)).restDay).toEqual({ optionalCount: 1 });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run frontend/src/modules/School/status/AgendaStatusBoard.test.jsx -t "rest day"`
Expected: FAIL. Every test fails on `restDay` being `undefined` (`toEqual`/`toBeNull` mismatch).

- [ ] **Step 3: Implement**

In `agendaStatusModel.js`, add this function directly above `export function summarize`:

```js
/**
 * A REST DAY: every planned section is excused, and at least one of them
 * because the day is not a school day (weekend, holiday, vacation).
 *
 * The plan loop below drops excused sections on purpose, so optional work
 * never becomes a required disc. The price was that a Saturday read
 * `total: 0`, and the board said "No plan to show" to a child who had
 * flashcards waiting (2026-09-26). The board needs to say "No school today"
 * and, when there is optional work, how to get it: scan your card, and the
 * agenda prints every optional lesson with a code.
 *
 * `optional_backlog` / `elective_only` sections beside a `not_a_school_day`
 * one do not spoil the day. They are excused on every day. One OBLIGATED
 * section does: that is a school day with work owed.
 */
function restDayOf(planned) {
  if (!planned.length) return null;
  if (!planned.every((section) => section.obligation?.state === 'excused')) return null;
  const off = planned.filter((section) => section.obligation?.reason === 'not_a_school_day');
  if (!off.length) return null;
  return { optionalCount: off.filter((section) => section.next?.unitId).length };
}
```

Then change the final `return` of `summarize` from:

```js
  return { total, done, segments };
```

to:

```js
  return { total, done, segments, restDay: restDayOf(planned) };
```

And extend `summarize`'s doc block (the one starting `One disc per ASSIGNMENT`) with one line after the "Four states" list:

```js
 *
 * `restDay` is `null`, or `{optionalCount}` on a day off. See `restDayOf`.
```

- [ ] **Step 4: Run the whole file to verify it passes**

Run: `npx vitest run frontend/src/modules/School/status/AgendaStatusBoard.test.jsx`
Expected: PASS, including every pre-existing test. Any existing `toEqual` on a whole `summarize` result would now see an extra key; the existing tests use `toMatchObject` / field reads, so none should break. If one does, update its expectation to include `restDay: null`. Do not change `summarize`'s behaviour to satisfy it.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/School/status/agendaStatusModel.js frontend/src/modules/School/status/AgendaStatusBoard.test.jsx
git commit -m "feat(school): status board model knows a rest day from an empty plan

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The board says "No school today"

**Files:**
- Modify: `frontend/src/modules/School/status/AgendaStatusBoard.jsx`: the meter/status branch (~lines 671–677) and the component signature is already `({ kids = [], day, onOpenSegment = null })` (line 334)
- Modify: `frontend/src/modules/School/School.scss`: next to `&__status--none` (~line 3313)
- Test: `frontend/src/modules/School/status/AgendaStatusBoard.test.jsx`: new `describe('rest day on the board', …)` block at the end of the file

**Interfaces:**
- Consumes: `summary.restDay` from Task 1 (`null | {optionalCount}`) and the board's existing `day` prop (undefined on the live Portal, a `YYYY-MM-DD` string when pinned).
- Produces: DOM. `.school-status-board__status--rest` holds the headline, and `.school-status-board__status-hint` holds the hint when present.

- [ ] **Step 1: Write the failing tests**

Append to `AgendaStatusBoard.test.jsx`:

```jsx
describe('rest day on the board', () => {
  const kids = [{ id: 'learner1', name: 'Learner One' }];
  const off = (subject, next = { unitId: `${subject}.next` }) => ({
    subject, next, obligation: { state: 'excused', reason: 'not_a_school_day' },
  });
  const digest = (extra = {}) => ({ ok: true, data: { studyDay: '2026-09-26', learners: [{ learnerId: 'learner1', sessions: [], ...extra }] } });
  beforeEach(() => {
    vi.clearAllMocks(); wsHandlers.length = 0;
    schoolApi.stateGates.mockResolvedValue({ ok: false });
    schoolApi.teacherDay.mockResolvedValue(digest());
  });

  it('says No school today and how to get extra work, never No plan to show', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: { sections: [off('math'), off('language')], entries: [] } });
    render(<AgendaStatusBoard kids={kids} />);
    expect(await screen.findByText('No school today')).toBeInTheDocument();
    expect(screen.getByText('Scan your card for extra work')).toBeInTheDocument();
    expect(screen.queryByText('No plan to show')).toBeNull();
    expect(document.querySelector('.school-status-board__pill')).toBeNull();
  });

  it('drops the hint on a holiday with nothing offered', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: { sections: [off('math', null)], entries: [] } });
    render(<AgendaStatusBoard kids={kids} />);
    expect(await screen.findByText('No school today')).toBeInTheDocument();
    expect(screen.queryByText('Scan your card for extra work')).toBeNull();
  });

  it('on a pinned past day says No school, with no scan hint', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: { sections: [off('math')], entries: [] } });
    render(<AgendaStatusBoard kids={kids} day="2026-09-19" />);
    expect(await screen.findByText('No school')).toBeInTheDocument();
    expect(screen.queryByText('No school today')).toBeNull();
    expect(screen.queryByText('Scan your card for extra work')).toBeNull();
  });

  it('never claims a day off when the plan read fails', async () => {
    schoolApi.agendaPreview.mockRejectedValue(new Error('offline'));
    schoolApi.teacherDay.mockResolvedValue(digest({
      readingActivity: { status: 'ok', studyDay: '2026-09-26', hasActivity: false },
    }));
    render(<AgendaStatusBoard kids={kids} />);
    // Plan-less and activity-less: the card settles to null and the board
    // steps off the panel entirely, so assert the rest-day copy never appears.
    await waitFor(() => expect(schoolApi.agendaPreview).toHaveBeenCalled());
    expect(screen.queryByText('No school today')).toBeNull();
  });

  it('shows the rest-day copy under supplemental pins (reading done on a Saturday)', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: { sections: [off('math')], entries: [] } });
    schoolApi.teacherDay.mockResolvedValue(digest({
      readingActivity: { status: 'ok', studyDay: '2026-09-26', hasActivity: true, bookCount: 1, finishedCount: 0, progressCount: 1 },
    }));
    render(<AgendaStatusBoard kids={kids} />);
    expect(await screen.findByRole('img', { name: /Reading: done/ })).toBeInTheDocument();
    expect(screen.getByText('No school today')).toBeInTheDocument();
    expect(screen.queryByText('No plan to show')).toBeNull();
  });

  it('draws the meter, not the rest copy, once a Saturday lesson is under way', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: { sections: [off('language', { unitId: 'fc.1' })], entries: [] } });
    schoolApi.teacherDay.mockResolvedValue(digest({ sessions: [{ unitId: 'fc.1', subject: 'language', state: 'issued', outcome: null }] }));
    render(<AgendaStatusBoard kids={kids} />);
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText('No school today')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run frontend/src/modules/School/status/AgendaStatusBoard.test.jsx -t "rest day on the board"`
Expected: FAIL. The "No school today" / "No school" lookups time out and "No plan to show" is found instead. The plan-read-failure and meter tests may already pass, which is fine: they guard against regressions.

- [ ] **Step 3: Implement the board branch**

In `AgendaStatusBoard.jsx`, replace:

```jsx
              {loading ? null : summary && summary.total > 0 ? (
                <DayMeter summary={summary} />
              ) : (
                <span className="school-status-board__status school-status-board__status--none">No plan to show</span>
              )}
```

with:

```jsx
              {loading ? null : summary && summary.total > 0 ? (
                <DayMeter summary={summary} />
              ) : summary?.restDay ? (
                // A DAY OFF IS NOT AN EMPTY PLAN (2026-09-26). Every section
                // is excused as not a school day, and the optional work is
                // still on the agenda a card scan prints. "No plan to show"
                // told a child with flashcards waiting that there was
                // nothing to do. A pinned past day gets no hint: a scan
                // prints TODAY's agenda, not that day's.
                <RestDayStatus restDay={summary.restDay} pinned={Boolean(day)} />
              ) : (
                <span className="school-status-board__status school-status-board__status--none">No plan to show</span>
              )}
```

And add this component directly below `function DayMeter(...)` (~line 320):

```jsx
/** "No school today" (+ how to get optional work). See `restDayOf` in the model. */
function RestDayStatus({ restDay, pinned }) {
  const hint = !pinned && restDay.optionalCount > 0;
  return (
    <span className="school-status-board__status school-status-board__status--rest">
      {pinned ? 'No school' : 'No school today'}
      {hint && <span className="school-status-board__status-hint">Scan your card for extra work</span>}
    </span>
  );
}
```

- [ ] **Step 4: Style it**

In `School.scss`, directly under `&__status--none { … }`, add:

```scss
  // A DAY OFF reads as an answer, not a gap, so it is not dimmed like
  // "No plan to show". The hint sits under it, smaller, for a child who wants more.
  &__status--rest {
    display: flex; flex-direction: column; align-items: center; gap: 0.2em;
    text-transform: none; letter-spacing: normal; font-weight: 600;
  }
  &__status-hint { font-weight: 500; font-size: 0.85em; opacity: 0.7; }
```

- [ ] **Step 5: Run the whole file to verify it passes**

Run: `npx vitest run frontend/src/modules/School/status/AgendaStatusBoard.test.jsx`
Expected: PASS, all tests old and new. The existing `'No plan to show'` assertions (~lines 739, 787) use `sections: []`, so `restDay` is null and they are unaffected.

- [ ] **Step 6: Run the School gate**

Run: `npm run test:unit:vitest`
Expected: PASS, or failures identical to the baseline on `origin/main`. Compare by running the same command on a clean checkout of `origin/main` if anything fails. Don't wave off a new failure as noise.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/School/status/AgendaStatusBoard.jsx frontend/src/modules/School/School.scss frontend/src/modules/School/status/AgendaStatusBoard.test.jsx
git commit -m "fix(school): status board says No school today on a rest day, not No plan to show

A Saturday excuses every section as not_a_school_day and the board
dropped them all, printing 'No plan to show' to a child with flashcards
waiting (2026-09-26). It now says 'No school today' and, when optional
work is on offer, 'Scan your card for extra work' — the scan prints the
agenda that carries a code for each optional lesson.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Document it

**Files:**
- Modify: `docs/reference/school/agenda-and-completion.md`: new section after "Physical education on the status board" and before "How the status board loads and refreshes"
- Modify: `docs/reference/school/timing-and-priority.md`: the `next` is still offered bullet (~line 357)

- [ ] **Step 1: Add the reference section**

Insert in `agenda-and-completion.md`:

```markdown
## A day off on the status board

When every planned section is excused and at least one because the day is
`not_a_school_day` (weekend, holiday, vacation), `summarize` returns
`restDay: {optionalCount}` and the card says **No school today** instead of
"No plan to show". When `optionalCount > 0` it adds **Scan your card for
extra work**: a card scan prints the agenda, and a rest-day agenda still
carries every optional lesson with its code (the obligation is excused, not
forbidden).

- Excused work is still never a disc and never counts toward the meter.
  Work a child actually does on a day off appears as usual (sessions,
  served work, reading, fitness), and the rest-day copy sits under any
  supplemental pins while `total` is 0.
- One obligated section makes it a school day: no rest-day copy.
  `optional_backlog` / `elective_only` sections beside a `not_a_school_day`
  one don't spoil it.
- A pinned past day (`day` prop) says **No school** with no hint, since a scan
  prints today's agenda.
- A failed plan read keeps "No plan to show": the board can't tell a day
  off from missing data.

Added 2026-09-26, after a child at the Portal on a Saturday read "No plan to
show" as "nothing to do" while flashcards were waiting.
```

- [ ] **Step 2: Point the governing rule at its presenter**

In `timing-and-priority.md`, at the end of the bullet that begins `- **\`next\` is still offered.**`, append:

```markdown
  The Portal status board does exactly this: see
  [A day off on the status board](./agenda-and-completion.md#a-day-off-on-the-status-board).
```

- [ ] **Step 3: Commit**

```bash
git add docs/reference/school/agenda-and-completion.md docs/reference/school/timing-and-priority.md
git commit -m "docs(school): the status board's rest-day copy

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Merge, deploy, verify on the Portal

This host is prod, and `CLAUDE.local.md` grants build and deploy authority, **gated**. Follow it exactly.

- [ ] **Step 1: Merge to main and clean up the branch**

From the main checkout:

```bash
git checkout main && git pull --ff-only origin main
git merge --no-ff fix/status-board-rest-day -m "Merge fix/status-board-rest-day: status board rest-day copy"
git push origin main
echo "| $(date +%F) | fix/status-board-rest-day | $(git rev-parse fix/status-board-rest-day) | Status board rest-day copy |" >> docs/_archive/deleted-branches.md
git add docs/_archive/deleted-branches.md && git commit -m "docs: archive fix/status-board-rest-day

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" && git push origin main
git worktree remove .claude/worktrees/status-board-rest-day && git branch -d fix/status-board-rest-day
```

- [ ] **Step 2: Gate, build, gate again, deploy**

```bash
./scripts/deploy-gate.sh || exit 1          # condition 3 (Portal traffic) blocks while a child is at it
./scripts/build-daylight.sh
./scripts/deploy-gate.sh && sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

If the gate blocks, wait for it to clear and rerun. Do not override without the owner's explicit `GATE OVERRIDE. DEPLOY NOW`.

- [ ] **Step 3: Confirm the deployed build has the fix**

```bash
curl -s http://localhost:3111/build.txt           # COMMIT_HASH must be the merge commit or a descendant
git merge-base --is-ancestor <merge-sha> <deployed-sha> && echo contains-fix
```

- [ ] **Step 4: Reload the Portal and look at it**

```bash
PW=$(sudo docker exec daylight-station sh -c "node -e \"const y=require('js-yaml');console.log(y.load(require('fs').readFileSync('data/household/auth/fullykiosk.yml','utf8')).password)\"")
FKB_HOST=10.0.0.92:2323 FKB_PW="$PW" node cli/fkb.cli.mjs reload
sleep 20
FKB_HOST=10.0.0.92:2323 FKB_PW="$PW" node cli/fkb.cli.mjs shot "$CLAUDE_JOB_DIR/tmp/portal-after.png"
```

Open the screenshot. On a weekend or holiday, the idle rows must read "No school today" / "Scan your card for extra work", and no row may read "No plan to show". On a weekday, rows show their discs and meter as before. Take the screenshot on a school day too and confirm nothing changed there. The assertions in Tasks 1–2 don't prove the render (jsdom has no layout), so check the text isn't clipped in the card's `__day` column at 1280×800.
