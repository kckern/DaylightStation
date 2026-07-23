# Interactive Geography Quizzes — Design Spec

**Date:** 2026-07-23
**Status:** Approved for planning (revised after stern review)
**Author:** KC Kern + Claude

## Goal

Build a **reusable interactive-quiz framework** by extending the existing School
quiz stack with two new input modalities — **clickable maps** and **image/flag
assets** — and prove it with a geography content slice (US states, US capitals,
world flags). Adding the next geography quiz (or a non-geography interactive
quiz) should be *content*, not engine work.

## Context: what already exists (verified against code)

The School app has a mature, server-graded quiz framework. This design **extends
it in place** — it does not fork a parallel engine.

- **Banks** are validated data (`validateQuestionBank`) with typed items:
  `multiple_choice | short_answer | cloze | matching`. Loaded by the datastore
  (`YamlSchoolDatastore.readBankRaw` / `readAllBankRaws`), summarized for
  listing, fully validated on open.
- **Datastore is a flat file reader.** `readBankRaw` gates the id through
  `BANK_ID_RE = /^[a-z0-9][a-z0-9_-]*(\/…)*$/i` (**colons rejected**) then reads a
  YAML file; `readAllBankRaws` is a directory scan. **There is no injection seam
  in the datastore, and it must not gain one** (it is `1_adapters`; a bank
  generator is `3_applications` — the dependency may only point inward).
- **Grading** (`grading.mjs`) is pure per-type. `multiple_choice` uses **strict
  `given === item.answer`** (no normalization); `short_answer`/`cloze` normalize.
- **Sessions**: `openSession({userId, bankId, mode})` → `answer(sessionId,
  {itemId, given|selfGrade})`. `MODES = {quiz, flashcard}`. `quiz` grades
  server-side and returns `{correct, expected, attemptId}`; `flashcard` records a
  `selfGrade` and returns `{attemptId}`. On a **record failure the server throws
  before returning a grade** (500 → client sees `unrecorded`, no verdict).
- **Reporting** (`SchoolService.getResults` / `summarize`) is **mode-partitioned
  and easy to corrupt**: `getResults` bins each attempt with `lane = a.mode ===
  'flashcard' ? b.flashcard : b.quiz` (so any non-flashcard mode falls into
  **quiz**), and `summarize` counts only `mode==='quiz'` and `mode==='flashcard'`.
  The R2.5 completion gate (`materialPolicy.quizSessionPassed`) filters
  `mode==='quiz'` — so drill attempts **must not** land in the quiz lane.
- **Runners** (frontend): `QuizRunner` (one-pass, no resurfacing) and
  `FlashcardRunner` (self-graded, resurfaces). Both duplicate hardened plumbing:
  single session open gated on profile `ready`, identity pinned at open,
  synchronous `abandonedRef`, `submittedRef` double-tap guard, unrecorded
  surfacing.
- Item components share `{ item, onSubmit, verdict }`, registered in
  `ITEM_COMPONENTS` by `item.type`.
- **Home is the fixed nine-subject wall** (`home/subjects.js` `SUBJECTS`,
  including `{ id: 'history', label: 'History & Geography' }`). Unknown
  `subject` → Library shelf. Decks are **excluded from subject shelves** (they're
  interstitials). A non-content tile attaches to a shelf via `SubjectPage`'s
  `SUBJECT_PROGRAMS` (that is exactly how Typing appears on the `writing` shelf,
  opening a `section`). `programs.js` `PROGRAMS` is a *report→section routing*
  registry, **not** a home tile grid.
- Icon system: `home/icons/Icon.jsx` looks up any filename in `svg/`, `MANIFEST.md`
  lists them — adding icons is drop-a-file + a manifest row.

**Key architectural finding:** map-click and flag-pick both reduce to strict
exact-token grading. The genuinely new work is **rendering** (an SVG map, flag
images) and **content generation** — not grading logic.

## Confirmed decisions

