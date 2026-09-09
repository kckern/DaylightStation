# Status Board Triangle — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the `AgendaStatusBoard` card as three columns — the existing rail, a bowling-pin triangle of subject discs, and a right-hand readout of two pills — so the discs stop crowding the card's bottom border and a busy day reads as a taller pyramid instead of a longer strip.

**Architecture:** The packing rule becomes a pure function in `agendaStatusModel.js` (`triangleRows`), so no component knows how a triangle is built and the whole rule is testable without rendering. The component renders one `<ul>` per row inside a cluster wrapper. `__info` stops being a vertical stack and becomes a flex row; the disc cluster and the readout are siblings, which is what frees the card's full height for the triangle. The `--count` CSS variable — which divided the card width by the number of discs — is deleted, because width stops being the binding constraint.

**Design doc:** `docs/_wip/plans/2026-09-09-status-board-triangle-design.md`. Read it first; this plan implements it and does not re-decide anything in it.

**Tech Stack:** React 18, SCSS (`School.scss`, hand-rolled `--school-*` tokens), Vitest + Testing Library (jsdom).

---

## Before you start

### The naming collision, and how this plan resolves it

Today `&__pill` is **the disc** and `&__pills` is **the disc row**. The design adds a right-hand readout that is also called a pill. Two things called "pill" in one card is not survivable, so this plan renames as it goes:

| Today | After |
|---|---|
| `school-status-board__pills` (the `<ul>`) | `school-status-board__cluster` (wrapper) + `__cluster-row` (one `<ul>` per row) |
| `school-status-board__pill` (a disc) | `school-status-board__disc` |
| `school-status-board__pill--skeleton` | `school-status-board__disc--skeleton` |
| `school-status-board__status` (the `0 OF 6` text) | `school-status-board__work-pill` + `__notch` + `__fraction` |
| `school-status-board__rings` | `school-status-board__rings-pill` |
| — | `school-status-board__readout` (the right column) |

`__extra` (the `+N` badge), `__rail`, `__name`, `__row`, `__title` and `__done-chip` keep their names. `__done-chip` changes role — see Task 7.

Existing tests select on `.school-status-board__pill` at `AgendaStatusBoard.test.jsx:411` and `:439`, and on `--count` at `:412`. Tasks 2 and 4 update them.

### jsdom cannot see this design

Every geometric claim in the design — disc diameter, the 0.78 nesting pitch, centring, notch widths — is invisible to jsdom. Tests here pin **structure and state**: how many rows, how wide each row, what order the segments come in, how many notches, what each notch's `data-state` is. Task 12 is the screenshot, and it is not optional.

### Commands

```bash
# One test file
npx vitest run --config vitest.config.mjs frontend/src/modules/School/status/agendaStatusModel.test.js

# The whole status module
npx vitest run --config vitest.config.mjs frontend/src/modules/School/status/

# Every colocated frontend spec
npm run test:isolated -- --only=frontend

# SCSS still compiles
npm run check:scss
```

### Do not

- **Do not add motion.** No entry animation on the triangle, no fill transition on the pill, no glow on the cleared card. The component's header defends this as settled (KC, 2026-08-26) and it stays settled. The only animation in this file is the skeleton shimmer, which keeps its `prefers-reduced-motion` kill.
- **Do not use raw `console.*`** — the board logs through `schoolLog`.
- **Do not touch** the roster fetching, the three WebSocket refresh paths (`omr`, `school`, `state-gates`), or the board's non-interactive contract (`AgendaStatusBoard.test.jsx:322` asserts zero buttons and links — it must stay true).

---

## Task 1: `triangleRows` — the packing rule

**Files:**
- Modify: `frontend/src/modules/School/status/agendaStatusModel.js`
- Create: `frontend/src/modules/School/status/agendaStatusModel.test.js`

The model has **no colocated spec today** — it is tested only through the board. This task gives it one.

**Step 1: Write the failing test**

Create `agendaStatusModel.test.js`:

