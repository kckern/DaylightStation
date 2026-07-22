# School Nine-Subject Wall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the School home subject wall from six shelves to nine (3×3 grid) with an inline-SVG icon per shelf, per spec `docs/superpowers/specs/2026-07-22-school-nine-subjects-design.md`.

**Architecture:** The shelf list is a fixed code-level array in `frontend/src/modules/School/home/subjects.js`; grouping is frontend-only (backend passes `subject` through untouched). Icons follow the PianoKiosk pattern: raw SVGs loaded via `import.meta.glob(..., ?raw)` and rendered inline so `currentColor` inherits tile text color. Prod content restamps are YAML edits in the boot-cached `school.yml`, picked up by the deploy restart.

**Tech Stack:** React (jsx), SCSS, vitest (frontend co-located tests), Solar Bold SVGs via Iconify API, docker build + `deploy-daylight`.

## Global Constraints

- Shelf ids, exactly, in order: `english, literature, writing, math, science, skills, history, geography, language` (spec table order = grid order, row-major).
- Labels/hints verbatim from the spec table (`Math & Money` — ampersand, not "and").
- `civilization` id is deleted; unknown subjects route to Library (existing rule — do not add a migration shim).
- Icons: `fill="currentColor"`, `width="1em" height="1em" viewBox="0 0 24 24"`, one `<svg>` per file — same normalization as `frontend/src/modules/Piano/PianoKiosk/icons/svg/*`.
- No raw `console.*` logging; no animation on kiosk surfaces.
- Deploy only after the CLAUDE.local.md playback/fitness gate check, run as its own step.

---

### Task 1: Nine shelves in `subjects.js`

**Files:**
- Modify: `frontend/src/modules/School/home/subjects.js`
- Test: `frontend/src/modules/School/home/subjects.test.js`

**Interfaces:**
- Produces: `SUBJECTS: Array<{id,label,hint}>` (nine entries, grid order), `groupBySubject`, `subjectHasContent`, `subjectLabel` — signatures unchanged; only the id set changes. Task 2/3 consume `SUBJECTS[].id` as icon filenames.

- [ ] **Step 1: Update the test to expect nine shelves**

In `subjects.test.js`, replace the `SUBJECTS` describe block:

```javascript
describe('SUBJECTS', () => {
  it('is the nine agreed shelves in grid order', () => {
    expect(SUBJECTS.map((s) => s.id)).toEqual([
      'english', 'literature', 'writing',
      'math', 'science', 'skills',
      'history', 'geography', 'language',
    ]);
  });
});
```

In the `groupBySubject` fixtures, retire `civilization`/`reading` stamps in favour of new ids while keeping the unknown-subject case:
- `m1` Shakespeare Tales: `subject: 'literature'`
- `m3` Atlas (reference): `subject: 'geography'` (still expects Library — reference always wins)
- `b1` US State Capitals bank: `subject: 'geography'`
- Update the corresponding assertions: `bySubject.literature.materials` contains m1; `bySubject.geography.banks` contains b1; m3 and the bogus-subject material still land in `library`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/School/home/subjects.test.js`
Expected: FAIL — received array is the old six ids.

- [ ] **Step 3: Implement the nine-entry SUBJECTS array**

Replace the array (and the header comment's "six" language) in `subjects.js`:

```javascript
export const SUBJECTS = [
  { id: 'english', label: 'English', hint: 'Vocabulary, grammar, and reading' },
  { id: 'literature', label: 'Literature', hint: 'Great stories and classics' },
  { id: 'writing', label: 'Writing', hint: 'Put it in your own words' },
  { id: 'math', label: 'Math & Money', hint: 'Numbers, patterns, and money' },
  { id: 'science', label: 'Science', hint: 'How the world works' },
  { id: 'skills', label: 'Skills', hint: 'Hands-on — art, cooking, making' },
  { id: 'history', label: 'History', hint: 'People and the past' },
  { id: 'geography', label: 'Geography', hint: 'Places, maps, and the world' },
  { id: 'language', label: 'Language', hint: 'Hear it, say it, write it' },
];
```

Header comment: "The nine subject shelves … (spec: 2026-07-22-school-nine-subjects-design)"; keep the "fixed in code / curriculum decision" rationale and the `subject` vs `topics` paragraph.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/School/home/subjects.test.js`
Expected: PASS (all describes).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/School/home/subjects.js frontend/src/modules/School/home/subjects.test.js
git commit -m "feat(school): nine subject shelves — civ split + english/skills/math-money"
```

### Task 2: Subject icon set (PianoKiosk pattern)

**Files:**
- Create: `frontend/src/modules/School/home/icons/Icon.jsx`
- Create: `frontend/src/modules/School/home/icons/svg/{english,literature,writing,math,science,skills,history,geography,language}.svg`
- Create: `frontend/src/modules/School/home/icons/MANIFEST.md`
- Test: `frontend/src/modules/School/home/icons/Icon.test.jsx`

**Interfaces:**
- Produces: `default Icon({ name, className, label })` — renders `<span class="school-icon …">` with inline SVG, `null` for unknown names. Icon filenames = subject ids, so `SUBJECTS[].id` is the lookup key (Task 3 relies on this).

- [ ] **Step 1: Fetch Solar Bold SVGs from Iconify (placeholder set, swappable later)**

For each mapping, `curl -sf "https://api.iconify.design/solar/<solar-name>.svg?height=1em" -o frontend/src/modules/School/home/icons/svg/<id>.svg`; on 404 try the fallback name; if both 404, search `https://api.iconify.design/search?query=<concept>` and pick a Solar Bold match:

