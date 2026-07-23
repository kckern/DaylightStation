# Interactive Geography Quizzes — Design Spec

**Date:** 2026-07-23
**Status:** Approved for planning
**Author:** KC Kern + Claude

## Goal

Build a **reusable interactive-quiz framework** by extending the existing School
quiz stack with two new input modalities — **clickable maps** and **image/flag
assets** — and prove it with a geography content slice (US states, US capitals,
world flags). Adding the next geography quiz (or a non-geography interactive
quiz) should be *content*, not engine work.

## Context: what already exists

The School app has a mature, server-graded quiz framework. This design **extends
it in place** — it does not fork a parallel engine.

- **Banks** are validated data (`validateQuestionBank`) with typed items:
  `multiple_choice | short_answer | cloze | matching`. Loaded by the datastore
  (`readBankRaw` / `readAllBankRaws`), summarized for listing, fully validated on
  open.
- **Grading** (`backend/src/2_domains/school/grading.mjs`) is pure per-type and
  conservative (trim / collapse-whitespace / casefold; no fuzzy match). **Every
  existing type grades by normalized exact-token match.**
- **Sessions**: `openSession({userId, bankId, mode})` → `answer(sessionId,
  {itemId, given|selfGrade})`. `MODES = {quiz, flashcard}`. `quiz` grades
  server-side and returns `{correct, expected, attemptId}`; `flashcard` records a
  `selfGrade` and returns `{attemptId}`.
- **Runners** (frontend): `QuizRunner` (one-pass assessment, **no resurfacing**)
  and `FlashcardRunner` (self-graded, **resurfaces** missed cards). Both share
  hardened plumbing: single session open gated on profile `ready`, identity
  pinned at open, synchronous `abandonedRef` on identity change, `submittedRef`
  double-tap guard, "unrecorded" surfacing on record failure.
- Item components share the contract `{ item, onSubmit, verdict }` and are
  registered in `ITEM_COMPONENTS` by `item.type`.
- **Home** (`School/home`) has a subject wall of program tiles (`programs.js`
  `PROGRAMS`) and an SVG icon system (`home/icons/Icon.jsx` + `svg/*.svg` +
  `MANIFEST.md`), mirroring the Piano kiosk home.

**Key architectural finding:** map-click and flag-pick both reduce to
exact-token grading. The genuinely new work is **rendering** (an SVG map, flag
images) and **content generation** — not grading logic.

## Confirmed decisions (from brainstorming)

1. **Extend the existing framework** — new item types register into the same
   `ITEM_COMPONENTS` map and share the `{item, onSubmit, verdict}` contract.
2. **Backend dataset + generator, server-graded** — the correct answer lives
   server-side; the client sends only `given`.
3. **MVP = framework + proving slice** — US state locations (`map_click`), US
   capitals (`multiple_choice`), world flags (`asset_choice`). Country map, state
   flags, world capitals are follow-on *content*.
4. **Drill / resurface until mastered** — the geography session is objective
   (server-graded) **and** resurfacing.
5. **Synth-on-read banks** (not materialized YAML files).
6. **Geography is its own program tile** (like Language / Quizzes).
7. **New `drill` session mode** (graded like `quiz`, recorded as its own lane).

---

## Architecture