1. **Extend the existing framework** — new item types register into the same
   `ITEM_COMPONENTS` map and share `{item, onSubmit, verdict}`.
2. **Backend dataset + generator, server-graded** — the correct answer is
   authoritative server-side (note: `GET /banks/:id` returns the whole bank, so
   this is *authoritative grading*, not answer secrecy — fine for a household
   kiosk).
3. **MVP = framework + proving slice** — US state locations (`map_click`), US
   capitals (`multiple_choice`), world flags (`asset_choice`).
4. **Drill / resurface until mastered** — objective (server-graded) **and**
   resurfacing.
5. **Bank source seam lives in `SchoolService`, not the datastore** (revised —
   see Integration seam below). `geo:` ids are dispatched at the service layer;
   the datastore never sees them.
6. **Geography is an app tile on the "History & Geography" shelf** via
   `SUBJECT_PROGRAMS.history`, opening a new `geography` section (topic grid).
7. **New `drill` session mode with a dedicated reporting lane** (graded like
   `quiz`, but its own lane in `getResults`/`summarize`; never merged into quiz).
8. **World Flags MVP = one curated ~50-flag deck** (finishable in a sitting).
   More flags become regional follow-on sub-decks.

---

## Integration seam (was the load-bearing hand-wave; now explicit)

Geography banks are **synthesized in `SchoolService`**, addressed by colon-prefixed
`geo:` ids, and **never touch the datastore or the subject/Library listing**.

- **New port** `IBankSource` (`3_applications/school/ports/`): `resolve(bankId) →
  rawBank | null` and `listDeckSummaries() → [{deckId, title, …}]`. Implemented by
  `GeographyBankSource` (`3_applications/school/sources/`), constructed from the
  dataset + recipes.
- **`SchoolService` gains an injected `bankSources` array.** `#loadBank(bankId)`
  tries each source's `resolve(bankId)` **before** `#ds.readBankRaw(bankId)`; a
  `geo:` id is served entirely by the source, so `BANK_ID_RE` (which rejects
  colons) is never consulted for it. File banks are unchanged.
- **Listing is NOT touched.** `warmBanks`/`listBanks` (the subject-wall + Library
  path) does **not** include geography banks — that avoids shelving them into the
  Library and the double-entry-point bug. The **topic grid** gets its deck list
  from a new endpoint `GET /geography/decks` (served from
  `GeographyBankSource.listDeckSummaries()`), and opens each deck by its fixed
  `geo:{deckId}` id via the normal `openSession`.
- No `2_domains`→`3_applications` or `1_adapters`→`3_applications` inversion: the
  generator is a pure `2_domains` function; the source is `3_applications`; the
  service injects the source. Dependencies point inward only.

## Component design

### 1. New item types

Added to `ITEM_TYPES`, `gradeAnswer`, `givenShapeError`, `validateQuestionBank`.
Both grade by **strict `===`** (values are machine-generated ids, never free
text).

#### `map_click`
```yaml
- id: geo:us-state-locations:NV
  type: map_click
  prompt: "Click Nevada"
  map: us-states          # which map SVG + region set
  answer: NV              # the correct region_id (matches SVG data-region-id)
```
- **given**: clicked `region_id` (non-empty string).
- **grade**: `{ correct: given === item.answer, expected: item.answer }`.
  `expected` lets the map flash the correct region on a miss.
- **validation**: `prompt`, `map`, `answer` all non-empty strings.

#### `asset_choice`
```yaml
# flag -> country name (image prompt, text choices)
- id: geo:world-flags:FR
  type: asset_choice
  prompt: "Whose flag is this?"
  promptImage: { kind: flag, iso: FR }
  choices:
    - { value: FR, label: "France" }
    - { value: DE, label: "Germany" }
    - { value: IT, label: "Italy" }
    - { value: ES, label: "Spain" }
  answer: FR
```
Also supports text prompt + image choices (`{ value, image: {kind, iso} }`) for a
future name→flag deck.
- **given**: chosen `value` (non-empty string).
- **grade**: `{ correct: given === item.answer, expected: item.answer }`.
- **validation**: `prompt` non-empty; `choices` ≥ 2, each a mapping with a
  non-empty `value`; `value`s unique; **each choice carries a non-empty `label`
  OR a valid `image`** (nothing renders blank); optional `promptImage`/`image`
  are mappings with non-empty string fields; `answer` present and among choice
  `value`s.

