# School Subject Page Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the flat, uniform subject-page grid with a grouped-by-content-kind, ranked, scrollable shelf (Continue → Watch → Listen → Apps → Practice), and fix the hierarchy bug where descending into a material leaves subject-level tiles on screen.

**Architecture:** A `kinds.js` registry (mirrors `subjects.js`) partitions a subject's shelf into four kinds by `medium`/source. `SubjectPage` becomes the orchestrator that renders a `ContinueRail` + one `KindSection` per non-empty kind, each with its own presentational tile component. Descent (grid → detail → player) is threaded INTO `MaterialsSection` via a render-prop so a course/app/deck detail replaces the whole shelf. One new backend summary endpoint feeds the Continue rail and started-first ranking without N Plex calls.

**Tech Stack:** React (jsx), vitest + @testing-library/react + jsdom, SCSS tokens, Node ESM backend (DDD layers), Plex-backed catalog.

**Constraints (hard):** 1280×800 landscape kiosk; `.school-app__body` is the only scroll container; **NO CSS animation** (School.scss L3 — kiosk WebView drops frames); Roboto Condensed only; existing token palette; reuse the proven MaterialsSection detail→player→gating→breadcrumb flow — do not reimplement it.

---

## Phase 0 — Design tokens & kind icons

### Task 0.1: Add `--kind-*` color tokens

**Files:**
- Modify: `frontend/src/modules/School/School.scss` (`:root`/token block near top)

**Step 1:** Add tokens after the existing school tokens:
```scss
--kind-video: #5b8dd6;  // blue — watch
--kind-audio: #b085e6;  // violet — listen
--kind-app:   #3fbfae;  // teal — do
--kind-deck:  #d9a441;  // gold — practice
```
**Step 2:** `git add` + commit `style(school): kind color tokens`.

### Task 0.2: Four kind glyph SVGs + manifest

**Files:**
- Create: `frontend/src/modules/School/home/icons/svg/kind-video.svg` (play triangle), `kind-audio.svg` (headphones), `kind-app.svg` (diamond/spark), `kind-deck.svg` (stacked cards)
- Modify: `frontend/src/modules/School/home/icons/Icon.jsx` (register names), `MANIFEST.md`
- Test: `frontend/src/modules/School/home/icons/Icon.test.jsx`

**Step 1:** Add a test asserting `<Icon name="kind-video" />` renders an `<svg>` (mirror existing Icon.test.jsx cases).
**Step 2:** Run `npx vitest run frontend/src/modules/School/home/icons/Icon.test.jsx` → FAIL (unknown name).
**Step 3:** Add the four single-path monochrome SVGs + register in Icon.jsx manifest.
**Step 4:** Re-run → PASS.
**Step 5:** Commit `feat(school): kind glyph icons`.

---

## Phase 1 — Kind registry & grouping (pure, TDD)

### Task 1.1: `groupByKind` + `KINDS`

**Files:**
- Create: `frontend/src/modules/School/home/kinds.js`
- Test: `frontend/src/modules/School/home/kinds.test.js`