```
Backend
  data/.../geography/
    us-states.yml     entities: {id, name, capital, region_id, iso}
    world.yml         entities: {id, name, capital, region_id, iso}
    decks.yml         deck recipes (what banks exist, direction, item type)
  2_domains/school/geography/
    generateGeoBank.mjs   pure: (recipe, entities, seed) -> validated bank shape
    distractors.mjs       pure: sample N wrong options from a pool, deterministic
  3_applications/school/sources/GeographyBankSource.mjs
                          synth-on-read: resolves geo:* bankIds + lists them
  grading.mjs             + map_click, asset_choice (exact-token match)
  questionBankValidation  + map_click, asset_choice shape checks
  SchoolService           MODES += 'drill'; grade branch = quiz||drill

Frontend  (School/)
  quiz/items/MapClickItem.jsx      new  ({item,onSubmit,verdict})
  quiz/items/AssetChoiceItem.jsx   new  ({item,onSubmit,verdict})
  geography/ClickableMap.jsx       new  SVG map, data-region-id -> onPick
  geography/flags.js               new  iso -> bundled flag SVG resolver
  geography/GeoQuizRunner.jsx      new  graded + resurfacing runner
  geography/maps/us-states.svg     asset (CC0)
  geography/flags/*.svg            assets (CC0), by iso2
  home/icons/svg/{geography,states,capitals,flags,countries}.svg  placeholders
  programs.js                      + geography program
```

## Component design

### 1. New item types

Added to the `ITEM_TYPES` set, `gradeAnswer`, `givenShapeError`, and
`validateQuestionBank`.

#### `map_click`
Prompt is text; the answer input is a click on an SVG region.

```yaml
- id: geo:us-states:locate:NV
  type: map_click
  prompt: "Click Nevada"
  map: us-states          # which map SVG + region set
  answer: NV              # the correct region_id
```

- **given**: the clicked `region_id` (non-empty string).
- **grade**: `{ correct: norm(given) === norm(answer), expected: answer }` —
  identical logic to `multiple_choice`. `expected` lets the map flash the correct
  region on a miss.
- **validation**: `prompt` non-empty; `map` non-empty string; `answer` non-empty
  string.

#### `asset_choice`
Prompt may be text **or** an image (a flag); choices are objects that may carry
an image. Covers both directions (flag→name and name→flag).

```yaml
# flag -> country name  (image prompt, text choices)
- id: geo:world-flags:FR
  type: asset_choice
  prompt: "Whose flag is this?"
  promptImage: { kind: flag, iso: FR }     # optional image alongside the prompt
  choices:
    - { value: FR, label: "France" }
    - { value: DE, label: "Germany" }
    - { value: IT, label: "Italy" }
    - { value: ES, label: "Spain" }
  answer: FR

# country name -> flag  (text prompt, image choices)
- id: geo:world-flags-rev:FR
  type: asset_choice
  prompt: "Which flag is France's?"
  choices:
    - { value: FR, image: { kind: flag, iso: FR } }
    - { value: DE, image: { kind: flag, iso: DE } }
    - { value: IT, image: { kind: flag, iso: IT } }
    - { value: ES, image: { kind: flag, iso: ES } }
  answer: FR
```

- **given**: the chosen `value` (non-empty string).
- **grade**: `{ correct: norm(given) === norm(answer), expected: answer }`.
- **validation**: `prompt` non-empty; `choices` ≥ 2, each with a non-empty
  `value`; `value`s unique; each optional `image` and `label` a non-empty string;
  `answer` present and among the choice `value`s. `promptImage`, when present, is
  a mapping with non-empty string fields. **Every choice must carry a `label` OR
  an `image`** (nothing renders blank).

**"Name this region" (`map_prompt`)** is *not* a new type: it is `asset_choice`
(or `multiple_choice`) whose prompt medium is a highlighted map region. Deferred
to the countries follow-on; MVP does not require it.

> Grading stays a single normalized exact-match for all four new+old
> objective types. No fuzzy matching, no partial credit.

### 2. Geography dataset + bank generation

**Dataset** — the single source of truth, small and hand-maintained:

```yaml
# us-states.yml
- { id: NV, name: Nevada,   capital: Carson City, region_id: NV, iso: US-NV }
- { id: CA, name: California, capital: Sacramento, region_id: CA, iso: US-CA }
# ...50
# world.yml
- { id: FR, name: France, capital: Paris, region_id: FRA, iso: FR }
# ...
```

**Deck recipe** (`decks.yml`) — declares which banks exist and how to build each:

```yaml
- deckId: us-state-locations
  title: "US State Locations"
  subject: geography
  entities: us-states
  itemType: map_click
  map: us-states
  prompt: "Click {name}"
  answerField: region_id

- deckId: us-state-capitals
  title: "US State Capitals"
  subject: geography
  entities: us-states
  itemType: multiple_choice
  prompt: "What is the capital of {name}?"
  answerField: capital
  distractorField: capital        # wrong capitals drawn from other states

- deckId: world-flags
  title: "World Flags"
  subject: geography
  entities: world
  itemType: asset_choice
  prompt: "Whose flag is this?"
  promptImage: { kind: flag, isoField: iso }
  answerField: id
  choiceLabelField: name
  distractorField: id
```

**Generator** (`generateGeoBank.mjs`, pure):
- one item per entity; stable id `geo:{deckId}:{entityId}`.
- distractors sampled deterministically (seeded by deckId+entityId — no
  `Math.random`, so identical output every run and testable) from the same
  entity pool; N distractors + the answer, order deterministic.
- output is a full bank object; it passes `validateQuestionBank` (a test asserts
  this for every deck).
- `audience: 'generic'` (geography is not per-student assigned) so guests can
  practice — matches the "generic bank" path already in `openSession`.

**`GeographyBankSource`** (synth-on-read):
- `bankId` `geo:{deckId}` → build the bank from dataset+recipe on demand.
- integrates so `SchoolService.getBank`/`listBanks` see geography banks alongside
  file banks (the datastore consults the source for `geo:*` ids and includes
  generated summaries in `readAllBankRaws`). No generated files on disk; the
  dataset is the only edited artifact.

### 3. Frontend rendering

**`ClickableMap.jsx`**
- props: `{ map, value, verdict, expected, onPick }`.
- renders an inline SVG (imported per `map` key) whose regions carry
  `data-region-id`; a click resolves the region id → `onPick(regionId)`.
- on `verdict`: highlight the picked region (right = accent, wrong = warn) and
  always highlight `expected` (correct region) so a miss teaches location.
- inert once `verdict` exists; tap + keyboard focusable regions (a11y; no
  sliders). Guards `submittedRef` at the item layer.

**`flags.js`** — `flagFor(iso)` → bundled SVG asset (static import map). Missing
iso → a neutral placeholder (never a broken image).

**`MapClickItem.jsx` / `AssetChoiceItem.jsx`** — thin components on the shared
`{item, onSubmit, verdict}` contract, each with the `submittedRef` double-tap
guard and verdict styling mirroring `MultipleChoiceItem`.

### 4. `GeoQuizRunner.jsx` (graded + resurfacing)

Combines QuizRunner's objective grading with FlashcardRunner's requeue:

- opens a session with mode **`drill`**; renders the interactive item; POSTs
  `given`; server returns `{correct, expected}`.
- **correct** → drop from queue; **wrong** → show the correct answer (verdict),
  then requeue at the end; track `missedOnce` for the first-try count.
- ends when the queue empties → summary: `Mastered {N}/{N} · first try {k}`.
- reuses **verbatim** the hardened plumbing: single-open gate on `status ===
  'ready'`, identity pinned at open, synchronous `abandonedRef`, `410 → onExit`,
  unrecorded surfacing (per-item banner + summary). **A wrong answer with a
  failed record must still resurface** (never strand or silently drop).
- `ITEM_COMPONENTS` for the runner includes the new interactive types plus reused
  `multiple_choice` (capitals).

### 5. Navigation + placeholder icons

- **`programs.js`**: add `geography` program → opens a Geography **topic grid**.
  MVP topics enabled: *State Locations, State Capitals, World Flags*. Greyed
  "coming soon": *Country Locations, State Flags, World Capitals* — so the shape
  of the whole area is visible (same convention as `available:false` today).
