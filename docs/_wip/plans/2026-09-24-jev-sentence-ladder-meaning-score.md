# Sentence Ladder Meaning Score Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Record a typed-decision "meaning" score beside the character-level `accuracy` on every answered interpretation attempt, so a grown-up can tell "wrote it differently" from "did not understand it".
**Architecture:** A new application service, `SentenceMeaningJudge`, applies two code rules (exact copy, no words at all) and otherwise asks the decision gateway one Score question with a hard 1.5 s deadline, returning `null` on any failure. `SentenceLadderService` gains an async `submitAttempt` that awaits the judge and then calls the unchanged synchronous record path, adding an optional `meaning` field to the same append-only row. Composition builds the judge only when a decision gateway is configured and the school config does not switch it off. The router switches to `submitAttempt`. The course card gets a teacher-only "Meaning understood" score next to "Typing accuracy".
**Tech Stack:** Node ESM (`.mjs`), vitest, `IDecisionGateway` port (Jev adapter), js-yaml append-only day shards.

---

## Current state (verified)

- **Which rungs compare against which language.** `backend/src/2_domains/school/language/ladder.mjs:33-54`:
  `dictation` answers in `ROLES.TARGET` (Korean for the Glossika corpus) as text; `interpretation` answers in
  `ROLES.SOURCE` (English) as text; `recording` is audio; `repetition` has no response. So **interpretation is the only
  rung where the learner writes in their own language**, and the only one where different words can still be right.
  Dictation is a transcription of what was heard; a meaning score there is not useful and Jev is weaker on CJK. Scope:
  a rung whose `response` is `{ role: SOURCE, modality: 'text' }`, which today is interpretation alone.
- **The comparison.** `backend/src/2_domains/school/language/transcription.mjs:26-32` normalises (`typeableText`, trim,
  collapse whitespace, lowercase); `:74-82` `accuracy()` = 1 − Levenshtein / longer length, rounded to 3 dp. Matches the
  doc (`docs/reference/school/sentence-ladder.md:494-501`).
- **Where it is recorded.** `backend/src/3_applications/school/LanguageStudyService.mjs:509-519` `logAttempt` (sync,
  public) → `:521-647` `#recordAttempt` (sync). Text rungs set `event.expected`/`event.language` (`:568-571`); a reveal
  gets `revealed: true` and **no** `given`/`accuracy` (`:573-596`); an answer gets `given`, `accuracy` (`:603-604`) and
  optional `method` (`:620-625`). Then `this.#ds.appendEvent(...)` (`:632`). The whole path is synchronous; accuracy
  gates nothing (doc `:497-501`, service comment `:503-507`).
- **The log is append-only.** `backend/src/1_adapters/persistence/yaml/YamlLanguageStudyDatastore.mjs:98-114`
  `appendEvent` loads the day shard, pushes, saves. There is no update-in-place API. `saveYaml` calls `yaml.dump` with
  no `skipInvalid` (`backend/src/0_system/utils/FileIO.mjs:167`), so **an `undefined` anywhere in an event throws on
  write**; every field this plan adds must be a value or `null`.
- **Readers that fold the log** (all would need to learn a second row shape if meaning were appended later as its own
  row): `dayQueue.mjs:74-100` `clearedIndex` (skips rows without `rung`), `#summarizeCourse` `:1166-1277`,
  `getHistory` `:899-`, `rollDay` `:871`, `todayStatus` `:1041-`, plus the trace CLI.
- **Teacher metric.** `#summarizeCourse` `:1211` `scored = log.filter(typeof e.accuracy === 'number')`, `:1253-1262`
  pushes `{ id: 'accuracy', kind: 'score', label: 'Typing accuracy', value: mean }` and a trend. No `audience` →
  grown-up only. `frontend/src/modules/School/report/MetricTile.jsx:83-84` renders any `kind: 'score'` as a percentage
  of a 0..1 value, so a new metric in 0..1 needs **no frontend change**.
- **Router.** `backend/src/4_api/v1/routers/language.mjs:213-232` `POST /users/:userId/log` calls
  `languageStudyService.logAttempt({...})` inside `wrap` (`:155-158`), which already resolves promises
  (`Promise.resolve().then(() => fn(req, res))`), so an async handler needs no wrapper change. Router tests mock
  `logAttempt` in 8 places (`language.test.mjs:32,187,193,201,246,252,452,462`).
- **Composition.** `backend/src/5_composition/modules/schoolLanguage.mjs:36-58` `createLanguageStudyService` builds
  `SentenceLadderService`; `backend/src/app.mjs:3584-3610` calls it. `decisionGateway` is declared at
  `app.mjs:711-717` in the same function scope (null until a Jev key is configured) and is already passed to
  `CardLadderTypedJudge` at `:3236-3238`. `schoolFullConfig` (`app.mjs:3055`) has no `language` key read anywhere today.
- **Frontend.** `frontend/src/modules/School/Programs/SentenceLadder/languageApi.js:134` POSTs the attempt and logs
  `api ok {path, method, status, ms}` for every settled request (`:45-50`), which is how added latency is measured.
  No client-side timeout. Interpretation commits from a frozen "You typed / The answer" panel (doc `:480-493`), so the
  learner is reading, not typing, while the POST is in flight.
- **Real data (2026 rows in the live tree):** 36 interpretation rows, 28 with `accuracy`, 8 reveals; 8 `method:
  spoken`. Examples of the gap this closes: `today the weather is nice` vs `The weather's nice today.` scored 0.4;
  `Her kids are at school.` vs `Her children are at school.` 0.778; `It's a nice and warm sunny day today.` vs
  `The weather's warm and sunny today.` 0.459. And rows the score must not dignify: `n`, `,,,,,`, `🙃🙃🙃🙃🙃🙃`.

### Sync vs async — decision: bounded await, same row

Chosen: `submitAttempt` awaits the judge **before** the synchronous record, with a hard 1.5 s deadline
(`Promise.race` + `timeout` option), and any failure yields `null` → the field is simply absent, exactly today's row.

