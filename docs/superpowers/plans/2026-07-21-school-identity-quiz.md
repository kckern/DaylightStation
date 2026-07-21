# School Portal Slice 1 — Identity + Quiz/Flashcard Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A child claims a profile on the Portal, takes a quiz or drills flashcards, and every answer is recorded as a reassignable per-child event.

**Architecture:** Shared identity UI extracted from Piano into `frontend/src/lib/identity/` (Piano refactored to import from there). New `school` backend vertical: pure domain (validation/grading/attempt), append-only YAML attempt log mirroring `YamlEconomyDatastore`, application service with in-memory sessions, thin Express router. New `School` frontend module registered as app `school`, running inside the Portal's existing touch chrome.

**Tech Stack:** React (jsx, Vite), Express 5, YAML data files, vitest (all new tests), node ≥ 18 (global `fetch` in tests).

**Spec:** `docs/superpowers/specs/2026-07-21-school-identity-quiz-design.md`. Where this plan and the spec conflict, stop and escalate — with one recorded exception below (CSS class names).

## Global Constraints

- **School must never import from `modules/Piano/`** (spec §3, R1.8). Piano imports from `lib/identity/` — never the reverse.
- **Do not modify** `modules/Player`, `lib/Player`, or `screen-framework/overlays/TouchChrome.*` (spec §3).
- **Moved Piano tests must pass with no changes other than import paths and renames** (spec §10). A behavioural edit to make one pass means the extraction is wrong — revert and redo.
- **Recorded deviation:** spec §3 says names are neutralised in the move. That applies to **file and export names only**. CSS class strings (`piano-userpicker`, `piano-avatar`) are intentionally KEPT: `frontend/src/Apps/PianoApp.scss:1194` has a nested `.piano-avatar` override inside piano-only chip styles, and renaming classes would expand Piano's regression surface for zero function.
- **Attempt log is append-only** — never rewrite an existing attempt entry; rollups are derived, never stored (spec §2, R3.9).
- `audience` **defaults to `assigned`** when absent — fail closed (spec §4).
- **Quiz and flashcard counts are never merged** in results (spec §5).
- **Mode contract is strict both ways**: `given` on a flashcard session → 400; `selfGrade` on a quiz session → 400 (spec §8).
- **No raw `console.*` in new frontend code** — use the logging framework via the `schoolLog` facade (CLAUDE.md, spec §9).
- All new backend ids via `shortId` from `#domains/core/utils/id.mjs` (`ses_` / `att_` prefixes).
- Run all new tests with `npx vitest run <path>` from the repo root (tests under `tests/isolated/**` are vitest, not jest).
- Deploy target is prod (`kckern-server`). Before `sudo deploy-daylight`, run the CLAUDE.local.md deploy gates (no active fitness session, no playing video) and **halt** if either is active. After deploy, reload the Portal FKB at `10.0.0.92`.

---

## File inventory

**Created:**

```
frontend/src/lib/identity/ProfilePicker.jsx        (moved: PianoKiosk/WhoIsPlayingPrompt.jsx)
frontend/src/lib/identity/ProfileAvatar.jsx        (moved: PianoKiosk/PianoAvatar.jsx)
frontend/src/lib/identity/profilePickerLayout.js   (moved: PianoKiosk/whoIsPlayingLayout.js)
frontend/src/lib/identity/idleGap.js               (moved: PianoKiosk/whoIsPlaying.js)
frontend/src/lib/identity/useIdleGap.js            (moved: PianoKiosk/useWhoIsPlaying.js)
frontend/src/lib/identity/useArmedAction.js        (moved: PianoKiosk/useArmedAction.js)
frontend/src/lib/identity/identity.scss            (styles cut from Apps/PianoApp.scss)
frontend/src/lib/identity/*.test.{js,jsx}          (moved tests, renamed)
backend/src/2_domains/school/errors.mjs
backend/src/2_domains/school/questionBankValidation.mjs
backend/src/2_domains/school/grading.mjs
backend/src/2_domains/school/attempt.mjs
backend/src/2_domains/school/index.mjs
backend/src/1_adapters/persistence/yaml/YamlSchoolDatastore.mjs
backend/src/3_applications/school/SchoolService.mjs
backend/src/4_api/v1/routers/school.mjs
frontend/src/modules/School/schoolApi.js
frontend/src/modules/School/schoolLog.js
frontend/src/modules/School/School.scss
frontend/src/modules/School/SchoolApp.jsx
frontend/src/modules/School/identity/SchoolProfileContext.jsx
frontend/src/modules/School/browse/BankBrowser.jsx
frontend/src/modules/School/quiz/QuizRunner.jsx
frontend/src/modules/School/quiz/items/MultipleChoiceItem.jsx
frontend/src/modules/School/quiz/items/ShortAnswerItem.jsx
frontend/src/modules/School/quiz/items/ClozeItem.jsx
frontend/src/modules/School/quiz/items/MatchingItem.jsx
frontend/src/modules/School/flashcards/FlashcardRunner.jsx
tests/isolated/domain/school/{questionBankValidation,grading,attempt}.test.mjs
tests/isolated/adapter/school/yamlSchoolDatastore.test.mjs
tests/isolated/application/school/schoolService.test.mjs
tests/isolated/api/school/schoolRouter.test.mjs
```

**Modified:**

```
frontend/src/Apps/PianoApp.jsx            (imports: useArmedAction, WhoIsPlayingPrompt→ProfilePicker)
frontend/src/Apps/PianoApp.scss           (cut two top-level style blocks)
frontend/src/modules/Piano/PianoKiosk/PianoUserChip.jsx    (imports: avatar, picker)
frontend/src/modules/Piano/PianoKiosk/OperatorDrawer.jsx   (import: useArmedAction)
frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseTile.jsx  (import: avatar)
frontend/src/lib/appRegistry.js           (register 'school')
backend/src/app.mjs                       (import + construct + mount school router)
```

---

### Task 1: Extract shared identity from Piano to `lib/identity/`

**Files:**
- Create: everything under `frontend/src/lib/identity/` (moves via `git mv`)
- Modify: `frontend/src/Apps/PianoApp.jsx`, `frontend/src/Apps/PianoApp.scss`, `frontend/src/modules/Piano/PianoKiosk/PianoUserChip.jsx`, `frontend/src/modules/Piano/PianoKiosk/OperatorDrawer.jsx`, `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseTile.jsx`

**Interfaces:**
- Produces (later tasks rely on these exact names):
  - `lib/identity/ProfilePicker.jsx` — default export `ProfilePicker({ open, users, activeId, onPick, onDismiss, onScreenOff, timeoutMs = 30000 })` (props unchanged from `WhoIsPlayingPrompt`)
  - `lib/identity/ProfileAvatar.jsx` — default export `ProfileAvatar({ id, name })`
  - `lib/identity/idleGap.js` — `firesOnGap(lastMs, nowMs, thresholdMs)`
  - `lib/identity/useIdleGap.js` — `useIdleGap(signalA, signalB, timeoutMinutes, onIdleGap)` (signature unchanged from `useWhoIsPlaying`; piano passes `activeNotes, historyLen`; school passes `undefined, 0`)
  - `lib/identity/useArmedAction.js` — `useArmedAction(fn, { armMs })`
  - `lib/identity/profilePickerLayout.js` — `columnsForCount`, `paginatePlayers`, `PICKER_PAGE_SIZE`

- [ ] **Step 1: Move the files with git mv**

```bash
cd /opt/Code/DaylightStation
mkdir -p frontend/src/lib/identity
git mv frontend/src/modules/Piano/PianoKiosk/WhoIsPlayingPrompt.jsx      frontend/src/lib/identity/ProfilePicker.jsx
git mv frontend/src/modules/Piano/PianoKiosk/WhoIsPlayingPrompt.test.jsx frontend/src/lib/identity/ProfilePicker.test.jsx
git mv frontend/src/modules/Piano/PianoKiosk/PianoAvatar.jsx             frontend/src/lib/identity/ProfileAvatar.jsx
git mv frontend/src/modules/Piano/PianoKiosk/whoIsPlayingLayout.js       frontend/src/lib/identity/profilePickerLayout.js
git mv frontend/src/modules/Piano/PianoKiosk/whoIsPlayingLayout.test.js  frontend/src/lib/identity/profilePickerLayout.test.js
git mv frontend/src/modules/Piano/PianoKiosk/whoIsPlaying.js             frontend/src/lib/identity/idleGap.js
git mv frontend/src/modules/Piano/PianoKiosk/whoIsPlaying.test.js        frontend/src/lib/identity/idleGap.test.js
git mv frontend/src/modules/Piano/PianoKiosk/useWhoIsPlaying.js          frontend/src/lib/identity/useIdleGap.js
git mv frontend/src/modules/Piano/PianoKiosk/useArmedAction.js           frontend/src/lib/identity/useArmedAction.js
git mv frontend/src/modules/Piano/PianoKiosk/useArmedAction.test.js      frontend/src/lib/identity/useArmedAction.test.js
```

- [ ] **Step 2: Rename exports/imports inside the moved files (mechanical, no logic)**

In `frontend/src/lib/identity/ProfilePicker.jsx`:
- `import PianoAvatar from './PianoAvatar.jsx';` → `import ProfileAvatar from './ProfileAvatar.jsx';` (and rename the two `<PianoAvatar` JSX usages)
- `import { columnsForCount, paginatePlayers } from './whoIsPlayingLayout.js';` → `from './profilePickerLayout.js';`
- `import useArmedAction from './useArmedAction.js';` — unchanged (sibling)
- `export default function WhoIsPlayingPrompt(` → `export default function ProfilePicker(`
- Add as the last import: `import './identity.scss';`

In `frontend/src/lib/identity/ProfileAvatar.jsx`:
- `export default function PianoAvatar(` → `export default function ProfileAvatar(`
- Add: `import './identity.scss';`

In `frontend/src/lib/identity/useIdleGap.js`:
- `import { firesOnGap } from './whoIsPlaying.js';` → `from './idleGap.js';`
- `export function useWhoIsPlaying(activeNotes, historyLen, timeoutMinutes, onIdleGap)` → `export function useIdleGap(signalA, signalB, timeoutMinutes, onIdleGap)` — rename the two dependency-array references (`[activeNotes, historyLen]` → `[signalA, signalB]`) and the JSDoc param names. **No other edits.**
- `export default useWhoIsPlaying;` → `export default useIdleGap;`

CSS class strings (`piano-userpicker`, `piano-avatar`) stay — see Global Constraints.

- [ ] **Step 3: Extract the styles into `identity.scss`**

In `frontend/src/Apps/PianoApp.scss` locate the two **top-level** blocks: `.piano-avatar { … }` (starts ~line 2809) and `.piano-userpicker { … }` (starts ~line 2828; includes a nested `.piano-avatar` sizing override ~line 2963). Cut both blocks **verbatim** into a new `frontend/src/lib/identity/identity.scss` with this header comment:

```scss
// identity.scss — styles for the shared profile picker + avatar, extracted
// from PianoApp.scss (2026-07-21). Class names intentionally keep the piano-
// prefix: PianoApp.scss:~1194 nests a .piano-avatar override inside piano-only
// chip styles, and renaming would widen the piano regression surface. Imported
// by ProfilePicker.jsx and ProfileAvatar.jsx, so any consumer gets the styles.
```

Do **not** touch the nested `.piano-avatar` rule inside the chip styles (~line 1194) — it stays in `PianoApp.scss`.

- [ ] **Step 4: Update the moved tests' imports (paths + names only)**

- `ProfilePicker.test.jsx`: import from `./ProfilePicker.jsx`; rename component references `WhoIsPlayingPrompt` → `ProfilePicker`. Assertions (including any on `piano-userpicker` class names) unchanged.
- `profilePickerLayout.test.js`: import from `./profilePickerLayout.js`.
- `idleGap.test.js`: import from `./idleGap.js`.
- `useArmedAction.test.js`: import from `./useArmedAction.js`.

- [ ] **Step 5: Update the four Piano consumers**

- `frontend/src/Apps/PianoApp.jsx:19` → `import { useArmedAction } from '../lib/identity/useArmedAction.js';`
- `frontend/src/Apps/PianoApp.jsx:57` → `import ProfilePicker from '../lib/identity/ProfilePicker.jsx';` and rename the `<WhoIsPlayingPrompt` JSX usage (~line 292) to `<ProfilePicker`.
- `PianoUserChip.jsx:3-4` → `import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';` / `import ProfilePicker from '../../../lib/identity/ProfilePicker.jsx';` — rename JSX usages (~lines 56, 61).
- `OperatorDrawer.jsx` → `import { useArmedAction } from '../../../lib/identity/useArmedAction.js';` (adjust to its actual current specifier form).
- `modes/Videos/CourseTile.jsx` → `import ProfileAvatar from '../../../../../lib/identity/ProfileAvatar.jsx';` — rename JSX usage. (Verify relative depth with `ls`; the file sits 5 levels below `src/`.)
- Search for stragglers: `grep -rn "WhoIsPlayingPrompt\|PianoAvatar\|useWhoIsPlaying\|whoIsPlayingLayout\|from './whoIsPlaying" frontend/src --include=*.jsx --include=*.js` must return **zero** hits outside `lib/identity/` (comments in `tileGridLayout.js` may mention the old name in prose; update the comment path, no code change).

- [ ] **Step 6: Run the moved tests + every Piano test**

```bash
npx vitest run frontend/src/lib/identity/ frontend/src/modules/Piano/ frontend/src/Apps 2>&1 | tail -20
```
Expected: all pass. If a moved test needs a behavioural edit to pass, STOP — revert and redo the move (Global Constraints).

