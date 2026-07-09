# Piano Subcourses Taxonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the piano kiosk Videos mode a four-level drill (Program › Season › Course › Lesson) for Plex shows tagged `subcourses`, where each season contains multiple independent courses partitioned by episode number.

**Architecture:** Frontend-only (Approach A). All data already arrives in the existing flat `/playable` response (`parentId` = season, `itemIndex` = `CNN`, `title`, per-user watched flags). Pure helpers partition seasons→courses→lessons; a `SubcourseNavigator` component drills through them with internal state; the existing `CourseDetailRoute` branches on the `subcourses` label and passes its single `/playable` fetch down to either the unchanged `CourseDetail` (flat/multi-unit shows) or the new navigator. Lesson playback reuses the existing player route.

**Tech Stack:** React 18, react-router-dom, Vitest + @testing-library/react. All commands run from `/opt/Code/DaylightStation/frontend`.

## Global Constraints

- **Detection signal:** a show is "subcourses" iff `info.labels` (case-insensitive) contains `subcourses`. No `piano.yml` config.
- **Partition:** course = `Math.floor(itemIndex / 100)`; lesson order = `itemIndex % 100`. Only trust numbering once the label opts the show in.
- **Course label:** shared title prefix before ` – ` (split on `/\s+[–—-]\s+/`, U+2013 en dash is the real delimiter); fallback `` `Course ${floor}` `` when lessons share no prefix (e.g. untitled Season 3).
- **Collapse:** a season with exactly one course goes straight to that course's lessons.
- **Gating:** always gate lessons within a course (mini-curriculum: each lesson locks until the previous is watched). Seasons and courses are freely browsable. No cross-course/cross-season gating.
- **Non-subcourses shows must be behaviorally unchanged.**
- **No backend changes.**
- Watched status per lesson: use `lectureUserStatus(item)` from `./lectureMeta.js` (already handles user-keyed vs device-level).
- Lesson react-key / gate-key: `item.plex || item.id`.
- Test command (single file): `npx vitest run <path>`. All new files live in `frontend/src/modules/Piano/PianoKiosk/modes/Videos/`.

---

### Task 1: Pure partition/gating helpers (`subcourses.js`)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/subcourses.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/subcourses.test.js`

**Interfaces:**
- Consumes: `lectureUserStatus` from `./lectureMeta.js`.
- Produces:
  - `isSubcourseShow(info) -> boolean`
  - `floorOf(item) -> number|null` (`Math.floor(itemIndex/100)`, null when `itemIndex < 100` or missing)
  - `roomOf(item) -> number` (`itemIndex % 100`, `Infinity` when missing)
  - `keyOf(item) -> string` (`item.plex || item.id`)
  - `splitCoursePrefix(title) -> string|null`
  - `deriveCourseLabel(lessons, floor) -> string`
  - `partitionCourses(seasonItems) -> Array<{ floor:number, label:string, lessons:Array }>` (floors ascending; lessons sorted by `roomOf`)
  - `partitionSeasons(items, parents) -> Array<{ id:string, index:number, title:string|null, thumbnail:string|null, lessons:Array, courses:Array }>` (seasons ascending by index)
  - `progressOf(items) -> { watched:number, total:number }`
  - `courseGate(sortedLessons) -> { lockedIds:Set<string>, currentId:string|null }`

- [ ] **Step 1: Write the failing test**

