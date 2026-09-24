# Headlines Story Judge (Jev clustering + event labels) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the typed-decision model (Jev) decide the headline pairs that string similarity cannot, and label timeline coverage by event kind, in shadow first, with a per-user config flag to promote.
**Architecture:** A new application-layer `HeadlineStoryJudge` owns two questions: yesNo "same news event?" for title pairs in an ambiguous similarity band, and a 5-way `choice` of event kind for titles shown in a story timeline. It runs at **harvest time** (the hourly `feed-headlines` job), caches verdicts in memory by title pair and by title, and logs them beside the legacy verdict. The request path (`GET /headlines`, the Scroll headline adapter) makes no model calls: in `promote` mode it reads the cache synchronously, and on a miss or failure it keeps the legacy result.
**Tech Stack:** Node ESM backend, `IDecisionGateway` (`yesNo`, `choice`), `string-similarity`, vitest, VictoriaLogs (LogsQL) for rollout measurement.

---

## Current state (verified)

- **Clustering and labelling both run in the backend.** The doc names `Headlines.jsx`, but that file only renders the result.
  - `backend/src/3_applications/feed/services/HeadlineService.mjs:233` builds `briefing: this.#buildBriefing(sources)` inside `getAllHeadlines()`, which means on every request.
  - `#buildBriefing` at `HeadlineService.mjs:238-311`. The window is `36 * 60 * 60 * 1000` (`:250`). Canonical-URL match comes first (`:254`). An item is never compared with a cluster that already has its source (`:255`). The item needs at least 5 normalized words (`:258`), and the similarity test is `compareTwoStrings(cluster.normalizedTitle, normalizedTitle) >= 0.72` (`:259`), **against the cluster's lead title only**.
  - The event label regex is at `:296-298`: `correction|corrected` → `correction`, then `update|updated|developing|live` → `update`, otherwise `report`. The label is per timeline item. There is no cluster-level label.
  - `#normalizeClusterTitle` at `:313-321` lowercases, strips non-alphanumerics and drops stopwords.
- Frontend: `frontend/src/modules/Feed/Headlines/Headlines.jsx:119-121` renders the timeline only when `story.timeline?.length > 1`, and shows `item.kind` as text with class `briefing-story__event--${item.kind}`. `Headlines.scss` has **no** `briefing-story__event--*` rules, so new kinds need no style work.
- `getAllHeadlines` has two callers: `backend/src/4_api/v1/routers/feed.mjs:162` (`GET /headlines`) and `backend/src/1_adapters/feed/sources/HeadlineFeedAdapter.mjs:40`, which runs once per headline page on **every Scroll fetch** and throws the briefing away. A model call in `#buildBriefing` would be multiplied by Scroll traffic. That is why the judge runs at harvest time and the request path only reads its cache.
- Wiring: `createFeedServices` at `backend/src/5_composition/bootstrap.mjs:1125-1171` constructs `HeadlineService` (`:1149-1161`). `backend/src/app.mjs:1336-1341` calls it **without** `decisionGateway`, which `app.mjs:711-717` has already built by that point.
- Harvest: `HeadlineService.harvestAll(username, pageId?)` (`HeadlineService.mjs:103-168`). The scheduler runs it through `HeadlineHarvesterAdapter` (`backend/src/1_adapters/feed/HeadlineHarvesterAdapter.mjs:25,32`, serviceId `feed-headlines`), and so does `POST /headlines/harvest`.
- Config: per user, `config/feed.yml` through `DataServiceFeedConfigRepository#load`, which re-reads the YAML on each call. A `headlines.jev` change takes effect on the next harvest or request with no restart.
- `3_applications` may not import `crypto` (`scripts/audit-layer-imports.mjs:87`). The cache key is therefore the sorted normalized-title pair string, not a hash digest.
- Existing tests for this service live in `tests/isolated/application/feed/` (`HeadlineBriefing.test.mjs`, `HeadlineService.test.mjs`), not next to the source file. This plan extends `HeadlineBriefing.test.mjs` for service behaviour and colocates the new judge's test.

### Volume (from config plus a replay of the live cache, 2026-09-24)

- Config: 2 headline pages (`mainstream`, `topics`), 20 sources each, `max_per_source: 12`, so **at most 240 titles per page**. Harvest is hourly (`jobs.yml`: `feed-headlines` at `25 * * * *`), plus manual `POST /headlines/harvest`. The Headlines page does **not** poll: it fetches on mount and on manual refresh.
- A replay of `#buildBriefing` on the current harvested cache, with the same filters, dedupe and cap:
  - `mainstream`: 240 titles, 20,028 similarity comparisons. **1** pair ≥ 0.72, so 1 multi-source cluster out of 239. **13** pairs in [0.5, 0.72), 71 in [0.4, 0.5).
  - `topics`: 238 titles, 16,115 comparisons. 0 pairs ≥ 0.72, **1** in [0.5, 0.72).
  - The band pairs include five paraphrases of one story that the 0.72 cut leaves as five separate clusters, e.g. "White House Restores Access for CNN, MS NOW and Politico" / "CNN, MS NOW and Politico reporters regain entry to White House" (0.67).
  - Regex labels across the cache include false positives, e.g. "What's new in the Gemini Live API" → `update` and "Tribune editorial: … needs to be corrected" → `correction`.
- **Call sizing:** a cold cache costs about 14 pair calls plus about 15-30 label calls (timeline titles of multi-source clusters after Jev merges) per full harvest. That is about 45 calls, roughly 15 s sequential at ≤300 ms each, in a background job. After that, only new titles or pairs are asked: an estimated 5-15 calls per hour, under 400 per day. There is a hard cap of 80 calls per pass (`maxCallsPerReview`). The in-memory cache (5,000 entries per map, FIFO) resets on restart. Until the next hourly harvest, promote mode then serves the legacy briefing.

## Questions for Jev

Defined once in `HeadlineStoryJudge.mjs`:

```js
const SAME_EVENT = {
  sameEvent: yesNo(
    'Do headlines `a.title` and `b.title` report the same specific news event (the same incident, announcement, ruling, or result), not merely the same topic, people, or ongoing story?',
    { yes: 'Both outlets are covering one specific event.', no: 'Different events, or only the same broad topic or people.' }),
};

const EVENT_KIND = {
  kind: choice('What kind of coverage is the headline `title`?', {
    live: 'Breaking news, or a live blog / live coverage page',
    update: 'A follow-up or update to an already-reported story',
    correction: 'A correction or retraction of earlier reporting',
    analysis: 'Analysis, opinion, editorial, explainer, or commentary',
    report: 'A straight news report of an event',
  }),
};
```

State shapes, one `evaluate` per pair and one per title, with `{ timeout: 3000 }`:

