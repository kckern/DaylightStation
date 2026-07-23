# Interactive Geography Quizzes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the School quiz framework with two interactive item types (`region_click`, `asset_choice`), a server-side geography dataset + synth-on-read bank generator, and a graded-and-resurfacing `GeoQuizRunner`, proven with US state locations, US capitals, and world flags.

**Architecture:** New item types register into the existing `{item, onSubmit, verdict}` contract and grade by strict `===` server-side. Both are **asset-agnostic and instance-name-free**: `region_click` renders any registered clickable SVG *asset* (a US map is just one instance — an anatomy diagram or keyboard would be another) and `asset_choice` picks among any images. Geography banks are synthesized in `SchoolService` from a bundled dataset + deck recipes, addressed by colon-prefixed `geo:` ids, and kept out of the file-bank listing. A new `drill` session mode grades like `quiz` but records into its own reporting lane. The frontend adds a reusable `ClickableAsset`, a flag-asset resolver, a shared `useGradedSession` hook, `GeoQuizRunner`, and a `GeographyGrid` reached from an app tile on the "History & Geography" subject shelf.

**Tech Stack:** Node ESM backend (DDD layers `0_system`…`4_api`), React/JSX frontend, SCSS, vitest + @testing-library/react (happy-dom env `tests/_infrastructure/frontend-env.mjs`), lipis/flag-icons (MIT) flag SVGs, a public-domain US states SVG.

**Spec:** `docs/superpowers/specs/2026-07-23-interactive-geography-quizzes-design.md`

## Global Constraints

- **No hardcoded instance names.** The clickable interaction is a *clickable asset*, not a "map". Do NOT bake `map`/`us-states` into type names, component names, props, or fields. The type is `region_click`, the component is `ClickableAsset`, the item field is `asset` (an asset id supplied by data). A geography map is one instance; the code must read as reusable for any clickable SVG asset (anatomy diagram, keyboard, etc.).
- **Strict equality grading.** `region_click` and `asset_choice` grade with `given === item.answer` (values are machine ids), never the `norm()` path.
- **`givenShapeError` needs NO change** — both new types submit a non-empty string `given`, already covered by its default branch. Do not add branches to it.
- **Geography banks use `audience: 'generic'`** (not per-student assigned; also satisfies the guest guard).
- **Geography banks are addressed only by fixed `geo:{deckId}` id.** They are NEVER stamped with a `subject` and NEVER included in `warmBanks`/`listBanks` (that would shelve them into the Library and double the entry point).
- **`drill` attempts must never land in the `quiz` lane.** `getResults` dispatches lanes by explicit mode; `materialPolicy.quizSessionPassed` stays `mode==='quiz'` only (the R2.5 gate must not see drill).
- **The topic grid launches via `onLaunch(deckSummary, 'drill')`** (`SchoolApp.jsx:175`), which gates on `!currentUser && !isGuest` → pending-picker. Never open a geography session directly, or an *unclaimed* child (≠ guest) drills 50 items with `userId:null` and zero records.
- **`useGradedSession` is NEW code for `GeoQuizRunner` ONLY.** Do NOT migrate `QuizRunner`/`FlashcardRunner` in this plan.
- **Choice presentation-shuffle is stable per item render** (memoized on `item.id`) so the verdict re-render never reshuffles buttons under the child's finger.
- **No runtime external fetch.** All map/flag SVGs are committed to the repo. Flags are lipis/flag-icons (**MIT**); record the license in the asset folder.
- **Logging:** use the frontend logging framework (`frontend/src/lib/logging/Logger.js`) for new components, not raw `console.*`.
- **Test command:** `npx vitest run <path>` for both backend `.mjs` and frontend `.jsx` School tests.

---

## File Structure

**Backend**
- `backend/src/2_domains/school/geography/distractors.mjs` — pure seeded distractor sampler (mulberry32 + string hash).
- `backend/src/2_domains/school/geography/generateGeoBank.mjs` — pure `(recipe, entities) → raw bank`.
- `backend/src/2_domains/school/grading.mjs` *(modify)* — `region_click`, `asset_choice` grading branches.
- `backend/src/2_domains/school/questionBankValidation.mjs` *(modify)* — `ITEM_TYPES` + new-shape validation.
- `backend/src/3_applications/school/ports/IBankSource.mjs` — port doc (`resolve`, `listDeckSummaries`).
- `backend/src/3_applications/school/sources/GeographyBankSource.mjs` — loads dataset+recipes, memoized resolve.
- `backend/src/3_applications/school/sources/geography/us-states.yml` — 50 states dataset.
- `backend/src/3_applications/school/sources/geography/world.yml` — curated 50-country dataset.
- `backend/src/3_applications/school/sources/geography/decks.yml` — deck recipes.
- `backend/src/3_applications/school/SchoolService.mjs` *(modify)* — `bankSources` seam, `drill` mode, `listDeckSummaries`.
- `backend/src/4_api/v1/routers/school.mjs` *(modify)* — `GET /geography/decks`.
- `backend/src/app.mjs` *(modify)* — construct + inject `GeographyBankSource`.

**Frontend** (`frontend/src/modules/School/`)
- `quiz/clickable/ClickableAsset.jsx` + `quiz/clickable/assets/us-states.svg` — reusable clickable SVG asset renderer, `data-region-id` clicks (asset-agnostic; geography supplies `us-states` as one instance).
- `geography/flags.js` + `geography/flags/*.svg` — iso→lazy flag url resolver + assets.
- `quiz/items/RegionClickItem.jsx`, `quiz/items/AssetChoiceItem.jsx` — new item components.
- `geography/useGradedSession.js` — shared session plumbing (new; GeoQuizRunner only).
- `geography/GeoQuizRunner.jsx` — graded + resurfacing runner.
- `geography/GeographyGrid.jsx` — topic grid.
- `home/SubjectPage.jsx` *(modify)* — `SUBJECT_PROGRAMS.history` geography tile.
- `SchoolApp.jsx` *(modify)* — `geography` section wiring + `drill` runner mount.
- `schoolApi.js` *(modify)* — `geoDecks()`.
- `home/icons/svg/{geography,states,capitals,flags,countries}.svg` + `home/icons/MANIFEST.md` *(modify)* — placeholder icons.
- `School.scss` *(modify)* — clickable-asset, flag-grid, geography-grid styles.

**Docs**
- `docs/reference/school/README.md` *(modify)* — geography quiz framework section.

---

## Task 1: Grading + validation for `region_click` and `asset_choice`

**Files:**
- Modify: `backend/src/2_domains/school/grading.mjs`
- Modify: `backend/src/2_domains/school/questionBankValidation.mjs`
- Test: `backend/src/2_domains/school/grading.test.mjs` (create)
- Test: `backend/src/2_domains/school/questionBankValidation.test.mjs` (create)

**Interfaces:**
- Consumes: existing `gradeAnswer(item, given)`, `givenShapeError(item, given)`, `validateQuestionBank(raw)`.
- Produces: `gradeAnswer` handles `region_click` (`{correct: given===item.answer, expected: item.answer}`) and `asset_choice` (same). `validateQuestionBank` accepts the two new shapes. Item shapes:
  - `region_click`: `{ id, type:'region_click', prompt, asset, answer }` (all non-empty strings; `asset` is a clickable-asset id, `answer` a region id).
  - `asset_choice`: `{ id, type:'asset_choice', prompt, promptImage?, choices:[{value, label?, image?}], answer }`.

- [ ] **Step 1: Write the failing grading test**

Create `backend/src/2_domains/school/grading.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest';
import { gradeAnswer, givenShapeError } from './grading.mjs';

describe('gradeAnswer region_click', () => {
  const item = { id: 'g', type: 'region_click', prompt: 'Click Nevada', asset: 'us-states', answer: 'NV' };
  it('grades a correct region click', () => {
    expect(gradeAnswer(item, 'NV')).toEqual({ correct: true, expected: 'NV' });
  });
  it('grades a wrong region click and returns expected', () => {
    expect(gradeAnswer(item, 'CA')).toEqual({ correct: false, expected: 'NV' });
  });
  it('is strict — no normalization of ids', () => {
    expect(gradeAnswer(item, 'nv').correct).toBe(false);
  });
});

describe('gradeAnswer asset_choice', () => {
  const item = { id: 'f', type: 'asset_choice', prompt: 'Whose flag?', answer: 'FR',
    choices: [{ value: 'FR', label: 'France' }, { value: 'DE', label: 'Germany' }] };
  it('grades the chosen value', () => {
    expect(gradeAnswer(item, 'FR')).toEqual({ correct: true, expected: 'FR' });
    expect(gradeAnswer(item, 'DE')).toEqual({ correct: false, expected: 'FR' });
  });
});

describe('givenShapeError covers the new types via its default branch', () => {
  it('rejects empty given for region_click without a dedicated branch', () => {
    const item = { id: 'g', type: 'region_click', prompt: 'p', asset: 'us-states', answer: 'NV' };
    expect(givenShapeError(item, '')).toMatch(/non-empty string/);
    expect(givenShapeError(item, 'NV')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run backend/src/2_domains/school/grading.test.mjs`
Expected: FAIL — `gradeAnswer: unrecognised item.type "region_click"`.

- [ ] **Step 3: Add the grading branches**

In `backend/src/2_domains/school/grading.mjs`, add before the final `throw`:
```javascript
  if (item.type === 'region_click' || item.type === 'asset_choice') {
    // Values are machine-generated ids (region codes / choice values), never
    // free text — strict equality, no normalization (see multiple_choice).
    return { correct: given === item.answer, expected: item.answer };
  }
```
Do NOT touch `givenShapeError` — its default `typeof given !== 'string' || length===0` branch already covers both.

- [ ] **Step 4: Run the grading test to verify it passes**

Run: `npx vitest run backend/src/2_domains/school/grading.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write the failing validation test**

Create `backend/src/2_domains/school/questionBankValidation.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest';
import { validateQuestionBank } from './questionBankValidation.mjs';

const base = { id: 'b', title: 'T', audience: 'generic' };