| id | solar name | fallback |
|----|-----------|----------|
| english | `book-bold` | `book-bookmark-bold` |
| literature | `book-2-bold` | `notebook-bold` |
| writing | `pen-bold` | `pen-2-bold` |
| math | `calculator-minimalistic-bold` | `calculator-bold` |
| science | `test-tube-bold` | `atom-bold` |
| skills | `palette-bold` | `palette-round-bold` |
| history | `hourglass-bold` | `history-bold` |
| geography | `globus-bold` | `planet-bold` |
| language | `chat-round-dots-bold` | `dialog-2-bold` |

Verify each file starts with `<svg` and contains `currentColor` (`grep -L currentColor …/svg/*.svg` must print nothing).

- [ ] **Step 2: Write the failing Icon test**

```jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Icon from './Icon.jsx';
import { SUBJECTS } from '../subjects.js';

describe('school subject icons', () => {
  it('has an inline SVG for every subject id', () => {
    for (const { id } of SUBJECTS) {
      const { container, unmount } = render(<Icon name={id} />);
      expect(container.querySelector('svg'), `icon for ${id}`).not.toBeNull();
      unmount();
    }
  });

  it('renders nothing for an unknown name', () => {
    const { container } = render(<Icon name="not-a-subject" />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/School/home/icons/Icon.test.jsx`
Expected: FAIL — cannot resolve `./Icon.jsx`.

- [ ] **Step 4: Implement Icon.jsx (mirror of PianoKiosk `icons/Icon.jsx`, `school-icon` class)**

```jsx
// Inline SVG icon set for the School home (subject wall). One coherent Solar
// (Bold) set, same pattern as Piano/PianoKiosk/icons: raw SVG strings rendered
// inline so `currentColor` inherits the tile's text color and no SVG-loader
// plugin is required.
const mods = import.meta.glob('./svg/*.svg', { eager: true, query: '?raw', import: 'default' });
const ICONS = {};
for (const [path, raw] of Object.entries(mods)) {
  const name = path.replace('./svg/', '').replace('.svg', '');
  ICONS[name] = raw;
}

/**
 * Inline SVG icon (renders with `currentColor`, sizes to `1em`).
 *
 * @param {string} name - filename (no extension) of an icon in ./svg —
 *   for subject tiles this is the subject id.
 * @param {string} [className] - extra classes appended to `school-icon`
 * @param {string} [label] - accessible label; when set the icon is role="img",
 *   otherwise decorative (aria-hidden).
 */
export default function Icon({ name, className, label }) {
  const svg = ICONS[name];
  if (!svg) return null;
  return (
    <span
      className={`school-icon${className ? ` ${className}` : ''}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
```

MANIFEST.md: table of id → Solar name actually used (copy the Piano MANIFEST format, note "placeholder set — swap freely").

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/School/home/icons/Icon.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/School/home/icons
git commit -m "feat(school): subject icon set — Solar Bold placeholders, piano icon pattern"
```

### Task 3: 3×3 wall with icons

**Files:**
- Modify: `frontend/src/modules/School/home/SchoolHome.jsx`
- Modify: `frontend/src/modules/School/School.scss` (`.school-home2` block, ~line 259)
- Modify: `frontend/src/modules/School/SchoolApp.jsx:53` (comment only)
- Test: `frontend/src/modules/School/SchoolApp.test.jsx`

**Interfaces:**
- Consumes: `SUBJECTS` (Task 1), `Icon` (Task 2 — `name={s.id}`).
- Produces: no new exports; tile DOM gains `.school-home2__subject-icon`.

- [ ] **Step 1: Update SchoolApp.test.jsx expectations**

In the wall test (~line 94): rename to `'renders all nine subjects; empty shelves are greyed, not hidden'` and replace the label list:

```javascript
for (const label of [
  'English', 'Literature', 'Writing',
  'Math & Money', 'Science', 'Skills',
  'History', 'Geography', 'Language',
]) {
```

