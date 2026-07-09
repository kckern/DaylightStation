# Piano Subcourses Drill-in Redesign — Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `subcourses` drill-in (Program → Season → Course → Lesson) around a deepening context rail, typographic prefix-fade cards, progress rings, an always-on "resources" class, thumbnail-forward lesson rows, and a Continue action — replacing the three identical-poster grids.

**Architecture:** Frontend-only. All inputs already arrive in the flat `/playable` response (`parentId`=season, `itemIndex`=CNN floor/room, `title`, `image/thumbnail`, `duration`, per-user `userWatched/userPercent`, and `referenceUnitIds`). Pure helpers in `subcourses.js` do reference-marking, per-level progress aggregation, sibling prefix-fade, and Continue-target selection; small presentational components (`ProgressRing`, `SeasonList`, `CourseCards`, `LessonList`, `PianoContextRail`) render each level; `SubcourseNavigator` composes them. No backend change.

**Tech Stack:** React 18, react-router-dom, Vitest + @testing-library/react. Styles in `frontend/src/Apps/PianoApp.scss`. All commands from `/opt/Code/DaylightStation/frontend`. Base dir for components: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/`.

## Global Constraints

- **No backend change.** Reference/resources comes from `/playable`'s existing `referenceUnitIds` (season-level parentIds). Progress and Continue are client-derived from per-user `userWatched`/`userPercent`.
- **Reuse the existing design system.** Use `--piano-*` tokens (`--piano-accent`, `--piano-accent-ink`, `--piano-surface-2`, `--piano-border`, `--piano-muted`, `--piano-fg`, `--r-sm`, `--r-md`, `--r-card`). The mockup's "brass" == `--piano-accent`. The only NEW tokens are four season tints. Reuse `.piano-episode*` for lesson rows.
- **Progress is a ring, never `0/32` text.** One `ProgressRing` primitive at program/season/course.
- **Reference (resources) ≠ courses:** a reference season shows no ring, never gates, is EXCLUDED from every "X of N courses" denominator, and renders as a dashed "open anytime" affordance.
- **Guidance not gates:** the current lesson is the one accented element with a Play button; later lessons read as a soft "later" (dimmed + soft lock), not error-red.
- **Prefix-fade wordmarks:** within a season, fade the shared course-title prefix, emphasize the distinguisher; pair with the floor ordinal + per-season tint. Untitled groups fall back to the ordinal alone.
- **Lesson rows keep the Plex thumbnail** (existing `.piano-episode__thumb img`) with a state overlay.
- **Watched status source:** `lectureUserStatus(item)` from `./lectureMeta.js`. Lesson/gate key: `item.plex || item.id` (`keyOf`).
- **Single-course seasons collapse** to their lessons (existing behavior, preserved).
- **Out of scope (other plans):** the lesson-end hand-off/auto-roll (Plan 2, Player integration) and the flat/multi-unit path adopting this language (Plan 3). Runtime `piano.yml` reference config for a whole season is a manual data step, not a code task.
- Test command: `npx vitest run <path>` from repo root.

---

### Task 1: `subcourses.js` — reference, progress, prefix-fade, Continue (pure)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/subcourses.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/subcourses.test.js` (append)

**Interfaces:**
- Consumes: existing `floorOf`, `roomOf`, `keyOf`, `deriveCourseLabel`, `progressOf`, `partitionCourses`, `lectureUserStatus`.
- Produces:
  - `partitionSeasons(items, parents, referenceUnitIds = []) -> Season[]` where `Season = { id, index, title, thumbnail, reference:boolean, lessons, courses }` and each `Course = { floor, label, reference:boolean, lessons }`.
  - `sharedPrefix(labels:string[]) -> { prefix:string, tails:string[] }`
  - `courseStats(course) -> { watched, total, complete:boolean, percent }`
  - `seasonStats(season) -> { reference:boolean, completeCourses, totalCourses, percent }`
  - `programStats(seasons) -> { completeCourses, totalCourses, percent }`
  - `continueTarget(seasons) -> { seasonId, floor, lesson } | null`

- [ ] **Step 1: Write the failing tests (append to `subcourses.test.js`)**

```js
// ── redesign helpers ─────────────────────────────────────────────────────────
import {
  sharedPrefix, courseStats, seasonStats, programStats, continueTarget,
} from './subcourses.js';

const L = (parentId, itemIndex, title, watched = false) => ({
  id: `plex:${itemIndex}`, plex: String(itemIndex), parentId: String(parentId),
  itemIndex, title, label: title, userWatched: watched,
});

describe('sharedPrefix', () => {
  it('splits a common leading phrase from the distinguishing tail', () => {
    const { prefix, tails } = sharedPrefix([
      'Pop Soloing with Chord Tone Targets',
      'Pop Soloing with 3rds and 6ths',
      'Pop Soloing with Slip Notes',
    ]);
    expect(prefix).toBe('Pop Soloing with');
    expect(tails).toEqual(['Chord Tone Targets', '3rds and 6ths', 'Slip Notes']);
  });
  it('returns empty prefix when there is no ≥2-word commonality', () => {
    const { prefix, tails } = sharedPrefix(['Course 1', 'Course 2']);
    expect(prefix).toBe('');
    expect(tails).toEqual(['Course 1', 'Course 2']);
  });
  it('never eats a whole title (keeps a non-empty tail for all)', () => {
    const { prefix, tails } = sharedPrefix(['Blues Scales', 'Blues Scales Advanced']);
    expect(tails.every((t) => t.length > 0)).toBe(true);
    expect(prefix).not.toBe('Blues Scales');
  });
});

describe('reference marking + stats', () => {
  const items = [
    L(700, 101, 'Practice – A', true), L(700, 102, 'Practice – B', true),        // reference season 700
    L(701, 101, 'Solo with X – 1', true), L(701, 102, 'Solo with X – 2', true),   // course 1 complete
    L(701, 201, 'Solo with Y – 1', true), L(701, 202, 'Solo with Y – 2', false),  // course 2 in progress
  ];
  const parents = { 700: { index: 0, title: 'Practice Essentials' }, 701: { index: 1, title: 'Season 1' } };
  const seasons = partitionSeasons(items, parents, ['700']);

  it('flags the reference season and its courses', () => {
    const ref = seasons.find((s) => s.id === '700');
    expect(ref.reference).toBe(true);
    expect(ref.courses.every((c) => c.reference)).toBe(true);
  });
  it('courseStats reports completion', () => {
    const s1 = seasons.find((s) => s.id === '701');
    expect(courseStats(s1.courses[0])).toMatchObject({ watched: 2, total: 2, complete: true });
    expect(courseStats(s1.courses[1])).toMatchObject({ watched: 1, total: 2, complete: false });
  });
  it('seasonStats counts complete courses; reference season is exempt', () => {
    expect(seasonStats(seasons.find((s) => s.id === '701'))).toMatchObject({ reference: false, completeCourses: 1, totalCourses: 2 });
    expect(seasonStats(seasons.find((s) => s.id === '700'))).toMatchObject({ reference: true });
  });
  it('programStats excludes the reference season from the denominator', () => {
    expect(programStats(seasons)).toMatchObject({ completeCourses: 1, totalCourses: 2 });
  });
  it('continueTarget points at the first unwatched lesson in linear order (skipping reference)', () => {
    const t = continueTarget(seasons);
    expect(t).toMatchObject({ seasonId: '701', floor: 2 });
    expect(t.lesson.plex).toBe('202');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/subcourses.test.js`