- Pair: `{ a: { title, source, publishedAt }, b: { title, source, publishedAt } }`. `a` is the cluster lead and `b` the candidate item. `source` is the outlet label and `publishedAt` is ISO.
- Label: `{ title, source }`

Which inputs are asked:
- **Pairs:** exactly the comparisons `#buildBriefing` already makes that pass the window, source and word-count guards and score in `[band_low, 0.72)`. The default `band_low` is 0.5.
- **Labels:** timeline titles of clusters that render a timeline (≥ 2 dated items), taken from the projected briefing (the briefing with Jev merges applied), so shadow mode sees the stories that promote would show.

Legacy mapping for agreement: `live→update`, `update→update`, `correction→correction`, `analysis→report`, `report→report`.

## Rollout

Config, per user in `config/feed.yml` (all optional; defaults shown):

```yaml
headlines:
  jev:
    mode: shadow          # shadow | promote | off
    band_low: 0.5         # similarity floor for asking; must be < 0.72
    same_threshold: 0.6   # yesNo probability at/above which a band pair merges (promote)
    label_confidence: 0.6 # choice confidence at/above which the Jev kind replaces the regex kind (promote)
```

- **Shadow (ships default):** each harvest logs `feed.headlines.jev-pair` per new pair verdict (`similarity, a, b, jevProbability, jevSame, legacySame:false, agreed`), `feed.headlines.jev-label` per new label (`legacyKind, jevKind, jevConfidence, agreed`), and one `feed.headlines.jev-review` per page (`pairs, titles, evaluated, cached, failed, skipped, multiSourceServed, multiSourceWithJev`). The briefing is unchanged.
- **Promote criteria** (the store keeps 7 days, so measure after ≥5 days of shadow):
  - Merge precision: `curl -s {env.log_store_url}/select/logsql/query -d 'query="feed.headlines.jev-pair" AND data.jevSame:true AND _time:7d' -d 'limit=40'`. Hand-check the title pairs. Promote if ≥ 90% are the same event.
  - Label quality: `… -d 'query="feed.headlines.jev-label" AND data.agreed:false AND _time:7d' -d 'limit=30'`. Promote if Jev's kind is right in ≥ 75% of disagreements.
  - Reliability: `… -d 'query="feed.headlines.jev-review" AND _time:7d'`. `failed` must stay < 5% of `evaluated`. `multiSourceWithJev` should rise from `multiSourceServed` without swallowing the page (sanity: fewer than a third of the 40 served stories).
- **Promote:** set `headlines.jev.mode: promote`. If only one half passes, raise its threshold to `1` (`same_threshold: 1` or `label_confidence: 1`) and that half practically never overrides.
- **Rollback:** `mode: off`. The briefing returns to the pure legacy result on the next request.

---

## Task 0: Worktree

```bash
cd "$(git rev-parse --show-toplevel)"
git worktree add .worktrees/headlines-clustering -b feat/headlines-clustering
cd .worktrees/headlines-clustering
[ -e node_modules ] || ln -s ../../node_modules node_modules
npx vitest run tests/isolated/application/feed/HeadlineBriefing.test.mjs   # baseline: 1 passed
```

All later commands run from the worktree root. Do not start a backend.

---

## Task 1: `HeadlineStoryJudge`: settings, cache reads, review

**Files:**
- Create: `backend/src/3_applications/feed/services/HeadlineStoryJudge.mjs`
- Test (create): `backend/src/3_applications/feed/services/HeadlineStoryJudge.test.mjs`

**Step 1: Write the failing test**

