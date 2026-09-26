# Health Exercise Rows — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make each workout on Health → Today a compact, food-shaped row in the right-hand column under Snacks. A small poster, the title, and one truncated line (the voice memo, or the description when there is no memo) sit on the left. Minutes go in the portion track and a prominent calorie credit goes in the kcal track. Everything else moves to a hover card, and clicking the row opens the fitness session.

**Architecture:** `ExerciseSection.jsx` renders the rows. Today each row is a full-width, four-line block with its own grid and a "View session" link. After the rewrite, the row lays its cells on the shared `--health-meal-tracks` grid, the same list of columns food rows and meal headers use, so its minutes and kcal line up with the food columns above. The detail card reuses the page's single `RowPreviewProvider` card (`RowPreview.jsx`). That card only knows how to draw food today, so it gains a way to show caller-supplied content. `LogTable.jsx` moves the section out of the full-width slot and into the late column.

**Tech Stack:** React (JSX), SCSS, Vitest + Testing Library (jsdom), `@tabler/icons-react`.

---

## What the user asked for (the spec)

From the 2026-09-25 request, restated and confirmed:

1. **Half width.** Exercise sits in one meal column, like a food item, not across the page.
2. **One row per workout, two lines at most.** The second line exists only because the poster is taller than one line.
3. **Row content:** poster, title, then one truncated line holding the voice memo. The description shows **only when there is no voice memo**.
4. **Calories:** more prominent than now, and in the same column as the food kcal values.
5. **Start time, minutes and heart rate** do not get their own line. Minutes fits the portion track (a food row shows "335 g" there; a workout shows "39 min"). Start time and HR go to the hover card.
6. **No "View session" link.** Clicking the row opens the session.
7. **Hover card** with the full detail: poster, title, time, minutes, avg HR, kcal (with "est." when estimated), every voice memo in full, and the description.

Decisions made while planning, beyond the request:

- **Placement:** the late column, after Snacks. That column is the shorter one on most days (see the screenshot: empty space under Snacks). On a phone the log is one column, so Exercise still ends up last.
- **Touch:** food rows open their card when you tap the artwork (`onArtworkClick` in `RowPreview.jsx`). Exercise does the same: on a coarse pointer, tapping the **poster** toggles the card, and tapping anywhere else on the row opens the session. This matches food rows and avoids a two-tap state machine.

## Background the engineer needs

### Files

| File | Role |
|---|---|
| `frontend/src/modules/Health/today/ExerciseSection.jsx` | The section and its rows. Fetches `api/v1/fitness/sessions?date=` for posters, memos and session links. The **calorie credit comes from the nutrition workout ledger** (`sessions` prop), never from the fitness API. Keep that split. |
| `frontend/src/modules/Health/today/ExerciseSection.test.jsx` | Its tests. Several assertions change (the link name, removal of the bpm text from the row). |
| `frontend/src/modules/Health/today/RowPreview.jsx` | The page's ONE hover card. `RowPreviewProvider` owns the card; a row calls `useRowPreview({ content })` and spreads `targetProps` (hover), `focusProps` (keyboard) and `onArtworkClick` (touch). |
| `frontend/src/modules/Health/today/RowPreview.test.jsx` | Its tests. |
| `frontend/src/modules/Health/today/LogTable.jsx` | Lays out the day. `EARLY_COLUMN` = Breakfast, Lunch; `LATE_COLUMN` = Dinner, Snacks. Exercise currently renders in `.health-log__wide` (spans both columns). |
| `frontend/src/modules/Health/today/LogTable.test.jsx` | Has a test pinning each column's `h4` headings. It will now see Exercise in the late column. |
| `frontend/src/modules/Health/health.scss` | `.health-meal` defines `--health-meal-tracks`: `20px minmax(0,1fr) 2rem 2rem 2rem 4.5rem 3.8rem 62px` (phone override inside `@include bp.mobile-only`). Tracks: 1 = density badge, 2 = name, 3–5 = P/C/F, 6 = portion, 7 = kcal, 8 = ✓/✕. `.health-exercise` block is at ~line 706. |
| `frontend/src/modules/Health/today/layout.contract.test.js` | Reads the compiled stylesheet and pins layout facts jsdom cannot see. |
| `docs/reference/health/README.md` | Reference doc; "Column and sidebar" (~line 707) describes the log layout. |

### The workout shapes

