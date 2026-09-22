# Korean Vocab Word Ladder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `word-ladder` mode for assigned School flashcards: weekly Korean word decks expanded from a media-mount lexicon, a per-word NEW → LEARNING → CLAIMED → KNOWN ladder with widening re-checks, recorded speaking practice, a post-completion review run, and a printed OMR quiz whose scanned misses demote words.

**Architecture:** Pure rules live in `backend/src/2_domains/school/wordLadder/` (lexicon expansion, state machine, check items, day plan, paper fold, quiz source). Adapters expand lexicon decks at the content-repository seam, persist per-learner status YAML and recordings, and resolve `media:` assets. `WordLadderStudyService` (application) freezes each study day's plan, grades checks server-side, and answers the launcher's `status()`; thin routes under `/api/v1/school/word-ladder/…` expose it to `WordLadderProgram` in the School SPA. Certify, the print renderer (Hangul font fallback) and a `korean-vocab` CLI complete the loop.

**Tech Stack:** Node ES modules (`.mjs`), Express 5, js-yaml via `#system/utils/FileIO.mjs`, pdfkit 0.18 + fontkit, React 18 (`.jsx`) with Vitest + Testing Library (happy-dom), Playwright for the live flow.

**Spec:** `docs/_wip/plans/2026-09-22-korean-vocab-word-ladder-design.md` (rev 3). Executors read the spec and this plan together; where they disagree, the **Spec discrepancies** section below is the ruling.

## Global Constraints

- Day boundary is the School study day: `studyDayForInstant(ms, { timezone })` from `backend/src/2_domains/school/studyDay.mjs` (4am→4am, household timezone). Never a bare calendar date.
- Status store: `users/{id}/apps/school/korean-vocab/status.yml`; history instants are ISO with offset (`2026-09-22T16:05:12-07:00`).
- Check gaps are exactly `[3, 7, 14, 30]` study days; CLAIMED is checkable only when `claimedDay < today`.
- Only a **scheduled** check pass promotes; review-quiz passes (`check-pass-early`) and every paper answer (`quiz-pass`) never change state or step. Any miss from any source → LEARNING, `step: 0`, `nextCheckDay: null`.
- Nothing due for the current deck ⇒ mandatory review quiz over the current deck. Never a free day.
- Mic unavailable drops only the recording step; the recording floor is the Sentence Ladder's `heard` / 1200 ms rule, shared, not copied.
- `policy.mode ∈ {fsrs, word-ladder}` lives **inside** `policy` (default `fsrs`); `word-ladder` rejects `newCardLimit`, `masteryPercent`, `minimumReviews`.
- Asset ids for word packages use the `media:` prefix: `media:language/korean-vocab/words/<id>/image.jpg`, `…/ko.mp3`. A 0-byte file is missing.
- Printed quiz: document id `<deckId>-quiz`, `archetype: quiz`, `fit.typeScale: young`, one `question` per word with `itemId: <wordId>`, answer + 3 authored decoys, alternating Korean→English / English→Korean by index, text only. Instruction line, verbatim: `Not sure of a word? Open Korean words on the Portal and review the cards, then come back.`
- Paper never promotes; the paper fold is a pull at plan build, idempotent by attempt id.
- The review run (rev 3): every current-deck word in deck order, flip only, no marks, no recording, no state/step change, each card viewed logs `{ event: review, at, day }`; credit unaffected.
- Frontend diagnostics use the logging framework (`frontend/src/lib/logging/`), never raw `console.*`. New code ships with lifecycle / API / error logging.
- Docs: no instance-specific data in committed docs (learner ids appear as `{learnerId}`); new docs date-prefixed in `_wip/`, reference docs updated in place.
- Data volume writes go through `sudo docker exec daylight-station sh -c '…'` with base64-carried bytes; never `sed -i`, never `rm`. **Deploys and every write to the live data/media volume are controller-only** (Task 17). Implementers never deploy.
- Test runner: `npx vitest run <path>` from the worktree root (paths are substring filters; pass full paths). Regression gate: `npm run test:unit:vitest`.

## Spec discrepancies (rulings — plan against the real code)

1. **`media:` root.** Spec: "lexicon root is `ConfigService.getMediaDir()`", yet the package lives at `media/school/language/korean-vocab/` and refs read `media:language/korean-vocab/…`. Ruling: `media:` resolves against `<getMediaDir()>/school`.
2. **Plan rebuild is not stable.** Rebuilding from the mutated store mid-day would drop passed checks and then fire a review quiz the same day. Ruling: the first `open` of a study day **freezes** the plan in `status.days[day]` (`{deckId, checks:[{wordId,direction}], study:[wordId], reviewQuiz:[{wordId,direction}]}`); progress, credit and past-day replay read the frozen plan plus that day's history. `status.yml` therefore also carries `schema`, `days`, `sessions`, `lastFoldedDay`. Every history event also carries `phase` (`check|review|paper`) where it is a check.
3. **Attempt shards are keyed by the UTC date of `at`** (`YamlSchoolDatastore.appendAttempt` uses `String(attempt.at).slice(0, 10)`), not the study day; an evening scan lands on tomorrow's UTC shard. Ruling: fold reads `[lastFoldedDay − 2, today + 1]` (first fold: `today − 60`), deduped by `paperAttemptsFolded`.
4. **`replayable` is a launcher-level getter**, not per enrollment. Ruling: `FlashcardProgramLauncher.replayable` becomes `true`; its FSRS branch answers `UNKNOWABLE_STATUS` for any `day`, preserving today's `no_history` behaviour.
5. **Certify "fails on 0-byte placeholders" vs "placeholders are allowed".** Gate mode aborts the whole corpus on any error, so seeding would block every other certification until media exists. Ruling: 0-byte `media:` files are **warnings** by default and **errors** under a new `--strict-media`; an absent `media:` file is always an error; a 0-byte content-root asset is always missing (error). Certify gains `--media-dir` (default `$DAYLIGHT_BASE_PATH/media`, else `/usr/src/app/media`).
6. **Quiz source path.** Spec says `catalog/documents/…`; the real print source root is `data/content/school/learning-catalog/documents/` (`schoolLifecycle.mjs:928`, `cli/school/docs.mjs --source-root`); published artifacts land under `data/household/school/artifacts/print/`.
7. **`variety` is not a document field.** It is a render-request parameter (`variety=omr`). The generator emits none; the sheet is rendered with the OMR variety.
8. **Quiz "instruction line"** is `header.instructions` (`documentV2.mjs:220`, drawn under the title by `DocumentPdfRenderer.mjs:803`). It is drawn with `lineBreak: false`, so a render test asserts the line fits the young-scale content width.
9. **"The agenda tile never closes."** `planDailyAgenda` drops a done program from `next` by design (credit). The existing launcher contract `reopenable: true` (`findReopenableProgramEntry`, used by `ResolveAccessCode` and `ResolveSubjectNext`) keeps a served subject's button. Ruling: the word-ladder status returns `reopenable: true`; `agenda.mjs` is unchanged; `WordLadderProgram` lands on the review run when the plan is already done.
10. **"Open Korean on the Portal"** — flashcard plan entries are titled `enrollment.title ?? 'Flashcards'` (`assignedProgramPlan.mjs:103`) and the validator drops `title`. Ruling: `validateFlashcardEnrollment` keeps an optional `title`; the seeded enrollment uses `title: Korean words`. The Sentence Ladder tile is also titled "Korean", so the sheet line names the seeded tile: "Open Korean words on the Portal" (spec rev 3 amended to match).
11. **Two learners** hold a `glossika-korean` sentence-ladder enrollment; the spec names one. Ruling: the one with the 12-sentence lessons and `dictationMode: copy` (the younger learner; young type scale, beginner classroom list). Real ids are kept out of this public repo (the PII pre-commit guard blocks them); the controller receives them out of band and **confirms the learner with the user before Task 17 Part D**.
12. **`data/content/school/learning-catalog/` does not exist at all** on the live volume (not only `flashcard-decks/`). Seeding creates it.
13. **Seeding before deploy is unsafe**: old code would list a card-less deck at `GET /flashcards`. Every live install (lexicon, deck, placeholders, quiz, enrollment, README) is post-deploy and controller-run; the enrollment goes through `school ops assign` (the real `SetAssignments` path), never a hand-edited learner YAML.
14. **Phrase pronunciations** are not in the spec; they are authored below (Revised Romanization). The lexicon file is `{schema: school.word-lexicon/v1, entries: [...]}`.
15. **`en.mp3`** is seeded but no card block references it (spec card format has no English audio); certify therefore does not check it.
16. **Quiz `rev`** is a 9-hex content hash, so a scanned attempt's `bankId` is `language/korean/week-01-classroom-quiz@<9hex>`; the fold matches the prefix `<deckId>-quiz@`.
17. **`--deck week-01-classroom`** (spec CLI example) is accepted as a slug and resolved to `language/korean/week-01-classroom`; a full id also works.

## File structure

| Path | Responsibility |
|---|---|
| `backend/src/2_domains/school/wordLadder/lexicon.mjs` | Lexicon validation, `media:` refs, deck → cards expansion |
| `backend/src/2_domains/school/wordLadder/wordLadder.mjs` | Status shape, per-word transitions, gaps, review-view event |
| `backend/src/2_domains/school/wordLadder/checkItem.mjs` | Deterministic hash/shuffle, check direction + media fallback, choices |
| `backend/src/2_domains/school/wordLadder/planDay.mjs` | Day plan (checks → study → review quiz), day progress, labels |
| `backend/src/2_domains/school/wordLadder/foldPaperAttempts.mjs` | Scanned paper attempts → quiz-pass / quiz-miss |
| `backend/src/2_domains/school/wordLadder/quizSource.mjs` | Deck + lexicon → `school.document-source/v1` quiz |
| `backend/src/2_domains/school/wordLadder/index.mjs` | Barrel |
| `backend/src/2_domains/school/flashcards/flashcardEnrollment.mjs` | `policy.mode`, optional `title` |
| `backend/src/1_adapters/school/catalog/YamlLexiconRepository.mjs` | Reads + validates `media:` lexicons |
| `backend/src/1_adapters/school/catalog/LexiconDeckLoader.mjs` | Wraps the content repository; expands lexicon decks on get/list |
| `backend/src/1_adapters/school/catalog/SchoolFlashcardAssetRepository.mjs` | `media:` root, 0-byte = missing, `exists()` |
| `backend/src/1_adapters/school/wordLadder/YamlWordLadderStore.mjs` | `status.yml` read/update |
| `backend/src/1_adapters/school/wordLadder/FilesystemWordLadderRecordings.mjs` | Recording files under `media/school/recordings/korean-vocab/` |
| `backend/src/3_applications/school/WordLadderStudyService.mjs` | open / plan / check / record / mark / review-view / fold / dayStatus |
| `backend/src/3_applications/school/FlashcardProgramLauncher.mjs` | Word-ladder status branch, `replayable`, `reopenable` |
| `backend/src/4_api/v1/routers/school.wordLadder.mjs` | `/word-ladder/…` routes |
| `backend/src/1_rendering/school/documents/measure.mjs` (+ themes, renderer) | Hangul run → Noto Sans KR |
| `backend/assets/fonts/noto-sans-kr/` | `NotoSansKR-Regular.otf`, `OFL.txt` |
| `cli/school/certify.mjs` | Lexicon expansion, `media:` root, 0-byte, `--strict-media`, `--media-dir` |
| `cli/school/koreanVocab.mjs` | `korean-vocab quiz`, `korean-vocab enroll-plan` |
| `frontend/src/modules/School/Programs/shared/speechFloor.js` | Shared take verdict |
| `frontend/src/modules/School/Programs/Flashcards/WordLadder/*` | Program, cards, API client, audio, log facade, SCSS |
| `content/seeds/school/korean-vocab/*` + `scripts/school/seed-korean-vocab.sh` | Seed package + idempotent installer |
| `tests/live/flow/school/word-ladder.runtime.test.mjs` | Live Playwright day |

---

### Task 1: Lexicon domain

**Files:**
- Create: `backend/src/2_domains/school/wordLadder/lexicon.mjs`
- Create: `backend/src/2_domains/school/wordLadder/index.mjs`
- Test: `backend/src/2_domains/school/wordLadder/lexicon.test.mjs`

**Interfaces:**
- Consumes: `validateFlashcardDeck(raw, {path})` from `#domains/school/flashcards/index.mjs` (test only).
- Produces:
  - `LEXICON_SCHEMA = 'school.word-lexicon/v1'`, `WORD_KINDS = ['word','phrase']`
  - `validateLexicon(raw) → { errors: string[], entries?: Map<string, {id, kind, korean, english, pronunciation: string|null, decoys: {korean: string[], english: string[]}}> }`
  - `parseMediaRef(ref) → { ok: true, path: string } | { ok: false, error: string }`
  - `wordPackageDir(lexiconRef) → string|null` (`'language/korean-vocab'`)
  - `wordAssetIds(lexiconRef, wordId) → { image, audio, englishAudio }` (`media:` ids)
  - `isLexiconDeck(raw) → boolean`
  - `expandLexiconDeck(raw, entries) → { errors: string[], deck?: object }` (deck keeps `lexicon` and `words`, gains `cards`)

- [ ] **Step 1: Link node_modules into the worktree (one-time setup) and take a baseline**

```bash
M=/opt/Code/DaylightStation
W=/opt/Code/DaylightStation/.claude/worktrees/korean-word-ladder
ln -sfn $M/node_modules          $W/node_modules
ln -sfn $M/frontend/node_modules $W/frontend/node_modules
ln -sfn $M/backend/node_modules  $W/backend/node_modules
cd $W && npx vitest run backend/src/2_domains/school/flashcards/flashcards.test.mjs
```
Expected: PASS (proves the worktree resolves packages before any change).

- [ ] **Step 2: Write the failing test**

```js
// backend/src/2_domains/school/wordLadder/lexicon.test.mjs
import { describe, expect, it } from 'vitest';
import { validateFlashcardDeck } from '#domains/school/flashcards/index.mjs';
import {
  LEXICON_SCHEMA, expandLexiconDeck, isLexiconDeck, parseMediaRef, validateLexicon, wordAssetIds, wordPackageDir,
} from './index.mjs';

const REF = 'media:language/korean-vocab/lexicon.yml';
const entry = (over = {}) => ({
  id: 'gawi', kind: 'word', korean: '가위', english: 'Scissors', pronunciation: null,
  decoys: { korean: ['가지', '바위', '가방'], english: ['Knife', 'Tape', 'Ruler'] }, ...over,
});
const phrase = (over = {}) => entry({
  id: 'annyeong', kind: 'phrase', korean: '안녕', english: 'Hi (casual)', pronunciation: 'an-nyeong',
  decoys: { korean: ['안녕하세요', '안녕히계세요', '안경'], english: ['Hello (polite)', 'Thank you', 'Excuse me'] }, ...over,
});
const hello = () => entry({
  id: 'annyeong-haseyo', kind: 'phrase', korean: '안녕하세요', english: 'Hello (polite)', pronunciation: 'an-nyeong-ha-se-yo',
  decoys: { korean: ['안녕히계세요', '안녕', '안녕히가세요'], english: ['Hi (casual)', 'Goodbye', 'Thank you'] },
});
const lexicon = (entries) => ({ schema: LEXICON_SCHEMA, entries });

describe('validateLexicon', () => {
  it('accepts a well-formed lexicon and indexes it by id', () => {
    const { errors, entries } = validateLexicon(lexicon([entry(), phrase(), hello()]));
    expect(errors).toEqual([]);
    expect([...entries.keys()]).toEqual(['gawi', 'annyeong', 'annyeong-haseyo']);
    expect(entries.get('annyeong').pronunciation).toBe('an-nyeong');
  });
  it('requires a pronunciation for every phrase', () => {
    expect(validateLexicon(lexicon([phrase({ pronunciation: null })])).errors.join('\n')).toMatch(/pronunciation: is required for a phrase/);
  });
  it('needs at least three decoys on each side, none equal to the answer', () => {
    const few = validateLexicon(lexicon([entry({ decoys: { korean: ['가지'], english: ['Knife', 'Tape', 'Ruler'] } })]));
    expect(few.errors.join('\n')).toMatch(/decoys.korean: needs at least 3/);
    const self = validateLexicon(lexicon([entry({ decoys: { korean: ['가지', '바위', '가방'], english: ['scissors', 'Tape', 'Ruler'] } })]));
    expect(self.errors.join('\n')).toMatch(/must not contain the answer 'Scissors'/);
  });
  it('rejects a decoy that is an in-set entry of the other kind', () => {
    const bad = phrase({ decoys: { korean: ['가위', '안녕히계세요', '안경'], english: ['Hello (polite)', 'Thank you', 'Excuse me'] } });
    expect(validateLexicon(lexicon([entry(), bad])).errors.join('\n'))
      .toMatch(/decoy '가위' is the word 'gawi' — decoys must be the same kind/);
  });
  it('rejects duplicate ids and a wrong schema', () => {
    const { errors } = validateLexicon({ schema: 'x', entries: [entry(), entry()] });
    expect(errors.join('\n')).toMatch(/schema must be school.word-lexicon\/v1/);
    expect(errors.join('\n')).toMatch(/duplicates 'gawi'/);
  });
});

describe('media refs', () => {
  it('parses media: references and refuses traversal', () => {
    expect(parseMediaRef(REF)).toEqual({ ok: true, path: 'language/korean-vocab/lexicon.yml' });
    expect(parseMediaRef('media:../etc/passwd').ok).toBe(false);
    expect(parseMediaRef('media:/abs').ok).toBe(false);
    expect(parseMediaRef('language/x.yml').ok).toBe(false);
  });
  it('derives the word package directory and per-word asset ids', () => {
    expect(wordPackageDir(REF)).toBe('language/korean-vocab');
    expect(wordPackageDir('media:language/korean-vocab/other.yml')).toBeNull();
    expect(wordAssetIds(REF, 'gawi')).toEqual({
      image: 'media:language/korean-vocab/words/gawi/image.jpg',
      audio: 'media:language/korean-vocab/words/gawi/ko.mp3',
      englishAudio: 'media:language/korean-vocab/words/gawi/en.mp3',
    });
  });
});

describe('expandLexiconDeck', () => {
  const { entries } = validateLexicon(lexicon([entry(), phrase(), hello()]));
  const raw = {
    schema: 'school.flashcard-deck/v1', id: 'language/korean/week-01-classroom', title: 'Korean — Classroom',
    revision: 1, lexicon: REF, words: ['annyeong', 'gawi'],
  };
  it('recognises a lexicon deck', () => {
    expect(isLexiconDeck(raw)).toBe(true);
    expect(isLexiconDeck({ cards: [] })).toBe(false);
  });
  it('turns words into ordinary cards that pass validateFlashcardDeck', () => {
    const { errors, deck } = expandLexiconDeck(raw, entries);
    expect(errors).toEqual([]);
    expect(deck.words).toEqual(['annyeong', 'gawi']);
    expect(deck.cards.map((card) => card.cardId)).toEqual(['annyeong', 'gawi']);
    expect(deck.cards[1].front.blocks).toEqual([
      { type: 'image', assetId: 'media:language/korean-vocab/words/gawi/image.jpg', alt: 'Scissors' },
      { type: 'text', text: '가위' },
      { type: 'audio', assetId: 'media:language/korean-vocab/words/gawi/ko.mp3', transcript: '가위' },
    ]);
    expect(deck.cards[1].back.blocks).toEqual([{ type: 'text', text: 'Scissors' }]);
    expect(deck.cards[0].back.blocks).toEqual([{ type: 'text', text: 'Hi (casual)' }, { type: 'text', text: 'an-nyeong' }]);
    expect(validateFlashcardDeck(deck).errors).toEqual([]);
  });
  it('refuses unknown or duplicate words and authored cards', () => {
    expect(expandLexiconDeck({ ...raw, words: ['nope'] }, entries).errors.join('\n')).toMatch(/'nope' is not in the lexicon/);
    expect(expandLexiconDeck({ ...raw, words: ['gawi', 'gawi'] }, entries).errors.join('\n')).toMatch(/duplicates 'gawi'/);
    expect(expandLexiconDeck({ ...raw, cards: [] }, entries).errors.join('\n')).toMatch(/must not also author cards/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run backend/src/2_domains/school/wordLadder/lexicon.test.mjs`
Expected: FAIL — `Failed to resolve import "./index.mjs"`.

- [ ] **Step 4: Write the implementation**

```js
// backend/src/2_domains/school/wordLadder/lexicon.mjs
/**
 * Word lexicon for the word ladder (Korean vocab design, "Data model"). Pure.
 *
 * A lexicon is authored once per word package on the media mount and names
 * every word's Korean, English, kind and quiz decoys. A weekly deck lists word
 * ids only; `expandLexiconDeck` turns it into ordinary flashcard cards BEFORE
 * `validateFlashcardDeck` sees it, so every existing deck consumer works on it.
 */
export const LEXICON_SCHEMA = 'school.word-lexicon/v1';
export const WORD_KINDS = Object.freeze(['word', 'phrase']);

const WORD_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MEDIA_PREFIX = 'media:';
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const fold = (value) => String(value).trim().toLocaleLowerCase();

/** `media:<relative path>` → the relative path, refusing anything that could leave the root. */
export function parseMediaRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith(MEDIA_PREFIX)) return { ok: false, error: 'must start with media:' };
  const relative = ref.slice(MEDIA_PREFIX.length);
  if (!relative || relative.includes('\0') || relative.startsWith('/') || relative.includes('\\')) {
    return { ok: false, error: 'must be a relative path' };
  }
  if (relative.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) {
    return { ok: false, error: 'must not contain empty, . or .. segments' };
  }
  return { ok: true, path: relative };
}

/** The package directory a `media:<dir>/lexicon.yml` reference names, or null. */
export function wordPackageDir(lexiconRef) {
  const parsed = parseMediaRef(lexiconRef);
  if (!parsed.ok || !parsed.path.endsWith('/lexicon.yml')) return null;
  return parsed.path.slice(0, -'/lexicon.yml'.length);
}

/** Media is found by convention, never listed in the lexicon. */
export function wordAssetIds(lexiconRef, wordId) {
  const dir = wordPackageDir(lexiconRef);
  const base = `${MEDIA_PREFIX}${dir}/words/${wordId}`;
  return { image: `${base}/image.jpg`, audio: `${base}/ko.mp3`, englishAudio: `${base}/en.mp3` };
}

export function validateLexicon(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: ['lexicon must be a mapping'] };
  if (raw.schema !== LEXICON_SCHEMA) errors.push(`schema must be ${LEXICON_SCHEMA}`);
  if (!Array.isArray(raw.entries) || raw.entries.length === 0) {
    errors.push('entries must be a non-empty list');
    return { errors };
  }
  const entries = new Map();
  raw.entries.forEach((entry, index) => {
    const at = `entries[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { errors.push(`${at}: must be a mapping`); return; }
    if (!WORD_ID.test(entry.id ?? '')) { errors.push(`${at}.id: must be a lowercase slug`); return; }
    if (entries.has(entry.id)) { errors.push(`${at}.id: duplicates '${entry.id}'`); return; }
    if (!WORD_KINDS.includes(entry.kind)) errors.push(`${at}.kind: must be word or phrase`);
    if (!text(entry.korean)) errors.push(`${at}.korean: is required`);
    if (!text(entry.english)) errors.push(`${at}.english: is required`);
    if (entry.kind === 'phrase' && !text(entry.pronunciation)) errors.push(`${at}.pronunciation: is required for a phrase`);
    else if (entry.pronunciation != null && !text(entry.pronunciation)) errors.push(`${at}.pronunciation: must be text or null`);
    const decoys = {};
    for (const side of ['korean', 'english']) {
      const list = entry.decoys?.[side];
      if (!Array.isArray(list) || list.length < 3 || !list.every(text)) {
        errors.push(`${at}.decoys.${side}: needs at least 3 non-empty entries`);
        decoys[side] = [];
        continue;
      }
      if (new Set(list.map(fold)).size !== list.length) errors.push(`${at}.decoys.${side}: must be unique`);
      if (text(entry[side]) && list.some((decoy) => fold(decoy) === fold(entry[side]))) {
        errors.push(`${at}.decoys.${side}: must not contain the answer '${entry[side]}'`);
      }
      decoys[side] = list.map((decoy) => decoy.trim());
    }
    entries.set(entry.id, {
      id: entry.id,
      kind: entry.kind,
      korean: String(entry.korean ?? '').trim(),
      english: String(entry.english ?? '').trim(),
      pronunciation: text(entry.pronunciation) ? entry.pronunciation.trim() : null,
      decoys,
    });
  });
  // "Phrase decoys only from phrases": a decoy that IS another in-set entry
  // must be of the same kind, so a check never pits a phrase against a word.
  const owners = { korean: new Map(), english: new Map() };
  for (const candidate of entries.values()) {
    owners.korean.set(fold(candidate.korean), candidate);
    owners.english.set(fold(candidate.english), candidate);
  }
  for (const candidate of entries.values()) {
    for (const side of ['korean', 'english']) {
      for (const decoy of candidate.decoys[side]) {
        const other = owners[side].get(fold(decoy));
        if (other && other.id !== candidate.id && other.kind !== candidate.kind) {
          errors.push(`entry '${candidate.id}': decoy '${decoy}' is the ${other.kind} '${other.id}' — decoys must be the same kind`);
        }
      }
    }
  }
  if (errors.length) return { errors };
  return { errors: [], entries };
}

export function isLexiconDeck(raw) {
  return Boolean(raw) && typeof raw === 'object' && Array.isArray(raw.words) && typeof raw.lexicon === 'string';
}

/** A lexicon deck → the same deck with ordinary `cards`. `words`/`lexicon` are kept. */
export function expandLexiconDeck(raw, entries) {
  if (!isLexiconDeck(raw)) return { errors: ['deck is not a lexicon deck (needs lexicon and words)'] };
  const errors = [];
  if (raw.cards !== undefined) errors.push('a lexicon deck must not also author cards');
  if (!wordPackageDir(raw.lexicon)) errors.push(`lexicon '${raw.lexicon}' must be a media:<dir>/lexicon.yml reference`);
  if (raw.words.length === 0) errors.push('words must not be empty');
  const seen = new Set();
  raw.words.forEach((wordId, index) => {
    if (seen.has(wordId)) errors.push(`words[${index}]: duplicates '${wordId}'`);
    seen.add(wordId);
    if (!entries?.has?.(wordId)) errors.push(`words[${index}]: '${wordId}' is not in the lexicon`);
  });
  if (errors.length) return { errors };
  const cards = raw.words.map((wordId) => {
    const entry = entries.get(wordId);
    const assets = wordAssetIds(raw.lexicon, wordId);
    return {
      cardId: wordId,
      front: {
        blocks: [
          { type: 'image', assetId: assets.image, alt: entry.english },
          { type: 'text', text: entry.korean },
          { type: 'audio', assetId: assets.audio, transcript: entry.korean },
        ],
      },
      back: {
        blocks: [
          { type: 'text', text: entry.english },
          ...(entry.kind === 'phrase' ? [{ type: 'text', text: entry.pronunciation }] : []),
        ],
      },
    };
  });
  return { errors: [], deck: { ...raw, cards } };
}
```

```js
// backend/src/2_domains/school/wordLadder/index.mjs
export {
  LEXICON_SCHEMA, WORD_KINDS, validateLexicon, parseMediaRef, wordPackageDir, wordAssetIds,
  isLexiconDeck, expandLexiconDeck,
} from './lexicon.mjs';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run backend/src/2_domains/school/wordLadder/lexicon.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/2_domains/school/wordLadder/lexicon.mjs backend/src/2_domains/school/wordLadder/index.mjs backend/src/2_domains/school/wordLadder/lexicon.test.mjs
git commit -m "feat(school): word-ladder lexicon validation and deck expansion" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Word state machine and check items

**Files:**
- Create: `backend/src/2_domains/school/wordLadder/wordLadder.mjs`
- Create: `backend/src/2_domains/school/wordLadder/checkItem.mjs`
- Modify: `backend/src/2_domains/school/wordLadder/index.mjs`
- Test: `backend/src/2_domains/school/wordLadder/wordLadder.test.mjs`, `backend/src/2_domains/school/wordLadder/checkItem.test.mjs`

**Interfaces:**
- Consumes: `addDays(day, n)` from `backend/src/2_domains/school/termVerdict.mjs`; `ValidationError` from `#domains/core/errors/index.mjs`; lexicon entry shape from Task 1.
- Produces (wordLadder.mjs):
  - `STATUS_SCHEMA = 'school.word-ladder-status/v1'`, `CHECK_GAPS = [3,7,14,30]`, `MAX_STEP = 3`, `CHECK_PHASES = ['check','review','paper']`
  - `emptyStatus() → {schema, words:{}, paperAttemptsFolded:[], lastFoldedDay:null, days:{}, sessions:{}}`
  - `emptyWord() → {state:'new', step:0, claimedDay:null, nextCheckDay:null, history:[]}`
  - `readWord(status, wordId) → word` (clone or empty)
  - `isScheduledCheck(word, today) → boolean`
  - `applyStudy(word, {at, day, recording: 'taken'|'unavailable', reason?, take?}) → word`
  - `applyMark(word, {at, day, mark: 'know'|'learning'}) → word`
  - `applyCheck(word, {at, day, correct, phase, direction?, attemptId?}) → word`
  - `applyReviewView(word, {at, day}) → word`
- Produces (checkItem.mjs):
  - `CHECK_DIRECTIONS = ['picture_to_korean','audio_to_korean','korean_to_english']`
  - `hashString(value) → uint32`, `seededShuffle(items, seed) → items[]`
  - `checkDirection(wordId, day) → direction`, `resolveDirection(wordId, day, media={image?, audio?}) → direction`
  - `answerFor(entry, direction) → string`, `buildChoices(entry, direction, day) → {answer, choices: string[4]}`

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/2_domains/school/wordLadder/wordLadder.test.mjs
import { describe, expect, it } from 'vitest';
import {
  CHECK_GAPS, applyCheck, applyMark, applyReviewView, applyStudy, emptyStatus, emptyWord, isScheduledCheck, readWord,
} from './index.mjs';

const at = (day, time = '16:00:00') => `${day}T${time}-07:00`;
const claimedOn = (day) => applyMark(applyStudy(emptyWord(), { at: at(day), day, recording: 'taken' }), { at: at(day), day, mark: 'know' });

describe('word ladder transitions', () => {
  it('studying a NEW word makes it LEARNING and records the recording outcome', () => {
    const word = applyStudy(emptyWord(), { at: at('2026-09-22'), day: '2026-09-22', recording: 'unavailable', reason: 'no-device' });
    expect(word.state).toBe('learning');
    expect(word.history.at(-1)).toEqual({ at: at('2026-09-22'), day: '2026-09-22', event: 'study', recording: 'unavailable', reason: 'no-device' });
  });
  it('"I know it" claims the word for today; "Still learning" keeps it learning', () => {
    const claimed = claimedOn('2026-09-22');
    expect(claimed).toMatchObject({ state: 'claimed', claimedDay: '2026-09-22', step: 0, nextCheckDay: null });
    expect(claimed.history.at(-1).event).toBe('claim');
    const learning = applyMark(claimed, { at: at('2026-09-22'), day: '2026-09-22', mark: 'learning' });
    expect(learning).toMatchObject({ state: 'learning', claimedDay: null });
    expect(learning.history.at(-1).event).toBe('still-learning');
  });
  it('CLAIMED is checkable only on a LATER study day', () => {
    const claimed = claimedOn('2026-09-22');
    expect(isScheduledCheck(claimed, '2026-09-22')).toBe(false);
    expect(isScheduledCheck(claimed, '2026-09-23')).toBe(true);
  });
  it('a scheduled pass on CLAIMED becomes KNOWN at step 0, next check +3', () => {
    const known = applyCheck(claimedOn('2026-09-22'), { at: at('2026-09-23'), day: '2026-09-23', correct: true, phase: 'check', direction: 'korean_to_english' });
    expect(known).toMatchObject({ state: 'known', step: 0, nextCheckDay: '2026-09-26', claimedDay: null });
    expect(known.history.at(-1)).toMatchObject({ event: 'check-pass', phase: 'check', direction: 'korean_to_english' });
  });
  it('scheduled KNOWN passes widen through 3 / 7 / 14 / 30 and cap at step 3', () => {
    let word = applyCheck(claimedOn('2026-09-01'), { at: at('2026-09-02'), day: '2026-09-02', correct: true, phase: 'check' });
    const days = [];
    for (let i = 0; i < 4; i += 1) {
      const day = word.nextCheckDay;
      word = applyCheck(word, { at: at(day), day, correct: true, phase: 'check' });
      days.push([word.step, word.nextCheckDay]);
    }
    expect(CHECK_GAPS).toEqual([3, 7, 14, 30]);
    expect(days).toEqual([[1, '2026-09-12'], [2, '2026-09-26'], [3, '2026-10-26'], [3, '2026-11-25']]);
  });
  it('an early pass (review quiz or a not-yet-due check) changes nothing but the log', () => {
    const known = applyCheck(claimedOn('2026-09-22'), { at: at('2026-09-23'), day: '2026-09-23', correct: true, phase: 'check' });
    const early = applyCheck(known, { at: at('2026-09-24'), day: '2026-09-24', correct: true, phase: 'review' });
    expect({ ...early, history: undefined }).toEqual({ ...known, history: undefined });
    expect(early.history.at(-1).event).toBe('check-pass-early');
  });
  it('paper never promotes: a quiz pass is logged only', () => {
    const claimed = claimedOn('2026-09-22');
    const passed = applyCheck(claimed, { at: at('2026-09-26'), day: '2026-09-26', correct: true, phase: 'paper', attemptId: 'att_1' });
    expect(passed.state).toBe('claimed');
    expect(passed.history.at(-1)).toMatchObject({ event: 'quiz-pass', attemptId: 'att_1', phase: 'paper' });
  });
  it('any miss from any source resets to LEARNING step 0 with no next check', () => {
    const known = applyCheck(claimedOn('2026-09-01'), { at: at('2026-09-02'), day: '2026-09-02', correct: true, phase: 'check' });
    for (const [phase, event] of [['check', 'check-miss'], ['review', 'check-miss'], ['paper', 'quiz-miss']]) {
      const missed = applyCheck(known, { at: at('2026-09-05'), day: '2026-09-05', correct: false, phase });
      expect(missed).toMatchObject({ state: 'learning', step: 0, nextCheckDay: null, claimedDay: null });
      expect(missed.history.at(-1).event).toBe(event);
    }
  });
  it('a review-run view is logged and changes no state', () => {
    const known = applyCheck(claimedOn('2026-09-22'), { at: at('2026-09-23'), day: '2026-09-23', correct: true, phase: 'check' });
    const viewed = applyReviewView(known, { at: at('2026-09-23', '17:00:00'), day: '2026-09-23' });
    expect({ ...viewed, history: undefined }).toEqual({ ...known, history: undefined });
    expect(viewed.history.at(-1)).toEqual({ at: at('2026-09-23', '17:00:00'), day: '2026-09-23', event: 'review' });
  });
  it('rejects an unknown mark or phase', () => {
    expect(() => applyMark(emptyWord(), { at: at('2026-09-22'), day: '2026-09-22', mark: 'maybe' })).toThrow(/unknown mark/);
    expect(() => applyCheck(emptyWord(), { at: at('2026-09-22'), day: '2026-09-22', correct: true, phase: 'x' })).toThrow(/unknown check phase/);
  });
  it('reads a missing word as NEW without mutating the status', () => {
    const status = emptyStatus();
    expect(readWord(status, 'gawi')).toEqual(emptyWord());
    expect(status.words).toEqual({});
  });
});
```

```js
// backend/src/2_domains/school/wordLadder/checkItem.test.mjs
import { describe, expect, it } from 'vitest';
import {
  CHECK_DIRECTIONS, answerFor, buildChoices, checkDirection, resolveDirection, seededShuffle,
} from './index.mjs';