- [ ] **Step 7: Build check (catches missed importers vitest can't)**

```bash
cd frontend && npx vite build 2>&1 | tail -5 && cd ..
```
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add -A frontend/src && git commit -m "refactor(identity): extract profile picker/avatar/idle-gap from Piano to lib/identity"
```

---

### Task 2: School domain — errors + question bank validation

**Files:**
- Create: `backend/src/2_domains/school/errors.mjs`, `backend/src/2_domains/school/questionBankValidation.mjs`
- Test: `tests/isolated/domain/school/questionBankValidation.test.mjs`

**Interfaces:**
- Produces: `GuestForbiddenError`, `SessionGoneError` (plain Error subclasses); `validateQuestionBank(raw) -> { ok: true, bank } | { ok: false, errors: string[] }`. Normalised bank: `{ id, title, audience ('generic'|'assigned', default 'assigned'), topics (default []), items }`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/domain/school/questionBankValidation.test.mjs
import { describe, it, expect } from 'vitest';
import { validateQuestionBank } from '#domains/school/questionBankValidation.mjs';

const mc = (over = {}) => ({ id: 'q1', type: 'multiple_choice', prompt: 'Capital of WA?', answer: 'Olympia', choices: ['Seattle', 'Olympia'], ...over });
const bank = (over = {}) => ({ id: 'test-bank', title: 'Test', items: [mc()], ...over });

describe('validateQuestionBank', () => {
  it('accepts a minimal valid bank and normalises defaults', () => {
    const r = validateQuestionBank(bank());
    expect(r.ok).toBe(true);
    expect(r.bank.audience).toBe('assigned'); // fail closed
    expect(r.bank.topics).toEqual([]);
  });
  it('keeps an explicit generic audience', () => {
    expect(validateQuestionBank(bank({ audience: 'generic' })).bank.audience).toBe('generic');
  });
  it.each([
    ['missing id', bank({ id: undefined })],
    ['missing title', bank({ title: undefined })],
    ['empty items', bank({ items: [] })],
    ['duplicate item ids', bank({ items: [mc(), mc()] })],
    ['unknown type', bank({ items: [mc({ type: 'essay' })] })],
    ['bad audience', bank({ audience: 'public' })],
    ['answer not in choices', bank({ items: [mc({ answer: 'Boise' })] })],
    ['single choice', bank({ items: [mc({ choices: ['Olympia'] })] })],
    ['duplicate choices', bank({ items: [mc({ choices: ['Olympia', 'Olympia'] })] })],
    ['short_answer missing answer', bank({ items: [{ id: 'q1', type: 'short_answer', prompt: 'P?' }] })],
    ['cloze without blank', bank({ items: [{ id: 'q1', type: 'cloze', prompt: 'No blank.', answer: 'x' }] })],
    ['cloze with two blanks', bank({ items: [{ id: 'q1', type: 'cloze', prompt: '___ and ___.', answer: 'x' }] })],
    ['matching single pair', bank({ items: [{ id: 'q1', type: 'matching', prompt: 'M', pairs: [{ left: 'a', right: 'b' }] }] })],
    ['matching duplicate lefts', bank({ items: [{ id: 'q1', type: 'matching', prompt: 'M', pairs: [{ left: 'a', right: 'b' }, { left: 'a', right: 'c' }] }] })],
    ['matching duplicate rights', bank({ items: [{ id: 'q1', type: 'matching', prompt: 'M', pairs: [{ left: 'a', right: 'b' }, { left: 'c', right: 'b' }] }] })],
    ['not an object', null],
  ])('rejects: %s', (_label, raw) => {
    const r = validateQuestionBank(raw);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
  it('accepts all four types together', () => {
    const r = validateQuestionBank(bank({ items: [
      mc(),
      { id: 'q2', type: 'short_answer', prompt: 'Capital of OR?', answer: 'Salem', accept: ['salem'] },
      { id: 'q3', type: 'cloze', prompt: 'The capital of Idaho is ___.', answer: 'Boise' },
      { id: 'q4', type: 'matching', prompt: 'Match', pairs: [{ left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }] },
    ] }));
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/isolated/domain/school/ 2>&1 | tail -5`
Expected: FAIL — cannot resolve `#domains/school/questionBankValidation.mjs`.

- [ ] **Step 3: Implement**

```javascript
// backend/src/2_domains/school/errors.mjs
/** Guest session attempted against an audience:assigned bank → HTTP 403. */
export class GuestForbiddenError extends Error {}
/** Unknown or expired sessionId → HTTP 410. */
export class SessionGoneError extends Error {}
```

```javascript
// backend/src/2_domains/school/questionBankValidation.mjs
/**
 * Pure validation + normalisation of a question bank (spec §4). No I/O.
 * Fail-closed: audience defaults to 'assigned' so an omission never exposes a
 * bank to guests.
 */
const ITEM_TYPES = new Set(['multiple_choice', 'short_answer', 'cloze', 'matching']);
const AUDIENCES = new Set(['generic', 'assigned']);

export function validateQuestionBank(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['bank must be a mapping'] };
  }
  if (!raw.id || typeof raw.id !== 'string') errors.push('id is required');
  if (!raw.title || typeof raw.title !== 'string') errors.push('title is required');
  const audience = raw.audience === undefined ? 'assigned' : raw.audience;
  if (!AUDIENCES.has(audience)) errors.push(`audience must be generic|assigned, got: ${raw.audience}`);
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    errors.push('items must be a non-empty array');
    return { ok: false, errors };
  }
  const seen = new Set();
  raw.items.forEach((item, i) => {
    const at = `items[${i}]`;
    if (!item || typeof item !== 'object') { errors.push(`${at}: must be a mapping`); return; }
    if (!item.id || typeof item.id !== 'string') errors.push(`${at}: id is required`);
    else if (seen.has(item.id)) errors.push(`${at}: duplicate id "${item.id}"`);
    else seen.add(item.id);
    if (!ITEM_TYPES.has(item.type)) { errors.push(`${at}: unknown type "${item.type}"`); return; }
    if (!item.prompt || typeof item.prompt !== 'string') errors.push(`${at}: prompt is required`);
    if (item.type === 'multiple_choice') {
      if (!Array.isArray(item.choices) || item.choices.length < 2) errors.push(`${at}: choices must have >= 2 entries`);
      else {
        if (new Set(item.choices).size !== item.choices.length) errors.push(`${at}: choices must be unique`);
        if (!item.choices.includes(item.answer)) errors.push(`${at}: answer must appear in choices`);
      }
    }
    if (item.type === 'short_answer' || item.type === 'cloze') {
      if (!item.answer || typeof item.answer !== 'string') errors.push(`${at}: answer is required`);
      if (item.accept !== undefined && !Array.isArray(item.accept)) errors.push(`${at}: accept must be an array`);
    }
    if (item.type === 'cloze') {
      const blanks = (String(item.prompt).match(/___/g) || []).length;
      if (blanks !== 1) errors.push(`${at}: cloze prompt must contain the blank marker ___ exactly once (found ${blanks})`);
    }
    if (item.type === 'matching') {
      if (!Array.isArray(item.pairs) || item.pairs.length < 2) errors.push(`${at}: pairs must have >= 2 entries`);
      else {
        const lefts = item.pairs.map((p) => p?.left); const rights = item.pairs.map((p) => p?.right);
        if (lefts.some((v) => !v) || rights.some((v) => !v)) errors.push(`${at}: every pair needs left and right`);
        if (new Set(lefts).size !== lefts.length) errors.push(`${at}: left values must be unique`);
        if (new Set(rights).size !== rights.length) errors.push(`${at}: right values must be unique`);
      }
    }
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, bank: { id: raw.id, title: raw.title, audience, topics: Array.isArray(raw.topics) ? raw.topics : [], items: raw.items } };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/isolated/domain/school/ 2>&1 | tail -5`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/school tests/isolated/domain/school
git commit -m "feat(school): question bank validation domain + typed errors"
```

---

### Task 3: School domain — grading, attempt factory, barrel

**Files:**
- Create: `backend/src/2_domains/school/grading.mjs`, `backend/src/2_domains/school/attempt.mjs`, `backend/src/2_domains/school/index.mjs`
- Test: `tests/isolated/domain/school/grading.test.mjs`, `tests/isolated/domain/school/attempt.test.mjs`

**Interfaces:**
- Produces:
  - `givenShapeError(item, given) -> string | null` (null = shape ok)
  - `gradeAnswer(item, given) -> { correct: boolean, expected }` — `expected` is the answer string, or the `pairs` array for matching. Pure; no clock, no I/O.
  - `createAttempt({ sessionId, bankId, itemId, itemType, mode, given, correct, attributedTo }) -> attempt` — stamps `id` (`att_` + shortId) and `at` (ISO). The ONLY place in the domain that reads the clock.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/isolated/domain/school/grading.test.mjs
import { describe, it, expect } from 'vitest';
import { gradeAnswer, givenShapeError } from '#domains/school/grading.mjs';

const sa = { id: 'q', type: 'short_answer', prompt: 'Capital of OR?', answer: 'Salem', accept: ['salem city'] };
const match = { id: 'm', type: 'matching', prompt: 'M', pairs: [{ left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }] };

describe('gradeAnswer', () => {
  it('multiple_choice: exact match only', () => {
    const item = { id: 'q', type: 'multiple_choice', prompt: 'P', answer: 'Olympia', choices: ['Seattle', 'Olympia'] };
    expect(gradeAnswer(item, 'Olympia')).toEqual({ correct: true, expected: 'Olympia' });
    expect(gradeAnswer(item, 'Seattle').correct).toBe(false);
  });
  it('short_answer: trims, collapses whitespace, casefolds', () => {
    expect(gradeAnswer(sa, '  salem ').correct).toBe(true);
    expect(gradeAnswer(sa, 'SALEM').correct).toBe(true);
    expect(gradeAnswer(sa, 'Salem  City').correct).toBe(true); // accept entry, collapsed
  });
  it('short_answer: no fuzz — near-misses stay wrong', () => {
    expect(gradeAnswer(sa, 'Salems').correct).toBe(false);
    expect(gradeAnswer(sa, 'Sale m').correct).toBe(false);
    expect(gradeAnswer(sa, 'St. Salem').correct).toBe(false); // punctuation NOT stripped
  });
  it('cloze grades exactly like short_answer', () => {
    const item = { id: 'c', type: 'cloze', prompt: 'Capital is ___.', answer: 'Boise' };
    expect(gradeAnswer(item, ' boise ').correct).toBe(true);
  });
  it('matching: all pairs correct in any order', () => {
    expect(gradeAnswer(match, [{ left: 'OR', right: 'Salem' }, { left: 'WA', right: 'Olympia' }]).correct).toBe(true);
  });
  it('matching: one wrong pair fails the whole item (all-or-nothing)', () => {
    const r = gradeAnswer(match, [{ left: 'WA', right: 'Salem' }, { left: 'OR', right: 'Olympia' }]);
    expect(r.correct).toBe(false);
    expect(r.expected).toEqual(match.pairs);
  });
  it('matching: missing a pair fails', () => {
    expect(gradeAnswer(match, [{ left: 'WA', right: 'Olympia' }]).correct).toBe(false);
  });
});

describe('givenShapeError', () => {
  it('accepts string for text types, array of pairs for matching', () => {
    expect(givenShapeError(sa, 'x')).toBe(null);
    expect(givenShapeError(match, [{ left: 'WA', right: 'Olympia' }])).toBe(null);
  });
  it('rejects wrong shapes', () => {
    expect(givenShapeError(sa, ['x'])).toBeTruthy();
    expect(givenShapeError(match, 'Olympia')).toBeTruthy();
    expect(givenShapeError(match, [{ left: 'WA' }])).toBeTruthy();
    expect(givenShapeError(sa, undefined)).toBeTruthy();
  });
});
```

```javascript
// tests/isolated/domain/school/attempt.test.mjs
import { describe, it, expect } from 'vitest';
import { createAttempt } from '#domains/school/attempt.mjs';

describe('createAttempt', () => {
  const base = { sessionId: 'ses_x', bankId: 'b', itemId: 'q1', itemType: 'multiple_choice', mode: 'quiz', given: 'Olympia', correct: true, attributedTo: 'kckern' };
  it('stamps id and ISO timestamp and passes fields through', () => {
    const a = createAttempt(base);
    expect(a.id).toMatch(/^att_/);
    expect(new Date(a.at).toISOString()).toBe(a.at);
    expect(a).toMatchObject(base);
  });
  it('generates unique ids', () => {
    expect(createAttempt(base).id).not.toBe(createAttempt(base).id);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/isolated/domain/school/ 2>&1 | tail -5`
Expected: FAIL — modules not found (validation tests from Task 2 still pass).

- [ ] **Step 3: Implement**

```javascript
// backend/src/2_domains/school/grading.mjs
/**
 * Pure per-type grading (spec §7). Normalisation is deliberately conservative:
 * trim, collapse internal whitespace, casefold — NO stemming, NO fuzzy
 * distance, NO punctuation stripping. "St. Paul" vs "St Paul" is an explicit
 * `accept` entry's job, not a clever matcher's. No clock, no I/O.
 */
const norm = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase();

export function givenShapeError(item, given) {
  if (item.type === 'matching') {
    if (!Array.isArray(given)) return 'matching answer must be an array of {left, right} pairs';
    if (given.some((p) => !p || typeof p.left !== 'string' || typeof p.right !== 'string')) {
      return 'every matching pair needs string left and right';
    }
    return null;
  }
  if (typeof given !== 'string' || given.length === 0) return 'answer must be a non-empty string';
  return null;
}

export function gradeAnswer(item, given) {
  if (item.type === 'multiple_choice') {
    return { correct: given === item.answer, expected: item.answer };
  }
  if (item.type === 'short_answer' || item.type === 'cloze') {
    const accepted = [item.answer, ...(item.accept || [])].map(norm);
    return { correct: accepted.includes(norm(given)), expected: item.answer };
  }
  // matching: all-or-nothing (spec §7 — partial credit has no agreed weighting)
  const want = new Map(item.pairs.map((p) => [p.left, p.right]));
  const correct = given.length === item.pairs.length
    && given.every((p) => want.get(p.left) === p.right);
  return { correct, expected: item.pairs };
}
```

```javascript
// backend/src/2_domains/school/attempt.mjs
import { shortId } from '#domains/core/utils/id.mjs';

/**
 * Attempt event factory — the only clock read in the school domain (spec §7).
 * Attempts are append-only events; `attributedTo` denormalises the original
 * credited user so a later reassignment (R6.5) stays auditable.
 */
export function createAttempt({ sessionId, bankId, itemId, itemType, mode, given, correct, attributedTo }) {
  return {
    id: `att_${shortId(8)}`,
    at: new Date().toISOString(),
    sessionId, bankId, itemId, itemType, mode,
    given, correct, attributedTo,
  };
}
```

```javascript
// backend/src/2_domains/school/index.mjs
export { validateQuestionBank } from './questionBankValidation.mjs';
export { gradeAnswer, givenShapeError } from './grading.mjs';
export { createAttempt } from './attempt.mjs';
export { GuestForbiddenError, SessionGoneError } from './errors.mjs';
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/isolated/domain/school/ 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/school tests/isolated/domain/school
git commit -m "feat(school): pure grading + attempt factory"
```

---

### Task 4: YamlSchoolDatastore (append-only attempt log + bank files)

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlSchoolDatastore.mjs`
- Test: `tests/isolated/adapter/school/yamlSchoolDatastore.test.mjs`

**Interfaces:**
- Consumes: `loadYamlSafe`, `saveYaml`, `ensureDir` from `#system/utils/FileIO.mjs` (exact pattern of `YamlEconomyDatastore.mjs`, same directory).
- Produces: class `YamlSchoolDatastore` with constructor `({ configService })` and methods `listBankIds() -> string[]`, `readBankRaw(bankId) -> object|null`, `appendAttempt(userId, attempt) -> attempt|null`, `readAttemptDay(userId, day) -> attempt[]`, `readAllAttempts(userId) -> attempt[]`. Banks live at `<configService.getDataDir()>/content/quizzes/*.yml`; attempts at `<configService.getUserDir(userId)>/apps/school/attempts/{YYYY-MM-DD}.yml`. Unknown user (no profile) → null/[] like the economy datastore.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/school/yamlSchoolDatastore.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlSchoolDatastore } from '#adapters/persistence/yaml/YamlSchoolDatastore.mjs';