`sessions` prop items (nutrition ledger): `{ id, title?, type?, calories, minutes? | duration_min?, startTime?, avgHeartrate?, estimated?, homeSessionId? }`.

`linked` (fitness API day index entry): `{ sessionId, voiceMemos?: [{ transcript }], media?: { primary }, segments?: [{ sessionId, media: { primary } }] }`, where `primary` = `{ grandparentId, showTitle, description }`.

### `--health-name-inset`

`LogTable` measures where food names start and sets `--health-name-inset` on `.health-log`. The exercise identity cell pads its left edge so the **title** starts at that same x (poster to its left). `calc()` clamps a negative padding to 0, so no `max()` is needed.

### Running tests

```bash
npx vitest run frontend/src/modules/Health/today/ExerciseSection.test.jsx
npx vitest run frontend/src/modules/Health/today/        # whole Today folder
```

Baseline before starting: `ExerciseSection.test.jsx` + `RowPreview.test.jsx` = 22 passing.

### Logging

Use the existing `logger` (`createAppLogger('health').child('exercise')`). Keep `session_open` (info) and `poster_unavailable` (debug). Add `preview_open` via `logger.sampled(..., { maxPerMinute: 20 })`. No raw `console.*`.

---

### Task 0: Worktree

**Step 1:** Sync first (CLAUDE.local.md): `git fetch origin && git log --oneline HEAD..origin/main`, then check the homeserver tree for unpushed work: `ssh homeserver.local 'cd /opt/Code/DaylightStation && git log --oneline origin/main..HEAD | head'`. Integrate anything found.

**Step 2:** Create a worktree, using @superpowers:using-git-worktrees:

```bash
git worktree add ../DaylightStation-exercise-rows -b feature/health-exercise-rows
cd ../DaylightStation-exercise-rows
```

**Step 3:** Confirm the baseline: `npx vitest run frontend/src/modules/Health/today/` passes.

---

### Task 1: The preview card accepts caller-supplied content

**Files:**
- Modify: `frontend/src/modules/Health/today/RowPreview.jsx`
- Test: `frontend/src/modules/Health/today/RowPreview.test.jsx`

**Step 1: Write the failing tests**

Add to `RowPreview.test.jsx` (the file already mocks the logger and wraps in `.ds-root` via `r()`). Add `useRowPreview` to the existing import from `./RowPreview.jsx`:

```jsx
describe('custom card content', () => {
  afterEach(cleanup);
  const custom = { node: <p>Workout detail</p> };
  function Target({ toggle = false }) {
    const preview = useRowPreview({ content: custom });
    return <span data-testid="target" data-row-preview-toggle={toggle ? '' : undefined}
      {...preview.targetProps} onClick={preview.onArtworkClick}>target</span>;
  }

  it('draws a row-supplied node instead of the food card', () => {
    r(<RowPreviewProvider><Target /></RowPreviewProvider>);
    fireEvent.pointerEnter(screen.getByTestId('target'), { clientX: 10, clientY: 200 });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Workout detail');
    expect(document.querySelector('.health-row-preview__hero')).toBeNull();
  });

  it('a tap on a [data-row-preview-toggle] element does not close its own card first', () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: true }); // coarse pointer
    try {
      r(<RowPreviewProvider><Target toggle /></RowPreviewProvider>);
      const target = screen.getByTestId('target');
      fireEvent.pointerDown(target);
      fireEvent.click(target);
      expect(screen.getByRole('tooltip')).toHaveTextContent('Workout detail');
      fireEvent.pointerDown(target);
      fireEvent.click(target);
      expect(screen.queryByRole('tooltip')).toBeNull();
    } finally { window.matchMedia = matchMedia; }
  });
});
```

**Step 2: Run them to verify they fail**

Run: `npx vitest run frontend/src/modules/Health/today/RowPreview.test.jsx`
Expected: first test FAILS (the card renders `RowPreviewContent`, and `row` is undefined, so it throws or lacks the text). The second test fails because the document `pointerdown` listener only exempts `.health-row-artwork`, so the second tap closes and then reopens.

**Step 3: Implement**

In `RowPreviewProvider`'s portal, render the node when one was supplied:

```jsx
    {shown && host ? createPortal(<div ref={cardRef} className="health-row-preview__card" role="tooltip" data-position="top">
      {shown.node ?? <RowPreviewContent row={shown.row} isGroup={shown.isGroup} kcal={shown.kcal} />}
    </div>, host) : null}
```