**Step 1: Write failing tests**
```js
import { describe, it, expect } from 'vitest';
import { KINDS, groupByKind } from './kinds.js';

const shelf = {
  materials: [
    { id: 'v1', medium: 'video', title: 'Big History' },
    { id: 'a1', medium: 'audio', title: 'I Survived' },
  ],
  banks: [{ id: 'b1', title: 'US States' }],
  courses: [{ id: 'glossika-korean', label: 'Glossika Korean' }],
};
const programs = [{ id: 'typing', label: 'Typing', section: 'typing' }];

describe('KINDS', () => {
  it('is the four kinds in section order after Continue', () => {
    expect(KINDS.map((k) => k.id)).toEqual(['video', 'audio', 'apps', 'decks']);
  });
});

describe('groupByKind', () => {
  const g = groupByKind({ shelf, programs });
  it('splits media by medium', () => {
    expect(g.video.map((m) => m.id)).toEqual(['v1']);
    expect(g.audio.map((m) => m.id)).toEqual(['a1']);
  });
  it('apps = subject programs then language courses', () => {
    expect(g.apps.map((a) => a.id)).toEqual(['typing', 'glossika-korean']);
  });
  it('decks = banks', () => {
    expect(g.decks.map((d) => d.id)).toEqual(['b1']);
  });
  it('missing shelf pieces yield empty arrays, not crashes', () => {
    const e = groupByKind({ shelf: { materials: [], banks: [], courses: [] }, programs: [] });
    expect(e).toEqual({ video: [], audio: [], apps: [], decks: [] });
  });
});
```
**Step 2:** Run `npx vitest run frontend/src/modules/School/home/kinds.test.js` → FAIL (module missing).
**Step 3: Implement** `kinds.js`:
```js
import VideoCourseTile from './tiles/VideoCourseTile.jsx';   // added in Phase 3
import AudioCourseTile from './tiles/AudioCourseTile.jsx';
import AppTile from './tiles/AppTile.jsx';
import DeckTile from './tiles/DeckTile.jsx';

export const KINDS = [
  { id: 'video', verb: 'Watch', descriptor: 'Video courses', icon: 'kind-video', token: 'video', Tile: VideoCourseTile },
  { id: 'audio', verb: 'Listen', descriptor: 'Audio courses', icon: 'kind-audio', token: 'audio', Tile: AudioCourseTile },
  { id: 'apps', verb: 'Apps', descriptor: 'Play & practice', icon: 'kind-app', token: 'app', Tile: AppTile },
  { id: 'decks', verb: 'Practice', descriptor: 'Quizzes & flashcards', icon: 'kind-deck', token: 'deck', Tile: DeckTile },
];

export function groupByKind({ shelf, programs = [] } = {}) {
  const materials = shelf?.materials ?? [];
  return {
    video: materials.filter((m) => m.medium === 'video'),
    audio: materials.filter((m) => m.medium === 'audio'),
    apps: [...programs, ...(shelf?.courses ?? [])],
    decks: shelf?.banks ?? [],
  };
}
```
> NOTE: the `Tile` imports fail until Phase 3. To keep tests green now, ship `kinds.js` WITHOUT the `Tile` field first (Task 1.1), then add `Tile` in Task 3.5 once tiles exist. Adjust the KINDS test accordingly (assert ids only).
**Step 4:** Run → PASS.
**Step 5:** Commit `feat(school): kind registry + groupByKind`.

---

## Phase 2 — KindSection component

### Task 2.1: `KindSection`

**Files:**
- Create: `frontend/src/modules/School/home/KindSection.jsx`
- Modify: `frontend/src/modules/School/School.scss` (`.school-kind-section`, sticky header, wrap grid)
- Test: `frontend/src/modules/School/home/KindSection.test.jsx`

**Step 1: Failing test**
```jsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import KindSection from './KindSection.jsx';

const kind = { id: 'video', verb: 'Watch', descriptor: 'Video courses', icon: 'kind-video', token: 'video' };
function Tile({ item }) { return <li>{item.title}</li>; }

describe('KindSection', () => {
  it('renders the verb header with a count and each item via the tile', () => {
    render(<KindSection kind={kind} items={[{ id: 'v1', title: 'Big History' }]} Tile={Tile} onOpen={() => {}} />);
    expect(screen.getByText('Watch')).toBeTruthy();
    expect(screen.getByText(/Video courses.*1/)).toBeTruthy();
    expect(screen.getByText('Big History')).toBeTruthy();
  });
  it('renders nothing when items is empty', () => {
    const { container } = render(<KindSection kind={kind} items={[]} Tile={Tile} onOpen={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
```
**Step 2:** Run → FAIL.
**Step 3: Implement** — sticky header (`position: sticky; top: 0` inside body), `Icon name={kind.icon}` in kind color, verb 800/uppercase, `{descriptor} · {items.length}` muted; wrap grid of `<Tile item onOpen />`. Return `null` when `items.length === 0`.
**Step 4:** Run → PASS.
**Step 5:** Commit `feat(school): KindSection`.