Expected: FAIL — `sharedPrefix`/`courseStats`/… are not exported.

- [ ] **Step 3: Implement — extend `subcourses.js`**

3a. Replace `partitionSeasons` to accept + apply `referenceUnitIds`:

```js
export function partitionSeasons(items, parents, referenceUnitIds = []) {
  if (!parents || typeof parents !== 'object') return [];
  const refSet = new Set((referenceUnitIds || []).map(String));
  const seasons = Object.entries(parents).map(([id, p]) => ({
    id: String(id),
    index: Number.isFinite(p?.index) ? p.index : (parseInt(p?.index, 10) || 0),
    title: p?.title || null,
    thumbnail: p?.thumbnail || null,
    reference: refSet.has(String(id)),
  })).sort((a, b) => a.index - b.index);
  return seasons.map((s) => {
    const lessons = (items || []).filter((it) => String(it.parentId) === s.id);
    const courses = partitionCourses(lessons).map((c) => ({ ...c, reference: s.reference }));
    return { ...s, lessons, courses };
  });
}
```

3b. Append the new helpers at the end of the file:

```js
/**
 * Longest shared leading word-run across sibling course labels → {prefix, tails}.
 * Only fades when the prefix is ≥2 words AND every tail stays non-empty; otherwise
 * prefix is '' and tails are the full labels (so single/oddball seasons don't fade).
 */
export function sharedPrefix(labels) {
  const list = (labels || []).map((l) => String(l || ''));
  if (list.length < 2) return { prefix: '', tails: list };
  const wordLists = list.map((l) => l.split(/\s+/));
  const min = Math.min(...wordLists.map((w) => w.length));
  let n = 0;
  for (let i = 0; i < min; i += 1) {
    const w = wordLists[0][i];
    if (wordLists.every((wl) => wl[i] === w)) n += 1; else break;
  }
  // keep at least one word of tail on every label
  while (n > 0 && wordLists.some((wl) => wl.length <= n)) n -= 1;
  if (n < 2) return { prefix: '', tails: list };
  const prefix = wordLists[0].slice(0, n).join(' ');
  const tails = wordLists.map((wl) => wl.slice(n).join(' '));
  return { prefix, tails };
}

/** Per-course progress from per-user watched flags. */
export function courseStats(course) {
  const { watched, total } = progressOf(course?.lessons || []);
  const complete = total > 0 && watched === total;
  const percent = total > 0 ? Math.round((watched / total) * 100) : 0;
  return { watched, total, complete, percent };
}

/** Per-season progress: complete courses / total (reference seasons are exempt). */
export function seasonStats(season) {
  if (season?.reference) return { reference: true, completeCourses: 0, totalCourses: 0, percent: 0 };
  const courses = season?.courses || [];
  const totalCourses = courses.length;
  const completeCourses = courses.filter((c) => courseStats(c).complete).length;
  const percent = totalCourses > 0 ? Math.round((completeCourses / totalCourses) * 100) : 0;
  return { reference: false, completeCourses, totalCourses, percent };
}

/** Program progress across non-reference seasons. */
export function programStats(seasons) {
  const graded = (seasons || []).filter((s) => !s.reference);
  const totalCourses = graded.reduce((n, s) => n + s.courses.length, 0);
  const completeCourses = graded.reduce((n, s) => n + s.courses.filter((c) => courseStats(c).complete).length, 0);
  const percent = totalCourses > 0 ? Math.round((completeCourses / totalCourses) * 100) : 0;
  return { completeCourses, totalCourses, percent };
}

/**
 * The resume target: the first not-yet-watched lesson in linear order
 * (season index → floor → room), skipping reference seasons. Null when the whole
 * graded program is complete.
 */
export function continueTarget(seasons) {
  for (const s of (seasons || []).filter((x) => !x.reference)) {
    for (const c of s.courses) {
      const ordered = [...c.lessons].sort((a, b) => roomOf(a) - roomOf(b));
      const next = ordered.find((ep) => !lectureUserStatus(ep).watched);
      if (next) return { seasonId: s.id, floor: c.floor, lesson: next };
    }
  }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/subcourses.test.js`
Expected: PASS (existing cases + the new ones).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/subcourses.js frontend/src/modules/Piano/PianoKiosk/modes/Videos/subcourses.test.js
git commit -m "feat(piano): subcourses reference-marking, progress stats, prefix-fade, Continue target"
```

---

### Task 2: `ProgressRing` primitive (+ CSS)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/ProgressRing.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss` (append)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/ProgressRing.test.jsx`

**Interfaces:**
- Produces: `default ProgressRing({ percent = 0, label, done = false, size })` — a conic radial ring; renders `label` (or `✓` when `done`) centered; sets `--p` to the clamped percent.

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import ProgressRing from './ProgressRing.jsx';

describe('ProgressRing', () => {
  it('renders the label and clamps percent into the --p custom property', () => {
    const { container } = render(<ProgressRing percent={140} label="2/6" />);
    const el = container.querySelector('.psc-ring');
    expect(el.style.getPropertyValue('--p')).toBe('100');
    expect(el.textContent).toContain('2/6');
  });
  it('shows a check and the done modifier when done', () => {
    const { container } = render(<ProgressRing done percent={100} />);
    const el = container.querySelector('.psc-ring');
    expect(el.className).toContain('is-done');
    expect(el.textContent).toContain('✓');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/ProgressRing.test.jsx`