> No new grading algorithm. "Name this region" (`map_prompt`) is deferred and,
> when built, is `asset_choice`/`multiple_choice` with a map-region prompt — not a
> new type.

### 2. Geography dataset + generation

**Dataset** (single source of truth, small, hand-maintained):
```yaml
# us-states.yml   (no iso — state flags are out of scope; iso would be YAGNI)
- { id: NV, name: Nevada,     capital: Carson City, region_id: NV }
- { id: CA, name: California, capital: Sacramento,  region_id: CA }
# ...50
# world.yml       (iso used for the flag asset)
- { id: FR, name: France, capital: Paris, iso: FR }
# ...~50 curated for MVP
```
`region_id` **is the seed of truth** and must equal the SVG's `data-region-id`
for that state (US postal code).

**Deck recipes** (`decks.yml`) — declare which banks exist and how each is built
(`deckId`, `title`, `entities`, `itemType`, prompt template, `answerField`,
`distractorField`, optional `map`/`promptImage`). One item per entity; stable id
`geo:{deckId}:{entityId}`.

**Distractors** (`distractors.mjs`, pure, deterministic): sampled from the same
entity pool via a **named seeded PRNG** — a string hash of `deckId+entityId`
seeding `mulberry32` (no `Math.random`; identical output every run, so the
generator is testable). N distractors + the answer. **Order is deterministic in
the generated bank, but the client presentation-shuffles choice order at render**
(order is not graded) so drill doesn't teach "France is always button 2".

**`GeographyBankSource`**: `resolve('geo:{deckId}')` → build the bank from
dataset+recipe on demand; `audience: 'generic'` (geography is not per-student
assigned — this also satisfies `openSession`'s guest guard, which only blocks
guests from non-generic banks). A test asserts every generated deck passes
`validateQuestionBank`.

### 3. Frontend rendering

**`ClickableMap.jsx`** — props `{ map, value, verdict, expected, onPick }`.
- Renders an inline SVG (imported per `map` key) whose regions carry
  `data-region-id`; click → `onPick(regionId)`.
- **Preprocessing (one-time build step, documented):** the CC0 US map ships
  without ids — a small script stamps `data-region-id` (postal code) per path,
  merges multi-path states, and handles AK/HI insets. Committed as the prepared
  asset.
- **Small-state affordance (required, not polish):** RI, DE, DC, CT, NJ, MD, MA,
  NH, VT get **offset callout leader-tabs** (tappable pucks outside the outline) —
  "Click Rhode Island" must not fail for hit-target reasons on a tablet.
- On `verdict`: highlight picked region (right=accent, wrong=warn) and always
  highlight `expected` (teaches location on a miss). Inert after verdict;
  keyboard-focusable regions; no sliders.

**`flags.js`** — `flagFor(iso)` → **lazy `?url` import** of a bundled SVG from
**lipis/flag-icons (MIT** — license recorded, not "CC0"); URL imports, not raw
inline, so ~50 flags don't bloat the main bundle. Missing iso → neutral
placeholder (never a broken image).

**`MapClickItem.jsx` / `AssetChoiceItem.jsx`** — thin components on the shared
contract with the `submittedRef` double-tap guard and verdict styling mirroring
`MultipleChoiceItem`.

### 4. `GeoQuizRunner.jsx` (graded + resurfacing)

- Opens a session with mode **`drill`**; renders the interactive item; POSTs
  `given`; server returns `{correct, expected}`.