```javascript
/**
 * The packing rule, verified without rendering anything.
 *
 * The board draws its discs as a bowling-pin triangle: the base is the widest
 * row and each row above is one narrower. This function is the whole rule, so
 * the table below is the specification.
 */
import { describe, expect, it } from 'vitest';
import { triangleRows } from './agendaStatusModel.js';

describe('triangleRows', () => {
  it('packs 1-9 discs as a pyramid, base widest, top row first', () => {
    expect(triangleRows(1)).toEqual([1]);
    expect(triangleRows(2)).toEqual([2]);
    expect(triangleRows(3)).toEqual([1, 2]);
    expect(triangleRows(4)).toEqual([1, 3]);
    expect(triangleRows(5)).toEqual([2, 3]);
    expect(triangleRows(6)).toEqual([1, 2, 3]);
    expect(triangleRows(7)).toEqual([3, 4]);
    expect(triangleRows(8)).toEqual([1, 3, 4]);
    expect(triangleRows(9)).toEqual([2, 3, 4]);
  });

  it('never exceeds three rows — the base widens instead', () => {
    // A fourth row takes the disc below the diameter at which its glyph is
    // readable across a room, so past nine the triangle gets wider, not taller.
    for (let n = 1; n <= 24; n += 1) {
      expect(triangleRows(n).length).toBeLessThanOrEqual(3);
    }
    expect(triangleRows(12)).toEqual([3, 4, 5]);
    expect(triangleRows(15)).toEqual([4, 5, 6]);
  });

  it('always accounts for exactly the discs it was given', () => {
    for (let n = 0; n <= 24; n += 1) {
      const sum = triangleRows(n).reduce((a, b) => a + b, 0);
      expect(sum).toBe(n);
    }
  });

  it('never widens going up — every row is at most the width of the one below', () => {
    for (let n = 1; n <= 24; n += 1) {
      const rows = triangleRows(n);
      for (let i = 1; i < rows.length; i += 1) {
        expect(rows[i - 1]).toBeLessThanOrEqual(rows[i]);
      }
    }
  });

  it('returns nothing for nothing, and refuses junk rather than guessing', () => {
    expect(triangleRows(0)).toEqual([]);
    expect(triangleRows(-3)).toEqual([]);
    expect(triangleRows(null)).toEqual([]);
    expect(triangleRows(undefined)).toEqual([]);
    expect(triangleRows(2.7)).toEqual([2]);
  });
});
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/status/agendaStatusModel.test.js
```

Expected: FAIL — `triangleRows is not a function`.

**Step 3: Implement it**

Append to `agendaStatusModel.js`:

```javascript
// A disc row is never taller than this. Nine assignments — the subject wall's
// own ceiling (home/subjects.js) — lands exactly on three rows. A fourth row
// would divide the card's ~104px of inner height four ways and take the glyph
// inside each disc below the size it stays readable at across a room, so past
// nine the base widens instead.
const MAX_TRIANGLE_ROWS = 3;

/**
 * Pack `count` discs into a bowling-pin triangle: the base is the widest row
 * and each row above is one narrower. Returned TOP ROW FIRST, so the component
 * can render the rows in DOM order and reading order is preserved.
 *
 *   3 → [1, 2]        6 → [1, 2, 3]       9 → [2, 3, 4]
 *
 * The base width is the smallest `b` where b(b+1)/2 >= count — the smallest
 * triangle that can hold them all. Rows then take `b`, `b-1`, … until the
 * discs run out, which is why a count that does not fill its triangle exactly
 * (4 → [1, 3]) shorts the TOP row rather than the base: the base is the shape's
 * foot and a ragged one reads as a mistake.
 */
export function triangleRows(count) {
  const n = Math.floor(Number(count) || 0);
  if (n <= 0) return [];
  // The triangular-number inverse, rounded up: the smallest base that fits.
  let base = Math.ceil((Math.sqrt(8 * n + 1) - 1) / 2);
  // Past the row cap, widen the base until three rows can hold them all.
  while (base + (base - 1) + (base - 2) < n) base += 1;
  const rows = [];
  let remaining = n;
  let width = base;
  while (remaining > 0 && rows.length < MAX_TRIANGLE_ROWS) {
    const take = Math.min(width, remaining);
    rows.unshift(take);
    remaining -= take;
    width -= 1;
  }
  return rows;
}
```