- Each topic tile opens the corresponding `geo:{deckId}` bank in `GeoQuizRunner`.
- **Placeholder SVG icons** added to `home/icons/svg/`: `geography.svg`,
  `states.svg`, `capitals.svg`, `flags.svg`, `countries.svg`, with `MANIFEST.md`
  entries. Simple line-art placeholders (viewBox `0 0 24 24`, `currentColor`),
  same pattern as existing icons and the Piano kiosk home — ready to swap for
  final art later.

### 6. Assets & licensing

- US states SVG map + world flag SVGs from **public-domain / CC0** sources,
  committed to the repo. **No runtime external fetch** (offline kiosk model).
- World map SVG arrives with the countries follow-on (not MVP).

## Data flow (a `map_click` answer)

1. Topic tile → `GeoQuizRunner` opens `geo:us-state-locations`, mode `drill`.
2. `GeographyBankSource` synthesizes the bank from `us-states.yml` + recipe;
   `SchoolService` pins it to the session.
3. Runner renders `MapClickItem` → `ClickableMap map="us-states"`.
4. Learner clicks Nevada's region → `onPick('NV')` → `onSubmit('NV')`.
5. `answer(sessionId, {itemId, given:'NV'})` → server `gradeAnswer` → `{correct:
   true, expected:'NV'}`.
6. Correct → drop; wrong → map flashes the correct region, item requeues.
7. Queue empty → "Mastered 50/50".

## Testing

**Backend (unit, pure):**
- `grading`: `map_click` and `asset_choice` correct/incorrect + normalization.
- `questionBankValidation`: accept valid shapes; reject missing `answer`, empty
  `region_id`, `<2` choices, non-unique `value`s, blank label+image, answer not
  in choices.
- `distractors`: N returned, all ≠ answer, drawn from pool, deterministic for a
  fixed seed.
- `generateGeoBank`: item count = entity count; every generated bank passes
  `validateQuestionBank`; answer present in choices; ids stable/unique.
- `SchoolService`: `drill` mode accepted; grades and returns `{correct,expected}`
  like quiz; recorded as its own lane (not merged into quiz/flashcard).

**Frontend (component):**
- `MapClickItem`: pick fires `onSubmit` once (double-tap guarded); verdict
  highlights picked + expected region; inert after verdict.
- `AssetChoiceItem`: renders text choices and image choices; pick once; verdict
  styling; renders flag prompt image.
- `ClickableMap`: click on a region resolves its `data-region-id`; keyboard
  focus/activate works.
- `GeoQuizRunner`: missed item requeues and reappears; mastering all ends with
  the summary; failed record still resurfaces; identity change abandons.

**Discipline:** no skipped assertions; if setup can't be built, fail (per repo
testing policy).

## MVP scope (this plan)

- New item types `map_click`, `asset_choice` (backend grade+validate; frontend
  components).
- `ClickableMap` + US states SVG; `flags.js` + world flag SVGs.
- Dataset `us-states.yml`, `world.yml`; recipes for the three MVP decks;
  `generateGeoBank` + `distractors` + `GeographyBankSource`.
- `drill` mode in `SchoolService`.
- `GeoQuizRunner`.
- Geography program tile + topic grid + placeholder SVG icons.
- Three working decks: US State Locations, US Capitals, World Flags.

## Out of scope (follow-on content, no engine work)

- Country locations (needs world map SVG), state flags, world capitals,
  country capitals, "name this region" (`map_prompt` via `asset_choice`).
- Timed / scored leaderboards, per-student assignment of geography decks,
  spaced-repetition scheduling across sessions.

## Reusability payoff

- **Next geography quiz** = a dataset row + one recipe line in `decks.yml`.
- **Non-geography interactive quiz** (e.g. anatomy "click the femur") = reuse
  `ClickableMap` with a new SVG + dataset, or `asset_choice` with new images. No
  changes to grading, validation, runner, or session plumbing.