Create `subcourses.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  isSubcourseShow, floorOf, roomOf, keyOf, splitCoursePrefix,
  deriveCourseLabel, partitionCourses, partitionSeasons, progressOf, courseGate,
} from './subcourses.js';

const ep = (parentId, itemIndex, title, extra = {}) => ({
  id: `plex:${itemIndex}`, plex: String(itemIndex), parentId: String(parentId), itemIndex, title, ...extra,
});

describe('isSubcourseShow', () => {
  it('is true when labels contain subcourses (case-insensitive)', () => {
    expect(isSubcourseShow({ labels: ['Subcourses'] })).toBe(true);
    expect(isSubcourseShow({ labels: ['sequential'] })).toBe(false);
    expect(isSubcourseShow({})).toBe(false);
    expect(isSubcourseShow(null)).toBe(false);
  });
});

describe('floorOf / roomOf / keyOf', () => {
  it('splits CNN into floor and room', () => {
    expect(floorOf({ itemIndex: 205 })).toBe(2);
    expect(roomOf({ itemIndex: 205 })).toBe(5);
    expect(floorOf({ itemIndex: 3 })).toBe(null); // <100 = not a floor
  });
  it('keyOf prefers plex then id', () => {
    expect(keyOf({ plex: '9', id: 'plex:9' })).toBe('9');
    expect(keyOf({ id: 'plex:7' })).toBe('plex:7');
  });
});

describe('splitCoursePrefix / deriveCourseLabel', () => {
  it('takes the text before the en-dash', () => {
    expect(splitCoursePrefix('Pop Soloing – Pop Chords')).toBe('Pop Soloing');
    expect(splitCoursePrefix('Episode 101')).toBe(null);
  });
  it('labels a course by its shared prefix', () => {
    const lessons = [ep(1, 101, 'Pop Soloing – A'), ep(1, 102, 'Pop Soloing – B')];
    expect(deriveCourseLabel(lessons, 1)).toBe('Pop Soloing');
  });
  it('falls back to Course N when there is no shared prefix', () => {
    const lessons = [ep(1, 101, 'Episode 101'), ep(1, 102, 'Episode 102')];
    expect(deriveCourseLabel(lessons, 4)).toBe('Course 4');
  });
});

describe('partitionCourses', () => {
  it('groups a season into floors, ordered, lessons by room', () => {
    const items = [
      ep(1, 102, 'X – two'), ep(1, 101, 'X – one'),
      ep(1, 201, 'Y – one'), ep(1, 203, 'Y – three'), ep(1, 202, 'Y – two'),
    ];
    const courses = partitionCourses(items);
    expect(courses.map((c) => c.floor)).toEqual([1, 2]);
    expect(courses[0].label).toBe('X');
    expect(courses[0].lessons.map((l) => l.itemIndex)).toEqual([101, 102]);
    expect(courses[1].lessons.map((l) => l.itemIndex)).toEqual([201, 202, 203]);
  });
});

describe('partitionSeasons', () => {
  it('orders seasons by index and nests their courses', () => {
    const items = [ep(676507, 101, 'X – one'), ep(676540, 101, 'Z – one')];
    const parents = {
      676507: { index: 1, title: 'Season 1', thumbnail: '/t1' },
      676540: { index: 0, title: 'Specials', thumbnail: '/t0' },
    };
    const seasons = partitionSeasons(items, parents);
    expect(seasons.map((s) => s.title)).toEqual(['Specials', 'Season 1']);
    expect(seasons[0].courses.length).toBe(1);
    expect(seasons[1].courses[0].label).toBe('X');
  });
});

describe('progressOf', () => {
  it('counts watched lessons for the current user', () => {
    const items = [ep(1, 101, 'A', { userWatched: true }), ep(1, 102, 'B', { userWatched: false })];
    expect(progressOf(items)).toEqual({ watched: 1, total: 2 });
  });
});

describe('courseGate', () => {
  it('locks every lesson after the first unwatched one; marks it current', () => {
    const lessons = [
      ep(1, 101, 'A', { userWatched: true }),
      ep(1, 102, 'B', { userWatched: false }),
      ep(1, 103, 'C', { userWatched: false }),
    ];
    const { lockedIds, currentId } = courseGate(lessons);
    expect(currentId).toBe('102');
    expect(lockedIds.has('103')).toBe(true);
    expect(lockedIds.has('102')).toBe(false);
    expect(lockedIds.has('101')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/subcourses.test.js`
Expected: FAIL — `Failed to resolve import "./subcourses.js"`.

- [ ] **Step 3: Write minimal implementation**

Create `subcourses.js`:

```js
// subcourses.js — pure helpers for "subcourses" multi-course shows.
// A subcourses show (Plex label `subcourses`) numbers episodes CNN: the hundreds
// digit is the COURSE within a season, the last two digits the LESSON within it.
import { lectureUserStatus } from './lectureMeta.js';

export function isSubcourseShow(info) {
  const labels = info?.labels;
  if (!Array.isArray(labels)) return false;
  return labels.some((l) => String(l).toLowerCase() === 'subcourses');
}

export const keyOf = (item) => String(item?.plex || item?.id || '');

export function floorOf(item) {
  const n = Number(item?.itemIndex);
  if (!Number.isFinite(n) || n < 100) return null;
  return Math.floor(n / 100);
}

export function roomOf(item) {
  const n = Number(item?.itemIndex);
  return Number.isFinite(n) ? n % 100 : Infinity;
}

export function splitCoursePrefix(title) {
  if (typeof title !== 'string') return null;
  const parts = title.split(/\s+[–—-]\s+/);
  return parts.length > 1 ? parts[0].trim() : null;
}

export function deriveCourseLabel(lessons, floor) {
  const prefixes = (lessons || []).map((l) => splitCoursePrefix(l?.title));
  const first = prefixes[0];
  if (first && prefixes.every((p) => p === first)) return first;
  return `Course ${floor}`;
}

export function partitionCourses(seasonItems) {
  const groups = new Map();
  for (const it of seasonItems || []) {
    const f = floorOf(it) ?? 0;
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(it);
  }
  return [...groups.keys()].sort((a, b) => a - b).map((floor) => {
    const lessons = groups.get(floor).slice().sort((a, b) => roomOf(a) - roomOf(b));
    return { floor, label: deriveCourseLabel(lessons, floor), lessons };
  });
}

export function partitionSeasons(items, parents) {
  if (!parents || typeof parents !== 'object') return [];
  const seasons = Object.entries(parents).map(([id, p]) => ({
    id: String(id),
    index: Number.isFinite(p?.index) ? p.index : (parseInt(p?.index, 10) || 0),
    title: p?.title || null,
    thumbnail: p?.thumbnail || null,
  })).sort((a, b) => a.index - b.index);
  return seasons.map((s) => {
    const lessons = (items || []).filter((it) => String(it.parentId) === s.id);
    return { ...s, lessons, courses: partitionCourses(lessons) };
  });
}

export function progressOf(items) {
  const list = items || [];
  const watched = list.filter((it) => lectureUserStatus(it).watched).length;
  return { watched, total: list.length };
}

export function courseGate(sortedLessons) {
  const lockedIds = new Set();
  let currentId = null;
  let gateClosed = false;
  for (const ep of sortedLessons || []) {
    const k = keyOf(ep);
    if (gateClosed) { lockedIds.add(k); continue; }
    if (!lectureUserStatus(ep).watched) { currentId = k; gateClosed = true; }
  }
  return { lockedIds, currentId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/subcourses.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/subcourses.js frontend/src/modules/Piano/PianoKiosk/modes/Videos/subcourses.test.js
git commit -m "feat(piano): pure helpers to partition subcourses shows into season/course/lesson"
```

---

### Task 2: Lesson list with per-course gating (`CourseLessons.jsx`)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseLessons.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseLessons.test.jsx`

**Interfaces:**
- Consumes: `courseGate`, `keyOf` from `./subcourses.js`; `lectureUserStatus` from `./lectureMeta.js`; `LockIcon` from `@/modules/Fitness/player/overlays/LockIcon.jsx`.
- Produces: `default CourseLessons({ lessons, onPlay, sequential = true })` — renders a `<ul className="piano-episodes">`; locked lessons are `disabled` and do not call `onPlay`.

- [ ] **Step 1: Write the failing test**

Create `CourseLessons.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CourseLessons from './CourseLessons.jsx';

const ep = (i, title, extra = {}) => ({ plex: String(i), id: `plex:${i}`, itemIndex: i, label: title, ...extra });

describe('CourseLessons', () => {
  it('renders every lesson', () => {
    render(<CourseLessons lessons={[ep(101, 'A'), ep(102, 'B')]} onPlay={vi.fn()} />);
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText('B')).toBeTruthy();
  });

  it('gates: locks lessons after the first unwatched, plays an open one', () => {
    const onPlay = vi.fn();
    render(<CourseLessons onPlay={onPlay} lessons={[
      ep(101, 'A', { userWatched: true }),
      ep(102, 'B', { userWatched: false }),
      ep(103, 'C', { userWatched: false }),
    ]} />);
    const bBtn = screen.getByText('B').closest('button');
    const cBtn = screen.getByText('C').closest('button');
    expect(bBtn.className).toContain('piano-episode--current');
    expect(cBtn.disabled).toBe(true);
    fireEvent.click(cBtn);
    expect(onPlay).not.toHaveBeenCalled();
    fireEvent.click(bBtn);
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ plex: '102' }));
  });

  it('sequential=false leaves all lessons open', () => {
    const onPlay = vi.fn();
    render(<CourseLessons sequential={false} onPlay={onPlay} lessons={[
      ep(101, 'A', { userWatched: false }), ep(102, 'B', { userWatched: false }),
    ]} />);
    fireEvent.click(screen.getByText('B').closest('button'));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ plex: '102' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/CourseLessons.test.jsx`
Expected: FAIL — cannot resolve `./CourseLessons.jsx`.

- [ ] **Step 3: Write minimal implementation**

Create `CourseLessons.jsx`:

```jsx
import { useMemo } from 'react';
import { courseGate, keyOf } from './subcourses.js';
import { lectureUserStatus } from './lectureMeta.js';
import LockIcon from '@/modules/Fitness/player/overlays/LockIcon.jsx';

/**
 * Lessons of one course (one CNN "floor"). Sequential by default — each lesson
 * locks until the previous one is watched (a mini-curriculum). Reuses the
 * `.piano-episode` presentation used by the flat CourseDetail.
 */
export default function CourseLessons({ lessons, onPlay, sequential = true }) {
  const { lockedIds, currentId } = useMemo(
    () => (sequential ? courseGate(lessons) : { lockedIds: new Set(), currentId: null }),
    [sequential, lessons],
  );

  return (
    <ul className="piano-episodes">
      {(lessons || []).map((item) => {
        const k = keyOf(item);
        const st = lectureUserStatus(item);
        const img = item.image || item.thumbnail;
        const locked = lockedIds.has(k);
        const current = k === currentId;
        return (
          <li key={k}>
            <button
              type="button"
              className={['piano-episode', locked && 'piano-episode--locked', current && 'piano-episode--current'].filter(Boolean).join(' ')}
              onClick={() => { if (!locked) onPlay(item); }}
              disabled={locked}
              aria-disabled={locked}
              aria-current={current ? 'true' : undefined}
            >
              <div className="piano-episode__thumb">
                {img && <img src={img} alt="" loading="eager" decoding="async" />}
                {locked && <span className="piano-episode__lock" aria-label="Locked"><LockIcon /></span>}
                {!locked && st.watched && (
                  <span className="piano-episode__check" aria-label="Completed"><span className="piano-episode__check-mark">✓</span></span>
                )}
                {!locked && !st.watched && st.percent > 0 && (
                  <span className="piano-episode__bar"><span style={{ width: `${st.percent}%` }} /></span>
                )}
              </div>
              <div className="piano-episode__label">
                <span className="piano-episode__title">{item.label || item.title}</span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/CourseLessons.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseLessons.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseLessons.test.jsx
git commit -m "feat(piano): CourseLessons — per-course sequential lesson list"
```

---

### Task 3: Course tiles for a season (`CourseList.jsx`)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseList.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseList.test.jsx`

**Interfaces:**
- Consumes: `progressOf` from `./subcourses.js`.
- Produces: `default CourseList({ courses, poster, onSelect })` — grid of tiles; `onSelect(course)` fires with the `{ floor, label, lessons }` object.

- [ ] **Step 1: Write the failing test**

Create `CourseList.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CourseList from './CourseList.jsx';

const courses = [
  { floor: 1, label: 'Pop Soloing', lessons: [{ plex: '1', userWatched: true }, { plex: '2', userWatched: false }] },
  { floor: 2, label: 'Slip Notes', lessons: [{ plex: '3', userWatched: false }] },
];

describe('CourseList', () => {
  it('renders each course label with watched/total', () => {
    render(<CourseList courses={courses} poster="/p.jpg" onSelect={() => {}} />);
    expect(screen.getByText('Pop Soloing')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy();
    expect(screen.getByText('0/1')).toBeTruthy();
  });

  it('calls onSelect with the course when tapped', () => {
    const onSelect = vi.fn();
    render(<CourseList courses={courses} poster="/p.jpg" onSelect={onSelect} />);
    fireEvent.click(screen.getByTitle('Slip Notes'));
    expect(onSelect).toHaveBeenCalledWith(courses[1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/CourseList.test.jsx`
Expected: FAIL — cannot resolve `./CourseList.jsx`.

- [ ] **Step 3: Write minimal implementation**

Create `CourseList.jsx`:

```jsx
import { progressOf } from './subcourses.js';

/**
 * The courses within one season (each a CNN "floor"). Courses share the show's
 * poster; the tile caption carries the course name + per-user watched count.
 */
export default function CourseList({ courses, poster, onSelect }) {
  return (
    <ul className="piano-video-grid piano-video-grid--posters piano-subcourse-menu">
      {(courses || []).map((c) => {
        const { watched, total } = progressOf(c.lessons);
        return (
          <li key={c.floor}>
            <button type="button" className="piano-video-grid__tile piano-subcourse-tile" onClick={() => onSelect(c)} title={c.label}>
              {poster && <img src={poster} alt="" loading="lazy" decoding="async" className="piano-cover" />}
              <span className="piano-subcourse-tile__label">{c.label}</span>
              <span className="piano-subcourse-tile__meta">{watched}/{total}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/CourseList.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseList.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseList.test.jsx
git commit -m "feat(piano): CourseList — course tiles within a subcourses season"
```

---

### Task 4: Season tiles for a program (`SeasonMenu.jsx`)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/SeasonMenu.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/SeasonMenu.test.jsx`

**Interfaces:**
- Consumes: `progressOf` from `./subcourses.js`.
- Produces: `default SeasonMenu({ seasons, poster, onSelect })` — grid of season tiles; caption shows season title, course count, watched/total; `onSelect(season)` fires with the season object.