const USER = 'kid1';
let tmp, ds;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'school-ds-'));
  const configService = {
    getDataDir: () => tmp,
    getUserDir: (id) => path.join(tmp, 'users', id),
    getUserProfile: (id) => (id === USER ? { username: id } : null),
  };
  ds = new YamlSchoolDatastore({ configService });
});

const att = (over = {}) => ({ id: 'att_1', at: '2026-07-21T10:00:00.000Z', sessionId: 'ses_1', bankId: 'b', itemId: 'q1', itemType: 'multiple_choice', mode: 'quiz', given: 'x', correct: true, attributedTo: USER, ...over });

describe('attempt log', () => {
  it('appends two attempts on one day and both survive', () => {
    ds.appendAttempt(USER, att({ id: 'att_1' }));
    ds.appendAttempt(USER, att({ id: 'att_2' }));
    const day = ds.readAttemptDay(USER, '2026-07-21');
    expect(day.map((a) => a.id)).toEqual(['att_1', 'att_2']);
  });
  it('shards a second day into a second file and readAll returns date order', () => {
    ds.appendAttempt(USER, att({ id: 'att_2', at: '2026-07-22T09:00:00.000Z' }));
    ds.appendAttempt(USER, att({ id: 'att_1', at: '2026-07-21T09:00:00.000Z' }));
    expect(fs.existsSync(path.join(tmp, 'users', USER, 'apps', 'school', 'attempts', '2026-07-21.yml'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'users', USER, 'apps', 'school', 'attempts', '2026-07-22.yml'))).toBe(true);
    expect(ds.readAllAttempts(USER).map((a) => a.id)).toEqual(['att_1', 'att_2']);
  });
  it('unknown user: append returns null, reads return []', () => {
    expect(ds.appendAttempt('ghost', att())).toBe(null);
    expect(ds.readAllAttempts('ghost')).toEqual([]);
  });
});