Widen the tap-elsewhere exemption:

```jsx
    const onDown = event => { if (!event.target?.closest?.('.health-row-artwork, [data-row-preview-toggle]')) close(); };
```

Update the header comment's first paragraph to say a row may pass its own `node` (the exercise rows do), and update the `shown` shape comment: `// { owner, row, isGroup, kcal } or { owner, node }`.

**Step 4: Run to verify they pass**

Run: `npx vitest run frontend/src/modules/Health/today/RowPreview.test.jsx`
Expected: all PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Health/today/RowPreview.jsx frontend/src/modules/Health/today/RowPreview.test.jsx
git commit -m "feat(health): row preview card can show caller-supplied content"
```

---

### Task 2: Rewrite the exercise tests for the compact row

**Files:**
- Modify: `frontend/src/modules/Health/today/ExerciseSection.test.jsx`

**Step 1: Replace the test file's body** (keep the imports and mocks, and add `RowPreviewProvider`):

```jsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ExerciseSection } from './ExerciseSection.jsx';
import { RowPreviewProvider } from './RowPreview.jsx';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';

const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => api(...args),
  ContentDisplayUrl: id => `/api/v1/display/${id}`,
}));
const workout = { id: 'activity', title: 'Circuit', homeSessionId: 'segment-1', calories: 347.4, minutes: 44.3, avgHeartrate: 121.1, startTime: '01:20 pm' };
const linked = { sessionId: 'group-1', segments: [{ sessionId: 'segment-1', media: { primary: { grandparentId: 'plex:42', showTitle: 'Program', description: 'Build bigger arms.' } } }] };
const withMemo = { ...linked, voiceMemos: [{ transcript: 'I put in the work.' }, { transcript: 'Sore tomorrow.' }, { transcript: '  ' }] };
const show = sessions => render(<MantineProvider><div className="ds-root"><RowPreviewProvider>
  <ExerciseSection date="2026-09-05" sessions={sessions} /></RowPreviewProvider></div></MantineProvider>);
const row = () => document.querySelector('.health-exercise');
const hover = () => fireEvent.pointerEnter(row(), { clientX: 20, clientY: 300 });

beforeEach(() => { api.mockReset(); resetApiResourceCache(); });