**Step 4: Run it and watch it pass**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/status/agendaStatusModel.test.js
```

Expected: PASS, 5 tests. If `triangleRows(12)` comes back as something other than `[3,4,5]`, the widening loop is the thing to look at — `base` must grow until the top three rows of the triangle hold `n`.

**Step 5: Commit**

```bash
git add frontend/src/modules/School/status/agendaStatusModel.js frontend/src/modules/School/status/agendaStatusModel.test.js
git commit -m "feat(school): pack status discs as a bowling-pin triangle"
```

---

## Task 2: The board renders rows

**Files:**
- Modify: `frontend/src/modules/School/status/AgendaStatusBoard.jsx:330-360` (the segment `<ul>`)
- Modify: `frontend/src/modules/School/status/AgendaStatusBoard.test.jsx:410-412, 439`

**Step 1: Write the failing test**

Add to `AgendaStatusBoard.test.jsx`, inside the same `describe` that holds the segment-icon test:

```javascript
  it('draws six segments as a 1/2/3 pyramid, in reading order', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [] } });
    const subjects = ['reading', 'math', 'civilization', 'science', 'arts', 'health'];
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: {
      sections: subjects.map((subject, i) => ({ subject, next: { unitId: `u${i}` } })),
      entries: subjects.map((subject, i) => ({ unitId: `u${i}`, subject })),
    } });

    render(<AgendaStatusBoard kids={[{ id: 'learner1', name: 'Learner One' }]} day="2026-08-24" />);
    await waitFor(() => expect(screen.getByText('0 of 6')).toBeTruthy());

    const board = screen.getByTestId('agenda-status-board');
    const rows = board.querySelectorAll('.school-status-board__cluster-row');
    expect([...rows].map((r) => r.children.length)).toEqual([1, 2, 3]);
    // Reading order survives the wrap: the first subject is still the first
    // disc a child's eye lands on.
    const discs = board.querySelectorAll('.school-status-board__disc');
    expect(discs).toHaveLength(6);
    expect(discs[0].querySelector('[role="img"]').getAttribute('aria-label'))
      .toContain('Reading');
  });

  it('a two-segment day is one row, not a pyramid', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: {
      sections: [{ subject: 'reading', next: { unitId: 'a' } }, { subject: 'math', next: { unitId: 'b' } }],
      entries: [{ unitId: 'a', subject: 'reading' }, { unitId: 'b', subject: 'math' }],
    } });
    render(<AgendaStatusBoard kids={[{ id: 'learner1', name: 'Learner One' }]} day="2026-08-24" />);
    await waitFor(() => expect(screen.getByText('0 of 2')).toBeTruthy());

    const rows = screen.getByTestId('agenda-status-board')
      .querySelectorAll('.school-status-board__cluster-row');
    expect([...rows].map((r) => r.children.length)).toEqual([2]);
  });
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/status/AgendaStatusBoard.test.jsx
```

Expected: FAIL — no `.school-status-board__cluster-row` elements.

**Step 3: Import the rule**

`AgendaStatusBoard.jsx`, extend the model import:

```javascript
import { dayStatus, summarize, ringsByLearner, triangleRows } from './agendaStatusModel.js';
```

**Step 4: Render the rows**

Replace the whole `{summary && summary.segments.length > 0 && (<> … </>)}` block (currently `AgendaStatusBoard.jsx:330-360`) with:

```jsx
              {summary && summary.segments.length > 0 && (
                // A BOWLING-PIN TRIANGLE, not a strip. The discs used to be one
                // flex row whose width divided by the count, so a busy day drew
                // a longer, flatter line and — sitting third in a vertical stack
                // under two right-aligned text lines — got pushed onto the
                // card's bottom border. Stacked, the busy day is a taller
                // pyramid and the cluster owns the card's full height.
                //
                // The rows are a VISUAL arrangement, not a structure: each is
                // role="presentation" so the discs stay one flat list to a
                // screen reader and the pyramid says nothing extra out loud.
                <div className="school-status-board__cluster" data-testid="disc-cluster">
                  {(() => {
                    let cursor = 0;
                    return triangleRows(summary.segments.length).map((width, rowIndex) => {
                      const row = summary.segments.slice(cursor, cursor + width);
                      cursor += width;
                      return (
                        <ul
                          key={`row-${rowIndex}`}
                          className="school-status-board__cluster-row"
                          role="presentation"
                        >
                          {row.map((segment, i) => (
                            <li
                              key={`${segment.unitId ?? segment.subject}-${rowIndex}-${i}`}
                              className="school-status-board__disc"
                              data-state={segment.state}
                              // Kept alongside `data-state` for anything still
                              // selecting on the boolean; the tri-state is the
                              // one to read.
                              data-done={segment.state === 'passed' ? 'true' : 'false'}
                            >
                              <Icon
                                name={iconFor(segment.subject)}
                                label={labelForSegment(segment)}
                              />
                              {segment.extraCount > 0 && (
                                <span className="school-status-board__extra" aria-hidden="true">
                                  +{segment.extraCount}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      );
                    });
                  })()}
                </div>
              )}
```

Note what went: the `style={{ '--count': … }}` and the outer fragment. Width is no longer a CSS variable's problem.

**Step 5: Update the two tests that pinned the old names**

`AgendaStatusBoard.test.jsx:410-412` — replace those three lines with:

```javascript
    const cluster = board.querySelector('.school-status-board__cluster');
    expect(cluster.querySelectorAll('.school-status-board__disc')).toHaveLength(1);
```

(The `--count` assertion goes away with the variable.)

`AgendaStatusBoard.test.jsx:439` — change the selector:

```javascript
    const segments = screen.getByTestId('agenda-status-board').querySelectorAll('.school-status-board__disc');
```

**Step 6: Run the module and verify**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/status/
```

Expected: PASS. The board is unstyled-ugly right now — Task 3 fixes that.

**Step 7: Commit**

```bash
git add frontend/src/modules/School/status/AgendaStatusBoard.jsx frontend/src/modules/School/status/AgendaStatusBoard.test.jsx
git commit -m "feat(school): the status discs stack as a triangle"
```

---

## Task 3: The cluster's geometry

**Files:**
- Modify: `frontend/src/modules/School/School.scss:2854-2929` (the `&__pills` and `&__pill` blocks)

**Step 1: Replace the two blocks**

Delete `&__pills { … }` (School.scss:2854-2859) and replace the opening of `&__pill { … }` down to its `.school-icon` rule with:

```scss
  // Discs, one per ASSIGNMENT, each wearing its subject's icon off the wall,
  // packed as a bowling-pin triangle (`triangleRows` in agendaStatusModel.js).
  //
  // This was a stretched meter, then a single flex row whose disc size divided
  // the card's width by the count — so the child with the most work got the
  // longest, flattest strip, and because the row sat third in a vertical stack
  // under two right-aligned text lines, it was pushed onto the card's bottom
  // border. As a sibling column of the readout it gets the card's whole inner
  // height, centred, and a busy day reads as a taller pyramid.
  &__cluster {
    flex: 1 1 auto; min-width: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
  }
  // ROWS NEST. Pulling each row up by 22% of a disc overlaps them the way
  // stacked pins do, so three rows cost 2.56 diameters of height rather than 3
  // — which is what keeps the disc at ~40px instead of ~32px on the 1280x800
  // Portal, and its glyph legible from the doorway.
  &__cluster-row {
    list-style: none; margin: 0; padding: 0;
    display: flex; align-items: center; justify-content: center;
    gap: var(--disc-gap);
    & + & { margin-top: calc(var(--disc) * -0.22); }
  }
  &__disc {
    // ONE DIAMETER FOR THE WHOLE BOARD, set by the three-row worst case rather
    // than by each learner's own count. A disc is a unit: it measures the same
    // on every card, so a six-assignment day visibly IS three times a
    // two-assignment day. The card's inner height is the budget; three nested
    // rows need 2.56 diameters, so the disc is that height over 2.56, capped so
    // it never outranks the avatar beside it.
    --disc-gap: clamp(0.25rem, 0.7vh, 0.4rem);
    --disc: clamp(1.6rem, 4.6vh, 2.6rem);
    flex: 0 0 auto;
    position: relative;
    width: var(--disc); aspect-ratio: 1;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%;
    background: var(--school-board-pending);
    color: var(--school-board-ink);
```

Everything from `// The subject SVGs ship at an intrinsic 1em…` down to the end of the old `&__pill` block stays as-is, but the skeleton modifier renames:

```scss
    &--skeleton {
```

stays `&--skeleton` — it is nested under `&__disc` now, so it compiles to `.school-status-board__disc--skeleton`. Nothing to change in its body.

**Step 2: Move `--disc-gap` up**

`--disc-gap` is read by `&__cluster-row`'s `gap` but declared on `&__disc`, and a custom property does not travel upward. Move both declarations onto `&__cluster` instead:

```scss
  &__cluster {
    --disc-gap: clamp(0.25rem, 0.7vh, 0.4rem);
    --disc: clamp(1.6rem, 4.6vh, 2.6rem);
    flex: 1 1 auto; min-width: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
  }
```

and delete the two `--disc*` lines from `&__disc`. Both descendants inherit them.

**Step 3: Verify**

```bash
npm run check:scss
npx vitest run --config vitest.config.mjs frontend/src/modules/School/status/
```

Expected: both PASS.

**Step 4: Commit**

```bash
git add frontend/src/modules/School/School.scss
git commit -m "style(school): the disc cluster is a nested triangle at one board-wide size"
```

---

## Task 4: The card becomes three columns

**Files:**
- Modify: `frontend/src/modules/School/School.scss:2804-2809` (`&__info`)
- Modify: `frontend/src/modules/School/status/AgendaStatusBoard.jsx` (wrap the readout)

**Step 1: Wrap the readout in the JSX**

In `AgendaStatusBoard.jsx`, the `__info` div currently holds, in order: the status/chip, the rings, the loading skeleton, and the cluster. Reorder so the cluster comes FIRST and the two readout items are wrapped:

```jsx
            <div className="school-status-board__info">
              {/* Cluster first in DOM order as well as visually: it is the
                  card's subject, and a screen reader should reach the day's
                  work before its tally. */}
              {loading && (
                <div className="school-status-board__cluster" aria-hidden="true">
                  {/* A triangle of three, not a row of three, so the card does
                      not reflow when the real count lands. */}
                  {[[0], [1, 2]].map((row, i) => (
                    <ul key={i} className="school-status-board__cluster-row" role="presentation">
                      {row.map((j) => (
                        <li key={j} className="school-status-board__disc school-status-board__disc--skeleton" />
                      ))}
                    </ul>
                  ))}
                </div>
              )}
              {/* …the cluster block from Task 2 goes here, unchanged… */}
              <div className="school-status-board__readout">
                {/* …the status / done-chip / rings markup, unchanged for now;
                    Tasks 5-7 turn them into pills… */}
              </div>
            </div>
```

Move the existing status, done-chip and rings JSX inside `__readout` verbatim. Do not change their classes yet.

**Step 2: Restyle `__info`**

Replace `School.scss:2804-2809`:

```scss
  // THREE COLUMNS: the rail (who), the disc cluster (what), the readout (how
  // much). This was a vertical stack whose first two items were right-aligned
  // text, which pushed the discs onto the card's bottom border and left the
  // card's whole middle empty. As siblings, the cluster gets the full inner
  // height and the readout keeps its own lane.
  &__info {
    flex: 1 1 auto; min-width: 0; align-self: stretch;
    display: flex; flex-direction: row; align-items: center;
    gap: clamp(0.6rem, 2vw, 1.4rem);
  }
  &__readout {
    flex: 0 0 auto; margin-left: auto;
    display: flex; flex-direction: column; align-items: flex-end;
    gap: clamp(0.35rem, 1vh, 0.6rem);
  }
```

**Step 3: Drop the stale `align-self` rules**

`&__status` (School.scss:2952), `&__done-chip` (:2962) and `&__rings` (:2977) each carry `align-self: flex-end; flex: 0 0 auto;` — that was how they right-aligned inside the old column. `__readout` now owns the alignment. Delete `align-self: flex-end;` from all three; keep `flex: 0 0 auto;`.

**Step 4: Verify**

```bash
npm run check:scss
npx vitest run --config vitest.config.mjs frontend/src/modules/School/status/
```

Expected: both PASS. The non-interactive assertion at `AgendaStatusBoard.test.jsx:322` must still hold — if it fails, something in the wrap introduced a button.

**Step 5: Commit**

```bash
git add frontend/src/modules/School/School.scss frontend/src/modules/School/status/AgendaStatusBoard.jsx
git commit -m "feat(school): the status card is rail, cluster and readout side by side"
```

---

## Task 5: The work pill's markup

**Files:**
- Modify: `frontend/src/modules/School/status/AgendaStatusBoard.jsx` (inside `__readout`)
- Modify: `frontend/src/modules/School/status/AgendaStatusBoard.test.jsx`

**Step 1: Write the failing test**

```javascript
  it('the work pill carries one notch per assignment, in the discs\' own states', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [
      { learnerId: 'learner1', sessions: [
        { unitId: 'a', subject: 'math', outcome: { result: 'passed' } },
        { unitId: 'b', subject: 'math', outcome: { result: 'needs_remediation' } },
      ] },
    ] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: {
      sections: [{ subject: 'math' }, { subject: 'reading', next: { unitId: 'c' } }],
      entries: [{ unitId: 'c', subject: 'reading' }],
    } });
    render(<AgendaStatusBoard kids={[{ id: 'learner1', name: 'Learner One' }]} day="2026-08-24" />);
    await waitFor(() => expect(screen.getByText('1 of 3')).toBeTruthy());

    const board = screen.getByTestId('agenda-status-board');
    const notches = board.querySelectorAll('.school-status-board__notch');
    expect(notches).toHaveLength(3);
    // The pill and the triangle read the same segments in the same order, so
    // they can never disagree about a child's day.
    const discStates = [...board.querySelectorAll('.school-status-board__disc')]
      .map((el) => el.dataset.state);
    expect([...notches].map((el) => el.dataset.state)).toEqual(discStates);
    // The notches say nothing out loud — the fraction beside them is the number.
    expect(board.querySelector('.school-status-board__work-pill').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('1 of 3')).toHaveClass('school-status-board__fraction');
  });

  it('a cleared day replaces the fraction with a word and the notches with one fill', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [
      { learnerId: 'learner1', sessions: [{ unitId: 'a', subject: 'math', outcome: { result: 'passed' } }] },
    ] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: {
      sections: [{ subject: 'math' }], entries: [],
    } });
    render(<AgendaStatusBoard kids={[{ id: 'learner1', name: 'Learner One' }]} day="2026-08-24" />);
    await waitFor(() => expect(screen.getByText('Done for the day')).toBeTruthy());

    const board = screen.getByTestId('agenda-status-board');
    // Green is a convention a child must be taught; the word is not.
    expect(board.querySelector('.school-status-board__work-pill')).toHaveAttribute('data-complete', 'true');
    expect(board.querySelectorAll('.school-status-board__notch')).toHaveLength(0);
  });
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/status/AgendaStatusBoard.test.jsx
```

Expected: FAIL — no `.school-status-board__notch`.

**Step 3: Replace the status markup inside `__readout`**

```jsx
                {loading ? (
                  // An EMPTY track, no notches. A notch count is a claim we do
                  // not have yet, and a wrong one would flicker to a different
                  // one the moment the plan lands.
                  <span className="school-status-board__work-pill" data-skeleton="true" aria-hidden="true" />
                ) : summary && summary.total > 0 ? (
                  <span className="school-status-board__work-line">
                    <span
                      className="school-status-board__work-pill"
                      data-complete={summary.done >= summary.total ? 'true' : 'false'}
                      // The fraction beside it already carries the number.
                      // Announcing six notches as well is noise.
                      aria-hidden="true"
                    >
                      {summary.done < summary.total && summary.segments.map((segment, i) => (
                        <span
                          key={`${segment.unitId ?? segment.subject}-notch-${i}`}
                          className="school-status-board__notch"
                          data-state={segment.state}
                        />
                      ))}
                    </span>
                    <span className="school-status-board__fraction">
                      {summary.done >= summary.total
                        ? 'Done for the day'
                        : `${summary.done} of ${summary.total}`}
                    </span>
                  </span>
                ) : (
                  <span className="school-status-board__status school-status-board__status--none">No plan to show</span>
                )}
```

The `__done-chip` element goes away — the completed message now rides the fraction slot, and the pill's `data-complete` carries the fill. Task 7 restyles `__fraction` to take over the chip's look at 100%.

**Step 4: Run it and watch it pass**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/status/AgendaStatusBoard.test.jsx
```

Expected: PASS. The pre-existing test at `AgendaStatusBoard.test.jsx:415` asserts `screen.getByText('Done for the day')` — that still passes, because the fraction says it.

**Step 5: Commit**

```bash
git add frontend/src/modules/School/status/AgendaStatusBoard.jsx frontend/src/modules/School/status/AgendaStatusBoard.test.jsx
git commit -m "feat(school): the day's tally becomes a notched pill"
```

---

## Task 6: The work pill's styling

**Files:**
- Modify: `frontend/src/modules/School/School.scss` (replace `&__status`/`&__done-chip` at :2952-2975)

**Step 1: Replace both blocks**

```scss
  &__work-line { display: flex; align-items: center; gap: 0.5em; }
  // A TRACK OF NOTCHES, one per assignment, in the discs' own order and the
  // discs' own colours — so the pill and the triangle can never disagree.
  //
  // Notch sizing has two bounds and the pill sizes itself between them: never
  // narrower than 6px (below that a notch is a smudge at arm's length), never
  // wider than 14px (above that a two-assignment day looks like a loading bar).
  // The count drives the width; a nine-assignment day is a wider pill, which
  // the freed card width now affords.
  &__work-pill {
    flex: 0 0 auto;
    display: flex; align-items: stretch;
    gap: 2px; padding: 3px;
    min-width: 4.5rem; height: clamp(1.1rem, 2.6vh, 1.5rem);
    border-radius: 999px;
    background: color-mix(in srgb, var(--school-board-ink) 14%, transparent);
    box-sizing: border-box;
  }
  &__notch {
    flex: 1 1 auto;
    min-width: 6px; max-width: 14px;
    border-radius: 999px;
    background: var(--school-board-pending);
    &[data-state='passed'] { background: var(--school-board-done); }
    &[data-state='needs-retry'], &[data-state='in-progress'] { background: var(--school-board-retry); }
  }
  // AT 100% THE TRACK GOES SOLID. No dividers: the day is one thing now, and
  // the notches were only ever there to say how much of it was left.
  &__work-pill[data-complete='true'] { background: var(--school-board-done); }
  // In flight: an empty track. It holds the readout's width so the card does
  // not reflow when the plan lands.
  &__work-pill[data-skeleton='true'] { opacity: 0.35; }

  &__fraction {
    flex: 0 0 auto;
    font-size: clamp(0.85rem, 2vh, 1.1rem); font-weight: 700;
    opacity: 0.75; text-transform: uppercase; letter-spacing: 0.05em;
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  // The completed message inherits the chip's look, because green is a
  // convention a child has to be taught and a word is not.
  &__row[data-complete='true'] &__fraction {
    padding: 0.2em 0.7em; border-radius: 999px;
    background: var(--school-board-done); color: var(--school-board-done-ink);
    opacity: 1; font-weight: 800; letter-spacing: 0.04em; line-height: 1.3;
  }
  &__status--none {
    flex: 0 0 auto;
    font-size: clamp(0.85rem, 2vh, 1.1rem); font-weight: 600; opacity: 0.5;
  }
```

**Step 2: Fix the two rules that referenced the deleted classes**

- `School.scss:2951` — `&__row.is-loading .school-status-board__status { opacity: 0.3; }` now has no target. Delete it; the pill's own `data-skeleton` handles it.
- `School.scss:3003` (inside `&__row[data-complete='true']`) — `.school-status-board__status { color: …; opacity: 1; }` likewise. Delete it; the `&__fraction` rule above covers it.

**Step 3: Verify**

```bash
npm run check:scss
grep -n "school-status-board__status\b" frontend/src/modules/School/School.scss
```

Expected: SCSS compiles; the only remaining `__status` hit is `&__status--none`.

**Step 4: Commit**

```bash
git add frontend/src/modules/School/School.scss
git commit -m "style(school): the work pill fills by notch, and solid when the day is cleared"
```

---

## Task 7: The rings pill

**Files:**
- Modify: `frontend/src/modules/School/status/AgendaStatusBoard.jsx` (the rings span)
- Modify: `frontend/src/modules/School/School.scss:2977-2984`

**Step 1: Rename in the JSX**

```jsx
              {Number.isFinite(rings[kid.id]) && (
                <span className="school-status-board__rings-pill" title="Rings this week">
                  <RingIcon size="1.1em" label={`${rings[kid.id]} rings this week`} />
                  <span className="school-status-board__rings-count">{rings[kid.id]}</span>
                </span>
              )}
```

**Step 2: Restyle**

Replace `School.scss:2977-2984`:

```scss
  // RINGS THIS WEEK, as the work pill's twin: same height, same radius, so the
  // readout reads as one column rather than two loose scraps.
  //
  // NO FILL, deliberately. Rings are a quantity, not progress toward anything
  // this board knows about; a filled track would imply a target we do not have.
  &__rings-pill {
    flex: 0 0 auto;
    display: flex; align-items: center; gap: 0.35em;
    padding: 0 0.6em;
    height: clamp(1.1rem, 2.6vh, 1.5rem);
    border-radius: 999px;
    background: color-mix(in srgb, var(--school-board-ink) 10%, transparent);
    font-size: clamp(0.8rem, 1.8vh, 1rem); font-weight: 700;
    color: var(--school-muted);
    line-height: 1;
  }
  &__rings-count { font-variant-numeric: tabular-nums; }
```

**Step 3: Verify**

```bash
npm run check:scss
npx vitest run --config vitest.config.mjs frontend/src/modules/School/status/
```

Expected: both PASS. If a ring test selects `.school-status-board__rings`, update it to `__rings-pill`:

```bash
grep -n "school-status-board__rings\b" frontend/src/modules/School/status/AgendaStatusBoard.test.jsx
```

**Step 4: Commit**

```bash
git add frontend/src/modules/School/School.scss frontend/src/modules/School/status/AgendaStatusBoard.jsx
git commit -m "style(school): the ring count becomes the work pill's twin"
```

---

## Task 8: Prove the loading card does not reflow

**Files:**
- Modify: `frontend/src/modules/School/status/AgendaStatusBoard.test.jsx`

**Step 1: Write the test**

```javascript
  it('the skeleton is a triangle, so the card does not reshape when the plan lands', async () => {
    schoolApi.teacherDay.mockReturnValue(new Promise(() => {})); // never settles
    schoolApi.agendaPreview.mockReturnValue(new Promise(() => {}));
    render(<AgendaStatusBoard kids={[{ id: 'learner1', name: 'Learner One' }]} day="2026-08-24" />);

    const board = screen.getByTestId('agenda-status-board');
    await waitFor(() => expect(board.querySelector('.school-status-board__disc--skeleton')).toBeTruthy());
    const rows = board.querySelectorAll('.school-status-board__cluster-row');
    expect([...rows].map((r) => r.children.length)).toEqual([1, 2]);
    // An empty track: a notch count is a claim we do not have yet.
    expect(board.querySelector('[data-skeleton="true"]')).toBeTruthy();
    expect(board.querySelectorAll('.school-status-board__notch')).toHaveLength(0);
  });
```

**Step 2: Run it**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/status/AgendaStatusBoard.test.jsx
```

Expected: PASS on the first run — Tasks 4 and 5 already built this. If it fails, the skeleton block in Task 4 Step 1 was not applied.

**Step 3: Commit**

```bash
git add frontend/src/modules/School/status/AgendaStatusBoard.test.jsx
git commit -m "test(school): pin the status skeleton's shape to the loaded card's"
```

---

## Task 9: Sweep the renamed selectors

**Files:** wherever the grep lands.

**Step 1: Find every stale reference**

```bash
grep -rn "school-status-board__pill\|school-status-board__status\b\|school-status-board__done-chip\|school-status-board__rings\b\|--count" \
  frontend/src backend/src docs
```

**Step 2: Fix what it finds**

Expected leftovers: possibly the teacher console or a runbook screenshot caption. Update selectors to the new names; leave prose describing the *old* design alone in `_archive/`.

`--count` must return **zero** hits inside `School.scss`'s status-board block and zero in `AgendaStatusBoard.jsx`. A hit anywhere else (the piano tile grid uses its own `--tile-cols`) is unrelated.

**Step 3: Verify**

```bash
npm run check:scss
npm run test:isolated -- --only=frontend
```

**Step 4: Commit**

```bash
git commit -am "refactor(school): finish the disc/pill rename"
```

---

## Task 10: Update the docs

**Files:**
- Modify: `docs/reference/school/agenda-and-completion.md` (whichever section describes the board)

**Step 1: Find the section**

```bash
grep -rn "status board\|disc\|Today board" docs/reference/school/*.md | head -20
```

**Step 2: Record what changed**

The board's description needs three sentences it does not have: the discs pack as a triangle capped at three rows; a disc is one size board-wide, so a busy day is a taller pyramid rather than a longer strip; the tally is a notched pill whose notches carry the same states as the discs and which goes solid with a word at 100%.

Do not restate the design doc — link it:

```markdown
See [the triangle redesign](../../_wip/plans/2026-09-09-status-board-triangle-design.md)
for the packing rule and the sizing arithmetic.
```

**Step 3: Commit**

```bash
git add docs/reference/school/
git commit -m "docs(school): record the status board's triangle and pills"
```

---

## Task 11: The gate

**Step 1: Full colocated sweep**

```bash
npm run test:isolated -- --only=frontend
```

Expected: PASS. Record the count; a drop means a file stopped being collected.

**Step 2: SCSS and parse**

```bash
npm run check:scss
npm run check:parse
```

**Step 3: Commit if anything moved**

---

## Task 12: Eyes on it — NOT optional

jsdom has no layout engine. Nothing in Tasks 1-11 proves a single pixel of this design. Per `feedback_screenshots_over_code_agents_for_ui_triage`, ask KC for a screenshot of the live Portal board with all four learners.

Check against the design:

| Claim | Look for |
|---|---|
| Discs no longer crowd the bottom | Even space above and below the cluster |
| Triangle packing | A 3-assignment card is 1-over-2; a 6-assignment card is 1-2-3 |
| Rows nest | Rows overlap slightly — not a loose stack of separate lines |
| One diameter board-wide | A disc on the lightest card measures the same as one on the busiest |
| Readout is one column | Work pill and rings pill same height, same radius, right-aligned |
| Notches legible | A 6-notch pill's individual notches are distinguishable at arm's length |
| Cleared day | Solid green track and the word, no dividers |

**The one to watch.** The design accepts that the disc falls from ~64px to ~40px and its glyph from ~37px to ~23px. If 23px turns out to be unreadable from the doorway, do **not** patch it by shrinking the rail or the readout. The two honest fixes are:

1. **Cap at two rows** — `MAX_TRIANGLE_ROWS = 2` in `agendaStatusModel.js`. Six becomes `[3,3]`, nine becomes `[4,5]`. It stops being a triangle but the disc returns to ~55px. One-line change, one test table to update.
2. **Taller cards** — the pane now also carries the book door (`.school-book-door`, added by the deployed tree); if the board can have more of the pane, the disc grows without changing the packing.

Take the result back to KC before choosing; this is a taste call, not an engineering one.

**Step 4: Push only after KC has seen it**

```bash
git log --oneline origin/main..HEAD
git push origin HEAD
```

---

## Out of scope, deliberately

- **The rail.** Avatar and straddling nameplate are untouched.
- **Motion.** No entry animation, no fill transition, no cleared-card glow. Settled 2026-08-26.
- **The `+N` badge.** Per-assignment evidence stays on the assignment.
- **Refresh paths.** `omr`, `school` and `state-gates` subscriptions are not touched; if a disc stops turning green on a scan, the cause is in this plan's rendering, not in those.
- **Interactivity.** The board takes no taps. `AgendaStatusBoard.test.jsx:322` guards it.