- [ ] **Step 1: Write the failing test**

Create `SeasonMenu.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SeasonMenu from './SeasonMenu.jsx';

const seasons = [
  { id: '676540', index: 0, title: 'Specials', thumbnail: '/s0.jpg',
    lessons: [{ plex: '1', userWatched: true }], courses: [{ floor: 1 }] },
  { id: '676507', index: 1, title: 'Season 1', thumbnail: null,
    lessons: [{ plex: '2', userWatched: false }, { plex: '3', userWatched: false }], courses: [{ floor: 1 }, { floor: 2 }] },
];

describe('SeasonMenu', () => {
  it('renders each season with course count and watched/total', () => {
    render(<SeasonMenu seasons={seasons} poster="/p.jpg" onSelect={() => {}} />);
    expect(screen.getByText('Specials')).toBeTruthy();
    expect(screen.getByText('1 course · 1/1')).toBeTruthy();
    expect(screen.getByText('2 courses · 0/2')).toBeTruthy();
  });

  it('calls onSelect with the season when tapped', () => {
    const onSelect = vi.fn();
    render(<SeasonMenu seasons={seasons} poster="/p.jpg" onSelect={onSelect} />);
    fireEvent.click(screen.getByTitle('Season 1'));
    expect(onSelect).toHaveBeenCalledWith(seasons[1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/SeasonMenu.test.jsx`
Expected: FAIL — cannot resolve `./SeasonMenu.jsx`.

- [ ] **Step 3: Write minimal implementation**

Create `SeasonMenu.jsx`:

```jsx
import { progressOf } from './subcourses.js';

/**
 * The seasons of a subcourses program. Each tile shows the season poster (or the
 * program poster), the season title, and "N courses · watched/total".
 */
export default function SeasonMenu({ seasons, poster, onSelect }) {
  return (
    <ul className="piano-video-grid piano-video-grid--posters piano-subcourse-menu">
      {(seasons || []).map((s) => {
        const { watched, total } = progressOf(s.lessons);
        const count = s.courses.length;
        const name = s.title || `Season ${s.index}`;
        return (
          <li key={s.id}>
            <button type="button" className="piano-video-grid__tile piano-subcourse-tile" onClick={() => onSelect(s)} title={name}>
              {(s.thumbnail || poster) && <img src={s.thumbnail || poster} alt="" loading="lazy" decoding="async" className="piano-cover" />}
              <span className="piano-subcourse-tile__label">{name}</span>
              <span className="piano-subcourse-tile__meta">{count} course{count === 1 ? '' : 's'} · {watched}/{total}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/SeasonMenu.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/SeasonMenu.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/SeasonMenu.test.jsx
git commit -m "feat(piano): SeasonMenu — season tiles for a subcourses program"
```

---

### Task 5: Drill-in state machine (`SubcourseNavigator.jsx`)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/SubcourseNavigator.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/SubcourseNavigator.test.jsx`

**Interfaces:**
- Consumes: `partitionSeasons` from `./subcourses.js`; `SeasonMenu`, `CourseList`, `CourseLessons`; `usePianoBreadcrumb` from `../../PianoBreadcrumbContext.jsx`.
- Produces: `default SubcourseNavigator({ course, playable, onPlay })`. `playable` is the object returned by `usePianoCoursePlayable` (`{ items, parents, info }`). Internal `useState` drives Season → Course → Lessons; a season with one course collapses straight to lessons. `onPlay(lesson)` bubbles to the caller (which navigates to the player route).

- [ ] **Step 1: Write the failing test**

Create `SubcourseNavigator.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumb: () => {} }));

import SubcourseNavigator from './SubcourseNavigator.jsx';

const ep = (parentId, itemIndex, title, extra = {}) => ({
  id: `plex:${itemIndex}`, plex: String(itemIndex), parentId: String(parentId), itemIndex, title, label: title, ...extra,
});

// Specials = single course (collapses); Season 1 = two courses.
const playable = {
  info: { title: 'Piano With Jonny', image: '/poster.jpg', labels: ['subcourses'] },
  parents: {
    676540: { index: 0, title: 'Specials' },
    676507: { index: 1, title: 'Season 1' },
  },
  items: [
    ep(676540, 101, 'Practice Essentials – How to Practice'),
    ep(676507, 101, 'Pop Soloing – Pop Chords'),
    ep(676507, 201, 'Slip Notes – Intro'),
  ],
};

describe('SubcourseNavigator', () => {
  it('starts on the season menu', () => {
    render(<SubcourseNavigator course={{ id: '676490' }} playable={playable} onPlay={vi.fn()} />);
    expect(screen.getByText('Specials')).toBeTruthy();
    expect(screen.getByText('Season 1')).toBeTruthy();
  });

  it('multi-course season → course list → lessons', () => {
    const onPlay = vi.fn();
    render(<SubcourseNavigator course={{ id: '676490' }} playable={playable} onPlay={onPlay} />);
    fireEvent.click(screen.getByTitle('Season 1'));
    expect(screen.getByText('Pop Soloing')).toBeTruthy(); // course tile
    expect(screen.getByText('Slip Notes')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Pop Soloing'));
    fireEvent.click(screen.getByText('Pop Chords').closest('button')); // lesson title is suffix only? no — label is full title
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ plex: '101', parentId: '676507' }));
  });

  it('single-course season collapses straight to its lessons', () => {
    render(<SubcourseNavigator course={{ id: '676490' }} playable={playable} onPlay={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Specials'));
    // No course-list step; the lesson is shown directly.
    expect(screen.getByText('Practice Essentials – How to Practice')).toBeTruthy();
  });
});
```