Why not fire-and-record-later: the log is append-only with no update API. Recording meaning afterwards means either
(a) a second row shape (`kind: 'meaning'`) that every fold listed above must learn to skip — `clearedIndex` happens to
skip rung-less rows, the others do not — or (b) rewriting a day shard in place, which breaks the evidence contract the
whole program rests on. A fire-and-forget promise is also lost on restart. The cost of awaiting is small: Jev answers in
~70-500 ms, the deadline caps the worst case, the learner is looking at the compare panel while it runs, and only the
interpretation rung pays it (other rungs return before any await). Two code rules skip the call entirely for exact
copies and non-answers. The synchronous `logAttempt` is kept unchanged for every other caller and test.

The judge runs before the due check. A stale double-submit therefore spends one extra Jev call before being refused;
that is bounded and cheaper than building the day queue twice. The `school.language.meaning` log line is written only
after the row is stored, so refused attempts leave no meaning evidence.

## Questions for Jev

One question per answered interpretation attempt:

```js
import { score } from '#apps/common/ports/IDecisionGateway.mjs';

const MEANING_LEVELS = [
  'Different meaning: unrelated, the wrong sentence, or not an answer at all',
  'Partly the same meaning: some of it is right, but part of the sense is missing or wrong',
  'The same meaning, except one detail is wrong (a word, a number, who, or when)',
  'The same meaning in different words',
  'The same words as `reference`',
];

score(
  'A child heard a sentence in the language they are learning and wrote what it means. '
  + '`reference` is the correct translation and `answer` is what the child wrote. '
  + 'How closely does `answer` carry the meaning of `reference`? '
  + 'Ignore spelling, spacing, punctuation, capital letters and contractions.',
  MEANING_LEVELS,
);
```

State (plain object, English text, well under the 32k limit):

```js
{ reference: "The weather's nice today.", answer: 'today the weather is nice', language: 'EN' }
```

`language` is the corpus's source-role code, carried so rows can be split if a non-English source corpus is ever added.

Code rules before the call (no gateway traffic):
- `accuracy === 1` (normalised exact copy) → `{ level: 4, score: 1, confidence: 1, judge: 'exact' }`.
- `answer` contains no letter in any script (`/\p{L}/u` fails: `,,,,,`, `.`, emoji) → `{ level: 0, score: 0, confidence: 1, judge: 'no-words' }`.

Stored on the row (all values non-`undefined`):

```yaml
meaning:
  score: 0.803        # probability-weighted level ÷ 4, 0..1 — same scale as accuracy
  level: 3            # rounded level index into MEANING_LEVELS
  confidence: 0.82    # or null
  judge: model        # model | exact | no-words
  model: jev-1.13.0   # only when judge is model
```

## Rollout

There is nothing to shadow in the usual sense: nothing decides on meaning today and this slice decides nothing either.
The field is **recorded, never gating**, same as `accuracy`. Rollout controls whether it is recorded and whether it is
trusted enough to show beyond the grown-up card.

1. **Ship (this plan):** on by default wherever a decision gateway is configured. Off switch in the school household
   config: `language.meaning_judge.enabled: false`; deadline override `language.meaning_judge.timeout_ms`. Teacher-only
   "Meaning understood" metric on the course card.
2. **Measure** from the backend event `school.language.meaning`
   (`{learnerId, corpus, seq, accuracy, meaning, level, confidence, judge, model, method, practice, ms}`) and the warn
   `school.language.meaning-failed` (`{error, ms}`):
   - `"school.language.meaning" AND _time:7d` — volume, `judge` mix, and the disagreement set: rows with
     `|accuracy − meaning| ≥ 0.3`.
   - `"school.language.meaning-failed" AND _time:7d` — timeouts and errors.
   - Frontend `api ok` rows whose `path` is the `/log` POST — p95 `ms` before and after deploy.
3. **Promote** (show the meaning figure to the learner and on the Review shelf — a separate plan) when all hold:
   - ≥ 50 `judge: model` rows;
   - a grown-up labels 20 rows from the disagreement set and agrees with the Jev level (±1) on ≥ 16;
   - `meaning-failed` < 5 % of interpretation attempts;
   - p95 of the `/log` POST for interpretation stays under 1 s.
4. **Back out** by setting `enabled: false`. Rows already written keep their `meaning` field; every reader filters on
   `typeof e.meaning?.score === 'number'`, so absence is always safe.

---

## Task 0: Worktree

```bash
cd "$(git rev-parse --show-toplevel)"
git fetch origin && git log --oneline origin/main..HEAD
git worktree add .worktrees/sentence-ladder-meaning-score -b feat/sentence-ladder-meaning-score main
ln -s "$PWD/node_modules" .worktrees/sentence-ladder-meaning-score/node_modules
cd .worktrees/sentence-ladder-meaning-score
npx vitest run backend/src/3_applications/school/LanguageStudyService.test.mjs backend/src/4_api/v1/routers/language.test.mjs
```

Expected: both files pass on a clean branch (baseline). All later paths are relative to the worktree root.
Do not start a backend in the worktree; this plan needs none.

---

## Task 1: `SentenceMeaningJudge`

**Files:**
- Create: `backend/src/3_applications/school/SentenceMeaningJudge.mjs`
- Test: `backend/src/3_applications/school/SentenceMeaningJudge.test.mjs`

### Step 1: Write the failing test