const gawi = {
  id: 'gawi', kind: 'word', korean: '가위', english: 'Scissors', pronunciation: null,
  decoys: { korean: ['가지', '바위', '가방', '가수'], english: ['Knife', 'Tape', 'Ruler'] },
};

describe('check items', () => {
  it('picks a direction deterministically from word + study day, rotating across days', () => {
    expect(checkDirection('gawi', '2026-09-22')).toBe(checkDirection('gawi', '2026-09-22'));
    const seen = new Set();
    for (let d = 1; d <= 30; d += 1) seen.add(checkDirection('gawi', `2026-10-${String(d).padStart(2, '0')}`));
    expect([...seen].sort()).toEqual([...CHECK_DIRECTIONS].sort());
  });
  it('falls back to Korean→English when the direction needs missing media', () => {
    for (let d = 1; d <= 30; d += 1) {
      const day = `2026-10-${String(d).padStart(2, '0')}`;
      expect(resolveDirection('gawi', day, { image: false, audio: false })).toBe('korean_to_english');
      expect(resolveDirection('gawi', day, { image: true, audio: true })).toBe(checkDirection('gawi', day));
    }
  });
  it('builds four unique choices: the answer plus three authored decoys of the right side', () => {
    for (const direction of CHECK_DIRECTIONS) {
      const { answer, choices } = buildChoices(gawi, direction, '2026-09-22');
      expect(answer).toBe(answerFor(gawi, direction));
      expect(choices).toHaveLength(4);
      expect(new Set(choices).size).toBe(4);
      expect(choices).toContain(answer);
      const pool = direction === 'korean_to_english' ? gawi.decoys.english : gawi.decoys.korean;
      choices.filter((choice) => choice !== answer).forEach((decoy) => expect(pool).toContain(decoy));
    }
  });
  it('is stable for a reload of the same study day', () => {
    expect(buildChoices(gawi, 'picture_to_korean', '2026-09-22')).toEqual(buildChoices(gawi, 'picture_to_korean', '2026-09-22'));
  });
  it('shuffles deterministically and never loses items', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(seededShuffle(items, 42)).toEqual(seededShuffle(items, 42));
    expect([...seededShuffle(items, 42)].sort()).toEqual(items);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('refuses an unknown direction', () => {
    expect(() => buildChoices(gawi, 'sideways', '2026-09-22')).toThrow(/unknown check direction/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run backend/src/2_domains/school/wordLadder/wordLadder.test.mjs backend/src/2_domains/school/wordLadder/checkItem.test.mjs`
Expected: FAIL — `emptyWord is not a function` / `checkDirection is not a function` (not exported yet).

- [ ] **Step 3: Write the implementation**

```js
// backend/src/2_domains/school/wordLadder/wordLadder.mjs
/**
 * Per-word status ladder (design "State machine"). Pure: every function takes
 * the study day and instant from its caller and returns a NEW word record.
 *
 *   NEW ──seen──► LEARNING ──"I know it"──► CLAIMED ──scheduled pass──► KNOWN
 *
 * Only a SCHEDULED check (CLAIMED from an earlier day, or KNOWN due today)
 * promotes. Review-quiz and paper passes are logged and change nothing. Any
 * miss, from any source, drops the word to LEARNING at step 0.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { addDays } from '../termVerdict.mjs';

export const STATUS_SCHEMA = 'school.word-ladder-status/v1';
export const CHECK_GAPS = Object.freeze([3, 7, 14, 30]);
export const MAX_STEP = CHECK_GAPS.length - 1;
export const CHECK_PHASES = Object.freeze(['check', 'review', 'paper']);
const MISS_EVENT = Object.freeze({ check: 'check-miss', review: 'check-miss', paper: 'quiz-miss' });

export function emptyStatus() {
  return { schema: STATUS_SCHEMA, words: {}, paperAttemptsFolded: [], lastFoldedDay: null, days: {}, sessions: {} };
}

export function emptyWord() {
  return { state: 'new', step: 0, claimedDay: null, nextCheckDay: null, history: [] };
}

export function readWord(status, wordId) {
  const word = status?.words?.[wordId];
  return word ? structuredClone(word) : emptyWord();
}

export function isScheduledCheck(word, today) {
  if (word?.state === 'claimed') return typeof word.claimedDay === 'string' && word.claimedDay < today;
  if (word?.state === 'known') return typeof word.nextCheckDay === 'string' && word.nextCheckDay <= today;
  return false;
}

const withEvent = (word, event) => ({ ...word, history: [...(word.history ?? []), event] });

export function applyStudy(word, { at, day, recording, reason = null, take = null }) {
  if (!['taken', 'unavailable'].includes(recording)) throw new ValidationError(`unknown recording outcome '${recording}'`);
  const next = word.state === 'new' ? { ...word, state: 'learning' } : { ...word };
  return withEvent(next, {
    at, day, event: 'study', recording,
    ...(reason ? { reason } : {}),
    ...(take != null ? { take } : {}),
  });
}

export function applyMark(word, { at, day, mark }) {
  if (mark === 'know') {
    return withEvent({ ...word, state: 'claimed', step: 0, claimedDay: day, nextCheckDay: null }, { at, day, event: 'claim' });
  }
  if (mark === 'learning') {
    return withEvent({ ...word, state: 'learning', step: 0, claimedDay: null, nextCheckDay: null }, { at, day, event: 'still-learning' });
  }
  throw new ValidationError(`unknown mark '${mark}'`);
}

export function applyCheck(word, { at, day, correct, phase, direction = null, attemptId = null }) {
  if (!CHECK_PHASES.includes(phase)) throw new ValidationError(`unknown check phase '${phase}'`);
  const detail = { phase, ...(direction ? { direction } : {}), ...(attemptId ? { attemptId } : {}) };
  if (correct !== true) {
    return withEvent(
      { ...word, state: 'learning', step: 0, claimedDay: null, nextCheckDay: null },
      { at, day, event: MISS_EVENT[phase], ...detail },
    );
  }
  if (phase === 'paper') return withEvent({ ...word }, { at, day, event: 'quiz-pass', ...detail });
  if (phase === 'check' && isScheduledCheck(word, day)) {
    const step = word.state === 'claimed' ? 0 : Math.min((word.step ?? 0) + 1, MAX_STEP);
    return withEvent(
      { ...word, state: 'known', step, claimedDay: null, nextCheckDay: addDays(day, CHECK_GAPS[step]) },
      { at, day, event: 'check-pass', ...detail },
    );
  }
  return withEvent({ ...word }, { at, day, event: 'check-pass-early', ...detail });
}

/** Review run (rev 3): a card looked at after the day is done. Evidence only. */
export function applyReviewView(word, { at, day }) {
  return withEvent({ ...word }, { at, day, event: 'review' });
}
```

```js
// backend/src/2_domains/school/wordLadder/checkItem.mjs
/**
 * One multiple-choice check (design "Daily session" step 1). Pure and
 * deterministic from word + study day, so a reload shows the same check and
 * the server can re-derive the answer it grades against.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';

export const CHECK_DIRECTIONS = Object.freeze(['picture_to_korean', 'audio_to_korean', 'korean_to_english']);

/** FNV-1a, 32 bit. */
export function hashString(value) {
  let hash = 0x811c9dc5;
  for (const ch of String(value)) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(items, seed) {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function checkDirection(wordId, day) {
  return CHECK_DIRECTIONS[hashString(`${wordId}|${day}`) % CHECK_DIRECTIONS.length];
}

/** A direction that needs media the word does not have falls back to Korean→English. */
export function resolveDirection(wordId, day, media = {}) {
  const direction = checkDirection(wordId, day);
  if (direction === 'picture_to_korean' && media?.image !== true) return 'korean_to_english';
  if (direction === 'audio_to_korean' && media?.audio !== true) return 'korean_to_english';
  return direction;
}

export function answerFor(entry, direction) {
  return direction === 'korean_to_english' ? entry.english : entry.korean;
}

export function buildChoices(entry, direction, day) {
  if (!CHECK_DIRECTIONS.includes(direction)) throw new ValidationError(`unknown check direction '${direction}'`);
  const answer = answerFor(entry, direction);
  const fold = (value) => value.trim().toLocaleLowerCase();
  const pool = (direction === 'korean_to_english' ? entry.decoys.english : entry.decoys.korean)
    .filter((decoy) => fold(decoy) !== fold(answer));
  const decoys = seededShuffle(pool, hashString(`${entry.id}|${day}|decoys`)).slice(0, 3);
  const choices = seededShuffle([answer, ...decoys], hashString(`${entry.id}|${day}|${direction}`));
  return { answer, choices };
}
```

Append to `backend/src/2_domains/school/wordLadder/index.mjs`:

```js
export {
  STATUS_SCHEMA, CHECK_GAPS, MAX_STEP, CHECK_PHASES, emptyStatus, emptyWord, readWord, isScheduledCheck,
  applyStudy, applyMark, applyCheck, applyReviewView,
} from './wordLadder.mjs';
export {
  CHECK_DIRECTIONS, hashString, seededShuffle, checkDirection, resolveDirection, answerFor, buildChoices,
} from './checkItem.mjs';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run backend/src/2_domains/school/wordLadder/`
Expected: PASS (lexicon, wordLadder, checkItem suites).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/school/wordLadder/
git commit -m "feat(school): word-ladder transitions, gaps and deterministic checks" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Day plan, day progress, paper fold

**Files:**
- Create: `backend/src/2_domains/school/wordLadder/planDay.mjs`
- Create: `backend/src/2_domains/school/wordLadder/foldPaperAttempts.mjs`
- Modify: `backend/src/2_domains/school/wordLadder/index.mjs`
- Test: `backend/src/2_domains/school/wordLadder/planDay.test.mjs`, `backend/src/2_domains/school/wordLadder/foldPaperAttempts.test.mjs`

**Interfaces:**
- Consumes: Task 2 (`isScheduledCheck`, `applyCheck`, `readWord`, `hashString`, `seededShuffle`, `resolveDirection`).
- Produces:
  - `planDay({status, deckId, deckWordIds, lexiconIds, today, media}) → {deckId, checks:[{wordId,direction}], study:[wordId], reviewQuiz:[{wordId,direction}]}` — `media` is `{[wordId]: {image: boolean, audio: boolean}}`.
  - `dayProgress({dayPlan, words, day}) → {checks:[{wordId,direction,phase:'check',done,correct}], review:[… phase:'review'], study:[{wordId,studied,recording,marked,done}], remaining:{checks,study,review}, complete}`
  - `progressLabel(progress) → string` (`'Done for today'` or `'3 checks · 12 to study'`)
  - `foldPaperAttempts({status, attempts, quizDocumentIds, dayOf}) → {status, folded:[{attemptId, wordId, correct}]}`

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/2_domains/school/wordLadder/planDay.test.mjs
import { describe, expect, it } from 'vitest';
import {
  applyCheck, applyMark, applyStudy, dayProgress, emptyStatus, emptyWord, planDay, progressLabel,
} from './index.mjs';

const DECK = ['gawi', 'pul', 'chaek'];
const LEX = ['gawi', 'pul', 'chaek', 'ireum'];
const at = (day, time = '16:00:00') => `${day}T${time}-07:00`;
const claimed = (day) => applyMark(applyStudy(emptyWord(), { at: at(day), day, recording: 'taken' }), { at: at(day), day, mark: 'know' });
const plan = (status, today, media = {}) => planDay({ status, deckId: 'd', deckWordIds: DECK, lexiconIds: LEX, today, media });

describe('planDay', () => {
  it('a fresh deck is all study, no checks, no review quiz', () => {
    const p = plan(emptyStatus(), '2026-09-22');
    expect(p.checks).toEqual([]);
    expect([...p.study].sort()).toEqual([...DECK].sort());
    expect(p.reviewQuiz).toEqual([]);
    expect(p.deckId).toBe('d');
  });
  it('claim then rebuild the same day: not checked, not studied, and no review quiz while others remain', () => {
    const status = emptyStatus();
    status.words.gawi = claimed('2026-09-22');
    const p = plan(status, '2026-09-22');
    expect(p.checks).toEqual([]);
    expect(p.study).not.toContain('gawi');
    expect(p.reviewQuiz).toEqual([]);
  });
  it('checks CLAIMED-from-an-earlier-day and KNOWN-due words, across decks', () => {
    const status = emptyStatus();
    status.words.gawi = claimed('2026-09-22');
    status.words.ireum = applyCheck(claimed('2026-09-10'), { at: at('2026-09-11'), day: '2026-09-11', correct: true, phase: 'check' });
    const p = plan(status, '2026-09-23');
    expect(p.checks.map((c) => c.wordId).sort()).toEqual(['gawi', 'ireum']);
  });
  it('uses media to pick directions and falls back without it', () => {
    const status = emptyStatus();
    status.words.gawi = claimed('2026-09-22');
    const without = plan(status, '2026-09-23', {});
    expect(without.checks[0].direction).toBe('korean_to_english');
  });
  it('fires the review quiz when the current deck has nothing to check or study, despite a stuck carried word', () => {
    const status = emptyStatus();
    for (const id of DECK) status.words[id] = claimed('2026-09-22');
    status.words.ireum = applyStudy(emptyWord(), { at: at('2026-09-01'), day: '2026-09-01', recording: 'taken' });
    const p = plan(status, '2026-09-22');
    expect(p.study).toEqual(['ireum']);
    expect(p.checks).toEqual([]);
    expect(p.reviewQuiz.map((c) => c.wordId).sort()).toEqual([...DECK].sort());
  });
  it('is deterministic for one study day', () => {
    expect(plan(emptyStatus(), '2026-09-22')).toEqual(plan(emptyStatus(), '2026-09-22'));
  });
});

describe('dayProgress', () => {
  const day = '2026-09-23';
  const dayPlan = { deckId: 'd', checks: [{ wordId: 'gawi', direction: 'korean_to_english' }], study: ['pul'], reviewQuiz: [] };
  it('is incomplete until every check is answered and every study card studied and marked', () => {
    const words = { gawi: claimed('2026-09-22'), pul: emptyWord() };
    const before = dayProgress({ dayPlan, words, day });
    expect(before.remaining).toEqual({ checks: 1, study: 1, review: 0 });
    expect(before.complete).toBe(false);
    expect(progressLabel(before)).toBe('1 check · 1 to study');

    words.gawi = applyCheck(words.gawi, { at: at(day), day, correct: true, phase: 'check', direction: 'korean_to_english' });
    words.pul = applyStudy(words.pul, { at: at(day, '16:01:00'), day, recording: 'taken' });
    const studiedOnly = dayProgress({ dayPlan, words, day });
    expect(studiedOnly.study[0]).toMatchObject({ studied: true, recording: 'taken', marked: null, done: false });

    words.pul = applyMark(words.pul, { at: at(day, '16:02:00'), day, mark: 'learning' });
    const after = dayProgress({ dayPlan, words, day });
    expect(after.complete).toBe(true);
    expect(progressLabel(after)).toBe('Done for today');
  });
  it('credits a study card whose recording was unavailable', () => {
    const words = { pul: applyMark(applyStudy(emptyWord(), { at: at(day), day, recording: 'unavailable', reason: 'denied' }), { at: at(day, '16:01:00'), day, mark: 'know' }) };
    const progress = dayProgress({ dayPlan: { ...dayPlan, checks: [] }, words, day });
    expect(progress.study[0]).toMatchObject({ recording: 'unavailable', done: true });
    expect(progress.complete).toBe(true);
  });
  it('a check miss adds the word to today\'s study pass, needing work after the miss', () => {
    const words = { gawi: claimed('2026-09-22'), pul: emptyWord() };
    words.gawi = applyStudy(words.gawi, { at: at(day, '09:00:00'), day, recording: 'taken' });
    words.gawi = applyCheck(words.gawi, { at: at(day, '10:00:00'), day, correct: false, phase: 'check' });
    const progress = dayProgress({ dayPlan, words, day });
    expect(progress.study.map((s) => s.wordId)).toEqual(['pul', 'gawi']);
    expect(progress.study[1]).toMatchObject({ studied: false, done: false });
  });
  it('ignores review-run views and paper passes for credit', () => {
    const words = { pul: emptyWord() };
    words.pul = { ...words.pul, history: [{ at: at(day), day, event: 'review' }, { at: at(day), day, event: 'quiz-pass', phase: 'paper' }] };
    expect(dayProgress({ dayPlan: { ...dayPlan, checks: [] }, words, day }).complete).toBe(false);
  });
  it('no frozen plan is never complete', () => {
    expect(dayProgress({ dayPlan: null, words: {}, day }).complete).toBe(false);
  });
});
```

```js
// backend/src/2_domains/school/wordLadder/foldPaperAttempts.test.mjs
import { describe, expect, it } from 'vitest';
import { applyCheck, applyMark, applyStudy, emptyStatus, emptyWord, foldPaperAttempts } from './index.mjs';

const QUIZ = 'language/korean/week-01-classroom-quiz';
const dayOf = (iso) => iso.slice(0, 10);
const attempt = (over = {}) => ({
  id: 'att_1', at: '2026-09-26T21:00:00.000Z', bankId: `${QUIZ}@abcdef123`, itemId: 'gawi', correct: false, transport: 'paper', ...over,
});
const knownStatus = () => {
  const status = emptyStatus();
  let word = applyMark(applyStudy(emptyWord(), { at: '2026-09-22T16:00:00-07:00', day: '2026-09-22', recording: 'taken' }), { at: '2026-09-22T16:01:00-07:00', day: '2026-09-22', mark: 'know' });
  word = applyCheck(word, { at: '2026-09-23T16:00:00-07:00', day: '2026-09-23', correct: true, phase: 'check' });
  status.words.gawi = word;
  return status;
};

describe('foldPaperAttempts', () => {
  it('a scanned miss demotes the word and records the attempt id', () => {
    const { status, folded } = foldPaperAttempts({ status: knownStatus(), attempts: [attempt()], quizDocumentIds: [QUIZ], dayOf });
    expect(status.words.gawi).toMatchObject({ state: 'learning', step: 0, nextCheckDay: null });
    expect(status.words.gawi.history.at(-1)).toMatchObject({ event: 'quiz-miss', attemptId: 'att_1', day: '2026-09-26' });
    expect(status.paperAttemptsFolded).toEqual(['att_1']);
    expect(folded).toEqual([{ attemptId: 'att_1', wordId: 'gawi', correct: false }]);
  });
  it('a scanned pass never promotes', () => {
    const { status } = foldPaperAttempts({ status: knownStatus(), attempts: [attempt({ correct: true })], quizDocumentIds: [QUIZ], dayOf });
    expect(status.words.gawi).toMatchObject({ state: 'known', step: 0 });
    expect(status.words.gawi.history.at(-1).event).toBe('quiz-pass');
  });
  it('is idempotent: the same attempt folded twice yields one event', () => {
    const once = foldPaperAttempts({ status: knownStatus(), attempts: [attempt()], quizDocumentIds: [QUIZ], dayOf });
    const twice = foldPaperAttempts({ status: once.status, attempts: [attempt()], quizDocumentIds: [QUIZ], dayOf });
    expect(twice.folded).toEqual([]);
    expect(twice.status.words.gawi.history.filter((e) => e.attemptId === 'att_1')).toHaveLength(1);
  });
  it('ignores screen attempts, other documents, and ungraded rows', () => {
    const attempts = [
      attempt({ id: 'a1', transport: 'screen' }),
      attempt({ id: 'a2', bankId: 'arts/quiz-1@abcdef123' }),
      attempt({ id: 'a3', bankId: `${QUIZ}-extra@abcdef123` }),
      attempt({ id: 'a4', correct: null }),
    ];
    const { folded, status } = foldPaperAttempts({ status: knownStatus(), attempts, quizDocumentIds: [QUIZ], dayOf });
    expect(folded).toEqual([]);
    expect(status.paperAttemptsFolded).toEqual([]);
  });
  it('does not mutate its input', () => {
    const input = knownStatus();
    const snapshot = structuredClone(input);
    foldPaperAttempts({ status: input, attempts: [attempt()], quizDocumentIds: [QUIZ], dayOf });
    expect(input).toEqual(snapshot);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run backend/src/2_domains/school/wordLadder/planDay.test.mjs backend/src/2_domains/school/wordLadder/foldPaperAttempts.test.mjs`
Expected: FAIL — `planDay is not a function` / `foldPaperAttempts is not a function`.

- [ ] **Step 3: Write the implementation**

```js
// backend/src/2_domains/school/wordLadder/planDay.mjs
/**
 * The study day's plan (design "Daily session") and how far through it the
 * learner is. Pure. The application freezes the FIRST plan of a study day in
 * the status store (a rebuild from the mutated store would drop the checks
 * just passed and then offer a review quiz); progress and credit are read
 * from that frozen plan plus the day's own history.
 */
import { isScheduledCheck } from './wordLadder.mjs';
import { hashString, resolveDirection, seededShuffle } from './checkItem.mjs';

const STUDY_STATES = new Set(['new', 'learning']);
const MARK_EVENTS = new Set(['claim', 'still-learning']);
const CHECK_EVENTS = new Set(['check-pass', 'check-pass-early', 'check-miss']);

export function planDay({ status, deckId = null, deckWordIds = [], lexiconIds = [], today, media = {} }) {
  const inLexicon = new Set(lexiconIds);
  const deck = deckWordIds.filter((id) => inLexicon.has(id));
  const deckSet = new Set(deck);
  const words = status?.words ?? {};
  const stateOf = (id) => words[id]?.state ?? 'new';
  const order = (ids, salt) => seededShuffle(ids, hashString(`${today}|${salt}`));

  const checkIds = order(
    Object.keys(words).filter((id) => inLexicon.has(id) && isScheduledCheck(words[id], today)).sort(),
    'checks',
  );
  const carried = Object.keys(words)
    .filter((id) => inLexicon.has(id) && !deckSet.has(id) && stateOf(id) === 'learning').sort();
  const studyIds = order([...deck.filter((id) => STUDY_STATES.has(stateOf(id))), ...carried], 'study');
  const busy = new Set([...checkIds, ...studyIds]);
  const reviewIds = deck.some((id) => busy.has(id)) ? [] : order(deck, 'review');
  const withDirection = (wordId) => ({ wordId, direction: resolveDirection(wordId, today, media[wordId]) });
  return {
    deckId, checks: checkIds.map(withDirection), study: studyIds, reviewQuiz: reviewIds.map(withDirection),
  };
}

export function dayProgress({ dayPlan, words = {}, day }) {
  const eventsOn = (id) => (words[id]?.history ?? []).filter((event) => event.day === day);
  const checkState = (item, phase) => {
    const hit = eventsOn(item.wordId).find((event) => event.phase === phase && CHECK_EVENTS.has(event.event));
    return { ...item, phase, done: Boolean(hit), correct: hit ? hit.event !== 'check-miss' : null };
  };
  const checks = (dayPlan?.checks ?? []).map((item) => checkState(item, 'check'));
  const review = (dayPlan?.reviewQuiz ?? []).map((item) => checkState(item, 'review'));
  const studyIds = [...(dayPlan?.study ?? [])];
  for (const item of [...checks, ...review]) {
    if (item.done && item.correct === false && !studyIds.includes(item.wordId)) studyIds.push(item.wordId);
  }
  const study = studyIds.map((wordId) => {
    const events = eventsOn(wordId);
    const misses = events.filter((event) => event.event === 'check-miss').map((event) => Date.parse(event.at));
    const since = misses.length ? Math.max(...misses) : -Infinity;
    const after = events.filter((event) => Date.parse(event.at) >= since);
    const studied = after.filter((event) => event.event === 'study').at(-1) ?? null;
    const mark = after.filter((event) => MARK_EVENTS.has(event.event)).at(-1) ?? null;
    return {
      wordId,
      studied: Boolean(studied),
      recording: studied?.recording ?? null,
      marked: mark ? (mark.event === 'claim' ? 'know' : 'learning') : null,
      done: Boolean(studied && mark),
    };
  });
  const remaining = {
    checks: checks.filter((item) => !item.done).length,
    study: study.filter((item) => !item.done).length,
    review: review.filter((item) => !item.done).length,
  };
  return {
    checks, study, review, remaining,
    complete: Boolean(dayPlan) && remaining.checks + remaining.study + remaining.review === 0,
  };
}

export function progressLabel(progress) {
  if (progress.complete) return 'Done for today';
  const checks = progress.remaining.checks + progress.remaining.review;
  return `${checks} ${checks === 1 ? 'check' : 'checks'} · ${progress.remaining.study} to study`;
}
```

```js
// backend/src/2_domains/school/wordLadder/foldPaperAttempts.mjs
/**
 * Scanned printed-quiz rows → word status (design "Feedback into word status").
 * A pull, not an event: the application calls this at every plan build.
 * Paper can only demote: a miss → quiz-miss (LEARNING), a pass → quiz-pass
 * (logged only). Idempotent by attempt id.
 */
import { applyCheck, readWord } from './wordLadder.mjs';

export function foldPaperAttempts({ status, attempts = [], quizDocumentIds = [], dayOf }) {
  const next = structuredClone(status);
  next.words ??= {};
  next.paperAttemptsFolded = [...(status?.paperAttemptsFolded ?? [])];
  const seen = new Set(next.paperAttemptsFolded);
  const prefixes = quizDocumentIds.map((id) => `${id}@`);
  const folded = [];
  const ordered = [...attempts].sort((a, b) => String(a?.at).localeCompare(String(b?.at)));
  for (const attempt of ordered) {
    if (attempt?.transport !== 'paper' || typeof attempt.id !== 'string' || seen.has(attempt.id)) continue;
    if (typeof attempt.bankId !== 'string' || !prefixes.some((prefix) => attempt.bankId.startsWith(prefix))) continue;
    if (typeof attempt.itemId !== 'string' || typeof attempt.correct !== 'boolean') continue;
    next.words[attempt.itemId] = applyCheck(readWord(next, attempt.itemId), {
      at: attempt.at, day: dayOf(attempt.at), correct: attempt.correct, phase: 'paper', attemptId: attempt.id,
    });
    seen.add(attempt.id);
    next.paperAttemptsFolded.push(attempt.id);
    folded.push({ attemptId: attempt.id, wordId: attempt.itemId, correct: attempt.correct });
  }
  return { status: next, folded };
}
```

Append to `index.mjs`:

```js
export { planDay, dayProgress, progressLabel } from './planDay.mjs';
export { foldPaperAttempts } from './foldPaperAttempts.mjs';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run backend/src/2_domains/school/wordLadder/ tests/isolated/application/school/schoolcalcArchitecture.test.mjs`
Expected: PASS — including "keeps the School domain pure" (only `#domains/` and relative imports).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/school/wordLadder/
git commit -m "feat(school): word-ladder day plan, credit progress and paper fold" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Enrollment `policy.mode` (and optional `title`)

**Files:**
- Modify: `backend/src/2_domains/school/flashcards/flashcardEnrollment.mjs`
- Test: `backend/src/2_domains/school/flashcards/flashcardEnrollment.mode.test.mjs`

**Interfaces:**
- Consumes: `createSchoolProgramEnrollmentValidators({flashcardStudyService})` and `SetAssignments` (unchanged, test only).
- Produces: `validateFlashcardEnrollment(raw) → {errors, enrollment: {programId, corpusId, deckId, policy: {mode, ...}, title?}}`; `policy.mode` is always present after validation (`'fsrs'` default).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/2_domains/school/flashcards/flashcardEnrollment.mode.test.mjs
import { describe, expect, it, vi } from 'vitest';
import { validateFlashcardEnrollment } from './index.mjs';
import { createSchoolProgramEnrollmentValidators } from '#apps/school/SchoolProgramEnrollmentValidators.mjs';
import { SetAssignments } from '#apps/school/usecases/SetAssignments.mjs';

const DECK = 'language/korean/week-01-classroom';

describe('flashcard enrollment policy.mode', () => {
  it('defaults to fsrs and keeps existing FSRS policies unchanged', () => {
    const { errors, enrollment } = validateFlashcardEnrollment({ programId: 'flashcards', deckId: 'biology/cells', policy: { minimumReviews: 2 } });
    expect(errors).toEqual([]);
    expect(enrollment.policy).toEqual({ mode: 'fsrs', minimumReviews: 2 });
  });
  it('accepts word-ladder inside policy', () => {
    const { errors, enrollment } = validateFlashcardEnrollment({ programId: 'flashcards', deckId: DECK, policy: { mode: 'word-ladder' } });
    expect(errors).toEqual([]);
    expect(enrollment).toEqual({ programId: 'flashcards', corpusId: DECK, deckId: DECK, policy: { mode: 'word-ladder' } });
  });
  it('rejects an unknown mode and FSRS-only keys under word-ladder', () => {
    expect(validateFlashcardEnrollment({ programId: 'flashcards', deckId: DECK, policy: { mode: 'leitner' } }).errors)
      .toContain('policy.mode must be fsrs or word-ladder');
    const { errors } = validateFlashcardEnrollment({ programId: 'flashcards', deckId: DECK, policy: { mode: 'word-ladder', newCardLimit: 5, masteryPercent: 80, minimumReviews: 3 } });
    expect(errors).toEqual([
      'policy.newCardLimit is not used by word-ladder',
      'policy.masteryPercent is not used by word-ladder',
      'policy.minimumReviews is not used by word-ladder',
    ]);
  });
  it('keeps an optional display title', () => {
    const { enrollment } = validateFlashcardEnrollment({ programId: 'flashcards', deckId: DECK, title: '  Korean words ', policy: { mode: 'word-ladder' } });
    expect(enrollment.title).toBe('Korean words');
    expect(validateFlashcardEnrollment({ programId: 'flashcards', deckId: DECK, title: 7 }).errors).toContain('title must be a non-empty string when present');
  });
  it('policy.mode survives validate → SetAssignments → reload', async () => {
    const stored = [];
    const assignments = { put: vi.fn(async (record) => { stored.push(structuredClone(record)); return record; }), get: vi.fn(async () => stored.at(-1) ?? null) };
    const programValidators = createSchoolProgramEnrollmentValidators({ flashcardStudyService: { getDeck: async () => ({ id: DECK }) } });
    const useCase = new SetAssignments({
      assignments, grownUps: { assert: vi.fn() }, programValidators,
      clock: () => new Date('2026-09-22T12:00:00.000Z'), logger: { info: vi.fn(), warn: vi.fn() },
    });
    const raw = { programId: 'flashcards', deckId: DECK, title: 'Korean words', policy: { mode: 'word-ladder' }, schedule: { daysOfWeek: [1, 2, 3, 4, 5] } };
    await useCase.execute({ learnerId: 'learner-1', assignedBy: 'parent', programs: [raw] });
    const reloaded = (await assignments.get('learner-1')).programs[0];
    expect(reloaded).toMatchObject({ policy: { mode: 'word-ladder' }, title: 'Korean words', schedule: { daysOfWeek: [1, 2, 3, 4, 5] } });
    // A grown-up saving again (the round trip that used to delete top-level keys) keeps it.
    await useCase.execute({ learnerId: 'learner-1', assignedBy: 'parent', programs: [reloaded] });
    expect((await assignments.get('learner-1')).programs[0].policy.mode).toBe('word-ladder');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/2_domains/school/flashcards/flashcardEnrollment.mode.test.mjs`
Expected: FAIL — policy lacks `mode: 'fsrs'`; no mode errors; title dropped.

- [ ] **Step 3: Write the implementation** — replace the body of `flashcardEnrollment.mjs` with:

```js
const ID = /^[a-z0-9][a-z0-9:._/-]{0,127}$/;
export const FLASHCARD_MODES = Object.freeze(['fsrs', 'word-ladder']);
/** FSRS pacing knobs a word ladder has no use for; accepting them silently would be a lie. */
const FSRS_ONLY = Object.freeze(['newCardLimit', 'masteryPercent', 'minimumReviews']);

/** Validate the durable policy attached to a standalone flashcard assignment. */
export function validateFlashcardEnrollment(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: ['flashcard enrollment must be a mapping'] };
  const deckId = raw.deckId ?? raw.corpusId;
  if (raw.programId !== 'flashcards') errors.push('programId must be flashcards');
  if (typeof deckId !== 'string' || !ID.test(deckId)) errors.push('deckId is required and must be a lowercase content reference');
  if (raw.title !== undefined && (typeof raw.title !== 'string' || !raw.title.trim())) errors.push('title must be a non-empty string when present');
  const policy = raw.policy ?? {};
  let mode = 'fsrs';
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) errors.push('policy must be a mapping');
  else {
    // `mode` lives INSIDE policy: SetAssignments persists only what this
    // validator returns, and policy is what already rides the launch target.
    if (policy.mode !== undefined && !FLASHCARD_MODES.includes(policy.mode)) errors.push('policy.mode must be fsrs or word-ladder');
    else if (policy.mode !== undefined) mode = policy.mode;
    for (const field of ['activeMinutes', 'minimumReviews', 'newCardLimit', 'sessionLimit']) {
      if (policy[field] !== undefined && (!Number.isInteger(policy[field]) || policy[field] < 0)) errors.push(`policy.${field} must be an integer >= 0`);
    }
    if (policy.masteryPercent !== undefined && (!Number.isInteger(policy.masteryPercent) || policy.masteryPercent < 0 || policy.masteryPercent > 100)) errors.push('policy.masteryPercent must be an integer from 0 to 100');
    if (policy.quizRequired !== undefined && typeof policy.quizRequired !== 'boolean') errors.push('policy.quizRequired must be boolean');
    if (policy.quizPassingPercent !== undefined && (!Number.isInteger(policy.quizPassingPercent) || policy.quizPassingPercent < 0 || policy.quizPassingPercent > 100)) errors.push('policy.quizPassingPercent must be an integer from 0 to 100');
    // A deck owns its optional assessment. Keeping a bank id on an assignment
    // made the same study set silently mean different tests for different
    // learners, and coupled card ids to quiz ids in the original design.
    if (policy.linkedQuizBankId !== undefined) errors.push('policy.linkedQuizBankId is no longer supported; set deck.assessment.bankId instead');
    if (mode === 'word-ladder') {
      FSRS_ONLY.filter((field) => policy[field] !== undefined).forEach((field) => errors.push(`policy.${field} is not used by word-ladder`));
    }
  }
  if (errors.length) return { errors };
  return {
    errors: [],
    enrollment: {
      programId: 'flashcards', corpusId: deckId, deckId, policy: { ...policy, mode },
      ...(typeof raw.title === 'string' ? { title: raw.title.trim() } : {}),
    },
  };
}

export default validateFlashcardEnrollment;
```

Also add `FLASHCARD_MODES` to `backend/src/2_domains/school/flashcards/index.mjs`:

```js
export { validateFlashcardEnrollment, FLASHCARD_MODES } from './flashcardEnrollment.mjs';
```
(replacing the existing `export { validateFlashcardEnrollment } from './flashcardEnrollment.mjs';` line).

Note on the word-ladder `toEqual` expectation above: `{ ...policy, mode }` with input `{mode:'word-ladder'}` yields `{ mode: 'word-ladder' }` ✓; FSRS input `{minimumReviews: 2}` yields `{ minimumReviews: 2, mode: 'fsrs' }` which `toEqual` matches regardless of key order ✓.

- [ ] **Step 4: Run tests to verify they pass (and nothing FSRS broke)**

Run: `npx vitest run backend/src/2_domains/school/flashcards/ backend/src/3_applications/school/SchoolProgramEnrollmentValidators.test.mjs backend/src/3_applications/school/FlashcardProgramLauncher.test.mjs backend/src/3_applications/school/FlashcardStudyService.test.mjs backend/src/3_applications/school/FlashcardSchedulerPolicyResolver.test.mjs`
Expected: PASS. If an existing test asserts an exact FSRS `policy` object with `toEqual`, update that expectation to include `mode: 'fsrs'` (it is now part of every validated enrollment) and note it in the commit body.

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/school/flashcards/
git commit -m "feat(school): flashcard enrollments carry policy.mode and a title" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Lexicon deck loading and `media:` assets

**Files:**
- Create: `backend/src/1_adapters/school/catalog/YamlLexiconRepository.mjs`
- Create: `backend/src/1_adapters/school/catalog/LexiconDeckLoader.mjs`
- Modify: `backend/src/1_adapters/school/catalog/SchoolFlashcardAssetRepository.mjs` (whole file)
- Modify: `backend/src/5_composition/modules/schoolCatalog.mjs`
- Modify: `backend/src/app.mjs:3199-3201` (asset repository construction)
- Test: `backend/src/1_adapters/school/catalog/LexiconDeckLoader.test.mjs`, `backend/src/1_adapters/school/catalog/SchoolFlashcardAssetRepository.test.mjs` (extend), `backend/src/5_composition/modules/schoolCatalog.test.mjs` (extend)

**Interfaces:**
- Consumes: Task 1 (`validateLexicon`, `parseMediaRef`, `isLexiconDeck`, `expandLexiconDeck`); `ILearningContentRepository` port; `readYamlFromPath`, `getStats` from `#system/utils/FileIO.mjs`.
- Produces:
  - `new YamlLexiconRepository({ mediaRoot, io? })`, `.getLexicon(ref) → Map<wordId, entry>` (throws `Error` with a readable message)
  - `expandDeckWithLexicons(raw, lexicons) → deck` (identity for non-lexicon decks; throws on invalid)
  - `new LexiconDeckLoader({ content, lexicons, logger? })` implementing `getDocument/getQuestionBank/getFlashcardDeck/listFlashcardDecks/getLearningAction`
  - `new SchoolFlashcardAssetRepository({ rootDir, mediaRootDir? })`, `.get(assetId) → {resource, contentType}|null`, `.exists(assetId) → boolean`

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/1_adapters/school/catalog/LexiconDeckLoader.test.mjs
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dump } from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YamlLearningContentRepository } from './YamlLearningContentRepository.mjs';
import { YamlLexiconRepository } from './YamlLexiconRepository.mjs';
import { LexiconDeckLoader } from './LexiconDeckLoader.mjs';

const LEXICON = {
  schema: 'school.word-lexicon/v1',
  entries: [{ id: 'gawi', kind: 'word', korean: '가위', english: 'Scissors', pronunciation: null, decoys: { korean: ['가지', '바위', '가방'], english: ['Knife', 'Tape', 'Ruler'] } }],
};
const WORD_DECK = { schema: 'school.flashcard-deck/v1', id: 'language/korean/week-01-classroom', title: 'Korean — Classroom', revision: 1, lexicon: 'media:language/korean-vocab/lexicon.yml', words: ['gawi'] };
const PLAIN_DECK = { schema: 'school.flashcard-deck/v1', id: 'biology/cells', title: 'Cells', cards: [{ cardId: 'cell', front: { blocks: [{ type: 'text', text: 'Cell' }] }, back: { blocks: [{ type: 'text', text: 'Unit of life' }] } }] };

let root;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'lexicon-loader-'));
  await mkdir(path.join(root, 'media/school/language/korean-vocab'), { recursive: true });
  await mkdir(path.join(root, 'decks/language/korean'), { recursive: true });
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await mkdir(path.join(root, 'banks'), { recursive: true });
  await writeFile(path.join(root, 'media/school/language/korean-vocab/lexicon.yml'), dump(LEXICON));
  await writeFile(path.join(root, 'decks/language/korean/week-01-classroom.yml'), dump(WORD_DECK));
  await writeFile(path.join(root, 'decks/cells.yml'), dump(PLAIN_DECK));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function loader(logger = null) {
  const content = new YamlLearningContentRepository({
    documentDirectories: [path.join(root, 'docs')], bankDirectories: [path.join(root, 'banks')], deckDirectories: [path.join(root, 'decks')],
  });
  return new LexiconDeckLoader({ content, lexicons: new YamlLexiconRepository({ mediaRoot: path.join(root, 'media/school') }), logger });
}

describe('LexiconDeckLoader', () => {
  it('expands a lexicon deck through getFlashcardDeck', async () => {
    const deck = await loader().getFlashcardDeck(WORD_DECK.id);
    expect(deck.cards.map((card) => card.cardId)).toEqual(['gawi']);
    expect(deck.words).toEqual(['gawi']);
    expect(deck.lexicon).toBe(WORD_DECK.lexicon);
  });
  it('expands lexicon decks through listFlashcardDecks and passes plain decks through', async () => {
    const decks = await loader().listFlashcardDecks();
    const byId = Object.fromEntries(decks.map((deck) => [deck.id, deck]));
    expect(byId[WORD_DECK.id].cards).toHaveLength(1);
    expect(byId['biology/cells']).toEqual(PLAIN_DECK);
  });
  it('drops (and logs) a lexicon deck that cannot be expanded from list, but throws from get', async () => {
    await writeFile(path.join(root, 'decks/language/korean/week-01-classroom.yml'), dump({ ...WORD_DECK, words: ['nope'] }));
    const logger = { error: vi.fn() };
    const decks = await loader(logger).listFlashcardDecks();
    expect(decks.map((deck) => deck.id)).toEqual(['biology/cells']);
    expect(logger.error).toHaveBeenCalledWith('school.word-ladder.deck-unexpandable', expect.objectContaining({ deckId: WORD_DECK.id }));
    await expect(loader().getFlashcardDeck(WORD_DECK.id)).rejects.toThrow(/'nope' is not in the lexicon/);
  });
  it('refuses a lexicon reference that leaves the media root', () => {
    const lexicons = new YamlLexiconRepository({ mediaRoot: path.join(root, 'media/school') });
    expect(() => lexicons.getLexicon('media:../../decks/cells.yml')).toThrow(/must not contain/);
    expect(() => lexicons.getLexicon('media:language/korean-vocab/missing.yml')).toThrow(/not found/);
  });
  it('delegates non-deck reads unchanged', async () => {
    const content = { getDocument: vi.fn(async () => 'doc'), getQuestionBank: vi.fn(async () => 'bank'), getLearningAction: vi.fn(async () => 'action'), getFlashcardDeck: vi.fn(), listFlashcardDecks: vi.fn() };
    const wrapped = new LexiconDeckLoader({ content, lexicons: { getLexicon: vi.fn() } });
    await expect(wrapped.getDocument('d')).resolves.toBe('doc');
    await expect(wrapped.getQuestionBank('b')).resolves.toBe('bank');
    await expect(wrapped.getLearningAction('a')).resolves.toBe('action');
  });
});
```

Append to `backend/src/1_adapters/school/catalog/SchoolFlashcardAssetRepository.test.mjs` (inside the existing `describe`, after the existing `it`; add the imports shown at the top of the file):

```js
// add to the import block at the top of the file:
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

  it('resolves media: ids against the media root, refuses traversal, and treats 0-byte files as missing', async () => {
    const media = await mkdtemp(path.join(tmpdir(), 'flashcard-media-'));
    try {
      await mkdir(path.join(media, 'language/korean-vocab/words/gawi'), { recursive: true });
      await writeFile(path.join(media, 'language/korean-vocab/words/gawi/ko.mp3'), Buffer.from('ID3fake'));
      await writeFile(path.join(media, 'language/korean-vocab/words/gawi/image.jpg'), Buffer.alloc(0));
      const repo = new SchoolFlashcardAssetRepository({ rootDir: path.resolve('tests/_fixtures/media'), mediaRootDir: media });
      expect(repo.get('media:language/korean-vocab/words/gawi/ko.mp3')).toMatchObject({ contentType: 'audio/mpeg' });
      expect(repo.exists('media:language/korean-vocab/words/gawi/ko.mp3')).toBe(true);
      expect(repo.get('media:language/korean-vocab/words/gawi/image.jpg')).toBeNull();
      expect(repo.exists('media:language/korean-vocab/words/gawi/image.jpg')).toBe(false);
      expect(repo.get('media:../../etc/passwd')).toBeNull();
      expect(repo.get('media:')).toBeNull();
      expect(new SchoolFlashcardAssetRepository({ rootDir: media }).get('media:language/korean-vocab/words/gawi/ko.mp3')).toBeNull();
    } finally { await rm(media, { recursive: true, force: true }); }
  });
```

Append to `backend/src/5_composition/modules/schoolCatalog.test.mjs` (new `it` in the existing `describe`; add fs imports at the top as above plus `import { dump } from 'js-yaml';`):

```js
  it('expands lexicon decks through the catalog content when a media dir is configured', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'school-catalog-lexicon-'));
    try {
      await mkdir(path.join(root, 'data/content/school/learning-catalog/flashcard-decks'), { recursive: true });
      await mkdir(path.join(root, 'media/school/language/korean-vocab'), { recursive: true });
      await writeFile(path.join(root, 'media/school/language/korean-vocab/lexicon.yml'), dump({ schema: 'school.word-lexicon/v1', entries: [{ id: 'gawi', kind: 'word', korean: '가위', english: 'Scissors', pronunciation: null, decoys: { korean: ['가지', '바위', '가방'], english: ['Knife', 'Tape', 'Ruler'] } }] }));
      await writeFile(path.join(root, 'data/content/school/learning-catalog/flashcard-decks/w.yml'), dump({ schema: 'school.flashcard-deck/v1', id: 'language/korean/w', title: 'W', lexicon: 'media:language/korean-vocab/lexicon.yml', words: ['gawi'] }));
      const catalog = createSchoolCatalog({ configService: {
        getHouseholdAppConfig: () => ({ catalog: {} }), getDataDir: () => path.join(root, 'data'), getMediaDir: () => path.join(root, 'media'),
        getHouseholdPath: (relative) => path.join(root, 'data/household', relative),
      } });
      const deck = await catalog.content.getFlashcardDeck('language/korean/w');
      expect(deck.cards[0].cardId).toBe('gawi');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run backend/src/1_adapters/school/catalog/ backend/src/5_composition/modules/schoolCatalog.test.mjs`
Expected: FAIL — missing modules; `repo.exists is not a function`; deck has no `cards`.

- [ ] **Step 3: Write the implementation**

```js
// backend/src/1_adapters/school/catalog/YamlLexiconRepository.mjs
import path from 'node:path';
import { readYamlFromPath } from '#system/utils/FileIO.mjs';
import { parseMediaRef, validateLexicon } from '#domains/school/wordLadder/index.mjs';

/** Reads `media:<dir>/lexicon.yml` word lexicons from the School media root. */
export class YamlLexiconRepository {
  #root; #load;
  constructor({ mediaRoot, io = {} } = {}) {
    if (typeof mediaRoot !== 'string' || !mediaRoot.trim()) throw new Error('YamlLexiconRepository requires mediaRoot');
    this.#root = path.resolve(mediaRoot);
    this.#load = io.load ?? readYamlFromPath;
  }

  getLexicon(ref) {
    const parsed = parseMediaRef(ref);
    if (!parsed.ok) throw new Error(`lexicon '${ref}': ${parsed.error}`);
    const file = path.resolve(this.#root, parsed.path);
    if (!file.startsWith(`${this.#root}${path.sep}`)) throw new Error(`lexicon '${ref}': escapes the media root`);
    let raw;
    try { raw = this.#load(file); } catch (error) {
      throw new Error(`lexicon '${ref}': ${error?.code === 'ENOENT' ? 'not found' : error.message}`);
    }
    const { errors, entries } = validateLexicon(raw);
    if (errors.length) throw new Error(`lexicon '${ref}': ${errors.join('; ')}`);
    return entries;
  }
}
export default YamlLexiconRepository;
```

```js
// backend/src/1_adapters/school/catalog/LexiconDeckLoader.mjs
import { ILearningContentRepository } from '#apps/school/ports/ILearningContentRepository.mjs';
import { expandLexiconDeck, isLexiconDeck } from '#domains/school/wordLadder/index.mjs';

/** A lexicon deck with ordinary cards; any other deck unchanged. Throws on an invalid deck. */
export function expandDeckWithLexicons(raw, lexicons) {
  if (!isLexiconDeck(raw)) return raw;
  const { errors, deck } = expandLexiconDeck(raw, lexicons.getLexicon(raw.lexicon));
  if (errors.length) throw new Error(errors.join('; '));
  return deck;
}

/**
 * Expands `words` decks BEFORE anyone validates them (validateFlashcardDeck
 * rejects a deck with no `cards`). Wraps get AND list, so the deck browser,
 * FlashcardStudyService, enrollment validation and the word ladder all see
 * the same cards.
 */
export class LexiconDeckLoader extends ILearningContentRepository {
  #content; #lexicons; #logger;
  constructor({ content, lexicons, logger = null } = {}) {
    super();
    if (!content?.getFlashcardDeck) throw new Error('LexiconDeckLoader requires content');
    if (!lexicons?.getLexicon) throw new Error('LexiconDeckLoader requires lexicons');
    this.#content = content; this.#lexicons = lexicons; this.#logger = logger;
  }
  async getDocument(documentId) { return this.#content.getDocument(documentId); }
  async getQuestionBank(bankId) { return this.#content.getQuestionBank(bankId); }
  async getLearningAction(actionId) { return this.#content.getLearningAction(actionId); }
  async getFlashcardDeck(deckId) {
    const raw = await this.#content.getFlashcardDeck(deckId);
    return raw ? expandDeckWithLexicons(raw, this.#lexicons) : null;
  }
  async listFlashcardDecks() {
    const decks = await this.#content.listFlashcardDecks();
    return decks.flatMap((raw) => {
      try { return [expandDeckWithLexicons(raw, this.#lexicons)]; } catch (error) {
        this.#logger?.error?.('school.word-ladder.deck-unexpandable', { deckId: raw?.id ?? null, error: error.message });
        return [];
      }
    });
  }
}
export default LexiconDeckLoader;
```

```js
// backend/src/1_adapters/school/catalog/SchoolFlashcardAssetRepository.mjs
import path from 'node:path';
import { getStats } from '#system/utils/FileIO.mjs';
import { createLocalFileResource } from '#system/http/streamFile.mjs';

const MIME = Object.freeze({
  '.avif': 'image/avif', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
});
const MEDIA_PREFIX = 'media:';

/**
 * Read-only, traversal-safe resolution of authored School flashcard assets.
 * Two named roots: bare ids resolve under the content asset dir, `media:` ids
 * under `<mediaDir>/school` (generated word packages). A 0-byte file is a
 * placeholder, i.e. missing: the player renders around it.
 */
export class SchoolFlashcardAssetRepository {
  #root; #mediaRoot;
  constructor({ rootDir, mediaRootDir = null } = {}) {
    if (typeof rootDir !== 'string' || !rootDir.trim()) throw new Error('SchoolFlashcardAssetRepository requires rootDir');
    this.#root = path.resolve(rootDir);
    this.#mediaRoot = typeof mediaRootDir === 'string' && mediaRootDir.trim() ? path.resolve(mediaRootDir) : null;
  }
  #resolve(assetId) {
    if (typeof assetId !== 'string' || !assetId.trim() || assetId.includes('\0')) return null;
    const isMedia = assetId.startsWith(MEDIA_PREFIX);
    const root = isMedia ? this.#mediaRoot : this.#root;
    const relative = isMedia ? assetId.slice(MEDIA_PREFIX.length) : assetId;
    if (!root || !relative) return null;
    const file = path.resolve(root, relative);
    if (!file.startsWith(`${root}${path.sep}`)) return null;
    const stats = getStats(file);
    if (!stats?.isFile() || stats.size === 0) return null;
    return file;
  }
  exists(assetId) { return this.#resolve(assetId) !== null; }
  get(assetId) {
    const file = this.#resolve(assetId);
    if (!file) return null;
    const contentType = MIME[path.extname(file).toLowerCase()];
    return contentType ? { resource: createLocalFileResource(file, { mimeType: contentType }), contentType } : null;
  }
}
export default SchoolFlashcardAssetRepository;
```

In `backend/src/5_composition/modules/schoolCatalog.mjs`, add imports and wrap the authored content:

```js
import path from 'node:path';
import { LexiconDeckLoader } from '#adapters/school/catalog/LexiconDeckLoader.mjs';
import { YamlLexiconRepository } from '#adapters/school/catalog/YamlLexiconRepository.mjs';
```

Replace the `const authoredContent = projection.enabled ? new YamlLearningContentRepository({...}) : null;` expression with:

```js
  const yamlContent = projection.enabled
    ? new YamlLearningContentRepository({
      documentDirectories: projection.documentDirectories,
      bankDirectories: projection.questionBankDirectories,
      deckDirectories: projection.deckDirectories,
      actionDirectories: projection.actionDirectories,
    })
    : null;
  // Word-ladder decks name a `media:` lexicon and list word ids; expanding
  // them here — the content-repository seam — is what lets every existing
  // deck consumer (validation, FSRS, the deck browser) see ordinary cards.
  const mediaDir = configService.getMediaDir?.() ?? null;
  const authoredContent = yamlContent && mediaDir
    ? new LexiconDeckLoader({
      content: yamlContent,
      lexicons: new YamlLexiconRepository({ mediaRoot: path.join(mediaDir, 'school') }),
      logger,
    })
    : yamlContent;
```

In `backend/src/app.mjs`, replace

```js
  const flashcardAssets = new SchoolFlashcardAssetRepository({
    rootDir: schoolFullConfig.flashcards?.assets?.dir ?? path.join(dataDir, 'content', 'assets'),
  });
```

with

```js
  // `media:` ids (generated word packages) resolve under <mediaDir>/school.
  const schoolMediaRoot = path.join(configService.getMediaDir(), 'school');
  const flashcardAssets = new SchoolFlashcardAssetRepository({
    rootDir: schoolFullConfig.flashcards?.assets?.dir ?? path.join(dataDir, 'content', 'assets'),
    mediaRootDir: schoolMediaRoot,
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run backend/src/1_adapters/school/catalog/ backend/src/5_composition/modules/schoolCatalog.test.mjs && node scripts/check-parse.mjs`
Expected: PASS; check-parse exits 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/school/catalog/ backend/src/5_composition/modules/schoolCatalog.mjs backend/src/5_composition/modules/schoolCatalog.test.mjs backend/src/app.mjs
git commit -m "feat(school): expand lexicon decks at the content seam; media: asset root" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Certify understands lexicon decks and the `media:` root

**Files:**
- Modify: `cli/school/certify.mjs` (flags L65-78, HELP, `resolveCertifyPaths` L163-181, `collectAssetKeys` L232-257, `validateAssetReferences` L298-340, `validateFlashcardDecks` L342-365, `validateCorpusScope` L550-580, gate warnings L621, query call L669)
- Modify: `docs/reference/school/flashcards.md`
- Test: `cli/school/certify.test.mjs` (new `describe`)

**Interfaces:**
- Consumes: `YamlLexiconRepository` and `expandDeckWithLexicons` (Task 5).
- Produces: flags `--media-dir <path>`, `--strict-media`; `paths.mediaDir`, `paths.mediaSchoolRoot`; gate report `warnings` gain `… is a 0-byte placeholder` lines.

- [ ] **Step 1: Write the failing test** — append to `cli/school/certify.test.mjs`:

```js
describe('school-certify — word-ladder lexicon decks', () => {
  const LEXICON = {
    schema: 'school.word-lexicon/v1',
    entries: [{ id: 'gawi', kind: 'word', korean: '가위', english: 'Scissors', pronunciation: null, decoys: { korean: ['가지', '바위', '가방'], english: ['Knife', 'Tape', 'Ruler'] } }],
  };
  const DECK = { schema: 'school.flashcard-deck/v1', id: 'language/korean/week-01-classroom', title: 'Korean — Classroom', revision: 1, lexicon: 'media:language/korean-vocab/lexicon.yml', words: ['gawi'] };

  async function wordFixture(root, { image = 'JPEGDATA', audio = 'ID3DATA', lexicon = LEXICON } = {}) {
    const dirs = await buildFixture(root);
    const media = path.join(root, 'media');
    const words = path.join(media, 'school/language/korean-vocab/words/gawi');
    await mkdir(words, { recursive: true });
    await writeFile(path.join(media, 'school/language/korean-vocab/lexicon.yml'), dump(lexicon));
    if (image !== null) await writeFile(path.join(words, 'image.jpg'), image);
    if (audio !== null) await writeFile(path.join(words, 'ko.mp3'), audio);
    await mkdir(path.join(dirs.decks, 'language/korean'), { recursive: true });
    await writeFile(path.join(dirs.decks, 'language/korean/week-01-classroom.yml'), dump(DECK));
    return { dirs, media };
  }

  it('passes a lexicon deck whose media files are real', async () => {
    await withTmpDir(async (root) => {
      const { media } = await wordFixture(root);
      const { exitCode, report } = await runCertify(flagsToArgv(certifyFlags(root, { 'media-dir': media })));
      expect(report.errors).toEqual([]);
      expect(exitCode).toBe(0);
    });
  });

  it('reports 0-byte placeholders as warnings, and as errors under --strict-media', async () => {
    await withTmpDir(async (root) => {
      const { media } = await wordFixture(root, { image: '', audio: '' });
      const lenient = await runCertify(flagsToArgv(certifyFlags(root, { 'media-dir': media })));
      expect(lenient.exitCode).toBe(0);
      expect(lenient.report.warnings.join('\n')).toMatch(/card 'gawi' front\.blocks\[0\] asset 'media:language\/korean-vocab\/words\/gawi\/image\.jpg' is a 0-byte placeholder/);
      const strict = await runCertify(flagsToArgv(certifyFlags(root, { 'media-dir': media, 'strict-media': true })));
      expect(strict.exitCode).toBe(1);
      expect(strict.report.errors.join('\n')).toMatch(/ko\.mp3' is a 0-byte placeholder/);
    });
  });

  it('fails when a media: file is absent entirely', async () => {
    await withTmpDir(async (root) => {
      const { media } = await wordFixture(root, { audio: null });
      const { exitCode, report } = await runCertify(flagsToArgv(certifyFlags(root, { 'media-dir': media })));
      expect(exitCode).toBe(1);
      expect(report.errors.join('\n')).toMatch(/references missing asset 'media:language\/korean-vocab\/words\/gawi\/ko\.mp3'/);
    });
  });

  it('fails on an invalid lexicon instead of reporting "no cards"', async () => {
    await withTmpDir(async (root) => {
      const bad = { ...LEXICON, entries: [{ ...LEXICON.entries[0], decoys: { korean: ['가위', '바위', '가방'], english: ['Knife', 'Tape', 'Ruler'] } }] };
      const { media } = await wordFixture(root, { lexicon: bad });
      const { exitCode, report } = await runCertify(flagsToArgv(certifyFlags(root, { 'media-dir': media })));
      expect(exitCode).toBe(1);
      expect(report.errors.join('\n')).toMatch(/flashcard deck 'language\/korean\/week-01-classroom': lexicon 'media:language\/korean-vocab\/lexicon\.yml': .*must not contain the answer '가위'/);
      expect(report.errors.join('\n')).not.toMatch(/must contain at least one card/);
    });
  });

  it('treats a 0-byte content-root asset as missing', async () => {
    await withTmpDir(async (root) => {
      const dirs = await buildFixture(root);
      await writeFile(path.join(dirs.assets, 'empty.png'), '');
      await writeFile(path.join(dirs.decks, 'cells.yml'), dump({
        schema: 'school.flashcard-deck/v1', id: 'science/cells', title: 'Cells', cards: [{
          cardId: 'cell', front: { blocks: [{ type: 'image', assetId: 'empty.png', alt: 'cell' }] }, back: { blocks: [{ type: 'text', text: 'Cell' }] },
        }],
      }));
      const { exitCode, report } = await runCertify(flagsToArgv(certifyFlags(root, { 'media-dir': path.join(root, 'media') })));
      expect(exitCode).toBe(1);
      expect(report.errors.join('\n')).toMatch(/missing asset 'empty\.png'/);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/school/certify.test.mjs`
Expected: FAIL — `Unknown option: --media-dir`; lexicon deck errors `cards: must contain at least one card`.

- [ ] **Step 3: Write the implementation** in `cli/school/certify.mjs`:

(a) Imports — add below the `YamlSurfaceProfileRepository` import block:

```js
import { YamlLexiconRepository } from '#adapters/school/catalog/YamlLexiconRepository.mjs';
import { expandDeckWithLexicons } from '#adapters/school/catalog/LexiconDeckLoader.mjs';
```

(b) Flags: add `'media-dir',` to `VALUE_FLAGS` and replace `BOOLEAN_FLAGS` with

```js
const BOOLEAN_FLAGS = new Set(['json', 'write-manifest', 'strict-concepts', 'strict-media']);
const MEDIA_PREFIX = 'media:';
```

(c) HELP — insert after the `--assets-directory` line:

```
  --media-dir <path>                 media root; media:<path> assets resolve under <media-dir>/school
                                     (default: $DAYLIGHT_BASE_PATH/media, else /usr/src/app/media)
```
and after the `--strict-concepts` block:
```
  --strict-media                     fail (instead of warn) on 0-byte media: placeholders
```

(d) `resolveCertifyPaths` — before its `return`, add

```js
  const mediaFlag = valueFlag(flags['media-dir'], 'media-dir');
  const mediaDir = mediaFlag !== undefined
    ? path.resolve(mediaFlag)
    : (env.DAYLIGHT_BASE_PATH ? path.join(env.DAYLIGHT_BASE_PATH, 'media') : '/usr/src/app/media');
```
and add `mediaDir, mediaSchoolRoot: path.join(mediaDir, 'school'),` to the returned object.

(e) `collectAssetKeys` — replace the `else { … }` branch of the walk with:

```js
      else {
        // A 0-byte file is a placeholder, not an asset (word-ladder design:
        // "treat a 0-byte file as missing").
        let size = 0;
        try { size = fs.statSync(path.join(dir, entry.name)).size; } catch { return; }
        if (size === 0) return;
        // Historical question banks use extensionless content refs, while rich
        // flashcard media uses the concrete served filename. Both are valid.
        keys.add(rel);
        keys.add(rel.replace(/\.[^./]+$/, ''));
      }
```

(f) Add these helpers above `validateAssetReferences`:

```js
/** 'ok' | 'empty' | 'missing' for a media:<path> asset under <media-dir>/school. */
function mediaAssetState(mediaSchoolRoot, ref) {
  const relative = ref.slice(MEDIA_PREFIX.length);
  if (!relative || relative.includes('\0')) return 'missing';
  const root = path.resolve(mediaSchoolRoot);
  const file = path.resolve(root, relative);
  if (!file.startsWith(`${root}${path.sep}`)) return 'missing';
  let stats;
  try { stats = fs.statSync(file); } catch { return 'missing'; }
  if (!stats.isFile()) return 'missing';
  return stats.size === 0 ? 'empty' : 'ok';
}

/** Every mounted deck, lexicon decks expanded exactly as the runtime expands them. */
function readDecks(deckDirectories, lexicons) {
  const decks = [];
  deckDirectories.forEach((directory) => {
    [...listYamlFiles(directory, { recursive: true })].sort().forEach((relative) => {
      const file = path.join(directory, relative);
      const raw = loadYaml(file);
      if (!raw) return;
      try {
        decks.push({ relative, file, raw, deck: expandDeckWithLexicons(raw, lexicons), error: null });
      } catch (error) {
        decks.push({ relative, file, raw, deck: null, error: error.message });
      }
    });
  });
  return decks;
}
```

(g) `validateAssetReferences` — change its signature to `function validateAssetReferences({ documentDirectories, bankDirectories, decks = [], assetsDirectory, mediaSchoolRoot })`, declare `const placeholders = [];` next to `const errors = [];`, replace the whole `deckDirectories.forEach(...)` block with

```js
  decks.forEach(({ relative, deck }) => {
    if (!deck || !Array.isArray(deck.cards)) return;
    deck.cards.forEach((card) => ['front', 'back'].forEach((face) => {
      (card?.[face]?.blocks ?? []).forEach((block, index) => {
        if (!['image', 'audio', 'video'].includes(block?.type)) return;
        const where = `flashcard deck '${deck.id ?? relative}': card '${card.cardId ?? '?'}' ${face}.blocks[${index}]`;
        const refs = [['asset', block.assetId], ...(block.type === 'video' ? [['poster asset', block.posterAssetId]] : [])];
        refs.forEach(([label, ref]) => {
          if (typeof ref === 'string' && ref.startsWith(MEDIA_PREFIX)) {
            const state = mediaAssetState(mediaSchoolRoot, ref);
            if (state === 'empty') placeholders.push(`${where} ${label} '${ref}' is a 0-byte placeholder`);
            else if (state === 'missing') errors.push(`${where} references missing ${label} '${ref}'`);
          } else if (!assetKeys.has(ref)) {
            errors.push(`${where} references missing ${label} '${ref}'`);
          }
        });
      });
    }));
  });
  return { errors, placeholders };
```
(the function previously ended `return errors;` — that line is replaced by the new return).

(h) `validateFlashcardDecks` — replace with:

```js
function validateFlashcardDecks(decks, bankDirectories = []) {
  const errors = [];
  const ids = new Map();
  const bankIds = new Set();
  bankDirectories.forEach((directory) => [...listYamlFiles(directory, { recursive: true })].sort().forEach((relative) => {
    const raw = loadYaml(path.join(directory, relative)); if (raw?.id) bankIds.add(raw.id);
  }));
  decks.forEach(({ relative, file, raw, deck, error }) => {
    const label = `flashcard deck '${raw.id ?? relative}'`;
    if (error) errors.push(`${label}: ${error}`);
    else {
      const result = validateFlashcardDeck(deck, { path: label });
      result.errors.forEach((message) => errors.push(message));
      const bankId = result.deck?.assessment?.bankId;
      if (bankId && !bankIds.has(bankId)) errors.push(`${label} references missing assessment bank '${bankId}'`);
    }
    if (raw.id && ids.has(raw.id)) errors.push(`flashcard deck '${raw.id}' is duplicated in '${ids.get(raw.id)}' and '${file}'`);
    else if (raw.id) ids.set(raw.id, file);
  });
  return errors;
}
```

(i) `validateCorpusScope({ corpus, paths, strictConcepts = false, strictMedia = false })` — replace its `assetErrors`/`deckErrors` lines with

```js
  const decks = readDecks(paths.deckDirectories, new YamlLexiconRepository({ mediaRoot: paths.mediaSchoolRoot }));
  const { errors: assetErrors, placeholders } = validateAssetReferences({
    documentDirectories: paths.documentDirectories,
    bankDirectories: paths.bankDirectories,
    decks,
    assetsDirectory: paths.assetsDirectory,
    mediaSchoolRoot: paths.mediaSchoolRoot,
  });
  const deckErrors = validateFlashcardDecks(decks, paths.bankDirectories);
```
add `...(strictMedia ? placeholders : []),` to the `errors` array, and add `mediaWarnings: strictMedia ? [] : placeholders,` to its returned object.

(j) Callers: in `runGateMode` pass `strictMedia: Boolean(flags['strict-media'])` to `validateCorpusScope` and change L621 to

```js
  const warnings = [...certifiedNowhereWarnings(rows), ...corpusValidation.conceptWarnings, ...corpusValidation.mediaWarnings].sort();
```
In the query-mode call at L669 add `strictMedia: Boolean(flags['strict-media'])`.

(k) `docs/reference/school/flashcards.md` — insert a new section before `## Module and assignment policy`:

```markdown
## Word packages (lexicon decks)

A deck may list word ids instead of cards. It names a lexicon on the media
mount and never authors `cards` itself:

    schema: school.flashcard-deck/v1
    id: language/korean/week-01-classroom
    title: Korean — Classroom
    revision: 1
    lexicon: media:language/korean-vocab/lexicon.yml
    words: [annyeong, gawi, …]

The lexicon (`school.word-lexicon/v1`) holds each word's `id`, `kind`
(`word|phrase`), `korean`, `english`, `pronunciation` (required for phrases)
and at least three `decoys.korean` / `decoys.english` each. A decoy may never
equal its own answer, and a decoy that is another in-set entry must be the
same kind. `LexiconDeckLoader` expands the deck at the content-repository seam
(both `getFlashcardDeck` and `listFlashcardDecks`), before any validation: the
front is the picture (alt = English), the Korean, and `ko.mp3`; the back is
the English, plus the pronunciation for a phrase. Media is found by
convention at `media:<package>/words/<id>/{image.jpg,ko.mp3,en.mp3}`.

`media:` asset ids resolve under `<media dir>/school`; bare ids keep resolving
under the content asset dir. A 0-byte file is a placeholder and counts as
missing: the player renders the card without it.
```

In the same file, replace the paragraph that begins `Run \`npm run school:certify\` before publishing content.` with:

```markdown
Run `npm run school:certify` before publishing content. Its gate validates
every mounted flashcard-deck schema (lexicon decks are expanded first, exactly
as at runtime), rejects duplicate deck IDs, and verifies all image, audio,
video, and video-poster assets alongside normal catalog content. A 0-byte
content asset is missing (error). A `media:` asset resolves under
`--media-dir <path>/school` (default `$DAYLIGHT_BASE_PATH/media`): an absent
file is an error, a 0-byte placeholder is a warning, and `--strict-media`
turns placeholders into errors. Use `--flashcard-deck-directories <a,b>` with
`school.mjs certify` when validating a nonstandard deck mount.
```

and in `## Module and assignment policy`, after the standalone-assignment YAML block, add:

```markdown
`policy.mode` selects the study engine: `fsrs` (default, everything above) or
`word-ladder` (see `word-ladder.md`). `mode` lives inside `policy` because
`SetAssignments` persists only what the validator returns and `policy` is what
rides the launch target. `word-ladder` rejects `newCardLimit`,
`masteryPercent` and `minimumReviews`. An optional `title` names the agenda
tile (default `Flashcards`).
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run cli/school/certify.test.mjs`
Expected: PASS — every pre-existing certify test plus the 5 new ones (the pre-existing "dangling media assets" test still matches `missing asset 'missing\.png'`).

- [ ] **Step 5: Commit**

```bash
git add cli/school/certify.mjs cli/school/certify.test.mjs docs/reference/school/flashcards.md
git commit -m "feat(school): certify expands lexicon decks and checks media: placeholders" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Word-ladder status store and recordings

**Files:**
- Create: `backend/src/1_adapters/school/wordLadder/YamlWordLadderStore.mjs`
- Create: `backend/src/1_adapters/school/wordLadder/FilesystemWordLadderRecordings.mjs`
- Test: `backend/src/1_adapters/school/wordLadder/YamlWordLadderStore.test.mjs`, `backend/src/1_adapters/school/wordLadder/FilesystemWordLadderRecordings.test.mjs`

**Interfaces:**
- Consumes: `STATUS_SCHEMA`, `emptyStatus` (Task 2); FileIO (`loadYaml`, `resolveYamlPath`, `saveYamlToPathAtomic`, `listEntries`, `dirExists`, `writeBinary`); `createLocalFileResource`.
- Produces:
  - `new YamlWordLadderStore({ configService, programDir='korean-vocab', logger })`: `.read(userId) → status`, `.save(userId, status)`, `.update(userId, fn) → status`
  - `new FilesystemWordLadderRecordings({ rootDir })`: `.save({learnerId, day, wordId, buffer, ext}) → {take, file}`, `.latest({learnerId, day, wordId}) → {resource, contentType}|null`

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/1_adapters/school/wordLadder/YamlWordLadderStore.test.mjs
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YamlWordLadderStore } from './YamlWordLadderStore.mjs';
import { emptyStatus } from '#domains/school/wordLadder/index.mjs';

let root;
const configService = () => ({ getUserProfile: (id) => (id === 'kid' ? { id } : null), getUserDir: (id) => path.join(root, 'users', id) });
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'wl-store-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('YamlWordLadderStore', () => {
  it('reads an empty status for a learner with no file', () => {
    expect(new YamlWordLadderStore({ configService: configService() }).read('kid')).toEqual(emptyStatus());
  });
  it('round-trips words, frozen days and dates as strings at the documented path', async () => {
    const store = new YamlWordLadderStore({ configService: configService() });
    store.update('kid', (status) => ({
      ...status,
      words: { gawi: { state: 'known', step: 1, claimedDay: null, nextCheckDay: '2026-09-30', history: [{ at: '2026-09-22T16:05:12-07:00', day: '2026-09-22', event: 'claim' }] } },
      days: { '2026-09-23': { deckId: 'language/korean/week-01-classroom', checks: [{ wordId: 'gawi', direction: 'korean_to_english' }], study: [], reviewQuiz: [] } },
      paperAttemptsFolded: ['att_1'], lastFoldedDay: '2026-09-23',
    }));
    const file = path.join(root, 'users/kid/apps/school/korean-vocab/status.yml');
    expect(await readFile(file, 'utf8')).toMatch(/schema: school\.word-ladder-status\/v1/);
    const again = new YamlWordLadderStore({ configService: configService() }).read('kid');
    expect(again.words.gawi.nextCheckDay).toBe('2026-09-30');
    expect(again.words.gawi.history[0].at).toBe('2026-09-22T16:05:12-07:00');
    expect(Object.keys(again.days)).toEqual(['2026-09-23']);
    expect(again.lastFoldedDay).toBe('2026-09-23');
  });
  it('refuses to overwrite a corrupt file and refuses unknown learners', async () => {
    const dir = path.join(root, 'users/kid/apps/school/korean-vocab');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'status.yml'), 'schema: something-else\nwords: []\n');
    const logger = { error: vi.fn() };
    const store = new YamlWordLadderStore({ configService: configService(), logger });
    expect(store.read('kid')).toEqual(emptyStatus());
    expect(logger.error).toHaveBeenCalledWith('school.word-ladder.status-corrupt', expect.objectContaining({ learnerId: 'kid' }));
    expect(() => store.update('kid', (status) => status)).toThrow(/corrupt/);
    expect(() => store.update('ghost', (status) => status)).toThrow(/cannot resolve/);
  });
});
```

```js
// backend/src/1_adapters/school/wordLadder/FilesystemWordLadderRecordings.test.mjs
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemWordLadderRecordings } from './FilesystemWordLadderRecordings.mjs';

let root;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'wl-rec-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('FilesystemWordLadderRecordings', () => {
  it('numbers takes per word per study day under {learner}/{day}/{word}-{n}.{ext}', async () => {
    const recordings = new FilesystemWordLadderRecordings({ rootDir: root });
    expect(recordings.save({ learnerId: 'kid', day: '2026-09-22', wordId: 'gawi', buffer: Buffer.from('one') })).toMatchObject({ take: 1 });
    expect(recordings.save({ learnerId: 'kid', day: '2026-09-22', wordId: 'gawi', buffer: Buffer.from('two') })).toMatchObject({ take: 2 });
    expect(await readFile(path.join(root, 'kid/2026-09-22/gawi-2.webm'), 'utf8')).toBe('two');
    expect(recordings.latest({ learnerId: 'kid', day: '2026-09-22', wordId: 'gawi' })).toMatchObject({ contentType: 'audio/webm' });
    expect(recordings.latest({ learnerId: 'kid', day: '2026-09-22', wordId: 'pul' })).toBeNull();
  });
  it('refuses unsafe ids, days and extensions', () => {
    const recordings = new FilesystemWordLadderRecordings({ rootDir: root });
    expect(() => recordings.save({ learnerId: '../x', day: '2026-09-22', wordId: 'gawi', buffer: Buffer.from('x') })).toThrow(/invalid recording address/);
    expect(() => recordings.save({ learnerId: 'kid', day: '22-09-2026', wordId: 'gawi', buffer: Buffer.from('x') })).toThrow(/invalid recording address/);
    expect(() => recordings.save({ learnerId: 'kid', day: '2026-09-22', wordId: 'gawi', buffer: Buffer.from('x'), ext: 'exe' })).toThrow(/invalid recording address/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run backend/src/1_adapters/school/wordLadder/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

```js
// backend/src/1_adapters/school/wordLadder/YamlWordLadderStore.mjs
import path from 'node:path';
import { loadYaml, resolveYamlPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';
import { STATUS_SCHEMA, emptyStatus } from '#domains/school/wordLadder/index.mjs';

const isMap = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * `users/{id}/apps/school/{programDir}/status.yml` — one learner's word
 * ladder. Keyed by word, so status carries across weekly decks. A corrupt
 * file is never overwritten: it is a child's record.
 */
export class YamlWordLadderStore {
  #configService; #logger; #programDir;
  constructor({ configService, programDir = 'korean-vocab', logger = console } = {}) {
    if (typeof configService?.getUserDir !== 'function') {
      throw new InfrastructureError('YamlWordLadderStore requires configService.getUserDir()', { code: 'MISSING_DEPENDENCY' });
    }
    this.#configService = configService; this.#logger = logger; this.#programDir = programDir;
  }
  #base(userId) {
    if (!this.#configService.getUserProfile?.(userId)) return null;
    return path.join(this.#configService.getUserDir(userId), 'apps', 'school', this.#programDir, 'status');
  }
  #read(userId) {
    const base = this.#base(userId);
    if (!base) return { state: 'missing', value: emptyStatus(), file: null };
    const file = resolveYamlPath(base);
    if (!file) return { state: 'missing', value: emptyStatus(), file: `${base}.yml` };
    try {
      const raw = loadYaml(base);
      if (raw == null) return { state: 'ok', value: emptyStatus(), file };
      if (raw.schema !== STATUS_SCHEMA || !isMap(raw.words)) throw new Error('invalid shape');
      return {
        state: 'ok',
        file,
        value: {
          ...emptyStatus(), ...raw,
          paperAttemptsFolded: Array.isArray(raw.paperAttemptsFolded) ? raw.paperAttemptsFolded : [],
          days: isMap(raw.days) ? raw.days : {},
          sessions: isMap(raw.sessions) ? raw.sessions : {},
        },
      };
    } catch (error) {
      this.#logger.error?.('school.word-ladder.status-corrupt', { learnerId: userId, file, error: error.message });
      return { state: 'corrupt', value: emptyStatus(), file };
    }
  }
  read(userId) { return structuredClone(this.#read(userId).value); }
  save(userId, value) {
    const current = this.#read(userId);
    if (!current.file) throw new InfrastructureError(`cannot resolve word-ladder status for ${userId}`, { code: 'UNKNOWN_USER' });
    if (current.state === 'corrupt') {
      throw new DomainInvariantError(`word-ladder status for '${userId}' is corrupt — refusing to overwrite it`, { code: 'WORD_LADDER_STATUS_CORRUPT' });
    }
    if (value?.schema !== STATUS_SCHEMA || !isMap(value.words)) throw new TypeError('word-ladder status has invalid shape');
    saveYamlToPathAtomic(current.file, value, { noRefs: true });
    return true;
  }
  update(userId, fn) {
    const next = fn(this.read(userId));
    this.save(userId, next);
    return structuredClone(next);
  }
}
export default YamlWordLadderStore;
```

(If `DomainInvariantError`'s constructor signature differs from `(message, {code})`, mirror exactly what `YamlFlashcardProgressStore.mjs` passes — it uses the same call.)

```js
// backend/src/1_adapters/school/wordLadder/FilesystemWordLadderRecordings.mjs
import path from 'node:path';
import { dirExists, listEntries, writeBinary } from '#system/utils/FileIO.mjs';
import { createLocalFileResource } from '#system/http/streamFile.mjs';

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EXT = /^(webm|ogg|m4a|mp4|wav)$/;
const MIME = Object.freeze({ webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'audio/mp4', wav: 'audio/wav' });

/**
 * `{rootDir}/{learnerId}/{studyDay}/{wordId}-{n}.{ext}` — a learner's spoken
 * takes. Presentation and review only: the credit is the status history.
 */
export class FilesystemWordLadderRecordings {
  #root;
  constructor({ rootDir } = {}) {
    if (typeof rootDir !== 'string' || !rootDir.trim()) throw new Error('FilesystemWordLadderRecordings requires rootDir');
    this.#root = path.resolve(rootDir);
  }
  #dir(learnerId, day, wordId) {
    if (!ID.test(String(learnerId)) || !DAY.test(String(day)) || !ID.test(String(wordId))) return null;
    return path.join(this.#root, learnerId, day);
  }
  #takes(dir, wordId) {
    if (!dirExists(dir)) return [];
    const pattern = new RegExp(`^${wordId}-(\\d+)\\.([a-z0-9]+)$`);
    return listEntries(dir)
      .map((name) => { const match = pattern.exec(name); return match ? { name, n: Number(match[1]), ext: match[2] } : null; })
      .filter(Boolean)
      .sort((a, b) => a.n - b.n);
  }
  save({ learnerId, day, wordId, buffer, ext = 'webm' }) {
    const dir = this.#dir(learnerId, day, wordId);
    if (!dir || !EXT.test(String(ext))) throw new Error('invalid recording address');
    const take = (this.#takes(dir, wordId).at(-1)?.n ?? 0) + 1;
    const file = path.join(dir, `${wordId}-${take}.${ext}`);
    writeBinary(file, buffer);
    return { take, file };
  }
  latest({ learnerId, day, wordId }) {
    const dir = this.#dir(learnerId, day, wordId);
    if (!dir) return null;
    const last = this.#takes(dir, wordId).at(-1);
    if (!last || !MIME[last.ext]) return null;
    return { resource: createLocalFileResource(path.join(dir, last.name), { mimeType: MIME[last.ext] }), contentType: MIME[last.ext] };
  }
}
export default FilesystemWordLadderRecordings;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run backend/src/1_adapters/school/wordLadder/`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/school/wordLadder/
git commit -m "feat(school): word-ladder status store and take recordings" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `WordLadderStudyService`

**Files:**
- Create: `backend/src/3_applications/school/WordLadderStudyService.mjs`
- Test: `backend/src/3_applications/school/WordLadderStudyService.test.mjs`

**Interfaces:**
- Consumes: domain barrel (Tasks 1–3); `studyDayForInstant`, `offsetMinutesFor` (`#domains/school/studyDay.mjs`); `addDays` (`#domains/school/termVerdict.mjs`); `ValidationError`, `EntityNotFoundError` (`#domains/core/errors/index.mjs`); `GuestForbiddenError` (`#domains/school/errors.mjs`); store/recordings (Task 7); lexicons + decks (Task 5); `assets.exists` (Task 5); `attempts.readAttemptsInRange(learnerId, fromDay, toDay)` (`YamlSchoolDatastore`); `teacherGate.assert({userId, pin, action, context})`.
- Produces `new WordLadderStudyService({store, decks, lexicons, assignments, attempts?, recordings, assets?, teacherGate?, timezone?, now, id, logger?})`:
  - `open({userId, deckId}) → {sessionId, day, deckId, folded: number, plan: PublicPlan}`
  - `plan({userId, sessionId}) → {sessionId, day, deckId, plan}`
  - `answerCheck({userId, sessionId, wordId, choice}) → {wordId, correct, answer, card, plan}`
  - `saveRecording({userId, sessionId, wordId, buffer, ext}) → {wordId, take, plan}`
  - `latestRecording({userId, sessionId, wordId}) → {resource, contentType}`
  - `markCard({userId, sessionId, wordId, mark, recording?: {status:'unavailable', reason}}) → {wordId, state, plan}`
  - `viewReviewCard({userId, sessionId, wordId}) → {wordId, logged: true}`
  - `fold({learnerId, actorId, pin}) → {learnerId, folded, demoted: string[]}`
  - `dayStatus({userId, deckId, day?}) → {doneToday, progressLabel, remaining}`
  - `PublicPlan = {day, deckId, checks: CheckItem[], study: StudyItem[], review: CheckItem[], deckCards: Card[], remaining, doneToday, progressLabel}`; `CheckItem = {wordId, kind, phase, direction, prompt: {type:'image'|'audio', assetId}|{type:'text', text}, choices, done, correct}`; `StudyItem = {wordId, studied, recording, marked, done, card}`; `Card = {wordId, kind, korean, english, pronunciation, media: {image: assetId|null, audio: assetId|null}}`.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/3_applications/school/WordLadderStudyService.test.mjs
import { describe, expect, it, vi } from 'vitest';
import { WordLadderStudyService } from './WordLadderStudyService.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';
import { answerFor, emptyStatus, validateLexicon } from '#domains/school/wordLadder/index.mjs';

const DECK_ID = 'language/korean/week-01-classroom';
const REF = 'media:language/korean-vocab/lexicon.yml';
const { entries: LEXICON } = validateLexicon({ schema: 'school.word-lexicon/v1', entries: [
  { id: 'gawi', kind: 'word', korean: '가위', english: 'Scissors', pronunciation: null, decoys: { korean: ['가지', '바위', '가방'], english: ['Knife', 'Tape', 'Ruler'] } },
  { id: 'pul', kind: 'word', korean: '풀', english: 'Glue', pronunciation: null, decoys: { korean: ['불', '뿔', '발'], english: ['Tape', 'Paint', 'Stapler'] } },
] });
const DAY1_MS = Date.parse('2026-09-22T23:00:00.000Z'); // 16:00 PDT, study day 2026-09-22
const DAY_MS = 86_400_000;

function memoryStore() {
  const data = {};
  return {
    data,
    read: (userId) => structuredClone(data[userId] ?? emptyStatus()),
    update: (userId, fn) => { const next = fn(structuredClone(data[userId] ?? emptyStatus())); data[userId] = structuredClone(next); return structuredClone(next); },
  };
}

function make({ policy = { mode: 'word-ladder' }, attempts = [], media = false } = {}) {
  let now = DAY1_MS; let n = 0;
  const store = memoryStore();
  const saved = [];
  const service = new WordLadderStudyService({
    store,
    decks: {
      getFlashcardDeck: async (id) => (id === DECK_ID ? { id: DECK_ID, lexicon: REF, words: ['gawi', 'pul'], cards: [] } : null),
      listFlashcardDecks: async () => [{ id: DECK_ID, lexicon: REF, words: ['gawi', 'pul'] }, { id: 'biology/cells', cards: [] }],
    },
    lexicons: { getLexicon: () => LEXICON },
    assignments: { get: async () => ({ programs: [{ programId: 'flashcards', deckId: DECK_ID, policy }] }) },
    attempts: { readAttemptsInRange: vi.fn(() => attempts) },
    recordings: { save: (args) => { saved.push(args); return { take: saved.length, file: 'f' }; }, latest: () => ({ resource: { body: 'x' }, contentType: 'audio/webm' }) },
    assets: { exists: () => media },
    teacherGate: { assert: vi.fn() },
    timezone: 'America/Los_Angeles',
    now: () => now,
    id: () => `ses_${++n}`,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  });
  return { service, store, saved, advanceDays: (days) => { now += days * DAY_MS; } };
}

async function studyAll(service, sessionId, plan, mark = 'know') {
  let current = plan;
  for (const item of plan.study) {
    ({ plan: current } = await service.saveRecording({ userId: 'kid', sessionId, wordId: item.wordId, buffer: Buffer.from('audio') }));
    ({ plan: current } = await service.markCard({ userId: 'kid', sessionId, wordId: item.wordId, mark }));
  }
  return current;
}
async function answerAll(service, sessionId, items, { wrong = [] } = {}) {
  let plan = null;
  for (const item of items) {
    const entry = LEXICON.get(item.wordId);
    const right = answerFor(entry, item.direction);
    const choice = wrong.includes(item.wordId) ? item.choices.find((c) => c !== right) : right;
    ({ plan } = await service.answerCheck({ userId: 'kid', sessionId, wordId: item.wordId, choice }));
  }
  return plan;
}

describe('WordLadderStudyService', () => {
  it('refuses a learner whose assignment is not a word ladder for this deck', async () => {
    const { service } = make({ policy: { mode: 'fsrs' } });
    await expect(service.open({ userId: 'kid', deckId: DECK_ID })).rejects.toBeInstanceOf(GuestForbiddenError);
  });

  it('day 1: everything is study; recording + "I know it" earns the day', async () => {
    const { service, store } = make();
    const { sessionId, day, plan } = await service.open({ userId: 'kid', deckId: DECK_ID });
    expect(day).toBe('2026-09-22');
    expect(plan.checks).toEqual([]);
    expect(plan.study.map((s) => s.wordId).sort()).toEqual(['gawi', 'pul']);
    expect(plan.study[0].card.media).toEqual({ image: null, audio: null });
    expect(plan.deckCards.map((c) => c.wordId)).toEqual(['gawi', 'pul']);
    const done = await studyAll(service, sessionId, plan);
    expect(done.doneToday).toBe(true);
    expect(store.data.kid.words.gawi).toMatchObject({ state: 'claimed', claimedDay: '2026-09-22' });
    expect(store.data.kid.words.gawi.history.map((e) => e.event)).toEqual(['study', 'claim']);
    expect(store.data.kid.words.gawi.history[0].at).toMatch(/^2026-09-22T16:00:00-07:00$/);
    await expect(service.dayStatus({ userId: 'kid', deckId: DECK_ID })).resolves.toMatchObject({ doneToday: true, progressLabel: 'Done for today' });
  });

  it('a reload the same day returns the same frozen plan and never checks a word claimed today', async () => {
    const { service } = make();
    const first = await service.open({ userId: 'kid', deckId: DECK_ID });
    await studyAll(service, first.sessionId, first.plan);
    const again = await service.open({ userId: 'kid', deckId: DECK_ID });
    expect(again.sessionId).not.toBe(first.sessionId);
    expect(again.plan.checks).toEqual([]);
    expect(again.plan.review).toEqual([]);
    expect(again.plan.study.map((s) => s.wordId).sort()).toEqual(['gawi', 'pul']);
    expect(again.plan.doneToday).toBe(true);
  });

  it('day 2 checks yesterday\'s claims; a scheduled pass makes the word KNOWN with a +3 day check', async () => {
    const { service, store, advanceDays } = make();
    const first = await service.open({ userId: 'kid', deckId: DECK_ID });
    await studyAll(service, first.sessionId, first.plan);
    advanceDays(1);
    const { sessionId, plan } = await service.open({ userId: 'kid', deckId: DECK_ID });
    expect(plan.checks.map((c) => c.wordId).sort()).toEqual(['gawi', 'pul']);
    expect(plan.checks.every((c) => c.direction === 'korean_to_english' && c.prompt.type === 'text' && c.choices.length === 4)).toBe(true);
    const after = await answerAll(service, sessionId, plan.checks);
    expect(after.doneToday).toBe(true);
    expect(store.data.kid.words.gawi).toMatchObject({ state: 'known', step: 0, nextCheckDay: '2026-09-26' });
  });

  it('day 3 with nothing due is a mandatory review quiz; passes are early and change nothing', async () => {
    const { service, store, advanceDays } = make();
    const d1 = await service.open({ userId: 'kid', deckId: DECK_ID });
    await studyAll(service, d1.sessionId, d1.plan);
    advanceDays(1);
    const d2 = await service.open({ userId: 'kid', deckId: DECK_ID });
    await answerAll(service, d2.sessionId, d2.plan.checks);
    advanceDays(1);
    const d3 = await service.open({ userId: 'kid', deckId: DECK_ID });
    expect(d3.plan.checks).toEqual([]);
    expect(d3.plan.review.map((c) => c.wordId).sort()).toEqual(['gawi', 'pul']);
    await expect(service.dayStatus({ userId: 'kid', deckId: DECK_ID })).resolves.toMatchObject({ doneToday: false });
    const before = structuredClone(store.data.kid.words.gawi);
    const after = await answerAll(service, d3.sessionId, d3.plan.review);
    expect(after.doneToday).toBe(true);
    expect({ ...store.data.kid.words.gawi, history: null }).toEqual({ ...before, history: null });
    expect(store.data.kid.words.gawi.history.at(-1).event).toBe('check-pass-early');
  });

  it('a review-quiz miss demotes and puts the word into today\'s study pass', async () => {
    const { service, store, advanceDays } = make();
    const d1 = await service.open({ userId: 'kid', deckId: DECK_ID });
    await studyAll(service, d1.sessionId, d1.plan);
    advanceDays(1);
    const d2 = await service.open({ userId: 'kid', deckId: DECK_ID });
    await answerAll(service, d2.sessionId, d2.plan.checks);
    advanceDays(1);
    const d3 = await service.open({ userId: 'kid', deckId: DECK_ID });
    const plan = await answerAll(service, d3.sessionId, d3.plan.review, { wrong: ['gawi'] });
    expect(store.data.kid.words.gawi).toMatchObject({ state: 'learning', step: 0 });
    expect(plan.study.map((s) => s.wordId)).toEqual(['gawi']);
    expect(plan.doneToday).toBe(false);
    const done = await studyAll(service, d3.sessionId, plan, 'learning');
    expect(done.doneToday).toBe(true);
  });

  it('mic unavailable: marking without a take is allowed only when declared, and still earns the day', async () => {
    const { service } = make();
    const { sessionId, plan } = await service.open({ userId: 'kid', deckId: DECK_ID });
    await expect(service.markCard({ userId: 'kid', sessionId, wordId: plan.study[0].wordId, mark: 'know' })).rejects.toThrow(/record the word first/);
    let current = plan;
    for (const item of plan.study) {
      ({ plan: current } = await service.markCard({ userId: 'kid', sessionId, wordId: item.wordId, mark: 'know', recording: { status: 'unavailable', reason: 'denied' } }));
    }
    expect(current.doneToday).toBe(true);
    expect(current.study.every((s) => s.recording === 'unavailable')).toBe(true);
  });

  it('refuses a choice that was never offered and a second answer to the same check', async () => {
    const { service, advanceDays } = make();
    const d1 = await service.open({ userId: 'kid', deckId: DECK_ID });
    await studyAll(service, d1.sessionId, d1.plan);
    advanceDays(1);
    const { sessionId, plan } = await service.open({ userId: 'kid', deckId: DECK_ID });
    const item = plan.checks[0];
    await expect(service.answerCheck({ userId: 'kid', sessionId, wordId: item.wordId, choice: 'Banana' })).rejects.toThrow(/not one of the offered answers/);
    await answerAll(service, sessionId, [item]);
    await expect(answerAll(service, sessionId, [item])).rejects.toThrow(/has no open check today/);
  });

  it('folds scanned paper misses once, at open', async () => {
    const attempts = [{ id: 'att_9', at: '2026-09-23T03:00:00.000Z', bankId: `${DECK_ID}-quiz@abcdef123`, itemId: 'gawi', correct: false, transport: 'paper' }];
    const { service, store } = make({ attempts });
    const first = await service.open({ userId: 'kid', deckId: DECK_ID });
    expect(first.folded).toBe(1);
    expect(store.data.kid.words.gawi.history.at(-1)).toMatchObject({ event: 'quiz-miss', attemptId: 'att_9', day: '2026-09-22' });
    const second = await service.open({ userId: 'kid', deckId: DECK_ID });
    expect(second.folded).toBe(0);
    expect(store.data.kid.paperAttemptsFolded).toEqual(['att_9']);
  });

  it('a teacher fold applies scans without opening a session', async () => {
    const attempts = [{ id: 'att_2', at: '2026-09-22T20:00:00.000Z', bankId: `${DECK_ID}-quiz@abcdef123`, itemId: 'pul', correct: false, transport: 'paper' }];
    const { service } = make({ attempts });
    await expect(service.fold({ learnerId: 'kid', actorId: 'parent', pin: null })).resolves.toEqual({ learnerId: 'kid', folded: 1, demoted: ['pul'] });
  });

  it('replays a past day from its frozen plan', async () => {
    const { service, advanceDays } = make();
    const d1 = await service.open({ userId: 'kid', deckId: DECK_ID });
    await studyAll(service, d1.sessionId, d1.plan);
    advanceDays(1);
    await expect(service.dayStatus({ userId: 'kid', deckId: DECK_ID, day: '2026-09-22' })).resolves.toMatchObject({ doneToday: true });
    await expect(service.dayStatus({ userId: 'kid', deckId: DECK_ID, day: '2026-09-20' })).resolves.toMatchObject({ doneToday: false, progressLabel: 'Not opened' });
    await expect(service.dayStatus({ userId: 'kid', deckId: DECK_ID })).resolves.toMatchObject({ doneToday: false });
  });

  it('review run: a viewed card logs `review` and changes neither state nor credit', async () => {
    const { service, store } = make();
    const { sessionId, plan } = await service.open({ userId: 'kid', deckId: DECK_ID });
    await studyAll(service, sessionId, plan);
    const before = structuredClone(store.data.kid.words.pul);
    await expect(service.viewReviewCard({ userId: 'kid', sessionId, wordId: 'pul' })).resolves.toEqual({ wordId: 'pul', logged: true });
    expect({ ...store.data.kid.words.pul, history: null }).toEqual({ ...before, history: null });
    expect(store.data.kid.words.pul.history.at(-1)).toMatchObject({ event: 'review', day: '2026-09-22' });
    await expect(service.dayStatus({ userId: 'kid', deckId: DECK_ID })).resolves.toMatchObject({ doneToday: true });
    await expect(service.viewReviewCard({ userId: 'kid', sessionId, wordId: 'ireum' })).rejects.toThrow(/not in this deck/);
  });

  it('sessions expire at the study-day boundary', async () => {
    const { service, advanceDays } = make();
    const { sessionId } = await service.open({ userId: 'kid', deckId: DECK_ID });
    advanceDays(1);
    await expect(service.plan({ userId: 'kid', sessionId })).rejects.toThrow(/word-ladder session not found/);
  });

  it('uses available media for prompts and card faces', async () => {
    const { service, advanceDays } = make({ media: true });
    const d1 = await service.open({ userId: 'kid', deckId: DECK_ID });
    expect(d1.plan.study[0].card.media.image).toMatch(/^media:language\/korean-vocab\/words\/.+\/image\.jpg$/);
    await studyAll(service, d1.sessionId, d1.plan);
    advanceDays(1);
    const d2 = await service.open({ userId: 'kid', deckId: DECK_ID });
    for (const item of d2.plan.checks) {
      if (item.direction === 'picture_to_korean') expect(item.prompt).toEqual({ type: 'image', assetId: `media:language/korean-vocab/words/${item.wordId}/image.jpg` });
      if (item.direction === 'audio_to_korean') expect(item.prompt).toEqual({ type: 'audio', assetId: `media:language/korean-vocab/words/${item.wordId}/ko.mp3` });
      if (item.direction === 'korean_to_english') expect(item.prompt).toEqual({ type: 'text', text: LEXICON.get(item.wordId).korean });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/3_applications/school/WordLadderStudyService.test.mjs`
Expected: FAIL — `Failed to resolve import "./WordLadderStudyService.mjs"`.

- [ ] **Step 3: Write the implementation**

```js
// backend/src/3_applications/school/WordLadderStudyService.mjs
/**
 * Word ladder study (Korean vocab design): server-authoritative day plans,
 * graded checks, recorded study cards, the post-completion review run, and
 * the pull-fold of scanned paper quizzes.
 *
 * THE DAY PLAN IS FROZEN on the first open of a study day. Rebuilding it from
 * the store mid-day would drop checks just passed and then offer a review
 * quiz; credit and past-day replay read the frozen plan plus that day's
 * history (`dayProgress`).
 */
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';
import { offsetMinutesFor, studyDayForInstant } from '#domains/school/studyDay.mjs';
import { addDays } from '#domains/school/termVerdict.mjs';
import {
  applyCheck, applyMark, applyReviewView, applyStudy, buildChoices, dayProgress, foldPaperAttempts,
  planDay, progressLabel, readWord, wordAssetIds,
} from '#domains/school/wordLadder/index.mjs';

const FOLD_LOOKBACK_DAYS = 60;
const FOLD_SKEW_DAYS = 2;
const MARKS = new Set(['know', 'learning']);

/** An ISO instant carrying the household's own offset: `2026-09-22T16:05:12-07:00`. */
function isoWithOffset(ms, timezone) {
  const offset = offsetMinutesFor(timezone, ms);
  const local = new Date(ms + offset * 60_000).toISOString().slice(0, 19);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export class WordLadderStudyService {
  #store; #decks; #lexicons; #assignments; #attempts; #recordings; #assets; #teacherGate; #timezone; #now; #id; #logger;

  constructor({
    store, decks, lexicons, assignments, attempts = null, recordings, assets = null, teacherGate = null,
    timezone = null, now, id, logger = console,
  } = {}) {
    if (typeof store?.read !== 'function' || typeof store?.update !== 'function') throw new Error('WordLadderStudyService requires store');
    if (typeof decks?.getFlashcardDeck !== 'function') throw new Error('WordLadderStudyService requires decks.getFlashcardDeck');
    if (typeof lexicons?.getLexicon !== 'function') throw new Error('WordLadderStudyService requires lexicons.getLexicon');
    if (typeof assignments?.get !== 'function') throw new Error('WordLadderStudyService requires assignments');
    if (typeof recordings?.save !== 'function' || typeof recordings?.latest !== 'function') throw new Error('WordLadderStudyService requires recordings');
    if (typeof now !== 'function' || typeof id !== 'function') throw new Error('WordLadderStudyService requires now and id');
    this.#store = store; this.#decks = decks; this.#lexicons = lexicons; this.#assignments = assignments;
    this.#attempts = attempts; this.#recordings = recordings; this.#assets = assets; this.#teacherGate = teacherGate;
    this.#timezone = timezone; this.#now = now; this.#id = id; this.#logger = logger;
  }

  #today() { return studyDayForInstant(this.#now(), { timezone: this.#timezone }); }
  #at() { return isoWithOffset(this.#now(), this.#timezone); }

  async #enrollment(userId, deckId = null) {
    const assignment = await this.#assignments.get(userId);
    return (assignment?.programs ?? []).find((row) => row?.programId === 'flashcards'
      && row.policy?.mode === 'word-ladder'
      && (deckId === null || (row.deckId ?? row.corpusId) === deckId)) ?? null;
  }

  async #assertAssigned(userId, deckId) {
    if (typeof userId !== 'string' || !userId) throw new ValidationError('userId is required');
    if (typeof deckId !== 'string' || !deckId) throw new ValidationError('deckId is required');
    if (!await this.#enrollment(userId, deckId)) {
      throw new GuestForbiddenError(`'${userId}' has no word-ladder assignment for '${deckId}'`);
    }
  }

  async #load(deckId) {
    const deck = await this.#decks.getFlashcardDeck(deckId);
    if (!deck || !Array.isArray(deck.words) || typeof deck.lexicon !== 'string') throw new EntityNotFoundError('word-ladder deck', deckId);
    return { deck, lexicon: this.#lexicons.getLexicon(deck.lexicon) };
  }

  #has(assetId) {
    try { return this.#assets?.exists?.(assetId) === true; } catch { return false; }
  }

  #media(deck, lexicon) {
    const media = {};
    for (const wordId of lexicon.keys()) {
      const ids = wordAssetIds(deck.lexicon, wordId);
      media[wordId] = { image: this.#has(ids.image), audio: this.#has(ids.audio), imageId: ids.image, audioId: ids.audio };
    }
    return media;
  }

  #card(entry, media) {
    const m = media[entry.id] ?? {};
    return {
      wordId: entry.id, kind: entry.kind, korean: entry.korean, english: entry.english,
      pronunciation: entry.pronunciation ?? null,
      media: { image: m.image ? m.imageId : null, audio: m.audio ? m.audioId : null },
    };
  }

  #check(item, entry, media, day) {
    const m = media[entry.id] ?? {};
    const prompt = item.direction === 'picture_to_korean' ? { type: 'image', assetId: m.imageId }
      : item.direction === 'audio_to_korean' ? { type: 'audio', assetId: m.audioId }
        : { type: 'text', text: entry.korean };
    return {
      wordId: entry.id, kind: entry.kind, phase: item.phase, direction: item.direction, prompt,
      choices: buildChoices(entry, item.direction, day).choices, done: item.done, correct: item.correct,
    };
  }

  #publicPlan(status, day, deck, lexicon, media) {
    const dayPlan = status.days?.[day] ?? null;
    const progress = dayProgress({ dayPlan, words: status.words, day });
    const known = (item) => lexicon.has(item.wordId);
    return {
      day,
      deckId: dayPlan?.deckId ?? deck.id,
      checks: progress.checks.filter(known).map((item) => this.#check(item, lexicon.get(item.wordId), media, day)),
      study: progress.study.filter(known).map((item) => ({ ...item, card: this.#card(lexicon.get(item.wordId), media) })),
      review: progress.review.filter(known).map((item) => this.#check(item, lexicon.get(item.wordId), media, day)),
      deckCards: deck.words.filter((wordId) => lexicon.has(wordId)).map((wordId) => this.#card(lexicon.get(wordId), media)),
      remaining: progress.remaining,
      doneToday: progress.complete,
      progressLabel: progressLabel(progress),
    };
  }

  #readAttempts(userId, status, today) {
    if (typeof this.#attempts?.readAttemptsInRange !== 'function') return [];
    // Attempt shards are keyed by the UTC date of `at`, not the study day, so
    // the window reaches one day past today and two days behind the last fold.
    const from = status.lastFoldedDay ? addDays(status.lastFoldedDay, -FOLD_SKEW_DAYS) : addDays(today, -FOLD_LOOKBACK_DAYS);
    try {
      return this.#attempts.readAttemptsInRange(userId, from, addDays(today, 1)) ?? [];
    } catch (error) {
      this.#logger.warn?.('school.word-ladder.attempts-unreadable', { learnerId: userId, error: error.message });
      return [];
    }
  }

  async #quizDocumentIds(deckId) {
    const ids = new Set([`${deckId}-quiz`]);
    try {
      for (const deck of await this.#decks.listFlashcardDecks?.() ?? []) {
        if (Array.isArray(deck?.words) && typeof deck.id === 'string') ids.add(`${deck.id}-quiz`);
      }
    } catch (error) {
      this.#logger.warn?.('school.word-ladder.decks-unlisted', { error: error.message });
    }
    return [...ids];
  }

  #foldInto(status, attempts, quizDocumentIds, today) {
    const { status: next, folded } = foldPaperAttempts({
      status, attempts, quizDocumentIds,
      dayOf: (at) => studyDayForInstant(Date.parse(at), { timezone: this.#timezone }),
    });
    next.lastFoldedDay = today;
    return { next, folded };
  }

  #logFold(learnerId, folded, source) {
    if (!folded.length) return;
    this.#logger.info?.('school.word-ladder.folded', {
      learnerId, source, count: folded.length, demoted: folded.filter((row) => !row.correct).map((row) => row.wordId),
    });
  }

  #session(userId, sessionId) {
    if (typeof userId !== 'string' || !userId) throw new ValidationError('userId is required');
    const status = this.#store.read(userId);
    const session = status.sessions?.[sessionId];
    const today = this.#today();
    if (!session || session.day !== today) throw new EntityNotFoundError('word-ladder session', sessionId);
    return { status, session, today };
  }

  async open({ userId, deckId } = {}) {
    await this.#assertAssigned(userId, deckId);
    const { deck, lexicon } = await this.#load(deckId);
    const media = this.#media(deck, lexicon);
    const today = this.#today();
    const at = this.#at();
    const attempts = this.#readAttempts(userId, this.#store.read(userId), today);
    const quizDocumentIds = await this.#quizDocumentIds(deckId);
    const sessionId = this.#id();
    let folded = [];
    let frozen = false;
    const status = this.#store.update(userId, (current) => {
      const { next, folded: applied } = this.#foldInto(current, attempts, quizDocumentIds, today);
      folded = applied;
      if (next.days?.[today]?.deckId !== deckId) {
        next.days = {
          ...(next.days ?? {}),
          [today]: planDay({ status: next, deckId, deckWordIds: deck.words, lexiconIds: [...lexicon.keys()], today, media }),
        };
        frozen = true;
      }
      next.sessions = Object.fromEntries(Object.entries(next.sessions ?? {}).filter(([, row]) => row?.day === today));
      next.sessions[sessionId] = { deckId, day: today, openedAt: at };
      return next;
    });
    const plan = this.#publicPlan(status, today, deck, lexicon, media);
    this.#logFold(userId, folded, 'open');
    this.#logger.info?.('school.word-ladder.opened', {
      learnerId: userId, deckId, day: today, sessionId, frozen, folded: folded.length,
      checks: plan.checks.length, study: plan.study.length, review: plan.review.length, doneToday: plan.doneToday,
    });
    return { sessionId, day: today, deckId, folded: folded.length, plan };
  }

  async plan({ userId, sessionId } = {}) {
    const { status, session, today } = this.#session(userId, sessionId);
    const { deck, lexicon } = await this.#load(session.deckId);
    return { sessionId, day: today, deckId: session.deckId, plan: this.#publicPlan(status, today, deck, lexicon, this.#media(deck, lexicon)) };
  }

  async answerCheck({ userId, sessionId, wordId, choice } = {}) {
    const { session, today } = this.#session(userId, sessionId);
    const { deck, lexicon } = await this.#load(session.deckId);
    const entry = lexicon.get(wordId);
    if (!entry) throw new EntityNotFoundError('word', wordId);
    if (typeof choice !== 'string' || !choice) throw new ValidationError('choice is required');
    const at = this.#at();
    let outcome = null;
    const status = this.#store.update(userId, (current) => {
      const progress = dayProgress({ dayPlan: current.days?.[today], words: current.words, day: today });
      const item = [...progress.checks, ...progress.review].find((row) => row.wordId === wordId && !row.done);
      if (!item) throw new ValidationError(`'${wordId}' has no open check today`);
      const { choices, answer } = buildChoices(entry, item.direction, today);
      if (!choices.includes(choice)) throw new ValidationError('choice is not one of the offered answers');
      const correct = choice === answer;
      current.words = {
        ...current.words,
        [wordId]: applyCheck(readWord(current, wordId), { at, day: today, correct, phase: item.phase, direction: item.direction }),
      };
      outcome = { correct, answer, phase: item.phase, direction: item.direction };
      return current;
    });
    const media = this.#media(deck, lexicon);
    this.#logger.info?.('school.word-ladder.check', {
      learnerId: userId, sessionId, wordId, ...outcome, state: status.words[wordId].state,
    });
    return {
      wordId, correct: outcome.correct, answer: outcome.answer, card: this.#card(entry, media),
      plan: this.#publicPlan(status, today, deck, lexicon, media),
    };
  }

  #openStudyItem(status, today, wordId) {
    const progress = dayProgress({ dayPlan: status.days?.[today], words: status.words, day: today });
    const item = progress.study.find((row) => row.wordId === wordId && !row.done);
    if (!item) throw new ValidationError(`'${wordId}' is not in today's study pass`);
    return item;
  }

  async saveRecording({ userId, sessionId, wordId, buffer, ext = 'webm' } = {}) {
    const { status: before, session, today } = this.#session(userId, sessionId);
    if (!buffer || buffer.length === 0) throw new ValidationError('recording is empty');
    this.#openStudyItem(before, today, wordId);
    const { deck, lexicon } = await this.#load(session.deckId);
    // File first: an orphan file is recoverable, an event pointing at nothing is not.
    let saved;
    try {
      saved = this.#recordings.save({ learnerId: userId, day: today, wordId, buffer, ext });
    } catch (error) {
      this.#logger.error?.('school.word-ladder.recording-write-failed', { learnerId: userId, wordId, error: error.message });
      throw new ValidationError('could not store recording');
    }
    const at = this.#at();
    const status = this.#store.update(userId, (current) => {
      this.#openStudyItem(current, today, wordId);
      current.words = { ...current.words, [wordId]: applyStudy(readWord(current, wordId), { at, day: today, recording: 'taken', take: saved.take }) };
      return current;
    });
    this.#logger.info?.('school.word-ladder.recording-saved', { learnerId: userId, sessionId, wordId, take: saved.take, bytes: buffer.length });
    return { wordId, take: saved.take, plan: this.#publicPlan(status, today, deck, lexicon, this.#media(deck, lexicon)) };
  }

  async latestRecording({ userId, sessionId, wordId } = {}) {
    const { today } = this.#session(userId, sessionId);
    const found = this.#recordings.latest({ learnerId: userId, day: today, wordId });
    if (!found) throw new EntityNotFoundError('recording', wordId);
    return found;
  }

  async markCard({ userId, sessionId, wordId, mark, recording = null } = {}) {
    if (!MARKS.has(mark)) throw new ValidationError('mark must be know or learning');
    const { session, today } = this.#session(userId, sessionId);
    const { deck, lexicon } = await this.#load(session.deckId);
    const at = this.#at();
    const unavailable = recording?.status === 'unavailable';
    const status = this.#store.update(userId, (current) => {
      const item = this.#openStudyItem(current, today, wordId);
      let word = readWord(current, wordId);
      if (!item.studied) {
        if (!unavailable) throw new ValidationError('record the word first');
        word = applyStudy(word, { at, day: today, recording: 'unavailable', reason: String(recording.reason ?? 'unknown').slice(0, 64) });
      }
      current.words = { ...current.words, [wordId]: applyMark(word, { at, day: today, mark }) };
      return current;
    });
    this.#logger.info?.('school.word-ladder.mark', {
      learnerId: userId, sessionId, wordId, mark, recording: unavailable ? 'unavailable' : 'taken', state: status.words[wordId].state,
    });
    return { wordId, state: status.words[wordId].state, plan: this.#publicPlan(status, today, deck, lexicon, this.#media(deck, lexicon)) };
  }

  /** Review run (rev 3): no marks, no recording, no state change; the view is logged. */
  async viewReviewCard({ userId, sessionId, wordId } = {}) {
    const { session, today } = this.#session(userId, sessionId);
    const { deck } = await this.#load(session.deckId);
    if (!deck.words.includes(wordId)) throw new ValidationError(`'${wordId}' is not in this deck`);
    const at = this.#at();
    this.#store.update(userId, (current) => {
      current.words = { ...current.words, [wordId]: applyReviewView(readWord(current, wordId), { at, day: today }) };
      return current;
    });
    this.#logger.debug?.('school.word-ladder.review-viewed', { learnerId: userId, sessionId, wordId });
    return { wordId, logged: true };
  }

  /** The teacher's "apply scanned quiz": the same fold `open` runs, on demand. */
  async fold({ learnerId, actorId = null, pin = null } = {}) {
    if (!this.#teacherGate) throw new ValidationError('teacher gate is not configured');
    this.#teacherGate.assert({ userId: actorId, pin, action: 'word-ladder.fold', context: { learnerId } });
    const enrollment = await this.#enrollment(learnerId);
    if (!enrollment) throw new EntityNotFoundError('word-ladder assignment', learnerId);
    const deckId = enrollment.deckId ?? enrollment.corpusId;
    const today = this.#today();
    const attempts = this.#readAttempts(learnerId, this.#store.read(learnerId), today);
    const quizDocumentIds = await this.#quizDocumentIds(deckId);
    let folded = [];
    this.#store.update(learnerId, (current) => {
      const { next, folded: applied } = this.#foldInto(current, attempts, quizDocumentIds, today);
      folded = applied;
      return next;
    });
    this.#logFold(learnerId, folded, 'teacher');
    return { learnerId, folded: folded.length, demoted: folded.filter((row) => !row.correct).map((row) => row.wordId) };
  }

  /** Read-only credit for the launcher: today (live) or a past study day (replay). */
  async dayStatus({ userId, deckId, day = null } = {}) {
    const today = this.#today();
    const target = day ?? today;
    const status = this.#store.read(userId);
    let dayPlan = status.days?.[target] ?? null;
    if (target === today && dayPlan && dayPlan.deckId !== deckId) dayPlan = null;
    if (!dayPlan && target === today) {
      const { deck, lexicon } = await this.#load(deckId);
      dayPlan = planDay({
        status, deckId, deckWordIds: deck.words, lexiconIds: [...lexicon.keys()], today, media: this.#media(deck, lexicon),
      });
    }
    if (!dayPlan) return { doneToday: false, progressLabel: 'Not opened', remaining: null };
    const progress = dayProgress({ dayPlan, words: status.words, day: target });
    return { doneToday: progress.complete, progressLabel: progressLabel(progress), remaining: progress.remaining };
  }
}

export default WordLadderStudyService;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/3_applications/school/WordLadderStudyService.test.mjs`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/school/WordLadderStudyService.mjs backend/src/3_applications/school/WordLadderStudyService.test.mjs
git commit -m "feat(school): WordLadderStudyService — frozen day plans, graded checks, review run, paper fold" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Launcher word-ladder branch (`replayable`, `reopenable`) and lifecycle wiring

**Files:**
- Modify: `backend/src/3_applications/school/FlashcardProgramLauncher.mjs` (whole file)
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs:262` (param) and `:595-599` (construction)
- Modify: `docs/reference/school/term-grid.md:47-52`
- Test: `backend/src/3_applications/school/FlashcardProgramLauncher.test.mjs` (extend)

**Interfaces:**
- Consumes: `wordLadder.dayStatus({userId, deckId, day})` (Task 8); `UNKNOWABLE_STATUS` from `./programStatusCollection.mjs`; `findReopenableProgramEntry` (`./usecases/continuationEntry.mjs`, test only).
- Produces: `new FlashcardProgramLauncher({studyService, assignments, donow?, wordLadder?})`; `replayable === true`; word-ladder `status()` → `{doneToday, progressLabel, score: null, reopenable: true, remaining, servedWork}`; FSRS `status({day})` → `UNKNOWABLE_STATUS`. `createSchoolLifecycle({…, wordLadderStudyService})`.

- [ ] **Step 1: Write the failing tests** — append to `FlashcardProgramLauncher.test.mjs`:

```js
import { findReopenableProgramEntry } from './usecases/continuationEntry.mjs';

describe('FlashcardProgramLauncher — word ladder', () => {
  const DECK = 'language/korean/week-01-classroom';
  function makeLadder(dayStatus) {
    const wordLadder = { dayStatus: vi.fn(dayStatus) };
    const studyService = { summary: vi.fn(), getDeck: async () => ({ id: DECK }) };
    const launcher = new FlashcardProgramLauncher({
      studyService, wordLadder,
      assignments: { get: async () => ({ programs: [{ programId: 'flashcards', deckId: DECK, policy: { mode: 'word-ladder' } }] }) },
    });
    return { launcher, wordLadder, studyService };
  }

  it('is replayable', () => {
    expect(makeLadder(async () => ({})).launcher.replayable).toBe(true);
  });
  it('answers from the word ladder, never the FSRS summary, and names the served deck when done', async () => {
    const { launcher, wordLadder, studyService } = makeLadder(async () => ({ doneToday: true, progressLabel: 'Done for today', remaining: { checks: 0, study: 0, review: 0 } }));
    const status = await launcher.status({ userId: 'kid', programInstance: DECK });
    expect(status).toMatchObject({ doneToday: true, progressLabel: 'Done for today', reopenable: true, servedWork: [{ unitId: `flashcards:${DECK}`, title: 'Flashcards' }] });
    expect(wordLadder.dayStatus).toHaveBeenCalledWith({ userId: 'kid', deckId: DECK, day: null });
    expect(studyService.summary).not.toHaveBeenCalled();
  });
  it('replays a past day through the word ladder', async () => {
    const { launcher, wordLadder } = makeLadder(async () => ({ doneToday: false, progressLabel: 'Not opened', remaining: null }));
    await expect(launcher.status({ userId: 'kid', programInstance: DECK, day: '2026-09-21' })).resolves.toMatchObject({ doneToday: false, servedWork: [] });
    expect(wordLadder.dayStatus).toHaveBeenCalledWith({ userId: 'kid', deckId: DECK, day: '2026-09-21' });
  });
  it('keeps the tile openable after completion: a served subject reopens to the word ladder', async () => {
    const { launcher } = makeLadder(async () => ({ doneToday: true, progressLabel: 'Done for today', remaining: null }));
    const status = await launcher.status({ userId: 'kid', programInstance: DECK });
    const entry = { program: 'flashcards', programInstance: DECK, subject: 'flashcards', unitId: `flashcards:${DECK}` };
    expect(findReopenableProgramEntry({ entries: [entry] }, { subject: 'flashcards', statusOf: () => status })).toEqual({ entry, status });
  });
  it('an FSRS deck still cannot answer for a past day', async () => {
    const { launcher } = make();
    await expect(launcher.status({ userId: 'kid', programInstance: 'biology/cells', day: '2026-09-21' })).resolves.toMatchObject({ doneToday: null, unknowable: true, reason: 'no_history' });
  });
  it('fails loudly when a word-ladder enrollment has no word-ladder service', async () => {
    const launcher = new FlashcardProgramLauncher({
      studyService: { summary: vi.fn() },
      assignments: { get: async () => ({ programs: [{ programId: 'flashcards', deckId: DECK, policy: { mode: 'word-ladder' } }] }) },
    });
    await expect(launcher.status({ userId: 'kid', programInstance: DECK })).rejects.toThrow(/word-ladder study is not configured/);
  });
});
```
(and add `vi` to the file's existing `import { describe, expect, it } from 'vitest';` line.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run backend/src/3_applications/school/FlashcardProgramLauncher.test.mjs`
Expected: FAIL — `replayable` undefined; FSRS summary called for word ladder.

- [ ] **Step 3: Write the implementation** — `FlashcardProgramLauncher.mjs`:

```js
import { UNKNOWABLE_STATUS } from './programStatusCollection.mjs';

/** Portal lifecycle adapter for a standalone assigned flashcard deck. */
export class FlashcardProgramLauncher {
  #study; #assignments; #donow; #wordLadder;
  constructor({ studyService, assignments, donow = null, wordLadder = null } = {}) {
    if (!studyService || !assignments) throw new Error('FlashcardProgramLauncher requires studyService and assignments');
    this.#study = studyService; this.#assignments = assignments; this.#donow = donow; this.#wordLadder = wordLadder;
  }
  get id() { return 'flashcards'; }
  get surface() { return 'portal'; }
  get locationHint() { return 'on the Portal'; }
  /**
   * One launcher, two engines. A word ladder keeps a dated history (frozen day
   * plans + dated events), so it can answer for a past day; an FSRS deck keeps
   * only current state and answers UNKNOWABLE_STATUS for any `day` — exactly
   * what a non-replayable launcher got before.
   */
  get replayable() { return true; }
  async #enrollment(userId, deckId) {
    const assignment = await this.#assignments.get(userId);
    return (assignment?.programs ?? []).find((row) => row?.programId === 'flashcards' && (row.deckId ?? row.corpusId) === deckId) ?? null;
  }
  /**
   * WHY A LAUNCHER REPORTS ITS SERVED WORK. `AgendaStatusBoard` draws one disc
   * per assignment from PLAN ∪ EVIDENCE, and a finished program is in neither
   * set: the agenda stops offering it (`next` goes null) the moment it reports
   * `doneToday`, and `BuildAgenda` never opens a work session for a program
   * entry, so the evidence side has nothing either. Without a `servedWork` row
   * the disc does not turn green when a child finishes — it disappears. Same
   * durable-identity fix `StoryTimeProgramLauncher` already carries.
   *
   * The row names the WORK only; `planDailyAgenda` stamps `assignmentUnitId`
   * onto it from the program entry that owns this program.
   */
  async status({ userId, programInstance = null, day = null }) {
    if (!programInstance) return { doneToday: false, progressLabel: 'Choose a flashcard deck', score: null, servedWork: [] };
    const enrollment = await this.#enrollment(userId, programInstance);
    const policy = enrollment?.policy ?? {};
    if (policy.mode === 'word-ladder') return this.#wordLadderStatus({ userId, deckId: programInstance, day });
    if (day != null) return { ...UNKNOWABLE_STATUS };
    const summary = await this.#study.summary({ userId, deckId: programInstance });
    const assessment = await this.#study.assessmentStatus?.({ userId, deckId: programInstance, policy }) ?? { passed: policy.quizRequired !== true };
    const today = summary.today ?? summary.counts;
    const total = summary.counts.new + summary.counts.learning + summary.counts.mastered;
    const mastery = total ? Math.round((summary.counts.mastered / total) * 100) : 0;
    const requirements = [
      policy.activeMinutes === undefined || today.activeSeconds >= policy.activeMinutes * 60,
      policy.minimumReviews === undefined || today.reviewed >= policy.minimumReviews,
      policy.masteryPercent === undefined || mastery >= policy.masteryPercent,
      policy.quizRequired !== true || assessment.passed === true,
    ];
    const doneToday = requirements.every(Boolean) && (summary.counts.due === 0 || policy.minimumReviews !== undefined);
    return { doneToday, progressLabel: `${summary.counts.due} due · ${mastery}% mastered${assessment.required ? ` · test ${assessment.passed ? 'passed' : 'needed'}` : ''}`, score: mastery, summary, assessment,
      // One row per DECK, not per card: the assignment is the deck's daily
      // target, and a row per review would turn one disc into an overflow
      // badge counting its own cards. The deck id is not child-facing, so the
      // title names the program the way `story-time:daily` names story time.
      servedWork: doneToday ? [{ unitId: `flashcards:${programInstance}`, title: 'Flashcards' }] : [] };
  }
  /**
   * THE WORD-LADDER TILE NEVER CLOSES (design rev 3). `doneToday` marks the
   * subject served; `reopenable` keeps its button (`findReopenableProgramEntry`)
   * so a child stuck on the printed quiz can go back to the cards, where the
   * program lands on the review run.
   */
  async #wordLadderStatus({ userId, deckId, day }) {
    if (!this.#wordLadder) throw new Error('word-ladder study is not configured');
    const status = await this.#wordLadder.dayStatus({ userId, deckId, day });
    return {
      doneToday: status.doneToday === true, progressLabel: status.progressLabel, score: null,
      reopenable: true, remaining: status.remaining ?? null,
      servedWork: status.doneToday === true ? [{ unitId: `flashcards:${deckId}`, title: 'Flashcards' }] : [],
    };
  }
  async issueLaunchTarget({ userId, programInstance, unitId }) {
    if (!userId || !programInstance) throw new Error('Flashcard launch requires learner and deck');
    const enrollment = await this.#enrollment(userId, programInstance);
    return { kind: 'program', program: 'flashcards', deckId: programInstance, unitId, policy: enrollment?.policy ?? {} };
  }
  async launch({ userId, corpusId = null, programInstance = null, unitId = null }) {
    const deckId = programInstance ?? corpusId;
    if (!this.#donow) return { decision: 'failed', message: 'The Portal is not available right now.' };
    try {
      await this.#study.getDeck(deckId);
      const target = await this.issueLaunchTarget({ userId, programInstance: deckId, unitId });
      return await this.#donow.dispatch({
        surface: 'portal', action: { target }, learnerId: userId,
        requestedBy: 'school-program', ref: `flashcards:${deckId}`,
        programId: 'flashcards', force: 'never_ask',
      });
    } catch { return { decision: 'failed', message: 'This flashcard deck is not ready to open.' }; }
  }
}
export default FlashcardProgramLauncher;
```

Note: the existing test `uses today's credited reviews…` builds a launcher whose `assignments` returns a policy without `mode` — the FSRS branch is taken (`policy.mode` undefined ≠ `'word-ladder'`), unchanged.

`backend/src/5_composition/modules/schoolLifecycle.mjs`: after the `flashcardStudyService = null,` parameter line add `wordLadderStudyService = null,`, and change the launcher construction to

```js
  if (flashcardStudyService) {
    launchers.set('flashcards', new FlashcardProgramLauncher({
      studyService: flashcardStudyService, assignments: stores.assignments, donow,
      wordLadder: wordLadderStudyService,
    }));
  }
```

`docs/reference/school/term-grid.md` — replace the paragraph beginning `Programs that keep only their current state` with:

```markdown
Programs that keep only their current state (an FSRS flashcard deck's
mastery, a language ladder's position, a reel, the cube) cannot be replayed.
On a past day they are neither owed, served nor faulted; a day on which they
were the only assignment reads `unknown / no_history`. Programs that keep dated
evidence — the piano course, the book log, story time, surface dispatches, and
a `word-ladder` flashcard enrollment (its frozen day plan plus dated history) —
answer for any day. The flashcards launcher is one launcher for both engines,
so it declares `replayable` and answers `no_history` itself for an FSRS deck.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run backend/src/3_applications/school/FlashcardProgramLauncher.test.mjs backend/src/3_applications/school/programLaunchers.servedWork.test.mjs backend/src/3_applications/school/programStatusCollection.weekly.test.mjs && node scripts/check-parse.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/school/FlashcardProgramLauncher.mjs backend/src/3_applications/school/FlashcardProgramLauncher.test.mjs backend/src/5_composition/modules/schoolLifecycle.mjs docs/reference/school/term-grid.md
git commit -m "feat(school): flashcards launcher answers word-ladder credit, replay and reopen" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Word-ladder API routes and service composition

**Files:**
- Create: `backend/src/4_api/v1/routers/school.wordLadder.mjs`
- Modify: `backend/src/4_api/v1/routers/school.mjs` (import at L10; param in `createSchoolRouter`; mount after the `router.get('/flashcards/:deckId', …)` block ~L546)
- Modify: `backend/src/app.mjs` (construct `wordLadderStudy` after `flashcardAssets`; pass to lifecycle ~L4115 and to `createSchoolApiServices` ~L4596)
- Test: `backend/src/4_api/v1/routers/school.wordLadder.routes.test.mjs`

**Interfaces:**
- Consumes: `WordLadderStudyService` methods (Task 8); router `wrap`, `EntityNotFoundError` from injected `coreErrors`; `sendFileResource(req, res, resource)`.
- Produces routes under `/api/v1/school`:
  - `POST /word-ladder/open` `{userId, deckId}`
  - `POST /word-ladder/fold` `{learnerId, actorId, pin?}`
  - `GET /word-ladder/:sessionId/plan?userId=`
  - `POST /word-ladder/:sessionId/checks/:wordId` `{userId, choice}`
  - `POST /word-ladder/:sessionId/cards/:wordId/recording?userId=&ext=` (raw audio body)
  - `GET /word-ladder/:sessionId/cards/:wordId/recording/latest?userId=`
  - `POST /word-ladder/:sessionId/cards/:wordId/mark` `{userId, mark, recording?}`
  - `POST /word-ladder/:sessionId/review/:wordId` `{userId}`

- [ ] **Step 1: Write the failing test**

```js
// backend/src/4_api/v1/routers/school.wordLadder.routes.test.mjs
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolTestRouter as createSchoolRouter } from '../../../../../tests/_lib/school/schoolRouterTestSupport.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

const PLAN = { day: '2026-09-22', checks: [], study: [], review: [], deckCards: [], remaining: { checks: 0, study: 0, review: 0 }, doneToday: true, progressLabel: 'Done for today' };

function app(wordLadderStudy, extra = {}) {
  const server = express();
  server.use(express.json());
  server.use('/api/v1/school', createSchoolRouter({
    schoolService: {}, learnerDirectory: { listLearners: async () => [] },
    schoolErrors: { GuestForbiddenError }, logger: { error() {} }, wordLadderStudy, ...extra,
  }));
  return server;
}

describe('/api/v1/school/word-ladder', () => {
  it('404s when the word ladder is not wired', async () => {
    await request(app(null)).post('/api/v1/school/word-ladder/open').send({ userId: 'kid', deckId: 'd' }).expect(404);
  });
  it('opens a session and never caches it', async () => {
    const service = { open: vi.fn(async () => ({ sessionId: 's1', day: '2026-09-22', deckId: 'd', folded: 0, plan: PLAN })) };
    const res = await request(app(service)).post('/api/v1/school/word-ladder/open').send({ userId: 'kid', deckId: 'language/korean/week-01-classroom' }).expect(200);
    expect(service.open).toHaveBeenCalledWith({ userId: 'kid', deckId: 'language/korean/week-01-classroom' });
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.sessionId).toBe('s1');
  });
  it('maps a missing assignment to 403 and a bad request to 400', async () => {
    const refusing = { open: vi.fn(async () => { throw new GuestForbiddenError('no assignment'); }) };
    await request(app(refusing)).post('/api/v1/school/word-ladder/open').send({ userId: 'kid', deckId: 'd' }).expect(403);
    const invalid = { answerCheck: vi.fn(async () => { throw new ValidationError('choice is not one of the offered answers'); }) };
    await request(app(invalid)).post('/api/v1/school/word-ladder/s1/checks/gawi').send({ userId: 'kid', choice: 'x' }).expect(400);
  });
  it('passes checks, marks, plan reads and review views through', async () => {
    const service = {
      plan: vi.fn(async () => ({ sessionId: 's1', plan: PLAN })),
      answerCheck: vi.fn(async () => ({ correct: true, plan: PLAN })),
      markCard: vi.fn(async () => ({ state: 'claimed', plan: PLAN })),
      viewReviewCard: vi.fn(async () => ({ wordId: 'gawi', logged: true })),
    };
    const server = app(service);
    await request(server).get('/api/v1/school/word-ladder/s1/plan?userId=kid').expect(200);
    expect(service.plan).toHaveBeenCalledWith({ userId: 'kid', sessionId: 's1' });
    await request(server).post('/api/v1/school/word-ladder/s1/checks/gawi').send({ userId: 'kid', choice: 'Scissors' }).expect(200);
    expect(service.answerCheck).toHaveBeenCalledWith({ userId: 'kid', sessionId: 's1', wordId: 'gawi', choice: 'Scissors' });
    await request(server).post('/api/v1/school/word-ladder/s1/cards/gawi/mark').send({ userId: 'kid', mark: 'know', recording: { status: 'unavailable', reason: 'denied' } }).expect(200);
    expect(service.markCard).toHaveBeenCalledWith({ userId: 'kid', sessionId: 's1', wordId: 'gawi', mark: 'know', recording: { status: 'unavailable', reason: 'denied' } });
    await request(server).post('/api/v1/school/word-ladder/s1/review/gawi').send({ userId: 'kid' }).expect(200);
    expect(service.viewReviewCard).toHaveBeenCalledWith({ userId: 'kid', sessionId: 's1', wordId: 'gawi' });
  });
  it('accepts a raw audio body for a take and streams the latest take back', async () => {
    const service = {
      saveRecording: vi.fn(async ({ buffer }) => ({ wordId: 'gawi', take: 1, bytes: buffer.length, plan: PLAN })),
      latestRecording: vi.fn(async () => ({ resource: { body: 'TAKE' }, contentType: 'audio/webm' })),
    };
    const server = app(service, { sendFileResource: (req, res, resource) => res.send(resource.body) });
    const res = await request(server).post('/api/v1/school/word-ladder/s1/cards/gawi/recording?userId=kid&ext=webm')
      .set('Content-Type', 'audio/webm;codecs=opus').send(Buffer.from('abcde')).expect(200);
    expect(res.body.bytes).toBe(5);
    expect(service.saveRecording).toHaveBeenCalledWith(expect.objectContaining({ userId: 'kid', sessionId: 's1', wordId: 'gawi', ext: 'webm' }));
    const latest = await request(server).get('/api/v1/school/word-ladder/s1/cards/gawi/recording/latest?userId=kid').expect(200);
    expect(latest.headers['content-type']).toMatch(/audio\/webm/);
    expect(latest.headers['cache-control']).toBe('private, no-store');
  });
  it('runs the teacher fold', async () => {
    const service = { fold: vi.fn(async () => ({ learnerId: 'kid', folded: 2, demoted: ['gawi'] })) };
    const res = await request(app(service)).post('/api/v1/school/word-ladder/fold').send({ learnerId: 'kid', actorId: 'parent' }).expect(200);
    expect(res.body).toEqual({ learnerId: 'kid', folded: 2, demoted: ['gawi'] });
    expect(service.fold).toHaveBeenCalledWith({ learnerId: 'kid', actorId: 'parent', pin: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/4_api/v1/routers/school.wordLadder.routes.test.mjs`
Expected: FAIL — 404 on every route.

- [ ] **Step 3: Write the implementation**

```js
// backend/src/4_api/v1/routers/school.wordLadder.mjs
/**
 * `/word-ladder/…` — the Korean word ladder (word-ladder design "Recording"
 * and "Daily session"). A thin shell: authorization (the learner's actual
 * word-ladder assignment, the open session, today's plan) and every grading
 * rule live in `WordLadderStudyService`. Responses are `private, no-store`:
 * a child's plan must not sit in a shared browser cache on a household screen.
 */
import express from 'express';

export function mountWordLadderRoutes({ router, wrap, notConfigured, wordLadderStudy = null, sendFileResource }) {
  const service = () => {
    if (!wordLadderStudy) throw notConfigured('word-ladder study');
    return wordLadderStudy;
  };
  const noStore = (res) => res.set('Cache-Control', 'private, no-store');
  const rawAudio = express.raw({
    type: ['audio/webm', 'audio/ogg', 'audio/mp4', 'application/octet-stream'],
    limit: '10mb',
  });

  router.post('/word-ladder/open', wrap(async (req, res) => {
    const { userId, deckId } = req.body || {};
    noStore(res).json(await service().open({ userId, deckId }));
  }));
  router.post('/word-ladder/fold', wrap(async (req, res) => {
    const { learnerId, actorId, pin = null } = req.body || {};
    noStore(res).json(await service().fold({ learnerId, actorId, pin }));
  }));
  router.get('/word-ladder/:sessionId/plan', wrap(async (req, res) => {
    noStore(res).json(await service().plan({ userId: req.query.userId, sessionId: req.params.sessionId }));
  }));
  router.post('/word-ladder/:sessionId/checks/:wordId', wrap(async (req, res) => {
    const { userId, choice } = req.body || {};
    noStore(res).json(await service().answerCheck({ userId, sessionId: req.params.sessionId, wordId: req.params.wordId, choice }));
  }));
  router.post('/word-ladder/:sessionId/cards/:wordId/recording', rawAudio, wrap(async (req, res) => {
    noStore(res).json(await service().saveRecording({
      userId: req.query.userId, sessionId: req.params.sessionId, wordId: req.params.wordId,
      buffer: Buffer.isBuffer(req.body) ? req.body : null, ext: req.query.ext ?? 'webm',
    }));
  }));
  router.get('/word-ladder/:sessionId/cards/:wordId/recording/latest', wrap(async (req, res) => {
    const found = await service().latestRecording({ userId: req.query.userId, sessionId: req.params.sessionId, wordId: req.params.wordId });
    noStore(res).type(found.contentType);
    return sendFileResource(req, res, found.resource);
  }));
  router.post('/word-ladder/:sessionId/cards/:wordId/mark', wrap(async (req, res) => {
    const { userId, mark, recording = null } = req.body || {};
    noStore(res).json(await service().markCard({ userId, sessionId: req.params.sessionId, wordId: req.params.wordId, mark, recording }));
  }));
  router.post('/word-ladder/:sessionId/review/:wordId', wrap(async (req, res) => {
    const { userId } = req.body || {};
    noStore(res).json(await service().viewReviewCard({ userId, sessionId: req.params.sessionId, wordId: req.params.wordId }));
  }));
}

export default mountWordLadderRoutes;
```

`backend/src/4_api/v1/routers/school.mjs`:
- add `import { mountWordLadderRoutes } from './school.wordLadder.mjs';` after the `mountTeacherReadingRoutes` import;
- add the parameter `wordLadderStudy = null,` directly after `flashcardStudy = null,` in `createSchoolRouter({ … })`;
- directly after the `router.get('/flashcards/:deckId', wrap(async (req, res) => { … }));` block, add:

```js
  // The Korean word ladder: a flashcard enrollment in `policy.mode:
  // word-ladder`. Its own module, like the teacher reading workspace.
  mountWordLadderRoutes({
    router, wrap, wordLadderStudy, sendFileResource,
    notConfigured: (what) => new EntityNotFoundError(what, 'not configured'),
  });
```

`backend/src/app.mjs` — directly after the `flashcardAssets` construction (Task 5), add:

```js
  const { WordLadderStudyService } = await import('#apps/school/WordLadderStudyService.mjs');
  const { YamlWordLadderStore } = await import('#adapters/school/wordLadder/YamlWordLadderStore.mjs');
  const { FilesystemWordLadderRecordings } = await import('#adapters/school/wordLadder/FilesystemWordLadderRecordings.mjs');
  const { YamlLexiconRepository } = await import('#adapters/school/catalog/YamlLexiconRepository.mjs');
  const wordLadderLogger = rootLogger.child({ module: 'school-word-ladder' });
  const wordLadderStudy = schoolCatalog.content
    ? new WordLadderStudyService({
      store: new YamlWordLadderStore({ configService, logger: wordLadderLogger }),
      decks: schoolCatalog.content,
      lexicons: new YamlLexiconRepository({ mediaRoot: schoolMediaRoot }),
      assignments: flashcardAssignments,
      attempts: schoolDatastore,
      recordings: new FilesystemWordLadderRecordings({ rootDir: path.join(schoolMediaRoot, 'recordings', 'korean-vocab') }),
      assets: flashcardAssets,
      teacherGate: schoolTeacherGate,
      timezone: configService.getTimezone?.() || null,
      now: Date.now,
      id: shortId,
      logger: wordLadderLogger,
    })
    : null;
```

Then add `wordLadderStudyService: wordLadderStudy,` on the line after `flashcardStudyService: flashcardStudy,` (the lifecycle composition call, ~L4115), and add `wordLadderStudy,` on the line after `flashcardStudy,` inside `createSchoolRouter(createSchoolApiServices({ … }))` (~L4596). `createSchoolApiServices` forwards unknown keys through `...options`, so no change is needed there.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run backend/src/4_api/v1/routers/school.wordLadder.routes.test.mjs backend/src/4_api/v1/routers/school.teacherReading.routes.test.mjs && node scripts/check-parse.mjs`
Expected: PASS; check-parse exits 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/school.wordLadder.mjs backend/src/4_api/v1/routers/school.wordLadder.routes.test.mjs backend/src/4_api/v1/routers/school.mjs backend/src/app.mjs
git commit -m "feat(school): word-ladder API routes and composition" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Hangul font fallback in the print renderer

**Files:**
- Create: `backend/assets/fonts/noto-sans-kr/NotoSansKR-Regular.otf`, `backend/assets/fonts/noto-sans-kr/OFL.txt`
- Modify: `backend/src/1_rendering/school/documents/measure.mjs` (`stringWidth` L133-134; `segmentParagraph` push; `inlineRuns` push; `clozeInlineItems` push)
- Modify: `backend/src/1_rendering/school/documents/DocumentPdfRenderer.mjs:192-195` (`setFont`)
- Modify: `backend/src/1_rendering/school/documents/workbookTheme.mjs:172-187` and `documentPdfTheme.mjs:33-43` (fonts)
- Modify: `docs/reference/school/print-documents.md` (§4)
- Test: `backend/src/1_rendering/school/documents/hangulFallback.render.test.mjs`

**Interfaces:**
- Consumes: none from earlier tasks.
- Produces: `export function withScriptFont(run) → run` and `export const HANGUL_PATTERN` in `measure.mjs`; theme font key `hangul` in both themes.

- [ ] **Step 1: Fetch the font (OFL) into the repo**

```bash
mkdir -p backend/assets/fonts/noto-sans-kr
curl -fsSL -o backend/assets/fonts/noto-sans-kr/NotoSansKR-Regular.otf \
  https://github.com/notofonts/noto-cjk/raw/main/Sans/SubsetOTF/KR/NotoSansKR-Regular.otf
curl -fsSL -o backend/assets/fonts/noto-sans-kr/OFL.txt \
  https://github.com/notofonts/noto-cjk/raw/main/Sans/LICENSE
ls -l backend/assets/fonts/noto-sans-kr/
```
Expected: `NotoSansKR-Regular.otf` ≈ 4.6 MB, `OFL.txt` present. (Verified 2026-09-22: pdfkit 0.18 embeds this CFF OTF as `/BaseFont /…+NotoSansKR-Regular`.)

- [ ] **Step 2: Write the failing test**

```js
// backend/src/1_rendering/school/documents/hangulFallback.render.test.mjs
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import { createDocumentPdfRenderer } from './DocumentPdfRenderer.mjs';
import { createMeasurementDocument, measureDocumentFragments, withScriptFont } from './measure.mjs';
import { createWorkbookTheme } from './workbookTheme.mjs';
import { texToSvg } from './mathSvg.mjs';

const FONTS = fileURLToPath(new URL('../../../../assets/fonts', import.meta.url));
const theme = createWorkbookTheme({ typeScale: 'young' });

const doc = {
  id: 'hangul-fallback', title: 'Korean check', seed: 1, variant: 0, target: ['letter'],
  blocks: [{ type: 'rich_text', md: 'What does **가위** mean? **안녕하세요**' }],
};

describe('Hangul font fallback', () => {
  it('sets any run containing Hangul in the hangul face and leaves Latin runs alone', () => {
    expect(withScriptFont({ text: '가위', font: 'bold' })).toEqual({ text: '가위', font: 'hangul' });
    expect(withScriptFont({ text: 'What does', font: 'regular' })).toEqual({ text: 'What does', font: 'regular' });
    const [, body] = measureDocumentFragments(doc, { doc: createMeasurementDocument({ theme }), theme, texToSvg });
    const runs = body.lines?.flatMap((line) => line.runs) ?? body.nodes.flatMap((node) => node.lines ?? []).flatMap((line) => line.runs);
    expect(runs.filter((run) => /[가-힣]/.test(run.text)).every((run) => run.font === 'hangul')).toBe(true);
    expect(runs.filter((run) => /^[A-Za-z?]+$/.test(run.text)).every((run) => run.font !== 'hangul')).toBe(true);
  });
  it('the house font has no Hangul glyph; Noto Sans KR has every one the lexicon uses', () => {
    const atkinson = fontkit.openSync(path.join(FONTS, 'atkinson-hyperlegible/AtkinsonHyperlegible-Regular.ttf'));
    const noto = fontkit.openSync(path.join(FONTS, 'noto-sans-kr/NotoSansKR-Regular.otf'));
    expect(atkinson.glyphForCodePoint('가'.codePointAt(0)).id).toBe(0);
    for (const ch of '안녕하세요히계선생님친구들이름뭐예가위풀책지우개바인더종색연필간식한국학교') {
      expect(noto.glyphForCodePoint(ch.codePointAt(0)).id, ch).not.toBe(0);
    }
  });
  it('embeds Noto Sans KR in a real PDF render', async () => {
    const renderer = createDocumentPdfRenderer({ theme, texToSvg });
    const { pdf } = await renderer.render(doc, { studentName: 'Learner' });
    expect(pdf.toString('latin1')).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSansKR-Regular/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run backend/src/1_rendering/school/documents/hangulFallback.render.test.mjs`
Expected: FAIL — `withScriptFont is not a function`.

- [ ] **Step 4: Write the implementation**

`measure.mjs` — add near the top (after the `DEFAULT_FONT_DIR` constant):

```js
/**
 * Hangul (Jamo, Compatibility Jamo, Syllables). The house fonts have no
 * Hangul glyphs — a Korean word would print as `.notdef` boxes — so any run
 * containing Hangul is set in the theme's `hangul` face (Noto Sans KR, OFL).
 * Per run, not per glyph: the inline grammar already splits bold/italic/code
 * into runs, and a run is the unit both measurement and drawing agree on.
 */
export const HANGUL_PATTERN = /[ᄀ-ᇿ㄰-㆏가-힯]/;
export function withScriptFont(run) {
  return run && typeof run.text === 'string' && HANGUL_PATTERN.test(run.text) ? { ...run, font: 'hangul' } : run;
}
```

Change `stringWidth` so a theme without the key falls back to regular:

```js
const stringWidth = (doc, theme, fontKey, sizePt, text) =>
  doc.font((theme.fonts[fontKey] ?? theme.fonts.regular).name).fontSize(sizePt).widthOfString(text);
```

In `segmentParagraph`, change `const pushText = (raw, font) => { if (raw) runs.push({ text: raw, font }); };` to

```js
  const pushText = (raw, font) => { if (raw) runs.push(withScriptFont({ text: raw, font })); };
```

In `inlineRuns`, change `const push = (raw, font) => { if (raw) runs.push({ text: raw, font }); };` to

```js
  const push = (raw, font) => { if (raw) runs.push(withScriptFont({ text: raw, font })); };
```

In `clozeInlineItems`, change `const push = (raw, font) => { if (raw) items.push({ text: raw, font }); };` to

```js
  const push = (raw, font) => { if (raw) items.push(withScriptFont({ text: raw, font })); };
```

`DocumentPdfRenderer.mjs` `setFont`:

```js
  const setFont = (out, fontKey, sizePt, inkKey = 'text') => out
    .font((theme.fonts[fontKey] ?? theme.fonts.regular).name)
    .fontSize(sizePt)
    .fillColor(theme.ink[inkKey]);
```

`workbookTheme.mjs` `fonts` — add after the `code:` entry:

```js
      // Hangul fallback (`measure.mjs#withScriptFont`). pdfkit registration is
      // lazy, so documents with no Korean embed nothing and stay byte-identical.
      hangul: { name: 'workbook-hangul', file: 'noto-sans-kr/NotoSansKR-Regular.otf' },
```

`documentPdfTheme.mjs` `fonts` — add after the `code:` entry:

```js
    // Hangul fallback — see workbookTheme. Lazy registration keeps goldens identical.
    hangul: { name: 'school-doc-hangul', file: 'noto-sans-kr/NotoSansKR-Regular.otf' },
```

`docs/reference/school/print-documents.md` — in §4, after the paragraph that ends `…for any action block whose token was minted at issue time.`, add:

```markdown
**Korean text.** The house fonts carry no Hangul. Any inline text run that
contains Hangul (U+1100–11FF, U+3130–318F, U+AC00–D7AF) is set in Noto Sans KR
(`backend/assets/fonts/noto-sans-kr/`, OFL) — the theme's `hangul` face —
while Latin runs keep the house font. The swap happens where runs are built
(`measure.mjs#withScriptFont`), so measurement and drawing agree. Bold and
italic Hangul print in the regular weight. Header text (title, subtitle,
instructions) is drawn outside the run grammar and must stay Latin.
`hangulFallback.render.test.mjs` asserts the glyphs exist and the font is
embedded, so a Korean worksheet cannot silently print `.notdef` boxes.
```

- [ ] **Step 5: Run tests to verify they pass and existing goldens are untouched**

Run: `npx vitest run backend/src/1_rendering/school/documents/ tests/isolated/rendering/school/golden/`
Expected: PASS — including the existing snapshot suites with no snapshot updates (documents without Hangul never register the new face).

- [ ] **Step 6: Commit**

```bash
git add backend/assets/fonts/noto-sans-kr backend/src/1_rendering/school/documents/measure.mjs backend/src/1_rendering/school/documents/DocumentPdfRenderer.mjs backend/src/1_rendering/school/documents/workbookTheme.mjs backend/src/1_rendering/school/documents/documentPdfTheme.mjs backend/src/1_rendering/school/documents/hangulFallback.render.test.mjs docs/reference/school/print-documents.md
git commit -m "feat(school): Noto Sans KR fallback for Hangul runs in printed documents" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Printed quiz generator (`korean-vocab quiz`) and the OMR loop fixture

**Files:**
- Create: `backend/src/2_domains/school/wordLadder/quizSource.mjs`
- Modify: `backend/src/2_domains/school/wordLadder/index.mjs`
- Create: `cli/school/koreanVocab.mjs`
- Modify: `cli/school.mjs` (NAMESPACES)
- Modify: `docs/reference/school/print-documents.md` (§7 CLI)
- Test: `backend/src/2_domains/school/wordLadder/quizSource.test.mjs`, `cli/school/koreanVocab.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–3 (`hashString`, `seededShuffle`, `foldPaperAttempts`, `emptyStatus`); `validateDocumentSource`, `publishDocument` (`#domains/school/documents/documentSource.mjs`); `planRows` (`#domains/school/documents/allocation.mjs`); `RecordCardScanOutcome` (test); `YamlLearningContentRepository`, `LexiconDeckLoader`, `YamlLexiconRepository` (CLI); renderer from Task 11 (test).
- Produces:
  - `QUIZ_INSTRUCTIONS` (the verbatim sheet line), `quizDocumentIdFor(deckId) → '<deckId>-quiz'`
  - `buildWordQuizSource({deck, lexicon, seed}) → school.document-source/v1 object`
  - CLI `node cli/school.mjs korean-vocab quiz --deck <id|slug> [--seed N] [--data-dir] [--media-dir] [--source-root] [--force]`
  - CLI `node cli/school.mjs korean-vocab enroll-plan --learner <id> --deck <id|slug> --out <file> [--title T] [--base-url URL]`
  - `main(argv) → exitCode`, `resolveDeckId(value) → string`, `buildEnrollPlan(current, {deckId, title}) → plan`

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/2_domains/school/wordLadder/quizSource.test.mjs
import { describe, expect, it, vi } from 'vitest';
import { validateDocumentSource, publishDocument } from '#domains/school/documents/documentSource.mjs';
import { planRows } from '#domains/school/documents/allocation.mjs';
import { RecordCardScanOutcome } from '#apps/school/documents/RecordCardScanOutcome.mjs';
import { createDocumentPdfRenderer } from '#rendering/school/documents/DocumentPdfRenderer.mjs';
import { createMeasurementDocument, measureDocumentFragments } from '#rendering/school/documents/measure.mjs';
import { createWorkbookTheme } from '#rendering/school/documents/workbookTheme.mjs';
import { texToSvg } from '#rendering/school/documents/mathSvg.mjs';
import {
  QUIZ_INSTRUCTIONS, buildWordQuizSource, emptyStatus, foldPaperAttempts, quizDocumentIdFor, validateLexicon,
} from './index.mjs';

const { entries: LEXICON } = validateLexicon({ schema: 'school.word-lexicon/v1', entries: [
  { id: 'annyeong', kind: 'phrase', korean: '안녕', english: 'Hi (casual)', pronunciation: 'an-nyeong', decoys: { korean: ['안녕하세요', '안녕히계세요', '안경'], english: ['Hello (polite)', 'Thank you', 'Excuse me'] } },
  { id: 'annyeong-haseyo', kind: 'phrase', korean: '안녕하세요', english: 'Hello (polite)', pronunciation: 'an-nyeong-ha-se-yo', decoys: { korean: ['안녕히계세요', '안녕', '안녕히가세요'], english: ['Hi (casual)', 'Goodbye (to someone staying)', 'Thank you'] } },
  { id: 'gawi', kind: 'word', korean: '가위', english: 'Scissors', pronunciation: null, decoys: { korean: ['가지', '바위', '가방'], english: ['Knife', 'Tape', 'Ruler'] } },
] });
// annyeong-haseyo's decoy 'Goodbye (to someone staying)' is not an entry in THIS three-word fixture, so validation passes.
const DECK = { id: 'language/korean/week-01-classroom', title: 'Korean — Classroom', words: ['annyeong', 'annyeong-haseyo', 'gawi'] };

describe('buildWordQuizSource', () => {
  const source = buildWordQuizSource({ deck: DECK, lexicon: LEXICON, seed: 4242 });
  it('is a valid young-scale quiz source with the stuck-on-a-word instruction', () => {
    expect(validateDocumentSource(source).errors).toEqual([]);
    expect(source).toMatchObject({
      schema: 'school.document-source/v1', id: 'language/korean/week-01-classroom-quiz', subject: 'language',
      archetype: 'quiz', target: ['letter'], fit: { typeScale: 'young' }, header: { instructions: QUIZ_INSTRUCTIONS },
    });
    expect(QUIZ_INSTRUCTIONS).toBe('Not sure of a word? Open Korean words on the Portal and review the cards, then come back.');
    expect(quizDocumentIdFor(DECK.id)).toBe(source.id);
  });
  it('one question per word, itemId = word id, answer + 3 authored decoys, alternating directions', () => {
    const questions = source.blocks.filter((block) => block.type === 'question');
    expect(questions.map((q) => q.itemId)).toEqual(DECK.words);
    expect(questions.map((q) => q.number)).toEqual([1, 2, 3]);
    expect(questions[0].blocks[0].md).toBe('What does **안녕** mean?');
    expect(questions[0].choices).toContain('Hi (casual)');
    expect(questions[0].answer).toBe('Hi (casual)');
    expect(questions[1].blocks[0].md).toBe('Which is **Hello (polite)** in Korean?');
    expect(questions[1].answer).toBe('안녕하세요');
    for (const q of questions) {
      expect(q.choices).toHaveLength(4);
      expect(new Set(q.choices).size).toBe(4);
      expect(q.choices).toContain(q.answer);
    }
    expect(buildWordQuizSource({ deck: DECK, lexicon: LEXICON, seed: 4242 })).toEqual(source);
  });
  it('publishes, allocates rows whose itemId is the word id, and a scanned miss folds into a demotion', async () => {
    const { errors, published, bank, rev } = publishDocument(source);
    expect(errors).toBeUndefined();
    const { rows } = planRows({ document: published, bank, startRow: 1 });
    expect(rows.map((row) => row.itemId)).toEqual(DECK.words);
    expect(rows.every((row) => row.choiceCount === 4)).toBe(true);

    const appended = [];
    const datastore = { appendAttempt: (learnerId, attempt) => { appended.push(attempt); return attempt; }, readAllAttempts: () => [] };
    const scan = new RecordCardScanOutcome({ datastore, clock: () => new Date('2026-09-26T21:00:00.000Z'), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } });
    const results = rows.map((row, index) => ({
      row: row.row, itemId: row.itemId, itemType: row.itemType, prompt: null,
      status: index === 2 ? 'incorrect' : 'correct', given: 'x', points: 1, earned: index === 2 ? 0 : 1, concepts: [],
    }));
    await scan.execute({ testId: '1234567', card: {
      cardId: '1234567', recordId: `${published.id}@${rev}:v0:1-3`, documentId: published.id, rev, variant: 0,
      learnerId: 'kid', revisionSuperseded: false, renderedAt: '2026-09-25T20:00:00.000Z',
      results, totalPoints: 3, earnedPoints: 2, unscannedItems: [],
    } });
    expect(appended.map((a) => a.itemId)).toEqual(DECK.words);
    expect(appended.every((a) => a.transport === 'paper' && a.bankId === `${published.id}@${rev}`)).toBe(true);

    const { status, folded } = foldPaperAttempts({ status: emptyStatus(), attempts: appended, quizDocumentIds: [quizDocumentIdFor(DECK.id)], dayOf: (at) => at.slice(0, 10) });
    expect(folded.filter((row) => !row.correct).map((row) => row.wordId)).toEqual(['gawi']);
    expect(status.words.gawi.state).toBe('learning');
    expect(status.words.annyeong.state).toBe('new');
  });
  it('renders the instruction line under the title, inside the content width, with Hangul embedded', async () => {
    const { published, bank } = publishDocument(source);
    const theme = createWorkbookTheme({ typeScale: 'young' });
    const measureDoc = createMeasurementDocument({ theme });
    const [header] = measureDocumentFragments(published, { doc: measureDoc, theme, texToSvg });
    expect(header.nodes[0].instructions).toBe(QUIZ_INSTRUCTIONS);
    const style = theme.styles.caption ?? theme.styles.instruction ?? theme.styles.body;
    const width = measureDoc.font(theme.fonts[style.font].name).fontSize(style.sizePt).widthOfString(QUIZ_INSTRUCTIONS);
    // The line is drawn with lineBreak:false, so it must fit the quiz's gutter-narrowed content box.
    const contentWidthPt = theme.page.widthPt - 2 * theme.page.marginPt - theme.furniture.gutterPt;
    expect(width).toBeLessThanOrEqual(contentWidthPt);
    const { pdf } = await createDocumentPdfRenderer({ theme, texToSvg }).render(published, { bank });
    expect(pdf.toString('latin1')).toMatch(/NotoSansKR-Regular/);
  });
});
```

```js
// cli/school/koreanVocab.test.mjs
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dump, load } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';
import { buildEnrollPlan, main, resolveDeckId } from './koreanVocab.mjs';

const LEXICON = { schema: 'school.word-lexicon/v1', entries: [
  { id: 'gawi', kind: 'word', korean: '가위', english: 'Scissors', pronunciation: null, decoys: { korean: ['가지', '바위', '가방'], english: ['Knife', 'Tape', 'Ruler'] } },
] };

async function fixture(root) {
  await mkdir(path.join(root, 'media/school/language/korean-vocab'), { recursive: true });
  await writeFile(path.join(root, 'media/school/language/korean-vocab/lexicon.yml'), dump(LEXICON));
  const decks = path.join(root, 'data/content/school/learning-catalog/flashcard-decks/language/korean');
  await mkdir(decks, { recursive: true });
  await writeFile(path.join(decks, 'week-01-classroom.yml'), dump({ schema: 'school.flashcard-deck/v1', id: 'language/korean/week-01-classroom', title: 'Korean — Classroom', revision: 1, lexicon: 'media:language/korean-vocab/lexicon.yml', words: ['gawi'] }));
}
const io = () => ({ stdout: { write: vi.fn() }, stderr: { write: vi.fn() } });

describe('korean-vocab CLI', () => {
  it('resolves a deck slug', () => {
    expect(resolveDeckId('week-01-classroom')).toBe('language/korean/week-01-classroom');
    expect(resolveDeckId('language/korean/week-02-home')).toBe('language/korean/week-02-home');
  });
  it('quiz writes a document source under the learning-catalog documents root, idempotently', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'korean-vocab-'));
    try {
      await fixture(root);
      const argv = ['quiz', '--deck', 'week-01-classroom', '--data-dir', path.join(root, 'data'), '--media-dir', path.join(root, 'media')];
      expect(await main(argv, io())).toBe(0);
      const file = path.join(root, 'data/content/school/learning-catalog/documents/language/korean/week-01-classroom-quiz.yml');
      const source = load(await readFile(file, 'utf8'));
      expect(source.id).toBe('language/korean/week-01-classroom-quiz');
      expect(source.blocks.map((b) => b.itemId)).toEqual(['gawi']);
      expect(await main(argv, io())).toBe(0);
      await writeFile(file, 'schema: school.document-source/v1\nid: hand-edited\n');
      const out = io();
      expect(await main(argv, out)).toBe(1);
      expect(out.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/differs; pass --force/));
      expect(await main([...argv, '--force'], io())).toBe(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('enroll-plan appends (or replaces) the word-ladder program and keeps everything else', () => {
    const current = {
      learnerId: 'kid', updatedAt: '2026-09-04T05:35:39.484Z',
      courses: [{ courseId: 'atlas' }], units: [],
      programs: [{ programId: 'sentence-ladder', corpusId: 'glossika-korean' }, { programId: 'flashcards', deckId: 'language/korean/week-01-classroom', policy: { mode: 'word-ladder' } }],
    };
    const plan = buildEnrollPlan(current, { deckId: 'language/korean/week-02-home', title: 'Korean words' });
    expect(plan.courses).toEqual(current.courses);
    expect(plan.programs).toEqual([
      { programId: 'sentence-ladder', corpusId: 'glossika-korean' },
      { programId: 'flashcards', deckId: 'language/korean/week-02-home', title: 'Korean words', policy: { mode: 'word-ladder' }, schedule: { daysOfWeek: [1, 2, 3, 4, 5] } },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run backend/src/2_domains/school/wordLadder/quizSource.test.mjs cli/school/koreanVocab.test.mjs`
Expected: FAIL — `buildWordQuizSource` / `./koreanVocab.mjs` not found.

- [ ] **Step 3: Write the implementation**

```js
// backend/src/2_domains/school/wordLadder/quizSource.mjs
/**
 * The printed Friday quiz (design "Printed Friday quiz"): a
 * `school.document-source/v1` quiz with one question per deck word. Its
 * `itemId` IS the word id, so a scanned row's attempt names the word the
 * fold demotes. Text only; answer + 3 authored decoys; alternating
 * Korean→English / English→Korean by index. Deterministic from the seed.
 */
import { hashString, seededShuffle } from './checkItem.mjs';

export const QUIZ_INSTRUCTIONS = 'Not sure of a word? Open Korean words on the Portal and review the cards, then come back.';

export function quizDocumentIdFor(deckId) { return `${deckId}-quiz`; }

export function buildWordQuizSource({ deck, lexicon, seed }) {
  const missing = (deck?.words ?? []).filter((wordId) => !lexicon.has(wordId));
  if (!deck?.id || !Array.isArray(deck.words) || deck.words.length === 0) throw new Error('a quiz needs a deck with words');
  if (missing.length) throw new Error(`words not in the lexicon: ${missing.join(', ')}`);
  const blocks = deck.words.map((wordId, index) => {
    const entry = lexicon.get(wordId);
    const koreanToEnglish = index % 2 === 0;
    const answer = koreanToEnglish ? entry.english : entry.korean;
    const decoys = (koreanToEnglish ? entry.decoys.english : entry.decoys.korean).slice(0, 3);
    return {
      type: 'question',
      itemId: wordId,
      number: index + 1,
      blocks: [{ type: 'rich_text', md: koreanToEnglish ? `What does **${entry.korean}** mean?` : `Which is **${entry.english}** in Korean?` }],
      choices: seededShuffle([answer, ...decoys], hashString(`${seed}|${wordId}`)),
      answer,
    };
  });
  return {
    schema: 'school.document-source/v1',
    id: quizDocumentIdFor(deck.id),
    subject: deck.id.split('/')[0],
    topics: ['korean', 'vocabulary'],
    seed,
    target: ['letter'],
    archetype: 'quiz',
    title: `${deck.title} Quiz`,
    header: { instructions: QUIZ_INSTRUCTIONS },
    fit: { policy: 'flow', typeScale: 'young' },
    blocks,
  };
}
```

Append to `index.mjs`:

```js
export { QUIZ_INSTRUCTIONS, quizDocumentIdFor, buildWordQuizSource } from './quizSource.mjs';
```

```js
#!/usr/bin/env node
/**
 * cli/school/koreanVocab.mjs — `school korean-vocab` — word-ladder operations.
 *
 *   quiz         write the printed quiz SOURCE for a lexicon deck
 *                (then: `school docs publish <file>`, render with variety=omr)
 *   enroll-plan  write an `ops assign` plan file adding the word-ladder
 *                program to a learner's CURRENT assignment (then:
 *                `school ops assign <learner> --file <plan> … --apply`)
 *
 * A composition root: adapters are wired here, the rules are in
 * `#domains/school/wordLadder`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { YamlLearningContentRepository } from '#adapters/school/catalog/YamlLearningContentRepository.mjs';
import { YamlLexiconRepository } from '#adapters/school/catalog/YamlLexiconRepository.mjs';
import { LexiconDeckLoader } from '#adapters/school/catalog/LexiconDeckLoader.mjs';
import { buildWordQuizSource, hashString } from '#domains/school/wordLadder/index.mjs';

const ENTRYPOINT = fileURLToPath(import.meta.url);
const DEFAULT_BASE_URL = process.env.SCHOOL_BASE_URL || 'http://localhost:3111/api/v1/school';
const HELP = `school korean-vocab — word-ladder operations

Usage:
  school.mjs korean-vocab quiz --deck <deckId|slug> [--seed N] [--force]
                               [--data-dir P] [--media-dir P] [--source-root P]
  school.mjs korean-vocab enroll-plan --learner <id> --deck <deckId|slug> --out <file>
                               [--title TEXT] [--base-url URL]

A bare slug resolves to language/korean/<slug>.
quiz writes <source-root>/<deckId>-quiz.yml (default source root:
content/school/learning-catalog/documents under --data-dir). An identical file
is left alone; a different one is refused unless --force.
enroll-plan reads GET <base-url>/lifecycle/assignments/<learner> and writes a
plan for 'school ops assign' with the word-ladder program appended (or
replacing that learner's existing word-ladder program).
`;

export function resolveDeckId(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('--deck is required');
  return value.includes('/') ? value.trim() : `language/korean/${value.trim()}`;
}

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
}

function roots(argv, env = process.env) {
  const base = env.DAYLIGHT_BASE_PATH || '/usr/src/app';
  const dataDir = path.resolve(option(argv, '--data-dir') ?? path.join(base, 'data'));
  const mediaDir = path.resolve(option(argv, '--media-dir') ?? path.join(base, 'media'));
  const sourceRoot = path.resolve(dataDir, option(argv, '--source-root') ?? 'content/school/learning-catalog/documents');
  return { dataDir, mediaDir, sourceRoot };
}

async function quiz(argv, io) {
  const deckId = resolveDeckId(option(argv, '--deck'));
  const { dataDir, mediaDir, sourceRoot } = roots(argv);
  const lexicons = new YamlLexiconRepository({ mediaRoot: path.join(mediaDir, 'school') });
  const decks = new LexiconDeckLoader({
    content: new YamlLearningContentRepository({
      documentDirectories: [path.join(dataDir, 'content/school/learning-catalog/documents')],
      bankDirectories: [path.join(dataDir, 'content/school/learning-catalog/question-banks')],
      deckDirectories: [path.join(dataDir, 'content/school/learning-catalog/flashcard-decks')],
    }),
    lexicons,
  });
  const deck = await decks.getFlashcardDeck(deckId);
  if (!deck || !Array.isArray(deck.words)) throw new Error(`'${deckId}' is not a lexicon deck`);
  const seedFlag = option(argv, '--seed');
  const seed = seedFlag !== undefined ? Number(seedFlag) : hashString(deckId) % 100000;
  if (!Number.isInteger(seed) || seed < 0) throw new Error('--seed must be a whole number');
  const source = buildWordQuizSource({ deck, lexicon: lexicons.getLexicon(deck.lexicon), seed });
  const file = path.join(sourceRoot, `${source.id}.yml`);
  const text = yaml.dump(source, { lineWidth: -1, noRefs: true });
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') === text) { io.stdout.write(`unchanged: ${file}\n`); return 0; }
    if (!argv.includes('--force')) { io.stderr.write(`${file} differs; pass --force to overwrite\n`); return 1; }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  io.stdout.write(`wrote ${file}\nnext: node cli/school.mjs docs publish ${path.relative(sourceRoot, file)}\n`);
  return 0;
}

export function buildEnrollPlan(current, { deckId, title = null }) {
  const programs = (current?.programs ?? []).filter((row) => !(row?.programId === 'flashcards' && row.policy?.mode === 'word-ladder'));
  programs.push({
    programId: 'flashcards', deckId, ...(title ? { title } : {}),
    policy: { mode: 'word-ladder' }, schedule: { daysOfWeek: [1, 2, 3, 4, 5] },
  });
  return { courses: current?.courses ?? [], units: current?.units ?? [], programs };
}

async function enrollPlan(argv, io, fetchImpl = globalThis.fetch) {
  const learner = option(argv, '--learner');
  const out = option(argv, '--out');
  if (!learner || !out) throw new Error('enroll-plan requires --learner and --out');
  const deckId = resolveDeckId(option(argv, '--deck'));
  const baseUrl = (option(argv, '--base-url') ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const response = await fetchImpl(`${baseUrl}/lifecycle/assignments/${encodeURIComponent(learner)}`);
  if (!response.ok) throw new Error(`could not read ${learner}'s assignment (HTTP ${response.status})`);
  const plan = buildEnrollPlan(await response.json(), { deckId, title: option(argv, '--title') ?? null });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, yaml.dump(plan, { lineWidth: -1, noRefs: true }), 'utf8');
  io.stdout.write(`wrote ${out} (${plan.programs.length} programs)\n`);
  return 0;
}

export async function main(argv = process.argv.slice(2), io = process, deps = {}) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') { io.stdout.write(HELP); return command ? 0 : 2; }
  try {
    if (command === 'quiz') return await quiz(rest, io);
    if (command === 'enroll-plan') return await enrollPlan(rest, io, deps.fetch);
    io.stderr.write(HELP);
    return 2;
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === ENTRYPOINT) {
  main().then((code) => { process.exitCode = code; });
}
```

`cli/school.mjs` — add to `NAMESPACES` after `flashcards`:

```js
  'korean-vocab': {
    module: './school/koreanVocab.mjs',
    blurb: 'word ladder: printed quiz source, enrollment plan',
  },
```

`docs/reference/school/print-documents.md` §7 — append:

```markdown
### Word-ladder quizzes

`node cli/school.mjs korean-vocab quiz --deck <deckId|slug>` writes a
`school.document-source/v1` quiz for a lexicon deck at
`content/school/learning-catalog/documents/<deckId>-quiz.yml`: one `question`
per word with `itemId: <wordId>`, answer + three authored decoys, alternating
Korean→English / English→Korean, `fit.typeScale: young`, and the header
instruction `Not sure of a word? Open Korean on the Portal and review the
cards, then come back.` Publish it with `school docs publish`, then render per
learner with `variety=omr`. A scanned row's attempt carries the word id, and
the word ladder folds it (see `word-ladder.md`).
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run backend/src/2_domains/school/wordLadder/ cli/school/koreanVocab.test.mjs && node scripts/check-parse.mjs && node cli/school.mjs korean-vocab --help`
Expected: PASS; help text printed, exit 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/school/wordLadder/ cli/school/koreanVocab.mjs cli/school/koreanVocab.test.mjs cli/school.mjs docs/reference/school/print-documents.md
git commit -m "feat(school): korean-vocab quiz source generator and enrollment plan" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Shared speech floor

**Files:**
- Create: `frontend/src/modules/School/Programs/shared/speechFloor.js`
- Modify: `frontend/src/modules/School/Programs/SentenceLadder/rungs/RecordingRung.jsx` (L38-71 constants; L183-186 verdict; imports)
- Test: `frontend/src/modules/School/Programs/shared/speechFloor.test.js`

**Interfaces:**
- Produces: `SILENT_LEVEL = 0.04`, `SILENT_AFTER_MS = 2000`, `MIN_TAKE_MS = 1200`, `judgeTake({heard, sampled, durationMs}) → null|'too-quiet'|'too-short'`.

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/modules/School/Programs/shared/speechFloor.test.js
import { describe, expect, it } from 'vitest';
import { MIN_TAKE_MS, SILENT_AFTER_MS, SILENT_LEVEL, judgeTake } from './speechFloor.js';

describe('speech floor', () => {
  it('keeps the measured thresholds', () => {
    expect([SILENT_LEVEL, SILENT_AFTER_MS, MIN_TAKE_MS]).toEqual([0.04, 2000, 1200]);
  });
  it('refuses a measured take that was never heard', () => {
    expect(judgeTake({ heard: false, sampled: true, durationMs: 3000 })).toBe('too-quiet');
  });
  it('never refuses on loudness it could not measure', () => {
    expect(judgeTake({ heard: false, sampled: false, durationMs: 3000 })).toBeNull();
  });
  it('refuses a take shorter than the floor', () => {
    expect(judgeTake({ heard: true, sampled: true, durationMs: 1199 })).toBe('too-short');
    expect(judgeTake({ heard: true, sampled: true, durationMs: 1200 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/School/Programs/shared/speechFloor.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`speechFloor.js` — the constants and their doc comments move here verbatim from `RecordingRung.jsx` L38-71:

```js
// frontend/src/modules/School/Programs/shared/speechFloor.js
/**
 * The floor a spoken take has to clear, shared by every School program that
 * asks a child to say something (Sentence Ladder recording rung, word ladder
 * study card). One copy, so the two cannot drift.
 */

/** Below this shaped level for SILENT_AFTER_MS, the mic is called silent. */
export const SILENT_LEVEL = 0.04;
export const SILENT_AFTER_MS = 2000;
/**
 * The floor a take has to clear to be KEPT at all: long enough to be a
 * sentence, and loud enough to have been one.
 *
 * A rung that accepts anything is a rung that can be tapped through, and the
 * evidence that this was happening is in the log for 2026-09-11: six takes, the
 * last two at ~1s each with `heard: false`, one of them accepted 1 second after
 * it stopped. Recording was being spent rather than done.
 *
 * `heard` is the strong signal and does most of the work — it means the live
 * level never once crossed SILENT_LEVEL, and a real utterance always crosses
 * it. The duration floor catches the other shape: a tap, a cough, a single loud
 * syllable that clears the level but is not an attempt at the sentence.
 *
 * 1200ms IS NOT A GUESS. The six takes from that session were pulled off disk
 * and measured, and they separate cleanly:
 *
 *   take  length   peak      whisper no_speech   text
 *   1-4   1.74s     -0.0dB   0.035-0.093         real Korean sentences
 *          -2.58s   -4.5dB                       (incl. the 이 가방은/가방들은 pair)
 *   5     1.14s    -63.5dB   0.941               silence
 *   6     0.66s    -52.6dB   0.963               silence
 *
 * A -63dB peak is under a quiet room's noise floor; the spectrograms of 5 and 6
 * are black, with no harmonics or formants anywhere. Whisper returned the same
 * byte-identical Korean broadcast sign-off for both, which is its documented
 * hallucination on silence — two different files producing one phrase is the
 * tell. Spoken takes ran 1.74-2.58s and tapped-through ones 0.66-1.14s, so the
 * floor sits in the gap with room on either side.
 */
export const MIN_TAKE_MS = 1200;

/**
 * The finished take's verdict. WE ONLY REFUSE ON WHAT WE COULD MEASURE:
 * `heard` comes from a live level meter that needs an AudioContext, so
 * loudness is judged only when a level actually arrived (`sampled`); length
 * is judged always.
 */
export function judgeTake({ heard, sampled, durationMs }) {
  if (sampled === true && !heard) return 'too-quiet';
  if (durationMs < MIN_TAKE_MS) return 'too-short';
  return null;
}
```

`RecordingRung.jsx`:
- delete lines 38–71 (from `/** Below this shaped level for SILENT_AFTER_MS…` through `const MIN_TAKE_MS = 1200;`);
- add after `import useVoiceCapture from './useVoiceCapture.js';`:

```js
import { SILENT_AFTER_MS, SILENT_LEVEL, judgeTake } from '../../shared/speechFloor.js';
```
- replace

```js
    const verdict = measurable && !heard ? 'too-quiet'
      : durationMs < MIN_TAKE_MS ? 'too-short'
        : null;
```
with

```js
    const verdict = judgeTake({ heard, sampled: measurable, durationMs });
```
(`measurable` stays: it is still logged on refusal.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/src/modules/School/Programs/shared/ frontend/src/modules/School/Programs/SentenceLadder/`
Expected: PASS — the Sentence Ladder suites are unchanged in behaviour.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/School/Programs/shared/ frontend/src/modules/School/Programs/SentenceLadder/rungs/RecordingRung.jsx
git commit -m "refactor(school): share the recording speech floor" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: `WordLadderProgram` (checks → study → review quiz → done → review run)

**Files:**
- Create: `frontend/src/modules/School/Programs/Flashcards/WordLadder/wordLadderLog.js`
- Create: `frontend/src/modules/School/Programs/Flashcards/WordLadder/wordLadderApi.js`
- Create: `frontend/src/modules/School/Programs/Flashcards/WordLadder/wordLadderAudio.js`
- Create: `frontend/src/modules/School/Programs/Flashcards/WordLadder/CheckCard.jsx`
- Create: `frontend/src/modules/School/Programs/Flashcards/WordLadder/StudyCard.jsx`
- Create: `frontend/src/modules/School/Programs/Flashcards/WordLadder/WordLadderProgram.jsx`
- Create: `frontend/src/modules/School/Programs/Flashcards/WordLadder/WordLadder.scss`
- Test: `frontend/src/modules/School/Programs/Flashcards/WordLadder/WordLadderProgram.test.jsx`, `frontend/src/modules/School/Programs/Flashcards/WordLadder/wordLadderApi.test.js`

**Interfaces:**
- Consumes: Task 10 routes; Task 13 `judgeTake`, `SILENT_LEVEL`; `useCapabilities(corpusId, languages) → {capabilities: {microphone}, ready}`; `useVoiceCapture({onTake, onDenied}) → {start, stop, stream}`; `VoiceBand({stream, onLevel})`; `bindMediaToMaster(el) → unbind`; `Icon({name})`.
- Produces: `WordLadderProgram({descriptor: {deckId, userId}, api?, resolveAssetUrl?, onExit?})`; `nextStep(plan) → {type:'check'|'study'|'done', item?}`; `wordLadderApi.{open, plan, answer, uploadRecording, mark, viewReview, latestRecordingUrl}`.

- [ ] **Step 1: Write the failing tests**

```js
// frontend/src/modules/School/Programs/Flashcards/WordLadder/wordLadderApi.test.js
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wordLadderApi } from './wordLadderApi.js';

vi.mock('./wordLadderLog.js', () => ({ wordLadderLog: { apiRejected: vi.fn(), apiFailed: vi.fn() } }));

afterEach(() => { vi.unstubAllGlobals(); });

describe('wordLadderApi', () => {
  it('posts JSON and never throws', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ sessionId: 's1' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(wordLadderApi.open({ userId: 'kid', deckId: 'language/korean/week-01-classroom' })).resolves.toEqual({ ok: true, status: 200, data: { sessionId: 's1' } });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/school/word-ladder/open', expect.objectContaining({ method: 'POST', body: JSON.stringify({ userId: 'kid', deckId: 'language/korean/week-01-classroom' }) }));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(wordLadderApi.plan('s1', 'kid')).resolves.toEqual({ ok: false, status: 0, data: null });
  });
  it('uploads a take as a raw body with its own content type', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ take: 1 }) }));
    vi.stubGlobal('fetch', fetchMock);
    const blob = new Blob(['abc'], { type: 'audio/ogg' });
    await wordLadderApi.uploadRecording('s1', { userId: 'kid', wordId: 'gawi', blob });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/school/word-ladder/s1/cards/gawi/recording?userId=kid&ext=ogg');
    expect(init.headers['Content-Type']).toBe('audio/ogg');
    expect(init.body).toBe(blob);
  });
});
```

```jsx
// frontend/src/modules/School/Programs/Flashcards/WordLadder/WordLadderProgram.test.jsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ caps: { microphone: true }, handlers: null, takeMs: 1500 }));
vi.mock('../../SentenceLadder/useCapabilities.js', () => ({
  useCapabilities: () => ({ capabilities: { microphone: h.caps.microphone, textInput: [] }, ready: true }),
}));
vi.mock('../../SentenceLadder/rungs/useVoiceCapture.js', () => ({
  default: (handlers) => {
    h.handlers = handlers;
    return {
      start: vi.fn(async () => true),
      stop: vi.fn(() => h.handlers.onTake?.({ blob: new Blob(['take'], { type: 'audio/webm' }), durationMs: h.takeMs })),
      cancel: vi.fn(), release: vi.fn(), stream: null, isRecording: false,
    };
  },
}));
vi.mock('../../SentenceLadder/rungs/VoiceBand.jsx', () => ({ default: () => null }));
vi.mock('./wordLadderAudio.js', () => ({ playClip: vi.fn(async () => true), playSequence: vi.fn(async () => {}) }));
vi.mock('./wordLadderLog.js', () => ({
  wordLadderLog: new Proxy({}, { get: () => vi.fn() }),
}));

import WordLadderProgram, { nextStep } from './WordLadderProgram.jsx';

const card = (wordId, korean, english, media = { image: null, audio: null }) => ({ wordId, kind: 'word', korean, english, pronunciation: null, media });
const GAWI = card('gawi', '가위', 'Scissors');
const PUL = card('pul', '풀', 'Glue');
const basePlan = (over = {}) => ({
  day: '2026-09-22', deckId: 'language/korean/week-01-classroom',
  checks: [{ wordId: 'gawi', kind: 'word', phase: 'check', direction: 'korean_to_english', prompt: { type: 'text', text: '가위' }, choices: ['Knife', 'Scissors', 'Tape', 'Ruler'], done: false, correct: null }],
  study: [{ wordId: 'pul', studied: false, recording: null, marked: null, done: false, card: PUL }],
  review: [], deckCards: [GAWI, PUL], remaining: { checks: 1, study: 1, review: 0 }, doneToday: false, progressLabel: '1 check · 1 to study',
  ...over,
});
const checked = (plan) => ({ ...plan, checks: plan.checks.map((c) => ({ ...c, done: true, correct: true })) });
const studied = (plan, recording = 'taken') => ({ ...plan, study: plan.study.map((s) => ({ ...s, studied: true, recording })) });
const finished = (plan) => ({ ...plan, study: plan.study.map((s) => ({ ...s, marked: 'know', done: true })), doneToday: true, progressLabel: 'Done for today' });

function fakeApi(plan) {
  let current = plan;
  return {
    open: vi.fn(async () => ({ ok: true, status: 200, data: { sessionId: 's1', day: '2026-09-22', folded: 0, plan: current } })),
    answer: vi.fn(async () => { current = checked(current); return { ok: true, status: 200, data: { correct: true, answer: 'Scissors', card: GAWI, plan: current } }; }),
    uploadRecording: vi.fn(async () => { current = studied(current); return { ok: true, status: 200, data: { take: 1, plan: current } }; }),
    mark: vi.fn(async (sessionId, { recording }) => { current = finished(recording ? studied(current, 'unavailable') : current); return { ok: true, status: 200, data: { plan: current } }; }),
    viewReview: vi.fn(async () => ({ ok: true, status: 200, data: { logged: true } })),
  };
}

beforeEach(() => {
  h.caps.microphone = true; h.takeMs = 1500;
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:take');
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('WordLadderProgram', () => {
  it('orders the day: checks, then study, then review quiz', () => {
    const plan = basePlan();
    expect(nextStep(plan)).toMatchObject({ type: 'check', item: { wordId: 'gawi' } });
    expect(nextStep(checked(plan))).toMatchObject({ type: 'study', item: { wordId: 'pul' } });
    expect(nextStep(finished(checked(plan)))).toEqual({ type: 'done' });
  });

  it('runs a day: check → study (record, flip, "I know it") → done → review run', async () => {
    const api = fakeApi(basePlan());
    render(<WordLadderProgram descriptor={{ deckId: 'language/korean/week-01-classroom', userId: 'kid' }} api={api} resolveAssetUrl={(id) => `/assets/${id}`} />);
    expect(await screen.findByText('가위')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Scissors' }));
    expect(await screen.findByText('Right!')).toBeInTheDocument();
    expect(api.answer).toHaveBeenCalledWith('s1', { userId: 'kid', wordId: 'gawi', choice: 'Scissors' });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('풀')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Flip' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(api.uploadRecording).toHaveBeenCalledWith('s1', expect.objectContaining({ userId: 'kid', wordId: 'pul' })));
    fireEvent.click(await screen.findByRole('button', { name: 'Flip' }));
    expect(screen.getByText('Glue')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'I know it' }));
    await waitFor(() => expect(api.mark).toHaveBeenCalledWith('s1', { userId: 'kid', wordId: 'pul', mark: 'know', recording: null }));

    expect(await screen.findByText('All done for today')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review the cards' }));
    expect(await screen.findByText('가위')).toBeInTheDocument();
    await waitFor(() => expect(api.viewReview).toHaveBeenCalledWith('s1', { userId: 'kid', wordId: 'gawi' }));
    expect(screen.queryByRole('button', { name: 'I know it' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Flip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }));
    expect(await screen.findByText('풀')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Flip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }));
    expect(await screen.findByText("That's every card")).toBeInTheDocument();
    expect(api.viewReview).toHaveBeenCalledTimes(2);
  });

  it('refuses a take below the speech floor and asks again', async () => {
    h.takeMs = 400;
    const api = fakeApi(checked(basePlan()));
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Record' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(await screen.findByText('Say the whole word, then stop.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record again' })).toBeInTheDocument();
    expect(api.uploadRecording).not.toHaveBeenCalled();
  });

  it('mic unavailable: no record step; the mark says why', async () => {
    h.caps.microphone = false;
    const api = fakeApi(checked(basePlan()));
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={api} />);
    expect(await screen.findByText('풀')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Flip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Still learning' }));
    await waitFor(() => expect(api.mark).toHaveBeenCalledWith('s1', { userId: 'kid', wordId: 'pul', mark: 'learning', recording: { status: 'unavailable', reason: 'no-device' } }));
    expect(await screen.findByText('All done for today')).toBeInTheDocument();
  });

  it('renders around missing media and shows media that exists', async () => {
    const api = fakeApi(checked(basePlan()));
    const { unmount } = render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={api} />);
    expect(await screen.findByText('풀')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hear it' })).toBeNull();
    unmount();
    const withMedia = { ...PUL, media: { image: 'media:language/korean-vocab/words/pul/image.jpg', audio: 'media:language/korean-vocab/words/pul/ko.mp3' } };
    const api2 = fakeApi(checked(basePlan({ study: [{ wordId: 'pul', studied: false, recording: null, marked: null, done: false, card: withMedia }] })));
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={api2} resolveAssetUrl={(id) => `/assets/${id}`} />);
    expect(await screen.findByRole('img', { name: 'Glue' })).toHaveAttribute('src', '/assets/media:language/korean-vocab/words/pul/image.jpg');
    expect(screen.getByRole('button', { name: 'Hear it' })).toBeInTheDocument();
  });

  it('a finished day lands straight on the review run', async () => {
    const api = fakeApi(finished(checked(basePlan())));
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={api} />);
    expect(await screen.findByRole('region', { name: 'Review card' })).toBeInTheDocument();
    expect(screen.getByText('가위')).toBeInTheDocument();
  });

  it('says so when the list cannot open', async () => {
    const api = { ...fakeApi(basePlan()), open: vi.fn(async () => ({ ok: false, status: 403, data: null })) };
    const onExit = vi.fn();
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={api} onExit={onExit} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This word list is not ready right now.');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onExit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run frontend/src/modules/School/Programs/Flashcards/WordLadder/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

```js
// frontend/src/modules/School/Programs/Flashcards/WordLadder/wordLadderLog.js
/**
 * Word-ladder logging facade (pattern: Feed/Scroll/feedLog.js). Never raw
 * console.* — every event lands in the log store as `school.word-ladder.*`.
 */
import getLogger from '../../../../../lib/logging/Logger.js';

function logger() {
  return getLogger().child({ component: 'school-word-ladder' });
}
function emit(event, data, level = 'info') {
  logger()[level](`school.word-ladder.${event}`, typeof data === 'object' && data !== null ? { ...data } : {});
}

export const wordLadderLog = {
  mounted: (data) => emit('mounted', data),
  unmounted: (data) => emit('unmounted', data),
  planLoaded: (data) => emit('plan.loaded', data),                       // counts + folded
  planFailed: (data) => emit('plan.failed', data, 'error'),
  checkAnswered: (data) => emit('check.answered', data),
  cardMarked: (data) => emit('card.marked', data),
  recordingUploaded: (data) => emit('recording.uploaded', data),
  recordingFailed: (data) => emit('recording.failed', data, 'warn'),
  recordingRefused: (data) => emit('recording.refused', data),
  micUnavailable: (data) => emit('mic.unavailable', data, 'warn'),
  reviewStarted: (data) => emit('review.started', data),
  reviewViewed: (data) => emit('review.viewed', data, 'debug'),
  done: (data) => emit('day.done', data),
  audioBlocked: (data) => emit('audio.blocked', data, 'debug'),
  apiRejected: (data) => emit('api.rejected', data, 'warn'),
  apiFailed: (data) => emit('api.failed', data, 'error'),
};

export default wordLadderLog;
```

```js
// frontend/src/modules/School/Programs/Flashcards/WordLadder/wordLadderApi.js
/**
 * /api/v1/school/word-ladder client. Status-aware and never throws, like
 * schoolApi.js: the program must tell 403 (not assigned) from 404 (session
 * gone) from 0 (offline).
 */
import { wordLadderLog } from './wordLadderLog.js';

const BASE = '/api/v1/school/word-ladder';
const enc = encodeURIComponent;

async function call(path, { method = 'GET', body, raw = false, headers = {} } = {}) {
  const startedAt = Date.now();
  try {
    const init = { method, credentials: 'same-origin', headers: { ...headers } };
    if (body !== undefined) {
      if (raw) init.body = body;
      else { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    }
    const r = await fetch(`${BASE}${path}`, init);
    const data = await r.json().catch(() => null);
    if (!r.ok) wordLadderLog.apiRejected({ path: path.split('?')[0], method, status: r.status, ms: Date.now() - startedAt, error: data?.error ?? null });
    return { ok: r.ok, status: r.status, data };
  } catch (error) {
    wordLadderLog.apiFailed({ path: path.split('?')[0], method, error: error?.message ?? String(error) });
    return { ok: false, status: 0, data: null };
  }
}

const extFor = (type = '') => (type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm');

export const wordLadderApi = {
  open: ({ userId, deckId }) => call('/open', { method: 'POST', body: { userId, deckId } }),
  plan: (sessionId, userId) => call(`/${enc(sessionId)}/plan?userId=${enc(userId)}`),
  answer: (sessionId, { userId, wordId, choice }) => call(`/${enc(sessionId)}/checks/${enc(wordId)}`, { method: 'POST', body: { userId, choice } }),
  uploadRecording: (sessionId, { userId, wordId, blob }) => call(
    `/${enc(sessionId)}/cards/${enc(wordId)}/recording?userId=${enc(userId)}&ext=${extFor(blob?.type)}`,
    { method: 'POST', body: blob, raw: true, headers: { 'Content-Type': blob?.type || 'audio/webm' } },
  ),
  mark: (sessionId, { userId, wordId, mark, recording = null }) => call(`/${enc(sessionId)}/cards/${enc(wordId)}/mark`, { method: 'POST', body: { userId, mark, recording } }),
  viewReview: (sessionId, { userId, wordId }) => call(`/${enc(sessionId)}/review/${enc(wordId)}`, { method: 'POST', body: { userId } }),
  latestRecordingUrl: (sessionId, { userId, wordId }) => `${BASE}/${enc(sessionId)}/cards/${enc(wordId)}/recording/latest?userId=${enc(userId)}`,
};

export default wordLadderApi;
```

```js
// frontend/src/modules/School/Programs/Flashcards/WordLadder/wordLadderAudio.js
import { bindMediaToMaster } from '../../../../../lib/volume/bindMediaToMaster.js';
import { wordLadderLog } from './wordLadderLog.js';

/** Play one clip at the panel's master volume. Resolves true when it ended, false otherwise. */
export function playClip(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(false); return; }
    const el = new Audio(url);
    const unbind = bindMediaToMaster(el);
    const finish = (ok) => { unbind?.(); resolve(ok); };
    el.onended = () => finish(true);
    el.onerror = () => finish(false);
    const result = el.play();
    if (result?.catch) result.catch((error) => { wordLadderLog.audioBlocked({ url, error: error?.message }); finish(false); });
  });
}

/** The learner's take, then the native audio — one after the other. */
export async function playSequence(urls) {
  for (const url of urls) {
    // eslint-disable-next-line no-await-in-loop
    await playClip(url);
  }
}
```

```jsx
// frontend/src/modules/School/Programs/Flashcards/WordLadder/StudyCard.jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../../../home/icons/Icon.jsx';
import VoiceBand from '../../SentenceLadder/rungs/VoiceBand.jsx';
import useVoiceCapture from '../../SentenceLadder/rungs/useVoiceCapture.js';
import { SILENT_LEVEL, judgeTake } from '../../shared/speechFloor.js';
import { playClip, playSequence } from './wordLadderAudio.js';
import { wordLadderLog } from './wordLadderLog.js';

/** Picture, Korean, native audio. Anything missing is simply not drawn. */
export function WordFace({ card, resolveAssetUrl }) {
  return (
    <div className="word-ladder-face">
      {card.media?.image && <img className="word-ladder-picture" src={resolveAssetUrl(card.media.image)} alt={card.english} />}
      <p className="word-ladder-korean" lang="ko">{card.korean}</p>
      {card.media?.audio && (
        <button type="button" className="word-ladder-hear" onClick={() => playClip(resolveAssetUrl(card.media.audio))}>
          <Icon name="volume" /> Hear it
        </button>
      )}
    </div>
  );
}

const VERDICT_COPY = {
  'too-quiet': "I couldn't hear you — say it out loud.",
  'too-short': 'Say the whole word, then stop.',
};

/**
 * One study card: front plays ko.mp3; record (when the mic is available) →
 * the take plays back, then the native audio; flip to English; mark.
 * `reviewOnly` is the rev-3 review run: flip and move on, nothing else.
 */
export default function StudyCard({
  card, needsRecording = false, resolveAssetUrl = (id) => id, onRecorded = async () => false,
  onMark = async () => {}, onMicUnavailable = () => {}, reviewOnly = false, onNext = () => {},
}) {
  const [flipped, setFlipped] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | recording | saving
  const [recorded, setRecorded] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const [busy, setBusy] = useState(false);
  const levels = useRef({ heard: false, sampled: false });
  const nativeUrl = card.media?.audio ? resolveAssetUrl(card.media.audio) : null;

  useEffect(() => {
    setFlipped(false); setPhase('idle'); setRecorded(false); setVerdict(null); setBusy(false);
    if (nativeUrl) playClip(nativeUrl);
  // Reset once per card; nativeUrl is derived from the same card.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.wordId]);

  const onTake = useCallback(async ({ blob, durationMs }) => {
    const takeVerdict = judgeTake({ heard: levels.current.heard, sampled: levels.current.sampled, durationMs });
    if (takeVerdict) {
      setVerdict(takeVerdict); setPhase('idle');
      wordLadderLog.recordingRefused({ wordId: card.wordId, reason: takeVerdict, durationMs, bytes: blob?.size ?? null });
      return;
    }
    setVerdict(null); setPhase('saving');
    const ok = await onRecorded(blob);
    setPhase('idle');
    if (!ok) return;
    setRecorded(true);
    const takeUrl = URL.createObjectURL(blob);
    await playSequence([takeUrl, nativeUrl].filter(Boolean));
    URL.revokeObjectURL(takeUrl);
  }, [card.wordId, nativeUrl, onRecorded]);

  const onDenied = useCallback((error) => {
    setPhase('idle');
    onMicUnavailable(error?.name || 'denied');
  }, [onMicUnavailable]);

  const { start, stop, stream } = useVoiceCapture({ onTake, onDenied });
  const onLevel = useCallback((level) => {
    levels.current.sampled = true;
    if (level >= SILENT_LEVEL) levels.current.heard = true;
  }, []);
  const beginRecording = async () => {
    levels.current = { heard: false, sampled: false };
    setVerdict(null);
    if (await start()) setPhase('recording');
  };
  const mark = async (value) => {
    if (busy) return;
    setBusy(true);
    await onMark(value);
    setBusy(false);
  };
  const showRecorder = !reviewOnly && needsRecording && !recorded && !flipped;
  const canFlip = reviewOnly || !needsRecording || recorded;

  return (
    <section className="word-ladder-card word-ladder-study" aria-label={reviewOnly ? 'Review card' : 'Study card'}>
      {flipped ? (
        <div className="word-ladder-back">
          <p className="word-ladder-english">{card.english}</p>
          {card.pronunciation && <p className="word-ladder-pronunciation">{card.pronunciation}</p>}
        </div>
      ) : <WordFace card={card} resolveAssetUrl={resolveAssetUrl} />}
      {showRecorder && (
        <div className="word-ladder-record">
          <VoiceBand stream={phase === 'recording' ? stream : null} onLevel={phase === 'recording' ? onLevel : null} />
          {phase === 'recording' ? (
            <button type="button" onClick={() => stop()}><Icon name="stop" /> Stop</button>
          ) : (
            <button type="button" disabled={phase === 'saving'} onClick={beginRecording}>
              <Icon name={verdict ? 'record-again' : 'record'} /> {verdict ? 'Record again' : 'Record'}
            </button>
          )}
          {verdict && <p role="status">{VERDICT_COPY[verdict]}</p>}
        </div>
      )}
      {!flipped && canFlip && <button type="button" className="word-ladder-flip" onClick={() => setFlipped(true)}>Flip</button>}
      {flipped && !reviewOnly && (
        <div className="word-ladder-marks">
          <button type="button" disabled={busy} onClick={() => mark('know')}><Icon name="keep" /> I know it</button>
          <button type="button" disabled={busy} onClick={() => mark('learning')}>Still learning</button>
        </div>
      )}
      {flipped && reviewOnly && <button type="button" onClick={onNext}><Icon name="next" /> Next card</button>}
    </section>
  );
}
```

```jsx
// frontend/src/modules/School/Programs/Flashcards/WordLadder/CheckCard.jsx
import { useEffect, useState } from 'react';
import Icon from '../../../home/icons/Icon.jsx';
import { WordFace } from './StudyCard.jsx';
import { playClip } from './wordLadderAudio.js';

/** One graded check. The server grades; this only shows the prompt, the four choices, and the result. */
export default function CheckCard({ item, result = null, resolveAssetUrl = (id) => id, onAnswer = async () => {}, onContinue = () => {} }) {
  const [busy, setBusy] = useState(false);
  const promptUrl = item.prompt?.assetId ? resolveAssetUrl(item.prompt.assetId) : null;
  useEffect(() => {
    setBusy(false);
    if (!result && item.prompt?.type === 'audio' && promptUrl) playClip(promptUrl);
  // Once per check; a result for the same item must not replay the prompt.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.wordId, item.phase]);
  const choose = async (choice) => {
    if (busy || result) return;
    setBusy(true);
    await onAnswer(item, choice);
    setBusy(false);
  };
  return (
    <section className="word-ladder-card word-ladder-check" aria-label={item.phase === 'review' ? 'Review quiz' : 'Check'}>
      <div className="word-ladder-prompt">
        {item.prompt?.type === 'image' && <img className="word-ladder-picture" src={promptUrl} alt="Picture" />}
        {item.prompt?.type === 'audio' && (
          <button type="button" className="word-ladder-hear" onClick={() => playClip(promptUrl)}><Icon name="volume" /> Hear it</button>
        )}
        {item.prompt?.type === 'text' && <p className="word-ladder-korean" lang="ko">{item.prompt.text}</p>}
      </div>
      <div className="word-ladder-choices" role="group" aria-label="Choices">
        {item.choices.map((choice) => (
          <button
            key={choice}
            type="button"
            disabled={busy || Boolean(result)}
            className={`word-ladder-choice${result && choice === result.answer ? ' is-answer' : ''}`}
            onClick={() => choose(choice)}
          >
            {choice}
          </button>
        ))}
      </div>
      {result?.correct === true && <p className="word-ladder-tick" role="status"><Icon name="keep" /> Right!</p>}
      {result?.correct === false && (
        <div className="word-ladder-correction" role="status">
          <p>Not quite. Here is the card:</p>
          <WordFace card={result.card} resolveAssetUrl={resolveAssetUrl} />
          <p className="word-ladder-english">{result.card.english}</p>
        </div>
      )}
      {result && <button type="button" className="word-ladder-next" onClick={onContinue}><Icon name="next" /> Next</button>}
    </section>
  );
}
```

```jsx
// frontend/src/modules/School/Programs/Flashcards/WordLadder/WordLadderProgram.jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCapabilities } from '../../SentenceLadder/useCapabilities.js';
import CheckCard from './CheckCard.jsx';
import StudyCard from './StudyCard.jsx';
import { wordLadderApi } from './wordLadderApi.js';
import { playClip } from './wordLadderAudio.js';
import { wordLadderLog } from './wordLadderLog.js';
import './WordLadder.scss';

const LANGUAGES = Object.freeze({ source: 'en', target: 'ko' });
const CAPABILITY_KEY = 'korean-vocab';

/** Checks, then study (including today's misses), then the review quiz. */
export function nextStep(plan) {
  const check = plan.checks.find((item) => !item.done);
  if (check) return { type: 'check', item: check };
  const study = plan.study.find((item) => !item.done);
  if (study) return { type: 'study', item: study };
  const quiz = plan.review.find((item) => !item.done);
  if (quiz) return { type: 'check', item: quiz };
  return { type: 'done' };
}

/**
 * The Korean word ladder (flashcards `policy.mode: word-ladder`). The server
 * owns the day: it freezes the plan, grades every check and decides credit.
 * A finished day lands on the review run (design rev 3): every deck card,
 * flip only, as many times as the child wants.
 */
export default function WordLadderProgram({ descriptor, api = wordLadderApi, resolveAssetUrl = (id) => id, onExit = () => {} }) {
  const userId = descriptor?.userId ?? null;
  const deckId = descriptor?.deckId ?? null;
  const { capabilities, ready } = useCapabilities(CAPABILITY_KEY, LANGUAGES);
  const [sessionId, setSessionId] = useState(null);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [micReason, setMicReason] = useState(null);
  const [reviewRun, setReviewRun] = useState(null);
  const doneLogged = useRef(false);

  useEffect(() => {
    wordLadderLog.mounted({ userId, deckId });
    return () => wordLadderLog.unmounted({ userId, deckId });
  }, [userId, deckId]);

  useEffect(() => {
    if (!userId || !deckId) return undefined;
    let live = true;
    api.open({ userId, deckId }).then(({ ok, status, data }) => {
      if (!live) return;
      if (!ok || !data?.plan) {
        setError('This word list is not ready right now.');
        wordLadderLog.planFailed({ userId, deckId, status });
        return;
      }
      setSessionId(data.sessionId);
      setPlan(data.plan);
      wordLadderLog.planLoaded({
        userId, deckId, day: data.day, folded: data.folded ?? 0, doneToday: data.plan.doneToday,
        checks: data.plan.checks.length, study: data.plan.study.length, review: data.plan.review.length,
      });
      if (data.plan.doneToday) {
        setReviewRun({ index: 0 });
        wordLadderLog.reviewStarted({ userId, deckId, from: 'open' });
      }
    });
    return () => { live = false; };
  }, [api, userId, deckId]);

  const deviceMic = ready && capabilities.microphone === true;
  const micAvailable = deviceMic && !micReason;
  const unavailableReason = micReason ?? (ready && !deviceMic ? 'no-device' : null);
  useEffect(() => {
    if (ready && !deviceMic) wordLadderLog.micUnavailable({ userId, reason: 'no-device' });
  }, [ready, deviceMic, userId]);

  useEffect(() => {
    if (plan?.doneToday && !doneLogged.current) {
      doneLogged.current = true;
      wordLadderLog.done({ userId, deckId });
    }
  }, [plan?.doneToday, userId, deckId]);

  const reviewCard = reviewRun && plan ? plan.deckCards?.[reviewRun.index] ?? null : null;
  useEffect(() => {
    if (!reviewCard || !sessionId) return;
    wordLadderLog.reviewViewed({ userId, wordId: reviewCard.wordId });
    api.viewReview(sessionId, { userId, wordId: reviewCard.wordId });
  }, [reviewRun, reviewCard, sessionId, userId, api]);

  const answer = useCallback(async (item, choice) => {
    const { ok, data } = await api.answer(sessionId, { userId, wordId: item.wordId, choice });
    if (!ok || !data) return;
    wordLadderLog.checkAnswered({ userId, wordId: item.wordId, phase: item.phase, direction: item.direction, correct: data.correct });
    if (!data.correct && data.card?.media?.audio) playClip(resolveAssetUrl(data.card.media.audio));
    setFeedback({ item, result: { correct: data.correct, answer: data.answer, card: data.card } });
    setPlan(data.plan);
  }, [api, sessionId, userId, resolveAssetUrl]);

  const record = useCallback(async (wordId, blob) => {
    const { ok, status, data } = await api.uploadRecording(sessionId, { userId, wordId, blob });
    if (!ok || !data) {
      wordLadderLog.recordingFailed({ userId, wordId, status, bytes: blob?.size ?? null });
      return false;
    }
    wordLadderLog.recordingUploaded({ userId, wordId, take: data.take, bytes: blob?.size ?? null });
    setPlan(data.plan);
    return true;
  }, [api, sessionId, userId]);

  const mark = useCallback(async (item, value) => {
    const recording = item.studied ? null : { status: 'unavailable', reason: unavailableReason ?? 'unknown' };
    const { ok, data } = await api.mark(sessionId, { userId, wordId: item.wordId, mark: value, recording });
    if (!ok || !data) return;
    wordLadderLog.cardMarked({ userId, wordId: item.wordId, mark: value, recording: recording ? 'unavailable' : 'taken' });
    setPlan(data.plan);
  }, [api, sessionId, userId, unavailableReason]);

  const onMicUnavailable = useCallback((reason) => {
    setMicReason(reason);
    wordLadderLog.micUnavailable({ userId, reason });
  }, [userId]);

  const startReview = () => {
    setReviewRun({ index: 0 });
    wordLadderLog.reviewStarted({ userId, deckId, from: 'done' });
  };

  if (error) {
    return (
      <div className="word-ladder" role="alert">
        <p>{error}</p>
        <button type="button" onClick={onExit}>Back</button>
      </div>
    );
  }
  if (!plan || !ready) return <div className="word-ladder"><p>Loading…</p></div>;

  const header = <header className="word-ladder-header"><p aria-label="Today">{plan.progressLabel}</p></header>;

  if (reviewRun) {
    if (!reviewCard) {
      return (
        <div className="word-ladder word-ladder-done">
          {header}
          <h2>That&apos;s every card</h2>
          <button type="button" onClick={startReview}>Review again</button>
          <button type="button" onClick={onExit}>Done</button>
        </div>
      );
    }
    return (
      <div className="word-ladder">
        {header}
        <StudyCard
          key={`review:${reviewRun.index}:${reviewCard.wordId}`}
          card={reviewCard}
          reviewOnly
          resolveAssetUrl={resolveAssetUrl}
          onNext={() => setReviewRun({ index: reviewRun.index + 1 })}
        />
      </div>
    );
  }

  if (feedback) {
    return (
      <div className="word-ladder">
        {header}
        <CheckCard item={feedback.item} result={feedback.result} resolveAssetUrl={resolveAssetUrl} onContinue={() => setFeedback(null)} />
      </div>
    );
  }

  const step = nextStep(plan);
  if (step.type === 'done') {
    return (
      <div className="word-ladder word-ladder-done">
        {header}
        <h2>All done for today</h2>
        <button type="button" onClick={startReview}>Review the cards</button>
        <button type="button" onClick={onExit}>Done</button>
      </div>
    );
  }
  return (
    <div className="word-ladder">
      {header}
      {step.type === 'check' ? (
        <CheckCard key={`${step.item.phase}:${step.item.wordId}`} item={step.item} resolveAssetUrl={resolveAssetUrl} onAnswer={answer} />
      ) : (
        <StudyCard
          key={`study:${step.item.wordId}`}
          card={step.item.card}
          needsRecording={micAvailable && !step.item.studied}
          resolveAssetUrl={resolveAssetUrl}
          onRecorded={(blob) => record(step.item.wordId, blob)}
          onMark={(value) => mark(step.item, value)}
          onMicUnavailable={onMicUnavailable}
        />
      )}
    </div>
  );
}
```

```scss
// frontend/src/modules/School/Programs/Flashcards/WordLadder/WordLadder.scss
.word-ladder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.25rem;
  padding: 1.5rem;
  min-height: 100%;
}
.word-ladder-header { align-self: stretch; text-align: right; opacity: 0.75; }
.word-ladder-card { display: flex; flex-direction: column; align-items: center; gap: 1rem; width: min(40rem, 100%); }
.word-ladder-picture { max-width: 100%; max-height: 16rem; object-fit: contain; border-radius: 0.75rem; }
.word-ladder-korean { font-size: 3rem; font-weight: 700; margin: 0; }
.word-ladder-english { font-size: 2.25rem; margin: 0; }
.word-ladder-pronunciation { font-size: 1.25rem; opacity: 0.8; margin: 0; }
.word-ladder-choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; width: 100%; }
.word-ladder-choice { font-size: 1.5rem; padding: 1rem; }
.word-ladder-choice.is-answer { outline: 3px solid currentColor; }
.word-ladder-record, .word-ladder-marks { display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: center; }
.word-ladder button { min-height: 3.5rem; min-width: 7rem; font-size: 1.25rem; border-radius: 0.75rem; }
.word-ladder-tick { font-size: 1.75rem; }
.word-ladder-done h2 { font-size: 2rem; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/src/modules/School/Programs/Flashcards/WordLadder/`
Expected: PASS (2 + 7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/School/Programs/Flashcards/WordLadder/
git commit -m "feat(school): WordLadderProgram — checks, recorded study, review quiz and review run" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Route word-ladder launches in `SchoolApp`

**Files:**
- Modify: `frontend/src/modules/School/SchoolApp.jsx` (imports ~L31; `onPortalLaunch` flashcards branch L520; runner render after the `flashcard_program` block ~L1170)
- Test: `frontend/src/modules/School/SchoolApp.launch.test.jsx` (new `describe`)

**Interfaces:**
- Consumes: `WordLadderProgram` (Task 14); launch target `{kind:'program', program:'flashcards', deckId, policy:{mode:'word-ladder'}}` (Task 9 `issueLaunchTarget`).
- Produces: `active = {mode:'word_ladder', descriptor:{deckId, userId}}`.

- [ ] **Step 1: Write the failing test** — in `SchoolApp.launch.test.jsx`, next to the other `vi.mock` stubs add:

```jsx
const wordLadderProps = vi.fn();
vi.mock('./Programs/Flashcards/WordLadder/WordLadderProgram.jsx', () => ({
  default: (props) => { wordLadderProps(props); return <div data-testid="word-ladder-stub">word ladder</div>; },
}));
```

and append:

```jsx
describe('SchoolApp — word-ladder flashcards target', () => {
  const TARGET = { kind: 'program', program: 'flashcards', deckId: 'language/korean/week-01-classroom', policy: { mode: 'word-ladder' } };

  it('mounts the word ladder (not the FSRS player) for the launched learner and answers true', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />);
    await screen.findByText('Civilization');
    let mounted;
    await act(async () => {
      launchHook.claim('kid1');
      mounted = await launchHook.onLaunch(TARGET, 'kid1');
    });
    expect(mounted).toBe(true);
    expect(await screen.findByTestId('word-ladder-stub')).toBeInTheDocument();
    const props = wordLadderProps.mock.calls.at(-1)[0];
    expect(props.descriptor).toEqual({ deckId: 'language/korean/week-01-classroom', userId: 'kid1' });
    expect(typeof props.onExit).toBe('function');
    expect(typeof props.resolveAssetUrl).toBe('function');
  });

  it('answers false without a deck', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />);
    await screen.findByText('Civilization');
    let mounted;
    await act(async () => { mounted = await launchHook.onLaunch({ ...TARGET, deckId: null }, 'kid1'); });
    expect(mounted).toBe(false);
    expect(screen.queryByTestId('word-ladder-stub')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/School/SchoolApp.launch.test.jsx`
Expected: FAIL — word-ladder target falls into the FSRS branch (`schoolApi.flashcardDeck is not a function`), mounted false.

- [ ] **Step 3: Write the implementation** — `SchoolApp.jsx`:

Import after `import FlashcardDeckBrowser …`:

```jsx
import WordLadderProgram from './Programs/Flashcards/WordLadder/WordLadderProgram.jsx';
```

In `onPortalLaunch`, immediately BEFORE `if (target?.kind === 'program' && target.program === 'flashcards') {`, add:

```jsx
    // A word-ladder enrollment is still program `flashcards`; its mode rides
    // the launch target's policy. The ladder loads its own day from the
    // server, so there is no deck or assessment to fetch here.
    if (target?.kind === 'program' && target.program === 'flashcards' && target.policy?.mode === 'word-ladder') {
      const learnerId = launchedLearnerId ?? target.learnerId ?? null;
      if (!target.deckId || !learnerId) return false;
      setActive({ mode: 'word_ladder', descriptor: { deckId: target.deckId, userId: learnerId } });
      openSection('flashcards');
      return true;
    }
```

After the closing `)}` of the `{active?.mode === 'flashcard_program' && ( <FlashcardProgram … /> )}` block, add:

```jsx
        {active?.mode === 'word_ladder' && (
          <WordLadderProgram
            descriptor={active.descriptor}
            resolveAssetUrl={schoolApi.flashcardAssetUrl ?? ((assetId) => assetId)}
            onExit={() => setActive(null)}
          />
        )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/src/modules/School/SchoolApp.launch.test.jsx frontend/src/modules/School/SchoolApp.test.jsx`
Expected: PASS.

- [ ] **Step 5: Run the regression gate for everything so far**

Run: `npm run test:unit:vitest; echo "gate exit: $?"`
Expected: `gate exit: 0`. A non-zero exit naming a file this plan touched is a regression to fix before committing; a file outside this plan failing identically on `main` is baseline noise (confirm with `git stash`-free check: run the same file on the main checkout).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/School/SchoolApp.jsx frontend/src/modules/School/SchoolApp.launch.test.jsx
git commit -m "feat(school): launch word-ladder flashcard targets into WordLadderProgram" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Seed package, installer, and the word-ladder reference doc

**Files:**
- Create: `content/seeds/school/korean-vocab/lexicon.yml`
- Create: `content/seeds/school/korean-vocab/week-01-classroom.yml`
- Create: `content/seeds/school/korean-vocab/media-readme-section.md`
- Create: `scripts/school/seed-korean-vocab.sh`
- Create: `docs/reference/school/word-ladder.md`
- Modify: `CLAUDE.md` (navigation table)
- Test: `backend/src/2_domains/school/wordLadder/seedLexicon.test.mjs`

**Interfaces:**
- Consumes: `validateLexicon`, `expandLexiconDeck`, `buildWordQuizSource` (domain); `validateFlashcardDeck`; `validateDocumentSource`.
- Produces: seed files the installer copies to `media/school/language/korean-vocab/lexicon.yml` and `data/content/school/learning-catalog/flashcard-decks/language/korean/week-01-classroom.yml`.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/2_domains/school/wordLadder/seedLexicon.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { validateFlashcardDeck } from '#domains/school/flashcards/index.mjs';
import { validateDocumentSource } from '#domains/school/documents/documentSource.mjs';
import { buildWordQuizSource, expandLexiconDeck, validateLexicon } from './index.mjs';

const SEED = fileURLToPath(new URL('../../../../../content/seeds/school/korean-vocab/', import.meta.url));
const read = (name) => yaml.load(fs.readFileSync(path.join(SEED, name), 'utf8'));

const WEEK_ONE = [
  ['annyeong', '안녕', 'phrase'], ['annyeong-haseyo', '안녕하세요', 'phrase'], ['annyeonghi-gyeseyo', '안녕히계세요', 'phrase'],
  ['seonsaengnim', '선생님', 'phrase'], ['chingu-deul', '친구들', 'phrase'], ['ireumi-mwoyeyo', '이름이 뭐예요?', 'phrase'],
  ['ireum', '이름', 'word'], ['gawi', '가위', 'word'], ['pul', '풀', 'word'], ['chaek', '책', 'word'], ['jiugae', '지우개', 'word'],
  ['baindeo', '바인더', 'word'], ['jongi', '종이', 'word'], ['saek-jongi', '색종이', 'word'], ['yeonpil', '연필', 'word'],
  ['saek-yeonpil', '색연필', 'word'], ['gansik', '간식', 'word'], ['hanguk', '한국', 'word'], ['hakgyo', '학교', 'word'],
];

describe('Korean vocab seed package', () => {
  const { errors, entries } = validateLexicon(read('lexicon.yml'));
  it('the lexicon is valid and holds exactly the week-1 list', () => {
    expect(errors).toEqual([]);
    expect([...entries.values()].map((e) => [e.id, e.korean, e.kind])).toEqual(WEEK_ONE);
  });
  it('every phrase carries a pronunciation; decoys are confusable-sized and never the answer', () => {
    for (const entry of entries.values()) {
      if (entry.kind === 'phrase') expect(entry.pronunciation, entry.id).toBeTruthy();
      expect(entry.decoys.korean.length).toBeGreaterThanOrEqual(3);
      expect(entry.decoys.english.length).toBeGreaterThanOrEqual(3);
    }
  });
  it('the week-1 deck expands to 19 valid cards and a valid quiz source', () => {
    const raw = read('week-01-classroom.yml');
    expect(raw.words).toEqual(WEEK_ONE.map(([id]) => id));
    const { errors: deckErrors, deck } = expandLexiconDeck(raw, entries);
    expect(deckErrors).toEqual([]);
    expect(validateFlashcardDeck(deck).errors).toEqual([]);
    expect(deck.cards).toHaveLength(19);
    expect(validateDocumentSource(buildWordQuizSource({ deck, lexicon: entries, seed: 1 })).errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/2_domains/school/wordLadder/seedLexicon.test.mjs`
Expected: FAIL — `ENOENT … content/seeds/school/korean-vocab/lexicon.yml`.

- [ ] **Step 3: Write the seed files**

```yaml
# content/seeds/school/korean-vocab/lexicon.yml
# Korean word ladder — lexicon for the korean-vocab word package.
# Installed to media/school/language/korean-vocab/lexicon.yml.
# Ids are permanent once studied (status is keyed by them).
# Decoys: at least 3 per side, confusable, never the answer; an in-set decoy
# must be the same kind (phrase decoys only from phrases).
schema: school.word-lexicon/v1
entries:
  - id: annyeong
    kind: phrase
    korean: 안녕
    english: Hi (casual)
    pronunciation: an-nyeong
    decoys:
      korean: [안녕하세요, 안녕히계세요, 안경]
      english: [Hello (polite), Thank you, Excuse me]
  - id: annyeong-haseyo
    kind: phrase
    korean: 안녕하세요
    english: Hello (polite)
    pronunciation: an-nyeong-ha-se-yo
    decoys:
      korean: [안녕히계세요, 안녕, 안녕히가세요]
      english: [Hi (casual), Goodbye (to someone staying), Thank you]
  - id: annyeonghi-gyeseyo
    kind: phrase
    korean: 안녕히계세요
    english: Goodbye (to someone staying)
    pronunciation: an-nyeong-hi gye-se-yo
    decoys:
      korean: [안녕히가세요, 안녕하세요, 안녕]
      english: [Goodbye (to someone leaving), Hello (polite), Good night]
  - id: seonsaengnim
    kind: phrase
    korean: 선생님
    english: Teacher
    pronunciation: seon-saeng-nim
    decoys:
      korean: [선생, 학생, 친구들]
      english: [Student, Friends, Principal]
  - id: chingu-deul
    kind: phrase
    korean: 친구들
    english: Friends
    pronunciation: chin-gu-deul
    decoys:
      korean: [친구, 가족들, 선생님]
      english: [Friend, Family, Teacher]
  - id: ireumi-mwoyeyo
    kind: phrase
    korean: 이름이 뭐예요?
    english: What is your name?
    pronunciation: i-reu-mi mwo-ye-yo
    decoys:
      korean: [이게 뭐예요?, 어디예요?, 몇 살이에요?]
      english: [What is this?, Where is it?, How old are you?]
  - id: ireum
    kind: word
    korean: 이름
    english: Name
    pronunciation: null
    decoys:
      korean: [이마, 여름, 얼음]
      english: [Number, Age, Nickname]
  - id: gawi
    kind: word
    korean: 가위
    english: Scissors
    pronunciation: null
    decoys:
      korean: [가지, 바위, 가방]
      english: [Knife, Tape, Ruler]
  - id: pul
    kind: word
    korean: 풀
    english: Glue
    pronunciation: null
    decoys:
      korean: [불, 뿔, 발]
      english: [Tape, Paint, Stapler]
  - id: chaek
    kind: word
    korean: 책
    english: Book
    pronunciation: null
    decoys:
      korean: [책상, 채소, 창]
      english: [Notebook, Desk, Magazine]
  - id: jiugae
    kind: word
    korean: 지우개
    english: Eraser
    pronunciation: null
    decoys:
      korean: [지구, 지도, 지갑]
      english: [Pencil sharpener, Ruler, Crayon]
  - id: baindeo
    kind: word
    korean: 바인더
    english: Binder
    pronunciation: null
    decoys:
      korean: [바나나, 파일, 바구니]
      english: [Folder, Notebook, Clipboard]
  - id: jongi
    kind: word
    korean: 종이
    english: Paper
    pronunciation: null
    decoys:
      korean: [색종이, 종, 종이컵]
      english: [Colored paper, Cardboard, Envelope]
  - id: saek-jongi
    kind: word
    korean: 색종이
    english: Colored paper
    pronunciation: null
    decoys:
      korean: [종이, 색연필, 색깔]
      english: [Paper, Colored pencil, Sticker]
  - id: yeonpil
    kind: word
    korean: 연필
    english: Pencil
    pronunciation: null
    decoys:
      korean: [색연필, 연기, 연못]
      english: [Colored pencil, Pen, Crayon]
  - id: saek-yeonpil
    kind: word
    korean: 색연필
    english: Colored pencil
    pronunciation: null
    decoys:
      korean: [연필, 색종이, 사인펜]
      english: [Pencil, Colored paper, Marker]
  - id: gansik
    kind: word
    korean: 간식
    english: Snack
    pronunciation: null
    decoys:
      korean: [간장, 감자, 점심]
      english: [Lunch, Dessert, Drink]
  - id: hanguk
    kind: word
    korean: 한국
    english: Korea
    pronunciation: null
    decoys:
      korean: [한글, 미국, 학교]
      english: [Japan, China, Korean alphabet]
  - id: hakgyo
    kind: word
    korean: 학교
    english: School
    pronunciation: null
    decoys:
      korean: [학생, 한국, 학원]
      english: [Student, Classroom, Library]
```

Decoy audit (why each list is honest): 풀 also means *grass*, so "Grass" is deliberately absent from its English decoys; 간식's Korean decoys avoid 과자 (a snack itself); 안녕 also means *bye*, so no plain "Goodbye" decoy is offered for it. In-set decoys are same-kind only: phrases 안녕하세요 / 안녕히계세요 / 안녕 / 선생님 / 친구들 and their English appear only under phrases; words 색종이 / 종이 / 색연필 / 연필 / 학교 / 한국 and their English only under words.

```yaml
# content/seeds/school/korean-vocab/week-01-classroom.yml
# Installed to data/content/school/learning-catalog/flashcard-decks/language/korean/week-01-classroom.yml.
# A weekly deck never changes its words once in use; next week is a new file.
schema: school.flashcard-deck/v1
id: language/korean/week-01-classroom
title: Korean — Classroom
revision: 1
lexicon: media:language/korean-vocab/lexicon.yml
words:
  - annyeong
  - annyeong-haseyo
  - annyeonghi-gyeseyo
  - seonsaengnim
  - chingu-deul
  - ireumi-mwoyeyo
  - ireum
  - gawi
  - pul
  - chaek
  - jiugae
  - baindeo
  - jongi
  - saek-jongi
  - yeonpil
  - saek-yeonpil
  - gansik
  - hanguk
  - hakgyo
```

```markdown
<!-- content/seeds/school/korean-vocab/media-readme-section.md -->

## Generated-media word packages

`media/school/language/korean-vocab/` (and any future word package) is an
exception to the placement contract above. Its images and TTS audio are
generated separately by the household, so the package may hold **0-byte
placeholders** (`words/<id>/image.jpg`, `ko.mp3`, `en.mp3`) outside `_inbox`.
`school certify` reports each placeholder (a warning; `--strict-media` makes
it an error), and the School player renders a card without any empty file. A
word package is not a course: no `poster.jpg` is required. Replace a
placeholder by overwriting the file in place; never rename a word folder —
learner status is keyed by the word id.
```

```bash
#!/usr/bin/env bash
# scripts/school/seed-korean-vocab.sh
#
# Install the Korean word-ladder seed package into the running container's
# data and media volumes. CONTROLLER-ONLY, and only AFTER the word-ladder code
# is deployed (older code would list a card-less deck).
#
# Idempotent and non-destructive:
#   - lexicon/deck: written when absent; skipped when byte-identical; a
#     DIFFERENT existing file is a conflict (exit 1) — never overwritten.
#   - placeholders: created only where no file exists (a real image or mp3 is
#     never touched).
#   - media README: the word-package section is appended once.
# Nothing is ever removed.
set -euo pipefail
C="${CONTAINER:-daylight-station}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SEED="$ROOT/content/seeds/school/korean-vocab"
PKG="media/school/language/korean-vocab"
DECK_DIR="data/content/school/learning-catalog/flashcard-decks/language/korean"
dx() { sudo docker exec "$C" sh -c "$1"; }

put() { # put <local file> <container path>
  local src="$1" dst="$2" want have b64
  want="$(sha256sum "$src" | cut -d' ' -f1)"
  have="$(dx "[ -f '$dst' ] && sha256sum '$dst' | cut -d' ' -f1 || true")"
  if [ "$have" = "$want" ]; then echo "unchanged: $dst"; return 0; fi
  if [ -n "$have" ]; then echo "CONFLICT: $dst differs from $src — not overwriting" >&2; return 1; fi
  b64="$(base64 -w0 "$src")"
  dx "mkdir -p \"\$(dirname '$dst')\" && echo '$b64' | base64 -d > '$dst'"
  echo "installed: $dst"
}

put "$SEED/lexicon.yml" "$PKG/lexicon.yml"
put "$SEED/week-01-classroom.yml" "$DECK_DIR/week-01-classroom.yml"

IDS="$(grep -E '^  - id: ' "$SEED/lexicon.yml" | sed 's/^  - id: //')"
for id in $IDS; do
  dx "d='$PKG/words/$id'; mkdir -p \"\$d\"; for f in image.jpg ko.mp3 en.mp3; do [ -e \"\$d/\$f\" ] || : > \"\$d/\$f\"; done"
done
echo "placeholders ensured for $(echo "$IDS" | wc -w) words"

if dx "grep -q '^## Generated-media word packages' media/school/README.md"; then
  echo "unchanged: media/school/README.md"
else
  b64="$(base64 -w0 "$SEED/media-readme-section.md")"
  dx "echo '$b64' | base64 -d | grep -v '^<!--' >> media/school/README.md"
  echo "appended: media/school/README.md"
fi

dx "chown -R node:node '$PKG' data/content/school/learning-catalog media/school/README.md"
dx "ls -la '$PKG' '$DECK_DIR'; find '$PKG/words' -type f | wc -l"
```

(`chmod +x scripts/school/seed-korean-vocab.sh` before committing.)

`docs/reference/school/word-ladder.md`:

```markdown
# Word ladder (Korean vocabulary)

A flashcard enrollment in `policy.mode: word-ladder`: weekly word lists, a
readable per-word ladder instead of FSRS, recorded speaking, a review run
after the day is done, and a printed OMR quiz that can only demote.
Design: `docs/_wip/plans/2026-09-22-korean-vocab-word-ladder-design.md`.

## Where things live

| What | Where |
|---|---|
| Lexicon + media | `media/school/language/korean-vocab/lexicon.yml`, `words/<id>/{image.jpg,ko.mp3,en.mp3}` |
| Weekly deck | `data/content/school/learning-catalog/flashcard-decks/language/korean/week-NN-*.yml` (`lexicon:` + `words:`) |
| Enrollment | learner plan `programs:` → `{programId: flashcards, deckId, title, policy: {mode: word-ladder}, schedule}` |
| Status | `data/users/{learnerId}/apps/school/korean-vocab/status.yml` |
| Takes | `media/school/recordings/korean-vocab/{learnerId}/{studyDay}/{wordId}-{n}.webm` |
| Quiz source | `data/content/school/learning-catalog/documents/<deckId>-quiz.yml` |
| Code | `backend/src/2_domains/school/wordLadder/`, `3_applications/school/WordLadderStudyService.mjs`, `4_api/v1/routers/school.wordLadder.mjs`, `frontend/src/modules/School/Programs/Flashcards/WordLadder/` |

## The ladder

NEW → (studied) LEARNING → ("I know it") CLAIMED → (scheduled check passed on
a later study day) KNOWN at step 0 → re-checks after 3 / 7 / 14 / 30 study
days. Only a scheduled check promotes. Review-quiz passes (`check-pass-early`)
and paper passes (`quiz-pass`) are logged only. Any miss, from any source,
drops the word to LEARNING, step 0. Days are School study days (4am→4am,
household timezone).

## A study day

The first open of a study day **freezes** the plan in `status.days[day]`:

1. **Checks** — CLAIMED words from an earlier day and KNOWN words due today.
   Four choices (answer + 3 authored decoys). Direction (picture→Korean,
   audio→Korean, Korean→English) is deterministic from word + day and falls
   back to Korean→English when the needed media is missing. Graded
   server-side; a miss adds the word to today's study pass.
2. **Study** — NEW/LEARNING words of the current deck plus LEARNING words
   carried from older decks. Record (when a mic is available; the Sentence
   Ladder speech floor applies), hear the take then the native audio, flip,
   mark **I know it** or **Still learning**.
3. **Review quiz** — when the current deck had nothing to check or study at
   freeze time, a required quiz over every current-deck word.

Credit (`doneToday`) = every planned check answered and every study card
studied and marked (after its latest miss). With no mic the card logs
`recording: unavailable` with the reason; nothing else is excused. The
launcher is `replayable`: a past day is judged from its frozen plan.

## After the day is done (review run)

The launcher reports `reopenable: true`, so the tile keeps its button after
`doneToday`. Opening a finished day lands on the **review run**: every
current-deck card in deck order, flip only, no marks, no recording, no state
change. Each card viewed logs `{event: review}`; credit is unaffected. The
Done screen offers **Review the cards** for the same run.

## Printed quiz and the fold

    node cli/school.mjs korean-vocab quiz --deck week-01-classroom
    node cli/school.mjs docs publish language/korean/week-01-classroom-quiz.yml

Render per learner with `variety=omr`. The sheet's instruction line sends a
stuck child back to the cards. A scan appends one paper attempt per graded
row (`bankId: <deckId>-quiz@<rev>`, `itemId: <wordId>`); every plan build
folds new ones (idempotent by attempt id): a miss demotes, a pass is logged.
Blank or double-marked rows fold nothing until a grown-up resolves the card.
To fold without waiting for the child:

    curl -s -X POST {app}/api/v1/school/word-ladder/fold \
      -H 'Content-Type: application/json' -d '{"learnerId":"{learnerId}","actorId":"{teacherId}"}'

## Rollover and media

A new week is a new deck file; a grown-up changes the enrollment `deckId`
(status carries over — it is keyed by word). Placeholders (0-byte files) are
allowed: the player renders around them and `school certify` warns
(`--strict-media` fails). Replace a placeholder by overwriting it in place.

## Logs

Backend: `school.word-ladder.{opened,folded,check,mark,recording-saved,review-viewed,status-corrupt}`.
Frontend (`context.component: school-word-ladder`): `plan.loaded`,
`check.answered`, `card.marked`, `recording.{uploaded,failed,refused}`,
`mic.unavailable`, `review.{started,viewed}`, `day.done`, `api.{rejected,failed}`.
```

`CLAUDE.md` — add a navigation row directly after the `School media lessons` row:

```markdown
| School word ladder (Korean vocab: lexicon decks, per-word ladder, review run, printed quiz fold) | `docs/reference/school/word-ladder.md` |
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `chmod +x scripts/school/seed-korean-vocab.sh && bash -n scripts/school/seed-korean-vocab.sh && npx vitest run backend/src/2_domains/school/wordLadder/`
Expected: `bash -n` silent; PASS (seed suite included).

- [ ] **Step 5: Commit**

```bash
git add content/seeds/school/korean-vocab scripts/school/seed-korean-vocab.sh docs/reference/school/word-ladder.md CLAUDE.md backend/src/2_domains/school/wordLadder/seedLexicon.test.mjs
git commit -m "feat(school): Korean week-1 word package seed, installer and word-ladder reference" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: Live verification (implementer) and controller-only deploy + install

**Files:**
- Create: `tests/live/flow/school/word-ladder.runtime.test.mjs`

**Interfaces:**
- Consumes: the running worktree dev stack (Vite + backend); `window.__wsService._dispatch` (dev); `FRONTEND_URL` from `#fixtures/runtime/urls.mjs`.

Parts A–B are the implementer's. **Parts C–E are controller-only** — the implementer stops after Part B and reports.

- [ ] **Part A, Step 1: Write the Playwright spec**

The spec drives the REAL School SPA in a real browser (real `useSchoolLaunch`, real `WordLadderProgram`, real `useVoiceCapture` against Chromium's fake mic) and stubs only `/api/v1/school/word-ladder/**` and the roster, so no child's real status or recordings are touched (the dev backend shares the live data volume).

```js
// tests/live/flow/school/word-ladder.runtime.test.mjs
//
// A full word-ladder day in a real browser: WS launch → check → study (real
// mic capture from Chromium's fake device, the speech floor, upload) → mark →
// Done → review run. Then the mic-unavailable run.
//
// Only the word-ladder API and the roster are stubbed: the dev backend shares
// the household data volume, and a test must never write a real child's
// status or recordings. The server half (grading, freezing, credit) is proven
// by WordLadderStudyService.test.mjs and the route tests.
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

const LEARNER = { id: 'wl-flow-learner', name: 'Word Tester', birthyear: 2017 };
const DECK = 'language/korean/week-01-classroom';
const GAWI = { wordId: 'gawi', kind: 'word', korean: '가위', english: 'Scissors', pronunciation: null, media: { image: null, audio: null } };
const PUL = { wordId: 'pul', kind: 'word', korean: '풀', english: 'Glue', pronunciation: null, media: { image: null, audio: null } };

function fakeServer() {
  const s = { checked: false, uploads: 0, marks: [], reviews: [] };
  const plan = () => {
    const mark = s.marks.at(-1) ?? null;
    const studied = s.uploads > 0 || mark?.recording?.status === 'unavailable';
    const done = s.checked && Boolean(mark);
    return {
      day: '2026-09-22', deckId: DECK,
      checks: [{ wordId: 'gawi', kind: 'word', phase: 'check', direction: 'korean_to_english', prompt: { type: 'text', text: '가위' }, choices: ['Knife', 'Scissors', 'Tape', 'Ruler'], done: s.checked, correct: s.checked ? true : null }],
      study: [{ wordId: 'pul', studied, recording: studied ? (s.uploads ? 'taken' : 'unavailable') : null, marked: mark?.mark ?? null, done: Boolean(mark), card: PUL }],
      review: [], deckCards: [GAWI, PUL],
      remaining: { checks: s.checked ? 0 : 1, study: mark ? 0 : 1, review: 0 },
      doneToday: done, progressLabel: done ? 'Done for today' : 'in progress',
    };
  };
  const handle = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/word-ladder/open')) return json({ sessionId: 'flow-session', day: '2026-09-22', deckId: DECK, folded: 0, plan: plan() });
    if (url.pathname.includes('/checks/gawi')) { s.checked = true; return json({ wordId: 'gawi', correct: true, answer: 'Scissors', card: GAWI, plan: plan() }); }
    if (url.pathname.includes('/cards/pul/recording')) { s.uploads += 1; s.lastUploadBytes = (req.postDataBuffer() ?? Buffer.alloc(0)).length; return json({ wordId: 'pul', take: s.uploads, plan: plan() }); }
    if (url.pathname.includes('/cards/pul/mark')) { s.marks.push(req.postDataJSON()); return json({ wordId: 'pul', state: 'claimed', plan: plan() }); }
    if (url.pathname.includes('/review/')) { s.reviews.push(url.pathname.split('/').at(-1)); return json({ logged: true }); }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"unexpected in test"}' });
  };
  return { s, handle };
}

async function openLadder(page, server) {
  await page.route('**/api/v1/school/word-ladder/**', server.handle);
  await page.route('**/api/v1/school/roster', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([LEARNER]) }));
  await page.goto(`${FRONTEND_URL}/school`);
  await page.waitForFunction(() => Boolean(window.__wsService), null, { timeout: 20_000 });
  await page.evaluate(({ learnerId, deckId }) => {
    window.__wsService._dispatch({ topic: 'school', type: 'school.launch', learnerId, target: { kind: 'program', program: 'flashcards', deckId, policy: { mode: 'word-ladder' } } });
  }, { learnerId: LEARNER.id, deckId: DECK });
}

test.describe('word ladder — a full day', () => {
  test('check → recorded study → done → review run', async ({ page }) => {
    const server = fakeServer();
    await openLadder(page, server);
    await expect(page.getByText('가위')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Scissors' }).click();
    await expect(page.getByText('Right!')).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();

    await expect(page.getByText('풀')).toBeVisible();
    await page.getByRole('button', { name: 'Record' }).click();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await page.waitForTimeout(1_800); // clear the 1200 ms floor with Chromium's fake-mic tone
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('button', { name: 'Flip' })).toBeVisible({ timeout: 10_000 });
    expect(server.s.uploads).toBe(1);
    expect(server.s.lastUploadBytes).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Flip' }).click();
    await expect(page.getByText('Glue')).toBeVisible();
    await page.getByRole('button', { name: 'I know it' }).click();
    await expect(page.getByText('All done for today')).toBeVisible();
    expect(server.s.marks).toEqual([{ userId: LEARNER.id, mark: 'know', recording: null }]);

    await page.getByRole('button', { name: 'Review the cards' }).click();
    await expect(page.getByText('가위')).toBeVisible();
    await expect(page.getByRole('button', { name: 'I know it' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Flip' }).click();
    await page.getByRole('button', { name: 'Next card' }).click();
    await page.getByRole('button', { name: 'Flip' }).click();
    await page.getByRole('button', { name: 'Next card' }).click();
    await expect(page.getByText("That's every card")).toBeVisible();
    expect(server.s.reviews).toEqual(['gawi', 'pul']);
    await page.screenshot({ path: 'tests/output/word-ladder-review-done.png' });
  });

  test('mic unavailable: no record step, the mark carries the reason', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.removeItem('school.language.capabilities');
      navigator.mediaDevices.enumerateDevices = async () => [];
    });
    const server = fakeServer();
    await openLadder(page, server);
    await page.getByRole('button', { name: 'Scissors' }).click({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('풀')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Flip' }).click();
    await page.getByRole('button', { name: 'Still learning' }).click();
    await expect(page.getByText('All done for today')).toBeVisible();
    expect(server.s.marks).toEqual([{ userId: LEARNER.id, mark: 'learning', recording: { status: 'unavailable', reason: 'no-device' } }]);
    expect(server.s.uploads).toBe(0);
  });
});
```

- [ ] **Part A, Step 2: Start the worktree dev stack only if nothing is serving it**

```bash
cd /opt/Code/DaylightStation/.claude/worktrees/korean-word-ladder
ss -tlnp | grep -E ':(3112|3113)\b' || echo "no dev stack"
```
If a dev stack is already listening on the app port, reuse it and check it serves THIS worktree (`ps -o pid,cwd -p $(ss -tlnp | grep ':3112' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)`); if it serves another checkout, do not kill it — set `BASE_URL` to a free-port worktree stack instead. If nothing is listening:

```bash
nohup npm run dev > /tmp/claude-1001/-opt-Code-DaylightStation/word-ladder-dev.log 2>&1 &
echo $! > /tmp/claude-1001/-opt-Code-DaylightStation/word-ladder-dev.pid
for i in $(seq 1 60); do curl -sf http://localhost:3112/ >/dev/null && break; sleep 2; done
curl -sf http://localhost:3112/ >/dev/null && echo "dev stack up"
```
Expected: `dev stack up` (the port comes from `system.yml`; if `getAppPort()` reports another port, use that one everywhere below).

- [ ] **Part A, Step 3: Run the live spec against the worktree stack**

Run: `BASE_URL=http://localhost:3112 npx playwright test tests/live/flow/school/word-ladder.runtime.test.mjs --reporter=line; echo "exit: $?"`
Expected: `2 passed`, `exit: 0`. Then LOOK at `tests/output/word-ladder-review-done.png` (Read tool) — the "That's every card" screen must be visibly laid out (buttons, heading), not merely present in the DOM.

- [ ] **Part A, Step 4: Read the logs the run produced**

Run: `grep -E "school\.word-ladder\.(plan\.loaded|check\.answered|recording\.uploaded|card\.marked|review\.started|mic\.unavailable|day\.done)" /tmp/claude-1001/-opt-Code-DaylightStation/word-ladder-dev.log | tail -20`
Expected: each lifecycle event appears at least once (frontend events reach the dev backend over the logging WebSocket). A missing event is a logging defect to fix in Task 14's code, not something to note.

- [ ] **Part A, Step 5: Stop the stack this task started (only that one)**

```bash
[ -f /tmp/claude-1001/-opt-Code-DaylightStation/word-ladder-dev.pid ] && kill "$(cat /tmp/claude-1001/-opt-Code-DaylightStation/word-ladder-dev.pid)" && echo stopped
```

- [ ] **Part B: Full gate and commit**

```bash
npm run test:unit:vitest; echo "gate exit: $?"
git add tests/live/flow/school/word-ladder.runtime.test.mjs
git commit -m "test(school): live Playwright day for the word ladder" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
Expected: `gate exit: 0`. **The implementer stops here and reports.**

- [ ] **Part C (CONTROLLER ONLY): merge, gate, build, deploy**

1. Merge `feat/korean-word-ladder` into `main` per repo branch policy.
2. `./scripts/deploy-gate.sh` — proceed only on exit 0 (someone at the Portal, piano, garage or living room blocks it).
3. `./scripts/build-daylight.sh`
4. Re-run `./scripts/deploy-gate.sh`; on exit 0: `sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight`
5. `curl -s http://localhost:3111/build.txt` shows the merged commit.

- [ ] **Part D (CONTROLLER ONLY): install the seed, quiz and enrollment on the live volumes**

**Confirm the learner with the user first** (Spec discrepancy 11). Learner and teacher ids are not committed to this public repo; resolve them at run time:

```bash
sudo docker exec daylight-station sh -c 'grep -l "corpusId: glossika-korean" data/household/school/plans/learners/*.yml'   # the candidates
read -r -p "learner id the user confirmed: " LEARNER
read -r -p "teacher id (school.yml teachers:): " TEACHER
```

```bash
cd /opt/Code/DaylightStation
./scripts/school/seed-korean-vocab.sh
# expected: installed lexicon + deck, "placeholders ensured for 19 words", README appended, 57 files under words/

sudo docker exec daylight-station sh -c 'node cli/school.mjs korean-vocab quiz --deck week-01-classroom \
  && node cli/school.mjs docs publish language/korean/week-01-classroom-quiz.yml \
  && chown -R node:node data/content/school/learning-catalog/documents/language \
     data/household/school/artifacts/print/published/language data/household/school/artifacts/print/derived-banks/language'

SCRATCH=/tmp/claude-1001/-opt-Code-DaylightStation
node cli/school.mjs korean-vocab enroll-plan --learner "$LEARNER" --deck week-01-classroom --title "Korean words" --out "$SCRATCH/$LEARNER-word-ladder-plan.yml"
cat "$SCRATCH/$LEARNER-word-ladder-plan.yml"          # piano-course, book-log, sentence-ladder all still present + the new flashcards row
SCHOOL_PIN=retired node cli/school.mjs ops assign "$LEARNER" --file "$SCRATCH/$LEARNER-word-ladder-plan.yml" --teacher "$TEACHER" --pin-env SCHOOL_PIN          # preview
SCHOOL_PIN=retired node cli/school.mjs ops assign "$LEARNER" --file "$SCRATCH/$LEARNER-word-ladder-plan.yml" --teacher "$TEACHER" --pin-env SCHOOL_PIN --apply
curl -s "http://localhost:3111/api/v1/school/lifecycle/assignments/$LEARNER" | python3 -c "import json,sys; print([p for p in json.load(sys.stdin)['programs'] if p['programId']=='flashcards'])"
# expected: policy {'mode': 'word-ladder'}, title 'Korean words', deckId language/korean/week-01-classroom
```

- [ ] **Part E (CONTROLLER ONLY): verify the deployed system**

```bash
curl -s "http://localhost:3111/api/v1/school/flashcards/language%2Fkorean%2Fweek-01-classroom" | python3 -c "import json,sys; d=json.load(sys.stdin)['deck']; print(len(d['cards']), d['cards'][7]['front']['blocks'][1])"
# expected: 19 {'type': 'text', 'text': '가위'}
sudo docker exec daylight-station sh -c 'node cli/school.mjs certify' | tail -25
# expected: OK, with "0-byte placeholder" warnings for the 38 referenced media files (image.jpg + ko.mp3 per word)
SCRATCH=/tmp/claude-1001/-opt-Code-DaylightStation
# Proof render: the plain GET never mints a card or allocation (print-documents.md §6).
curl -s -o "$SCRATCH/week-01-quiz-proof.pdf" "http://localhost:3111/api/v1/school/print/language/korean/week-01-classroom-quiz?variety=hand"
pdftoppm -png -r 80 -f 1 -l 1 "$SCRATCH/week-01-quiz-proof.pdf" "$SCRATCH/week-01-quiz-proof"
# Read $SCRATCH/week-01-quiz-proof-1.png: Hangul glyphs (not boxes) in prompts and choices,
# and "Not sure of a word? Open Korean words on the Portal and review the cards, then come back." under the title.
# The per-learner OMR sheet is printed by a grown-up with POST /print/render {id, variety: omr, learnerId}.
curl -s "$LOG_STORE/select/logsql/query" -d 'query="school.word-ladder" AND _time:1h' -d 'limit=50'   # LOG_STORE = the log-store URL from CLAUDE.local.md
```
Then open the Portal as the learner (or ask the user to) and confirm the "Korean words" tile opens the ladder; after completion, reopening lands on the review run. Report any gap as a fix, not a note.

---

## Self-review

- **Spec coverage:** Decisions table → Tasks 2–3 (ladder, gaps, claim-next-day, nothing-due quiz), 8 (mic-unavailable, frozen plan), 5/11 (media, fonts), 12 (printed quiz, OMR loop), 4 (policy.mode), 16 (seed, rollover doc). Data model → Tasks 1, 7, 16. State machine → Task 2. Daily session + credit + replay → Tasks 3, 8, 9. Recording → Tasks 7, 8, 10, 13, 14. Printed quiz + font + fold → Tasks 3, 11, 12. Rev 3 (tile stays open, review run, sheet line) → Tasks 2 (`applyReviewView`), 8 (`viewReviewCard`, `deckCards`), 9 (`reopenable`), 10 (route), 12 (`QUIZ_INSTRUCTIONS` + render width test), 14 (landing + Done button), 16 (doc). Components/Frontend → Tasks 14–15. Seeding → Tasks 16–17. Testing list → each task's tests + Task 17 live. Docs list → Tasks 6, 9, 11, 12, 16.
- **Types:** `dayProgress` item fields (`studied`, `recording`, `marked`, `done`) are the same in Tasks 3, 8, 14 and the Playwright stub; `PublicPlan.review` (review quiz) vs `deckCards` (review run) are used consistently; service method names match the routes (Task 10) and the client (Task 14).