```js
import { describe, it, expect, vi } from 'vitest';
import { HeadlineStoryJudge, EVENT_KINDS, LEGACY_MATCH } from './HeadlineStoryJudge.mjs';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });
const gateway = ({ same = 0.9, kind = 'live', confidence = 0.8, fail = false } = {}) => ({
  isConfigured: () => true,
  evaluate: vi.fn(async (state, questions) => {
    if (fail) throw new Error('jev down');
    if (questions.sameEvent) return { model: 'jev-test', answers: { sameEvent: { type: 'yesNo', probability: same } }, usage: {} };
    return { model: 'jev-test', answers: { kind: { type: 'choice', choice: kind, confidence, probabilities: { [kind]: confidence } } }, usage: {} };
  }),
});
const pair = (over = {}) => ({
  similarity: 0.67,
  normA: 'white house restores access cnn ms now politico',
  normB: 'cnn ms now politico reporters regain entry white house',
  a: { title: 'White House Restores Access for CNN, MS NOW and Politico', source: 'One', publishedAt: '2026-09-24T10:00:00Z' },
  b: { title: 'CNN, MS NOW and Politico reporters regain entry to White House', source: 'Two', publishedAt: '2026-09-24T11:00:00Z' },
  ...over,
});
const title = (over = {}) => ({ title: 'Gaza live: talks resume', source: 'One', legacyKind: 'update', ...over });
const trace = (over = {}) => ({ pageId: 'daily', pairs: [pair()], titles: [title()], ...over });
const SHADOW = HeadlineStoryJudge.settings({});
const PROMOTE = HeadlineStoryJudge.settings({ mode: 'promote' });

describe('HeadlineStoryJudge.settings', () => {
  it('defaults to shadow with a 0.5 band floor below the legacy match', () => {
    expect(SHADOW).toEqual({ mode: 'shadow', bandLow: 0.5, sameThreshold: 0.6, labelConfidence: 0.6 });
    expect(LEGACY_MATCH).toBe(0.72);
    expect(HeadlineStoryJudge.settings(undefined)).toEqual(SHADOW);
  });

  it('reads snake_case config and rejects out-of-range values', () => {
    expect(HeadlineStoryJudge.settings({ mode: 'promote', band_low: 0.55, same_threshold: 0.7, label_confidence: 0.5 }))
      .toEqual({ mode: 'promote', bandLow: 0.55, sameThreshold: 0.7, labelConfidence: 0.5 });
    expect(HeadlineStoryJudge.settings({ mode: 'bogus', band_low: 0.9, same_threshold: 2 })).toEqual(SHADOW);
  });
});

describe('HeadlineStoryJudge', () => {
  it('is inactive without a configured gateway or when off', async () => {
    expect(new HeadlineStoryJudge({}).active(SHADOW)).toBe(false);
    expect(new HeadlineStoryJudge({ decisionGateway: { isConfigured: () => false, evaluate: vi.fn() } }).active(SHADOW)).toBe(false);
    const g = gateway();
    const judge = new HeadlineStoryJudge({ decisionGateway: g, logger: logger() });
    const off = { ...SHADOW, mode: 'off' };
    expect(judge.active(off)).toBe(false);
    expect(await judge.review(trace(), off)).toMatchObject({ evaluated: 0 });
    expect(g.evaluate).not.toHaveBeenCalled();
  });

  it('asks one yesNo per band pair and one choice per title, with compact state', async () => {
    const g = gateway();
    const judge = new HeadlineStoryJudge({ decisionGateway: g, logger: logger() });
    const summary = await judge.review(trace(), SHADOW);
    expect(summary).toMatchObject({ page: 'daily', pairs: 1, titles: 1, evaluated: 2, cached: 0, failed: 0, skipped: 0 });
    const [pairState, pairQuestions, pairOptions] = g.evaluate.mock.calls[0];
    expect(pairState).toEqual({ a: pair().a, b: pair().b });
    expect(pairQuestions.sameEvent.type).toBe('yesNo');
    expect(pairOptions).toEqual({ timeout: 3000 });
    const [labelState, labelQuestions] = g.evaluate.mock.calls[1];
    expect(labelState).toEqual({ title: 'Gaza live: talks resume', source: 'One' });
    expect(labelQuestions.kind.type).toBe('choice');
    expect(Object.keys(labelQuestions.kind.options)).toEqual(EVENT_KINDS);
  });

  it('caches by title pair in either order and by title', async () => {
    const g = gateway();
    const judge = new HeadlineStoryJudge({ decisionGateway: g, logger: logger() });
    await judge.review(trace(), SHADOW);
    const swapped = pair({ normA: pair().normB, normB: pair().normA, a: pair().b, b: pair().a });
    expect(await judge.review(trace({ pairs: [swapped] }), SHADOW)).toMatchObject({ evaluated: 0, cached: 2 });
    expect(g.evaluate).toHaveBeenCalledTimes(2);
  });

  it('logs shadow agreement for pairs and labels', async () => {
    const log = logger();
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway({ same: 0.9, kind: 'live' }), logger: log });
    await judge.review(trace(), SHADOW);
    expect(log.info).toHaveBeenCalledWith('feed.headlines.jev-pair', expect.objectContaining({
      page: 'daily', similarity: 0.67, jevProbability: 0.9, jevSame: true, legacySame: false, agreed: false, model: 'jev-test',
    }));
    expect(log.info).toHaveBeenCalledWith('feed.headlines.jev-label', expect.objectContaining({
      page: 'daily', legacyKind: 'update', jevKind: 'live', jevConfidence: 0.8, agreed: true, model: 'jev-test',
    }));
  });

  it('stops asking at the per-review call budget', async () => {
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway(), logger: logger(), maxCallsPerReview: 1 });
    expect(await judge.review(trace(), SHADOW)).toMatchObject({ evaluated: 1, skipped: 1 });
  });

  it('never throws when the model fails, and caches nothing', async () => {
    const log = logger();
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway({ fail: true }), logger: log });
    expect(await judge.review(trace(), SHADOW)).toMatchObject({ evaluated: 0, failed: 2 });
    expect(log.warn).toHaveBeenCalledWith('feed.headlines.jev-pair-failed', expect.objectContaining({ error: 'jev down' }));
    expect(log.warn).toHaveBeenCalledWith('feed.headlines.jev-label-failed', expect.objectContaining({ error: 'jev down' }));
    expect(judge.cachedPair(pair().normA, pair().normB)).toBeNull();
    expect(judge.cachedLabel('Gaza live: talks resume')).toBeNull();
  });

  it('treats an answer outside the option set as a failure', async () => {
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway({ kind: 'rumour' }), logger: logger() });
    expect(await judge.review(trace({ pairs: [] }), SHADOW)).toMatchObject({ evaluated: 0, failed: 1 });
  });

  it('only answers sameEvent / eventKind in promote mode, above thresholds', async () => {
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway({ same: 0.9, kind: 'analysis', confidence: 0.7 }), logger: logger() });
    await judge.review(trace(), SHADOW);
    const { normA, normB } = pair();
    expect(judge.sameEvent(normA, normB, SHADOW)).toBe(false);
    expect(judge.sameEvent(normB, normA, PROMOTE)).toBe(true);
    expect(judge.sameEvent(normA, normB, { ...PROMOTE, sameThreshold: 0.95 })).toBe(false);
    expect(judge.sameEvent('never seen one', 'never seen two', PROMOTE)).toBe(false);
    expect(judge.eventKind('Gaza live: talks resume', SHADOW)).toBeNull();
    expect(judge.eventKind('  gaza LIVE:  talks resume ', PROMOTE)).toBe('analysis');
    expect(judge.eventKind('Gaza live: talks resume', { ...PROMOTE, labelConfidence: 0.9 })).toBeNull();
  });

  it('evicts the oldest verdict past the cache bound', async () => {
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway(), logger: logger(), cacheMax: 1 });
    await judge.review(trace({ titles: [title({ title: 'First headline' }), title({ title: 'Second headline' })], pairs: [] }), SHADOW);
    expect(judge.cachedLabel('First headline')).toBeNull();
    expect(judge.cachedLabel('Second headline')).toMatchObject({ choice: 'live' });
  });
});
```

**Step 2: Run it**

```bash
npx vitest run backend/src/3_applications/feed/services/HeadlineStoryJudge.test.mjs
```
Expected: FAIL, `Failed to load url ./HeadlineStoryJudge.mjs` (module does not exist).

**Step 3: Minimal implementation**: `backend/src/3_applications/feed/services/HeadlineStoryJudge.mjs`