describe('exercise row', () => {
  it('is one link to the session: poster, title, minutes and the ledger credit', async () => {
    api.mockResolvedValue({ sessions: [linked, { sessionId: 'unrelated', calories: 1000 }] });
    show([workout]);
    const link = await screen.findByRole('link', { name: /Circuit/ });
    expect(link).toHaveAttribute('href', '/fitness/home/session-group-1');
    expect(link).toBe(row());
    expect(screen.getByAltText('Program poster')).toHaveAttribute('src', '/api/v1/display/plex:42');
    expect(row().querySelector('.health-exercise__minutes')).toHaveTextContent('44 min');
    expect(row().querySelector('.health-exercise__kcal')).toHaveTextContent('+347 kcal');
    expect(screen.queryByText(/View session/)).toBeNull();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('keeps start time and heart rate off the row', async () => {
    api.mockResolvedValue({ sessions: [linked] });
    show([workout]);
    await screen.findByRole('link');
    expect(row()).not.toHaveTextContent('bpm');
    expect(row()).not.toHaveTextContent('01:20 pm');
  });

  it('shows the first voice memo and hides the description when there is one', async () => {
    api.mockResolvedValue({ sessions: [withMemo] });
    show([workout]);
    expect(await screen.findByText('“I put in the work.”')).toHaveClass('health-exercise__memo');
    expect(row().querySelectorAll('.health-exercise__memo')).toHaveLength(1);
    expect(row()).not.toHaveTextContent('Build bigger arms.');
  });

  it('falls back to the description when there is no voice memo', async () => {
    api.mockResolvedValue({ sessions: [linked] });
    show([workout]);
    expect(await screen.findByText('Build bigger arms.')).toHaveClass('health-exercise__description');
    expect(row().querySelector('.health-exercise__memo')).toBeNull();
  });

  it('hovering opens a card with everything the row leaves out', async () => {
    api.mockResolvedValue({ sessions: [withMemo] });
    show([workout]);
    await screen.findByRole('link');
    hover();
    const card = screen.getByRole('tooltip');
    expect(card).toHaveTextContent('Circuit');
    expect(card).toHaveTextContent('01:20 pm');
    expect(card).toHaveTextContent('44 min');
    expect(card).toHaveTextContent('121 bpm avg');
    expect(card).toHaveTextContent('+347 kcal');
    expect(card).toHaveTextContent('“I put in the work.”');
    expect(card).toHaveTextContent('“Sore tomorrow.”');
    expect(card).toHaveTextContent('Build bigger arms.');
    fireEvent.pointerLeave(row());
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('on a touch screen, tapping the poster toggles the card instead of navigating', async () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: true });
    try {
      api.mockResolvedValue({ sessions: [linked] });
      show([workout]);
      await screen.findByRole('link');
      const poster = row().querySelector('.health-exercise__art');
      fireEvent.pointerDown(poster);
      expect(fireEvent.click(poster)).toBe(false); // default (navigation) prevented
      expect(screen.getByRole('tooltip')).toHaveTextContent('Circuit');
    } finally { window.matchMedia = matchMedia; }
  });

  it('drops a broken poster for the barbell and keeps the link', async () => {
    api.mockResolvedValue({ sessions: [linked] });
    show([workout]);
    fireEvent.error(await screen.findByAltText('Program poster'));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('link')).toBeTruthy();
  });

  it('marks a heart-rate estimate (home session not on Strava yet)', async () => {
    api.mockResolvedValue({ sessions: [{ sessionId: 'home-1' }] });
    show([{ id: 'home-home-1', source: 'home', estimated: true, homeSessionId: 'home-1', title: 'Game Cycling', calories: 179, minutes: 20.55 }]);
    const kcal = row().querySelector('.health-exercise__kcal');
    expect(kcal).toHaveTextContent('+~179 kcal');
    expect(kcal).toHaveAttribute('title', 'Estimated from heart rate; not on Strava yet');
    expect(await screen.findByRole('link', { name: /Game Cycling/ })).toHaveAttribute('href', '/fitness/home/session-home-1');
    hover();
    expect(screen.getByRole('tooltip')).toHaveTextContent('+~179 kcal est.');
  });

  it('leaves an unmatched workout readable without an invented session link', async () => {
    api.mockResolvedValue({ sessions: [{ sessionId: 'unrelated' }] });
    show([workout]);
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Circuit')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('does not fetch session details for an ordinary outdoor activity', () => {
    show([{ title: 'Run', calories: 250 }]);
    expect(api).not.toHaveBeenCalled();
    expect(screen.getByText('Run')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('keeps the workout visible when enrichment fails and supports retry', async () => {
    api.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ sessions: [linked] });
    show([workout]);
    fireEvent.click(await screen.findByRole('button', { name: /Workout details unavailable/ }));
    expect(screen.getByText('Circuit')).toBeTruthy();
    expect(await screen.findByRole('link')).toHaveAttribute('href', '/fitness/home/session-group-1');
  });

  it('puts the section subtotal in the header-right cluster, like a meal', () => {
    show([{ title: 'Run', calories: 250 }, { title: 'Walk', calories: 61 }]);
    expect(document.querySelector('.health-meal__header-right .health-meal__kcal')).toHaveTextContent('+311 kcal');
  });
});
```

**Step 2: Run to verify they fail**

Run: `npx vitest run frontend/src/modules/Health/today/ExerciseSection.test.jsx`
Expected: most FAIL. Examples: `link` is the "View session" anchor, not the row; there is no `.health-exercise__minutes`; the description renders alongside the memo; no tooltip on hover. The three unchanged cases (unmatched, outdoor, retry) may still pass.

**Step 3: Commit the red tests**

```bash
git add frontend/src/modules/Health/today/ExerciseSection.test.jsx
git commit -m "test(health): exercise row spec — compact, linked, hover card"
```

---

### Task 3: Implement the compact row and its card

**Files:**
- Modify: `frontend/src/modules/Health/today/ExerciseSection.jsx`

**Step 1: Replace the file** with:

```jsx
import { useMemo, useState } from 'react';
import { UnstyledButton } from '@mantine/core';
import { IconBarbell, IconMicrophone } from '@tabler/icons-react';
import { ContentDisplayUrl } from '../../../lib/api.mjs';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { sumCounted } from '@shared-contracts/nutrition/countedRows.mjs';
import { isCoarsePointer, useRowPreview } from './RowPreview.jsx';

const logger = createAppLogger('health').child('exercise');

const ESTIMATE_NOTE = 'Estimated from heart rate; not on Strava yet';
const credit = workout => `+${workout.estimated ? '~' : ''}${Math.round(workout.calories || 0)}`;

// The card behind a row: everything the row leaves out.
function ExercisePreviewContent({ workout, title, minutes, poster, memos, description }) {
  return <div className="health-row-preview health-exercise-preview">
    <div className="health-row-preview__hero health-exercise-preview__hero">
      {poster ? <img src={poster} alt="" decoding="async" /> : <IconBarbell size={32} aria-hidden="true" />}
    </div>
    <div className="health-row-preview__body">
      <p className="health-row-preview__title">{title}</p>
      <p className="health-row-preview__facts">
        {workout.startTime ? <span>{workout.startTime}</span> : null}
        {minutes > 0 ? <span>{Math.round(minutes)} min</span> : null}
        {workout.avgHeartrate > 0 ? <span>{Math.round(workout.avgHeartrate)} bpm avg</span> : null}
        <span className="health-row-preview__kcal">{credit(workout)} kcal{workout.estimated ? ' est.' : ''}</span>
      </p>
      {memos.map((text, index) => <p key={index} className="health-exercise-preview__memo">
        <IconMicrophone size={13} aria-label="Voice memo" />“{text}”</p>)}
      {description ? <p className="health-exercise-preview__description">{description}</p> : null}
    </div>
  </div>;
}

// A workout reads like a food row: poster and name on the left, minutes in the
// portion track, the credit in the kcal track. The whole row opens the session.
function ExerciseRow({ workout, linked }) {
  const [brokenPoster, setBrokenPoster] = useState(null);
  const segment = linked?.segments?.find(item => String(item.sessionId) === String(workout.homeSessionId));
  const media = segment?.media?.primary || linked?.media?.primary;
  const posterUrl = media?.grandparentId ? ContentDisplayUrl(media.grandparentId) : null;
  const poster = posterUrl && brokenPoster !== posterUrl ? posterUrl : null;
  const title = workout.title || workout.type || 'Workout';
  const minutes = workout.minutes ?? workout.duration_min;
  const href = linked ? `/fitness/home/session-${encodeURIComponent(linked.sessionId)}` : null;
  // What was said after the workout; the episode blurb only stands in when nothing was.
  const memos = useMemo(() => (linked?.voiceMemos || []).map(memo => memo?.transcript?.trim()).filter(Boolean), [linked]);
  const description = media?.description || null;
  const content = useMemo(() => ({
    node: <ExercisePreviewContent workout={workout} title={title} minutes={minutes} poster={poster} memos={memos} description={description} />,
  }), [workout, title, minutes, poster, memos, description]);
  const preview = useRowPreview({ content,
    onOpen: () => logger.sampled('preview_open', { sessionId: linked?.sessionId ?? null }, { maxPerMinute: 20 }) });

  const onPosterClick = event => {
    if (!isCoarsePointer()) return;
    event.preventDefault();
    event.stopPropagation();
    preview.onArtworkClick(event);
  };
  const Row = href ? 'a' : 'div';
  const linkProps = href ? { href, ...preview.focusProps,
    onClick: () => logger.info('session_open', { sessionId: linked.sessionId }) } : {};
  return <Row className="health-exercise" {...linkProps} {...preview.targetProps}>
    <span className="health-exercise__identity">
      <span className="health-exercise__art" data-row-preview-toggle="" onClick={onPosterClick}>
        {poster ? <img src={poster} alt={media.showTitle ? `${media.showTitle} poster` : 'Workout program poster'} loading="lazy"
          onError={() => { setBrokenPoster(poster); logger.debug('poster_unavailable', { sessionId: linked.sessionId }); }} />
          : <IconBarbell size={18} aria-hidden="true" />}
      </span>
      <span className="health-exercise__text">
        <span className="health-exercise__title">{title}</span>
        {memos[0] ? <span className="health-exercise__memo"><IconMicrophone size={12} aria-label="Voice memo" />“{memos[0]}”</span>
          : description ? <span className="health-exercise__description">{description}</span> : null}
      </span>
    </span>
    <span className="health-exercise__minutes">{minutes > 0 ? `${Math.round(minutes)} min` : ''}</span>
    <span className="health-row__kcal health-exercise__kcal" title={workout.estimated ? ESTIMATE_NOTE : undefined}>
      {credit(workout)}<small> kcal</small></span>
  </Row>;
}

export function ExerciseSection({ date, sessions }) {
  // One lightweight day index supplies verified links and program artwork.
  // Nutrition's workout ledger remains the authority for calorie credit.
  const needsLinks = date && sessions.some(workout => workout.homeSessionId);
  const details = useApiResource(needsLinks ? `api/v1/fitness/sessions?date=${encodeURIComponent(date)}` : null,
    { swr: true, label: 'Workout details', logger });
  const homeSessions = details.data?.sessions || [];
  return <section className="health-meal health-meal--exercise">
    <header className="health-meal__header">
      <h4 className="health-meal__label">Exercise</h4>
      <span className="health-meal__header-right">
        <span className="health-meal__kcal">{sessions.length ? `+${Math.round(sumCounted(sessions, 'calories'))} kcal` : '—'}</span>
      </span>
    </header>
    {sessions.map((workout, index) => <ExerciseRow key={workout.id ?? `${date}-${index}`} workout={workout}
      linked={homeSessions.find(session => workout.homeSessionId && (String(session.sessionId) === String(workout.homeSessionId)
        || session.segments?.some(segment => String(segment.sessionId) === String(workout.homeSessionId))))} />)}
    {details.error ? <UnstyledButton className="health-exercise__retry" onClick={details.reload}>Workout details unavailable · Retry</UnstyledButton> : null}
  </section>;
}
```

Notes for the implementer:
- `useRowPreview` without a provider is inert (it returns handlers that do nothing), so the existing `LogTable` tests that render without `RowPreviewProvider` still work. `LogTable` always wraps the log in the provider at runtime.
- The first memo's text is the row's second line; the card shows all of them. Two identical strings appear in the DOM only while the card is open.
- `content` must be memoized (see the comment in `useRowPreview`), which is why `memos` is `useMemo`'d on `linked`.

**Step 2: Run the tests**

Run: `npx vitest run frontend/src/modules/Health/today/ExerciseSection.test.jsx frontend/src/modules/Health/today/RowPreview.test.jsx`
Expected: all PASS. If the touch test fails on `fireEvent.click` returning true, check that `onPosterClick` calls `preventDefault()` before anything that could throw.

**Step 3: Commit**

```bash
git add frontend/src/modules/Health/today/ExerciseSection.jsx
git commit -m "feat(health): exercise as a compact food-shaped row with a hover card"
```

---

### Task 4: Move Exercise into the late column

**Files:**
- Modify: `frontend/src/modules/Health/today/LogTable.jsx` (~lines 270–290)
- Test: `frontend/src/modules/Health/today/LogTable.test.jsx` (~line 222)

**Step 1: Update the column test**

In `'Breakfast joins the early column above Lunch, Snacks the late column below Dinner'`, render with `exerciseAvailable` and assert Exercise closes the late column:

```jsx
      render(<LogTable byBucket={day} sessions={[]} exerciseAvailable renderAddRow={addRow} onRowTap={() => {}} />, { wrapper });
      const [early, late] = document.querySelectorAll('.health-log__column');
      expect([...early.querySelectorAll('h4')].map(h => h.textContent)).toEqual(['Breakfast', 'Lunch']);
      expect([...late.querySelectorAll('h4')].map(h => h.textContent)).toEqual(['Dinner', 'Snacks', 'Exercise']);
```

Rename the test to `'Breakfast joins the early column above Lunch; Snacks and then Exercise close the late column'`.

**Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Health/today/LogTable.test.jsx`
Expected: FAIL. The late column's headings are `['Dinner', 'Snacks']`; Exercise is in `.health-log__wide`.

**Step 3: Implement**

In `LogTable`, compute the gate once and render the section at the end of the late column. Delete the `.health-log__wide` exercise block, and move its comment with the gate:

```jsx
  // Gated on `exerciseAvailable` (budget data has arrived), NOT on
  // `sessions.length` — a zero-session day is a real, stable answer
  // ("no workout yet today"), not an absence of data. Gating on length
  // alone made the header pop in and out as sessions changed.
  const showExercise = exerciseAvailable || sessions.length > 0;
  const log = (
    <div className="health-log" ref={logRef}>
      {[EARLY_COLUMN, LATE_COLUMN].map((ids, index) => (
        <div key={index} className="health-log__column">
          {ids.map(id => BUCKETS.find(b => b.id === id)).map(renderBucket)}
          {/* Workouts sit under Snacks, a meal-width column like any food. */}
          {index === 1 && showExercise ? <ExerciseSection date={date} sessions={sessions} /> : null}
        </div>
      ))}
      {orphans.length ? (
```

Keep the orphans block in `.health-log__wide` unchanged.

**Step 4: Run the Today folder**

Run: `npx vitest run frontend/src/modules/Health/today/`
Expected: all PASS, including `TodayView.test.jsx`'s "Exercise header renders with zero sessions".

**Step 5: Commit**

```bash
git add frontend/src/modules/Health/today/LogTable.jsx frontend/src/modules/Health/today/LogTable.test.jsx
git commit -m "feat(health): exercise sits under Snacks in the late column"
```

---

### Task 5: Styles on the meal tracks

**Files:**
- Modify: `frontend/src/modules/Health/health.scss` (replace the `.health-exercise` block at ~line 706; add the card rules after the `.health-row-preview` block)
- Test: `frontend/src/modules/Health/today/layout.contract.test.js`

**Step 1: Write the failing contract test**

Add inside `describe('Today layout stylesheet', ...)`:

```js
  it('lays a workout on the meal tracks, with its credit in the kcal track', () => {
    expect(rule('.health-exercise')).toContain('var(--health-meal-tracks)');
    expect(rule('.health-exercise__identity')).toMatch(/grid-column: 1 \/ 6/);
    expect(rule('.health-exercise__minutes')).toMatch(/grid-column: 6/);
    expect(rule('.health-exercise__kcal')).toMatch(/grid-column: 7/);
    expect(rule('.health-exercise__kcal')).toMatch(/font-weight: 600/);
    for (const line of ['.health-exercise__title', '.health-exercise__memo', '.health-exercise__description']) {
      expect(rule(line)).toMatch(/text-overflow: ellipsis/);
    }
  });
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/Health/today/layout.contract.test.js`
Expected: FAIL. The current `.health-exercise` uses `42px minmax(0, 1fr) auto`.

**Step 3: Replace the `.health-exercise` block**

```scss
// A workout is a food row's shape (ExerciseSection.jsx): poster and name in
// tracks 1–5, minutes in the portion track, credit in the kcal track, so its
// numbers line up with the food above. The rest lives in the hover card.
.health-exercise {
  display: grid; grid-template-columns: var(--health-meal-tracks); gap: 0.2rem; align-items: center;
  min-height: 44px; padding-block: 0.25rem; border-radius: 6px; color: inherit; text-decoration: none;
  &:is(a) { cursor: pointer;
    @media (hover: hover) { &:hover { background: var(--ds-surface); } }
    &:focus-visible { outline: 2px solid var(--ds-accent); outline-offset: 2px; }
  }
  // Title starts where food names start (--health-name-inset); calc() clamps
  // a negative result to 0 on narrow tracks.
  &__identity { grid-column: 1 / 6; display: flex; align-items: center; gap: 0.5rem; min-width: 0;
    padding-left: calc(var(--health-name-inset, 36px) - 28px - 0.5rem); }
  &__art { flex: none; width: 28px; height: 40px; border-radius: 4px; overflow: hidden; display: grid; place-items: center;
    background: var(--ds-surface); color: var(--ds-text-mid);
    img { width: 100%; height: 100%; object-fit: cover; }
  }
  &__text { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
  &__title { color: var(--ds-text-high); font-size: 0.86rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  &__memo { font-size: 0.75rem; font-style: italic; color: var(--ds-text-mid); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    svg { vertical-align: -2px; margin-right: 0.2rem; color: var(--ds-accent); }
  }
  &__description { font-size: 0.72rem; color: var(--ds-text-low); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  &__minutes { grid-column: 6; text-align: right; color: var(--ds-text-mid); font-size: 0.8rem; white-space: nowrap; font-variant-numeric: tabular-nums; }
  // Bigger than a food's kcal: the credit is the one number a workout row is for.
  // justify-self: end lets "+187 kcal" overhang left into the minutes slack
  // while its right edge stays on the food kcal column.
  &__kcal { grid-column: 7; justify-self: end; font-size: 1rem; font-weight: 600; }
  &__retry { min-height: 44px; color: var(--ds-text-mid); font-size: 0.75rem; }
}
```

`.health-meal--exercise .health-row__kcal { color: var(--ds-success); }` (in `.health-meal`) already colours the credit green. Leave it.

After the `.health-row-preview { ... }` block, add the card's exercise variant:

```scss
// The exercise card (ExerciseSection.jsx): a portrait poster, then every memo
// in full and the episode blurb.
.health-exercise-preview {
  &__hero { height: 7em; > img { object-fit: cover; } }
  &__memo { margin: 0; display: flex; gap: 0.3rem; font-size: 0.78rem; font-style: italic;
    svg { flex: none; margin-top: 0.15rem; color: var(--ds-accent); }
  }
  &__description { margin: 0; font-size: 0.72rem; color: var(--ds-text-mid);
    display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden;
  }
}
```

(The poster `<img>` rule matches `.health-row-preview__hero > img` at equal specificity, and wins because it comes later in the file.)

**Step 4: Run the tests**

Run: `npx vitest run frontend/src/modules/Health/today/`
Expected: all PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Health/health.scss frontend/src/modules/Health/today/layout.contract.test.js
git commit -m "style(health): exercise row on the meal tracks, prominent credit"
```

---

### Task 6: See it in a browser

jsdom cannot see layout. Use @superpowers:verification-before-completion. The claims to check are "half width", "one or two lines", and "kcal in the food kcal column".

**Step 1:** Check for a running dev server: `lsof -i :3111`. If one is running, reuse it. **Never start a second backend** (CLAUDE.local.md). If the laptop backend cannot boot because of Dropbox online-only files (memory: `reference_laptop_backend_blocked_by_dropbox_dataless`), verify on the homeserver dev tree after pulling the branch there.

**Step 2:** Screenshot `/health` on a day with workouts (2026-09-25 has two: Max Built—Arms 1 and Game Cycling) at 1440×900 and 390×844, using Playwright from the scratchpad:

```js
// scratchpad/exercise-shot.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch();
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`http://localhost:3111/health?date=2026-09-25`);
  await page.waitForSelector('.health-exercise');
  await page.locator('.health-meal--exercise').screenshot({ path: `exercise-${w}.png` });
  await page.locator('.health-exercise').first().hover();
  await page.screenshot({ path: `exercise-${w}-hover.png` });
  const kcal = await page.$$eval('.health-exercise__kcal, .health-row-line .health-row__kcal',
    els => els.map(e => Math.round(e.getBoundingClientRect().right)));
  console.log(w, 'kcal right edges', kcal);
}
await browser.close();
```

**Step 3:** Check each claim against the screenshots:
- Exercise is in the right column under Snacks at 1440, and last at 390.
- Each workout is at most two text lines. The memo is truncated with an ellipsis, and the description is absent when a memo exists.
- The printed kcal right edges of exercise rows equal those of the Dinner/Snacks food rows in the same column (±1px).
- The hover card shows time, minutes, bpm, kcal, the full memo, and the description.
- There is no horizontal overflow at 390 (`document.documentElement.scrollWidth <= 390`).

Fix anything that fails before moving on.

---

### Task 7: Docs

**Files:**
- Modify: `docs/reference/health/README.md`, section "Column and sidebar" (~line 707)

**Step 1:** After the paragraph that starts "At 1200px the existing AppChrome left rail…", add:

```markdown
**Exercise** closes the late column, under Snacks, at meal width. Each workout
is one food-shaped row on the shared meal tracks (`ExerciseSection.jsx`): a
program poster, the title, and one truncated line holding the first voice memo
(the episode description only when there is no memo); minutes sit in the
portion track and the calorie credit, larger than a food's, in the kcal track.
The credit comes from the nutrition workout ledger; the fitness sessions index
only supplies posters, memos and the session link. Clicking the row opens the
fitness session. Hovering it (or, on touch, tapping the poster) shows the
page's one preview card with start time, minutes, average heart rate, the
credit (`est.` for a heart-rate estimate), every memo and the description.
```

**Step 2: Commit**

```bash
git add docs/reference/health/README.md
git commit -m "docs(health): exercise rows in the late column"
```

---

### Task 8: Finish

Use @superpowers:finishing-a-development-branch. Per `CLAUDE.md`: merge into `main` (no PR), delete the branch after merging, and record it in `docs/_archive/deleted-branches.md` before deleting. Commit and deploy authority is set in `CLAUDE.local.md`; confirm with the user before deploying.