In the back-from-Library test, `findByText('Civilization')` → `findByText('Geography')`. Check `SAMPLE_CATALOG` for `subject:` stamps: any `civilization` → `history` (and adjust that assertion's shelf accordingly); `reading` → `english`.

- [ ] **Step 2: Run to verify the wall test fails**

Run: `npx vitest run frontend/src/modules/School/SchoolApp.test.jsx`
Expected: FAIL — `English` not found (old six-shelf wall).

- [ ] **Step 3: Implement tile icon + comment updates**

`SchoolHome.jsx`: import `Icon from './icons/Icon.jsx'`; header comment "six subject shelves" → "nine subject shelves (3×3)". Tile body becomes:

```jsx
<Icon name={s.id} className="school-home2__subject-icon" />
<h3 className="school-home2__subject-label">{s.label}</h3>
<p className="school-home2__subject-hint">{has ? s.hint : 'Nothing here yet'}</p>
```

`School.scss` `.school-home2` block — three columns and an icon size; comment "Six fixed subjects (2 cols x 3 rows)" → "Nine fixed subjects (3×3)":

```scss
&__subjects {
  display: grid; gap: 0.85rem;
  grid-template-columns: repeat(3, 1fr);
  grid-auto-rows: 1fr;
}
```

Add after `&__subject` rules:

```scss
&__subject-icon { font-size: 1.6rem; line-height: 1; color: var(--school-accent); }
```

(`.is-empty` tiles grey the icon along with everything else via `opacity` — no extra rule.)

`SchoolApp.jsx:53` comment: "The six shelves" → "The nine shelves".

- [ ] **Step 4: Run the full School suite**

Run: `npx vitest run frontend/src/modules/School`
Expected: PASS (SchoolApp, StudentPanel, subjects, Icon, SectionGrid-free — no remaining `Civilization` expectations anywhere: `grep -rn civilization frontend/src/modules/School` returns only none or comments).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/School
git commit -m "feat(school): 3x3 subject wall with shelf icons"
```

### Task 4: Docs

**Files:**
- Modify: `docs/reference/school/README.md` (~line 103)

- [ ] **Step 1: Update the home-shell section**

"six fixed subjects — Reading, Civilization, Language, Math, Science, Writing" → "nine fixed subjects — English, Literature, Writing, Math & Money, Science, Skills, History, Geography, Language — in a 3×3 grid". Add the design-spec link `2026-07-22-school-nine-subjects-design.md` to the section's spec list. Keep everything else (rail, frameworks, Library rules) unchanged — still true.

- [ ] **Step 2: Commit**

```bash
git add docs/reference/school/README.md
git commit -m "docs(school): nine-shelf subject wall"
```

### Task 5: Prod data restamps + gated deploy + verify

**Files:**
- Modify (prod data volume, via docker exec): `data/household/config/school.yml`

- [ ] **Step 1: Restamp school.yml in the container**

Edits (surgical — this file is hand-annotated; do NOT rewrite wholesale, and NEVER `sed -i` YAML per CLAUDE.local.md — read, edit the full text, write back via heredoc):
- Header comment: "six shelves … reading | civilization | language | math | science | writing" → the nine ids; drop the sentence claiming history/literature are not shelves (spec supersedes it), reference the new spec filename.
- I Survived: `subject: civilization` → `subject: history`
- Shakespeare Tales: `subject: civilization` → `subject: literature`
- Art Lessons: add `subject: skills` under `category: course`

Verify: `sudo docker exec daylight-station sh -c 'grep -n "subject:" data/household/config/school.yml'` shows history/literature/skills, no civilization.

- [ ] **Step 2: Build the image**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
```

Expected: image builds clean (vite build inside).

- [ ] **Step 3: Gate check (own step — HALT if not clear)**

Run the two CLAUDE.local.md gate commands (render_fps count must be 0; no `videoState:"playing"`, `sessionActive:false`/absent, `rosterSize:0`/absent). If not clear, wait — do not chain into Step 4.

- [ ] **Step 4: Deploy**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

- [ ] **Step 5: Verify**

- `/build.txt` shows the new commit hash; app answers 200.
- School catalog API returns the new subjects: `curl -s http://localhost:3111/api/v1/school/materials | grep -o '"subject":"[a-z]*"' | sort | uniq -c` (exact endpoint per `backend/src/4_api/v1/routers/school*`; adjust if named differently) — expect history/literature/skills.
- Headless Playwright screenshot of the school home (memory: reference_headless_playwright_screenshot) — nine tiles, 3×3, icons visible, I Survived under History, Shakespeare under Literature, Art Lessons under Skills, no console errors in container logs from the page load.

- [ ] **Step 6: Commit any working-tree stragglers & push**

```bash
git status --short   # expect clean
git push origin main
```