describe('banks', () => {
  it('lists yml basenames and reads a bank by id', () => {
    const dir = path.join(tmp, 'content', 'quizzes');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'caps.yml'), 'id: caps\ntitle: Caps\nitems:\n  - id: q1\n');
    expect(ds.listBankIds()).toEqual(['caps']);
    expect(ds.readBankRaw('caps')).toMatchObject({ id: 'caps', title: 'Caps' });
  });
  it('empty/missing dir lists nothing; unknown or path-traversal id reads null', () => {
    expect(ds.listBankIds()).toEqual([]);
    expect(ds.readBankRaw('nope')).toBe(null);
    expect(ds.readBankRaw('../secrets')).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/isolated/adapter/school/ 2>&1 | tail -5`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// backend/src/1_adapters/persistence/yaml/YamlSchoolDatastore.mjs
/**
 * YAML persistence for the school app. Dumb storage only — no grading, no
 * policy (see SchoolService). Mirrors YamlEconomyDatastore's layout:
 *   banks:    <dataDir>/content/quizzes/{bankId}.yml
 *   attempts: <userDir>/apps/school/attempts/{YYYY-MM-DD}.yml  (append-only)
 */
import path from 'path';
import fs from 'fs';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const BANK_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;

export class YamlSchoolDatastore {
  #configService;

  constructor(config = {}) {
    if (!config.configService) {
      throw new InfrastructureError('YamlSchoolDatastore requires configService', {
        code: 'MISSING_DEPENDENCY', dependency: 'configService',
      });
    }
    this.#configService = config.configService;
  }

  #banksDir() { return path.join(this.#configService.getDataDir(), 'content', 'quizzes'); }

  #attemptsDir(userId) {
    if (!this.#configService.getUserProfile?.(userId)) return null;
    return path.join(this.#configService.getUserDir(userId), 'apps', 'school', 'attempts');
  }

  listBankIds() {
    const dir = this.#banksDir();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.yml')).map((f) => f.replace(/\.yml$/, '')).sort();
  }

  readBankRaw(bankId) {
    if (!BANK_ID_RE.test(String(bankId))) return null;
    return loadYamlSafe(path.join(this.#banksDir(), String(bankId))) || null;
  }

  appendAttempt(userId, attempt) {
    const dir = this.#attemptsDir(userId);
    if (!dir) return null;
    const day = String(attempt.at).slice(0, 10);
    const base = path.join(dir, day);
    ensureDir(dir);
    const list = loadYamlSafe(base) || [];
    list.push(attempt);
    saveYaml(base, list, { noRefs: true });
    return attempt;
  }

  readAttemptDay(userId, day) {
    const dir = this.#attemptsDir(userId);
    if (!dir) return [];
    return loadYamlSafe(path.join(dir, day)) || [];
  }

  readAllAttempts(userId) {
    const dir = this.#attemptsDir(userId);
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.yml$/.test(f))
      .sort()
      .flatMap((f) => loadYamlSafe(path.join(dir, f.replace(/\.yml$/, ''))) || []);
  }
}

export default YamlSchoolDatastore;
```

Note: `loadYamlSafe`/`saveYaml` take extension-less base paths — mirror `YamlEconomyDatastore.mjs` exactly; if its actual import specifier differs (`#system/utils/index.mjs`), copy that file's import line verbatim.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/isolated/adapter/school/ 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlSchoolDatastore.mjs tests/isolated/adapter/school
git commit -m "feat(school): append-only YAML datastore for banks + attempts"
```

---

### Task 5: SchoolService (sessions, mode-split answer, roster, results)

**Files:**
- Create: `backend/src/3_applications/school/SchoolService.mjs`
- Test: `tests/isolated/application/school/schoolService.test.mjs`

**Interfaces:**
- Consumes: Task 3 domain exports; Task 4 datastore; `ValidationError`, `EntityNotFoundError` from `#domains/core/errors/index.mjs`; `shortId` from `#domains/core/utils/id.mjs`; a `userService` with `getProfile(id)` and `getAllProfiles() -> Map`.
- Produces: class `SchoolService`, constructor `({ datastore, userService, logger = console, now = () => Date.now() })`, methods:
  - `getRoster() -> [{id, name, group_label}]` sorted by name
  - `listBanks({ audience } = {}) -> [{id, title, audience, topics, itemCount}]`
  - `getBank(bankId) -> bank` (validated) — throws `EntityNotFoundError`
  - `openSession({ userId = null, bankId, mode }) -> { sessionId }`
  - `answer({ sessionId, itemId, given, selfGrade }) -> { correct, expected, attemptId } | { attemptId }`
  - `getResults(userId, { bankId } = {}) -> rollup` (object for one bank, array for all)
- Session TTL: `2 * 60 * 60 * 1000` ms, checked on `answer` via injected `now`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/application/school/schoolService.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import { SchoolService } from '#applications/school/SchoolService.mjs';
import { GuestForbiddenError, SessionGoneError } from '#domains/school/errors.mjs';

const BANKS = {
  'caps': { id: 'caps', title: 'Caps', audience: 'assigned', items: [
    { id: 'q1', type: 'multiple_choice', prompt: 'WA?', answer: 'Olympia', choices: ['Seattle', 'Olympia'] },
    { id: 'q2', type: 'short_answer', prompt: 'OR?', answer: 'Salem' },
  ] },
  'animals': { id: 'animals', title: 'Animals', audience: 'generic', items: [
    { id: 'a1', type: 'multiple_choice', prompt: 'Dog?', answer: 'Mammal', choices: ['Mammal', 'Bird'] },
  ] },
  'broken': { id: 'broken', title: 'Broken', items: [] }, // invalid: empty items
};

let ds, svc, clock, warned;
beforeEach(() => {
  clock = { t: 1_000_000 };
  warned = [];
  ds = {
    appended: [],
    listBankIds: () => Object.keys(BANKS),
    readBankRaw: (id) => BANKS[id] || null,
    appendAttempt: (userId, a) => { ds.appended.push({ userId, ...a }); return a; },
    readAllAttempts: () => [],
  };
  const userService = {
    getProfile: (id) => (['kid1', 'kid2'].includes(id) ? { username: id, display_name: id.toUpperCase() } : null),
    getAllProfiles: () => new Map([['kid1', { username: 'kid1', display_name: 'KID1' }], ['kid2', { username: 'kid2', display_name: 'KID2' }]]),
  };
  svc = new SchoolService({ datastore: ds, userService, logger: { warn: (e, d) => warned.push(e), info: () => {}, error: () => {} }, now: () => clock.t });
});

describe('banks', () => {
  it('lists only valid banks, with itemCount; invalid bank warns and is skipped', () => {
    const list = svc.listBanks();
    expect(list.map((b) => b.id).sort()).toEqual(['animals', 'caps']);
    expect(list.find((b) => b.id === 'caps').itemCount).toBe(2);
    expect(warned).toContain('school.bank.invalid');
  });
  it('audience filter', () => {
    expect(svc.listBanks({ audience: 'generic' }).map((b) => b.id)).toEqual(['animals']);
  });
  it('getBank throws EntityNotFoundError for unknown and for invalid banks', () => {
    expect(() => svc.getBank('nope')).toThrow();
    expect(() => svc.getBank('broken')).toThrow();
  });
});

describe('sessions + answers', () => {
  it('claimed quiz: grades, appends with attributedTo, returns verdict', () => {
    const { sessionId } = svc.openSession({ userId: 'kid1', bankId: 'caps', mode: 'quiz' });
    const r = svc.answer({ sessionId, itemId: 'q1', given: 'Olympia' });
    expect(r).toMatchObject({ correct: true, expected: 'Olympia' });
    expect(ds.appended).toHaveLength(1);
    expect(ds.appended[0]).toMatchObject({ userId: 'kid1', attributedTo: 'kid1', mode: 'quiz', given: 'Olympia', correct: true });
  });
  it('guest session on generic bank: verdicts but appends NOTHING', () => {
    const { sessionId } = svc.openSession({ bankId: 'animals', mode: 'quiz' });
    const r = svc.answer({ sessionId, itemId: 'a1', given: 'Bird' });
    expect(r.correct).toBe(false);
    expect(r.attemptId).toBe(null);
    expect(ds.appended).toHaveLength(0);
  });
  it('guest against assigned bank -> GuestForbiddenError', () => {
    expect(() => svc.openSession({ bankId: 'caps', mode: 'quiz' })).toThrow(GuestForbiddenError);
  });
  it('unknown user / unknown bank / bad mode on open', () => {
    expect(() => svc.openSession({ userId: 'ghost', bankId: 'caps', mode: 'quiz' })).toThrow(/user/i);
    expect(() => svc.openSession({ userId: 'kid1', bankId: 'nope', mode: 'quiz' })).toThrow();
    expect(() => svc.openSession({ userId: 'kid1', bankId: 'caps', mode: 'exam' })).toThrow(/mode/i);
  });
  it('flashcard: selfGrade recorded verbatim with given null, never graded', () => {
    const { sessionId } = svc.openSession({ userId: 'kid1', bankId: 'caps', mode: 'flashcard' });
    const r = svc.answer({ sessionId, itemId: 'q2', selfGrade: 'incorrect' });
    expect(r).toEqual({ attemptId: expect.stringMatching(/^att_/) });
    expect(ds.appended[0]).toMatchObject({ mode: 'flashcard', given: null, correct: false });
  });
  it('mode contract is strict both ways', () => {
    const quiz = svc.openSession({ userId: 'kid1', bankId: 'caps', mode: 'quiz' }).sessionId;
    const cards = svc.openSession({ userId: 'kid1', bankId: 'caps', mode: 'flashcard' }).sessionId;
    expect(() => svc.answer({ sessionId: quiz, itemId: 'q1', selfGrade: 'correct' })).toThrow(/selfGrade/);
    expect(() => svc.answer({ sessionId: cards, itemId: 'q1', given: 'Olympia' })).toThrow(/given/);
    expect(ds.appended).toHaveLength(0);
  });
  it('unknown item and wrong given shape reject without appending', () => {
    const { sessionId } = svc.openSession({ userId: 'kid1', bankId: 'caps', mode: 'quiz' });
    expect(() => svc.answer({ sessionId, itemId: 'zz', given: 'x' })).toThrow(/item/i);
    expect(() => svc.answer({ sessionId, itemId: 'q1', given: ['x'] })).toThrow();
    expect(ds.appended).toHaveLength(0);
  });
  it('unknown session -> SessionGoneError; expired session too', () => {
    expect(() => svc.answer({ sessionId: 'ses_nope', itemId: 'q1', given: 'x' })).toThrow(SessionGoneError);
    const { sessionId } = svc.openSession({ userId: 'kid1', bankId: 'caps', mode: 'quiz' });
    clock.t += 2 * 60 * 60 * 1000 + 1;
    expect(() => svc.answer({ sessionId, itemId: 'q1', given: 'Olympia' })).toThrow(SessionGoneError);
  });
});

describe('results', () => {
  it('folds the log per bank, quiz and flashcard never merged; items quiz-only', () => {
    ds.readAllAttempts = () => [
      { bankId: 'caps', itemId: 'q1', mode: 'quiz', correct: true, at: '2026-07-21T10:00:00Z' },
      { bankId: 'caps', itemId: 'q1', mode: 'quiz', correct: false, at: '2026-07-21T11:00:00Z' },
      { bankId: 'caps', itemId: 'q2', mode: 'flashcard', correct: true, at: '2026-07-21T12:00:00Z' },
    ];
    const r = svc.getResults('kid1', { bankId: 'caps' });
    expect(r.quiz).toEqual({ attempts: 2, correct: 1, lastAt: '2026-07-21T11:00:00Z' });
    expect(r.flashcard).toEqual({ attempts: 1, correct: 1, lastAt: '2026-07-21T12:00:00Z' });
    expect(r.items.q1).toEqual({ quizAttempts: 2, quizCorrect: 1, lastCorrect: false });
    expect(r.items.q2).toBeUndefined(); // flashcard-only item never enters items
  });
  it('without bankId returns an array of per-bank rollups', () => {
    ds.readAllAttempts = () => [
      { bankId: 'caps', itemId: 'q1', mode: 'quiz', correct: true, at: '2026-07-21T10:00:00Z' },
      { bankId: 'animals', itemId: 'a1', mode: 'quiz', correct: true, at: '2026-07-21T10:05:00Z' },
    ];
    expect(svc.getResults('kid1').map((b) => b.bankId).sort()).toEqual(['animals', 'caps']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/isolated/application/school/ 2>&1 | tail -5`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// backend/src/3_applications/school/SchoolService.mjs
/**
 * Use cases for the school app (spec §5). Owns session policy and the
 * mode-split answer contract; the datastore is dumb storage; the router is a
 * thin shell. Sessions are IN MEMORY by design — a restart costs the remainder
 * of one sitting, never a recorded attempt (those are already on disk).
 */
import { validateQuestionBank, gradeAnswer, givenShapeError, createAttempt, GuestForbiddenError, SessionGoneError } from '#domains/school/index.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { shortId } from '#domains/core/utils/id.mjs';

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MODES = new Set(['quiz', 'flashcard']);

export class SchoolService {
  #ds; #userService; #logger; #now;
  #sessions = new Map(); // sessionId -> {id, userId|null, bankId, mode, bank, startedAt, lastActiveAt}

  constructor({ datastore, userService, logger = console, now = () => Date.now() }) {
    this.#ds = datastore;
    this.#userService = userService;
    this.#logger = logger;
    this.#now = now;
  }

  getRoster() {
    const profiles = [...this.#userService.getAllProfiles().values()];
    return profiles
      .map((p) => ({ id: p.username, name: p.display_name || p.username, group_label: p.group_label }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  #loadBank(bankId) {
    const raw = this.#ds.readBankRaw(bankId);
    if (!raw) return null;
    const r = validateQuestionBank(raw);
    if (!r.ok) {
      this.#logger.warn?.('school.bank.invalid', { file: `${bankId}.yml`, reason: r.errors.join('; ') });
      return null;
    }
    return r.bank;
  }

  listBanks({ audience } = {}) {
    return this.#ds.listBankIds()
      .map((id) => this.#loadBank(id))
      .filter(Boolean)
      .filter((b) => !audience || b.audience === audience)
      .map((b) => ({ id: b.id, title: b.title, audience: b.audience, topics: b.topics, itemCount: b.items.length }));
  }

  getBank(bankId) {
    const bank = this.#loadBank(bankId);
    if (!bank) throw new EntityNotFoundError(`unknown bank: ${bankId}`);
    return bank;
  }

  openSession({ userId = null, bankId, mode }) {
    if (!MODES.has(mode)) throw new ValidationError(`mode must be quiz|flashcard, got: ${mode}`);
    if (userId != null && !this.#userService.getProfile(userId)) throw new ValidationError(`unknown user: ${userId}`);
    const bank = this.getBank(bankId); // throws EntityNotFoundError
    if (userId == null && bank.audience !== 'generic') {
      throw new GuestForbiddenError(`guests cannot open assigned bank: ${bankId}`);
    }
    const session = { id: `ses_${shortId(8)}`, userId, bankId, mode, bank, startedAt: this.#now(), lastActiveAt: this.#now() };
    this.#sessions.set(session.id, session);
    this.#logger.info?.('school.session.open', { sessionId: session.id, bankId, mode, userId });
    return { sessionId: session.id };
  }

  #session(sessionId) {
    const s = this.#sessions.get(sessionId);
    if (!s) throw new SessionGoneError(`no session ${sessionId}`);
    if (this.#now() - s.lastActiveAt > SESSION_TTL_MS) {
      this.#sessions.delete(sessionId);
      throw new SessionGoneError(`session expired: ${sessionId}`);
    }
    s.lastActiveAt = this.#now();
    return s;
  }

  answer({ sessionId, itemId, given, selfGrade }) {
    const s = this.#session(sessionId);
    const item = s.bank.items.find((i) => i.id === itemId);
    if (!item) throw new ValidationError(`unknown item: ${itemId}`);

    let correct, expected, recordedGiven;
    if (s.mode === 'quiz') {
      if (selfGrade !== undefined) throw new ValidationError('selfGrade is not accepted on a quiz session');
      const shapeErr = givenShapeError(item, given);
      if (shapeErr) throw new ValidationError(shapeErr);
      ({ correct, expected } = gradeAnswer(item, given));
      recordedGiven = given;
    } else {
      if (given !== undefined) throw new ValidationError('given is not accepted on a flashcard session; send selfGrade');
      if (selfGrade !== 'correct' && selfGrade !== 'incorrect') throw new ValidationError(`selfGrade must be correct|incorrect, got: ${selfGrade}`);
      correct = selfGrade === 'correct';
      recordedGiven = null;
    }

    let attemptId = null;
    if (s.userId != null) {
      const attempt = createAttempt({
        sessionId: s.id, bankId: s.bankId, itemId, itemType: item.type,
        mode: s.mode, given: recordedGiven, correct, attributedTo: s.userId,
      });
      this.#ds.appendAttempt(s.userId, attempt); // throws -> router 500, UI shows "unrecorded"
      attemptId = attempt.id;
    }
    return s.mode === 'quiz' ? { correct, expected, attemptId } : { attemptId };
  }

  getResults(userId, { bankId } = {}) {
    if (!this.#userService.getProfile(userId)) throw new ValidationError(`unknown user: ${userId}`);
    const all = this.#ds.readAllAttempts(userId);
    const byBank = new Map();
    for (const a of all) {
      if (bankId && a.bankId !== bankId) continue;
      if (!byBank.has(a.bankId)) {
        byBank.set(a.bankId, { bankId: a.bankId, quiz: { attempts: 0, correct: 0, lastAt: null }, flashcard: { attempts: 0, correct: 0, lastAt: null }, items: {} });
      }
      const b = byBank.get(a.bankId);
      const lane = a.mode === 'flashcard' ? b.flashcard : b.quiz; // never merged (spec §5)
      lane.attempts += 1;
      if (a.correct) lane.correct += 1;
      lane.lastAt = a.at;
      if (a.mode === 'quiz') { // items feed the future R2.5 completion gate: quiz-mode only
        const it = b.items[a.itemId] || (b.items[a.itemId] = { quizAttempts: 0, quizCorrect: 0, lastCorrect: null });
        it.quizAttempts += 1;
        if (a.correct) it.quizCorrect += 1;
        it.lastCorrect = a.correct;
      }
    }
    if (bankId) {
      return byBank.get(bankId) || { bankId, quiz: { attempts: 0, correct: 0, lastAt: null }, flashcard: { attempts: 0, correct: 0, lastAt: null }, items: {} };
    }
    return [...byBank.values()];
  }
}

export default SchoolService;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/isolated/application/school/ 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/school tests/isolated/application/school
git commit -m "feat(school): SchoolService — in-memory sessions, mode-split answers, results fold"
```

---

### Task 6: School router + app.mjs wiring

**Files:**
- Create: `backend/src/4_api/v1/routers/school.mjs`
- Modify: `backend/src/app.mjs` (import block near line 233 where `createGameshowRouter` is imported; construction block near line 1495 where `v1Routers.gameshow` is assembled — reuse the same `configService` and `userService` instances visible there)
- Test: `tests/isolated/api/school/schoolRouter.test.mjs`

**Interfaces:**
- Produces: `createSchoolRouter({ schoolService, logger }) -> express.Router` mounted as `v1Routers.school` (base path `/api/v1/school`). Error mapping: `GuestForbiddenError`→403, `SessionGoneError`→410, `EntityNotFoundError`→404, `ValidationError`→400, anything else→500 `{error:'internal'}` + `logger.error('school.router.error')`.

- [ ] **Step 1: Write the failing test** (real Express app on an ephemeral port; node ≥ 18 global fetch; no supertest dependency)

```javascript
// tests/isolated/api/school/schoolRouter.test.mjs
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createSchoolRouter } from '#api/v1/routers/school.mjs';
import { GuestForbiddenError, SessionGoneError } from '#domains/school/errors.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

const svc = {
  getRoster: () => [{ id: 'kid1', name: 'KID1' }],
  listBanks: ({ audience } = {}) => (audience === 'generic' ? [{ id: 'animals' }] : [{ id: 'animals' }, { id: 'caps' }]),
  getBank: (id) => { if (id !== 'caps') throw new EntityNotFoundError('nope'); return { id: 'caps', items: [] }; },
  openSession: ({ userId, bankId }) => {
    if (bankId === 'assigned-bank' && userId == null) throw new GuestForbiddenError('no');
    if (bankId === 'nope') throw new EntityNotFoundError('no bank');
    return { sessionId: 'ses_1' };
  },
  answer: ({ sessionId, selfGrade }) => {
    if (sessionId === 'ses_gone') throw new SessionGoneError('gone');
    if (selfGrade !== undefined) throw new ValidationError('selfGrade is not accepted on a quiz session');
    if (sessionId === 'ses_boom') throw new Error('disk full');
    return { correct: true, expected: 'x', attemptId: 'att_1' };
  },
  getResults: () => ({ bankId: 'caps' }),
};

let server, base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school', createSchoolRouter({ schoolService: svc, logger: { error: () => {} } }));
  await new Promise((res) => { server = app.listen(0, res); });
  base = `http://127.0.0.1:${server.address().port}/api/v1/school`;
});
afterAll(() => new Promise((res) => server.close(res)));

const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('school router status mapping', () => {
  it('GET /roster 200', async () => {
    const r = await fetch(`${base}/roster`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([{ id: 'kid1', name: 'KID1' }]);
  });
  it('GET /banks honours audience filter', async () => {
    const r = await fetch(`${base}/banks?audience=generic`);
    expect((await r.json())).toHaveLength(1);
  });
  it('GET /banks/:id 404 on unknown', async () => {
    expect((await fetch(`${base}/banks/nope`)).status).toBe(404);
  });
  it('POST /sessions: 403 guest-on-assigned, 404 unknown bank, 200 ok', async () => {
    expect((await post('/sessions', { bankId: 'assigned-bank', mode: 'quiz' })).status).toBe(403);
    expect((await post('/sessions', { userId: 'kid1', bankId: 'nope', mode: 'quiz' })).status).toBe(404);
    expect((await post('/sessions', { userId: 'kid1', bankId: 'caps', mode: 'quiz' })).status).toBe(200);
  });
  it('POST answer: 410 gone, 400 mode-mismatch, 500 append failure, 200 ok', async () => {
    expect((await post('/sessions/ses_gone/answer', { itemId: 'q1', given: 'x' })).status).toBe(410);
    expect((await post('/sessions/ses_1/answer', { itemId: 'q1', selfGrade: 'correct' })).status).toBe(400);
    expect((await post('/sessions/ses_boom/answer', { itemId: 'q1', given: 'x' })).status).toBe(500);
    const ok = await post('/sessions/ses_1/answer', { itemId: 'q1', given: 'x' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ correct: true, attemptId: 'att_1' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/isolated/api/school/ 2>&1 | tail -5`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the router**

```javascript
// backend/src/4_api/v1/routers/school.mjs
/**
 * /api/v1/school — thin HTTP shell over SchoolService (spec §5, §8).
 * All policy lives in the service; this file only maps errors to statuses.
 */
import express from 'express';
import { GuestForbiddenError, SessionGoneError } from '#domains/school/errors.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

export function createSchoolRouter({ schoolService, logger = console }) {
  const router = express.Router();
  const wrap = (fn) => (req, res) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((err) => {
        if (err instanceof GuestForbiddenError) return res.status(403).json({ error: err.message });
        if (err instanceof SessionGoneError) return res.status(410).json({ error: err.message });
        if (err instanceof EntityNotFoundError) return res.status(404).json({ error: err.message });
        if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
        logger.error?.('school.router.error', { path: req.path, error: err.message });
        return res.status(500).json({ error: 'internal' });
      });
  };

  router.get('/roster', wrap((req, res) => res.json(schoolService.getRoster())));
  router.get('/banks', wrap((req, res) => res.json(schoolService.listBanks({ audience: req.query.audience }))));
  router.get('/banks/:bankId', wrap((req, res) => res.json(schoolService.getBank(req.params.bankId))));
  router.post('/sessions', wrap((req, res) => {
    const { userId = null, bankId, mode } = req.body || {};
    res.json(schoolService.openSession({ userId, bankId, mode }));
  }));
  router.post('/sessions/:sessionId/answer', wrap((req, res) => {
    const { itemId, given, selfGrade } = req.body || {};
    res.json(schoolService.answer({ sessionId: req.params.sessionId, itemId, given, selfGrade }));
  }));
  router.get('/users/:userId/results', wrap((req, res) => {
    res.json(schoolService.getResults(req.params.userId, { bankId: req.query.bankId }));
  }));
  return router;
}

export default createSchoolRouter;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/isolated/api/school/ 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Wire into app.mjs**

Near line 233 (beside the gameshow imports):

```javascript
import { createSchoolRouter } from './4_api/v1/routers/school.mjs';
import { SchoolService } from './3_applications/school/SchoolService.mjs';
import { YamlSchoolDatastore } from './1_adapters/persistence/yaml/YamlSchoolDatastore.mjs';
```

Near line 1495 (immediately after the `v1Routers.gameshow` block, reusing the `configService`, `userService`, and logger variables that block already uses — read the block first and match its exact argument style):

```javascript
  // School (portal homeschool): banks from data/content/quizzes/, per-user
  // append-only attempt log under data/users/{id}/apps/school/attempts/.
  v1Routers.school = createSchoolRouter({
    schoolService: new SchoolService({
      datastore: new YamlSchoolDatastore({ configService }),
      userService,
      logger,
    }),
    logger,
  });
```

Verify the backend boots: `timeout 15 node backend/index.js 2>&1 | head -20` (expect normal startup, then Ctrl-C/timeout; if the dev server is already running on this machine per CLAUDE.md port rules, skip the boot and rely on Task 12's deployed verification).

- [ ] **Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/school.mjs backend/src/app.mjs tests/isolated/api/school
git commit -m "feat(school): /api/v1/school router + app wiring"
```

---

### Task 7: Frontend plumbing — schoolApi client + schoolLog facade

**Files:**
- Create: `frontend/src/modules/School/schoolApi.js`, `frontend/src/modules/School/schoolLog.js`
- Test: `frontend/src/modules/School/schoolApi.test.js`

**Interfaces:**
- Produces: `schoolApi` object — `roster()`, `banks(audience?)`, `bank(id)`, `openSession({userId, bankId, mode})`, `answer(sessionId, body)`, `results(userId, bankId?)` — every method resolves to `{ ok, status, data }` and **never throws** (network failure → `{ ok: false, status: 0, data: null }`). `schoolLog` — `profile/session/answer/bank(detail, data)` category emitters.
- Rationale: `DaylightAPI` swallows HTTP status; the runners need 403/410/500 distinctions (spec §8), so School uses its own thin fetch client.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/modules/School/schoolApi.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { schoolApi } from './schoolApi.js';

beforeEach(() => vi.unstubAllGlobals());

describe('schoolApi', () => {
  it('returns ok/status/data on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'b' }]), { status: 200 })));
    expect(await schoolApi.banks()).toEqual({ ok: true, status: 200, data: [{ id: 'b' }] });
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/banks', expect.any(Object));
  });
  it('passes audience and posts JSON bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await schoolApi.banks('generic');
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/banks?audience=generic', expect.any(Object));
    await schoolApi.answer('ses_1', { itemId: 'q1', given: 'x' });
    const [, opts] = fetch.mock.calls.at(-1);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ itemId: 'q1', given: 'x' });
  });
  it('maps HTTP errors to ok:false with status, and network failure to status 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'gone' }), { status: 410 })));
    expect(await schoolApi.answer('ses_x', { itemId: 'q', given: 'x' })).toMatchObject({ ok: false, status: 410 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    expect(await schoolApi.roster()).toEqual({ ok: false, status: 0, data: null });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/School/ 2>&1 | tail -5`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// frontend/src/modules/School/schoolApi.js
/**
 * Status-aware fetch client for /api/v1/school. NOT DaylightAPI: the runners
 * must distinguish 403 (guest/assigned), 410 (session gone), and 500 (attempt
 * unrecorded — spec §8), and DaylightAPI hides status codes. Never throws.
 */
const BASE = '/api/v1/school';

async function req(path, body) {
  const opts = body === undefined
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  try {
    const r = await fetch(BASE + path, opts);
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export const schoolApi = {
  roster: () => req('/roster'),
  banks: (audience) => req(`/banks${audience ? `?audience=${encodeURIComponent(audience)}` : ''}`),
  bank: (id) => req(`/banks/${encodeURIComponent(id)}`),
  openSession: ({ userId = null, bankId, mode }) => req('/sessions', { userId, bankId, mode }),
  answer: (sessionId, body) => req(`/sessions/${encodeURIComponent(sessionId)}/answer`, body),
  results: (userId, bankId) => req(`/users/${encodeURIComponent(userId)}/results${bankId ? `?bankId=${encodeURIComponent(bankId)}` : ''}`),
};

export default schoolApi;
```

```javascript
// frontend/src/modules/School/schoolLog.js
/**
 * School logging facade — categories over a child logger (pattern:
 * frontend/src/modules/Feed/Scroll/feedLog.js). Spec §9 event names.
 */
import getLogger from '../../lib/logging/Logger.js';

function logger() {
  return getLogger().child({ component: 'school' });
}

function emit(category, detail, data, level = 'info') {
  const payload = typeof data === 'object' && data !== null ? { ...data } : {};
  payload.detail = detail;
  logger()[level](`school.${category}`, payload);
}

export const schoolLog = {
  profile: (detail, data) => emit('profile', detail, data),           // claimed | lapsed
  session: (detail, data) => emit('session', detail, data),           // start | end
  answer:  (detail, data) => emit('answer', detail, data, 'debug'),   // graded
  answerError: (detail, data) => emit('answer', detail, data, 'error'), // record-failed
  bank:    (detail, data) => emit('bank', detail, data, 'warn'),
};

export default schoolLog;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/School/ 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/School
git commit -m "feat(school): status-aware api client + logging facade"
```

---

### Task 8: SchoolProfileContext (claim, guest, persistence, 10-minute lapse)

**Files:**
- Create: `frontend/src/modules/School/identity/SchoolProfileContext.jsx`
- Test: `frontend/src/modules/School/identity/SchoolProfileContext.test.jsx`

**Interfaces:**
- Consumes: `schoolApi.roster()`; `useIdleGap` and `firesOnGap` semantics from Task 1 (`lib/identity/useIdleGap.js`).
- Produces: `SchoolProfileProvider({ children })` and `useSchoolProfile() -> { status: 'loading'|'ready', roster, currentUser, isGuest, pickerOpen, openPicker(), claim(id), continueAsGuest(), unclaim() }`. `currentUser` is the hydrated roster entry or `null`. Persistence: `localStorage['school:user']` (flat key — spec §6). Lapse: `useIdleGap(undefined, 0, 10, unclaim)` — 10 minutes; the piano-proven model where the gap is detected on the NEXT interaction, which also satisfies "answering resets the timer" (any pointerdown bumps it).

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/modules/School/identity/SchoolProfileContext.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { SchoolProfileProvider, useSchoolProfile } from './SchoolProfileContext.jsx';

vi.mock('../schoolApi.js', () => ({
  schoolApi: { roster: vi.fn(async () => ({ ok: true, status: 200, data: [{ id: 'kid1', name: 'Alpha' }, { id: 'kid2', name: 'Beta' }] })) },
}));

let ctx;
function Probe() { ctx = useSchoolProfile(); return <div data-testid="user">{ctx.currentUser?.id || (ctx.isGuest ? 'guest' : 'none')}</div>; }
const mount = () => render(<SchoolProfileProvider><Probe /></SchoolProfileProvider>);

beforeEach(() => { localStorage.clear(); vi.useRealTimers(); });

describe('SchoolProfileContext', () => {
  it('loads roster; starts unclaimed with no stored user', async () => {
    mount();
    await waitFor(() => expect(ctx.status).toBe('ready'));
    expect(ctx.roster).toHaveLength(2);
    expect(screen.getByTestId('user').textContent).toBe('none');
  });
  it('claim persists to localStorage["school:user"]; restore works; guest never persists', async () => {
    mount();
    await waitFor(() => expect(ctx.status).toBe('ready'));
    act(() => ctx.claim('kid1'));
    expect(localStorage.getItem('school:user')).toBe('kid1');
    act(() => ctx.continueAsGuest());
    expect(screen.getByTestId('user').textContent).toBe('guest');
    expect(localStorage.getItem('school:user')).toBe(null);
  });
  it('restores a stored id still on the roster; clears one that is not', async () => {
    localStorage.setItem('school:user', 'kid2');
    mount();
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('kid2'));
    localStorage.setItem('school:user', 'departed');
    mount();
    await waitFor(() => expect(ctx.status).toBe('ready'));
    expect(ctx.currentUser).toBe(null);
    expect(localStorage.getItem('school:user')).toBe(null);
  });
  it('lapses after a 10-minute idle gap on the next interaction; activity inside the window does not lapse', async () => {
    vi.useFakeTimers();
    mount();
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    act(() => ctx.claim('kid1'));
    // interaction inside the window keeps identity
    act(() => { vi.advanceTimersByTime(5 * 60_000); fireEvent.pointerDown(window); });
    expect(screen.getByTestId('user').textContent).toBe('kid1');
    // a >=10-minute gap: the NEXT interaction triggers the lapse
    act(() => { vi.advanceTimersByTime(10 * 60_000 + 1); fireEvent.pointerDown(window); });
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(localStorage.getItem('school:user')).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/School/identity/ 2>&1 | tail -5`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// frontend/src/modules/School/identity/SchoolProfileContext.jsx
/**
 * School identity container (spec §6). Soft pick + idle lapse: identity is
 * claimable by a tap, persisted per-device under the flat key 'school:user',
 * and cleared when a >=10-minute idle gap is detected (on the next
 * interaction — the piano-proven useIdleGap model). Guest is a session-only
 * state and is never persisted. Runners react to identity changes themselves
 * (they abandon their session when currentUser changes — spec §6).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useIdleGap } from '../../../lib/identity/useIdleGap.js';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';

const STORAGE_KEY = 'school:user';
const LAPSE_MINUTES = 10;

const SchoolProfileContext = createContext(null);

export function SchoolProfileProvider({ children }) {
  const [status, setStatus] = useState('loading');
  const [roster, setRoster] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [isGuest, setIsGuest] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    schoolApi.roster().then(({ ok, data }) => {
      if (!alive) return;
      const users = ok && Array.isArray(data) ? data : [];
      setRoster(users);
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && users.some((u) => u.id === stored)) {
        setCurrentId(stored);
      } else if (stored) {
        localStorage.removeItem(STORAGE_KEY); // departed roster member: fail to unclaimed
      }
      setStatus('ready');
    });
    return () => { alive = false; };
  }, []);

  const claim = useCallback((id) => {
    setCurrentId(id);
    setIsGuest(false);
    setPickerOpen(false);
    localStorage.setItem(STORAGE_KEY, id);
    schoolLog.profile('claimed', { userId: id });
  }, []);

  const continueAsGuest = useCallback(() => {
    setCurrentId(null);
    setIsGuest(true);
    setPickerOpen(false);
    localStorage.removeItem(STORAGE_KEY);
    schoolLog.profile('claimed', { userId: null, guest: true });
  }, []);

  const unclaim = useCallback((reason = 'lapse') => {
    setCurrentId((prev) => {
      if (prev) schoolLog.profile('lapsed', { userId: prev, reason });
      return null;
    });
    setIsGuest(false);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  // 10-minute idle lapse. Any pointerdown/keydown counts as interaction
  // (answering an item is a tap), so a slow thinker never lapses mid-quiz.
  useIdleGap(undefined, 0, LAPSE_MINUTES, unclaim);

  const currentUser = useMemo(() => roster.find((u) => u.id === currentId) || null, [roster, currentId]);
  const value = useMemo(() => ({
    status, roster, currentUser, isGuest, pickerOpen,
    openPicker: () => setPickerOpen(true),
    closePicker: () => setPickerOpen(false),
    claim, continueAsGuest, unclaim,
  }), [status, roster, currentUser, isGuest, pickerOpen, claim, continueAsGuest, unclaim]);

  return <SchoolProfileContext.Provider value={value}>{children}</SchoolProfileContext.Provider>;
}

export function useSchoolProfile() {
  const ctx = useContext(SchoolProfileContext);
  if (!ctx) throw new Error('useSchoolProfile requires SchoolProfileProvider');
  return ctx;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/School/identity/ 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/School/identity
git commit -m "feat(school): profile context — claim, guest, persistence, 10-min lapse"
```

---

### Task 9: Quiz item components (four types)

**Files:**
- Create: `frontend/src/modules/School/quiz/items/MultipleChoiceItem.jsx`, `ShortAnswerItem.jsx`, `ClozeItem.jsx`, `MatchingItem.jsx`
- Test: `frontend/src/modules/School/quiz/items/items.test.jsx`

**Interfaces:**
- Produces: each component takes `{ item, onSubmit, verdict }` — `onSubmit(given)` fires once with the item's `given` shape (string; matching: full `[{left, right}]` array). `verdict` is `null` while unanswered or `{ correct, expected }` after; when non-null the component is inert and shows right/wrong. Matching supports tap-left-then-tap-right AND drag-from-left-to-right (pointer events — R4.4 allows drag on the Portal). Buttons only, ≥64px touch targets (styles in Task 11's `School.scss`; class names `school-item__*`).

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/modules/School/quiz/items/items.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MultipleChoiceItem from './MultipleChoiceItem.jsx';
import ShortAnswerItem from './ShortAnswerItem.jsx';
import ClozeItem from './ClozeItem.jsx';
import MatchingItem from './MatchingItem.jsx';

describe('MultipleChoiceItem', () => {
  const item = { id: 'q', type: 'multiple_choice', prompt: 'WA?', answer: 'Olympia', choices: ['Seattle', 'Olympia'] };
  it('submits the tapped choice; inert after verdict', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<MultipleChoiceItem item={item} onSubmit={onSubmit} verdict={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Olympia' }));
    expect(onSubmit).toHaveBeenCalledWith('Olympia');
    rerender(<MultipleChoiceItem item={item} onSubmit={onSubmit} verdict={{ correct: false, expected: 'Olympia' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Seattle' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Olympia/)).toBeInTheDocument(); // expected shown on wrong
  });
});

describe('ShortAnswerItem', () => {
  const item = { id: 'q', type: 'short_answer', prompt: 'OR?', answer: 'Salem' };
  it('submits typed text; ignores empty submit', () => {
    const onSubmit = vi.fn();
    render(<ShortAnswerItem item={item} onSubmit={onSubmit} verdict={null} />);
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' Salem ' } });
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onSubmit).toHaveBeenCalledWith(' Salem ');
  });
});

describe('ClozeItem', () => {
  it('renders the prompt split around the blank and submits', () => {
    const onSubmit = vi.fn();
    render(<ClozeItem item={{ id: 'q', type: 'cloze', prompt: 'Capital of Idaho is ___.', answer: 'Boise' }} onSubmit={onSubmit} verdict={null} />);
    expect(screen.getByText(/Capital of Idaho is/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Boise' } });
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onSubmit).toHaveBeenCalledWith('Boise');
  });
});

describe('MatchingItem', () => {
  const item = { id: 'm', type: 'matching', prompt: 'Match', pairs: [{ left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }] };
  it('tap-left-then-tap-right forms pairs; submits all pairs when complete', () => {
    const onSubmit = vi.fn();
    render(<MatchingItem item={item} onSubmit={onSubmit} verdict={null} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'WA' }));
    fireEvent.pointerUp(screen.getByRole('button', { name: 'WA' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Olympia' }));
    fireEvent.pointerUp(screen.getByRole('button', { name: 'Olympia' }));
    expect(onSubmit).not.toHaveBeenCalled(); // one pair left
    fireEvent.pointerDown(screen.getByRole('button', { name: 'OR' }));
    fireEvent.pointerUp(screen.getByRole('button', { name: 'OR' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Salem' }));
    fireEvent.pointerUp(screen.getByRole('button', { name: 'Salem' }));
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onSubmit).toHaveBeenCalledWith([{ left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }]);
  });
  it('tapping a paired left unpairs it', () => {
    const onSubmit = vi.fn();
    render(<MatchingItem item={item} onSubmit={onSubmit} verdict={null} />);
    const pairUp = (l, r) => {
      fireEvent.pointerDown(screen.getByRole('button', { name: l })); fireEvent.pointerUp(screen.getByRole('button', { name: l }));
      fireEvent.pointerDown(screen.getByRole('button', { name: r })); fireEvent.pointerUp(screen.getByRole('button', { name: r }));
    };
    pairUp('WA', 'Olympia');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'WA' }));
    fireEvent.pointerUp(screen.getByRole('button', { name: 'WA' }));
    pairUp('WA', 'Salem');
    pairUp('OR', 'Olympia');
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onSubmit).toHaveBeenCalledWith([{ left: 'WA', right: 'Salem' }, { left: 'OR', right: 'Olympia' }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/School/quiz/ 2>&1 | tail -5`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the four components**

```jsx
// frontend/src/modules/School/quiz/items/MultipleChoiceItem.jsx
/** Tap-target multiple choice. Submits on tap; inert once a verdict exists. */
export default function MultipleChoiceItem({ item, onSubmit, verdict }) {
  return (
    <div className="school-item school-item--mc">
      <p className="school-item__prompt">{item.prompt}</p>
      <div className="school-item__choices">
        {item.choices.map((choice) => {
          const cls = ['school-item__choice'];
          if (verdict) {
            if (choice === verdict.expected) cls.push('school-item__choice--right');
            else cls.push('school-item__choice--dim');
          }
          return (
            <button key={choice} type="button" className={cls.join(' ')} disabled={!!verdict}
              onClick={() => onSubmit(choice)}>
              {choice}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

```jsx
// frontend/src/modules/School/quiz/items/ShortAnswerItem.jsx
/** Free-text answer via the device's soft keyboard. Empty submits are ignored. */
import { useState } from 'react';

export default function ShortAnswerItem({ item, onSubmit, verdict }) {
  const [text, setText] = useState('');
  const submit = () => { if (text.trim()) onSubmit(text); };
  return (
    <div className="school-item school-item--short">
      <p className="school-item__prompt">{item.prompt}</p>
      <input className="school-item__input" type="text" value={text} disabled={!!verdict}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
      {!verdict && <button type="button" className="school-item__check" onClick={submit}>Check</button>}
      {verdict && !verdict.correct && (
        <p className="school-item__expected">Answer: <strong>{verdict.expected}</strong></p>
      )}
    </div>
  );
}
```

```jsx
// frontend/src/modules/School/quiz/items/ClozeItem.jsx
/** Fill-in-the-blank: the prompt is split around the single ___ marker
 *  (validation guarantees exactly one), with the input inline. */
import { useState } from 'react';

export default function ClozeItem({ item, onSubmit, verdict }) {
  const [text, setText] = useState('');
  const [before, after] = item.prompt.split('___');
  const submit = () => { if (text.trim()) onSubmit(text); };
  return (
    <div className="school-item school-item--cloze">
      <p className="school-item__prompt">
        {before}
        <input className="school-item__input school-item__input--inline" type="text" value={text}
          disabled={!!verdict} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
        {after}
      </p>
      {!verdict && <button type="button" className="school-item__check" onClick={submit}>Check</button>}
      {verdict && !verdict.correct && (
        <p className="school-item__expected">Answer: <strong>{verdict.expected}</strong></p>
      )}
    </div>
  );
}
```

```jsx
// frontend/src/modules/School/quiz/items/MatchingItem.jsx
/**
 * Pair the left column with the right. Two gestures, one mechanism:
 *  - tap a left chip (selects it), then tap a right chip -> pair
 *  - drag from a left chip and release on a right chip -> pair
 * Both are pointerdown-on-left / pointerup-on-right; a tap is just a drag of
 * zero distance with an intervening pointerup on the same chip (which keeps
 * the selection). Tapping an already-paired left chip unpairs it. Drag is
 * allowed on the Portal (R4.4) — this is NOT the fitness no-drag surface.
 * Rights are displayed shuffled so the answer isn't the layout.
 */
import { useMemo, useRef, useState } from 'react';

export default function MatchingItem({ item, onSubmit, verdict }) {
  const [selected, setSelected] = useState(null);      // left value awaiting a right
  const [pairs, setPairs] = useState({});               // left -> right
  const dragFrom = useRef(null);
  const rights = useMemo(
    () => [...item.pairs].map((p) => p.right).sort(() => 0.5 - Math.random()),
    [item],
  );
  const pairedRights = new Set(Object.values(pairs));
  const complete = Object.keys(pairs).length === item.pairs.length;

  const downLeft = (left) => {
    if (verdict) return;
    if (pairs[left]) { // unpair
      setPairs((p) => { const n = { ...p }; delete n[left]; return n; });
      setSelected(null);
      return;
    }
    dragFrom.current = left;
    setSelected(left);
  };
  const upRight = (right) => {
    if (verdict || pairedRights.has(right)) return;
    const left = dragFrom.current || selected;
    if (!left) return;
    setPairs((p) => ({ ...p, [left]: right }));
    setSelected(null);
    dragFrom.current = null;
  };

  return (
    <div className="school-item school-item--matching">
      <p className="school-item__prompt">{item.prompt}</p>
      <div className="school-item__columns">
        <div className="school-item__col">
          {item.pairs.map(({ left }) => (
            <button key={left} type="button"
              className={`school-item__chip${selected === left ? ' school-item__chip--selected' : ''}${pairs[left] ? ' school-item__chip--paired' : ''}`}
              disabled={!!verdict}
              onPointerDown={() => downLeft(left)}
              onPointerUp={() => { /* pointerup on the same chip keeps the selection */ }}>
              {left}{pairs[left] ? ` → ${pairs[left]}` : ''}
            </button>
          ))}
        </div>
        <div className="school-item__col">
          {rights.map((right) => (
            <button key={right} type="button"
              className={`school-item__chip${pairedRights.has(right) ? ' school-item__chip--paired' : ''}`}
              disabled={!!verdict}
              onPointerUp={() => upRight(right)}>
              {right}
            </button>
          ))}
        </div>
      </div>
      {!verdict && (
        <button type="button" className="school-item__check" disabled={!complete}
          onClick={() => onSubmit(item.pairs.map(({ left }) => ({ left, right: pairs[left] })))}>
          Check
        </button>
      )}
      {verdict && !verdict.correct && (
        <div className="school-item__expected">
          {verdict.expected.map((p) => <p key={p.left}>{p.left} → {p.right}</p>)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/School/quiz/ 2>&1 | tail -5`
Expected: PASS. (If the unpair test fails because `disabled` chips swallow pointer events, keep chips enabled and gate inside the handlers — the `verdict` early-return already does this.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/School/quiz
git commit -m "feat(school): four quiz item components incl. tap-or-drag matching"
```

---

### Task 10: QuizRunner (one pass, verdicts, unrecorded banner, identity-abandon)

**Files:**
- Create: `frontend/src/modules/School/quiz/QuizRunner.jsx`
- Test: `frontend/src/modules/School/quiz/QuizRunner.test.jsx`

**Interfaces:**
- Consumes: `schoolApi` (Task 7), `useSchoolProfile` (Task 8), the four item components (Task 9), `schoolLog`.
- Produces: `QuizRunner({ bank, onExit })` — opens a `mode:'quiz'` session on mount (`userId: currentUser?.id ?? null`), one item at a time in bank order, POST per answer, verdict shown then a Next button, summary screen (`score/total`) at the end with a Done button → `onExit()`. **No resurfacing.** On `!ok` answer response: 410 → exit to browser; other failures → verdict still shown if grading succeeded server-side is unknowable, so show an **"Answer not recorded"** banner (`data-testid="unrecorded"`) and allow continuing (spec §8). If `currentUser`/guest identity changes mid-run → discard session, `onExit()` (spec §6).

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/modules/School/quiz/QuizRunner.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QuizRunner from './QuizRunner.jsx';

const answerMock = vi.fn();
vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    openSession: vi.fn(async () => ({ ok: true, status: 200, data: { sessionId: 'ses_1' } })),
    answer: (...a) => answerMock(...a),
  },
}));

let profile;
vi.mock('../identity/SchoolProfileContext.jsx', () => ({
  useSchoolProfile: () => profile,
}));

const bank = { id: 'caps', title: 'Caps', items: [
  { id: 'q1', type: 'multiple_choice', prompt: 'WA?', answer: 'Olympia', choices: ['Seattle', 'Olympia'] },
  { id: 'q2', type: 'multiple_choice', prompt: 'OR?', answer: 'Salem', choices: ['Salem', 'Boise'] },
] };

beforeEach(() => {
  profile = { currentUser: { id: 'kid1', name: 'KID1' }, isGuest: false };
  answerMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { correct: true, expected: 'Olympia', attemptId: 'att_1' } });
});

describe('QuizRunner', () => {
  it('runs one pass — a wrong answer is NOT re-asked — and ends on a summary', async () => {
    answerMock
      .mockResolvedValueOnce({ ok: true, status: 200, data: { correct: false, expected: 'Olympia', attemptId: 'att_1' } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { correct: true, expected: 'Salem', attemptId: 'att_2' } });
    render(<QuizRunner bank={bank} onExit={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Seattle' })); // wrong
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Salem' }));  // right
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    expect(await screen.findByTestId('quiz-summary')).toHaveTextContent('1 / 2');
    expect(answerMock).toHaveBeenCalledTimes(2); // strictly one POST per item
  });
  it('shows the unrecorded banner on a 500 and still allows continuing', async () => {
    answerMock.mockResolvedValueOnce({ ok: false, status: 500, data: { error: 'internal' } });
    render(<QuizRunner bank={bank} onExit={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Olympia' }));
    expect(await screen.findByTestId('unrecorded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });
  it('exits on a 410 (session gone after restart)', async () => {
    const onExit = vi.fn();
    answerMock.mockResolvedValueOnce({ ok: false, status: 410, data: null });
    render(<QuizRunner bank={bank} onExit={onExit} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Olympia' }));
    await waitFor(() => expect(onExit).toHaveBeenCalled());
  });
  it('abandons the run when identity changes mid-quiz', async () => {
    const onExit = vi.fn();
    const { rerender } = render(<QuizRunner bank={bank} onExit={onExit} />);
    await screen.findByRole('button', { name: 'Olympia' });
    profile = { currentUser: null, isGuest: false }; // lapse
    rerender(<QuizRunner bank={bank} onExit={onExit} />);
    await waitFor(() => expect(onExit).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/School/quiz/QuizRunner.test.jsx 2>&1 | tail -5`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```jsx
// frontend/src/modules/School/quiz/QuizRunner.jsx
/**
 * One-pass quiz (spec §3): each item asked exactly once, POST per answer,
 * verdict shown, summary at the end. Deliberately NO resurfacing — a quiz is
 * an assessment; re-asking missed items would converge every score to 100%
 * and gut the R2.5 completion signal. Identity change mid-run abandons the
 * session (spec §6): the session is pinned server-side to whoever opened it.
 */
import { useEffect, useRef, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import { useSchoolProfile } from '../identity/SchoolProfileContext.jsx';
import MultipleChoiceItem from './items/MultipleChoiceItem.jsx';
import ShortAnswerItem from './items/ShortAnswerItem.jsx';
import ClozeItem from './items/ClozeItem.jsx';
import MatchingItem from './items/MatchingItem.jsx';

const ITEM_COMPONENTS = {
  multiple_choice: MultipleChoiceItem,
  short_answer: ShortAnswerItem,
  cloze: ClozeItem,
  matching: MatchingItem,
};

export default function QuizRunner({ bank, onExit }) {
  const { currentUser, isGuest } = useSchoolProfile();
  const [sessionId, setSessionId] = useState(null);
  const [index, setIndex] = useState(0);
  const [verdict, setVerdict] = useState(null);
  const [unrecorded, setUnrecorded] = useState(false);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);

  // Identity pinned at mount; any change (lapse, switch, guest flip) abandons.
  const identityKey = currentUser?.id ?? (isGuest ? 'guest' : 'none');
  const initialIdentity = useRef(identityKey);
  useEffect(() => {
    if (identityKey !== initialIdentity.current) {
      schoolLog.session('end', { sessionId, bankId: bank.id, mode: 'quiz', reason: 'identity-changed' });
      onExit();
    }
  }, [identityKey, sessionId, bank.id, onExit]);

  useEffect(() => {
    let alive = true;
    schoolApi.openSession({ userId: currentUser?.id ?? null, bankId: bank.id, mode: 'quiz' }).then(({ ok, data }) => {
      if (!alive) return;
      if (!ok) { onExit(); return; }
      setSessionId(data.sessionId);
      schoolLog.session('start', { sessionId: data.sessionId, bankId: bank.id, mode: 'quiz', userId: currentUser?.id ?? null, itemCount: bank.items.length });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const item = bank.items[index];

  const submit = async (given) => {
    if (!sessionId || verdict) return;
    const { ok, status, data } = await schoolApi.answer(sessionId, { itemId: item.id, given });
    if (status === 410) { onExit(); return; }
    if (!ok) {
      // Grading state unknowable; the attempt is NOT on disk. Never silent (spec §8).
      schoolLog.answerError('record-failed', { sessionId, itemId: item.id, status });
      setUnrecorded(true);
      setVerdict({ correct: false, expected: null, unrecorded: true });
      return;
    }
    schoolLog.answer('graded', { sessionId, itemId: item.id, itemType: item.type, correct: data.correct });
    if (data.correct) setScore((s) => s + 1);
    setVerdict(data);
  };

  const next = () => {
    setVerdict(null);
    setUnrecorded(false);
    if (index + 1 >= bank.items.length) {
      setDone(true);
      schoolLog.session('end', { sessionId, bankId: bank.id, mode: 'quiz', score, total: bank.items.length });
    } else {
      setIndex((i) => i + 1);
    }
  };

  if (done) {
    return (
      <div className="school-runner school-runner--summary" data-testid="quiz-summary">
        <h2>{bank.title}</h2>
        <p className="school-runner__score">{score} / {bank.items.length}</p>
        <button type="button" className="school-runner__done" onClick={onExit}>Done</button>
      </div>
    );
  }
  if (!item) return null;
  const ItemComponent = ITEM_COMPONENTS[item.type];
  return (
    <div className="school-runner school-runner--quiz">
      <div className="school-runner__progress">{index + 1} / {bank.items.length}</div>
      {unrecorded && <div className="school-runner__unrecorded" data-testid="unrecorded">Answer not recorded — check the server.</div>}
      <ItemComponent key={item.id} item={item} onSubmit={submit} verdict={verdict} />
      {verdict && <button type="button" className="school-runner__next" onClick={next}>Next</button>}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/School/quiz/ 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/School/quiz
git commit -m "feat(school): one-pass QuizRunner with unrecorded banner + identity abandon"
```

---

### Task 11: FlashcardRunner (reveal, self-grade, in-session resurfacing)

**Files:**
- Create: `frontend/src/modules/School/flashcards/FlashcardRunner.jsx`
- Test: `frontend/src/modules/School/flashcards/FlashcardRunner.test.jsx`

**Interfaces:**
- Consumes: `schoolApi`, `useSchoolProfile`, `schoolLog`.
- Produces: `FlashcardRunner({ bank, onExit })` — opens a `mode:'flashcard'` session; per card: prompt → tap **Show answer** → answer shown (matching: the pair list) with **Got it** / **Missed** buttons; **Missed** POSTs `selfGrade:'incorrect'` AND requeues the card at the end of the deck (R4.3 — resurfaces until got); **Got it** POSTs `selfGrade:'correct'`. Summary when the queue empties (`cards seen`, `first-try count`). Identity-change abandon identical to QuizRunner.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/modules/School/flashcards/FlashcardRunner.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FlashcardRunner from './FlashcardRunner.jsx';

const answerMock = vi.fn();
vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    openSession: vi.fn(async () => ({ ok: true, status: 200, data: { sessionId: 'ses_1' } })),
    answer: (...a) => answerMock(...a),
  },
}));
vi.mock('../identity/SchoolProfileContext.jsx', () => ({
  useSchoolProfile: () => ({ currentUser: { id: 'kid1' }, isGuest: false }),
}));

const bank = { id: 'caps', title: 'Caps', items: [
  { id: 'q1', type: 'short_answer', prompt: 'OR?', answer: 'Salem' },
  { id: 'q2', type: 'short_answer', prompt: 'WA?', answer: 'Olympia' },
] };

beforeEach(() => { answerMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { attemptId: 'att_1' } }); });

describe('FlashcardRunner', () => {
  it('reveal -> self-grade posts selfGrade, never given', async () => {
    render(<FlashcardRunner bank={bank} onExit={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /show answer/i }));
    expect(screen.getByText('Salem')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    await waitFor(() => expect(answerMock).toHaveBeenCalledWith('ses_1', { itemId: 'q1', selfGrade: 'correct' }));
    expect(answerMock.mock.calls[0][1].given).toBeUndefined();
  });
  it('a missed card resurfaces before the session ends (R4.3)', async () => {
    render(<FlashcardRunner bank={bank} onExit={() => {}} />);
    // miss q1
    fireEvent.click(await screen.findByRole('button', { name: /show answer/i }));
    fireEvent.click(screen.getByRole('button', { name: /missed/i }));
    // q2 got
    fireEvent.click(await screen.findByRole('button', { name: /show answer/i }));
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    // q1 comes back
    expect(await screen.findByText('OR?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show answer/i }));
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    expect(await screen.findByTestId('cards-summary')).toHaveTextContent('1 / 2'); // first-try count
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/School/flashcards/ 2>&1 | tail -5`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```jsx
// frontend/src/modules/School/flashcards/FlashcardRunner.jsx
/**
 * Flashcard drill (spec §3, R4.3): prompt -> reveal -> self-grade. A missed
 * card requeues at the end of the deck until got — resurfacing belongs to
 * drilling, not assessment (contrast QuizRunner). Self-grades are recorded
 * verbatim server-side (mode contract, spec §5): selfGrade only, never given.
 */
import { useEffect, useRef, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import { useSchoolProfile } from '../identity/SchoolProfileContext.jsx';

const answerText = (item) => (item.type === 'matching'
  ? item.pairs.map((p) => `${p.left} → ${p.right}`).join('\n')
  : item.answer);

export default function FlashcardRunner({ bank, onExit }) {
  const { currentUser, isGuest } = useSchoolProfile();
  const [sessionId, setSessionId] = useState(null);
  const [queue, setQueue] = useState(bank.items);
  const [revealed, setRevealed] = useState(false);
  const [firstTry, setFirstTry] = useState(0);
  const missedOnce = useRef(new Set());

  const identityKey = currentUser?.id ?? (isGuest ? 'guest' : 'none');
  const initialIdentity = useRef(identityKey);
  useEffect(() => {
    if (identityKey !== initialIdentity.current) {
      schoolLog.session('end', { sessionId, bankId: bank.id, mode: 'flashcard', reason: 'identity-changed' });
      onExit();
    }
  }, [identityKey, sessionId, bank.id, onExit]);

  useEffect(() => {
    let alive = true;
    schoolApi.openSession({ userId: currentUser?.id ?? null, bankId: bank.id, mode: 'flashcard' }).then(({ ok, data }) => {
      if (!alive) return;
      if (!ok) { onExit(); return; }
      setSessionId(data.sessionId);
      schoolLog.session('start', { sessionId: data.sessionId, bankId: bank.id, mode: 'flashcard', userId: currentUser?.id ?? null, itemCount: bank.items.length });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const card = queue[0];

  const grade = async (got) => {
    if (!sessionId || !card) return;
    const { status } = await schoolApi.answer(sessionId, { itemId: card.id, selfGrade: got ? 'correct' : 'incorrect' });
    if (status === 410) { onExit(); return; }
    setRevealed(false);
    if (got) {
      if (!missedOnce.current.has(card.id)) setFirstTry((n) => n + 1);
      setQueue((q) => q.slice(1));
    } else {
      missedOnce.current.add(card.id);
      setQueue((q) => [...q.slice(1), card]); // resurface at the end
    }
  };

  if (!card) {
    return (
      <div className="school-runner school-runner--summary" data-testid="cards-summary">
        <h2>{bank.title}</h2>
        <p className="school-runner__score">{firstTry} / {bank.items.length}</p>
        <p className="school-runner__hint">first try</p>
        <button type="button" className="school-runner__done" onClick={onExit}>Done</button>
      </div>
    );
  }
  return (
    <div className="school-runner school-runner--cards">
      <div className="school-runner__progress">{bank.items.length - queue.length + 1} / {bank.items.length}{queue.length > bank.items.length ? ' +' : ''}</div>
      <div className="school-card">
        <p className="school-card__prompt">{card.prompt}</p>
        {revealed && <p className="school-card__answer" style={{ whiteSpace: 'pre-line' }}>{answerText(card)}</p>}
      </div>
      {!revealed
        ? <button type="button" className="school-runner__next" onClick={() => setRevealed(true)}>Show answer</button>
        : (
          <div className="school-runner__grades">
            <button type="button" className="school-runner__missed" onClick={() => grade(false)}>Missed</button>
            <button type="button" className="school-runner__got" onClick={() => grade(true)}>Got it</button>
          </div>
        )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/School/flashcards/ 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/School/flashcards
git commit -m "feat(school): FlashcardRunner — self-grade + in-session resurfacing"
```

---

### Task 12: SchoolApp shell, BankBrowser, styles, app registration

**Files:**
- Create: `frontend/src/modules/School/SchoolApp.jsx`, `frontend/src/modules/School/browse/BankBrowser.jsx`, `frontend/src/modules/School/School.scss`
- Modify: `frontend/src/lib/appRegistry.js`
- Test: `frontend/src/modules/School/SchoolApp.test.jsx`

**Interfaces:**
- Consumes: everything above; `ProfilePicker` and `ProfileAvatar` from `lib/identity/` (Task 1).
- Produces: `SchoolApp({ clear })` (AppContainer contract — `clear` exits the app). Registry entry `'school'`. Flow: header (title + profile chip: avatar + name or "Tap to sign in") · body = BankBrowser | QuizRunner | FlashcardRunner. Launching a bank while unclaimed opens the picker with the launch pending; picking claims + proceeds; dismissing continues as guest, and a pending **assigned** bank launch is then blocked with an inline notice (the browser refetches with `audience=generic`). Guests and unclaimed browsers see only generic banks unless claimed.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/modules/School/SchoolApp.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SchoolApp from './SchoolApp.jsx';

const banksMock = vi.fn();
vi.mock('./schoolApi.js', () => ({
  schoolApi: {
    roster: vi.fn(async () => ({ ok: true, status: 200, data: [{ id: 'kid1', name: 'Alpha' }] })),
    banks: (...a) => banksMock(...a),
    bank: vi.fn(async (id) => ({ ok: true, status: 200, data: { id, title: 'Caps', audience: 'assigned', items: [{ id: 'q1', type: 'multiple_choice', prompt: 'WA?', answer: 'Olympia', choices: ['Seattle', 'Olympia'] }] } })),
    openSession: vi.fn(async () => ({ ok: true, status: 200, data: { sessionId: 'ses_1' } })),
    answer: vi.fn(async () => ({ ok: true, status: 200, data: { correct: true, expected: 'Olympia', attemptId: 'att_1' } })),
  },
}));

beforeEach(() => {
  localStorage.clear();
  banksMock.mockReset().mockImplementation(async (audience) => ({
    ok: true, status: 200,
    data: audience === 'generic'
      ? [{ id: 'animals', title: 'Animals', audience: 'generic', itemCount: 1 }]
      : [{ id: 'caps', title: 'Caps', audience: 'assigned', itemCount: 1 }, { id: 'animals', title: 'Animals', audience: 'generic', itemCount: 1 }],
  }));
});

describe('SchoolApp', () => {
  it('unclaimed: starting a bank opens the picker; picking claims and enters the quiz', async () => {
    render(<SchoolApp clear={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /quiz/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument(); // ProfilePicker
    fireEvent.click(screen.getByText('Alpha'));
    expect(await screen.findByText('WA?')).toBeInTheDocument();
  });
  it('guest sees only generic banks', async () => {
    render(<SchoolApp clear={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /tap to sign in/i }));
    fireEvent.click(await screen.findByLabelText(/close/i)); // dismiss picker -> guest
    await waitFor(() => expect(banksMock).toHaveBeenLastCalledWith('generic'));
    expect(await screen.findByText('Animals')).toBeInTheDocument();
    expect(screen.queryByText('Caps')).toBeNull();
  });
});
```

Note: the dismiss control in `ProfilePicker` is the moved piano markup — before writing the test assertion, read `frontend/src/lib/identity/ProfilePicker.jsx` and target its actual close-affordance selector (the ✕ button's aria-label or class); adjust `findByLabelText(/close/i)` to match reality, keeping the test's *behaviour* (dismiss → guest) identical.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/School/SchoolApp.test.jsx 2>&1 | tail -5`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```jsx
// frontend/src/modules/School/browse/BankBrowser.jsx
/** Grid of banks. Each card offers Quiz and Cards. Guests get generic only. */
import { useEffect, useState } from 'react';
import { schoolApi } from '../schoolApi.js';

export default function BankBrowser({ guestOnly, onLaunch, notice }) {
  const [banks, setBanks] = useState(null);
  useEffect(() => {
    let alive = true;
    schoolApi.banks(guestOnly ? 'generic' : undefined).then(({ ok, data }) => {
      if (alive) setBanks(ok && Array.isArray(data) ? data : []);
    });
    return () => { alive = false; };
  }, [guestOnly]);

  if (banks === null) return <div className="school-browse school-browse--loading">Loading…</div>;
  if (banks.length === 0) {
    return (
      <div className="school-browse school-browse--empty">
        <p>No quizzes yet.</p>
        <p className="school-browse__hint">Add a bank YAML under data/content/quizzes/ to get started.</p>
      </div>
    );
  }
  return (
    <div className="school-browse">
      {notice && <div className="school-browse__notice">{notice}</div>}
      <div className="school-browse__grid">
        {banks.map((b) => (
          <div key={b.id} className="school-browse__card">
            <h3 className="school-browse__title">{b.title}</h3>
            <p className="school-browse__meta">{b.itemCount} items{b.audience === 'generic' ? ' · anyone' : ''}</p>
            <div className="school-browse__actions">
              <button type="button" onClick={() => onLaunch(b, 'quiz')}>Quiz</button>
              <button type="button" onClick={() => onLaunch(b, 'flashcard')}>Cards</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

```jsx
// frontend/src/modules/School/SchoolApp.jsx
/**
 * School app root (registered as 'school' in appRegistry; AppContainer passes
 * {clear}). Owns the picker-flow: launching tracked work while unclaimed opens
 * the ProfilePicker with the launch pending (spec §6 — claim prompt on
 * tracked work; browsing never prompts).
 */
import { useCallback, useState } from 'react';
import ProfilePicker from '../../lib/identity/ProfilePicker.jsx';
import ProfileAvatar from '../../lib/identity/ProfileAvatar.jsx';
import { SchoolProfileProvider, useSchoolProfile } from './identity/SchoolProfileContext.jsx';
import BankBrowser from './browse/BankBrowser.jsx';
import QuizRunner from './quiz/QuizRunner.jsx';
import FlashcardRunner from './flashcards/FlashcardRunner.jsx';
import { schoolApi } from './schoolApi.js';
import './School.scss';

function SchoolShell({ clear }) {
  const { status, roster, currentUser, isGuest, pickerOpen, openPicker, claim, continueAsGuest } = useSchoolProfile();
  const [active, setActive] = useState(null);   // {bank, mode}
  const [pending, setPending] = useState(null); // {bankSummary, mode} awaiting a claim
  const [notice, setNotice] = useState(null);

  const start = useCallback(async (bankSummary, mode, asGuest) => {
    if (asGuest && bankSummary.audience !== 'generic') {
      setNotice('Sign in to take this one — guests get the practice sets.');
      return;
    }
    const { ok, data } = await schoolApi.bank(bankSummary.id);
    if (ok) { setNotice(null); setActive({ bank: data, mode }); }
  }, []);

  const onLaunch = useCallback((bankSummary, mode) => {
    if (!currentUser && !isGuest) {
      setPending({ bankSummary, mode });
      openPicker();
      return;
    }
    start(bankSummary, mode, isGuest);
  }, [currentUser, isGuest, openPicker, start]);

  const onPick = useCallback((id) => {
    claim(id);
    if (pending) { start(pending.bankSummary, pending.mode, false); setPending(null); }
  }, [claim, pending, start]);

  const onDismiss = useCallback(() => {
    continueAsGuest();
    if (pending) { start(pending.bankSummary, pending.mode, true); setPending(null); }
  }, [continueAsGuest, pending, start]);

  if (status !== 'ready') return <div className="school-app school-app--loading">Loading…</div>;
  return (
    <div className="school-app">
      <header className="school-app__header">
        <button type="button" className="school-app__back" aria-label="Exit school" onClick={() => (active ? setActive(null) : clear())}>‹</button>
        <h1 className="school-app__title">School</h1>
        <button type="button" className="school-app__chip" onClick={openPicker}>
          {currentUser
            ? (<><ProfileAvatar id={currentUser.id} name={currentUser.name} /><span>{currentUser.name}</span></>)
            : <span>{isGuest ? 'Guest' : 'Tap to sign in'}</span>}
        </button>
      </header>
      <main className="school-app__body">
        {!active && <BankBrowser guestOnly={isGuest || !currentUser} onLaunch={onLaunch} notice={notice} />}
        {active?.mode === 'quiz' && <QuizRunner bank={active.bank} onExit={() => setActive(null)} />}
        {active?.mode === 'flashcard' && <FlashcardRunner bank={active.bank} onExit={() => setActive(null)} />}
      </main>
      <ProfilePicker open={pickerOpen} users={roster} activeId={currentUser?.id} onPick={onPick} onDismiss={onDismiss} timeoutMs={30000} />
    </div>
  );
}

export default function SchoolApp({ clear }) {
  return (
    <SchoolProfileProvider>
      <SchoolShell clear={clear} />
    </SchoolProfileProvider>
  );
}
```

`frontend/src/modules/School/School.scss` — write the module stylesheet: dark theme matching the Portal, `.school-app` column layout (header 64px / body flex-1), `.school-app__chip` right-aligned with the avatar at 2rem, `.school-browse__grid` as `repeat(auto-fill, minmax(280px, 1fr))` cards, all buttons `min-height: 64px` (touch floor), `.school-item__choices` as a 2-column grid, `.school-item__chip` full-width, `.school-runner__unrecorded` a high-contrast warning bar, `.school-runner__grades` two half-width buttons (Missed left / Got it right). Keep it under ~150 lines; no animation (kiosk WebView frame budget).

Registry — add to `frontend/src/lib/appRegistry.js` after the `'gameshow'` entry:

```javascript
  'school':          { label: 'School',           icon: null,               param: null, component: () => import('../modules/School/SchoolApp.jsx') },
```

- [ ] **Step 4: Run the module tests + build**

```bash
npx vitest run frontend/src/modules/School/ 2>&1 | tail -5
cd frontend && npx vite build 2>&1 | tail -3 && cd ..
```
Expected: PASS; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/School frontend/src/lib/appRegistry.js
git commit -m "feat(school): SchoolApp shell, bank browser, styles, app registration"
```

---

### Task 13: Full test sweep, deploy, data seed, live verification

**Files:**
- No source changes (data-volume files only, via docker exec)

- [ ] **Step 1: Full gates**

```bash
npx vitest run tests/isolated/domain/school tests/isolated/adapter/school tests/isolated/application/school tests/isolated/api/school frontend/src/modules/School frontend/src/lib/identity frontend/src/modules/Piano frontend/src/Apps 2>&1 | tail -10
node scripts/gate-vitest.mjs 2>&1 | tail -5
```
Expected: all pass; gate reports no NEW failing files (cross-fork noise per memory is possible — verify any failure exists at the base commit before blaming this branch).

- [ ] **Step 2: Build the image**

```bash
sudo docker build -f docker/Dockerfile --no-cache -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" . 2>&1 | tail -5
```
(`--no-cache`: the layer cache has previously shipped a stale backend while the frontend rebuilt.)

- [ ] **Step 3: Deploy gates — HALT if active** (run each as its own step; do not chain with the deploy)

```bash
sudo docker logs --since 75s daylight-station 2>&1 | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```
Clear = zero render lines, no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`. If not clear, WAIT — do not proceed.

- [ ] **Step 4: Deploy**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 5: Seed a sample bank** (data volume, via docker exec — heredoc, never sed)

```bash
sudo docker exec daylight-station sh -c 'mkdir -p data/content/quizzes && cat > data/content/quizzes/us-state-capitals.yml << "EOF"
id: us-state-capitals
title: US State Capitals
audience: generic
topics: [geography, us-states]
items:
  - id: wa
    type: multiple_choice
    prompt: What is the capital of Washington?
    answer: Olympia
    choices: [Seattle, Olympia, Spokane, Tacoma]
  - id: or
    type: short_answer
    prompt: What is the capital of Oregon?
    answer: Salem
    accept: [salem]
  - id: id-cloze
    type: cloze
    prompt: "The capital of Idaho is ___."
    answer: Boise
  - id: pnw-pairs
    type: matching
    prompt: Match each state to its capital
    pairs:
      - { left: Washington, right: Olympia }
      - { left: Oregon, right: Salem }
      - { left: Idaho, right: Boise }
EOF'
```

- [ ] **Step 6: API verification against the deployed container**

```bash
curl -s http://localhost:3111/api/v1/school/roster | head -c 300; echo
curl -s http://localhost:3111/api/v1/school/banks | head -c 300; echo
SID=$(curl -s -X POST http://localhost:3111/api/v1/school/sessions -H 'Content-Type: application/json' -d '{"bankId":"us-state-capitals","mode":"quiz"}' | sed -E 's/.*"sessionId":"([^"]+)".*/\1/')
curl -s -X POST "http://localhost:3111/api/v1/school/sessions/$SID/answer" -H 'Content-Type: application/json' -d '{"itemId":"wa","given":"Olympia"}'; echo
```
Expected: roster lists household members; banks lists the seeded bank; the answer returns `{"correct":true,"expected":"Olympia","attemptId":null}` (guest session → null attemptId, nothing appended). Then confirm the guest gate: open a session with `"userId":"<a real roster id>"`, answer once, and verify a file appeared:

```bash
sudo docker exec daylight-station sh -c 'ls data/users/*/apps/school/attempts/ 2>/dev/null'
```

- [ ] **Step 7: Add School to the Portal menu** — read the current menu first, then rewrite whole-file (data volume; never sed):

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/lists/menus/portal.yml'
# rewrite the file with the existing items PLUS, at the position that fits the menu's ordering:
#   - title: School
#     input: app:school
```

- [ ] **Step 8: Reload the Portal kiosk** (FKB at 10.0.0.92 — same auth file as the living room, different host):

```bash
sudo docker exec daylight-station node -e "
const yaml = require('js-yaml');
const auth = yaml.load(require('fs').readFileSync('data/household/auth/fullykiosk.yml','utf8'));
const qs = new URLSearchParams({cmd:'loadStartURL',password:auth.password,type:'json'}).toString();
fetch('http://10.0.0.92:2323/?' + qs).then(r=>r.text()).then(console.log);
"
```

- [ ] **Step 9: Live screen verification** — headless Playwright against `https://daylightlocal.kckern.net/screen/portal`: navigate, tap the School menu item, assert the School header renders and the seeded bank card is visible, screenshot to the scratchpad. (Reuse the existing headless-screenshot harness pattern from memory; do not hijack the kiosk.)

- [ ] **Step 10: Commit anything outstanding + ledger**

```bash
git status --short   # expect clean (data-volume changes are not in git)
```
Append the task to `.superpowers/sdd/progress.md` per the SDD ledger convention.

---

## Self-review (performed at write time)

- **Spec coverage:** §3 file structure → Tasks 1–12 (every listed file has a task); §4 bank format + validation → Task 2; §4 attempt log → Tasks 3–4; §5 API incl. roster, ungated bank reads, mode-split answer, session TTL/410, results shape → Tasks 5–6; §6 identity behaviour (flat storage key, lapse, claim-on-tracked-work, guest filtering, lapse-abandons-session) → Tasks 8, 10–12; §7 grading rules → Task 3; §8 error table → Tasks 5, 6, 10 (unrecorded banner); §9 logging events → Tasks 7, 8, 10, 11; §10 testing incl. the extraction regression gate → Tasks 1–12; deploy + reload → Task 13.
- **Known deviations, recorded:** CSS class names kept (Global Constraints); `useIdleGap` keeps the two-signal signature rather than a redesign (mechanical move wins over neutral API — the spec's regression gate outranks its naming note).
- **Type consistency check:** `{ ok, status, data }` client shape used in Tasks 7/8/10/11/12; `{ correct, expected, attemptId }` quiz answer shape in Tasks 5/6/10; `selfGrade: 'correct'|'incorrect'` in Tasks 5/11; `ProfilePicker` props in Tasks 1/12 match the moved component's real props (`open`, `users`, `activeId`, `onPick`, `onDismiss`, `timeoutMs`).
- **Session-abandon test** (spec §10 “lapse while a runner is open discards the session”) is covered functionally in Task 10 (`identity changes mid-quiz → onExit`) driven by the context change that Task 8's lapse test proves.