describe('validateQuestionBank region_click', () => {
  it('accepts a valid region_click item', () => {
    const r = validateQuestionBank({ ...base, items: [
      { id: 'i1', type: 'region_click', prompt: 'Click Nevada', asset: 'us-states', answer: 'NV' }] });
    expect(r.ok).toBe(true);
  });
  it('rejects missing asset and empty answer', () => {
    const r = validateQuestionBank({ ...base, items: [
      { id: 'i1', type: 'region_click', prompt: 'p', answer: '' }] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/asset/);
    expect(r.errors.join(' ')).toMatch(/answer/);
  });
});

describe('validateQuestionBank asset_choice', () => {
  const good = { id: 'i1', type: 'asset_choice', prompt: 'Whose flag?', answer: 'FR',
    choices: [{ value: 'FR', label: 'France' }, { value: 'DE', image: { kind: 'flag', iso: 'DE' } }] };
  it('accepts label-or-image choices', () => {
    expect(validateQuestionBank({ ...base, items: [good] }).ok).toBe(true);
  });
  it('rejects a choice with neither label nor image', () => {
    const r = validateQuestionBank({ ...base, items: [{ ...good,
      choices: [{ value: 'FR' }, { value: 'DE', label: 'Germany' }] }] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/label.*image|image.*label/i);
  });
  it('rejects answer not among choice values and duplicate values', () => {
    expect(validateQuestionBank({ ...base, items: [{ ...good, answer: 'ZZ' }] }).ok).toBe(false);
    expect(validateQuestionBank({ ...base, items: [{ ...good,
      choices: [{ value: 'FR', label: 'a' }, { value: 'FR', label: 'b' }] }] }).ok).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run backend/src/2_domains/school/questionBankValidation.test.mjs`
Expected: FAIL — `unknown type "region_click"`.

- [ ] **Step 7: Add validation**

In `questionBankValidation.mjs`, extend `ITEM_TYPES`:
```javascript
const ITEM_TYPES = new Set(['multiple_choice', 'short_answer', 'cloze', 'matching', 'region_click', 'asset_choice']);
```
Add a helper near `isNonEmptyString`:
```javascript
const isImageSpec = (v) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.values(v).every((x) => isNonEmptyString(x));
```
Inside the `raw.items.forEach` loop, after the existing `matching` block, add:
```javascript
    if (item.type === 'region_click') {
      if (!isNonEmptyString(item.asset)) errors.push(`${at}: asset is required`);
      if (!isNonEmptyString(item.answer)) errors.push(`${at}: answer is required`);
    }
    if (item.type === 'asset_choice') {
      if (item.promptImage !== undefined && !isImageSpec(item.promptImage)) {
        errors.push(`${at}: promptImage must be a mapping of non-empty strings`);
      }
      if (!Array.isArray(item.choices) || item.choices.length < 2) {
        errors.push(`${at}: choices must have >= 2 entries`);
      } else {
        const values = item.choices.map((c) => c?.value);
        if (values.some((v) => !isNonEmptyString(v))) errors.push(`${at}: every choice needs a value`);
        if (new Set(values).size !== values.length) errors.push(`${at}: choice values must be unique`);
        item.choices.forEach((c, ci) => {
          const hasLabel = isNonEmptyString(c?.label);
          const hasImage = c?.image !== undefined && isImageSpec(c.image);
          if (!hasLabel && !hasImage) errors.push(`${at}.choices[${ci}]: needs a label or an image`);
          if (c?.label !== undefined && !hasLabel) errors.push(`${at}.choices[${ci}]: label must be a non-empty string`);
          if (c?.image !== undefined && !hasImage) errors.push(`${at}.choices[${ci}]: image must be a mapping of non-empty strings`);
        });
        if (!isNonEmptyString(item.answer)) errors.push(`${at}: answer is required`);
        else if (!values.includes(item.answer)) errors.push(`${at}: answer must appear in choice values`);
      }
    }
```
Also add the two new types to the passthrough `bank.items` — no change needed there (items are passed through whole). The `region_click`/`asset_choice` items also need the generic `prompt` check, which the existing `if (!isNonEmptyString(item.prompt))` already enforces.

- [ ] **Step 8: Run both tests to verify they pass**

Run: `npx vitest run backend/src/2_domains/school/grading.test.mjs backend/src/2_domains/school/questionBankValidation.test.mjs`
Expected: PASS.

- [ ] **Step 9: Commit**
```bash
git add backend/src/2_domains/school/grading.mjs backend/src/2_domains/school/questionBankValidation.mjs backend/src/2_domains/school/grading.test.mjs backend/src/2_domains/school/questionBankValidation.test.mjs
git commit -m "feat(school): grade + validate region_click and asset_choice item types"
```

---

## Task 2: Seeded distractor sampler

**Files:**
- Create: `backend/src/2_domains/school/geography/distractors.mjs`
- Test: `backend/src/2_domains/school/geography/distractors.test.mjs`

**Interfaces:**
- Produces: `sampleDistractors({ pool, exclude, count, seed }) → string[]` — returns up to `count` values from `pool`, all `!== exclude`, deterministic for a given `seed` string. Also exports `hashSeed(str) → uint32` and `mulberry32(uint32) → () => float`.

- [ ] **Step 1: Write the failing test**
```javascript
import { describe, it, expect } from 'vitest';
import { sampleDistractors, hashSeed, mulberry32 } from './distractors.mjs';

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(hashSeed('x')); const b = mulberry32(hashSeed('x'));
    expect(a()).toBe(b());
  });
});

describe('sampleDistractors', () => {
  const pool = ['A', 'B', 'C', 'D', 'E', 'F'];
  it('returns count values, none equal to exclude, all from pool', () => {
    const out = sampleDistractors({ pool, exclude: 'A', count: 3, seed: 'deck:A' });
    expect(out).toHaveLength(3);
    expect(out).not.toContain('A');
    out.forEach((v) => expect(pool).toContain(v));
    expect(new Set(out).size).toBe(3); // unique
  });
  it('is deterministic for a fixed seed', () => {
    const one = sampleDistractors({ pool, exclude: 'A', count: 3, seed: 'deck:A' });
    const two = sampleDistractors({ pool, exclude: 'A', count: 3, seed: 'deck:A' });
    expect(one).toEqual(two);
  });
  it('caps at available pool size when count exceeds it', () => {
    const out = sampleDistractors({ pool: ['A', 'B'], exclude: 'A', count: 5, seed: 's' });
    expect(out).toEqual(['B']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run backend/src/2_domains/school/geography/distractors.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

Create `backend/src/2_domains/school/geography/distractors.mjs`:
```javascript
/**
 * Deterministic distractor sampling for generated geography banks. No
 * Math.random: a fixed seed yields identical output every process, so the
 * generator is testable and a deck's wrong-answer set is stable. Choice
 * PRESENTATION order is shuffled client-side (not here) so a stable generated
 * order doesn't teach position.
 */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(a) {
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleDistractors({ pool, exclude, count, seed }) {
  const candidates = pool.filter((v) => v !== exclude);
  const rand = mulberry32(hashSeed(seed));
  // Fisher-Yates with the seeded PRNG, then take the first `count`.
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, Math.min(count, candidates.length));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run backend/src/2_domains/school/geography/distractors.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add backend/src/2_domains/school/geography/distractors.mjs backend/src/2_domains/school/geography/distractors.test.mjs
git commit -m "feat(school): deterministic seeded distractor sampler for geo banks"
```

---

## Task 3: Geography dataset, recipes, and bank generator

**Files:**
- Create: `backend/src/3_applications/school/sources/geography/us-states.yml`
- Create: `backend/src/3_applications/school/sources/geography/world.yml`
- Create: `backend/src/3_applications/school/sources/geography/decks.yml`
- Create: `backend/src/2_domains/school/geography/generateGeoBank.mjs`
- Test: `backend/src/2_domains/school/geography/generateGeoBank.test.mjs`

**Interfaces:**
- Consumes: `sampleDistractors` (Task 2), `validateQuestionBank` (Task 1).
- Produces: `generateGeoBank({ recipe, entities }) → rawBank` where `rawBank` is `{ id:'geo:{deckId}', title, audience:'generic', items:[…] }`. `recipe` fields: `{ deckId, title, itemType, prompt (template with {name}), answerField, distractorField?, asset?, promptImage?, choiceLabelField?, distractorCount? }`. `entities` is an array of `{ id, name, capital, region_id?, iso? }`.

- [ ] **Step 1: Write `us-states.yml`** (all 50 states)

Create `backend/src/3_applications/school/sources/geography/us-states.yml`:
```yaml
- { id: AL, name: Alabama, capital: Montgomery, region_id: AL }
- { id: AK, name: Alaska, capital: Juneau, region_id: AK }
- { id: AZ, name: Arizona, capital: Phoenix, region_id: AZ }
- { id: AR, name: Arkansas, capital: Little Rock, region_id: AR }
- { id: CA, name: California, capital: Sacramento, region_id: CA }
- { id: CO, name: Colorado, capital: Denver, region_id: CO }
- { id: CT, name: Connecticut, capital: Hartford, region_id: CT }
- { id: DE, name: Delaware, capital: Dover, region_id: DE }
- { id: FL, name: Florida, capital: Tallahassee, region_id: FL }
- { id: GA, name: Georgia, capital: Atlanta, region_id: GA }
- { id: HI, name: Hawaii, capital: Honolulu, region_id: HI }
- { id: ID, name: Idaho, capital: Boise, region_id: ID }
- { id: IL, name: Illinois, capital: Springfield, region_id: IL }
- { id: IN, name: Indiana, capital: Indianapolis, region_id: IN }
- { id: IA, name: Iowa, capital: Des Moines, region_id: IA }
- { id: KS, name: Kansas, capital: Topeka, region_id: KS }
- { id: KY, name: Kentucky, capital: Frankfort, region_id: KY }
- { id: LA, name: Louisiana, capital: Baton Rouge, region_id: LA }
- { id: ME, name: Maine, capital: Augusta, region_id: ME }
- { id: MD, name: Maryland, capital: Annapolis, region_id: MD }
- { id: MA, name: Massachusetts, capital: Boston, region_id: MA }
- { id: MI, name: Michigan, capital: Lansing, region_id: MI }
- { id: MN, name: Minnesota, capital: Saint Paul, region_id: MN }
- { id: MS, name: Mississippi, capital: Jackson, region_id: MS }
- { id: MO, name: Missouri, capital: Jefferson City, region_id: MO }
- { id: MT, name: Montana, capital: Helena, region_id: MT }
- { id: NE, name: Nebraska, capital: Lincoln, region_id: NE }
- { id: NV, name: Nevada, capital: Carson City, region_id: NV }
- { id: NH, name: New Hampshire, capital: Concord, region_id: NH }
- { id: NJ, name: New Jersey, capital: Trenton, region_id: NJ }
- { id: NM, name: New Mexico, capital: Santa Fe, region_id: NM }
- { id: NY, name: New York, capital: Albany, region_id: NY }
- { id: NC, name: North Carolina, capital: Raleigh, region_id: NC }
- { id: ND, name: North Dakota, capital: Bismarck, region_id: ND }
- { id: OH, name: Ohio, capital: Columbus, region_id: OH }
- { id: OK, name: Oklahoma, capital: Oklahoma City, region_id: OK }
- { id: OR, name: Oregon, capital: Salem, region_id: OR }
- { id: PA, name: Pennsylvania, capital: Harrisburg, region_id: PA }
- { id: RI, name: Rhode Island, capital: Providence, region_id: RI }
- { id: SC, name: South Carolina, capital: Columbia, region_id: SC }
- { id: SD, name: South Dakota, capital: Pierre, region_id: SD }
- { id: TN, name: Tennessee, capital: Nashville, region_id: TN }
- { id: TX, name: Texas, capital: Austin, region_id: TX }
- { id: UT, name: Utah, capital: Salt Lake City, region_id: UT }
- { id: VT, name: Vermont, capital: Montpelier, region_id: VT }
- { id: VA, name: Virginia, capital: Richmond, region_id: VA }
- { id: WA, name: Washington, capital: Olympia, region_id: WA }
- { id: WV, name: West Virginia, capital: Charleston, region_id: WV }
- { id: WI, name: Wisconsin, capital: Madison, region_id: WI }
- { id: WY, name: Wyoming, capital: Cheyenne, region_id: WY }
```

- [ ] **Step 2: Write `world.yml`** (curated 50)

Create `backend/src/3_applications/school/sources/geography/world.yml`:
```yaml
- { id: US, name: United States, capital: Washington, iso: US }
- { id: CA, name: Canada, capital: Ottawa, iso: CA }
- { id: MX, name: Mexico, capital: Mexico City, iso: MX }
- { id: BR, name: Brazil, capital: Brasília, iso: BR }
- { id: AR, name: Argentina, capital: Buenos Aires, iso: AR }
- { id: CL, name: Chile, capital: Santiago, iso: CL }
- { id: CO, name: Colombia, capital: Bogotá, iso: CO }
- { id: PE, name: Peru, capital: Lima, iso: PE }
- { id: CU, name: Cuba, capital: Havana, iso: CU }
- { id: GB, name: United Kingdom, capital: London, iso: GB }
- { id: IE, name: Ireland, capital: Dublin, iso: IE }
- { id: FR, name: France, capital: Paris, iso: FR }
- { id: DE, name: Germany, capital: Berlin, iso: DE }
- { id: IT, name: Italy, capital: Rome, iso: IT }
- { id: ES, name: Spain, capital: Madrid, iso: ES }
- { id: PT, name: Portugal, capital: Lisbon, iso: PT }
- { id: NL, name: Netherlands, capital: Amsterdam, iso: NL }
- { id: BE, name: Belgium, capital: Brussels, iso: BE }
- { id: CH, name: Switzerland, capital: Bern, iso: CH }
- { id: AT, name: Austria, capital: Vienna, iso: AT }
- { id: SE, name: Sweden, capital: Stockholm, iso: SE }
- { id: NO, name: Norway, capital: Oslo, iso: NO }
- { id: DK, name: Denmark, capital: Copenhagen, iso: DK }
- { id: FI, name: Finland, capital: Helsinki, iso: FI }
- { id: PL, name: Poland, capital: Warsaw, iso: PL }
- { id: GR, name: Greece, capital: Athens, iso: GR }
- { id: RU, name: Russia, capital: Moscow, iso: RU }
- { id: UA, name: Ukraine, capital: Kyiv, iso: UA }
- { id: TR, name: Turkey, capital: Ankara, iso: TR }
- { id: EG, name: Egypt, capital: Cairo, iso: EG }
- { id: MA, name: Morocco, capital: Rabat, iso: MA }
- { id: ZA, name: South Africa, capital: Pretoria, iso: ZA }
- { id: NG, name: Nigeria, capital: Abuja, iso: NG }
- { id: KE, name: Kenya, capital: Nairobi, iso: KE }
- { id: CN, name: China, capital: Beijing, iso: CN }
- { id: JP, name: Japan, capital: Tokyo, iso: JP }
- { id: KR, name: South Korea, capital: Seoul, iso: KR }
- { id: IN, name: India, capital: New Delhi, iso: IN }
- { id: TH, name: Thailand, capital: Bangkok, iso: TH }
- { id: VN, name: Vietnam, capital: Hanoi, iso: VN }
- { id: ID, name: Indonesia, capital: Jakarta, iso: ID }
- { id: PH, name: Philippines, capital: Manila, iso: PH }
- { id: SA, name: Saudi Arabia, capital: Riyadh, iso: SA }
- { id: AE, name: United Arab Emirates, capital: Abu Dhabi, iso: AE }
- { id: IL, name: Israel, capital: Jerusalem, iso: IL }
- { id: IR, name: Iran, capital: Tehran, iso: IR }
- { id: PK, name: Pakistan, capital: Islamabad, iso: PK }
- { id: BD, name: Bangladesh, capital: Dhaka, iso: BD }
- { id: AU, name: Australia, capital: Canberra, iso: AU }
- { id: NZ, name: New Zealand, capital: Wellington, iso: NZ }
```

- [ ] **Step 3: Write `decks.yml`**

Create `backend/src/3_applications/school/sources/geography/decks.yml`:
```yaml
- deckId: us-state-locations
  title: US State Locations
  entities: us-states
  itemType: region_click
  asset: us-states
  prompt: "Click {name}"
  answerField: region_id
  available: true
- deckId: us-state-capitals
  title: US State Capitals
  entities: us-states
  itemType: multiple_choice
  prompt: "What is the capital of {name}?"
  answerField: capital
  distractorField: capital
  distractorCount: 3
  available: true
- deckId: world-flags
  title: World Flags
  entities: world
  itemType: asset_choice
  prompt: "Whose flag is this?"
  promptImage: { kind: flag, isoField: iso }
  answerField: id
  choiceLabelField: name
  distractorField: id
  distractorCount: 3
  available: true
- deckId: country-locations
  title: Country Locations
  entities: world
  itemType: region_click
  asset: world
  prompt: "Click {name}"
  answerField: id
  available: false
- deckId: world-capitals
  title: World Capitals
  entities: world
  itemType: multiple_choice
  prompt: "What is the capital of {name}?"
  answerField: capital
  distractorField: capital
  distractorCount: 3
  available: false
```

- [ ] **Step 4: Write the failing generator test**

Create `backend/src/2_domains/school/geography/generateGeoBank.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest';
import { generateGeoBank } from './generateGeoBank.mjs';
import { validateQuestionBank } from '../questionBankValidation.mjs';

const states = [
  { id: 'NV', name: 'Nevada', capital: 'Carson City', region_id: 'NV' },
  { id: 'CA', name: 'California', capital: 'Sacramento', region_id: 'CA' },
  { id: 'OR', name: 'Oregon', capital: 'Salem', region_id: 'OR' },
  { id: 'WA', name: 'Washington', capital: 'Olympia', region_id: 'WA' },
];
const world = [
  { id: 'FR', name: 'France', capital: 'Paris', iso: 'FR' },
  { id: 'DE', name: 'Germany', capital: 'Berlin', iso: 'DE' },
  { id: 'IT', name: 'Italy', capital: 'Rome', iso: 'IT' },
  { id: 'ES', name: 'Spain', capital: 'Madrid', iso: 'ES' },
];

it('region_click deck: one item per entity, stable ids, valid bank', () => {
  const recipe = { deckId: 'us-state-locations', title: 'Loc', itemType: 'region_click',
    asset: 'us-states', prompt: 'Click {name}', answerField: 'region_id', available: true };
  const bank = generateGeoBank({ recipe, entities: states });
  expect(bank.id).toBe('geo:us-state-locations');
  expect(bank.audience).toBe('generic');
  expect(bank.items).toHaveLength(4);
  expect(bank.items[0]).toMatchObject({ id: 'geo:us-state-locations:NV', type: 'region_click',
    prompt: 'Click Nevada', asset: 'us-states', answer: 'NV' });
  expect(validateQuestionBank(bank).ok).toBe(true);
});

it('multiple_choice deck: answer present in choices, distractors from pool', () => {
  const recipe = { deckId: 'us-state-capitals', title: 'Cap', itemType: 'multiple_choice',
    prompt: 'Capital of {name}?', answerField: 'capital', distractorField: 'capital',
    distractorCount: 3, available: true };
  const bank = generateGeoBank({ recipe, entities: states });
  const nv = bank.items.find((i) => i.id === 'geo:us-state-capitals:NV');
  expect(nv.choices).toContain('Carson City');
  expect(nv.answer).toBe('Carson City');
  expect(nv.choices).toHaveLength(4);
  expect(validateQuestionBank(bank).ok).toBe(true);
});

it('asset_choice deck: image prompt + labeled choices, valid', () => {
  const recipe = { deckId: 'world-flags', title: 'Flags', itemType: 'asset_choice',
    prompt: 'Whose flag?', promptImage: { kind: 'flag', isoField: 'iso' },
    answerField: 'id', choiceLabelField: 'name', distractorField: 'id',
    distractorCount: 3, available: true };
  const bank = generateGeoBank({ recipe, entities: world });
  const fr = bank.items.find((i) => i.id === 'geo:world-flags:FR');
  expect(fr.promptImage).toEqual({ kind: 'flag', iso: 'FR' });
  expect(fr.answer).toBe('FR');
  expect(fr.choices).toHaveLength(4);
  expect(fr.choices.find((c) => c.value === 'FR').label).toBe('France');
  expect(validateQuestionBank(bank).ok).toBe(true);
});

it('is deterministic across runs', () => {
  const recipe = { deckId: 'us-state-capitals', title: 'Cap', itemType: 'multiple_choice',
    prompt: 'Capital of {name}?', answerField: 'capital', distractorField: 'capital',
    distractorCount: 3, available: true };
  const a = generateGeoBank({ recipe, entities: states });
  const b = generateGeoBank({ recipe, entities: states });
  expect(a).toEqual(b);
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npx vitest run backend/src/2_domains/school/geography/generateGeoBank.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 6: Implement the generator**

Create `backend/src/2_domains/school/geography/generateGeoBank.mjs`:
```javascript
/**
 * Pure synthesis of a question bank from a deck recipe + an entity list.
 * One item per entity; stable ids `geo:{deckId}:{entityId}`; distractors
 * sampled deterministically (see distractors.mjs). No I/O.
 */
import { sampleDistractors } from './distractors.mjs';

const fill = (template, entity) => template.replace(/\{(\w+)\}/g, (_, k) => entity[k]);

export function generateGeoBank({ recipe, entities }) {
  const items = entities.map((e) => {
    const id = `geo:${recipe.deckId}:${e.id}`;
    const prompt = fill(recipe.prompt, e);
    const answer = String(e[recipe.answerField]);

    if (recipe.itemType === 'region_click') {
      return { id, type: 'region_click', prompt, asset: recipe.asset, answer };
    }

    const count = recipe.distractorCount ?? 3;
    const pool = entities.map((x) => String(x[recipe.distractorField]));
    const distractors = sampleDistractors({ pool, exclude: answer, count, seed: id });
    const values = [answer, ...distractors];

    if (recipe.itemType === 'multiple_choice') {
      return { id, type: 'multiple_choice', prompt, choices: values, answer };
    }
    if (recipe.itemType === 'asset_choice') {
      const labelOf = (val) => {
        const ent = entities.find((x) => String(x[recipe.answerField]) === val);
        return recipe.choiceLabelField ? String(ent[recipe.choiceLabelField]) : val;
      };
      const item = { id, type: 'asset_choice', prompt,
        choices: values.map((v) => ({ value: v, label: labelOf(v) })), answer };
      if (recipe.promptImage) {
        item.promptImage = { kind: recipe.promptImage.kind, iso: String(e[recipe.promptImage.isoField]) };
      }
      return item;
    }
    throw new Error(`generateGeoBank: unknown itemType "${recipe.itemType}"`);
  });

  return { id: `geo:${recipe.deckId}`, title: recipe.title, audience: 'generic', items };
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run backend/src/2_domains/school/geography/generateGeoBank.test.mjs`
Expected: PASS.

- [ ] **Step 8: Commit**
```bash
git add backend/src/3_applications/school/sources/geography/ backend/src/2_domains/school/geography/generateGeoBank.mjs backend/src/2_domains/school/geography/generateGeoBank.test.mjs
git commit -m "feat(school): geography dataset, deck recipes, and pure bank generator"
```

---

## Task 4: GeographyBankSource + IBankSource port

**Files:**
- Create: `backend/src/3_applications/school/ports/IBankSource.mjs`
- Create: `backend/src/3_applications/school/sources/GeographyBankSource.mjs`
- Test: `backend/src/3_applications/school/sources/GeographyBankSource.test.mjs`

**Interfaces:**
- Consumes: `generateGeoBank` (Task 3), the three YAML files (Task 3).
- Produces: `new GeographyBankSource({ dataDir? })` with:
  - `resolve(bankId) → rawBank | null` — `null` for a non-`geo:` id, an unknown deck, or an **unavailable** deck. Memoized per deck.
  - `listDeckSummaries() → [{ deckId, bankId, title, itemType, available }]`.

- [ ] **Step 1: Write the port doc**

Create `backend/src/3_applications/school/ports/IBankSource.mjs`:
```javascript
/**
 * A bank source synthesizes question banks that are NOT files on disk.
 * SchoolService consults injected sources before the datastore, so a source
 * can serve colon-prefixed virtual ids (e.g. `geo:us-state-capitals`) that the
 * file datastore's id regex rejects.
 *
 * Implementations provide:
 *   resolve(bankId): rawBank | null        // null => not mine / unopenable
 *   listDeckSummaries(): Array<{ deckId, bankId, title, itemType, available }>
 */
export const IBankSource = Symbol('IBankSource');
```

- [ ] **Step 2: Write the failing test**

Create `backend/src/3_applications/school/sources/GeographyBankSource.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest';
import { GeographyBankSource } from './GeographyBankSource.mjs';
import { validateQuestionBank } from '#domains/school/index.mjs';

const src = new GeographyBankSource();

it('resolves an available deck to a valid bank', () => {
  const bank = src.resolve('geo:us-state-capitals');
  expect(bank).toBeTruthy();
  expect(bank.items.length).toBe(50);
  expect(validateQuestionBank(bank).ok).toBe(true);
});

it('resolves us-state-locations and world-flags to valid banks', () => {
  expect(validateQuestionBank(src.resolve('geo:us-state-locations')).ok).toBe(true);
  const flags = src.resolve('geo:world-flags');
  expect(flags.items.length).toBe(50);
  expect(validateQuestionBank(flags).ok).toBe(true);
});

it('returns null for non-geo ids, unknown decks, and unavailable decks', () => {
  expect(src.resolve('some-file-bank')).toBeNull();
  expect(src.resolve('geo:nope')).toBeNull();
  expect(src.resolve('geo:country-locations')).toBeNull(); // available: false
});

it('lists deck summaries including unavailable ones', () => {
  const decks = src.listDeckSummaries();
  const ids = decks.map((d) => d.deckId);
  expect(ids).toContain('us-state-locations');
  expect(ids).toContain('country-locations');
  const cl = decks.find((d) => d.deckId === 'country-locations');
  expect(cl).toMatchObject({ bankId: 'geo:country-locations', available: false });
});

it('memoizes resolve (same object across calls)', () => {
  expect(src.resolve('geo:world-flags')).toBe(src.resolve('geo:world-flags'));
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run backend/src/3_applications/school/sources/GeographyBankSource.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 4: Implement**

Create `backend/src/3_applications/school/sources/GeographyBankSource.mjs`:
```javascript
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { generateGeoBank } from '#domains/school/geography/generateGeoBank.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export class GeographyBankSource {
  #dir; #recipes; #entities = {}; #cache = new Map();

  constructor({ dataDir } = {}) {
    this.#dir = dataDir || path.join(HERE, 'geography');
    this.#recipes = this.#load('decks.yml');
    this.#entities['us-states'] = this.#load('us-states.yml');
    this.#entities.world = this.#load('world.yml');
  }

  #load(file) {
    return yaml.load(fs.readFileSync(path.join(this.#dir, file), 'utf8'));
  }

  #recipeFor(bankId) {
    if (typeof bankId !== 'string' || !bankId.startsWith('geo:')) return null;
    const deckId = bankId.slice('geo:'.length);
    return this.#recipes.find((r) => r.deckId === deckId) || null;
  }

  resolve(bankId) {
    const recipe = this.#recipeFor(bankId);
    if (!recipe || !recipe.available) return null;
    if (this.#cache.has(bankId)) return this.#cache.get(bankId);
    const bank = generateGeoBank({ recipe, entities: this.#entities[recipe.entities] });
    this.#cache.set(bankId, bank);
    return bank;
  }

  listDeckSummaries() {
    return this.#recipes.map((r) => ({
      deckId: r.deckId,
      bankId: `geo:${r.deckId}`,
      title: r.title,
      itemType: r.itemType,
      available: !!r.available,
    }));
  }
}

export default GeographyBankSource;
```

Note: this requires the `#domains/school/geography/generateGeoBank.mjs` import alias to resolve — confirm `#domains` maps to `backend/src/2_domains` in `package.json` `imports` (it is already used by `SchoolService`). If `#domains/school/index.mjs` does not re-export geography, import via the full subpath as shown (a direct file import, not the barrel).

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run backend/src/3_applications/school/sources/GeographyBankSource.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add backend/src/3_applications/school/ports/IBankSource.mjs backend/src/3_applications/school/sources/GeographyBankSource.mjs backend/src/3_applications/school/sources/GeographyBankSource.test.mjs
git commit -m "feat(school): GeographyBankSource (synth-on-read) + IBankSource port"
```

---

## Task 5: SchoolService bank-source seam + listDeckSummaries

**Files:**
- Modify: `backend/src/3_applications/school/SchoolService.mjs`
- Test: `backend/src/3_applications/school/SchoolService.geo.test.mjs` (create)

**Interfaces:**
- Consumes: `GeographyBankSource` shape `{ resolve, listDeckSummaries }` (Task 4).
- Produces: `new SchoolService({ datastore, userService, logger, now, bankSources })`; `#loadBank` tries `bankSources` before the datastore; `service.listDeckSummaries()` aggregates over sources; `openSession`/`getBank` work for `geo:` ids; `listBanks` still excludes geo.

- [ ] **Step 1: Write the failing test**

Create `backend/src/3_applications/school/SchoolService.geo.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest';
import { SchoolService } from './SchoolService.mjs';
import { GeographyBankSource } from './sources/GeographyBankSource.mjs';

const stubDs = {
  readBankRaw: () => null,           // no file banks in this test
  readAllBankRaws: async () => [],
  readAllAttempts: () => [],
  appendAttempt: () => ({ ok: true }),
  readQuizRequests: () => [],
};
const stubUsers = { getProfile: () => ({ id: 'u1' }), getHouseholdRoster: () => [{ id: 'u1' }] };

function service() {
  return new SchoolService({ datastore: stubDs, userService: stubUsers,
    logger: { info() {}, warn() {}, error() {} }, now: () => 1000,
    bankSources: [new GeographyBankSource()] });
}

it('getBank resolves a geo: id via the source (datastore never opens it)', () => {
  const bank = service().getBank('geo:us-state-capitals');
  expect(bank.id).toBe('geo:us-state-capitals');
  expect(bank.items.length).toBe(50);
});

it('openSession opens a generic geo bank for a guest (userId null)', () => {
  const { sessionId } = service().openSession({ userId: null, bankId: 'geo:world-flags', mode: 'quiz' });
  expect(sessionId).toMatch(/^ses_/);
});

it('unknown geo id 404s (falls through, source returns null)', () => {
  expect(() => service().getBank('geo:nope')).toThrow();
});

it('listDeckSummaries aggregates the source', () => {
  const decks = service().listDeckSummaries();
  expect(decks.map((d) => d.deckId)).toContain('world-flags');
});

it('listBanks does NOT include geo banks', async () => {
  const svc = service();
  await svc.warmBanks({ force: true });
  expect(svc.listBanks().some((b) => String(b.id).startsWith('geo:'))).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run backend/src/3_applications/school/SchoolService.geo.test.mjs`
Expected: FAIL — `bankSources`/`listDeckSummaries` undefined, geo id 404s in getBank.

- [ ] **Step 3: Add the seam**

In `SchoolService.mjs`, add a private field and wire the constructor:
```javascript
  #ds; #userService; #logger; #now; #bankSources;
```
```javascript
  constructor({ datastore, userService, logger = console, now = () => Date.now(), bankSources = [] }) {
    this.#ds = datastore;
    this.#userService = userService;
    this.#logger = logger;
    this.#now = now;
    this.#bankSources = bankSources;
  }
```
Rewrite `#loadBank` to try sources first:
```javascript
  #loadBank(bankId) {
    for (const source of this.#bankSources) {
      const synth = source.resolve(bankId);
      if (synth) {
        const r = validateQuestionBank(synth);
        if (!r.ok) {
          this.#logger.warn?.('school.bank.invalid', { bankId, synthesized: true, reason: r.errors.join('; ') });
          return null;
        }
        return r.bank;
      }
    }
    const raw = this.#ds.readBankRaw(bankId);
    if (!raw) return null;
    const r = validateQuestionBank(raw);
    if (!r.ok) {
      this.#logger.warn?.('school.bank.invalid', { file: `${bankId}.yml`, reason: r.errors.join('; ') });
      return null;
    }
    return r.bank;
  }
```
Add a method near `listBanks`:
```javascript
  /** Virtual decks from injected bank sources (e.g. geography topic grid). */
  listDeckSummaries() {
    return this.#bankSources.flatMap((s) => s.listDeckSummaries());
  }
```
Leave `warmBanks`/`listBanks` untouched — they read only `#ds.readAllBankRaws()`, so geo banks never enter the file listing.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run backend/src/3_applications/school/SchoolService.geo.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the existing school suite to confirm no regressions**

Run: `npx vitest run backend/src/2_domains/school backend/src/3_applications/school`
Expected: PASS (all existing + new).

- [ ] **Step 6: Commit**
```bash
git add backend/src/3_applications/school/SchoolService.mjs backend/src/3_applications/school/SchoolService.geo.test.mjs
git commit -m "feat(school): SchoolService bank-source seam (geo: ids) + listDeckSummaries"
```

---

## Task 6: SchoolService `drill` mode + dedicated reporting lane

**Files:**
- Modify: `backend/src/3_applications/school/SchoolService.mjs`
- Test: `backend/src/3_applications/school/SchoolService.drill.test.mjs` (create)

**Interfaces:**
- Consumes: the seam from Task 5.
- Produces: `MODES` includes `'drill'`; `answer()` grades + returns `{correct, expected, attemptId}` for `drill`; `getResults` bins drill into a `drill` lane (present on empty-default too); `summarize` counts a `drilled` metric from drill attempts; `quizSessionPassed` untouched.

- [ ] **Step 1: Write the failing test**

Create `backend/src/3_applications/school/SchoolService.drill.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest';
import { SchoolService } from './SchoolService.mjs';
import { GeographyBankSource } from './sources/GeographyBankSource.mjs';

function harness() {
  const attempts = [];
  const ds = {
    readBankRaw: () => null,
    readAllBankRaws: async () => [],
    readAllAttempts: () => attempts,
    appendAttempt: (uid, a) => { attempts.push(a); return { ok: true }; },
    readQuizRequests: () => [],
  };
  const users = { getProfile: () => ({ id: 'u1' }), getHouseholdRoster: () => [{ id: 'u1' }] };
  const svc = new SchoolService({ datastore: ds, userService: users,
    logger: { info() {}, warn() {}, error() {} }, now: () => 1000,
    bankSources: [new GeographyBankSource()] });
  return { svc, attempts };
}

it('accepts drill mode and grades like quiz (returns correct + expected)', () => {
  const { svc } = harness();
  const { sessionId } = svc.openSession({ userId: 'u1', bankId: 'geo:us-state-locations', mode: 'drill' });
  const item = svc.getBank('geo:us-state-locations').items[0];
  const res = svc.answer({ sessionId, itemId: item.id, given: item.answer });
  expect(res.correct).toBe(true);
  expect(res.expected).toBe(item.answer);
});

it('records drill attempts into the drill lane, NOT quiz', () => {
  const { svc } = harness();
  const { sessionId } = svc.openSession({ userId: 'u1', bankId: 'geo:us-state-locations', mode: 'drill' });
  const item = svc.getBank('geo:us-state-locations').items[0];
  svc.answer({ sessionId, itemId: item.id, given: 'ZZ' }); // wrong
  const res = svc.getResults('u1', { bankId: 'geo:us-state-locations' });
  expect(res.drill.attempts).toBe(1);
  expect(res.quiz.attempts).toBe(0);
});

it('empty-default result object carries a drill lane', () => {
  const { svc } = harness();
  const res = svc.getResults('u1', { bankId: 'geo:never-touched' });
  expect(res.drill).toEqual({ attempts: 0, correct: 0, lastAt: null });
});

it('rejects an unknown mode', () => {
  const { svc } = harness();
  expect(() => svc.openSession({ userId: 'u1', bankId: 'geo:world-flags', mode: 'bogus' })).toThrow(/quiz\|flashcard\|drill/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run backend/src/3_applications/school/SchoolService.drill.test.mjs`
Expected: FAIL — mode rejected / no drill lane.

- [ ] **Step 3: Add drill across every surface**

In `SchoolService.mjs`:

`MODES` + error string:
```javascript
const MODES = new Set(['quiz', 'flashcard', 'drill']);
```
```javascript
    if (!MODES.has(mode)) throw new ValidationError(`mode must be quiz|flashcard|drill, got: ${mode}`);
```
`answer()` grade branch — change `if (s.mode === 'quiz')` to:
```javascript
    if (s.mode === 'quiz' || s.mode === 'drill') {
```
`answer()` return branch:
```javascript
    return (s.mode === 'quiz' || s.mode === 'drill') ? { correct, expected, attemptId } : { attemptId };
```
`getResults` — the `byBank` seed AND the empty-default both gain a `drill` lane, and lane dispatch becomes explicit by mode:
```javascript
      if (!byBank.has(a.bankId)) {
        byBank.set(a.bankId, { bankId: a.bankId,
          quiz: { attempts: 0, correct: 0, lastAt: null },
          flashcard: { attempts: 0, correct: 0, lastAt: null },
          drill: { attempts: 0, correct: 0, lastAt: null }, items: {} });
      }
      const b = byBank.get(a.bankId);
      const lane = a.mode === 'flashcard' ? b.flashcard : a.mode === 'drill' ? b.drill : b.quiz;
```
The empty-default return:
```javascript
    if (bankId) {
      return byBank.get(bankId) || { bankId,
        quiz: { attempts: 0, correct: 0, lastAt: null },
        flashcard: { attempts: 0, correct: 0, lastAt: null },
        drill: { attempts: 0, correct: 0, lastAt: null }, items: {} };
    }
```
Keep the `if (a.mode === 'quiz')` items block EXACTLY as-is (drill must not feed the R2.5 item gate).

`summarize` — add a drill filter + metric:
```javascript
    const graded = attempts.filter((a) => a.mode === 'quiz');
    const drilledCards = attempts.filter((a) => a.mode === 'flashcard');
    const drilledGeo = attempts.filter((a) => a.mode === 'drill');
```
and after the existing `drilled.length` push (rename its variable to `drilledCards`), add:
```javascript
    if (drilledGeo.length) {
      metrics.push({ id: 'drilled-geo', kind: 'count', label: 'Geography drilled', value: drilledGeo.length, unit: 'questions' });
    }
```
(Update the existing `drilled` references to `drilledCards`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run backend/src/3_applications/school/SchoolService.drill.test.mjs`
Expected: PASS.

- [ ] **Step 5: Confirm the quiz gate is unaffected**

Run: `npx vitest run backend/src/2_domains/school backend/src/3_applications/school`
Expected: PASS — no existing quiz/flashcard/reporting test regresses.

- [ ] **Step 6: Commit**
```bash
git add backend/src/3_applications/school/SchoolService.mjs backend/src/3_applications/school/SchoolService.drill.test.mjs
git commit -m "feat(school): drill session mode with a dedicated reporting lane"
```

---

## Task 7: Wire GeographyBankSource + `GET /geography/decks` + schoolApi

**Files:**
- Modify: `backend/src/app.mjs:1997`
- Modify: `backend/src/4_api/v1/routers/school.mjs`
- Modify: `frontend/src/modules/School/schoolApi.js`
- Test: `backend/src/4_api/v1/routers/school.geo.test.mjs` (create)

**Interfaces:**
- Consumes: `SchoolService.listDeckSummaries()` (Task 5), `GeographyBankSource` (Task 4).
- Produces: `GET /api/v1/school/geography/decks → { decks: [...] }`; `schoolApi.geoDecks()`.

- [ ] **Step 1: Write the failing router test**

Create `backend/src/4_api/v1/routers/school.geo.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest';
import express from 'express';
import { createSchoolRouter } from './school.mjs';

function appWith(schoolService) {
  const app = express();
  app.use('/api/v1/school', createSchoolRouter({ schoolService, logger: { error() {} } }));
  return app;
}

it('GET /geography/decks returns the deck summaries', async () => {
  const schoolService = { listDeckSummaries: () => [
    { deckId: 'world-flags', bankId: 'geo:world-flags', title: 'World Flags', itemType: 'asset_choice', available: true }] };
  const app = appWith(schoolService);
  const { default: request } = await import('supertest');
  const res = await request(app).get('/api/v1/school/geography/decks');
  expect(res.status).toBe(200);
  expect(res.body.decks[0].deckId).toBe('world-flags');
});
```
(If `supertest` is unavailable, assert by calling the router handler directly with mock `req`/`res` objects — check `package.json` devDependencies first; `supertest` is used elsewhere in `backend/**/*.test.mjs`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run backend/src/4_api/v1/routers/school.geo.test.mjs`
Expected: FAIL — 404 (route absent).

- [ ] **Step 3: Add the route**

In `school.mjs`, after the `/banks` routes, add:
```javascript
  router.get('/geography/decks', wrap((req, res) => {
    res.json({ decks: schoolService.listDeckSummaries() });
  }));
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run backend/src/4_api/v1/routers/school.geo.test.mjs`
Expected: PASS.

- [ ] **Step 5: Wire the source into app.mjs**

In `backend/src/app.mjs` at the `new SchoolService({...})` call (~line 1997), import and inject (the `3_applications` alias is **`#apps/*`**, verified in `package.json` `imports`):
```javascript
import { GeographyBankSource } from '#apps/school/sources/GeographyBankSource.mjs';
```
(add near the other school imports.)
```javascript
  const schoolService = new SchoolService({
    datastore: schoolDatastore,
    userService,
    logger: rootLogger.child({ module: 'school' }),
    bankSources: [new GeographyBankSource()],
  });
```

- [ ] **Step 6: Add the frontend API method**

In `frontend/src/modules/School/schoolApi.js`, add to the `schoolApi` object:
```javascript
  geoDecks: () => req('/geography/decks'),
```

- [ ] **Step 7: Smoke-test the wired endpoint against a running dev/prod server**

Run: `curl -s http://localhost:3111/api/v1/school/geography/decks | head -c 400`
Expected: JSON `{"decks":[{"deckId":"us-state-locations",...},...]}` including all five decks (three available, two not).

- [ ] **Step 8: Commit**
```bash
git add backend/src/app.mjs backend/src/4_api/v1/routers/school.mjs backend/src/4_api/v1/routers/school.geo.test.mjs frontend/src/modules/School/schoolApi.js
git commit -m "feat(school): wire GeographyBankSource + GET /geography/decks + schoolApi.geoDecks"
```

---

## Task 8: ClickableAsset (reusable) + one clickable-asset instance (US states SVG)

**Files:**
- Create: `frontend/src/modules/School/quiz/clickable/assets/us-states.svg`
- Create: `frontend/src/modules/School/quiz/clickable/assets/README.md` (source + license, per asset)
- Create: `frontend/src/modules/School/quiz/clickable/prepare-us-states.mjs` (one-time prep script for this instance)
- Create: `frontend/src/modules/School/quiz/clickable/ClickableAsset.jsx`
- Test: `frontend/src/modules/School/quiz/clickable/ClickableAsset.test.jsx`

**Interfaces:**
- Produces: `<ClickableAsset asset="us-states" value={string|null} verdict={object|null} expected={string|null} onPick={fn} />`. **Asset-agnostic** — `asset` names any registered clickable SVG in `./assets/`; a US map is one instance. Regions carry `data-region-id`; a click/Enter on a region calls `onPick(regionId)` once until `verdict` is set. On `verdict`, the picked region gets `is-right`/`is-wrong`, and `expected` always gets `is-expected`.

- [ ] **Step 1: Obtain and prepare one clickable-asset instance (US states)**

Download a public-domain US states SVG whose paths carry state postal-code ids (e.g. Wikimedia "Blank US Map (states only)" or an equivalent CC0 `us-states.svg`). Save the raw file, record its exact source URL + license in `assets/README.md`. Then write `prepare-us-states.mjs` (instance-specific tooling — the reusable component stays generic) to normalize it (build-time, not runtime):
```javascript
/**
 * One-time prep for the us-states clickable asset. Instance-specific tooling;
 * the ClickableAsset component itself is generic.
 *  - rename each state path's `id`/`class` postal code to `data-region-id`
 *  - group multi-path states so every path of a state shares the id
 *  - append tappable callout pucks for small states (offset leader-tabs)
 * Usage: node prepare-us-states.mjs raw-us.svg us-states.svg
 */
import fs from 'node:fs';

const SMALL = ['RI', 'DE', 'DC', 'CT', 'NJ', 'MD', 'MA', 'NH', 'VT'];
// Callout anchor points (x,y in the SVG's viewBox) placed to the right/NE of
// the outline, one row per small state — tuned against the chosen asset.
const CALLOUTS = { RI: [935, 205], CT: [915, 195], NJ: [905, 250], DE: [900, 280],
  MD: [890, 300], DC: [905, 315], MA: [940, 175], NH: [925, 150], VT: [905, 150] };

const raw = fs.readFileSync(process.argv[2], 'utf8');
let out = raw.replace(/\b(?:id|class)="([A-Z]{2})"/g, 'data-region-id="$1"');
const pucks = SMALL.map((id) => {
  const [x, y] = CALLOUTS[id];
  return `<g class="school-clickable__callout" data-region-id="${id}" tabindex="0" role="button" aria-label="${id}">`
    + `<rect x="${x}" y="${y}" width="22" height="14" rx="3"/>`
    + `<text x="${x + 11}" y="${y + 11}" text-anchor="middle">${id}</text></g>`;
}).join('');
out = out.replace('</svg>', `${pucks}</svg>`);
fs.writeFileSync(process.argv[3], out);
```
Run it: `node frontend/src/modules/School/quiz/clickable/prepare-us-states.mjs raw-us.svg frontend/src/modules/School/quiz/clickable/assets/us-states.svg`. Verify every state postal code appears as a `data-region-id` and small-state pucks exist:
`grep -o 'data-region-id="[A-Z][A-Z]"' frontend/src/modules/School/quiz/clickable/assets/us-states.svg | sort -u | wc -l` → expect `50`.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/modules/School/quiz/clickable/ClickableAsset.test.jsx`:
```javascript
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import ClickableAsset from './ClickableAsset.jsx';

describe('ClickableAsset', () => {
  it('calls onPick with the clicked region id', () => {
    const onPick = vi.fn();
    const { container } = render(<ClickableAsset asset="us-states" value={null} verdict={null} expected={null} onPick={onPick} />);
    const nv = container.querySelector('[data-region-id="NV"]');
    expect(nv).toBeTruthy();
    fireEvent.click(nv);
    expect(onPick).toHaveBeenCalledWith('NV');
  });
  it('is inert once a verdict exists', () => {
    const onPick = vi.fn();
    const { container } = render(<ClickableAsset asset="us-states" value="CA" verdict={{ correct: false, expected: 'NV' }} expected="NV" onPick={onPick} />);
    fireEvent.click(container.querySelector('[data-region-id="TX"]'));
    expect(onPick).not.toHaveBeenCalled();
  });
  it('marks expected and picked regions on a verdict', () => {
    const { container } = render(<ClickableAsset asset="us-states" value="CA" verdict={{ correct: false, expected: 'NV' }} expected="NV" onPick={() => {}} />);
    expect(container.querySelector('[data-region-id="NV"]').classList.contains('is-expected')).toBe(true);
    expect(container.querySelector('[data-region-id="CA"]').classList.contains('is-wrong')).toBe(true);
  });
  it('small-state callout puck is clickable', () => {
    const onPick = vi.fn();
    const { container } = render(<ClickableAsset asset="us-states" value={null} verdict={null} expected={null} onPick={onPick} />);
    fireEvent.click(container.querySelector('.school-clickable__callout[data-region-id="RI"]'));
    expect(onPick).toHaveBeenCalledWith('RI');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/School/quiz/clickable/ClickableAsset.test.jsx`
Expected: FAIL — cannot find module.

- [ ] **Step 4: Implement ClickableAsset**

Create `frontend/src/modules/School/quiz/clickable/ClickableAsset.jsx`:
```javascript
/**
 * Reusable clickable SVG asset. NOT map-specific — `asset` names any SVG in
 * ./assets/ (a US map, an anatomy diagram, a keyboard…). Regions (and any
 * callout pucks) carry `data-region-id`; a click or Enter/Space resolves the
 * id and calls onPick once until a verdict lands. On verdict, the picked
 * region is marked right/wrong and the expected region is always highlighted.
 * Delegated listener (one handler for the whole SVG) so it works regardless of
 * how many paths a region has.
 */
import { useEffect, useMemo, useRef } from 'react';
import getLogger from '../../../../lib/logging/Logger.js';

const ASSETS = import.meta.glob('./assets/*.svg', { eager: true, query: '?raw', import: 'default' });
const svgFor = (asset) => ASSETS[`./assets/${asset}.svg`] || null;

let _logger;
const logger = () => (_logger || (_logger = getLogger().child({ component: 'clickable-asset' })));

export default function ClickableAsset({ asset, value, verdict, expected, onPick }) {
  const ref = useRef(null);
  const svg = useMemo(() => svgFor(asset), [asset]);
  const locked = !!verdict;

  // Apply verdict/selection classes imperatively (the SVG is injected HTML).
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll('[data-region-id]').forEach((el) => {
      const id = el.getAttribute('data-region-id');
      el.classList.toggle('is-selected', !locked && id === value);
      el.classList.toggle('is-expected', locked && id === expected);
      el.classList.toggle('is-right', locked && verdict?.correct && id === value);
      el.classList.toggle('is-wrong', locked && verdict && !verdict.correct && id === value);
    });
  }, [value, verdict, expected, locked, svg]);

  const handle = (e) => {
    if (locked) return;
    const target = e.target.closest?.('[data-region-id]');
    if (!target) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const id = target.getAttribute('data-region-id');
    logger().debug('region-pick', { asset, id });
    onPick(id);
  };

  if (!svg) { logger().warn('asset-missing', { asset }); return null; }
  return (
    <div
      ref={ref}
      className={`school-clickable school-clickable--${asset}${locked ? ' is-locked' : ''}`}
      onClick={handle}
      onKeyDown={handle}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/School/quiz/clickable/ClickableAsset.test.jsx`
Expected: PASS.

- [ ] **Step 6: Add clickable-asset styles**

In `frontend/src/modules/School/School.scss`, add:
```scss
.school-clickable {
  width: 100%;
  svg { width: 100%; height: auto; display: block; }
  [data-region-id] { fill: var(--school-surface-2); stroke: var(--school-border); stroke-width: 0.5; cursor: pointer; transition: fill 0.12s; }
  &:not(.is-locked) [data-region-id]:hover { fill: var(--school-accent-weak, #cfe0a8); }
  [data-region-id].is-selected { fill: var(--school-accent); }
  [data-region-id].is-right { fill: var(--school-accent); }
  [data-region-id].is-wrong { fill: var(--school-warn); }
  [data-region-id].is-expected { stroke: var(--school-accent); stroke-width: 2; }
  &.is-locked [data-region-id] { cursor: default; }
  &__callout {
    cursor: pointer;
    rect { fill: var(--school-surface-2); stroke: var(--school-border); }
    text { fill: var(--school-text); font-size: 10px; font-weight: 700; }
  }
}
```

- [ ] **Step 7: Commit**
```bash
git add frontend/src/modules/School/quiz/clickable/ frontend/src/modules/School/School.scss
git commit -m "feat(school): reusable ClickableAsset + US-states clickable asset instance"
```

---

## Task 9: Flag asset resolver

**Files:**
- Create: `frontend/src/modules/School/geography/flags/` (50 SVGs + `README.md`)
- Create: `frontend/src/modules/School/geography/flags.js`
- Test: `frontend/src/modules/School/geography/flags.test.js`

**Interfaces:**
- Produces: `flagFor(iso) → url string | null` — resolves a bundled flag SVG url (lazy `?url`), lowercase-insensitive; unknown iso → `null`.

- [ ] **Step 1: Obtain the flag assets (MIT)**

Copy the 50 flags named in `world.yml` from lipis/flag-icons (MIT) at a pinned tag into the flags dir, lowercased `iso.svg`:
```bash
FI=/tmp/flag-icons && git clone --depth 1 --branch 7.2.3 https://github.com/lipis/flag-icons "$FI"
DST=frontend/src/modules/School/geography/flags && mkdir -p "$DST"
for iso in us ca mx br ar cl co pe cu gb ie fr de it es pt nl be ch at se no dk fi pl gr ru ua tr eg ma za ng ke cn jp kr in th vn id ph sa ae il ir pk bd au nz; do
  cp "$FI/flags/4x3/$iso.svg" "$DST/$iso.svg"
done
ls "$DST"/*.svg | wc -l   # expect 50
```
Add `flags/README.md` recording: source `lipis/flag-icons`, tag `7.2.3`, license **MIT**, variant `4x3`.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/modules/School/geography/flags.test.js`:
```javascript
import { describe, it, expect } from 'vitest';
import { flagFor } from './flags.js';

describe('flagFor', () => {
  it('resolves a known iso (case-insensitive) to a url', () => {
    expect(flagFor('FR')).toBeTruthy();
    expect(flagFor('fr')).toBe(flagFor('FR'));
  });
  it('returns null for an unknown iso', () => {
    expect(flagFor('ZZ')).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/School/geography/flags.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 4: Implement**

Create `frontend/src/modules/School/geography/flags.js`:
```javascript
/**
 * iso -> bundled flag SVG url. Lazy `?url` (not raw-inlined) so ~50 flag SVGs
 * don't bloat the main bundle. Source: lipis/flag-icons (MIT) — see flags/README.md.
 */
const URLS = import.meta.glob('./flags/*.svg', { eager: true, query: '?url', import: 'default' });
const BY_ISO = {};
for (const [path, url] of Object.entries(URLS)) {
  const iso = path.replace('./flags/', '').replace('.svg', '').toUpperCase();
  BY_ISO[iso] = url;
}

export function flagFor(iso) {
  if (!iso) return null;
  return BY_ISO[String(iso).toUpperCase()] || null;
}

export default flagFor;
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/School/geography/flags.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add frontend/src/modules/School/geography/flags/ frontend/src/modules/School/geography/flags.js frontend/src/modules/School/geography/flags.test.js
git commit -m "feat(school): flag asset resolver (lipis/flag-icons MIT, lazy ?url)"
```

---

## Task 10: RegionClickItem component

**Files:**
- Create: `frontend/src/modules/School/quiz/items/RegionClickItem.jsx`
- Test: `frontend/src/modules/School/quiz/items/RegionClickItem.test.jsx`

**Interfaces:**
- Consumes: `ClickableAsset` (Task 8).
- Produces: `<RegionClickItem item={{type:'region_click', prompt, asset, answer}} onSubmit={fn} verdict={obj|null} />` — shares the `{item, onSubmit, verdict}` contract; submits the picked region id once (guarded by `submittedRef`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/School/quiz/items/RegionClickItem.test.jsx`:
```javascript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RegionClickItem from './RegionClickItem.jsx';

const item = { id: 'q', type: 'region_click', prompt: 'Click Nevada', asset: 'us-states', answer: 'NV' };

it('renders the prompt and submits the clicked region once', () => {
  const onSubmit = vi.fn();
  const { container } = render(<RegionClickItem item={item} onSubmit={onSubmit} verdict={null} />);
  expect(screen.getByText('Click Nevada')).toBeInTheDocument();
  const nv = container.querySelector('[data-region-id="NV"]');
  fireEvent.click(nv);
  fireEvent.click(nv);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenCalledWith('NV');
});

it('goes inert after a verdict', () => {
  const onSubmit = vi.fn();
  const { container } = render(<RegionClickItem item={item} onSubmit={onSubmit} verdict={{ correct: true, expected: 'NV' }} />);
  fireEvent.click(container.querySelector('[data-region-id="CA"]'));
  expect(onSubmit).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/School/quiz/items/RegionClickItem.test.jsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

Create `frontend/src/modules/School/quiz/items/RegionClickItem.jsx`:
```javascript
/** Region-click item: prompt + a ClickableAsset. Submits the picked region id
 *  once (submittedRef guards a double-tap before verdict arrives). */
import { useEffect, useRef, useState } from 'react';
import ClickableAsset from '../clickable/ClickableAsset.jsx';

export default function RegionClickItem({ item, onSubmit, verdict }) {
  const submittedRef = useRef(false);
  const [picked, setPicked] = useState(null);
  useEffect(() => { submittedRef.current = false; setPicked(null); }, [item.id]);
  const onPick = (regionId) => {
    if (verdict || submittedRef.current) return;
    submittedRef.current = true;
    setPicked(regionId);
    onSubmit(regionId);
  };
  return (
    <div className="school-item school-item--region">
      <p className="school-item__prompt">{item.prompt}</p>
      <ClickableAsset asset={item.asset} value={picked} verdict={verdict}
        expected={verdict?.expected ?? null} onPick={onPick} />
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/School/quiz/items/RegionClickItem.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/modules/School/quiz/items/RegionClickItem.jsx frontend/src/modules/School/quiz/items/RegionClickItem.test.jsx
git commit -m "feat(school): RegionClickItem component"
```

---

## Task 11: AssetChoiceItem component (stable shuffle)

**Files:**
- Create: `frontend/src/modules/School/quiz/items/AssetChoiceItem.jsx`
- Test: `frontend/src/modules/School/quiz/items/AssetChoiceItem.test.jsx`

**Interfaces:**
- Consumes: `flagFor` (Task 9).
- Produces: `<AssetChoiceItem item={{type:'asset_choice', prompt, promptImage?, choices:[{value,label?,image?}], answer}} onSubmit={fn} verdict={obj|null} />`. Renders a flag prompt image when `promptImage` is present; text or image choices; submits `value` once; **choice order shuffled stably per `item.id`**.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/School/quiz/items/AssetChoiceItem.test.jsx`:
```javascript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AssetChoiceItem from './AssetChoiceItem.jsx';

const item = { id: 'geo:world-flags:FR', type: 'asset_choice', prompt: 'Whose flag is this?',
  promptImage: { kind: 'flag', iso: 'FR' }, answer: 'FR',
  choices: [{ value: 'FR', label: 'France' }, { value: 'DE', label: 'Germany' },
    { value: 'IT', label: 'Italy' }, { value: 'ES', label: 'Spain' }] };

it('renders the flag prompt image and submits the chosen value once', () => {
  const onSubmit = vi.fn();
  render(<AssetChoiceItem item={item} onSubmit={onSubmit} verdict={null} />);
  expect(screen.getByRole('img', { name: /flag/i })).toBeInTheDocument();
  const btn = screen.getByRole('button', { name: 'France' });
  fireEvent.click(btn);
  fireEvent.click(btn);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenCalledWith('FR');
});

it('keeps choice order stable across a verdict re-render', () => {
  const onSubmit = vi.fn();
  const { rerender } = render(<AssetChoiceItem item={item} onSubmit={onSubmit} verdict={null} />);
  const order1 = screen.getAllByRole('button').map((b) => b.textContent);
  rerender(<AssetChoiceItem item={item} onSubmit={onSubmit} verdict={{ correct: true, expected: 'FR' }} />);
  const order2 = screen.getAllByRole('button').map((b) => b.textContent);
  expect(order2).toEqual(order1);
});

it('goes inert after a verdict', () => {
  const onSubmit = vi.fn();
  render(<AssetChoiceItem item={item} onSubmit={onSubmit} verdict={{ correct: false, expected: 'FR' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Germany' }));
  expect(onSubmit).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/School/quiz/items/AssetChoiceItem.test.jsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

Create `frontend/src/modules/School/quiz/items/AssetChoiceItem.jsx`:
```javascript
/** Asset (flag) choice item. Prompt may carry a flag image; choices are text
 *  and/or flag images. Submits the chosen `value` once. Choice order is
 *  shuffled STABLY per item.id (memoized) so a verdict re-render never
 *  reshuffles the buttons under the child's finger. */
import { useEffect, useMemo, useRef } from 'react';
import { flagFor } from '../../geography/flags.js';

// Deterministic per-id shuffle (mirrors the backend seed idea; order isn't graded).
function shuffleStable(choices, seed) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const rand = () => { h |= 0; h = (h + 0x6D2B79F5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = choices.slice();
  for (let i = out.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

const flagImg = (image, alt) => (image?.kind === 'flag'
  ? <img className="school-choice__flag" src={flagFor(image.iso)} alt={alt} /> : null);

export default function AssetChoiceItem({ item, onSubmit, verdict }) {
  const submittedRef = useRef(false);
  useEffect(() => { submittedRef.current = false; }, [item.id]);
  const ordered = useMemo(() => shuffleStable(item.choices, item.id), [item.id, item.choices]);
  const submit = (value) => {
    if (verdict || submittedRef.current) return;
    submittedRef.current = true;
    onSubmit(value);
  };
  return (
    <div className="school-item school-item--asset">
      <p className="school-item__prompt">{item.prompt}</p>
      {item.promptImage && (
        <div className="school-item__prompt-image">{flagImg(item.promptImage, `${item.promptImage.kind} to identify`)}</div>
      )}
      <div className="school-item__choices school-item__choices--asset">
        {ordered.map((c) => {
          const cls = ['school-item__choice'];
          if (verdict) {
            if (c.value === verdict.expected) cls.push('school-item__choice--right');
            else cls.push('school-item__choice--dim');
          }
          return (
            <button key={c.value} type="button" className={cls.join(' ')} disabled={!!verdict}
              aria-label={c.label || c.value} onClick={() => submit(c.value)}>
              {flagImg(c.image, c.label || c.value)}
              {c.label && <span className="school-choice__label">{c.label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```
Add to `School.scss`:
```scss
.school-item__prompt-image { display: flex; justify-content: center; margin: 0.5rem 0; }
.school-choice__flag { width: 96px; height: 72px; object-fit: contain; border: 1px solid var(--school-border); border-radius: 6px; }
.school-item__choices--asset { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.6rem; }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/School/quiz/items/AssetChoiceItem.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/modules/School/quiz/items/AssetChoiceItem.jsx frontend/src/modules/School/quiz/items/AssetChoiceItem.test.jsx frontend/src/modules/School/School.scss
git commit -m "feat(school): AssetChoiceItem with stable per-item choice shuffle"
```

---

## Task 12: `useGradedSession` hook

**Files:**
- Create: `frontend/src/modules/School/geography/useGradedSession.js`
- Test: `frontend/src/modules/School/geography/useGradedSession.test.jsx`

**Interfaces:**
- Consumes: `schoolApi.openSession/answer` (`schoolApi.js`), `useSchoolProfile` (`identity/SchoolProfileContext.jsx`), `schoolLog` (`schoolLog.js`).
- Produces: `useGradedSession({ bank, mode, onExit }) → { sessionId, submit, status }`. Opens exactly one session gated on profile `ready`; pins identity at open; `submit(itemId, given) → { correct, expected } | { unrecorded: true } | null`; abandons (calls `onExit`) on identity change or a `410`. **New code, consumed by GeoQuizRunner only.**

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/School/geography/useGradedSession.test.jsx`:
```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGradedSession } from './useGradedSession.js';

vi.mock('../schoolApi.js', () => ({ schoolApi: {
  openSession: vi.fn(async () => ({ ok: true, status: 200, data: { sessionId: 'ses_1' } })),
  answer: vi.fn(async () => ({ ok: true, status: 200, data: { correct: true, expected: 'NV' } })),
} }));
vi.mock('../identity/SchoolProfileContext.jsx', () => ({
  useSchoolProfile: () => ({ status: 'ready', currentUser: { id: 'u1' }, isGuest: false }),
}));
import { schoolApi } from '../schoolApi.js';

const bank = { id: 'geo:us-state-locations', title: 'Loc', items: [{ id: 'i1' }] };

beforeEach(() => { schoolApi.openSession.mockClear(); schoolApi.answer.mockClear(); });

it('opens exactly one session and returns a grade on submit', async () => {
  const onExit = vi.fn();
  const { result } = renderHook(() => useGradedSession({ bank, mode: 'drill', onExit }));
  await waitFor(() => expect(result.current.sessionId).toBe('ses_1'));
  expect(schoolApi.openSession).toHaveBeenCalledTimes(1);
  let verdict;
  await act(async () => { verdict = await result.current.submit('i1', 'NV'); });
  expect(verdict).toEqual({ correct: true, expected: 'NV' });
});

it('surfaces unrecorded on a 500', async () => {
  schoolApi.answer.mockResolvedValueOnce({ ok: false, status: 500, data: null });
  const { result } = renderHook(() => useGradedSession({ bank, mode: 'drill', onExit: vi.fn() }));
  await waitFor(() => expect(result.current.sessionId).toBe('ses_1'));
  let verdict;
  await act(async () => { verdict = await result.current.submit('i1', 'NV'); });
  expect(verdict).toEqual({ unrecorded: true });
});

it('exits on a 410', async () => {
  schoolApi.answer.mockResolvedValueOnce({ ok: false, status: 410, data: null });
  const onExit = vi.fn();
  const { result } = renderHook(() => useGradedSession({ bank, mode: 'drill', onExit }));
  await waitFor(() => expect(result.current.sessionId).toBe('ses_1'));
  await act(async () => { await result.current.submit('i1', 'NV'); });
  expect(onExit).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/School/geography/useGradedSession.test.jsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

Create `frontend/src/modules/School/geography/useGradedSession.js`:
```javascript
/**
 * Shared session plumbing for a graded runner (GeoQuizRunner). Mirrors the
 * hardened dance in QuizRunner/FlashcardRunner — single open gated on profile
 * `ready`, identity pinned at open, synchronous abandon on identity change,
 * 410 -> onExit, unrecorded surfacing — but is NEW code consumed only here;
 * the existing runners are intentionally NOT migrated.
 */
import { useEffect, useRef, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import { useSchoolProfile } from '../identity/SchoolProfileContext.jsx';

export function useGradedSession({ bank, mode, onExit }) {
  const { status, currentUser, isGuest } = useSchoolProfile();
  const [sessionId, setSessionId] = useState(null);
  const identityKey = currentUser?.id ?? (isGuest ? 'guest' : 'none');
  const initialIdentity = useRef(null);
  const sessionOpenedRef = useRef(false);
  const abandonedRef = useRef(false);

  useEffect(() => {
    if (initialIdentity.current === null) return;
    if (identityKey !== initialIdentity.current) {
      abandonedRef.current = true;
      schoolLog.session('end', { sessionId, bankId: bank.id, mode, reason: 'identity-changed' });
      onExit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey]);

  useEffect(() => {
    if (status !== 'ready' || sessionOpenedRef.current) return;
    sessionOpenedRef.current = true;
    initialIdentity.current = identityKey;
    let alive = true;
    const userId = currentUser?.id ?? null;
    schoolApi.openSession({ userId, bankId: bank.id, mode }).then(({ ok, data }) => {
      if (!alive) return;
      if (!ok) { onExit(); return; }
      setSessionId(data.sessionId);
      schoolLog.session('start', { sessionId: data.sessionId, bankId: bank.id, mode, userId, itemCount: bank.items.length });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, identityKey]);

  const submit = async (itemId, given) => {
    if (!sessionId || abandonedRef.current) return null;
    const { ok, status: st, data } = await schoolApi.answer(sessionId, { itemId, given });
    if (abandonedRef.current) return null;
    if (st === 410) { onExit(); return null; }
    if (!ok) {
      schoolLog.answerError('record-failed', { sessionId, itemId, status: st });
      return { unrecorded: true };
    }
    schoolLog.answer('graded', { sessionId, itemId, correct: data.correct });
    return data;
  };

  return { sessionId, submit, status };
}

export default useGradedSession;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/School/geography/useGradedSession.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/modules/School/geography/useGradedSession.js frontend/src/modules/School/geography/useGradedSession.test.jsx
git commit -m "feat(school): useGradedSession hook (GeoQuizRunner only)"
```

---

## Task 13: GeoQuizRunner (graded + resurfacing)

**Files:**
- Create: `frontend/src/modules/School/geography/GeoQuizRunner.jsx`
- Test: `frontend/src/modules/School/geography/GeoQuizRunner.test.jsx`

**Interfaces:**
- Consumes: `useGradedSession` (Task 12), `RegionClickItem` (Task 10), `AssetChoiceItem` (Task 11), `MultipleChoiceItem` (existing).
- Produces: `<GeoQuizRunner bank={bank} onExit={fn} />`. Renders items from a live queue; correct → drop; wrong → show correct answer then requeue; unrecorded → requeue as not-mastered (no verdict flash); ends on empty queue with `Mastered N/N · first try k`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/School/geography/GeoQuizRunner.test.jsx`:
```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import GeoQuizRunner from './GeoQuizRunner.jsx';

const submit = vi.fn();
vi.mock('./useGradedSession.js', () => ({ useGradedSession: () => ({ sessionId: 'ses_1', submit, status: 'ready' }) }));

const bank = { id: 'geo:us-state-capitals', title: 'US Capitals', items: [
  { id: 'i1', type: 'multiple_choice', prompt: 'Capital of Nevada?', answer: 'Carson City', choices: ['Carson City', 'Reno'] },
  { id: 'i2', type: 'multiple_choice', prompt: 'Capital of Oregon?', answer: 'Salem', choices: ['Salem', 'Portland'] },
] };

beforeEach(() => submit.mockReset());

it('drops correct items and ends with a mastery summary', async () => {
  submit.mockResolvedValue({ correct: true, expected: 'x' });
  render(<GeoQuizRunner bank={bank} onExit={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Carson City' }));
  await screen.findByRole('button', { name: 'Next' });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Salem' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  expect(await screen.findByTestId('geo-summary')).toHaveTextContent('Mastered 2 / 2');
});

it('requeues a missed item until it is answered correctly', async () => {
  submit.mockResolvedValueOnce({ correct: false, expected: 'Carson City' })
        .mockResolvedValue({ correct: true, expected: 'x' });
  render(<GeoQuizRunner bank={bank} onExit={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reno' })); // wrong on i1
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  // i2 next, answer right
  fireEvent.click(await screen.findByRole('button', { name: 'Salem' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  // i1 resurfaces
  expect(await screen.findByText('Capital of Nevada?')).toBeInTheDocument();
});

it('requeues an unrecorded answer as not-mastered (no crash, no mastery)', async () => {
  submit.mockResolvedValueOnce({ unrecorded: true }).mockResolvedValue({ correct: true, expected: 'x' });
  render(<GeoQuizRunner bank={bank} onExit={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Carson City' }));
  expect(await screen.findByTestId('unrecorded')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/School/geography/GeoQuizRunner.test.jsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

Create `frontend/src/modules/School/geography/GeoQuizRunner.jsx`:
```javascript
/**
 * Geography drill: server-graded (like QuizRunner) AND resurfacing (like
 * FlashcardRunner). Correct -> drop; wrong -> show the answer, requeue at the
 * end; unrecorded (record failed, grade unknown) -> requeue as not-mastered
 * with an inline banner, never strand. Ends when the queue empties.
 */
import { useMemo, useRef, useState } from 'react';
import { useGradedSession } from './useGradedSession.js';
import RegionClickItem from '../quiz/items/RegionClickItem.jsx';
import AssetChoiceItem from '../quiz/items/AssetChoiceItem.jsx';
import MultipleChoiceItem from '../quiz/items/MultipleChoiceItem.jsx';

const ITEM_COMPONENTS = {
  region_click: RegionClickItem,
  asset_choice: AssetChoiceItem,
  multiple_choice: MultipleChoiceItem,
};

export default function GeoQuizRunner({ bank, onExit }) {
  const { sessionId, submit } = useGradedSession({ bank, mode: 'drill', onExit });
  const [queue, setQueue] = useState(bank.items);
  const [verdict, setVerdict] = useState(null);
  const [unrecorded, setUnrecorded] = useState(false);
  const [firstTry, setFirstTry] = useState(0);
  const [done, setDone] = useState(false);
  const missedOnce = useRef(new Set());
  const submittingRef = useRef(false);

  const total = bank.items.length;
  const card = queue[0];

  const onItemSubmit = async (given) => {
    if (!sessionId || verdict || submittingRef.current) return;
    submittingRef.current = true;
    const result = await submit(card.id, given);
    submittingRef.current = false;
    if (!result) return; // abandoned / exited
    if (result.unrecorded) { setUnrecorded(true); setVerdict({ unrecorded: true }); return; }
    setUnrecorded(false);
    setVerdict(result);
  };

  const next = () => {
    const wasUnrecorded = !!verdict?.unrecorded;
    const correct = !!verdict?.correct;
    setVerdict(null);
    setUnrecorded(false);
    if (correct) {
      if (!missedOnce.current.has(card.id)) setFirstTry((n) => n + 1);
      const rest = queue.slice(1);
      if (rest.length === 0) setDone(true); else setQueue(rest);
    } else {
      // wrong OR unrecorded -> not mastered, resurface at the end
      if (!wasUnrecorded) missedOnce.current.add(card.id);
      setQueue((q) => [...q.slice(1), q[0]]);
    }
  };

  if (done) {
    return (
      <div className="school-runner school-runner--summary" data-testid="geo-summary">
        <h2>{bank.title}</h2>
        <p className="school-runner__score">Mastered {total} / {total}</p>
        <p className="school-runner__hint">first try {firstTry}</p>
        <button type="button" className="school-runner__done" onClick={onExit}>Done</button>
      </div>
    );
  }
  if (!sessionId) {
    return (
      <div className="school-runner school-runner--geo" data-testid="geo-loading">
        <p className="school-runner__loading">Loading…</p>
      </div>
    );
  }
  if (!card) return null;
  const ItemComponent = ITEM_COMPONENTS[card.type];
  return (
    <div className="school-runner school-runner--geo">
      <div className="school-runner__progress">{queue.length} left</div>
      {unrecorded && <div className="school-runner__unrecorded" data-testid="unrecorded">Answer not recorded — check the server.</div>}
      <ItemComponent key={card.id} item={card} onSubmit={onItemSubmit} verdict={verdict} />
      {verdict && <button type="button" className="school-runner__next" onClick={next}>Next</button>}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/School/geography/GeoQuizRunner.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/modules/School/geography/GeoQuizRunner.jsx frontend/src/modules/School/geography/GeoQuizRunner.test.jsx
git commit -m "feat(school): GeoQuizRunner — graded + resurfacing drill"
```

---

## Task 14: GeographyGrid (topic grid)

**Files:**
- Create: `frontend/src/modules/School/geography/GeographyGrid.jsx`
- Test: `frontend/src/modules/School/geography/GeographyGrid.test.jsx`

**Interfaces:**
- Consumes: `schoolApi.geoDecks()` (Task 7), `Icon` (`home/icons/Icon.jsx`).
- Produces: `<GeographyGrid onLaunch={fn} />` — fetches decks, renders a tile per deck; available tiles call `onLaunch({ id: deck.bankId, title: deck.title, audience: 'generic' }, 'drill')`; unavailable tiles render greyed and are not clickable. Each tile shows a topic icon (`states`/`capitals`/`flags`/`countries` by heuristic on deckId).

  > **Critical:** the payload MUST include `audience: 'generic'`. `SchoolApp.start()` guards `if (asGuest && bankSummary.audience !== 'generic')` — a payload without `audience` reads `undefined !== 'generic'` → true → a guest is wrongly blocked from a generic geo deck with a "Sign in" notice.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/School/geography/GeographyGrid.test.jsx`:
```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GeographyGrid from './GeographyGrid.jsx';

vi.mock('../schoolApi.js', () => ({ schoolApi: { geoDecks: vi.fn() } }));
import { schoolApi } from '../schoolApi.js';

beforeEach(() => {
  schoolApi.geoDecks.mockResolvedValue({ ok: true, data: { decks: [
    { deckId: 'us-state-locations', bankId: 'geo:us-state-locations', title: 'US State Locations', itemType: 'region_click', available: true },
    { deckId: 'country-locations', bankId: 'geo:country-locations', title: 'Country Locations', itemType: 'region_click', available: false },
  ] } });
});

it('launches an available deck through onLaunch with drill mode + generic audience', async () => {
  const onLaunch = vi.fn();
  render(<GeographyGrid onLaunch={onLaunch} />);
  const tile = await screen.findByRole('button', { name: /US State Locations/i });
  fireEvent.click(tile);
  expect(onLaunch).toHaveBeenCalledWith(
    { id: 'geo:us-state-locations', title: 'US State Locations', audience: 'generic' }, 'drill');
});

it('renders unavailable decks greyed and non-interactive', async () => {
  const onLaunch = vi.fn();
  render(<GeographyGrid onLaunch={onLaunch} />);
  const coming = await screen.findByText('Country Locations');
  fireEvent.click(coming);
  expect(onLaunch).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/School/geography/GeographyGrid.test.jsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

Create `frontend/src/modules/School/geography/GeographyGrid.jsx`:
```javascript
/** Topic grid for the geography section. Tiles come from GET /geography/decks;
 *  available tiles launch a drill via onLaunch (which enforces identity —
 *  never open a session directly here). Unavailable tiles are greyed. */
import { useEffect, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import Icon from '../home/icons/Icon.jsx';

const iconFor = (deckId) => {
  if (deckId.includes('flag')) return 'flags';
  if (deckId.includes('capital')) return 'capitals';
  if (deckId.includes('country')) return 'countries';
  if (deckId.includes('state')) return 'states';
  return 'geography';
};

export default function GeographyGrid({ onLaunch }) {
  const [decks, setDecks] = useState(null);
  useEffect(() => {
    let alive = true;
    schoolApi.geoDecks().then(({ ok, data }) => {
      if (alive) setDecks(ok && Array.isArray(data?.decks) ? data.decks : []);
    });
    return () => { alive = false; };
  }, []);

  if (decks === null) return <div className="school-geo-grid" data-testid="geo-grid-loading">Loading…</div>;
  return (
    <div className="school-geo-grid">
      {decks.map((d) => (d.available ? (
        <button key={d.deckId} type="button" className="school-geo-tile"
          onClick={() => onLaunch({ id: d.bankId, title: d.title, audience: 'generic' }, 'drill')}>
          <Icon name={iconFor(d.deckId)} className="school-geo-tile__icon" />
          <span className="school-geo-tile__label">{d.title}</span>
        </button>
      ) : (
        <div key={d.deckId} className="school-geo-tile school-geo-tile--soon" aria-disabled="true">
          <Icon name={iconFor(d.deckId)} className="school-geo-tile__icon" />
          <span className="school-geo-tile__label">{d.title}</span>
          <span className="school-geo-tile__soon">Coming soon</span>
        </div>
      )))}
    </div>
  );
}
```
Add to `School.scss`:
```scss
.school-geo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; padding: 1rem; }
.school-geo-tile { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 1.25rem 1rem; border: 1px solid var(--school-border); border-radius: 14px; background: var(--school-surface); color: var(--school-text); cursor: pointer;
  &__icon { font-size: 2.5rem; }
  &__label { font-weight: 700; text-align: center; }
  &--soon { opacity: 0.5; cursor: default; }
  &__soon { font-size: 0.7rem; color: var(--school-muted); }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/School/geography/GeographyGrid.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/modules/School/geography/GeographyGrid.jsx frontend/src/modules/School/geography/GeographyGrid.test.jsx frontend/src/modules/School/School.scss
git commit -m "feat(school): GeographyGrid topic grid"
```

---

## Task 15: Placeholder topic icons

**Files:**
- Create: `frontend/src/modules/School/home/icons/svg/geography.svg`, `states.svg`, `capitals.svg`, `flags.svg`, `countries.svg`
- Modify: `frontend/src/modules/School/home/icons/MANIFEST.md`
- Test: `frontend/src/modules/School/home/icons/Icon.geo.test.jsx` (create)

**Interfaces:**
- Consumes: `Icon` glob loader (`Icon.jsx`).
- Produces: five named icons resolvable by `<Icon name="…" />`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/School/home/icons/Icon.geo.test.jsx`:
```javascript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Icon from './Icon.jsx';

describe('geography topic icons', () => {
  ['geography', 'states', 'capitals', 'flags', 'countries'].forEach((name) => {
    it(`renders the ${name} icon`, () => {
      const { container } = render(<Icon name={name} label={name} />);
      expect(container.querySelector('svg')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/School/home/icons/Icon.geo.test.jsx`
Expected: FAIL — `Icon` returns null (no such icons), `querySelector('svg')` null.

- [ ] **Step 3: Create the placeholder SVGs**

Each is a simple `currentColor` line-art placeholder (viewBox `0 0 24 24`), to be swapped for final art later. Example `geography.svg` (a globe):
```xml
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M4.5 7h15M4.5 17h15"/></g></svg>
```
`states.svg` (map pin over a grid):
```xml
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 5h16v14H4z"/><path d="M9 5v14M15 5v14M4 10h16M4 14h16"/></g></svg>
```
`capitals.svg` (star):
```xml
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z"/></svg>
```
`flags.svg` (flag):
```xml
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 3v18"/><path d="M6 4h12l-3 4 3 4H6z"/></g></svg>
```
`countries.svg` (globe with pin):
```xml
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3v14"/><path d="M18 14c1.7 0 3 1.3 3 3 0 2-3 4-3 4s-3-2-3-4c0-1.7 1.3-3 3-3z"/></g></svg>
```

- [ ] **Step 4: Add MANIFEST rows**

Append to `frontend/src/modules/School/home/icons/MANIFEST.md` (follow the existing row format in that file):
```markdown
| geography | globe | Geography program tile |
| states | grid/map | US state locations deck |
| capitals | star | Capitals decks |
| flags | flag | World flags deck |
| countries | globe+pin | Country decks |
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/School/home/icons/Icon.geo.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add frontend/src/modules/School/home/icons/svg/geography.svg frontend/src/modules/School/home/icons/svg/states.svg frontend/src/modules/School/home/icons/svg/capitals.svg frontend/src/modules/School/home/icons/svg/flags.svg frontend/src/modules/School/home/icons/svg/countries.svg frontend/src/modules/School/home/icons/MANIFEST.md frontend/src/modules/School/home/icons/Icon.geo.test.jsx
git commit -m "feat(school): placeholder SVG topic icons for geography"
```

---

## Task 16: Navigation wiring (subject tile + geography section + drill mount)

**Files:**
- Modify: `frontend/src/modules/School/home/SubjectPage.jsx:25`
- Modify: `frontend/src/modules/School/SchoolApp.jsx` (`parseSchoolPath`/`sectionPathFor` ~69-103, `sectionLabel` ~255, section mounts ~336-374)
- Test: `frontend/src/modules/School/schoolUrl.test.js` (extend)
- Test: `frontend/src/modules/School/SchoolApp.geo.test.jsx` (create)

**Interfaces:**
- Consumes: `GeographyGrid` (Task 14), `GeoQuizRunner` (Task 13), existing `onLaunch`/`start`/`active` in `SchoolApp`.
- Produces: a "Geography" app tile on the "History & Geography" shelf opening section `geography`; the section renders `GeographyGrid`; launching a deck sets `active={bank, mode:'drill'}`; a `drill` active mounts `GeoQuizRunner`; deep-link `/geography` round-trips.

- [ ] **Step 1: Add the subject program entry**

In `SubjectPage.jsx`, extend `SUBJECT_PROGRAMS`:
```javascript
const SUBJECT_PROGRAMS = {
  writing: [{ id: 'typing', label: 'Typing', hint: 'Learn to touch-type', section: 'typing' }],
  history: [{ id: 'geography', label: 'Geography', hint: 'States, capitals, and flags', section: 'geography' }],
};
```

- [ ] **Step 2: Write the failing URL round-trip test**

`schoolUrl.test.js` imports `{ parseSchoolPath, schoolPathFor }` (note: `sectionPathFor` is NOT exported), uses `BASE = '/screens/portal'`, and drives `parseSchoolPath` via `window.history.replaceState` through the file's `at(pathname)` helper. Add:
```javascript
describe('geography section', () => {
  it('builds the geography section path', () => {
    expect(schoolPathFor(BASE, 'geography')).toBe(`${BASE}/geography`);
  });
  it('parses the geography section path', () => {
    at(`${BASE}/geography`);
    expect(parseSchoolPath(BASE).section).toBe('geography');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/School/schoolUrl.test.js`
Expected: FAIL — geography not handled (returns base / null section).

- [ ] **Step 4: Wire the section into SchoolApp**

In `SchoolApp.jsx`:
- In `sectionPathFor`, add before the fallthrough: `if (section === 'geography') return `${urlBase}/geography`;`
- In `parseSchoolPath`, add the reverse mapping for the `geography` path segment (mirror how `typing`/`print` are parsed there).
- In `sectionLabel`, add: `: section === 'geography' ? 'Geography'` in the ternary chain.
- Import the components at the top:
  ```javascript
  import GeographyGrid from './geography/GeographyGrid.jsx';
  import GeoQuizRunner from './geography/GeoQuizRunner.jsx';
  ```
- Add the section mount (next to `{section === 'typing' && <TypingTutor />}`), gated on no active runner:
  ```javascript
  {section === 'geography' && !active && <GeographyGrid onLaunch={onLaunch} />}
  ```
- Add the drill runner mount (next to the quiz/flashcard mounts at lines 373-374):
  ```javascript
  {active?.mode === 'drill' && <GeoQuizRunner bank={active.bank} onExit={() => setActive(null)} />}
  ```
`onLaunch` already routes unclaimed users to the picker and calls `start(bankSummary, mode, isGuest)`, which sets `active={bank, mode}` — no change needed there; `start` fetches the full bank via `schoolApi.bank(bankSummary.id)` which resolves the `geo:` id through the new source seam.

- [ ] **Step 5: Run the URL test to verify it passes**

Run: `npx vitest run frontend/src/modules/School/schoolUrl.test.js`
Expected: PASS.

- [ ] **Step 6: Write + run the section-mount test**

Create `frontend/src/modules/School/SchoolApp.geo.test.jsx` following the existing `SchoolApp.test.jsx` harness (same mocks/providers). Assert: opening the "History & Geography" subject shows a "Geography" tile; clicking it (claimed identity) navigates to the geography section and renders the topic grid. Reuse the `openSubject` helper pattern from `SchoolApp.test.jsx` (wait for the enabled tile before clicking). Then:

Run: `npx vitest run frontend/src/modules/School/SchoolApp.geo.test.jsx`
Expected: PASS.

- [ ] **Step 7: Full School frontend suite (no regressions)**

Run: `npx vitest run frontend/src/modules/School`
Expected: PASS.

- [ ] **Step 8: Commit**
```bash
git add frontend/src/modules/School/home/SubjectPage.jsx frontend/src/modules/School/SchoolApp.jsx frontend/src/modules/School/schoolUrl.test.js frontend/src/modules/School/SchoolApp.geo.test.jsx
git commit -m "feat(school): geography subject tile + section + drill runner mount"
```

---

## Task 17: Docs

**Files:**
- Modify: `docs/reference/school/README.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Add a "Geography / interactive quizzes" section**

Document, in the present tense (endstate, no class-name churn per repo doc policy): the two interactive item types and their grading; the geography dataset + recipes + generator; the synth-on-read `geo:` bank seam in `SchoolService` (kept out of `listBanks`); the `drill` mode + dedicated reporting lane; the `GET /geography/decks` endpoint; how to add a new geography deck (a dataset row + a `decks.yml` recipe line); and how to reuse the framework for a non-geography interactive quiz (new SVG + dataset for `ClickableAsset`, or images for `asset_choice`).

- [ ] **Step 2: Update the docs marker (if the repo uses it)**
```bash
git rev-parse HEAD > docs/docs-last-updated.txt
```

- [ ] **Step 3: Commit**
```bash
git add docs/reference/school/README.md docs/docs-last-updated.txt
git commit -m "docs(school): document the interactive geography quiz framework"
```

---

## Final Verification (before merge)

- [ ] Full backend school suite: `npx vitest run backend/src/2_domains/school backend/src/3_applications/school backend/src/4_api/v1/routers/school.geo.test.mjs` → all PASS.
- [ ] Full frontend school suite: `npx vitest run frontend/src/modules/School` → all PASS.
- [ ] Build + deploy (respect the CLAUDE.local.md deploy gate — never redeploy during an active fitness session or a playing Player video), then smoke-test on device: open `/screens/portal` → History & Geography → Geography → each of the three decks; verify a region click (US map), a capital MC, and a flag pick each grade and the summary renders.
- [ ] Confirm geo banks are absent from the Library and the general Practice bank list.

---

## Self-Review (against the spec)

**Spec coverage:**
- New item types (grade+validate) → Task 1. Distractors → Task 2. Dataset/recipes/generator → Task 3. Bank source → Task 4. Service seam → Task 5. Drill mode + lane → Task 6. Endpoint/wiring/API → Task 7. ClickableAsset + US-states instance → Task 8. Flags → Task 9. Items → Tasks 10-11. Hook → Task 12. Runner → Task 13. Grid → Task 14. Icons → Task 15. Nav → Task 16. Docs → Task 17. All spec sections mapped.
- Global constraints (strict `===`, no `givenShapeError` change, generic audience, geo out of listBanks, drill never in quiz lane, onLaunch identity gate, hook GeoQuizRunner-only, stable shuffle, committed MIT assets) each appear as an explicit step or constraint.

**Type consistency:** `resolve`/`listDeckSummaries` (Tasks 4/5/7), `useGradedSession({bank,mode,onExit})→{sessionId,submit,status}` (Tasks 12/13), item contract `{item,onSubmit,verdict}` (Tasks 10/11/13), `onLaunch({id,title},'drill')` (Tasks 14/16) match across tasks. Deck summary shape `{deckId,bankId,title,itemType,available}` consistent (Tasks 4/7/14).

**Placeholder scan:** no TBD/TODO/"handle edge cases"; asset-acquisition steps give concrete commands + sources; every code step shows the code.
