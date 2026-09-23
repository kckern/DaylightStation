# Word Ladder Plan 2 — Drill, Speaking, Keypad, Practice

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the learner experience on top of Plan 1's core loop: the drill (support → no support), speaking tasks with recorded takes, the on-screen jamo keypad, the drill offer and tricky-word drill in the Today stream, and the post-goal practice menu (Flashcards, Match, Say, Write, Listen, Drill, Quiz me, My words).

**Architecture:** The day engine (`engine.mjs`) gains two sub-machines that live in the day file like rounds do: `drills[]` and `practice`. A drill is a precomputed step list for one word, filtered by media and the client's microphone capability; practice is a queue of items built from a menu choice. Only `practice.mode === 'quiz'` grades (spec rule 1). Speaking takes are uploaded to the existing `FilesystemWordLadderRecordings` (a discarding sink in test mode). The keypad drives the existing Hangul automaton through a new `FieldComposer.offerJamo` seam.

**Tech Stack:** as Plan 1.

**Spec:** `docs/_wip/plans/2026-09-22-word-ladder-mastery-redesign.md` (rev 4) — §3 task catalogue, §4 drill offer + order step 2, §5 media adaptation, §6 keypad + practice menu. **Depends on Plan 1** (`docs/_wip/plans/2026-09-22-word-ladder-plan-1-core-loop.md`) being merged.

## Global Constraints

Everything in Plan 1's Global Constraints, plus:

- Drill path per word (spec §3): `look → copy → say-after → match → read-aloud → dictation → tiles → say-from-cue → type` (task ids 0.1, 1.1, 1.2, 2.3, 1.3, 1.4, 3.2, 3.4, 3.3). Steps needing a microphone (1.2, 1.3, 3.4) are dropped when the client reports `microphone: false`; steps needing term audio (1.2, 1.4) are dropped when the word has none. Nothing in a drill grades.
- Drill estimate 240000 ms. Tricky drill: up to `drill.perSitting` (default 1) words per **day**, oldest `trickySince` first, after rechecks, only if 240000 ms of active time remain. Drill offer: at most one per round, for the round's Not-yet word with the most Not-yet sorts, never once the cap has elapsed or with < 240000 ms left.
- Speaking is never graded. Takes are saved to `media/school/recordings/word-ladder/<package>/<learner>/<day>/<wordId>-<n>.<ext>` (existing adapter); test mode discards them.
- Keypad: toggle on every typing item; auto-opens at most once per item after 10 s of field focus with no keydown; closes on the first physical keydown. Two-set layout; Shift for ㄲ ㄸ ㅃ ㅆ ㅉ ㅒ ㅖ; backspace; submit.
- Practice menu unlocks only after `doneToday`. Only **Quiz me** grades (verify rules: 3.3 → 2.2 hear, first-miss stop, not for words with `verifyFailedDay` = today). Practice self-sorts obey rule 2 (can lower a mastered word; Got it never raises past `claimed`).
- The goal now includes "the day's drill run, if the at-open snapshot lists a tricky word and the drill fit" (spec §4).

## File map

**Domain** — `backend/src/2_domains/school/wordLadder/`
- `drill.mjs` — `DRILL_STEPS`, `drillSteps(entry, media, capabilities)`, `tilesFor(entry, deckTerms, seed)`, `matchBoard(entries, media, seed)`.
- `practice.mjs` — `PRACTICE_MODES`, `buildPractice({mode, help, filter, words, entries, media, day, seed, capabilities})`.
- `engine.mjs` — drills, drill offer, intro say-after, practice, menu, capabilities.
- `scenarios.mjs` — `tricky`, `typos` seeds.

**Adapters** — `backend/src/1_adapters/school/wordLadder/DiscardingRecordings.mjs`.

**Application** — `WordLadderSittingService.mjs`: `capabilities` on open, `saveRecording`, `practice`, `words`, public drill/practice items.

**API** — `school.wordLadder.mjs`: recordings, practice, words routes (live + test).

**Frontend** — `frontend/src/modules/School/ime/fieldComposer.js` (`offerJamo`), `HangulTypingProvider.jsx` (`offerJamo` in context); `WordLadder/`: `JamoKeypad.jsx`, `useTakeRecorder.js`, `items/DrillItem.jsx`, `items/SayItem.jsx`, `items/TilesItem.jsx`, `items/MatchItem.jsx`, `items/ListenItem.jsx`, `items/DrillOfferItem.jsx`, `items/MenuItem.jsx`, `items/WordsItem.jsx`; `TypedItem.jsx` (keypad), `WordLadderProgram.jsx` (dispatch new item types, capabilities, recordings).

---

### Task 1: Drill steps, tiles and match boards (`drill.mjs`)

**Files:**
- Create: `backend/src/2_domains/school/wordLadder/drill.mjs`
- Test: `backend/src/2_domains/school/wordLadder/drill.test.mjs`

**Interfaces:**
- Produces:
  - `DRILL_STEPS = ['look','copy','say-after','match','read-aloud','dictation','tiles','say-from-cue','type']`
  - `drillSteps(media:{audio:boolean}, capabilities:{microphone:boolean}): string[]` — drops `say-after`/`read-aloud`/`say-from-cue` without a mic; drops `say-after`/`dictation` without term audio.
  - `tilesFor(entry, deckTerms: string[], seed): string[]` — the entry's syllables (spaces kept as their own tile `' '` dropped — tiles are the non-space syllables in order) plus 2 decoy syllables drawn from other deck terms (not in the answer), seeded-shuffled.
  - `matchBoard(entries: Entry[], media: Record<id,{image}>, seed): { pairs: [{ wordId, term, right: {type:'image'|'text', text?} }] }` — up to 6 entries; `right` is `image` only when **every** entry on the board has an image, else English text.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/2_domains/school/wordLadder/drill.test.mjs
import { describe, expect, it } from 'vitest';
import { DRILL_STEPS, drillSteps, matchBoard, tilesFor } from './drill.mjs';