```js
/**
 * HeadlineStoryJudge — a typed-decision second opinion on the Headlines briefing.
 *
 * HeadlineService#buildBriefing clusters cross-outlet titles by string
 * similarity (>= 0.72 against the cluster's lead title) and labels timeline
 * coverage with a keyword regex. Paraphrased headlines of one event score
 * 0.5-0.7 and stay apart; "Gemini Live API" reads as a live update. This judge
 * asks the decision model about exactly those cases:
 *
 *   - a pair in the ambiguous similarity band  → yesNo "same news event?"
 *   - a title shown in a story timeline        → choice of event kind
 *
 * It runs at harvest time, never on the request path. Verdicts are cached by
 * title pair and by title; the request path only reads the cache.
 *
 * Modes (user feed.yml `headlines.jev.mode`):
 *   shadow   ask and log beside the legacy verdict; the briefing is unchanged
 *   promote  the briefing merges band pairs and relabels titles from cached verdicts
 *   off      do nothing
 *
 * Any failure means "no verdict": the legacy clustering and label stand.
 */
import { yesNo, choice } from '#apps/common/ports/IDecisionGateway.mjs';

export const LEGACY_MATCH = 0.72;
export const EVENT_KINDS = ['live', 'update', 'correction', 'analysis', 'report'];
const LEGACY_EQUIVALENT = { live: 'update', update: 'update', correction: 'correction', analysis: 'report', report: 'report' };
const MODES = new Set(['shadow', 'promote', 'off']);
const DEFAULTS = Object.freeze({ mode: 'shadow', bandLow: 0.5, sameThreshold: 0.6, labelConfidence: 0.6 });

const SAME_EVENT = {
  sameEvent: yesNo(
    'Do headlines `a.title` and `b.title` report the same specific news event (the same incident, announcement, ruling, or result), not merely the same topic, people, or ongoing story?',
    { yes: 'Both outlets are covering one specific event.', no: 'Different events, or only the same broad topic or people.' }),
};

const EVENT_KIND = {
  kind: choice('What kind of coverage is the headline `title`?', {
    live: 'Breaking news, or a live blog / live coverage page',
    update: 'A follow-up or update to an already-reported story',
    correction: 'A correction or retraction of earlier reporting',
    analysis: 'Analysis, opinion, editorial, explainer, or commentary',
    report: 'A straight news report of an event',
  }),
};

const pickSame = answers => (Number.isFinite(answers?.sameEvent?.probability) ? answers.sameEvent : null);
const pickKind = answers => (EVENT_KINDS.includes(answers?.kind?.choice) ? answers.kind : null);
const unit = (value, fallback) => (Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback);
const round = value => Math.round(value * 1000) / 1000;

export class HeadlineStoryJudge {
  #decision; #logger; #timeoutMs; #maxCalls; #cacheMax;
  #pairs = new Map();
  #labels = new Map();

  /**
   * @param {Object} deps
   * @param {Object} [deps.decisionGateway] - IDecisionGateway; absent/unconfigured = inactive
   * @param {Object} [deps.logger]
   * @param {number} [deps.timeoutMs=3000] - Per-question request timeout
   * @param {number} [deps.maxCallsPerReview=80] - Model calls allowed per review() pass
   * @param {number} [deps.cacheMax=5000] - Entries kept per cache (pairs, labels), oldest evicted first
   */
  constructor({ decisionGateway = null, logger = console, timeoutMs = 3000, maxCallsPerReview = 80, cacheMax = 5000 } = {}) {
    this.#decision = decisionGateway?.isConfigured?.() === false ? null : decisionGateway;
    this.#logger = logger;
    this.#timeoutMs = timeoutMs;
    this.#maxCalls = maxCallsPerReview;
    this.#cacheMax = cacheMax;
  }

  /** Normalize the user's `headlines.jev` block. */
  static settings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const bandLow = unit(r.band_low, DEFAULTS.bandLow);
    return {
      mode: MODES.has(r.mode) ? r.mode : DEFAULTS.mode,
      bandLow: bandLow < LEGACY_MATCH ? bandLow : DEFAULTS.bandLow,
      sameThreshold: unit(r.same_threshold, DEFAULTS.sameThreshold),
      labelConfidence: unit(r.label_confidence, DEFAULTS.labelConfidence),
    };
  }

  static pairKey(normA, normB) {
    const a = String(normA || ''); const b = String(normB || '');
    return a < b ? `${a}\u0001${b}` : `${b}\u0001${a}`;
  }

  static labelKey(title) {
    return String(title || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  active(settings) { return !!this.#decision && !!settings && MODES.has(settings.mode) && settings.mode !== 'off'; }
  promoting(settings) { return this.active(settings) && settings.mode === 'promote'; }

  cachedPair(normA, normB) { return this.#pairs.get(HeadlineStoryJudge.pairKey(normA, normB)) ?? null; }
  cachedLabel(title) { return this.#labels.get(HeadlineStoryJudge.labelKey(title)) ?? null; }

  /** Request-path read: merge this band pair? Only cached verdicts count; never calls the model. */
  sameEvent(normA, normB, settings) {
    if (!this.promoting(settings)) return false;
    const hit = this.cachedPair(normA, normB);
    return !!hit && hit.probability >= settings.sameThreshold;
  }

  /** Request-path read: the Jev kind for a title, or null to keep the legacy label. */
  eventKind(title, settings) {
    if (!this.promoting(settings)) return null;
    const hit = this.cachedLabel(title);
    return hit && hit.confidence >= settings.labelConfidence ? hit.choice : null;
  }

  /**
   * Ask the model about uncached pairs and titles in a briefing trace. Never throws.
   * @param {{ pageId?: string, pairs: Object[], titles: Object[] }} trace
   * @param {ReturnType<typeof HeadlineStoryJudge.settings>} settings
   */
  async review(trace, settings) {
    const page = trace?.pageId ?? null;
    const pairs = trace?.pairs ?? [];
    const titles = trace?.titles ?? [];
    const summary = { page, mode: settings?.mode ?? null, pairs: pairs.length, titles: titles.length, evaluated: 0, cached: 0, failed: 0, skipped: 0 };
    if (!this.active(settings)) return summary;
    let budget = this.#maxCalls;

    for (const pair of pairs) {
      const key = HeadlineStoryJudge.pairKey(pair.normA, pair.normB);
      if (this.#pairs.has(key)) { summary.cached++; continue; }
      if (budget <= 0) { summary.skipped++; continue; }
      budget--;
      const got = await this.#ask({ a: pair.a, b: pair.b }, SAME_EVENT, pickSame,
        'feed.headlines.jev-pair-failed', { page, a: pair.a?.title, b: pair.b?.title });
      if (!got) { summary.failed++; continue; }
      const record = { probability: got.answer.probability, model: got.model };
      this.#remember(this.#pairs, key, record);
      summary.evaluated++;
      const jevSame = record.probability >= settings.sameThreshold;
      this.#logger.info?.('feed.headlines.jev-pair', {
        page, mode: settings.mode, similarity: round(pair.similarity),
        a: pair.a?.title, aSource: pair.a?.source, b: pair.b?.title, bSource: pair.b?.source,
        jevProbability: record.probability, jevSame, legacySame: false, agreed: !jevSame,
        model: got.model, ms: got.ms,
      });
    }

    for (const item of titles) {
      const key = HeadlineStoryJudge.labelKey(item.title);
      if (!key) continue;
      if (this.#labels.has(key)) { summary.cached++; continue; }
      if (budget <= 0) { summary.skipped++; continue; }
      budget--;
      const got = await this.#ask({ title: item.title, source: item.source }, EVENT_KIND, pickKind,
        'feed.headlines.jev-label-failed', { page, title: item.title });
      if (!got) { summary.failed++; continue; }
      const record = { choice: got.answer.choice, confidence: Number.isFinite(got.answer.confidence) ? got.answer.confidence : 0, model: got.model };
      this.#remember(this.#labels, key, record);
      summary.evaluated++;
      this.#logger.info?.('feed.headlines.jev-label', {
        page, mode: settings.mode, title: item.title, source: item.source,
        legacyKind: item.legacyKind, jevKind: record.choice, jevConfidence: record.confidence,
        probabilities: got.answer.probabilities ?? null,
        agreed: LEGACY_EQUIVALENT[record.choice] === item.legacyKind,
        model: got.model, ms: got.ms,
      });
    }
    return summary;
  }

  async #ask(state, questions, pick, failEvent, context) {
    const started = Date.now();
    try {
      const result = await this.#decision.evaluate(state, questions, { timeout: this.#timeoutMs });
      const answer = pick(result?.answers);
      if (!answer) throw new Error('decision model returned no usable answer');
      return { answer, model: result.model ?? null, ms: Date.now() - started };
    } catch (error) {
      this.#logger.warn?.(failEvent, { ...context, error: error.message, ms: Date.now() - started });
      return null;
    }
  }

  #remember(map, key, value) {
    if (map.size >= this.#cacheMax) map.delete(map.keys().next().value);
    map.set(key, value);
  }
}

export default HeadlineStoryJudge;
```