```js
// backend/src/3_applications/school/SentenceMeaningJudge.test.mjs
import { describe, expect, it, vi } from 'vitest';
import { SentenceMeaningJudge, MEANING_LEVELS } from './SentenceMeaningJudge.mjs';

const answerWith = (score, confidence = 0.8) => async () => ({
  model: 'jev-1.13.0',
  answers: { meaning: { type: 'score', score, confidence, probabilities: [] } },
  usage: { inputTokens: null, outputTokens: null },
});
const make = (evaluate, opts = {}) => {
  const logger = { warn: vi.fn(), info: vi.fn() };
  const decisionGateway = { isConfigured: () => true, evaluate: vi.fn(evaluate) };
  return { logger, decisionGateway, judge: new SentenceMeaningJudge({ decisionGateway, logger, ...opts }) };
};
const ARGS = { given: 'today the weather is nice', expected: "The weather's nice today.", language: 'EN', accuracy: 0.4 };

describe('SentenceMeaningJudge', () => {
  it('has five ordered levels, lowest first', () => {
    expect(MEANING_LEVELS).toHaveLength(5);
    expect(MEANING_LEVELS[0]).toMatch(/^Different meaning/);
    expect(MEANING_LEVELS[4]).toMatch(/same words/i);
  });

  it('asks one Score question with the answer as data, and normalises the level to 0..1', async () => {
    const { judge, decisionGateway } = make(answerWith(3.2, 0.81));
    const result = await judge.judge(ARGS);
    const [state, questions, options] = decisionGateway.evaluate.mock.calls[0];
    expect(state).toEqual({ reference: "The weather's nice today.", answer: 'today the weather is nice', language: 'EN' });
    expect(Object.keys(questions)).toEqual(['meaning']);
    expect(questions.meaning.type).toBe('score');
    expect(questions.meaning.levels).toEqual([...MEANING_LEVELS]);
    expect(questions.meaning.instructions).not.toContain('today the weather is nice');
    expect(options).toEqual({ timeout: 1500 });
    expect(result).toMatchObject({ score: 0.8, level: 3, confidence: 0.81, judge: 'model', model: 'jev-1.13.0' });
    expect(typeof result.ms).toBe('number');
  });

  it('clamps an out-of-range level into the rubric', async () => {
    const { judge } = make(answerWith(7));
    expect(await judge.judge(ARGS)).toMatchObject({ score: 1, level: 4 });
  });

  it('an exact copy is level 4 without a call', async () => {
    const { judge, decisionGateway } = make(answerWith(0));
    expect(await judge.judge({ ...ARGS, given: "the weather's nice today", accuracy: 1 }))
      .toEqual({ score: 1, level: 4, confidence: 1, judge: 'exact' });
    expect(decisionGateway.evaluate).not.toHaveBeenCalled();
  });

  it('an answer with no letters is level 0 without a call', async () => {
    const { judge, decisionGateway } = make(answerWith(4));
    for (const given of [',,,,,', '.', '🙃🙃🙃🙃🙃🙃']) {
      expect(await judge.judge({ ...ARGS, given, accuracy: 0 }))
        .toEqual({ score: 0, level: 0, confidence: 1, judge: 'no-words' });
    }
    expect(decisionGateway.evaluate).not.toHaveBeenCalled();
  });

  it('returns null, never throws, when the gateway fails or answers malformed', async () => {
    const failing = make(async () => { throw new Error('429'); });
    expect(await failing.judge.judge(ARGS)).toBeNull();
    expect(failing.logger.warn).toHaveBeenCalledWith('school.language.meaning-failed', expect.objectContaining({ error: '429' }));
    const malformed = make(async () => ({ model: 'm', answers: {} }));
    expect(await malformed.judge.judge(ARGS)).toBeNull();
  });

  it('gives up at the deadline', async () => {
    const { judge, logger } = make(() => new Promise(() => {}), { timeoutMs: 20 });
    expect(await judge.judge(ARGS)).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('school.language.meaning-failed', expect.objectContaining({ error: 'timed out after 20ms' }));
  });

  it('is disabled without a configured gateway, even for the code rules', async () => {
    const none = new SentenceMeaningJudge({ decisionGateway: null, logger: { warn() {} } });
    const noop = new SentenceMeaningJudge({ decisionGateway: { isConfigured: () => false, evaluate: vi.fn() }, logger: { warn() {} } });
    expect(none.enabled).toBe(false);
    expect(noop.enabled).toBe(false);
    expect(await none.judge({ ...ARGS, accuracy: 1 })).toBeNull();
    expect(await noop.judge(ARGS)).toBeNull();
  });
});
```

### Step 2: Run it

```bash
npx vitest run backend/src/3_applications/school/SentenceMeaningJudge.test.mjs
```

Expected: FAIL — `Failed to load url ./SentenceMeaningJudge.mjs`.

### Step 3: Minimal implementation