> Note: lesson buttons render `item.label || item.title` (the full title, e.g. `Pop Soloing – Pop Chords`). Adjust the click target in step to the full label if needed — see the corrected assertion in Step 3's component (lesson label is the full title). Update the middle test's lesson click to `screen.getByText('Pop Soloing – Pop Chords')` before running.

- [ ] **Step 2: Correct the test's lesson lookup, then run to verify it fails**

Edit the middle test's lesson click line to:

```jsx
    fireEvent.click(screen.getByText('Pop Soloing – Pop Chords').closest('button'));
```

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/SubcourseNavigator.test.jsx`
Expected: FAIL — cannot resolve `./SubcourseNavigator.jsx`.

- [ ] **Step 3: Write minimal implementation**

Create `SubcourseNavigator.jsx`:

```jsx
import { useMemo, useState } from 'react';
import { partitionSeasons } from './subcourses.js';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import SeasonMenu from './SeasonMenu.jsx';
import CourseList from './CourseList.jsx';
import CourseLessons from './CourseLessons.jsx';

/**
 * Drill-in for a "subcourses" program: Season menu → Course list → Lessons.
 * A season with exactly one course collapses straight to its lessons. Navigation
 * is internal state (season/course selection resets on reload — a kiosk lands
 * back on the season menu, consistent with the footer-Back-to-root convention);
 * lesson playback bubbles up via onPlay to the existing player route.
 */
export default function SubcourseNavigator({ course, playable, onPlay }) {
  const { items, parents, info } = playable || {};
  const seasons = useMemo(() => partitionSeasons(items, parents), [items, parents]);
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

  const crumbs = useMemo(() => {
    const out = [{ label: program, onClick: () => { setSeasonId(null); setFloor(null); } }];
    if (season) {
      out.push({
        label: season.title || `Season ${season.index}`,
        onClick: (activeCourse && !collapsed) ? () => setFloor(null) : undefined,
      });
    }
    if (activeCourse && !collapsed) out.push({ label: activeCourse.label });
    return out;
  }, [program, season, activeCourse, collapsed]);
  usePianoBreadcrumb(crumbs);

  let body;
  if (!season) {
    body = <SeasonMenu seasons={seasons} poster={poster} onSelect={(s) => { setSeasonId(s.id); setFloor(null); }} />;
  } else if (activeCourse) {
    body = <CourseLessons lessons={activeCourse.lessons} onPlay={onPlay} />;
  } else {
    body = <CourseList courses={season.courses} poster={poster} onSelect={(c) => setFloor(c.floor)} />;
  }

  return <section className="piano-mode--videos piano-course piano-subcourse">{body}</section>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/SubcourseNavigator.test.jsx`
Expected: PASS (all three: season menu, drill to lessons, collapse).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/SubcourseNavigator.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/SubcourseNavigator.test.jsx
git commit -m "feat(piano): SubcourseNavigator — season/course/lesson drill-in"
```

---

### Task 6: Wire the label branch into the Videos router + styles

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.jsx` (accept an optional `playable` prop so the route can pass its single fetch down)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.jsx` (fetch once in the show route; branch on `isSubcourseShow`)
- Modify: `frontend/src/Apps/PianoApp.scss` (append subcourse tile caption styles)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.subcourse.test.jsx`

**Interfaces:**
- Consumes: `isSubcourseShow` from `./subcourses.js`; `SubcourseNavigator` from `./SubcourseNavigator.jsx`; existing `usePianoCoursePlayable`, `lectureContentId`.
- Produces: exported `CourseDetailRoute` from `Videos.jsx` (renamed responsibility: fetch + branch), used by the router and testable in isolation. `CourseDetail` gains prop `playable` — when provided it is used verbatim and the internal hook does no fetch (called with `null`); when absent, behavior is exactly as today.

- [ ] **Step 1: Write the failing test**

Create `Videos.subcourse.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

let hookReturn;
vi.mock('./usePianoCoursePlayable.js', () => ({ usePianoCoursePlayable: () => hookReturn }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'kckern', currentProfile: {}, users: [] }) }));
vi.mock('./CourseDetail.jsx', () => ({ default: () => <div data-testid="flat">FLAT</div> }));
vi.mock('./SubcourseNavigator.jsx', () => ({ default: () => <div data-testid="nav">NAV</div> }));