**Step 4: Run**

```bash
npx vitest run backend/src/3_applications/feed/services/HeadlineStoryJudge.test.mjs
```
Expected: PASS (11 tests).

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/HeadlineStoryJudge.mjs backend/src/3_applications/feed/services/HeadlineStoryJudge.test.mjs
git commit -m "$(cat <<'EOF'
feat(feed): HeadlineStoryJudge — Jev same-event and event-kind verdicts

Asks yesNo "same news event?" for headline pairs in the ambiguous similarity
band and a 5-way event-kind choice for timeline titles. Caches by title pair /
title, logs beside the legacy verdict, never throws. Not wired yet.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Briefing trace and promote hooks in `HeadlineService`

**Files:**
- Modify: `backend/src/3_applications/feed/services/HeadlineService.mjs`: imports (`:1-4`), constructor (`:15-44`), `getAllHeadlines` (`:176-236`), `#buildBriefing` (`:238-311`)
- Test (modify): `tests/isolated/application/feed/HeadlineBriefing.test.mjs`

**Step 1: Write the failing tests.** Append to `tests/isolated/application/feed/HeadlineBriefing.test.mjs`, and change its first import line to `import { describe, expect, test, vi } from 'vitest';`:

```js
import stringSimilarity from 'string-similarity';
import { HeadlineStoryJudge } from '#apps/feed/services/HeadlineStoryJudge.mjs';

const PARAPHRASE_A = 'White House Restores Access for CNN, MS NOW and Politico';
const PARAPHRASE_B = 'CNN, MS NOW and Politico reporters regain entry to White House';
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'from']);
const norm = t => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w)).join(' ');

const fakeGateway = ({ same = 0.9, kind = 'live', confidence = 0.8, fail = false } = {}) => ({
  isConfigured: () => true,
  evaluate: vi.fn(async (state, questions) => {
    if (fail) throw new Error('jev down');
    if (questions.sameEvent) return { model: 'jev-test', answers: { sameEvent: { type: 'yesNo', probability: same } }, usage: {} };
    return { model: 'jev-test', answers: { kind: { type: 'choice', choice: kind, confidence, probabilities: { [kind]: confidence } } }, usage: {} };
  }),
});

function paraphraseService({ jev = null, storyJudge = null } = {}) {
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const config = {
    headline_pages: [{
      id: 'daily', label: 'Daily', grid: { rows: ['top'], cols: ['left', 'right'] },
      sources: [
        { id: 'one', label: 'One', row: 0, col: 0, url: 'https://one.example/rss' },
        { id: 'two', label: 'Two', row: 0, col: 1, url: 'https://two.example/rss' },
      ],
    }],
    headlines: jev ? { jev } : {},
  };
  const cached = {
    one: { items: [{ id: 'one-a', title: PARAPHRASE_A, link: 'https://one.example/wh', timestamp: now }] },
    two: { items: [{ id: 'two-a', title: PARAPHRASE_B, link: 'https://two.example/wh', timestamp: earlier }] },
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const service = new HeadlineService({
    headlineStore: {
      loadAllSources: async () => cached,
      loadSource: async () => null,
      saveSource: async () => true,
      pruneOlderThan: async () => 0,
    },
    harvester: { harvest: async () => ({ items: [] }) },
    configRepository: new DataServiceFeedConfigRepository({ dataService: { user: { read: () => config } } }),
    storyJudge,
    logger: log,
  });
  return { service, log };
}

describe('HeadlineService briefing with a story judge', () => {
  test('the paraphrase fixture sits in the ambiguous band', () => {
    const similarity = stringSimilarity.compareTwoStrings(norm(PARAPHRASE_A), norm(PARAPHRASE_B));
    expect(similarity).toBeGreaterThanOrEqual(0.5);
    expect(similarity).toBeLessThan(0.72);
  });

  test('without a judge, band pairs stay separate (legacy)', async () => {
    const { service } = paraphraseService();
    const { briefing } = await service.getAllHeadlines('alice', 'daily');
    expect(briefing).toHaveLength(2);
    expect(briefing.every(story => story.sourceCount === 1)).toBe(true);
  });

  test('traces band pairs and timeline titles without changing a shadow briefing', async () => {
    const judge = new HeadlineStoryJudge({ decisionGateway: fakeGateway(), logger: { info() {}, warn() {} } });
    const { service } = paraphraseService({ storyJudge: judge });
    const trace = { pageId: 'daily', pairs: [], titles: [] };
    const { briefing } = await service.getAllHeadlines('alice', 'daily', { trace });
    expect(briefing).toHaveLength(2);
    expect(trace.pairs).toHaveLength(1);
    expect(trace.pairs[0]).toMatchObject({
      normA: norm(PARAPHRASE_A), normB: norm(PARAPHRASE_B),
      a: { title: PARAPHRASE_A, source: 'One' }, b: { title: PARAPHRASE_B, source: 'Two' },
    });
    expect(trace.titles).toEqual([]);
  });

  test('promote with cached verdicts merges the pair and relabels its timeline', async () => {
    const judge = new HeadlineStoryJudge({ decisionGateway: fakeGateway({ kind: 'analysis' }), logger: { info() {}, warn() {} } });
    const settings = HeadlineStoryJudge.settings({ mode: 'promote' });
    await judge.review({ pageId: 'daily', pairs: [{ similarity: 0.67, normA: norm(PARAPHRASE_A), normB: norm(PARAPHRASE_B),
      a: { title: PARAPHRASE_A }, b: { title: PARAPHRASE_B } }],
    titles: [{ title: PARAPHRASE_A, legacyKind: 'report' }, { title: PARAPHRASE_B, legacyKind: 'report' }] }, settings);
    const { service } = paraphraseService({ storyJudge: judge, jev: { mode: 'promote' } });
    const { briefing } = await service.getAllHeadlines('alice', 'daily');
    expect(briefing).toHaveLength(1);
    expect(briefing[0].sourceCount).toBe(2);
    expect(briefing[0].timeline.map(item => item.kind)).toEqual(['analysis', 'analysis']);
  });

  test('promote with an empty cache serves the legacy briefing and asks nothing', async () => {
    const gateway = fakeGateway();
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway, logger: { info() {}, warn() {} } });
    const { service } = paraphraseService({ storyJudge: judge, jev: { mode: 'promote' } });
    const { briefing } = await service.getAllHeadlines('alice', 'daily');
    expect(briefing).toHaveLength(2);
    expect(briefing[0].timeline.every(item => item.kind === 'report')).toBe(true);
    expect(gateway.evaluate).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run**

```bash
npx vitest run tests/isolated/application/feed/HeadlineBriefing.test.mjs
```
Expected: FAIL. The two trace/promote tests fail (`trace.pairs` has length 0; the promoted briefing has length 2). The legacy and fixture tests pass.

**Step 3: Minimal implementation** in `HeadlineService.mjs`.

(a) Imports, lines 1-4. Add:

```js
import { HeadlineStoryJudge, LEGACY_MATCH } from './HeadlineStoryJudge.mjs';
```

(b) Below the imports, above `export class HeadlineService`, add:

```js
/** Keyword label used when no Jev verdict applies (and as the shadow baseline). */
export function legacyEventKind(title) {
  return /\b(correction|corrected)\b/i.test(title) ? 'correction'
    : /\b(update|updated|developing|live)\b/i.test(title) ? 'update'
      : 'report';
}
```

(c) Constructor. Add the field `#storyJudge;` after `#logger;`, add `storyJudge = null` to the destructured params (`{ headlineStore, harvester, configRepository, config = {}, webContentGateway, storyJudge = null, logger = console }`), and in the body add `this.#storyJudge = storyJudge;`.