- **correct** → drop; **wrong** → show the correct answer (map flashes
  `expected`), requeue at the end; `missedOnce` tracks first-try count.
- **Unrecorded (record failure, 500):** the client gets **no grade** — so the
  rule is **requeue as not-mastered** (grade unknown; cannot flash `expected`,
  since there is none), surface the unrecorded banner, and keep the session
  going. Never strand, never silently drop, never count as mastered.
- Ends when the queue empties → `Mastered {N}/{N} · first try {k}`.
- **Shared plumbing via a new `useGradedSession` hook** (extracted from the
  QuizRunner/FlashcardRunner duplication: single-open gate on `status==='ready'`,
  identity pin, synchronous `abandonedRef`, `410 → onExit`, unrecorded state).
  Deliberately extracted rather than copied a third time.
- Runner's `ITEM_COMPONENTS` = the two new interactive types + reused
  `multiple_choice` (capitals).

### 5. Backend `drill` mode — full touched surface (was under-specified)

Adding `drill` is **not** one line. Every surface, enumerated:
- `MODES` gains `'drill'`; the `openSession` `ValidationError` string updates to
  `quiz|flashcard|drill`.
- `answer()` **grade branch**: `if (s.mode === 'quiz' || s.mode === 'drill')`
  grades and computes `{correct, expected}`.
- `answer()` **return branch**: returns `{correct, expected, attemptId}` for
  `quiz||drill`, else `{attemptId}`.
- `getResults`: add a **third lane** `drill` (`b.drill`) — dispatch by explicit
  mode, not the `flashcard ? … : quiz` ternary, so drill never falls into quiz.
  **Response shape gains `byBank[id].drill` — a consumed-API contract change**
  (`GET /users/:userId/results`); noted for any consumer.
- `summarize`: add a `drilled-geo` (or per-lane) metric from `mode==='drill'`
  attempts; do not fold into the existing quiz/flashcard counts.
- **Untouched by design:** `materialPolicy.quizSessionPassed` stays `mode==='quiz'`
  only — the R2.5 completion gate must not see drill. This is the reason drill
  gets its own lane.

### 6. Navigation + placeholder icons (rewritten against current home)

- **`SubjectPage` `SUBJECT_PROGRAMS.history`** gains a `geography` entry
  (`{ id:'geography', label:'Geography', hint:'…', section:'geography' }`) — an
  app tile on the "History & Geography" shelf, the same mechanism Typing uses.
- **New `geography` section**: needs handling in `SchoolApp.jsx`'s section switch
  and `schoolUrl` parsing (both explicitly in scope — not free). The section
  renders a **topic grid** (from `GET /geography/decks`): *State Locations, State
  Capitals, World Flags* enabled; *Country Locations, State Flags, World Capitals*
  greyed "coming soon" (recipes marked unavailable).
- Each topic tile opens its `geo:{deckId}` bank in `GeoQuizRunner`.
- **Geography banks are NOT stamped with a `subject`** (would shelve to Library +
  duplicate the entry point). They are reached only by fixed id from the grid.
- **Placeholder SVG icons** added to `home/icons/svg/`: `geography.svg`,
  `states.svg`, `capitals.svg`, `flags.svg`, `countries.svg` + `MANIFEST.md`
  rows. Line-art placeholders (viewBox `0 0 24 24`, `currentColor`), same pattern
  as existing icons / the Piano kiosk home — swap for final art later.

### 7. Assets & licensing

- US states SVG map: a **CC0/public-domain** source, preprocessed (§3) and
  committed. Record the exact source + license in the asset folder README.
- Flags: **lipis/flag-icons, MIT**; committed, lazy `?url`. Record license.
- **No runtime external fetch** (offline kiosk model). World map SVG lands with
  the countries follow-on (not MVP).

## Data flow (a `map_click` answer)