import { CourseDetailRoute } from './Videos.jsx';

const renderRoute = () => render(
  <MemoryRouter initialEntries={['/676490']}>
    <Routes><Route path=":courseId" element={<CourseDetailRoute />} /></Routes>
  </MemoryRouter>,
);

describe('CourseDetailRoute branch', () => {
  beforeEach(() => { hookReturn = { items: null, info: {}, parents: null, isSequential: false, loading: true, error: null }; });

  it('renders the flat CourseDetail for a non-subcourses show', () => {
    hookReturn = { ...hookReturn, loading: false, info: { type: 'show', labels: [] } };
    renderRoute();
    expect(screen.getByTestId('flat')).toBeTruthy();
  });

  it('renders the SubcourseNavigator when the show is labeled subcourses', () => {
    hookReturn = { ...hookReturn, loading: false, info: { type: 'show', labels: ['subcourses'] } };
    renderRoute();
    expect(screen.getByTestId('nav')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/Videos.subcourse.test.jsx`
Expected: FAIL — `CourseDetailRoute` is not exported (import is `undefined`).

- [ ] **Step 3a: Make `CourseDetail` accept an optional `playable` prop**

In `CourseDetail.jsx`, change the component signature and the data source. Replace:

```jsx
export default function CourseDetail({ course, onPlay }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-video-detail' }), []);
  const { currentUser, currentProfile, users } = usePianoUser();
  const courseId = idOf(course?.id);
  const { items, info, parents, isSequential, loading, error, coProgressLock, referenceUnitIds } = usePianoCoursePlayable(courseId, currentUser);
```

with:

```jsx
export default function CourseDetail({ course, onPlay, playable }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-video-detail' }), []);
  const { currentUser, currentProfile, users } = usePianoUser();
  const courseId = idOf(course?.id);
  // When a parent already fetched the course (the show route), reuse it and skip
  // a second network call; otherwise fetch here (standalone use / existing tests).
  const fetched = usePianoCoursePlayable(playable ? null : courseId, playable ? null : currentUser);
  const { items, info, parents, isSequential, loading, error, coProgressLock, referenceUnitIds } = playable ?? fetched;
```

- [ ] **Step 3b: Fetch once and branch in `Videos.jsx`**

In `Videos.jsx`, add imports near the existing ones:

```jsx
import { isSubcourseShow } from './subcourses.js';
import SubcourseNavigator from './SubcourseNavigator.jsx';
```

Replace the route line for the course detail. Change:

```jsx
      <Route path=":courseId" element={<CourseDetailRoute />} />
```

(leave the `index` and `:courseId/:lectureId` routes untouched.)

Then replace the whole `CourseDetailRoute` function:

```jsx
/** Course detail → push the lecture contentId (relative); Back goes up a level. */
function CourseDetailRoute() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-videos' }), []);
  const { courseId } = useParams();
  const navigate = useNavigate();
  const course = useMemo(() => ({ id: courseId }), [courseId]);
  return (
    <CourseDetail
      course={course}
      onPlay={(item) => {
        const contentId = lectureContentId(item);
        logger.info('piano.video-play', { contentId });
        navigate(`${contentId}`);
      }}
    />
  );
}
```

with:

```jsx
/**
 * Show route — fetches the course once and branches: a Plex show labeled
 * `subcourses` drills through the SubcourseNavigator (season → course → lesson);
 * every other course renders the flat/multi-unit CourseDetail. Both receive the
 * single /playable fetch so nothing is fetched twice.
 */
export function CourseDetailRoute() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-videos' }), []);
  const { courseId } = useParams();
  const { currentUser } = usePianoUser();
  const navigate = useNavigate();
  const playable = usePianoCoursePlayable(idOf(courseId), currentUser);
  const course = useMemo(() => ({ id: courseId }), [courseId]);
  const onPlay = useCallback((item) => {
    const contentId = lectureContentId(item);
    logger.info('piano.video-play', { contentId });
    navigate(`${contentId}`);
  }, [navigate, logger]);

  if (isSubcourseShow(playable.info)) {
    return <SubcourseNavigator course={course} playable={playable} onPlay={onPlay} />;
  }
  return <CourseDetail course={course} playable={playable} onPlay={onPlay} />;
}
```

Add `useCallback` and `usePianoUser` to the imports if not already present. `Videos.jsx` already imports `usePianoUser` (used by `LecturePlayerRoute`) and `useCallback` (used there too) — verify both are in the top import list; add any missing.

- [ ] **Step 3c: Append subcourse caption styles**

Append to the end of `frontend/src/Apps/PianoApp.scss`:

```scss
/* subcourse drill-in — season/course captions layered under the shared poster */
.piano-subcourse-tile { position: relative; text-align: left; }
.piano-subcourse-tile__label {
  display: block; margin-top: 0.35rem; font-weight: 600; line-height: 1.2;
}
.piano-subcourse-tile__meta {
  display: block; font-size: 0.85em; opacity: 0.7; margin-top: 0.1rem;
}
```

- [ ] **Step 4: Run the branch test + the existing CourseDetail suite (no regressions)**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/Videos.subcourse.test.jsx src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.test.jsx`
Expected: PASS — both the new branch test and every existing `CourseDetail` test (the optional-prop change is backward compatible; those tests pass no `playable` and hit the mocked hook path).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.jsx frontend/src/Apps/PianoApp.scss frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.subcourse.test.jsx
git commit -m "feat(piano): route subcourses-labeled shows through the drill-in navigator"
```

---

### Task 7: Full-suite regression + build

**Files:** none (verification only).

- [ ] **Step 1: Run the whole Videos suite**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos --exclude '**/.claire/**'`
Expected: PASS. (The `.claire` exclude keeps a nested worktree copy from polluting results — see repo memory.)

- [ ] **Step 2: Build the frontend**

Run: `npx vite build`
Expected: Build succeeds with no errors referencing the new modules.

- [ ] **Step 3: Commit (only if the build produced tracked changes; otherwise skip)**

```bash
git status --porcelain
# If nothing to commit, this task adds no commit — verification only.
```

---

## Post-implementation (manual, on kckern-server)

Not part of the TDD tasks, but required to see it live (this repo *is* prod — see CLAUDE.local.md):

1. Build + deploy the container (`docker build` → `sudo deploy-daylight`), **only if the garage isn't mid-workout and no Player video is playing** (check per CLAUDE.local.md gates).
2. The piano tablet serves the old bundle until reloaded — hard-reload it (`cli/fkb.cli.mjs` `loadStartURL` for the piano tablet `10.0.0.245:2323`).
3. Open `https://daylightlocal.kckern.net/piano/videos/676490` and verify: season menu (Specials/Season 1/Season 2/Season 3) → Specials collapses to its 3 lessons → Season 1 shows named courses → Season 3 shows "Course 1..9" → a lesson plays, and gating locks lesson 2 until lesson 1 is watched.

---

## Self-Review

**Spec coverage:**
- Detection via `subcourses` label → Task 1 (`isSubcourseShow`), Task 6 (branch). ✓
- CNN partition (floor/room) → Task 1 (`floorOf`/`roomOf`/`partitionCourses`). ✓
- Course label prefix + `Course N` fallback → Task 1 (`splitCoursePrefix`/`deriveCourseLabel`). ✓
- 4-level taxonomy + collapse single-course seasons → Task 5 (`SubcourseNavigator`), Task 4/3 tiles. ✓
- Within-course sequential gating; seasons/courses free → Task 1 (`courseGate`), Task 2 (`CourseLessons`). ✓
- Client-side progress overlays → Task 1 (`progressOf`), Tasks 3/4. ✓
- Single `/playable` fetch, non-subcourses unchanged → Task 6 (optional `playable` prop + branch; existing CourseDetail suite re-run). ✓
- No backend change → confirmed; all tasks are frontend. ✓
- Breadcrumbs Program › Season › Course → Task 5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The one prose caveat (Task 5 lesson-label lookup) is resolved by an explicit edit step (Step 2). ✓

**Type consistency:** `keyOf`, `floorOf`, `roomOf`, `partitionCourses` (`{floor,label,lessons}`), `partitionSeasons` (`{id,index,title,thumbnail,lessons,courses}`), `progressOf` (`{watched,total}`), `courseGate` (`{lockedIds,currentId}`) are used with identical shapes in Tasks 2–6. `CourseLessons({lessons,onPlay,sequential})`, `CourseList({courses,poster,onSelect})`, `SeasonMenu({seasons,poster,onSelect})`, `SubcourseNavigator({course,playable,onPlay})` match their call sites. ✓