(d) `getAllHeadlines`. Change the signature to:

```js
  async getAllHeadlines(username, pageId, { trace = null, judgeSettings = null } = {}) {
```

After `const excludePatterns = …` (`:187`), add:

```js
    const storySettings = judgeSettings || HeadlineStoryJudge.settings(headlineConfig.jev);
```

and change the briefing line (`:233`) to:

```js
      briefing: this.#buildBriefing(sources, { settings: storySettings, trace }),
```

(e) Replace `#buildBriefing` (`:238-311`) with:

```js
  #buildBriefing(sources, { settings = null, trace = null } = {}) {
    const judge = this.#storyJudge;
    const candidates = Object.entries(sources).flatMap(([sourceId, source]) =>
      (source.items || []).map(item => ({
        ...item,
        sourceId,
        sourceLabel: source.label || sourceId,
        canonicalUrl: canonicalizeFeedUrl(item.link || item.url),
        publishedAt: item.publishedAt || item.timestamp || item.published || null,
      })),
    ).sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

    const clusters = [];
    const windowMs = 36 * 60 * 60 * 1000;
    for (const item of candidates) {
      const normalizedTitle = this.#normalizeClusterTitle(item.title);
      const match = clusters.find(cluster => {
        if (item.canonicalUrl && cluster.canonicalUrls.has(item.canonicalUrl)) return true;
        if (cluster.sourceIds.has(item.sourceId)) return false;
        const age = Math.abs(new Date(cluster.publishedAt || 0) - new Date(item.publishedAt || 0));
        if (age > windowMs || normalizedTitle.split(' ').length < 5) return false;
        const similarity = stringSimilarity.compareTwoStrings(cluster.normalizedTitle, normalizedTitle);
        if (similarity >= LEGACY_MATCH) return true;
        if (!judge || !settings || similarity < settings.bandLow) return false;
        trace?.pairs.push({
          similarity,
          normA: cluster.normalizedTitle,
          normB: normalizedTitle,
          a: { title: cluster.title, source: cluster.leadSource, publishedAt: cluster.publishedAt },
          b: { title: item.title, source: item.sourceLabel, publishedAt: item.publishedAt },
        });
        return judge.sameEvent(cluster.normalizedTitle, normalizedTitle, settings);
      });
      if (match) {
        match.coverage.push(item);
        match.sourceIds.add(item.sourceId);
        if (item.canonicalUrl) match.canonicalUrls.add(item.canonicalUrl);
      } else {
        clusters.push({
          id: item.canonicalUrl || `${item.sourceId}:${item.id || normalizedTitle}`,
          title: item.title,
          excerpt: item.desc || item.summary || '',
          publishedAt: item.publishedAt,
          leadSource: item.sourceLabel,
          normalizedTitle,
          canonicalUrls: new Set(item.canonicalUrl ? [item.canonicalUrl] : []),
          sourceIds: new Set([item.sourceId]),
          coverage: [item],
        });
      }
    }
    return clusters
      .sort((a, b) => b.sourceIds.size - a.sourceIds.size || new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
      .slice(0, 40)
      .map(cluster => {
        const coverage = cluster.coverage.map(item => ({
          id: item.id,
          title: item.title,
          url: item.link || item.url,
          sourceId: item.sourceId,
          sourceLabel: item.sourceLabel,
          publishedAt: item.publishedAt,
        }));
        const dated = [...coverage]
          .filter(item => item.publishedAt)
          .sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
        const shown = dated.length > 1; // the frontend renders a timeline only past one entry
        const timeline = dated.map(item => {
          const legacyKind = legacyEventKind(item.title);
          if (trace && shown) trace.titles.push({ title: item.title, source: item.sourceLabel, legacyKind });
          const jevKind = judge && settings ? judge.eventKind(item.title, settings) : null;
          return { ...item, kind: jevKind || legacyKind };
        });
        return {
          id: cluster.id,
          title: cluster.title,
          excerpt: cluster.excerpt,
          publishedAt: cluster.publishedAt,
          leadSource: cluster.leadSource,
          sourceCount: cluster.sourceIds.size,
          coverage,
          timeline,
        };
      });
  }
```

With no judge, the band branch returns `false` exactly as before. Guard order and thresholds are unchanged, so the legacy result is identical.

**Step 4: Run**

```bash
npx vitest run tests/isolated/application/feed/HeadlineBriefing.test.mjs tests/isolated/application/feed/HeadlineService.test.mjs
```
Expected: PASS (all tests in both files, including the original briefing test).

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/HeadlineService.mjs tests/isolated/application/feed/HeadlineBriefing.test.mjs
git commit -m "$(cat <<'EOF'
feat(feed): briefing traces ambiguous pairs; promote reads cached Jev verdicts

#buildBriefing records same-window pairs in [band_low, 0.72) and timeline
titles into an optional trace. In promote mode it merges band pairs and
relabels titles from the story judge's cache only; no model call on the
request path. Legacy result unchanged without a judge.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Review at harvest time