describe('drill', () => {
  it('full path with mic and audio', () => {
    expect(drillSteps({ audio: true }, { microphone: true })).toEqual(DRILL_STEPS);
  });
  it('no mic drops the speaking steps; no audio drops say-after and dictation', () => {
    expect(drillSteps({ audio: true }, { microphone: false })).toEqual(['look', 'copy', 'match', 'dictation', 'tiles', 'type']);
    expect(drillSteps({ audio: false }, { microphone: true })).toEqual(['look', 'copy', 'match', 'read-aloud', 'tiles', 'say-from-cue', 'type']);
  });
  it('tiles are the answer syllables plus two decoys from other deck words', () => {
    const tiles = tilesFor({ term: '이름이 뭐예요?' }, ['이름', '가위', '책'], 's');
    expect(tiles).toHaveLength(8);
    expect(tiles).toEqual(expect.arrayContaining(['이', '름', '이', '뭐', '예', '요']));
    expect(tiles.filter((t) => ['가', '위', '책'].includes(t))).toHaveLength(2);
  });
  it('match board uses pictures only when every word has one', () => {
    const e = (id, term, gloss) => ({ id, term, gloss });
    const words = [e('a', '가위', 'Scissors'), e('b', '책', 'Book')];
    expect(matchBoard(words, { a: { image: true }, b: { image: true } }, 's').pairs.every((p) => p.right.type === 'image')).toBe(true);
    expect(matchBoard(words, { a: { image: true }, b: { image: false } }, 's').pairs.map((p) => p.right)).toEqual(
      expect.arrayContaining([{ type: 'text', text: 'Scissors' }, { type: 'text', text: 'Book' }]),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run backend/src/2_domains/school/wordLadder/drill.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// backend/src/2_domains/school/wordLadder/drill.mjs
/**
 * The drill (spec §3 drill path): one word walked from full support to none.
 * Nothing here grades. Steps that need a mic or term audio are dropped, never
 * blocked on.
 */
import { hashString, seededShuffle } from './checkItem.mjs';

export const DRILL_STEPS = Object.freeze(['look', 'copy', 'say-after', 'match', 'read-aloud', 'dictation', 'tiles', 'say-from-cue', 'type']);
const NEEDS_MIC = new Set(['say-after', 'read-aloud', 'say-from-cue']);
const NEEDS_AUDIO = new Set(['say-after', 'dictation']);

export function drillSteps(media = {}, capabilities = {}) {
  return DRILL_STEPS.filter((step) => (capabilities.microphone === true || !NEEDS_MIC.has(step))
    && (media.audio === true || !NEEDS_AUDIO.has(step)));
}

const syllables = (text) => [...String(text).normalize('NFC')].filter((ch) => /[가-힣]/u.test(ch));

export function tilesFor(entry, deckTerms = [], seed) {
  const answer = syllables(entry.term);
  const pool = [...new Set(deckTerms.flatMap(syllables))].filter((s) => !answer.includes(s));
  const decoys = seededShuffle(pool, hashString(`${seed}|tile-decoys`)).slice(0, 2);
  return seededShuffle([...answer, ...decoys], hashString(`${seed}|tiles`));
}

export function matchBoard(entries, media = {}, seed) {
  const chosen = seededShuffle(entries, hashString(`${seed}|board`)).slice(0, 6);
  const pictures = chosen.length > 0 && chosen.every((entry) => media[entry.id]?.image === true);
  return {
    pairs: chosen.map((entry) => ({
      wordId: entry.id, term: entry.term,
      right: pictures ? { type: 'image' } : { type: 'text', text: entry.gloss },
    })),
  };
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run backend/src/2_domains/school/wordLadder/drill.test.mjs` → PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/school/wordLadder/drill.mjs backend/src/2_domains/school/wordLadder/drill.test.mjs
git commit -m "feat(school): word ladder drill steps, tiles and match boards" -- backend/src/2_domains/school/wordLadder/drill.mjs backend/src/2_domains/school/wordLadder/drill.test.mjs
```

---

### Task 2: Practice builder (`practice.mjs`)

**Files:**
- Create: `backend/src/2_domains/school/wordLadder/practice.mjs`
- Test: `backend/src/2_domains/school/wordLadder/practice.test.mjs`

**Interfaces:**
- Consumes: `drillSteps`, `matchBoard` (Task 1); `hashString`, `seededShuffle`.
- Produces:
  - `PRACTICE_MODES = ['flashcards','match','say','write','listen','drill','quiz']`
  - `practiceWordIds({ filter:'working'|'introduced'|'tricky'|'chosen', words, chosen }): string[]` — `working` = unsettled; `introduced` = any state ≠ `new`; `tricky` = `tricky: true`; `chosen` = the given ids that are introduced.
  - `buildPractice({ mode, help:boolean, filter, chosen, words, entries:Map, media, day, seed, capabilities, frontSide:'term'|'gloss' }): { mode, help, queue: PracticeTask[], index:0 }` where `PracticeTask`:
    - flashcards → `{ kind:'flashcard', wordId, front: frontSide }` (seeded shuffle)
    - match → `{ kind:'match', board }` one per 6 words
    - say → help ? `{ kind:'say-after', wordId }` : `{ kind:'say-from-cue', wordId }`; empty queue if `capabilities.microphone !== true`
    - write → help ? `{ kind:'copy', wordId }` : `{ kind:'type-practice', wordId }`
    - listen → `{ kind:'listen', wordIds }` (single task, words with audio)
    - drill → `{ kind:'drill', wordId, steps: drillSteps(media[id], capabilities) }` per chosen word
    - quiz → verify tasks for introduced, non-mastered words with `verifyFailedDay !== day`: all `{kind:'graded', task:'3.3', wordId}` then all `{kind:'graded', task:'2.2', wordId}`

- [ ] **Step 1: Write the failing test**

```js
// backend/src/2_domains/school/wordLadder/practice.test.mjs
import { describe, expect, it } from 'vitest';
import { emptyWordV3 } from './mastery.mjs';
import { buildPractice, practiceWordIds } from './practice.mjs';

const D = '2026-09-22';
const words = {
  a: { ...emptyWordV3(), state: 'familiar' }, b: { ...emptyWordV3(), state: 'mastered', stage: 2 },
  c: { ...emptyWordV3(), state: 'claimed', tricky: true }, d: emptyWordV3(),
  e: { ...emptyWordV3(), state: 'familiar', verifyFailedDay: D },
};
const entries = new Map(['a', 'b', 'c', 'd', 'e'].map((id) => [id, { id, term: `${id}어`, gloss: id.toUpperCase() }]));
const media = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((id) => [id, { image: false, audio: true }]));
const build = (mode, extra = {}) => buildPractice({ mode, help: true, filter: 'introduced', chosen: [], words, entries, media, day: D, seed: 's', capabilities: { microphone: true }, frontSide: 'term', ...extra });

describe('practice', () => {
  it('filters', () => {
    expect(practiceWordIds({ filter: 'working', words }).sort()).toEqual(['a', 'c', 'e']);
    expect(practiceWordIds({ filter: 'introduced', words }).sort()).toEqual(['a', 'b', 'c', 'e']);
    expect(practiceWordIds({ filter: 'tricky', words })).toEqual(['c']);
    expect(practiceWordIds({ filter: 'chosen', words, chosen: ['d', 'b'] })).toEqual(['b']);
  });
  it('quiz is verify tasks over non-mastered introduced words not failed today', () => {
    const q = build('quiz').queue;
    expect(q.map((t) => `${t.task}:${t.wordId}`).sort()).toEqual(['2.2:a', '2.2:c', '3.3:a', '3.3:c'].sort());
    expect(q.slice(0, 2).every((t) => t.task === '3.3')).toBe(true);
  });
  it('say needs a mic; write help = copy, no help = type-practice', () => {
    expect(build('say', { capabilities: { microphone: false } }).queue).toEqual([]);
    expect(build('write').queue.every((t) => t.kind === 'copy')).toBe(true);
    expect(build('write', { help: false }).queue.every((t) => t.kind === 'type-practice')).toBe(true);
  });
  it('match makes boards of up to six', () => {
    expect(build('match').queue).toHaveLength(1);
    expect(build('match').queue[0].board.pairs).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module not found.

- [ ] **Step 3: Implement**

```js
// backend/src/2_domains/school/wordLadder/practice.mjs
/**
 * The practice menu's runs (spec §6 practice menu). Only `quiz` grades (rule 1);
 * everything else is study. Pure.
 */
import { hashString, seededShuffle } from './checkItem.mjs';
import { drillSteps, matchBoard } from './drill.mjs';
import { isUnsettled } from './mastery.mjs';

export const PRACTICE_MODES = Object.freeze(['flashcards', 'match', 'say', 'write', 'listen', 'drill', 'quiz']);

export function practiceWordIds({ filter = 'introduced', words = {}, chosen = [] }) {
  const all = Object.entries(words);
  if (filter === 'working') return all.filter(([, w]) => isUnsettled(w)).map(([id]) => id);
  if (filter === 'tricky') return all.filter(([, w]) => w.tricky).map(([id]) => id);
  const introduced = all.filter(([, w]) => w.state !== 'new').map(([id]) => id);
  if (filter === 'chosen') return chosen.filter((id) => introduced.includes(id));
  return introduced;
}

export function buildPractice({ mode, help = true, filter = 'introduced', chosen = [], words, entries, media, day, seed, capabilities = {}, frontSide = 'term' }) {
  const ids = seededShuffle(practiceWordIds({ filter, words, chosen }).filter((id) => entries.has(id)), hashString(`${seed}|practice`));
  let queue = [];
  if (mode === 'flashcards') queue = ids.map((wordId) => ({ kind: 'flashcard', wordId, front: frontSide }));
  else if (mode === 'match') {
    for (let i = 0; i < ids.length; i += 6) {
      const slice = ids.slice(i, i + 6).map((id) => entries.get(id));
      if (slice.length >= 2) queue.push({ kind: 'match', board: matchBoard(slice, media, `${seed}|${i}`) });
    }
  } else if (mode === 'say') queue = capabilities.microphone === true ? ids.map((wordId) => ({ kind: help ? 'say-after' : 'say-from-cue', wordId })) : [];
  else if (mode === 'write') queue = ids.map((wordId) => ({ kind: help ? 'copy' : 'type-practice', wordId }));
  else if (mode === 'listen') { const heard = ids.filter((id) => media[id]?.audio); queue = heard.length ? [{ kind: 'listen', wordIds: heard }] : []; }
  else if (mode === 'drill') queue = ids.map((wordId) => ({ kind: 'drill', wordId, steps: drillSteps(media[wordId], capabilities) }));
  else if (mode === 'quiz') {
    const eligible = ids.filter((id) => words[id].state !== 'mastered' && words[id].verifyFailedDay !== day);
    queue = [...eligible.map((wordId) => ({ kind: 'graded', task: '3.3', wordId })), ...eligible.map((wordId) => ({ kind: 'graded', task: '2.2', wordId }))];
  }
  return { mode, help, queue, index: 0, step: 0, passed: [], failed: [] };
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (4 tests).
- [ ] **Step 5: Commit** — `git commit -m "feat(school): word ladder practice runs" -- backend/src/2_domains/school/wordLadder/practice.mjs backend/src/2_domains/school/wordLadder/practice.test.mjs`

---

### Task 3: Engine — drills, drill offer, intro say-after, capabilities

**Files:**
- Modify: `backend/src/2_domains/school/wordLadder/engine.mjs`
- Modify: `backend/src/2_domains/school/wordLadder/engine.test.mjs` (add a `describe('engine — drill')`)
- Modify: `backend/src/2_domains/school/wordLadder/statusV3.mjs` (`emptyDay` gains `drills: []`, `practice: null`, `capabilities: { microphone: false }`)

**Interfaces:**
- Consumes: `drillSteps`, `tilesFor`, `matchBoard` (Task 1).
- Produces (additions to Plan 1's engine):
  - `openDay({..., capabilities})` — records `dayFile.capabilities = { microphone: capabilities?.microphone === true }` on **every** call (the latest device wins).
  - After rechecks and before rounds: if no tricky drill has run today (`dayFile.drills.filter(d => d.source === 'tricky').length < settings.drill.perSitting`) and `atOpen.tricky` has a word still `tricky` and remaining ≥ 240000 → push `{ id:'d<n>', source:'tricky', wordId, steps: drillSteps(media[wordId], dayFile.capabilities), index:0, done:false }` (oldest `trickySince` first).
  - Intro gains step `say` after `copy` when `dayFile.capabilities.microphone && media[wordId].audio`: item `{ id:'<r>:i:<w>:say', type:'say', mode:'say-after', wordId }`, response `{ done:true }`.
  - Round end: after the quiz (or no quiz), if cap not elapsed and remaining ≥ 240000 and some round word's latest sort is Not yet → `round.phase = 'offer'`, `round.offer = { wordId }` (most Not-yet sorts, then id); item `{ id:'<r>:offer', type:'drill-offer', wordId }`; response `{ drill:'yes'|'no' }` → yes pushes `{ source:'offer', … }` drill then `finishRound`; no → `finishRound`.
  - Drill items: `{ id:'<d>:<index>', type:'drill', step, wordId, tiles? (tiles step), board? (match step, board of the drill word + up to 3 introduced deck words), cue? (say-from-cue/type) }`. Responses: `look`/`say-after`/`read-aloud`/`say-from-cue`/`match` → `{ done:true }`; `copy`/`dictation` → `{ typed }` must equal the term after `normalizeAnswer`, else result `{correct:false}` and the item stays; `tiles` → `{ tiles:[...] }` joined must equal the term's syllables, else stays (after 2 wrong tries the correct order is returned in `result.answer` and the next try advances regardless); `type` → `{ typed }` advances with `result: { correct, answer }` (practice — never grades).
  - `currentItem` order: rechecks → open drill → open round → summary. `dayDone` additionally requires: if `atOpen.tricky.length > 0` and a tricky drill fit, it ran.

- [ ] **Step 1: Write the failing tests** (append to `engine.test.mjs`)

```js
describe('engine — drill', () => {
  const trickyStatus = () => {
    const s = emptyStatusV3();
    s.words.gawi = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-10', tricky: true, trickySince: '2026-09-20', missStreak: 2 };
    return s;
  };
  it('a tricky word is drilled before rounds, skipping mic steps without a mic', () => {
    const ctx0 = start(trickyStatus());
    const item = currentItem(ctx0);
    expect(item).toMatchObject({ type: 'drill', step: 'look', wordId: 'gawi' });
    expect(ctx0.dayFile.drills[0].steps).not.toContain('say-after');
  });
  it('drill never changes word state; copy must match to advance', () => {
    let ctx = start(trickyStatus());
    const before = structuredClone(ctx.status.words.gawi);
    ({ ctx } = step(ctx, { done: true }));
    const { ctx: stay, result } = step(ctx, { typed: '가이' });
    expect(result.correct).toBe(false);
    expect(currentItem(stay)).toMatchObject({ step: 'copy' });
    let c = stay;
    let guard = 0;
    while (currentItem(c).type === 'drill' && guard++ < 20) {
      const it = currentItem(c);
      const r = it.step === 'copy' || it.step === 'dictation' || it.step === 'type' ? { typed: '가위' }
        : it.step === 'tiles' ? { tiles: ['가', '위'] } : { done: true };
      ({ ctx: c } = step(c, r));
    }
    expect(c.status.words.gawi).toEqual(before);
    expect(c.dayFile.drills[0].done).toBe(true);
  });
  it('round end offers one drill for the chronic Not-yet word', () => {
    let ctx = start();
    let guard = 0;
    while (currentItem(ctx).type !== 'drill-offer' && currentItem(ctx).type !== 'summary' && guard++ < 80) {
      const item = currentItem(ctx);
      if (item.type === 'flashcard' && item.mode === 'intro') ({ ctx } = step(ctx, { seen: true }));
      else if (item.type === 'copy') ({ ctx } = step(ctx, { typed: lexicon.entries.get(item.wordId).term }));
      else if (item.type === 'flashcard') ({ ctx } = step(ctx, { sort: item.wordId === 'pul' ? 'notYet' : 'claimed' }));
      else if (item.type === 'typed') ({ ctx } = step(ctx, { typed: 'x' }, PASS));
      else ({ ctx } = step(ctx, { choice: lexicon.entries.get(item.wordId).gloss }));
    }
    expect(currentItem(ctx)).toMatchObject({ type: 'drill-offer', wordId: 'pul' });
    ({ ctx } = step(ctx, { drill: 'no' }));
    expect(currentItem(ctx).type).not.toBe('drill-offer');
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run backend/src/2_domains/school/wordLadder/engine.test.mjs` → the three new tests FAIL.

- [ ] **Step 3: Implement.** Add to `engine.mjs` (keep every Plan 1 behaviour):

```js
import { drillSteps, matchBoard, tilesFor } from './drill.mjs';

const DRILL_MS = 240000;
const TYPED_DRILL_STEPS = new Set(['copy', 'dictation']);

function openDrill(ctx) { return (ctx.dayFile.drills ?? []).find((d) => !d.done) ?? null; }

function maybeStartTrickyDrill(ctx) {
  const drills = ctx.dayFile.drills ?? (ctx.dayFile.drills = []);
  if (drills.filter((d) => d.source === 'tricky').length >= ctx.settings.drill.perSitting) return false;
  if (remainingMs(ctx) < DRILL_MS) return false;
  const candidates = (ctx.dayFile.atOpen?.tricky ?? [])
    .filter((id) => wordOf(ctx.status, id).tricky && !drills.some((d) => d.wordId === id))
    .sort((a, b) => String(wordOf(ctx.status, a).trickySince).localeCompare(String(wordOf(ctx.status, b).trickySince)) || a.localeCompare(b));
  if (!candidates.length) return false;
  drills.push(newDrill(ctx, candidates[0], 'tricky'));
  return true;
}

function newDrill(ctx, wordId, source) {
  const n = (ctx.dayFile.drills ?? []).length + 1;
  return { id: `d${n}`, source, wordId, steps: drillSteps(ctx.media[wordId] ?? {}, ctx.dayFile.capabilities ?? {}), index: 0, tries: 0, done: false };
}

function drillItem(ctx, drill) {
  const step = drill.steps[drill.index];
  const entry = ctx.lexicon.entries.get(drill.wordId);
  const seed = `${ctx.learnerId}|${ctx.day}|${drill.id}|${drill.index}`;
  const base = { id: `${drill.id}:${drill.index}`, type: 'drill', step, wordId: drill.wordId, of: drill.steps.length, at: drill.index + 1 };
  if (step === 'tiles') {
    const deckTerms = [...ctx.lexicon.entries.values()].map((e) => e.term);
    return { ...base, tiles: tilesFor(entry, deckTerms, seed) };
  }
  if (step === 'match') {
    const others = Object.entries(ctx.status.words).filter(([id, w]) => id !== drill.wordId && w.state !== 'new').map(([id]) => ctx.lexicon.entries.get(id)).filter(Boolean);
    const board = [entry, ...seededShuffle(others, hashString(`${seed}|others`)).slice(0, 3)];
    return { ...base, board: matchBoard(board, ctx.media, seed) };
  }
  if (step === 'say-from-cue' || step === 'type') return { ...base, cue: cueFor(entry, ctx.media[drill.wordId] ?? {}, seed) };
  return base;
}

function respondDrill(ctx, drill, response) {
  const step = drill.steps[drill.index];
  const term = ctx.lexicon.entries.get(drill.wordId).term;
  let result = { ok: true };
  if (TYPED_DRILL_STEPS.has(step)) {
    const correct = normalizeAnswer(response.typed) === normalizeAnswer(term);
    result = { correct, answer: term };
    if (!correct) return { result, advance: false };
  } else if (step === 'tiles') {
    const correct = (response.tiles ?? []).join('') === normalizeAnswer(term);
    drill.tries += 1;
    result = { correct, answer: correct || drill.tries >= 2 ? term : null };
    if (!correct && drill.tries < 3) return { result, advance: false };
  } else if (step === 'type') {
    result = { correct: normalizeAnswer(response.typed) === normalizeAnswer(term), answer: term };
  }
  drill.index += 1; drill.tries = 0;
  if (drill.index >= drill.steps.length) drill.done = true;
  return { result, advance: true };
}
```

Wire it:
- In `openDay`: `nextDay.capabilities = { microphone: capabilities?.microphone === true };` and `nextDay.drills ??= []`.
- In `currentItem`: after the pending-recheck check, `const drill = openDrill(ctx); if (drill) return drillItem(ctx, drill);`.
- In `respond`: before the round branch, `const drill = openDrill(ctx); if (drill && item.type === 'drill') { const { result: r } = respondDrill(ctx, drill, response); result = r; if (!r || r.correct !== false || ...) … }` — record in `items` only when the step advanced (a non-advancing copy/tiles attempt must not be stored, or the retry would replay it): 

```js
    if (item.type === 'drill') {
      const { result: r, advance } = respondDrill(ctx, openDrill(ctx), response);
      if (!advance) return { status: ctx.status, dayFile: ctx.dayFile, result: r };
      result = r;
    }
```
- In the end-of-respond planning block, before planning a round: `if (!openDrill(ctx) && maybeStartTrickyDrill(ctx)) { /* drill is now current */ } else if (!openRound(ctx) && …) { …plan round… }`. Also call `maybeStartTrickyDrill` at the end of `openDay` when rechecks are empty (before planning the first round).
- Intro say step: in `itemForRound` intro branch add `round.intro.step === 'say'` → `{ id: \`${round.id}:i:${wordId}:say\`, type: 'say', mode: 'say-after', wordId }`; in `respond`'s copy branch, when correct and `ctx.dayFile.capabilities?.microphone && ctx.media[item.wordId]?.audio`, set `round.intro.step = 'say'` instead of advancing; add a `say` branch that advances exactly as copy did.
- Drill offer: replace the body of `finishRound` so that, when called at the end of the quiz, it first checks for an offer:

```js
function offerFor(ctx, round) {
  if (round.offerSettled || remainingMs(ctx) < DRILL_MS) return null;
  const counts = {};
  for (const id of round.words) if (round.stream.latest[id] === 'notYet') counts[id] = round.stream.notYetCount?.[id] ?? 1;
  const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  return ranked[0] ?? null;
}
```
  Track `round.stream.notYetCount[wordId] += 1` in `applyStreamSort` when `pile === 'notYet'`. In `gradeQuizTask`/`startQuiz` where the round would finish, call `endRound(ctx, round)` = `const offer = offerFor(ctx, round); if (offer) { round.phase = 'offer'; round.offer = { wordId: offer }; } else finishRound(ctx, round);`. `itemForRound` for `phase === 'offer'` → `{ id: \`${round.id}:offer\`, type: 'drill-offer', wordId: round.offer.wordId }`. `respond` for `drill-offer`: `round.offerSettled = true; if (response.drill === 'yes') ctx.dayFile.drills.push(newDrill(ctx, round.offer.wordId, 'offer')); finishRound(ctx, round);`.
- `dayDone`: unchanged (it is "current item is summary"); the tricky drill is simply ordered before rounds so a day cannot reach summary with a fitting tricky drill unrun.

- [ ] **Step 4: Run** — `npx vitest run backend/src/2_domains/school/wordLadder/` → all PASS (Plan 1 engine tests included — no regression).
- [ ] **Step 5: Commit** — `git commit -m "feat(school): word ladder engine — tricky drill, drill offer, intro say-after" -- backend/src/2_domains/school/wordLadder/engine.mjs backend/src/2_domains/school/wordLadder/engine.test.mjs backend/src/2_domains/school/wordLadder/statusV3.mjs`

---

### Task 4: Engine — practice runs and the menu

**Files:**
- Modify: `engine.mjs`, `engine.test.mjs`

**Interfaces:**
- Produces:
  - `startPractice(ctx, { mode, help, filter, chosen, frontSide }): { status, dayFile }` — throws `ValidationError('practice opens after today\'s goal')` unless `dayFile.doneAt`; replaces `dayFile.practice` with `buildPractice(...)`.
  - `currentItem` when `dayFile.doneAt` and `dayFile.practice` has queue left → the practice item; when done and no practice (or finished) → `{ id:'menu', type:'menu', modes: PRACTICE_MODES filtered (say only with mic, listen only if any audio), quizzed }` (replaces Plan 1's `summary` once the day is done; the first time the day completes return `{type:'summary'}` once, then `menu` — track `dayFile.summarySeen`).
  - Practice item ids `p<runNumber>:<index>[:<step>]`; kinds map to item types: `flashcard` → `{type:'flashcard', mode:'practice', wordId, front}` (responses `{sort}` apply rule 2 via `applySort` but never above `claimed`; `{next:true}` skips); `match` → `{type:'match', board}` (`{done:true}`); `say-after`/`say-from-cue` → `{type:'say', mode, wordId, cue?}`; `copy` → `{type:'copy', wordId}` (must match); `type-practice` → `{type:'typed', task:'3.3', source:'practice', wordId, cue}` (needs a judge verdict, never grades); `listen` → `{type:'listen', wordIds}` (`{done:true}`); `drill` → the drill steps as `type:'drill'` items; `graded` → Plan 1's verify item with `source:'practice'`, graded with `applyGraded({source:'verify'})` and first-miss stop.
  - Response `{menu:true}` on any practice item ends the run.

- [ ] **Step 1: Write the failing tests** (append)

```js
describe('engine — practice', () => {
  function doneCtx() {
    const ctx = start();
    return { ...ctx, dayFile: { ...ctx.dayFile, doneAt: 'x', rounds: [], rechecks: { order: [], answered: {} }, summarySeen: true } };
  }
  it('menu appears after the goal; practice before it is refused', () => {
    expect(() => startPractice(start(), { mode: 'match' })).toThrow(/after today/);
    expect(currentItem(doneCtx())).toMatchObject({ type: 'menu' });
  });
  it('practice flashcards can lower a mastered word but not raise past claimed', () => {
    let ctx = doneCtx();
    ctx.status.words.gawi = { ...emptyWordV3(), state: 'mastered', stage: 2, introducedDay: '2026-09-01' };
    ctx.status.words.pul = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-01' };
    ({ status: ctx.status, dayFile: ctx.dayFile } = startPractice(ctx, { mode: 'flashcards', filter: 'introduced' }));
    for (let i = 0; i < 2; i += 1) {
      const it = currentItem(ctx);
      ({ ctx } = step(ctx, { sort: it.wordId === 'gawi' ? 'familiar' : 'claimed' }));
    }
    expect(ctx.status.words.gawi.state).toBe('familiar');
    expect(ctx.status.words.pul.state).toBe('claimed');
  });
  it('practice quiz grades like verify', () => {
    let ctx = doneCtx();
    ctx.status.words.pul = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-01' };
    ({ status: ctx.status, dayFile: ctx.dayFile } = startPractice(ctx, { mode: 'quiz', filter: 'introduced' }));
    ({ ctx } = step(ctx, { typed: '풀' }, PASS));
    ({ ctx } = step(ctx, { choice: 'Glue' }));
    expect(ctx.status.words.pul).toMatchObject({ state: 'mastered', stage: 0 });
  });
});
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** — `startPractice` (exported) builds with `buildPractice({ ..., words: ctx.status.words, entries: ctx.lexicon.entries, media: ctx.media, day: ctx.day, seed: \`${ctx.learnerId}|${ctx.day}|p${runNumber}\`, capabilities: ctx.dayFile.capabilities })` and stores `{ ...run, id: \`p${runNumber}\` }` in `dayFile.practice` (`runNumber = (dayFile.practiceRuns ?? 0) + 1`, increment `practiceRuns`). `currentItem`: if `ctx.dayFile.doneAt`: if `!summarySeen` → summary (and `respond` to `summary` with `{done:true}` sets `summarySeen`); else if a practice run has `index < queue.length` → practice item; else menu. Map each task kind to its item as listed; drill tasks reuse `drillItem`/`respondDrill` over a drill object stored on the task (`task.drill = { id: \`${run.id}:${index}\`, wordId, steps, index:0, tries:0, done:false }`), advancing `run.index` when that drill is done. Graded practice tasks reuse `gradeQuizTask`'s logic on `run` (factor the shared part into `gradeVerifyTask(ctx, holder, task, correct)` used by both round quizzes and practice).
- [ ] **Step 4: Run** — `npx vitest run backend/src/2_domains/school/wordLadder/` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(school): word ladder practice runs and menu in the engine" -- backend/src/2_domains/school/wordLadder/engine.mjs backend/src/2_domains/school/wordLadder/engine.test.mjs`

---

### Task 5: Seeds `tricky` and `typos`; service + routes for capabilities, recordings, practice, words

**Files:**
- Modify: `scenarios.mjs` (+ test)
- Create: `backend/src/1_adapters/school/wordLadder/DiscardingRecordings.mjs` (+ test)
- Modify: `backend/src/3_applications/school/WordLadderSittingService.mjs` (+ test)
- Modify: `backend/src/4_api/v1/routers/school.wordLadder.mjs` (+ test)
- Modify: `backend/src/app.mjs` (recordings for live, discarding for test)

**Interfaces:**
- `seedScenario('tricky')`: every deck word `familiar`, `introducedDay` day−3, first word `tricky:true, trickySince: day−1, missStreak: 2`. `seedScenario('typos')`: every deck word `familiar`, `introducedDay` day−1 (a carry round whose quiz has typed items; the harness types misspellings).
- `DiscardingRecordings` — `save() → { take: n }` (counts per word in memory), `latest() → null`.
- Service:
  - `open({ userId, deckId, scenario, capabilities })` passes `capabilities` into `openDay`.
  - `saveRecording({ userId, sittingId, itemId, buffer, ext })` — only for the current item when it is a `say`/`drill` speaking step; writes via `recordings.save({ package, learnerId, day, wordId, buffer, ext })`; returns `{ take }`. Never touches status.
  - `practice({ userId, sittingId, mode, help, filter, chosen, frontSide })` → `{ item, progress }` via `startPractice`.
  - `words({ userId, deckId })` → `{ words: [{ wordId, term, gloss, state, stage, tricky, dueDay }] }` for every pool/introduced word of the package, in deck order.
  - Public items: `drill`/`say`/`listen`/`match`/`menu`/`drill-offer` items carry what the screen needs: `word` card for `look`, `copy`, `say-after`, `read-aloud` (text only), `dictation` (audio only — **no term**), `tiles` (no term), `type`/`say-from-cue` (cue only); `match` carries `board` with image asset ids for `right.type === 'image'`; `listen` carries `words: [{term, audio}]`.
- Routes (live + test): `POST {base}/sittings/:id/recordings/:itemId` (raw audio, `express.raw` as today's route), `POST {base}/sittings/:id/practice` body `{ userId, mode, help, filter, chosen, frontSide }`, `GET {base}/words?userId&deckId`. `open` accepts `capabilities` on both.

- [ ] **Steps:** failing tests first for each unit (scenario seeds, discarding sink, service `saveRecording` refusing a non-speaking item and never changing status, `practice` refused before the goal, `words` order and fields, route wiring incl. test-mode recordings going to the discarding sink), then implement, run `npx vitest run backend/src/2_domains/school/wordLadder/ backend/src/1_adapters/school/wordLadder/ backend/src/3_applications/school/ backend/src/4_api/v1/routers/school.wordLadder.test.mjs`, `npm run audit:layers`, commit with a pathspec.

Service test excerpt (the privacy rule for drill items):

```js
it('dictation and tiles items never carry the term', async () => {
  // seed: tricky scenario through the test stores; walk to the dictation step
  // …
  expect(JSON.stringify(item)).not.toContain('가위');
});
```

---

### Task 6: Keypad — `offerJamo` seam and `JamoKeypad`

**Files:**
- Modify: `frontend/src/modules/School/ime/fieldComposer.js` (+ `fieldComposer.test.js`)
- Modify: `frontend/src/modules/School/ime/HangulTypingProvider.jsx` (+ test)
- Create: `frontend/src/modules/School/Programs/Flashcards/WordLadder/JamoKeypad.jsx` (+ `JamoKeypad.test.jsx`)
- Modify: `.../WordLadder/items/TypedItem.jsx`

**Interfaces:**
- `FieldComposer#offerJamo(jamo, el, oracle?) → boolean` — the body of `handleKey` from `this.#ensureSession(el)` onward, extracted into a private `#offer(jamo, el, oracle)`; `handleKey` calls `#offer(Hangul.jamoFor(event.code, event.shiftKey), el, oracle)`; `offerJamo` validates `jamo` is a single compatibility jamo and calls `#offer`. Plus `offerBackspace(el)` → `#backspace(el)`.
- `useHangulTyping()` context gains `offerJamo(jamo)` and `offerBackspace()` acting on `document.activeElement` (or the last focused composable field) — same composer instance the key path uses, so physical and on-screen keys interleave correctly.
- `<JamoKeypad onSubmit open onToggle>` — 두벌식 rows `ㅂㅈㄷㄱㅅㅛㅕㅑㅐㅔ / ㅁㄴㅇㄹㅎㅗㅓㅏㅣ / ⇧ ㅋㅌㅊㅍㅠㅜㅡ ⌫`, a wide Enter; Shift maps ㅂ→ㅃ ㅈ→ㅉ ㄷ→ㄸ ㄱ→ㄲ ㅅ→ㅆ ㅐ→ㅒ ㅔ→ㅖ and releases after one key. Buttons use `onPointerDown` + `preventDefault()` so the field keeps focus. Keys are `TouchButton`s at ≥ 64 px; the keypad fits in 3 rows + Enter within the stage (mock screenshot at 1280×800 in Task 9).
- `TypedItem`: a **Keypad** toggle button (key `K` in the key map is NOT used — the field has focus); auto-open once per item after 10 s focus with no keydown; close on the first physical keydown in the field; `keypad.toggled` log `{auto}`.

- [ ] **Steps:** failing tests — `fieldComposer.test.js`: `offerJamo('ㄱ'); offerJamo('ㅏ'); offerJamo('ㅇ'); offerJamo('ㅜ'); offerJamo('ㅣ')` on a `lang="ko"` input yields `가위`; `offerBackspace` removes the last jamo; `JamoKeypad.test.jsx`: pressing ⇧ then ㄱ calls `offerJamo('ㄲ')` and Shift releases; pressing a key does not blur a focused input. Implement, run `npx vitest run frontend/src/modules/School/ime/ frontend/src/modules/School/Programs/Flashcards/WordLadder/`, commit.

---

### Task 7: Speaking — `useTakeRecorder` and `SayItem`

**Files:**
- Create: `.../WordLadder/useTakeRecorder.js` (+ test)
- Create: `.../WordLadder/items/SayItem.jsx`
- Modify: `.../WordLadder/wordLadderApi.js` (`uploadRecording(sittingId, {userId, itemId, blob})`, `practice(...)`, `words(...)`, `open` sends `capabilities`)

**Interfaces:**
- `useTakeRecorder({ onTake })` — wraps `SentenceLadder/rungs/useVoiceCapture.js` + `shared/speechFloor.js` `judgeTake`; returns `{ start, stop, phase:'idle'|'recording'|'saving', verdict:null|'too-quiet'|'too-short', stream }`; a refused take never calls `onTake`.
- `<SayItem item mode:'say-after'|'read-aloud'|'say-from-cue' langs resolveAssetUrl onRespond api sittingId userId>` — say-after: term + native audio, **Record** → take plays back then native; read-aloud: term only (no audio until after the take); say-from-cue: cue only, native plays after the take. **Next** (Space) sends `{done:true}` — available after one take **or** immediately via "Skip" (speaking is never a gate). Uploads each take via `api.uploadRecording`; a failed upload logs `recording.failed` and does not block Next.
- Program: `open` sends `capabilities: { microphone }` from `useCapabilities(\`word-ladder:${pkg}\`, languages)` (existing hook; its first render has no package — call open with `microphone: false` and re-open is NOT needed: the engine updates capabilities on every `openDay`, so send the capability on the next `open`; for the first sitting, detect via `navigator.mediaDevices?.getUserMedia` presence + the stored capability key before calling `open`).

- [ ] **Steps:** failing test for `useTakeRecorder` (mock `useVoiceCapture`: a take with `heard:false` → verdict `too-quiet`, no `onTake`; a good take → `onTake(blob)`), `SayItem` test (Next is enabled before any take — never a gate; say-from-cue renders no term before the take). Implement, run, commit.

---

### Task 8: Drill, match, tiles, listen, offer, menu, words screens

**Files:**
- Create: `.../WordLadder/items/DrillItem.jsx`, `TilesItem.jsx`, `MatchItem.jsx`, `ListenItem.jsx`, `DrillOfferItem.jsx`, `MenuItem.jsx`, `WordsItem.jsx` (+ `items2.test.jsx`)
- Modify: `.../WordLadder/WordLadderProgram.jsx` (dispatch new types; menu → `api.practice`; My words → `api.words`)
- Modify: `.../WordLadder/WordLadder.scss`

**Interfaces:**
- `DrillItem` — header "Practising <term?>" (term hidden on `dictation`/`tiles`/`type`/`say-from-cue`), step dots `at/of`; delegates: `look` → picture + term + audio + gloss together (the one place they co-appear), Next; `copy`/`dictation`/`type` → `TypedItem` (`mode` copy for copy, `dictation` = audio-only prompt + typed, `practice` for type); `say-after`/`read-aloud`/`say-from-cue` → `SayItem`; `match` → `MatchItem`; `tiles` → `TilesItem`.
- `TilesItem` — tiles as `TouchButton`s; tap appends to an answer row, tap an answer tile to remove; **Check** sends `{tiles}`; wrong → "Not quite" and shows the order after the second wrong try (`result.answer`).
- `MatchItem` — left column Korean terms, right column pictures/English (shuffled); tap left then right; a correct pair locks (green), a wrong pair flashes; all matched → **Next** `{done:true}`. Client-side only; logs `match.completed {ms, misses}`.
- `ListenItem` — plays each word's audio with its term shown, 1.5 s gap, autoplay run; **Again** / **Next**.
- `DrillOfferItem` — "This one's tricky — want to practise it?" with the term; **Practise** (1) → `{drill:'yes'}`, **Not now** (2) → `{drill:'no'}`.
- `MenuItem` — grid of `TouchButton` tiles for `item.modes`; Say and Write open a With help / Without help chooser; Flashcards opens front-side (Korean / Meaning) chooser; Drill opens `WordsItem` in pick mode; **My words** opens `WordsItem` read-only; **Done** exits.
- `WordsItem` — grid of words with state chips (New / Not yet / Familiar / Got it / Mastered ⭐×stage / Tricky); pick mode multi-selects then **Drill these**.

- [ ] **Steps:** failing tests (`items2.test.jsx`): MatchItem completes after all pairs and sends `{done:true}`; TilesItem sends the tapped order; DrillOfferItem keys 1/2; MenuItem offers only `item.modes`; DrillItem hides the term on dictation. Implement, run `npx vitest run frontend/src/modules/School/Programs/Flashcards/WordLadder/`, `npm run check:scss`, `npm run audit:ui`, commit.

---

### Task 9: Verify, document, ship

**Files:**
- Modify: `tests/live/flow/school/word-ladder-stage.runtime.test.mjs` (add `tricky`, `typos`, `done` → practice walk; keypad screenshot)
- Modify: `docs/reference/school/word-ladder.md`, `docs/runbooks/school/README.md`

- [ ] **Step 1:** `npm run test:unit:vitest` → exit 0 (capture `$?`).
- [ ] **Step 2:** Deploy through the gate (Plan 1 Task 19 Step 4 commands, verbatim).
- [ ] **Step 3:** `WORD_LADDER_TEST_LEARNER=<enrolled id> npx playwright test tests/live/flow/school/word-ladder-stage.runtime.test.mjs --reporter=line` → all pass; **look at every screenshot**: drill steps (look shows picture + Korean together; dictation shows no Korean), tiles, match board, keypad open over a typing item within 1280×800, drill offer, menu, My words. Confirm the learner's real `status.yml` and day file checksums are unchanged by the test runs.
- [ ] **Step 4:** Update the reference doc (drill, offer, speaking, keypad, practice, My words; remove "deferred to Plan 2" notes) and the runbook (recordings location, keypad).
- [ ] **Step 5:** Commit with a pathspec.

## Self-review notes

- Spec §3 lists 1.5 pick-spelling as a drill leaf but the §3 drill path does not include it; Plan 2 follows the path (1.5 stays available for a later practice mode) — recorded as a deliberate omission.
- Recordings in test mode go to `DiscardingRecordings`; the Plan 1 test-mode safety test must be extended in Task 5 to upload a take and assert no file appears under the recordings root.