1. Topic tile → `GeoQuizRunner` opens `geo:us-state-locations`, mode `drill`.
2. `SchoolService.#loadBank` sees the `geo:` id → `GeographyBankSource.resolve`
   synthesizes the bank (datastore never consulted); pinned to the session.
3. `MapClickItem` → `ClickableMap map="us-states"`.
4. Click Nevada → `onPick('NV')` → `onSubmit('NV')`.
5. `answer(sessionId,{itemId,given:'NV'})` → `gradeAnswer` → `{correct:true,
   expected:'NV'}`; recorded in the **drill** lane.
6. Correct → drop; wrong → flash `expected`, requeue; unrecorded → requeue
   unknown.
7. Queue empty → "Mastered 50/50".

## Testing

**Backend (unit, pure):**
- `grading`: `map_click`/`asset_choice` correct/incorrect via strict `===`.
- `questionBankValidation`: accept valid shapes; reject missing `answer`, empty
  `region_id`/`map`, `<2` choices, non-unique `value`s, a choice with neither
  `label` nor `image`, answer not in choices.
- `distractors`: N returned, all ≠ answer, from the pool, **deterministic for a
  fixed seed** (asserts exact output).
- `generateGeoBank`: item count = entity count; every deck passes
  `validateQuestionBank`; answer present in choices; ids stable/unique.
- `GeographyBankSource`: `resolve('geo:…')` returns a valid bank; unknown id →
  null; `listDeckSummaries` shape.
- `SchoolService`: `drill` accepted; grades + returns `{correct,expected}`;
  `getResults` puts drill in **`drill`** lane (asserts NOT in quiz);
  `quizSessionPassed` unaffected by drill attempts.

**Frontend (component):**
- `MapClickItem`: pick fires once (double-tap guarded); verdict highlights picked
  + expected; inert after verdict; **small-state callout is tappable**.
- `AssetChoiceItem`: text choices and image choices render; pick once; flag
  prompt image renders; choice order presentation-shuffled.
- `ClickableMap`: click resolves `data-region-id`; keyboard activate works.
- `GeoQuizRunner`: missed requeues and reappears; mastering ends with summary;
  **unrecorded requeues as not-mastered** (no verdict, session continues);
  identity change abandons.
- `useGradedSession`: single-open, identity abandon, unrecorded surfacing.

**Discipline:** no skipped assertions; if setup can't be built, fail.

## MVP scope (this plan)

- Item types `map_click`, `asset_choice` (backend grade+validate strict `===`;
  frontend components).
- `ClickableMap` + preprocessed US-states SVG (with small-state callouts);
  `flags.js` + ~50 lazy flag SVGs.
- Dataset `us-states.yml`, `world.yml` (curated ~50); `decks.yml` for the three
  MVP decks; `generateGeoBank` + `distractors` (seeded mulberry32) +
  `GeographyBankSource` + `IBankSource` port.
- `SchoolService`: injected `bankSources`, `#loadBank` source-first dispatch,
  `drill` mode across all surfaces in §5, `drill` reporting lane.
- `GET /geography/decks` endpoint + `useGradedSession` hook + `GeoQuizRunner`.
- `SUBJECT_PROGRAMS.history` geography tile + `geography` section in
  `SchoolApp`/`schoolUrl` + topic grid + placeholder SVG icons.
- Three working decks: US State Locations, US Capitals, World Flags (curated 50).

## Out of scope (follow-on content, minimal/no engine work)

- Country locations (needs world map SVG), state flags, world capitals, country
  capitals, "name this region" (`map_prompt`), regional flag sub-decks.
- Timed/scored leaderboards, per-student assignment of geo decks, cross-session
  spaced repetition.

## Reusability payoff

- **Next geography quiz** = a dataset row + one recipe line in `decks.yml`.
- **Non-geography interactive quiz** (e.g. anatomy "click the femur") = reuse
  `ClickableMap` with a new SVG + dataset, or `asset_choice` with new images. No
  changes to grading, validation, runner, session plumbing, or reporting.