**Files:**
- Modify: `backend/src/3_applications/feed/services/HeadlineService.mjs`: `harvestAll` (`:159-168`), plus a new private `#reviewStories`
- Test (modify): `tests/isolated/application/feed/HeadlineBriefing.test.mjs`

**Step 1: Write the failing tests.** Append:

```js
describe('HeadlineService harvest-time story review', () => {
  test('shadow: harvest asks about the band pair and the projected timeline, briefing unchanged', async () => {
    const gateway = fakeGateway();
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway, logger: { info() {}, warn() {} } });
    const { service, log } = paraphraseService({ storyJudge: judge });
    await service.harvestAll('alice');
    expect(log.info).toHaveBeenCalledWith('feed.headlines.jev-review', expect.objectContaining({
      page: 'daily', mode: 'shadow', pairs: 1, titles: 2, evaluated: 3, failed: 0,
      multiSourceServed: 0, multiSourceWithJev: 1,
    }));
    const { briefing } = await service.getAllHeadlines('alice', 'daily');
    expect(briefing).toHaveLength(2);
    await service.harvestAll('alice');
    expect(gateway.evaluate).toHaveBeenCalledTimes(3); // second harvest is all cache hits
  });

  test('promote: after a harvest the served briefing uses the verdicts', async () => {
    const judge = new HeadlineStoryJudge({ decisionGateway: fakeGateway({ kind: 'live' }), logger: { info() {}, warn() {} } });
    const { service } = paraphraseService({ storyJudge: judge, jev: { mode: 'promote' } });
    await service.harvestAll('alice');
    const { briefing } = await service.getAllHeadlines('alice', 'daily');
    expect(briefing).toHaveLength(1);
    expect(briefing[0].timeline.map(item => item.kind)).toEqual(['live', 'live']);
  });

  test('off: harvest never asks the model', async () => {
    const gateway = fakeGateway();
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway, logger: { info() {}, warn() {} } });
    const { service } = paraphraseService({ storyJudge: judge, jev: { mode: 'off' } });
    await service.harvestAll('alice');
    expect(gateway.evaluate).not.toHaveBeenCalled();
  });

  test('a failing model never breaks harvest or the briefing', async () => {
    const judgeLog = { info: vi.fn(), warn: vi.fn() };
    const judge = new HeadlineStoryJudge({ decisionGateway: fakeGateway({ fail: true }), logger: judgeLog });
    const { service } = paraphraseService({ storyJudge: judge, jev: { mode: 'promote' } });
    await expect(service.harvestAll('alice')).resolves.toMatchObject({ harvested: 2 });
    expect(judgeLog.warn).toHaveBeenCalledWith('feed.headlines.jev-pair-failed', expect.objectContaining({ error: 'jev down' }));
    const { briefing } = await service.getAllHeadlines('alice', 'daily');
    expect(briefing).toHaveLength(2);
  });
});
```

**Step 2: Run**

```bash
npx vitest run tests/isolated/application/feed/HeadlineBriefing.test.mjs
```
Expected: FAIL. `jev-review` is never logged, `evaluate` is never called, and the promote briefing has length 2. The "failing model" test may already pass. That is fine.

**Step 3: Minimal implementation.**

In `harvestAll`, between the `headline.service.harvestAll.complete` log (`:159-165`) and `return` (`:167`), insert:

```js
    await this.#reviewStories(username, pageId);
```

Add this private method after `#normalizeClusterTitle`:

```js
  /**
   * Harvest-time Jev pass. Pass 1 asks about band pairs from the briefing as
   * served; pass 2 labels the timeline titles of the briefing as it would look
   * with Jev merges applied, so shadow mode sees the stories promote would show.
   * Never throws; the harvest result is unaffected.
   */
  async #reviewStories(username, pageId) {
    const judge = this.#storyJudge;
    if (!judge) return;
    const settings = HeadlineStoryJudge.settings(this.#getUserConfig(username).headlines?.jev);
    if (!judge.active(settings)) return;
    const pageIds = pageId ? [pageId] : this.#getPages(username).map(p => p.id);
    const multiSource = result => (result?.briefing || []).filter(story => story.sourceCount > 1).length;

    for (const id of pageIds) {
      try {
        const servedTrace = { pageId: id, pairs: [], titles: [] };
        const served = await this.getAllHeadlines(username, id, { trace: servedTrace });
        if (!served) continue;
        const pairPass = await judge.review({ pageId: id, pairs: servedTrace.pairs, titles: [] }, settings);

        const projectedTrace = { pageId: id, pairs: [], titles: [] };
        const projected = await this.getAllHeadlines(username, id, {
          trace: projectedTrace, judgeSettings: { ...settings, mode: 'promote' },
        });
        const labelPass = await judge.review({ pageId: id, pairs: projectedTrace.pairs, titles: projectedTrace.titles }, settings);

        this.#logger.info?.('feed.headlines.jev-review', {
          page: id,
          mode: settings.mode,
          pairs: servedTrace.pairs.length,
          titles: projectedTrace.titles.length,
          evaluated: pairPass.evaluated + labelPass.evaluated,
          cached: pairPass.cached + labelPass.cached,
          failed: pairPass.failed + labelPass.failed,
          skipped: pairPass.skipped + labelPass.skipped,
          multiSourceServed: multiSource(served),
          multiSourceWithJev: multiSource(projected),
        });
      } catch (error) {
        this.#logger.warn?.('feed.headlines.jev-review-failed', { page: id, error: error.message });
      }
    }
  }
```

**Step 4: Run**

```bash
npx vitest run tests/isolated/application/feed/HeadlineBriefing.test.mjs tests/isolated/application/feed/HeadlineService.test.mjs backend/src/3_applications/feed/services/HeadlineStoryJudge.test.mjs
```
Expected: PASS (all).

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/HeadlineService.mjs tests/isolated/application/feed/HeadlineBriefing.test.mjs
git commit -m "$(cat <<'EOF'
feat(feed): run the headline story judge after each harvest

harvestAll reviews each page: band pairs from the served briefing, then
timeline labels from the Jev-projected briefing. Logs feed.headlines.jev-review
with served vs projected multi-source story counts. Failures are logged and
never affect the harvest.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire the decision gateway into feed composition

**Files:**
- Modify: `backend/src/5_composition/bootstrap.mjs`: import beside `:208`, and `createFeedServices` `:1116-1171`
- Modify: `backend/src/app.mjs:1336-1341`
- Test (modify): `tests/isolated/assembly/infrastructure/bootstrap.test.mjs`

**Step 1: Write the failing test.** In `tests/isolated/assembly/infrastructure/bootstrap.test.mjs`, change the first import to `import { createContentRegistry, createFeedServices } from '#composition/bootstrap.mjs';`, add `import { HeadlineStoryJudge } from '#apps/feed/services/HeadlineStoryJudge.mjs';`, and append:

```js
describe('createFeedServices', () => {
  const deps = extra => ({
    dataService: { user: { read: () => ({}), write: () => true, resolvePath: () => null } },
    configService: { getHeadOfHousehold: () => 'alice' },
    freshrssHost: null,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    ...extra,
  });

  it('builds an active story judge when a decision gateway is supplied', () => {
    const decisionGateway = { isConfigured: () => true, evaluate: async () => ({}) };
    const { headlineStoryJudge } = createFeedServices(deps({ decisionGateway }));
    expect(headlineStoryJudge.active(HeadlineStoryJudge.settings({}))).toBe(true);
  });

  it('builds an inactive story judge without one', () => {
    const { headlineStoryJudge } = createFeedServices(deps());
    expect(headlineStoryJudge.active(HeadlineStoryJudge.settings({}))).toBe(false);
  });
});
```

**Step 2: Run**

```bash
npx vitest run tests/isolated/assembly/infrastructure/bootstrap.test.mjs
```
Expected: FAIL, `Cannot read properties of undefined (reading 'active')`. If a constructor in `createFeedServices` rejects the fake `dataService`, add only the method it names to the fake and re-run until you see this failure.

**Step 3: Minimal implementation.**

`bootstrap.mjs`, next to the `HeadlineService` import at `:208`:

```js
import { HeadlineStoryJudge } from '#apps/feed/services/HeadlineStoryJudge.mjs';
```

In `createFeedServices`, add `@param {Object} [config.decisionGateway] - IDecisionGateway for the headline story judge` to the JSDoc, and change the destructure to:

```js
  const { dataService, configService, freshrssHost, decisionGateway = null, logger = console } = config;
```

Just before `const headlineService = new HeadlineService({`:

```js
  const headlineStoryJudge = new HeadlineStoryJudge({ decisionGateway, logger });
```

Add `storyJudge: headlineStoryJudge,` to the `HeadlineService` constructor object (after `webContentGateway,`), and change the return to:

```js
  return { freshRSSAdapter, headlineService, headlineStoryJudge, headlineHarvestJob, feedConfigRepository };
```

`app.mjs:1336-1341`:

```js
  const feedServices = createFeedServices({
    dataService,
    configService,
    freshrssHost: freshrssHost || null,
    decisionGateway,
    logger: rootLogger.child({ module: 'feed' }),
  });
```

**Step 4: Run**

```bash
npx vitest run tests/isolated/assembly/infrastructure/bootstrap.test.mjs
npm run audit:layers
```
Expected: tests PASS. `audit:layers` reports no new violations (the judge imports only `#apps/common/ports/IDecisionGateway.mjs`, and there is no `crypto`).

**Step 5: Commit**

```bash
git add backend/src/5_composition/bootstrap.mjs backend/src/app.mjs tests/isolated/assembly/infrastructure/bootstrap.test.mjs
git commit -m "$(cat <<'EOF'
feat(feed): pass the decision gateway to the headline story judge

createFeedServices builds HeadlineStoryJudge from the optional decisionGateway
and injects it into HeadlineService. Without a Jev key the judge is inactive
and the briefing is exactly as before.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Docs

**Files:**
- Modify: `docs/reference/feed/feed-system-architecture.md`: the `GET /headlines` paragraph (`:320`), plus a new subsection after "Paywall Proxy" (`:290-292`)

**Step 1.** Replace the paragraph at `:320` with:

```markdown
`GET /headlines` returns both the configured outlet matrix and a `briefing`, built in `HeadlineService#buildBriefing` (backend; `Headlines.jsx` only renders it). Briefing clusters exact canonical URLs, then cross-outlet titles within 36 hours whose normalized form (≥ 5 words) scores ≥ 0.72 string similarity against the cluster's lead title. Its displayed excerpt is always attributed source material; no generated claims are introduced. Each cluster includes chronological harvested coverage; each timeline entry carries a `kind`: by default a keyword label (`correction`/`corrected` → `correction`; `update`/`updated`/`developing`/`live` → `update`; else `report`). With the story judge promoted (below), pairs scoring in the ambiguous band can also merge and `kind` can be `live`, `update`, `correction`, `analysis`, or `report`. This is coverage chronology, not publisher-page revision tracking.
```

**Step 2.** After the "Paywall Proxy" subsection, add:

````markdown
### Story Judge (typed decisions)

`HeadlineStoryJudge` (`backend/src/3_applications/feed/services/`) gives the decision model (`IDecisionGateway`) two narrow questions the briefing cannot answer with string rules:

- **Same event?** A yesNo for title pairs that pass the window/source/word guards and score in `[band_low, 0.72)`.
- **Event kind.** A choice of `live | update | correction | analysis | report` for titles shown in a story timeline.

It runs after every harvest (`harvestAll`, i.e. the hourly `feed-headlines` job or `POST /headlines/harvest`), never on a request. Verdicts are cached in memory by normalized title pair and by title (bounded, reset on restart); `GET /headlines` and the Scroll headline adapter only read that cache. No decision gateway, a failure, or a cache miss all mean the legacy result.

```yaml
# user config/feed.yml
headlines:
  jev:
    mode: shadow          # shadow (default) | promote | off
    band_low: 0.5         # similarity floor for asking (< 0.72)
    same_threshold: 0.6   # probability to merge a band pair (promote)
    label_confidence: 0.6 # confidence to replace the keyword label (promote)
```

Log events: `feed.headlines.jev-pair`, `feed.headlines.jev-label` (per new verdict, with legacy agreement), `feed.headlines.jev-review` (per page per harvest: `evaluated`, `cached`, `failed`, `skipped`, `multiSourceServed`, `multiSourceWithJev`), `feed.headlines.jev-pair-failed` / `jev-label-failed` / `jev-review-failed`. Shadow-to-promote criteria: `docs/_wip/plans/2026-09-24-jev-headlines-clustering.md` → Rollout.
````

**Step 3: Commit**

```bash
git add docs/reference/feed/feed-system-architecture.md
git commit -m "$(cat <<'EOF'
docs(feed): headline briefing runs in the backend; document the story judge

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Full suite for touched dirs

```bash
npx vitest run backend/src/3_applications/feed tests/isolated/application/feed tests/isolated/api/feed tests/isolated/assembly/infrastructure/bootstrap.test.mjs
npm run audit:layers
node --check backend/src/app.mjs
git status --short   # clean
```

Expected: all pass, no new layer violations, clean tree. Then merge into `main` from the main checkout (`git merge feat/headlines-clustering`), record the branch in `docs/_archive/deleted-branches.md`, delete the branch, and remove the worktree. Do not deploy. Shadow mode takes effect on the first harvest after the next deploy, as long as the Jev key is configured.