Expected: FAIL — cannot resolve `./ProgressRing.jsx`.

- [ ] **Step 3a: Implement `ProgressRing.jsx`**

```jsx
/**
 * A single radial progress mark, reused at program / season / course. Conic fill
 * driven by `--p`; a teal-ish "done" state shows a check. No 0/32 text anywhere.
 */
export default function ProgressRing({ percent = 0, label, done = false, size }) {
  const p = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const style = { '--p': String(p) };
  if (size) style.width = style.height = size;
  return (
    <span className={`psc-ring${done ? ' is-done' : ''}`} style={style} aria-hidden="true">
      <span className="psc-ring__c">{done ? '✓' : label}</span>
    </span>
  );
}
```

- [ ] **Step 3b: Append CSS to `frontend/src/Apps/PianoApp.scss`**

```scss
/* ── Subcourses redesign: shared tokens + progress ring ───────────────────── */
:root{
  --psc-tint-1:#6f7f8c; --psc-tint-2:#5f8f84; --psc-tint-3:#93728c; --psc-tint-4:#84906a;
  --psc-done:#5f8f84;
}
.psc-ring{
  --p:0; width:2.6rem; height:2.6rem; border-radius:50%; flex:0 0 auto; position:relative;
  display:grid; place-items:center;
  background:conic-gradient(var(--piano-accent) calc(var(--p)*1%), var(--piano-border) 0);
}
.psc-ring::before{content:""; position:absolute; inset:3px; border-radius:50%; background:var(--piano-surface-2);}
.psc-ring__c{position:relative; font-size:.62rem; color:var(--piano-fg);
  font-variant-numeric:tabular-nums; font-family:var(--piano-mono, ui-monospace, monospace);}
.psc-ring.is-done{background:conic-gradient(var(--psc-done) 100%, var(--psc-done) 0);}
.psc-ring.is-done .psc-ring__c{color:var(--psc-done); font-size:.9rem;}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/ProgressRing.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/ProgressRing.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/ProgressRing.test.jsx frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): ProgressRing primitive + subcourses design tokens"
```

---

### Task 3: `SeasonList` (rows, ring, tint, resources) — replaces `SeasonMenu`

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/SeasonList.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss` (append)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/SeasonList.test.jsx`

**Interfaces:**
- Consumes: `seasonStats` (Task 1), `ProgressRing` (Task 2). A `season` is `{ id, index, title, reference, courses, lessons }`.
- Produces: `default SeasonList({ seasons, onSelect })` — one row per season; graded seasons show ordinal + ring + "N courses"; reference seasons render dashed "M resources · open anytime" (no ring, no ordinal). `onSelect(season)` on tap. `tintFor(index)` cycles the four tints.

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SeasonList from './SeasonList.jsx';

const graded = { id: '701', index: 1, title: 'Pop Soloing', reference: false,
  lessons: [{ plex: '1', userWatched: true }], courses: [{ floor: 1, lessons: [{ plex: '1', userWatched: true }] }, { floor: 2, lessons: [{ plex: '2', userWatched: false }] }] };
const resources = { id: '700', index: 0, title: 'Practice Essentials', reference: true,
  lessons: [{ plex: '9' }], courses: [{ floor: 1, reference: true, lessons: [{ plex: '9' }] }] };