---

## Phase 3 — Per-kind tiles (presentational)

> All tiles: pure, `({ item, onOpen })`, ≥120px min dimension, title ≥1rem, reuse `__thumb-done`/clamp patterns. Kind color only on chip + progress bar.

### Task 3.1: VideoCourseTile — portrait poster + ▶ chip + progress underline
### Task 3.2: AudioCourseTile — square art + 🎧 chip + "N works/chapters"
### Task 3.3: AppTile — wide banner, icon + name(800/uppercase) + blurb + OPEN ›, left edge band in `--kind-app`
### Task 3.4: DeckTile — card-stack motif (offset pseudo-borders), itemCount + best-accuracy, two 64px actions (port BankBrowser launch + `launchingRef` guard)

**Each task (3.1–3.4):**
- Create: `frontend/src/modules/School/home/tiles/<Name>.jsx`; Test: same dir `<Name>.test.jsx`; Modify `School.scss`.
- **Step 1:** Failing render test — asserts title, the kind-distinct metadata line, and that clicking calls `onOpen(item)` (or the deck's two actions call the right launcher).
- **Step 2:** Run → FAIL. **Step 3:** Minimal presentational impl. **Step 4:** Run → PASS. **Step 5:** Commit `feat(school): <kind> tile`.

### Task 3.5: Wire `Tile` into `kinds.js`
- Modify `kinds.js` to import the four tiles and add `Tile:` to each KIND; update `kinds.test.js` to assert `typeof k.Tile === 'function'`. Run → PASS. Commit.

---

## Phase 4 — SubjectPage rewrite + MaterialsSection render-prop (fixes hierarchy)

### Task 4.1: MaterialsSection accepts a `renderCatalog` render-prop

**Files:**
- Modify: `frontend/src/modules/School/materials/MaterialsSection.jsx:173` (the `return <MaterialGrid .../>` branch)
- Test: `tests/isolated/.../` N/A — cover via existing + a new render test `frontend/src/modules/School/materials/MaterialsSection.renderprop.test.jsx`

**Step 1: Failing test** — when `renderCatalog` is provided and no detail/collection/playing is open, MaterialsSection calls `renderCatalog({ onSelect })` instead of `<MaterialGrid>`; when a detail is open it still renders `<MaterialDetail>` (shelf replaced).
**Step 2:** Run → FAIL.
**Step 3: Implement:** default `renderCatalog = (props) => <MaterialGrid materials={materials} onSelect={props.onSelect} />`; final return becomes `return renderCatalog({ onSelect: openDetail });`. LibraryPage (no prop) unchanged.
**Step 4:** Run → PASS. **Step 5:** Commit `feat(school): MaterialsSection renderCatalog seam`.

### Task 4.2: SubjectPage orchestrates kind sections through the seam

**Files:**
- Modify (rewrite): `frontend/src/modules/School/home/SubjectPage.jsx`
- Test: `frontend/src/modules/School/home/SubjectPage.test.jsx`

**Step 1: Failing tests**
- Renders a KindSection per non-empty kind (Watch/Listen/Apps/Practice) from a mixed shelf.
- **Hierarchy:** when a material detail is open (deep-link `initialMaterialId`), the subject-level Apps/Practice sections are NOT in the document (shelf replaced by detail).
- Empty shelf → "Nothing on this shelf yet."

**Step 2:** Run → FAIL.
**Step 3: Implement:** SubjectPage renders `<MaterialsSection ... renderCatalog={({ onSelect }) => <> {ContinueRail?} {KindSections built from groupByKind, video/audio tiles call onSelect(material); apps call onOpen(section); decks via BankBrowser/DeckTile} </>} />`. Because the kind layout is the *catalog* render-prop, MaterialsSection swaps it out entirely when a detail/player opens → Apps/Practice/Continue all disappear on descent. This is the hierarchy fix.
**Step 4:** Run → PASS. **Step 5:** Commit `feat(school): grouped subject page via MaterialsSection seam (fixes shelf/detail hierarchy)`.

---

## Phase 5 — Backend progress summary endpoint (TDD)

### Task 5.1: `GetMaterialProgressSummary` use-case

**Files:**
- Create: `backend/src/3_applications/school/GetMaterialProgressSummary.mjs`
- Test: `tests/isolated/application/school/getMaterialProgressSummary.test.mjs`

**Step 1: Failing test** — given a catalog stub + progress store stub, returns `[{ materialId, unitsDone, unitTotal, nextUnitId, nextUnitTitle, percent, lastActivity }]` for materials WITH recorded progress only (zero-progress materials omitted — no Plex fan-out); optional `subject` filter.
**Step 2:** Run → FAIL.
**Step 3:** Implement composing `catalog` (60s cache) + `progressStore`. Reuse `GetMaterialUnits` lock/annotate logic for `nextUnitId` where needed, but read progress in bulk from the store (no per-material Plex call unless progress exists).
**Step 4:** Run → PASS. **Step 5:** Commit.

### Task 5.2: Route + wiring

**Files:**
- Modify: `backend/src/4_api/v1/routers/school.mjs` (add `GET /users/:userId/material-progress`), `backend/src/app.mjs` (construct + inject the use-case), `frontend/src/modules/School/schoolApi.js` (`materialProgress(userId, subject)`)
- Test: `tests/live/api/...` optional smoke; unit-cover the router mapping if a router test exists.

**Steps:** TDD the use-case (5.1); wire route/app/api as glue (verify via `node --check` + a live smoke after deploy). Commit `feat(school): material-progress summary endpoint`.

---

## Phase 6 — Continue rail + ranking

### Task 6.1: Rankers (pure, TDD)

**Files:**
- Create: `frontend/src/modules/School/home/ranking.js`
- Test: `frontend/src/modules/School/home/ranking.test.js`

**Step 1: Failing tests** — `rankWithin(items, { progress, studentGrade })` orders **in-progress** (by lastActivity desc) → **fresh** (by grade fit: |minGradeRank − studentGradeRank| asc, then original order) → **done** (last, flagged). `gradeFromBirthyear(year, now)` ≈ `now − year − 5` mapped to the ladder.
**Step 2:** Run → FAIL. **Step 3:** Implement pure. **Step 4:** PASS. **Step 5:** Commit.

### Task 6.2: ContinueRail + ContinueTile

**Files:**
- Create: `frontend/src/modules/School/home/ContinueRail.jsx`, `home/tiles/ContinueTile.jsx`; Modify `School.scss` (`.school-continue`, green accent), `SubjectPage.jsx` (mount rail when claimed + has progress).
- Test: `ContinueRail.test.jsx`

**Steps:** TDD selection (partial materials + active language reports + recent decks, union by lastActivity desc, cap 4; empty when guest/unclaimed or no progress). ContinueTile = green row card, thumb + next-action line + progress bar; tap launches next unit directly. Commit `feat(school): Continue rail`.

### Task 6.3: Apply rankers in KindSection ordering
- Modify SubjectPage to pass ranked items into each KindSection; started-first, grade-fit, done-sunk. Commit.

---

## Phase 7 — Verify

### Task 7.1: Full suite green
Run: `npx vitest run $(find tests/isolated frontend/src/modules/School -name '*.test.*')` → all PASS. Fix any regressions. Commit if needed.

### Task 7.2: Live verify (post-deploy)
After merge + deploy + restart: Playwright `/screens/portal/subject/history` (dense) and a sparse subject; confirm sections render by kind, descending into a course hides Apps/Practice, Continue rail appears for a student with progress. Screenshot-review (do not ask the user to eyeball — use a vision pass).

---

## Notes for the executor
- **Reuse, don't reimplement:** the detail→player→identity-gating→breadcrumb flow stays in MaterialsSection; the render-prop is the only change there.
- **No animation.** Emphasis = weight/color/static glow only.
- **Commit per task.** Keep tiles pure and presentational; logic (grouping, ranking, selection) is pure and unit-tested first.
- Deploy is from the homeserver tree (KC deploys); origin push is PII-blocked — do not force it.