```js
// backend/src/3_applications/school/SentenceMeaningJudge.mjs
/**
 * Meaning score for the Sentence Ladder's interpretation rung.
 *
 * `accuracy` is character edit distance, so "today the weather is nice"
 * against "The weather's nice today." scores 0.4 although the child plainly
 * understood the sentence. This judge asks a typed-decision model (the
 * IDecisionGateway port) where the answer sits on a five-level meaning rubric.
 *
 * RECORDED, NEVER GATING — like accuracy. Nothing reads it to decide credit.
 * Never throws: no gateway, a failure, a malformed answer or the deadline all
 * return null, and the caller then writes exactly the row it wrote before.
 *
 * Two code rules answer without a call: an exact copy (accuracy 1) is the top
 * level, and an answer with no letters in any script is the bottom one.
 */
import { score as scoreQuestion } from '#apps/common/ports/IDecisionGateway.mjs';

/** Ordered rubric, lowest first. The stored `score` is the level index ÷ 4. */
export const MEANING_LEVELS = Object.freeze([
  'Different meaning: unrelated, the wrong sentence, or not an answer at all',
  'Partly the same meaning: some of it is right, but part of the sense is missing or wrong',
  'The same meaning, except one detail is wrong (a word, a number, who, or when)',
  'The same meaning in different words',
  'The same words as `reference`',
]);

const INSTRUCTIONS = 'A child heard a sentence in the language they are learning and wrote what it means. '
  + '`reference` is the correct translation and `answer` is what the child wrote. '
  + 'How closely does `answer` carry the meaning of `reference`? '
  + 'Ignore spelling, spacing, punctuation, capital letters and contractions.';

const QUESTION = scoreQuestion(INSTRUCTIONS, [...MEANING_LEVELS]);
const TOP = MEANING_LEVELS.length - 1;
const DEFAULT_TIMEOUT_MS = 1500;
const round3 = (n) => Math.round(n * 1000) / 1000;

export class SentenceMeaningJudge {
  #decision; #timeoutMs; #logger;

  constructor({ decisionGateway = null, timeoutMs = DEFAULT_TIMEOUT_MS, logger = console } = {}) {
    this.#decision = decisionGateway?.isConfigured?.() === false ? null : decisionGateway;
    this.#timeoutMs = timeoutMs;
    this.#logger = logger;
  }

  get enabled() { return Boolean(this.#decision); }

  /**
   * @param {{given: string, expected: string, language?: string|null, accuracy?: number|null}} args
   * @returns {Promise<null|{score:number, level:number, confidence:number|null, judge:string, model?:string|null, ms?:number}>}
   */
  async judge({ given, expected, language = null, accuracy = null }) {
    if (!this.#decision) return null;
    if (accuracy === 1) return { score: 1, level: TOP, confidence: 1, judge: 'exact' };
    if (!/\p{L}/u.test(String(given ?? ''))) return { score: 0, level: 0, confidence: 1, judge: 'no-words' };

    const startedAt = Date.now();
    let timer;
    try {
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${this.#timeoutMs}ms`)), this.#timeoutMs);
      });
      const result = await Promise.race([
        this.#decision.evaluate(
          { reference: expected, answer: given, language },
          { meaning: QUESTION },
          { timeout: this.#timeoutMs },
        ),
        deadline,
      ]);
      const answer = result?.answers?.meaning;
      if (answer?.type !== 'score' || !Number.isFinite(answer.score)) throw new Error('malformed answer');
      const level = Math.min(TOP, Math.max(0, answer.score));
      return {
        score: round3(level / TOP),
        level: Math.round(level),
        confidence: Number.isFinite(answer.confidence) ? round3(answer.confidence) : null,
        judge: 'model',
        model: result.model ?? null,
        ms: Date.now() - startedAt,
      };
    } catch (error) {
      this.#logger.warn?.('school.language.meaning-failed', { error: error.message, ms: Date.now() - startedAt });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

export default SentenceMeaningJudge;
```

### Step 4: Run it

```bash
npx vitest run backend/src/3_applications/school/SentenceMeaningJudge.test.mjs
```

Expected: PASS (8 tests).

### Step 5: Commit

```bash
git add backend/src/3_applications/school/SentenceMeaningJudge.mjs backend/src/3_applications/school/SentenceMeaningJudge.test.mjs
git commit -m "$(cat <<'EOF'
feat(school): SentenceMeaningJudge — Jev meaning score for interpretation answers

Score question on a five-level meaning rubric, exact/no-words code rules,
1.5 s deadline, null on any failure. Records only; gates nothing.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `submitAttempt` records `meaning` on the interpretation row

**Files:**
- Modify: `backend/src/3_applications/school/LanguageStudyService.mjs`
  - import block `:12-16` (add `ROLES`)
  - class fields `:34` and constructor `:42-80` (add `meaningJudge`)
  - `logAttempt` `:509-519` (split into public sync + shared private)
  - `#recordAttempt` signature `:521-524` and text branch `:603-604`
- Test: `backend/src/3_applications/school/LanguageStudyService.meaning.test.mjs` (new; the 1345-line main suite stays untouched)

### Step 1: Write the failing test

```js
// backend/src/3_applications/school/LanguageStudyService.meaning.test.mjs
/**
 * The meaning score rides on the interpretation row and changes nothing else:
 * the synchronous `logAttempt` never calls the judge, a missing or failing
 * judge writes exactly the old row, and only a STORED attempt is logged.
 */
import { describe, it, expect, vi } from 'vitest';
import { LanguageStudyService } from './LanguageStudyService.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

const CORPUS = {
  id: 'test-korean',
  label: 'Test Korean',
  languages: { source: 'EN', target: 'KR' },
  audio_base: 'apps/school/language/test-korean',
  sentences: [
    { seq: 1, text: { EN: "The weather's nice today.", KR: '오늘 날씨가 좋아요.' } },
    { seq: 2, text: { EN: "I'm not rich.", KR: '저는 부자가 아니예요.' } },
  ],
};
const EQUIPPED = { microphone: true, textInput: ['EN', 'KR'] };
const AT = Date.parse('2026-07-21T10:00:00Z');

class FakeDatastore {
  constructor() { this.events = []; this.progress = null; }
  listCorpusIds() { return [CORPUS.id]; }
  readCorpus(id) { return id === CORPUS.id ? CORPUS : null; }
  readProgress() { return this.progress; }
  writeProgress(_u, _c, p) { this.progress = p; return p; }
  appendEvent(_u, _c, e) { this.events.push(e); return e; }
  readAllEvents() { return this.events; }
  listRecordingKeys() { return new Set(); }
  resolveAudioPath(c, seq, lang) { return `/media/${c}/${seq}-${lang}.mp3`; }
}

/** Seed seq 1 up to the given rung, as the main suite's makeDue does. */
function makeDue(ds, rung) {
  const chain = ['repetition', 'dictation', 'recording', 'interpretation'];
  const index = chain.indexOf(rung);
  for (let i = 0; i < index; i += 1) {
    ds.appendEvent('kckern', CORPUS.id, {
      at: new Date(AT - (index - i) * 86_400_000).toISOString(),
      day: i + 1, seq: 1, rung: chain[i], attributedTo: 'kckern',
    });
  }
  ds.writeProgress('kckern', CORPUS.id, { corpus: CORPUS.id, day: index + 1, daily_limit: 5, last_activity: null });
}

const MODEL_MEANING = { score: 0.8, level: 3, confidence: 0.81, judge: 'model', model: 'jev-1.13.0', ms: 212 };

function setup({ judge = vi.fn(async () => MODEL_MEANING), rung = 'interpretation' } = {}) {
  const ds = new FakeDatastore();
  makeDue(ds, rung);
  const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const meaningJudge = judge ? { judge } : null;
  const svc = new LanguageStudyService({ datastore: ds, now: () => AT, timezone: 'UTC', logger, meaningJudge });
  return { ds, svc, logger, judge };
}
const ARGS = { userId: 'kckern', corpusId: CORPUS.id, seq: 1, capabilities: EQUIPPED };

describe('submitAttempt — meaning on the interpretation row', () => {
  it('asks the judge with the source-language reference and stores meaning beside accuracy', async () => {
    const { svc, judge, ds } = setup();
    const event = await svc.submitAttempt({ ...ARGS, rung: 'interpretation', given: ' today the weather is nice ', method: 'typed' });
    expect(judge).toHaveBeenCalledWith({
      given: 'today the weather is nice', expected: "The weather's nice today.", language: 'EN', accuracy: 0.4,
    });
    expect(event.accuracy).toBe(0.4);
    expect(event.meaning).toEqual({ score: 0.8, level: 3, confidence: 0.81, judge: 'model', model: 'jev-1.13.0' });
    expect(ds.events.at(-1)).toBe(event);
  });

  it('logs school.language.meaning only after the row is stored', async () => {
    const { svc, logger } = setup();
    await svc.submitAttempt({ ...ARGS, rung: 'interpretation', given: 'today the weather is nice', method: 'spoken', runId: 'run-1' });
    expect(logger.info).toHaveBeenCalledWith('school.language.meaning', {
      learnerId: 'kckern', corpus: CORPUS.id, seq: 1, accuracy: 0.4, meaning: 0.8, level: 3,
      confidence: 0.81, judge: 'model', model: 'jev-1.13.0', method: 'spoken', practice: false, ms: 212,
    }, { context: { runId: 'run-1' } });
  });

  it('writes the old row when the judge returns null or throws', async () => {
    for (const judge of [vi.fn(async () => null), vi.fn(async () => { throw new Error('boom'); })]) {
      const { svc, logger } = setup({ judge });
      const event = await svc.submitAttempt({ ...ARGS, rung: 'interpretation', given: 'today the weather is nice' });
      expect(event).not.toHaveProperty('meaning');
      expect(event.accuracy).toBe(0.4);
      expect(logger.info).not.toHaveBeenCalledWith('school.language.meaning', expect.anything(), expect.anything());
    }
  });

  it('without a judge, submitAttempt is logAttempt', async () => {
    const { svc } = setup({ judge: null });
    const event = await svc.submitAttempt({ ...ARGS, rung: 'interpretation', given: 'today the weather is nice' });
    expect(event).not.toHaveProperty('meaning');
    expect(event.accuracy).toBe(0.4);
  });

  it('never judges dictation, a reveal, or a blank answer', async () => {
    const dictation = setup({ rung: 'dictation' });
    const row = await dictation.svc.submitAttempt({ ...ARGS, rung: 'dictation', given: '오늘 날씨가 좋아요' });
    expect(row).not.toHaveProperty('meaning');
    expect(dictation.judge).not.toHaveBeenCalled();

    const reveal = setup();
    const shown = await reveal.svc.submitAttempt({ ...ARGS, rung: 'interpretation', revealed: true });
    expect(shown).not.toHaveProperty('meaning');
    expect(reveal.judge).not.toHaveBeenCalled();

    const blank = setup();
    await expect(blank.svc.submitAttempt({ ...ARGS, rung: 'interpretation', given: '   ' })).rejects.toBeInstanceOf(ValidationError);
    expect(blank.judge).not.toHaveBeenCalled();
  });

  it('a refused attempt (not due) records and logs no meaning', async () => {
    const { svc, logger, ds } = setup({ rung: 'dictation' });
    const before = ds.events.length;
    await expect(svc.submitAttempt({ ...ARGS, rung: 'interpretation', given: 'today the weather is nice' }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(ds.events.length).toBe(before);
    expect(logger.info).not.toHaveBeenCalledWith('school.language.meaning', expect.anything(), expect.anything());
  });

  it('the synchronous logAttempt never calls the judge', () => {
    const { svc, judge } = setup();
    const event = svc.logAttempt({ ...ARGS, rung: 'interpretation', given: 'today the weather is nice' });
    expect(judge).not.toHaveBeenCalled();
    expect(event).not.toHaveProperty('meaning');
  });
});
```

### Step 2: Run it

```bash
npx vitest run backend/src/3_applications/school/LanguageStudyService.meaning.test.mjs
```

Expected: FAIL — `svc.submitAttempt is not a function` (and the `logAttempt` test passes already).

### Step 3: Minimal implementation

In `LanguageStudyService.mjs`:

1. Import `ROLES` (`:12-16`):

```js
import {
  validateCorpus, indexBySeq, buildDayQueue, summarizeQueue,
  shouldRollDay, studyDayIndex, chainFor, creditChain, rungById, resolveRole, accuracy,
  validateProgramEnrollment, unitFor, RUNG_IDS, ROLES,
} from '#domains/school/language/index.mjs';
```

2. Class fields line `:34` — append `#meaningJudge`:

```js
  #ds; #logger; #now; #timezone; #boundaryHour; #readGate; #readProgramEnrollment; #realtime; #voiceAnswer; #meaningJudge;
```

3. Constructor — after `voiceAnswer = false,` (`:69`) add the parameter, and after `this.#voiceAnswer = voiceAnswer === true;` (`:79`) the assignment:

```js
    voiceAnswer = false,
    /**
     * Optional SentenceMeaningJudge (anything with an async `judge()`). Scores
     * how well an interpretation answer carries the sentence's meaning, beside
     * the character-level `accuracy`. Recorded, never gating. Absent → the row
     * is exactly what it was before this existed.
     */
    meaningJudge = null,
```

```js
    this.#voiceAnswer = voiceAnswer === true;
    this.#meaningJudge = typeof meaningJudge?.judge === 'function' ? meaningJudge : null;
```

4. Replace `logAttempt` (`:509-519`) with the sync public method, the async one, and the judge helper:

```js
  logAttempt(args) {
    return this.#logAttempt(args, null);
  }

  /**
   * `logAttempt` plus a meaning score on a rung answered in the learner's own
   * language (interpretation). The judge is awaited BEFORE the synchronous
   * record, under its own deadline, so the score lands on the same
   * append-only row; a missing, failing or slow judge yields no field, never
   * an error. The meaning is logged only once the row is stored.
   */
  async submitAttempt(args) {
    const judged = await this.#judgeMeaning(args);
    const event = this.#logAttempt(args, judged?.meaning ?? null);
    if (judged) {
      this.#log('info', 'school.language.meaning', {
        ...judged.facts, practice: event.practice === true,
        ms: judged.ms,
      }, args.runId ?? null);
    }
    return event;
  }

  async #judgeMeaning({ userId, corpusId, seq, rung, given = null, revealed = false, method = null }) {
    if (!this.#meaningJudge || revealed === true || typeof given !== 'string' || given.trim() === '') return null;
    const rungDef = rungById(rung);
    // Only where the learner writes in their OWN language: there, different
    // words can still be right. Dictation transcribes; its diff is the point.
    if (rungDef?.response?.modality !== 'text' || rungDef.response.role !== ROLES.SOURCE) return null;
    const corpus = this.#loadCorpus(corpusId);
    const sentence = corpus?.index.get(Number(seq));
    if (!sentence) return null; // #recordAttempt raises the real error
    const language = resolveRole(rungDef.response.role, corpus.languages);
    const expected = sentence.text[language] ?? '';
    const typedAccuracy = accuracy(given, expected);
    let result;
    try {
      result = await this.#meaningJudge.judge({ given: given.trim(), expected, language, accuracy: typedAccuracy });
    } catch (error) {
      this.#logger.warn?.('school.language.meaning-failed', { learnerId: userId, corpus: corpusId, seq: Number(seq), error: error.message });
      return null;
    }
    if (!result || typeof result.score !== 'number') return null;
    const { ms = null, ...rest } = result;
    // Every value defined: yaml.dump throws on undefined.
    const meaning = {
      score: rest.score, level: rest.level, confidence: rest.confidence ?? null, judge: rest.judge,
      ...(rest.judge === 'model' ? { model: rest.model ?? null } : {}),
    };
    return {
      meaning,
      ms,
      facts: {
        learnerId: userId, corpus: corpusId, seq: Number(seq), accuracy: typedAccuracy,
        meaning: meaning.score, level: meaning.level, confidence: meaning.confidence,
        judge: meaning.judge, model: meaning.model ?? null, method,
      },
    };
  }

  #logAttempt({
    userId, corpusId, seq, rung, given = null, revealed = false,
    source = null, capabilities = {}, runId = null, method = null,
  }, meaning) {
    if (rung === 'recording') {
      throw new ValidationError('recording evidence requires an audio upload', { field: 'rung' });
    }
    return this.#recordAttempt({
      userId, corpusId, seq, rung, given, revealed, source, capabilities, runId, method, meaning,
    });
  }
```

Keep the existing JSDoc comment above `logAttempt` (`:498-508`) where it is.

5. `#recordAttempt` signature (`:521-524`) — add `meaning = null`:

```js
  #recordAttempt({
    userId, corpusId, seq, rung, given = null, revealed = false, source = null, capabilities = {},
    allowRecording = false, skipDueCheck = false, practice = false, runId = null, method = null, meaning = null,
  }) {
```

6. After `event.accuracy = accuracy(given, expected);` (`:604`):

```js
        event.accuracy = accuracy(given, expected);
        // Beside accuracy, never instead of it, and gating nothing. Present
        // only when a meaning judge answered (see submitAttempt).
        if (meaning) event.meaning = meaning;
```

### Step 4: Run it

```bash
npx vitest run backend/src/3_applications/school/LanguageStudyService.meaning.test.mjs backend/src/3_applications/school/LanguageStudyService.test.mjs backend/src/3_applications/school/LanguageStudyService.unrecorded.test.mjs
```

Expected: PASS — the 7 new tests, and the existing suites unchanged.

### Step 5: Commit

```bash
git add backend/src/3_applications/school/LanguageStudyService.mjs backend/src/3_applications/school/LanguageStudyService.meaning.test.mjs
git commit -m "$(cat <<'EOF'
feat(school): record a meaning score on interpretation attempts

submitAttempt awaits the optional meaning judge before the synchronous
record and adds `meaning` beside `accuracy` on the same row. logAttempt is
unchanged and never calls the judge. Gates nothing.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Teacher metric "Meaning understood"

**Files:**
- Modify: `backend/src/3_applications/school/LanguageStudyService.mjs` `#summarizeCourse`, after the accuracy block (`:1253-1262`)
- Test: `backend/src/3_applications/school/LanguageStudyService.meaning.test.mjs` (append)

### Step 1: Write the failing test

Append to `LanguageStudyService.meaning.test.mjs`:

```js
describe('summarize — meaning metric', () => {
  it('averages meaning for the grown-up, and is absent until a row has one', async () => {
    const { svc, ds } = setup({ judge: null });
    await svc.submitAttempt({ ...ARGS, rung: 'interpretation', given: 'today the weather is nice' });
    let [course] = svc.summarize({ userId: 'kckern' });
    expect(course.metrics.find((m) => m.id === 'meaning')).toBeUndefined();

    ds.events.push(
      { at: new Date(AT).toISOString(), day: 4, seq: 2, rung: 'interpretation', given: 'x', accuracy: 0.2, meaning: { score: 0.5, level: 2, confidence: 0.7, judge: 'model', model: 'm' } },
      { at: new Date(AT).toISOString(), day: 4, seq: 2, rung: 'interpretation', given: 'y', accuracy: 1, meaning: { score: 1, level: 4, confidence: 1, judge: 'exact' } },
    );
    [course] = svc.summarize({ userId: 'kckern' });
    const metric = course.metrics.find((m) => m.id === 'meaning');
    expect(metric).toEqual({ id: 'meaning', kind: 'score', label: 'Meaning understood', value: 0.75 });
    expect(metric).not.toHaveProperty('audience');
  });
});
```

### Step 2: Run it

```bash
npx vitest run backend/src/3_applications/school/LanguageStudyService.meaning.test.mjs -t "meaning metric"
```

Expected: FAIL — `expected undefined to deeply equal { id: 'meaning', … }`.

### Step 3: Minimal implementation

In `#summarizeCourse`, directly after the closing `}` of `if (scored.length) { … }` (`:1262`):

```js
    // How much of the MEANING came through on interpretation, from the
    // optional meaning judge — "wrote it differently" versus "did not
    // understand". Grown-up only, like accuracy: it is unvalidated and it
    // gates nothing. Absent until a row carries one.
    const meant = log.filter((e) => typeof e.meaning?.score === 'number');
    if (meant.length) {
      metrics.push({
        id: 'meaning', kind: 'score', label: 'Meaning understood',
        value: meant.reduce((a, e) => a + e.meaning.score, 0) / meant.length,
      });
    }
```

### Step 4: Run it

```bash
npx vitest run backend/src/3_applications/school/LanguageStudyService.meaning.test.mjs backend/src/3_applications/school/LanguageStudyService.test.mjs
```

Expected: PASS.

### Step 5: Commit

```bash
git add backend/src/3_applications/school/LanguageStudyService.mjs backend/src/3_applications/school/LanguageStudyService.meaning.test.mjs
git commit -m "$(cat <<'EOF'
feat(school): "Meaning understood" teacher metric on the sentence-ladder card

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Router calls `submitAttempt`

**Files:**
- Modify: `backend/src/4_api/v1/routers/language.mjs:213-232`
- Test: `backend/src/4_api/v1/routers/language.test.mjs` (rename the mock at `:32,187,193,201,246,252,452,462`)

### Step 1: Update the tests to the new method (they now fail)

```bash
sed -i '' 's/logAttempt/submitAttempt/g' backend/src/4_api/v1/routers/language.test.mjs
grep -c submitAttempt backend/src/4_api/v1/routers/language.test.mjs   # expect 8
```

Then add one test inside the top-level `describe` that owns `appWith` (next to the reveal test at `:184`):

```js
  it('awaits the service, so an async record is answered with the stored row', async () => {
    const { app, service } = appWith();
    service.submitAttempt.mockImplementation(async (value) => ({ ...value, meaning: { score: 1, level: 4, confidence: 1, judge: 'exact' } }));
    const res = await request(app)
      .post('/api/v1/school/sentence-ladder/users/learner3/log')
      .set('X-School-Study-Grant', 'signed')
      .send({ corpus: 'korean', seq: 7, rung: 'interpretation', given: 'it is cold' });
    expect(res.status).toBe(200);
    expect(res.body.meaning).toEqual({ score: 1, level: 4, confidence: 1, judge: 'exact' });
    // Nothing a client sends can set meaning: the body field is not passed through.
    await request(app)
      .post('/api/v1/school/sentence-ladder/users/learner3/log')
      .set('X-School-Study-Grant', 'signed')
      .send({ corpus: 'korean', seq: 7, rung: 'interpretation', given: 'it is cold', meaning: { score: 1 } });
    expect(service.submitAttempt.mock.calls.at(-1)[0]).not.toHaveProperty('meaning');
  });
```

### Step 2: Run it

```bash
npx vitest run backend/src/4_api/v1/routers/language.test.mjs
```

Expected: FAIL — the log-route tests get 500 (`languageStudyService.logAttempt is not a function`) and `submitAttempt` is never called.

### Step 3: Minimal implementation

In `language.mjs`, the log route:

```js
  router.post('/users/:userId/log', wrap(async (req, res) => {
    const { corpus, seq, rung, given = null, revealed = false, method = null } = req.body || {};
    if (!authorized(req, res, corpus)) return;
    // Async since the interpretation rung may carry a meaning score; the
    // service bounds that wait and never fails the record over it.
    res.json(await languageStudyService.submitAttempt({
```

Only two tokens change: `wrap((req, res) =>` becomes `wrap(async (req, res) =>`, and
`res.json(languageStudyService.logAttempt({` becomes `res.json(await languageStudyService.submitAttempt({`. The
argument object (`userId … runId: readRunId(req),`) and both closing `}));` lines stay exactly as they are. Verify the
file parses:

```bash
node --check backend/src/4_api/v1/routers/language.mjs
```

### Step 4: Run it

```bash
npx vitest run backend/src/4_api/v1/routers/language.test.mjs
```

Expected: PASS.

### Step 5: Commit

```bash
git add backend/src/4_api/v1/routers/language.mjs backend/src/4_api/v1/routers/language.test.mjs
git commit -m "$(cat <<'EOF'
feat(school): sentence-ladder log route records through submitAttempt

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Composition wiring and config flag

**Files:**
- Modify: `backend/src/5_composition/modules/schoolLanguage.mjs:17-58`
- Modify: `backend/src/app.mjs:3584-3587` (the `createLanguageStudyService({` call)
- Test: `backend/src/5_composition/modules/schoolLanguage.test.mjs` (new)

### Step 1: Write the failing test

```js
// backend/src/5_composition/modules/schoolLanguage.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { createLanguageStudyService } from './schoolLanguage.mjs';

const CORPUS = {
  id: 'contract-korean', label: 'Contract Korean', languages: { source: 'EN', target: 'KR' },
  audio_base: 'apps/school/language/contract-korean',
  sentences: [{ seq: 1, text: { EN: "The weather's nice today.", KR: '오늘 날씨가 좋아요.' } }],
};

function build({ decisionGateway, meaningJudgeConfig } = {}) {
  const events = [];
  const now = Date.now();
  const chain = ['repetition', 'dictation', 'recording'];
  chain.forEach((rung, i) => events.push({
    at: new Date(now - (chain.length - i) * 86_400_000).toISOString(), day: i + 1, seq: 1, rung, attributedTo: 'learner',
  }));
  let progress = { corpus: CORPUS.id, day: 4, daily_limit: 5, last_activity: null };
  const datastore = {
    listCorpusIds: () => [CORPUS.id], readCorpus: (id) => (id === CORPUS.id ? CORPUS : null),
    readProgress: () => progress, writeProgress: (_u, _c, next) => { progress = next; return next; },
    appendEvent: (_u, _c, e) => { events.push(e); return e; }, readAllEvents: () => events,
    listRecordingKeys: () => new Set(), resolveAudioPath: (c, s, l) => `/m/${c}/${s}-${l}.mp3`,
  };
  const service = createLanguageStudyService({
    datastore, eventBus: { publish: vi.fn(), subscribe: vi.fn() }, timezone: 'UTC',
    decisionGateway, meaningJudgeConfig,
    logger: { info() {}, warn() {}, debug() {}, error() {} },
  });
  return (given) => service.submitAttempt({
    userId: 'learner', corpusId: CORPUS.id, seq: 1, rung: 'interpretation', given,
    capabilities: { microphone: true, textInput: ['EN', 'KR'] },
  });
}

const jev = () => ({
  isConfigured: () => true,
  evaluate: vi.fn(async () => ({ model: 'jev-x', answers: { meaning: { type: 'score', score: 3, confidence: 0.9, probabilities: [] } } })),
});

describe('createLanguageStudyService — meaning judge wiring', () => {
  it('wires the judge when a decision gateway is configured', async () => {
    const gateway = jev();
    const event = await build({ decisionGateway: gateway })('today the weather is nice');
    expect(gateway.evaluate).toHaveBeenCalledTimes(1);
    expect(event.meaning).toMatchObject({ level: 3, score: 0.75, judge: 'model', model: 'jev-x' });
  });

  it('records the old row without a gateway, or when the school config turns it off', async () => {
    expect(await build({})('today the weather is nice')).not.toHaveProperty('meaning');
    const gateway = jev();
    const off = await build({ decisionGateway: gateway, meaningJudgeConfig: { enabled: false } })('today the weather is nice');
    expect(off).not.toHaveProperty('meaning');
    expect(gateway.evaluate).not.toHaveBeenCalled();
  });

  it('passes a configured deadline through', async () => {
    const gateway = jev();
    await build({ decisionGateway: gateway, meaningJudgeConfig: { timeout_ms: 900 } })('today the weather is nice');
    expect(gateway.evaluate.mock.calls[0][2]).toEqual({ timeout: 900 });
  });
});
```

### Step 2: Run it

```bash
npx vitest run backend/src/5_composition/modules/schoolLanguage.test.mjs
```

Expected: FAIL — first test: `expected "spy" to be called 1 times, but got 0 times` (the factory ignores `decisionGateway`).

### Step 3: Minimal implementation

`schoolLanguage.mjs` — import (after `:17`):

```js
import { SentenceLadderService } from '#apps/school/SentenceLadderService.mjs';
import { SentenceMeaningJudge } from '#apps/school/SentenceMeaningJudge.mjs';
```

Add to the JSDoc `@param` list:

```js
 * @param {object|null} [args.decisionGateway] IDecisionGateway; without one no
 *   meaning score is recorded and rows are exactly as before.
 * @param {{enabled?: boolean, timeout_ms?: number}|null} [args.meaningJudgeConfig]
 *   `language.meaning_judge` from the school household config. On by default
 *   wherever a gateway exists; `enabled: false` turns it off.
```

Signature and body:

```js
export function createLanguageStudyService({
  datastore,
  eventBus,
  readProgramEnrollment = null,
  timezone = null,
  readGate = null,
  languageTranscription = null,
  decisionGateway = null,
  meaningJudgeConfig = null,
  logger = console,
}) {
  if (!datastore) throw new Error('createLanguageStudyService requires datastore');
  if (!eventBus) throw new Error('createLanguageStudyService requires eventBus');
  const meaningJudge = decisionGateway && meaningJudgeConfig?.enabled !== false
    ? new SentenceMeaningJudge({
      decisionGateway,
      ...(Number.isFinite(meaningJudgeConfig?.timeout_ms) ? { timeoutMs: meaningJudgeConfig.timeout_ms } : {}),
      logger,
    })
    : null;
  return new SentenceLadderService({
    datastore,
    readProgramEnrollment,
    timezone,
    readGate,
    // Boolean HERE, not in the application layer: the service may not hold an
    // adapter, and all it needs to know is whether the alternative exists.
    voiceAnswer: Boolean(languageTranscription),
    meaningJudge: meaningJudge?.enabled ? meaningJudge : null,
    logger,
    realtime: new EventBusSchoolRealtimeAdapter({ eventBus }),
  });
}
```

`app.mjs` — in the `createLanguageStudyService({` call at `:3584`, after `languageTranscription,`:

```js
    languageTranscription,
    // Meaning score on interpretation answers (SentenceMeaningJudge). Null
    // gateway → no field, rows unchanged. `language.meaning_judge.enabled:
    // false` in the school config turns it off where a gateway exists.
    decisionGateway,
    meaningJudgeConfig: schoolFullConfig.language?.meaning_judge ?? null,
```

### Step 4: Run it

```bash
npx vitest run backend/src/5_composition/modules/schoolLanguage.test.mjs backend/src/5_composition/composition-contract-registry.test.mjs
node --check backend/src/app.mjs
npm run audit:layers
```

Expected: PASS; `node --check` silent; layer audit reports no new violations (composition importing `#apps` is allowed; the application layer imports only `#apps/common/ports` and `#domains`).

### Step 5: Commit

```bash
git add backend/src/5_composition/modules/schoolLanguage.mjs backend/src/5_composition/modules/schoolLanguage.test.mjs backend/src/app.mjs
git commit -m "$(cat <<'EOF'
feat(school): wire the sentence meaning judge from the decision gateway

On wherever a gateway is configured; school config
language.meaning_judge.enabled:false turns it off, timeout_ms overrides
the 1.5 s deadline.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Docs

**Files:**
- Modify: `docs/reference/school/sentence-ladder.md`
  - the accuracy paragraph `:494-501`
  - the attempt-row example `:879-890` and the text after the revealed-row paragraph `:911-919`
  - §7 "What the card says" (`:781-`) — the metric list

### Steps

1. After the paragraph ending "…and this program keeps it." (`:501`), add:

```markdown
**Interpretation also gets a meaning score, which gates nothing either.** Edit
distance cannot tell "today the weather is nice" from a wrong answer (it scores
0.4 against "The weather's nice today."). Where a decision gateway is configured,
`SentenceMeaningJudge` (`3_applications/school/`) asks it one Score question —
different meaning / partly / same meaning but one detail wrong / same meaning in
different words / the same words — and the row gets a `meaning` field beside
`accuracy`. An exact copy (accuracy 1) and an answer with no letters are scored
by rule without a call. The judge is awaited before the row is written, under a
1.5 s deadline; a failure, a timeout or no gateway writes the row exactly as
before. Dictation is never meaning-scored: it answers in the target language and
its diff is the lesson. Config (school household config): `language.meaning_judge.enabled`
(default on where a gateway exists), `language.meaning_judge.timeout_ms`.
Logs: `school.language.meaning` (info, after the row is stored: accuracy,
meaning, level, confidence, judge, model, method, practice, ms) and
`school.language.meaning-failed` (warn).
```

2. In the attempt-row YAML example, after `method: typed …` add:

```yaml
  meaning:                 # interpretation only, when a meaning judge answered; never gating
    score: 0.8             # level ÷ 4, 0..1 (same scale as accuracy)
    level: 3               # 0 different … 4 same words
    confidence: 0.81
    judge: model           # model | exact | no-words
    model: jev-1.13.0      # judge: model only
```

and one sentence after the `method` paragraph: "`meaning` is absent on reveals, on dictation, on rows written before it existed, and whenever the judge did not answer — absence is never a zero."

3. In §7, where the card's metrics are described, add: "**Meaning understood** — the mean `meaning.score` over rows that carry one; grown-up only, absent until the first scored row."

4. Commit:

```bash
git add docs/reference/school/sentence-ladder.md
git commit -m "$(cat <<'EOF'
docs(school): sentence-ladder meaning score — row field, config, logs, card metric

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Full verification for touched dirs

```bash
npx vitest run backend/src/3_applications/school backend/src/4_api/v1/routers/language.test.mjs backend/src/5_composition backend/src/2_domains/school/language
npm run audit:layers
git status --short
```

Expected: all pass (compare any failure against the Task 0 baseline before blaming this branch); layer audit clean; working tree clean.

Then merge per the repo's branch rules (merge into `main`, record the branch in `docs/_archive/deleted-branches.md`, delete the branch and worktree). Do not deploy from this plan.