describe('SeasonList', () => {
  it('renders a graded season with ordinal + course count', () => {
    render(<SeasonList seasons={[graded]} onSelect={() => {}} />);
    expect(screen.getByText('Pop Soloing')).toBeTruthy();
    expect(screen.getByText(/2 courses/)).toBeTruthy();
    expect(screen.getByText('01')).toBeTruthy();
  });
  it('renders a reference season as always-on resources (no ordinal, no ring)', () => {
    const { container } = render(<SeasonList seasons={[resources]} onSelect={() => {}} />);
    expect(screen.getByText('Practice Essentials')).toBeTruthy();
    expect(screen.getByText(/open anytime/)).toBeTruthy();
    expect(container.querySelector('.psc-ring')).toBeNull();
  });
  it('calls onSelect with the season', () => {
    const onSelect = vi.fn();
    render(<SeasonList seasons={[graded]} onSelect={onSelect} />);
    fireEvent.click(screen.getByTitle('Pop Soloing'));
    expect(onSelect).toHaveBeenCalledWith(graded);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/SeasonList.test.jsx`
Expected: FAIL — cannot resolve `./SeasonList.jsx`.

- [ ] **Step 3a: Implement `SeasonList.jsx`**

```jsx
import { seasonStats } from './subcourses.js';
import ProgressRing from './ProgressRing.jsx';

const TINTS = ['var(--psc-tint-1)', 'var(--psc-tint-2)', 'var(--psc-tint-3)', 'var(--psc-tint-4)'];
const tintFor = (i) => TINTS[((i % TINTS.length) + TINTS.length) % TINTS.length];
const ord = (n) => String(n).padStart(2, '0');

export default function SeasonList({ seasons, onSelect }) {
  return (
    <ul className="psc-list">
      {(seasons || []).map((s, i) => {
        const name = s.title || `Season ${s.index}`;
        const tint = tintFor(i);
        if (s.reference) {
          return (
            <li key={s.id}>
              <button type="button" className="psc-row psc-row--resource" style={{ '--tint': tint }} onClick={() => onSelect(s)} title={name}>
                <span className="psc-row__tint" />
                <span className="psc-row__resmark" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M6 4h11a1 1 0 011 1v15l-6.5-3.5L6 20V5a1 1 0 011-1z" /></svg>
                </span>
                <span className="psc-row__meta"><span className="psc-row__name">{name}</span>
                  <span className="psc-row__sub">{s.courses.length} resource{s.courses.length === 1 ? '' : 's'} · open anytime</span></span>
                <span className="psc-tag psc-tag--res">always on</span>
              </button>
            </li>
          );
        }
        const st = seasonStats(s);
        return (
          <li key={s.id}>
            <button type="button" className="psc-row" style={{ '--tint': tint }} onClick={() => onSelect(s)} title={name}>
              <span className="psc-row__tint" />
              <ProgressRing percent={st.percent} label={`${st.percent}%`} done={st.totalCourses > 0 && st.completeCourses === st.totalCourses} />
              <span className="psc-row__idx">{ord(i)}</span>
              <span className="psc-row__meta"><span className="psc-row__name">{name}</span>
                <span className="psc-row__sub">{st.totalCourses} course{st.totalCourses === 1 ? '' : 's'}{st.completeCourses ? ` · ${st.completeCourses} done` : ''}</span></span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 3b: Append CSS to `PianoApp.scss`**

```scss
/* ── Subcourses redesign: list rows (seasons) ─────────────────────────────── */
.psc-list{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:.55rem;}
.psc-row{position:relative; overflow:hidden; width:100%; display:flex; align-items:center; gap:.95rem;
  text-align:left; cursor:pointer; padding:.85rem .9rem; border-radius:var(--r-md);
  border:1px solid var(--piano-border); color:inherit;
  background:color-mix(in srgb, var(--tint,transparent) 7%, var(--piano-surface-2));}
.psc-row:hover,.psc-row:focus-visible{background:color-mix(in srgb, var(--tint,transparent) 12%, var(--piano-surface-2)); border-color:var(--piano-muted);}
.psc-row__tint{position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--tint,var(--piano-muted));}
.psc-row__idx{font-family:var(--piano-mono, ui-monospace, monospace); font-variant-numeric:tabular-nums; color:var(--piano-muted); width:2.1ch; text-align:right;}
.psc-row__meta{flex:1; min-width:0;}
.psc-row__name{display:block; font-family:var(--piano-serif, Georgia, serif); font-size:1.12rem; line-height:1.15;}
.psc-row__sub{display:block; font-size:.78rem; color:var(--piano-muted); font-variant-numeric:tabular-nums;}
.psc-row--resource{border-style:dashed; background:color-mix(in srgb, var(--tint,transparent) 5%, var(--piano-surface-1, var(--piano-surface-2)));}
.psc-row__resmark{width:2.6rem; height:2.6rem; border-radius:var(--r-sm); flex:0 0 auto; display:grid; place-items:center; color:var(--piano-muted); border:1px dashed var(--piano-border);}
.psc-tag{font-family:var(--piano-mono, ui-monospace, monospace); font-size:.62rem; letter-spacing:.1em; text-transform:uppercase; padding:.22rem .5rem; border-radius:2rem; margin-left:auto;}
.psc-tag--res{color:var(--piano-muted); border:1px dashed var(--piano-border);}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/SeasonList.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/SeasonList.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/SeasonList.test.jsx frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): SeasonList — chaptered season rows with rings + resources"
```

---

### Task 4: `CourseCards` (prefix-fade wordmarks) — replaces `CourseList`

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseCards.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss` (append)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseCards.test.jsx`

**Interfaces:**
- Consumes: `sharedPrefix`, `courseStats` (Task 1), `ProgressRing` (Task 2). A `season` is `{ index, courses:[{floor,label,reference,lessons}] }`.
- Produces: `default CourseCards({ season, currentFloor = null, onSelect })` — one card per course; shared prefix faded, tail in display serif, floor ordinal, ring; the `currentFloor` card gets `is-current`; reference courses render as resource cards (no ring). `onSelect(course)`.

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CourseCards from './CourseCards.jsx';

const season = { index: 1, courses: [
  { floor: 1, label: 'Pop Soloing with Chord Tone Targets', reference: false, lessons: [{ plex: '1', userWatched: true }] },
  { floor: 2, label: 'Pop Soloing with 3rds and 6ths', reference: false, lessons: [{ plex: '2', userWatched: false }] },
] };

describe('CourseCards', () => {
  it('fades the shared prefix and emphasizes the tail', () => {
    render(<CourseCards season={season} onSelect={() => {}} />);
    expect(screen.getAllByText('Pop Soloing with').length).toBe(2);
    expect(screen.getByText('Chord Tone Targets')).toBeTruthy();
    expect(screen.getByText('3rds and 6ths')).toBeTruthy();
  });
  it('marks the current course', () => {
    const { container } = render(<CourseCards season={season} currentFloor={2} onSelect={() => {}} />);
    const cards = container.querySelectorAll('.psc-card');
    expect(cards[1].className).toContain('is-current');
  });
  it('calls onSelect with the course', () => {
    const onSelect = vi.fn();
    render(<CourseCards season={season} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('3rds and 6ths').closest('button'));
    expect(onSelect).toHaveBeenCalledWith(season.courses[1]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/CourseCards.test.jsx`
Expected: FAIL — cannot resolve `./CourseCards.jsx`.

- [ ] **Step 3a: Implement `CourseCards.jsx`**

```jsx
import { sharedPrefix, courseStats } from './subcourses.js';
import ProgressRing from './ProgressRing.jsx';

const TINTS = ['var(--psc-tint-1)', 'var(--psc-tint-2)', 'var(--psc-tint-3)', 'var(--psc-tint-4)'];
const ord = (n) => String(n).padStart(2, '0');

export default function CourseCards({ season, currentFloor = null, onSelect }) {
  const courses = season?.courses || [];
  const { prefix, tails } = sharedPrefix(courses.map((c) => c.label));
  const tint = TINTS[(((season?.index ?? 0) % TINTS.length) + TINTS.length) % TINTS.length];
  return (
    <ul className="psc-cards">
      {courses.map((c, i) => {
        const st = courseStats(c);
        const isCurrent = c.floor === currentFloor;
        const tail = tails[i] || c.label;
        return (
          <li key={c.floor}>
            <button type="button" className={`psc-card${isCurrent ? ' is-current' : ''}${c.reference ? ' psc-card--resource' : ''}`}
              style={{ '--tint': tint }} onClick={() => onSelect(c)} title={c.label}>
              <span className="psc-card__tint" />
              <span className="psc-card__top">
                <span className="psc-card__idx">{ord(c.floor)}</span>
                <span className="psc-card__wm">
                  {prefix && <span className="psc-card__pfx">{prefix}</span>}
                  <span className="psc-card__tail">{tail}</span>
                </span>
                {!c.reference && <ProgressRing percent={st.percent} label={`${st.watched}/${st.total}`} done={st.complete} />}
              </span>
              <span className="psc-card__foot">
                <span className="psc-card__sub">{c.reference ? 'open anytime' : `${st.total} lesson${st.total === 1 ? '' : 's'}`}</span>
                {c.reference ? <span className="psc-tag psc-tag--res">resource</span>
                  : isCurrent ? <span className="psc-tag psc-tag--next">up next</span>
                  : st.complete ? <span className="psc-tag psc-tag--done">done</span>
                  : <span className="psc-tag psc-tag--later">later</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 3b: Append CSS to `PianoApp.scss`**

```scss
/* ── Subcourses redesign: course cards (prefix-fade wordmarks) ─────────────── */
.psc-cards{list-style:none; margin:0; padding:0; display:grid; grid-template-columns:1fr 1fr; gap:.7rem;}
@media(max-width:760px){.psc-cards{grid-template-columns:1fr;}}
.psc-card{position:relative; overflow:hidden; width:100%; text-align:left; cursor:pointer;
  display:flex; flex-direction:column; gap:.5rem; padding:.95rem 1rem .9rem;
  border-radius:var(--r-md); border:1px solid var(--piano-border); color:inherit;
  background:color-mix(in srgb, var(--tint,transparent) 7%, var(--piano-surface-2));}
.psc-card:hover,.psc-card:focus-visible{border-color:var(--piano-muted);}
.psc-card__tint{position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--tint,var(--piano-muted));}
.psc-card.is-current{border-color:var(--piano-accent); box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--piano-accent) 30%, transparent);}
.psc-card--resource{border-style:dashed;}
.psc-card__top{display:flex; align-items:flex-start; gap:.7rem;}
.psc-card__idx{font-family:var(--piano-mono, ui-monospace, monospace); font-variant-numeric:tabular-nums; font-size:1.25rem; color:var(--piano-muted); padding-top:.05rem;}
.psc-card__wm{flex:1; min-width:0;}
.psc-card__pfx{display:block; font-size:.74rem; color:var(--piano-muted);}
.psc-card__tail{display:block; font-family:var(--piano-serif, Georgia, serif); font-size:1.3rem; line-height:1.08; text-wrap:balance;}
.psc-card__foot{display:flex; align-items:center; justify-content:space-between; gap:.6rem;}
.psc-card__sub{font-family:var(--piano-mono, ui-monospace, monospace); font-size:.72rem; color:var(--piano-muted); font-variant-numeric:tabular-nums;}
.psc-tag--next{background:var(--piano-accent); color:var(--piano-accent-ink); font-weight:700;}
.psc-tag--done{color:var(--psc-done); border:1px solid color-mix(in srgb,var(--psc-done) 40%, transparent);}
.psc-tag--later{color:var(--piano-muted); border:1px solid var(--piano-border);}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/CourseCards.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseCards.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseCards.test.jsx frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): CourseCards — prefix-fade wordmark cards with rings"
```

---

### Task 5: `LessonList` — thumbnail-forward, current-loud, soft-lock

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/LessonList.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss` (append)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/LessonList.test.jsx`

**Interfaces:**
- Consumes: `courseGate`, `keyOf` (Task 1/existing); `lectureUserStatus` (`./lectureMeta.js`); `LockIcon` (`@/modules/Fitness/player/overlays/LockIcon.jsx`).
- Produces: `default LessonList({ lessons, onPlay, sequential = true, reference = false })` — reuses `.piano-episode` markup (thumbnail + overlays + duration); the current lesson gets a Play button + `is-current`; later lessons are `disabled` + soft-locked. When `reference`, nothing gates (all playable).

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LessonList from './LessonList.jsx';

const ep = (i, title, extra = {}) => ({ plex: String(i), id: `plex:${i}`, itemIndex: i, label: title, duration: 500, image: `/t${i}.jpg`, ...extra });

describe('LessonList', () => {
  it('renders lessons with their thumbnail', () => {
    const { container } = render(<LessonList lessons={[ep(101, 'Pop Chords')]} onPlay={vi.fn()} />);
    expect(container.querySelector('.piano-episode__thumb img')).toBeTruthy();
    expect(screen.getByText('Pop Chords')).toBeTruthy();
  });
  it('gates: locks after the first unwatched, gives it the Play button', () => {
    const onPlay = vi.fn();
    render(<LessonList onPlay={onPlay} lessons={[
      ep(101, 'A', { userWatched: true }), ep(102, 'B', { userWatched: false }), ep(103, 'C', { userWatched: false }),
    ]} />);
    const b = screen.getByText('B').closest('button');
    const c = screen.getByText('C').closest('button');
    expect(b.className).toContain('is-current');
    expect(c.disabled).toBe(true);
    fireEvent.click(c); expect(onPlay).not.toHaveBeenCalled();
    fireEvent.click(b); expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ plex: '102' }));
  });
  it('reference course never gates (all open)', () => {
    const onPlay = vi.fn();
    render(<LessonList reference onPlay={onPlay} lessons={[ep(101, 'X', { userWatched: false }), ep(102, 'Y', { userWatched: false })]} />);
    fireEvent.click(screen.getByText('Y').closest('button'));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ plex: '102' }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/LessonList.test.jsx`
Expected: FAIL — cannot resolve `./LessonList.jsx`.

- [ ] **Step 3a: Implement `LessonList.jsx`**

```jsx
import { useMemo } from 'react';
import { courseGate, keyOf } from './subcourses.js';
import { lectureUserStatus } from './lectureMeta.js';
import LockIcon from '@/modules/Fitness/player/overlays/LockIcon.jsx';

function fmt(sec) {
  const s = Math.round(Number(sec));
  if (!Number.isFinite(s) || s <= 0) return null;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Lessons of one course. Thumbnail-forward (reuses .piano-episode), sequential by
 * default: the current lesson is the one loud row (Play button + is-current); later
 * lessons are soft-locked "later", not error-red. A reference course never gates.
 */
export default function LessonList({ lessons, onPlay, sequential = true, reference = false }) {
  const gate = sequential && !reference;
  const { lockedIds, currentId } = useMemo(
    () => (gate ? courseGate(lessons) : { lockedIds: new Set(), currentId: null }),
    [gate, lessons],
  );
  return (
    <ul className="piano-episodes psc-lessons">
      {(lessons || []).map((item) => {
        const k = keyOf(item);
        const st = lectureUserStatus(item);
        const img = item.image || item.thumbnail;
        const locked = lockedIds.has(k);
        const current = k === currentId;
        const dur = fmt(item.duration);
        return (
          <li key={k}>
            <button type="button"
              className={['piano-episode', locked && 'piano-episode--locked', current && 'piano-episode--current is-current'].filter(Boolean).join(' ')}
              onClick={() => { if (!locked) onPlay(item); }} disabled={locked} aria-disabled={locked} aria-current={current ? 'true' : undefined}>
              <div className="piano-episode__thumb">
                {img && <img src={img} alt="" loading="eager" decoding="async" />}
                {locked && <span className="piano-episode__lock" aria-label="Later"><LockIcon /></span>}
                {!locked && st.watched && <span className="piano-episode__check" aria-label="Completed"><span className="piano-episode__check-mark">✓</span></span>}
                {!locked && !st.watched && st.percent > 0 && <span className="piano-episode__bar"><span style={{ width: `${st.percent}%` }} /></span>}
                {dur && <span className="piano-episode__duration">{dur}</span>}
              </div>
              <div className="piano-episode__label"><span className="piano-episode__title">{item.label || item.title}</span></div>
              {current && <span className="psc-play"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>Play</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 3b: Append CSS to `PianoApp.scss`**

```scss
/* ── Subcourses redesign: lesson list emphasis ────────────────────────────── */
.psc-lessons .piano-episode.is-current{border:1px solid var(--piano-accent);
  background:color-mix(in srgb,var(--piano-accent) 12%, transparent); border-radius:var(--r-sm);}
.psc-play{margin-left:auto; display:inline-flex; align-items:center; gap:.35rem;
  background:var(--piano-accent); color:var(--piano-accent-ink); font-weight:700; font-size:.8rem;
  border-radius:2rem; padding:.35rem .85rem;}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/LessonList.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/LessonList.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/LessonList.test.jsx frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): LessonList — thumbnail-forward rows, current-loud, soft-lock"
```

---

### Task 6: `PianoContextRail` — the deepening anchor

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoContextRail.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss` (append)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoContextRail.test.jsx`

**Interfaces:**
- Consumes: `ProgressRing` (Task 2).
- Produces: `default PianoContextRail({ poster, program, ancestors = [], ring, continue: cont, onContinue })` where `ancestors` is `[{label,onClick}]` (tappable), `ring` is `{percent,label,done}` or null, and `cont` is `{kicker,title,sub}` or null. Renders the poster, program title, tappable ancestor lines, the current-location line, the ring, and a Continue button when `cont`.

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PianoContextRail from './PianoContextRail.jsx';

describe('PianoContextRail', () => {
  it('renders program identity, ring, and a tappable ancestor', () => {
    const onClick = vi.fn();
    render(<PianoContextRail program="Piano With Jonny" ancestors={[{ label: 'Season 1', onClick }]}
      ring={{ percent: 21, label: '21%' }} />);
    expect(screen.getByText('Piano With Jonny')).toBeTruthy();
    expect(screen.getByText('21%')).toBeTruthy();
    fireEvent.click(screen.getByText('Season 1'));
    expect(onClick).toHaveBeenCalled();
  });
  it('renders a Continue button that fires onContinue', () => {
    const onContinue = vi.fn();
    render(<PianoContextRail program="P" continue={{ kicker: 'Continue', title: 'Essential Exercises', sub: 'Lesson 3' }} onContinue={onContinue} />);
    fireEvent.click(screen.getByText('Essential Exercises').closest('button'));
    expect(onContinue).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/PianoContextRail.test.jsx`
Expected: FAIL — cannot resolve `./PianoContextRail.jsx`.

- [ ] **Step 3a: Implement `PianoContextRail.jsx`**

```jsx
import ProgressRing from './ProgressRing.jsx';

export default function PianoContextRail({ poster, program, ancestors = [], ring, continue: cont, onContinue }) {
  return (
    <aside className="psc-rail">
      {poster && <img className="psc-rail__cover" src={poster} alt="" />}
      <div className="psc-rail__ctx">
        {ancestors.map((a) => (
          <button type="button" key={a.label} className="psc-rail__anc" onClick={a.onClick}>▸ {a.label}</button>
        ))}
        <div className="psc-rail__cur">{program}</div>
      </div>
      {ring && (
        <div className="psc-rail__progress">
          <ProgressRing percent={ring.percent} label={ring.label} done={ring.done} />
        </div>
      )}
      {cont && (
        <button type="button" className="psc-rail__continue" onClick={onContinue}>
          <span className="psc-rail__continue-k">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>{cont.kicker}
          </span>
          <span className="psc-rail__continue-v">{cont.title}</span>
          {cont.sub && <span className="psc-rail__continue-s">{cont.sub}</span>}
        </button>
      )}
    </aside>
  );
}
```

- [ ] **Step 3b: Append CSS to `PianoApp.scss`**

```scss
/* ── Subcourses redesign: deepening context rail ──────────────────────────── */
.psc-rail{display:flex; flex-direction:column; gap:1rem; padding:1.3rem;
  border-right:1px solid var(--piano-border); min-width:0;}
.psc-rail__cover{width:100%; max-width:150px; aspect-ratio:3/4; object-fit:cover; border-radius:var(--r-sm); border:1px solid var(--piano-border);}
.psc-rail__ctx{display:flex; flex-direction:column; gap:.15rem; align-items:flex-start;}
.psc-rail__anc{background:none; border:none; padding:0; cursor:pointer; color:var(--piano-muted); font-size:.82rem;}
.psc-rail__anc:hover,.psc-rail__anc:focus-visible{color:var(--piano-fg);}
.psc-rail__cur{color:var(--piano-fg); font-family:var(--piano-serif, Georgia, serif); font-size:1.15rem; line-height:1.15; margin-top:.15rem;}
.psc-rail__progress{display:flex; align-items:center; gap:.7rem;}
.psc-rail__continue{margin-top:auto; display:flex; flex-direction:column; gap:.3rem; text-align:left; cursor:pointer;
  background:var(--piano-accent); color:var(--piano-accent-ink); border:none; border-radius:var(--r-md); padding:.75rem .85rem;}
.psc-rail__continue-k{display:flex; align-items:center; gap:.4rem; font-family:var(--piano-mono, ui-monospace, monospace); font-size:.64rem; letter-spacing:.12em; text-transform:uppercase; opacity:.75;}
.psc-rail__continue-v{font-weight:700; font-size:.95rem; line-height:1.2;}
.psc-rail__continue-s{font-size:.76rem; opacity:.8;}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/PianoContextRail.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoContextRail.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoContextRail.test.jsx frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): PianoContextRail — deepening identity + progress + Continue"
```

---

### Task 7: Rebuild `SubcourseNavigator` around rail + panes + Continue

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/SubcourseNavigator.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss` (append the two-column stage)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/SubcourseNavigator.test.jsx` (extend)

**Interfaces:**
- Consumes: `partitionSeasons`, `programStats`, `seasonStats`, `continueTarget` (Task 1); `PianoContextRail`, `SeasonList`, `CourseCards`, `LessonList`; `usePianoBreadcrumb`.
- Produces: `default SubcourseNavigator({ course, playable, onPlay })` — a two-column stage (rail + pane) whose pane swaps Season → Course → Lesson via internal state; the rail deepens and carries Continue → the `continueTarget` lesson (calls `onPlay`). Single-course seasons collapse to lessons.

- [ ] **Step 1: Write the failing test (replace the file's tests)**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumb: () => {} }));

import SubcourseNavigator from './SubcourseNavigator.jsx';

const ep = (p, i, title, watched = false) => ({ id: `plex:${i}`, plex: String(i), parentId: String(p), itemIndex: i, title, label: title, userWatched: watched, image: `/t${i}.jpg`, duration: 300 });

const playable = {
  info: { title: 'Piano With Jonny', image: '/poster.jpg', labels: ['subcourses'] },
  parents: { 700: { index: 0, title: 'Practice Essentials' }, 701: { index: 1, title: 'Pop Soloing' } },
  referenceUnitIds: ['700'],
  items: [
    ep(700, 101, 'Practice – A'),
    ep(701, 101, 'Solo with X – 1', true), ep(701, 102, 'Solo with X – 2', false),
    ep(701, 201, 'Solo with Y – 1', false),
  ],
};

describe('SubcourseNavigator (redesign)', () => {
  it('season menu shows a graded season and a resources season', () => {
    render(<SubcourseNavigator course={{ id: '676490' }} playable={playable} onPlay={vi.fn()} />);
    expect(screen.getByText('Pop Soloing')).toBeTruthy();
    expect(screen.getByText('Practice Essentials')).toBeTruthy();
    expect(screen.getByText(/open anytime/)).toBeTruthy();
  });
  it('Continue in the rail plays the first unwatched lesson', () => {
    const onPlay = vi.fn();
    render(<SubcourseNavigator course={{ id: '676490' }} playable={playable} onPlay={onPlay} />);
    fireEvent.click(screen.getByText(/Solo with X – 2/).closest('button')); // Continue title
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ plex: '102' }));
  });
  it('drills graded season → course → lesson', () => {
    const onPlay = vi.fn();
    render(<SubcourseNavigator course={{ id: '676490' }} playable={playable} onPlay={onPlay} />);
    fireEvent.click(screen.getByTitle('Pop Soloing'));
    fireEvent.click(screen.getByText('Solo with X').closest('button')); // course card (shared prefix faded → tail "Solo with X"? see note)
    fireEvent.click(screen.getByText('Solo with X – 1').closest('button'));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ plex: '101' }));
  });
});
```

> Note: with two courses ("Solo with X …", "Solo with Y …") `sharedPrefix` yields prefix "Solo with" and tails "X …"/"Y …". Adjust the course-card click target to the actual tail text the cards render (inspect once): `screen.getByText('X – 1').closest('button')` etc. Fix the selectors to the real tails before running (the assertion on `onPlay` plex id is the real check).

- [ ] **Step 2: Correct the course-card selectors, then run to verify it fails**

Correct the drill test's course/lesson click lines to the rendered tails (prefix "Solo with" faded ⇒ course tail is "X – 1 … Solo"?). Simpler and robust: click by the card `title` attribute, which is the full label:

```jsx
    fireEvent.click(screen.getByTitle('Solo with X – 1').closest('button')); // NOTE: card title = full course label; use the course label, not a lesson
```

Replace the course-card click with `screen.getByTitle(<full course label>)` (the card sets `title={c.label}`) and the lesson click with the lesson's visible title. Then:

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/SubcourseNavigator.test.jsx`
Expected: FAIL — the navigator still renders the old bare grid, so rail/Continue/resources assertions fail.

- [ ] **Step 3a: Rebuild `SubcourseNavigator.jsx`**

```jsx
import { useMemo, useState } from 'react';
import { partitionSeasons, programStats, seasonStats, continueTarget, courseStats } from './subcourses.js';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import PianoContextRail from './PianoContextRail.jsx';
import SeasonList from './SeasonList.jsx';
import CourseCards from './CourseCards.jsx';
import LessonList from './LessonList.jsx';

export default function SubcourseNavigator({ course, playable, onPlay }) {
  const { items, parents, info, referenceUnitIds } = playable || {};
  const seasons = useMemo(() => partitionSeasons(items, parents, referenceUnitIds), [items, parents, referenceUnitIds]);
  const [seasonId, setSeasonId] = useState(null);
  const [floor, setFloor] = useState(null);

  const poster = info?.image || course?.image;
  const program = course?.title || info?.title || 'Program';

  const season = useMemo(() => seasons.find((s) => s.id === seasonId) || null, [seasons, seasonId]);
  const activeCourse = useMemo(() => {
    if (!season) return null;
    if (floor != null) return season.courses.find((c) => c.floor === floor) || null;
    if (season.courses.length === 1) return season.courses[0];
    return null;
  }, [season, floor]);
  const collapsed = !!season && season.courses.length === 1;

  const cont = useMemo(() => continueTarget(seasons), [seasons]);

  // Breadcrumb (thin path) still published; rail carries the rich version.
  const crumbs = useMemo(() => {
    const out = [{ label: program, onClick: () => { setSeasonId(null); setFloor(null); } }];
    if (season) out.push({ label: season.title || `Season ${season.index}`, onClick: (activeCourse && !collapsed) ? () => setFloor(null) : undefined });
    if (activeCourse && !collapsed) out.push({ label: activeCourse.label });
    return out;
  }, [program, season, activeCourse, collapsed]);
  usePianoBreadcrumb(crumbs);

  // Rail props per level.
  const ancestors = [];
  if (season) ancestors.push({ label: program, onClick: () => { setSeasonId(null); setFloor(null); } });
  if (activeCourse && !collapsed) ancestors.push({ label: season.title || `Season ${season.index}`, onClick: () => setFloor(null) });
  const railTitle = activeCourse ? activeCourse.label : season ? (season.title || `Season ${season.index}`) : program;
  const ring = (() => {
    if (activeCourse) { const st = courseStats(activeCourse); return activeCourse.reference ? null : { percent: st.percent, label: `${st.watched}/${st.total}`, done: st.complete }; }
    if (season) { const st = seasonStats(season); return st.reference ? null : { percent: st.percent, label: `${st.percent}%`, done: st.totalCourses > 0 && st.completeCourses === st.totalCourses }; }
    const st = programStats(seasons); return { percent: st.percent, label: `${st.percent}%`, done: st.totalCourses > 0 && st.completeCourses === st.totalCourses };
  })();
  const railContinue = cont ? { kicker: 'Continue', title: cont.lesson.label || cont.lesson.title, sub: seasons.find((s) => s.id === cont.seasonId)?.title || null } : null;

  let pane;
  if (!season) pane = <SeasonList seasons={seasons} onSelect={(s) => { setSeasonId(s.id); setFloor(null); }} />;
  else if (activeCourse) pane = <LessonList lessons={activeCourse.lessons} onPlay={onPlay} reference={activeCourse.reference} />;
  else pane = <CourseCards season={season} currentFloor={cont?.seasonId === season.id ? cont.floor : null} onSelect={(c) => setFloor(c.floor)} />;

  return (
    <section className="piano-mode--videos piano-course psc-stage">
      <PianoContextRail poster={poster} program={railTitle} ancestors={ancestors} ring={ring}
        continue={railContinue} onContinue={() => cont && onPlay(cont.lesson)} />
      <div className="psc-pane">{pane}</div>
    </section>
  );
}
```

- [ ] **Step 3b: Append the two-column stage CSS to `PianoApp.scss`**

```scss
/* ── Subcourses redesign: stage (rail + pane) ─────────────────────────────── */
.psc-stage{display:grid; grid-template-columns:minmax(220px,32%) 1fr; min-height:0;}
.psc-pane{padding:1.3rem; min-width:0; display:flex; flex-direction:column; gap:.55rem;}
@media(orientation:portrait){.psc-stage{grid-template-columns:1fr;} .psc-rail{border-right:none; border-bottom:1px solid var(--piano-border);}}
```

- [ ] **Step 4: Run the navigator test + the whole Videos suite**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos --exclude '**/.claire/**'`
Expected: PASS — the rebuilt navigator plus every existing Videos test (CourseDetail flat path untouched; the old SeasonMenu/CourseList/CourseLessons files are now unused — leave them or delete in Task 8).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/SubcourseNavigator.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/SubcourseNavigator.test.jsx frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): rebuild SubcourseNavigator around the context rail + Continue"
```

---

### Task 8: Remove superseded components + full-suite verification + build

**Files:**
- Delete: `SeasonMenu.jsx`, `SeasonMenu.test.jsx`, `CourseList.jsx`, `CourseList.test.jsx`, `CourseLessons.jsx`, `CourseLessons.test.jsx` (superseded by SeasonList/CourseCards/LessonList) — ONLY if nothing else imports them.

- [ ] **Step 1: Confirm the old components are unreferenced**

Run: `cd /opt/Code/DaylightStation && grep -rnE "SeasonMenu|CourseList|CourseLessons" frontend/src --include=*.jsx --include=*.js | grep -v "SeasonList\|CourseCards\|\.test\."`
Expected: no non-test references remain (SubcourseNavigator now uses SeasonList/CourseCards/LessonList). If any remain, stop and update them.

- [ ] **Step 2: Delete the superseded files**

```bash
cd /opt/Code/DaylightStation/frontend/src/modules/Piano/PianoKiosk/modes/Videos
git rm SeasonMenu.jsx SeasonMenu.test.jsx CourseList.jsx CourseList.test.jsx CourseLessons.jsx CourseLessons.test.jsx
```

- [ ] **Step 3: Full Videos suite + build**

Run: `cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Piano/PianoKiosk/modes/Videos --exclude '**/.claire/**'`
Expected: PASS (no references to deleted files).

Run: `npx vite build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation
git add -A frontend/src/modules/Piano/PianoKiosk/modes/Videos
git commit -m "chore(piano): drop poster-grid SeasonMenu/CourseList/CourseLessons superseded by the redesign"
```

---

## Post-implementation (manual — NOT code tasks; hold deploy for KC's word)

- Mark a whole season as reference in runtime `data/household/config/piano.yml` `videos.reference_units` (Specials/Practice Essentials → its season ratingKey) so it renders as resources. Verify via `/piano/videos/676490`.
- Build + gate-check garage/Player idle + `sudo deploy-daylight` + reload the piano tablet FKB — only on KC's word.
- Follow-on: **Plan 2** (lesson-end hand-off + cancellable auto-roll, Player integration) and **Plan 3** (flat/multi-unit path adopts rail + ring + thumbnails).

## Self-Review

**Spec coverage:** deepening rail → T6+T7; tiles-top/cards-inside → T3/T4/T5 (cards & rows, no posters inside); progress rings → T2 (+ used in T3/T4/T7); prefix-fade wordmarks → T1 `sharedPrefix` + T4; per-season tint → T3/T4 tokens; resources≠courses → T1 reference-marking/stats + T3/T4/T5 rendering + excluded denominators (`seasonStats`/`programStats`); guidance-not-gates → T5; lesson thumbnails → T5 (reuses `.piano-episode__thumb`); Continue → T1 `continueTarget` + T6/T7; breadcrumb demoted → T7 (thin crumbs, rich rail); single-course collapse → T7. Lesson-end hand-off + flat-path adoption explicitly deferred to Plans 2/3.

**Placeholder scan:** no TBD/TODO; every code step has complete code. Two test-selector caveats (T7) are explicit correction steps with a concrete fallback (`getByTitle` = full label; assert on `onPlay` plex id), not open work.

**Type consistency:** `partitionSeasons(items,parents,referenceUnitIds)` and the `Season`/`Course` shapes (`reference`, `courses`, `lessons`, `floor`, `label`) are consistent across T1/T3/T4/T5/T7; `courseStats`/`seasonStats`/`programStats`/`continueTarget` signatures match their call sites; `ProgressRing({percent,label,done})`, `SeasonList({seasons,onSelect})`, `CourseCards({season,currentFloor,onSelect})`, `LessonList({lessons,onPlay,sequential,reference})`, `PianoContextRail({poster,program,ancestors,ring,continue,onContinue})` match how T7 invokes them.
