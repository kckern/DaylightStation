# Content Filter Subtitle Cue Review (Jev) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Run every subtitle word-list mute cue past Jev offline and write a review file that shows a grown-up which cues are probably innocent uses ("hell" the place, "spook" the ghost, "god" in a prayer). Jev never adds, removes or changes a cue.
**Architecture:** A pure domain module (`2_domains/content-filter/subtitleWords.mjs`) owns SRT parsing, the compiled word list and the word-hit → mute-cue rule, so `srt-mutes` and the new review share one matcher and one cue id. An application service (`3_applications/content-filter/SubtitleCueReview.mjs`) asks Jev one `choice` and one `score` per hit through `IDecisionGateway`, with bounded concurrency, and returns review items. The `contentfilter` CLI (its own composition root) gets a `srt-review` command that writes `household/content-filter/review/{ratingKey}.yml`. The override file is the only thing playback reads, and this command never writes to it.
**Tech Stack:** Node ESM (`.mjs`), vitest, js-yaml, `IDecisionGateway` / `JevAdapter`, backend structured logger (`createLogger`).
---

## Current state (verified 2026-09-24 against `main` @ bf03fd80a)

What the doc says versus what the code has:

| Claim (`docs/reference/core/content-filter.md`) | Code reality |
|---|---|
| L13: "SRT word lists" are an import source | Yes, as the CLI command `srt-mutes` (`cli/contentfilter.cli.mjs:1034-1146`). No backend code touches SRT for filtering. `backend/src/3_applications/content-filter/` holds only `GetContentFilter` (read path, 30 lines) and its port. |
| L36-40: every cue has `category`, `channel`, `severity` (`low\|medium\|high`) | **No cue in the data has `severity`.** 0 of 499 EDLs under `media/content-filter/edl/` contain the key (VidAngel export `tagSetToEdl`, `cli/contentfilter.cli.mjs:324-359`, never sets it). `srt-mutes` cues (`:1117-1126`) set neither `severity` nor `channel`. Only the MCF importer (`:459-470`) reads a severity. |
| L64-65: profiles map category to effect | True for EDL cues. **`srt-mutes` cues carry an explicit `effect: mute`**, and the resolver's precedence (`frontend/src/lib/Player/contentFilter.js:113-119`) means an explicit effect bypasses the profile. For SRT cues, category and severity have **no playback effect at all**. The only lever a grown-up has is `cueOverrides.{id}.disabled` (`contentFilter.js:110-111`). |
| `bad-words.yml` header: "CONSUMED BY: cli/contentfilter.cli.mjs `srt-mutes`" | **False.** `srt-mutes` uses its own hard-coded `BAD_WORDS` (`cli/contentfilter.cli.mjs:1051-1076`, 13 leaves). `household/content-filter/bad-words.yml` (32 leaves, 102 forms, `group` + `tier` + `swap`, plus a `phrases:` list) is read by nothing. Checked: every old form is present in the YAML; only `goddamn/goddammit/goddamnit` move from leaf `damn` (profanity) to leaf `goddamn` (blasphemy). |
| Category taxonomy | Three different taxonomies are in use. VidAngel EDLs use `language/{profanity,blasphemy,language_sexual,language_racial,language_childish,profanity_captions}/<leaf>`. `srt-mutes` emits `language/{profanity,blasphemy,other_racial,other_childish}/<leaf>` (`:1068-1071`). `bad-words.yml` defines groups `profanity\|blasphemy\|vulgarity\|racial\|childish` and says they become `language/<group>/<leaf>`. The family profile maps all of `language` to mute, so none of this changes what plays today. |
| "Authoring in progress" / admin authoring UI | **None exists.** Review tooling is `cli/player-review.cli.mjs` (drives the player to a cue with `?goto`, then screenshots it) plus `frontend/src/lib/Player/reviewParams.js`. There is no review queue, no admin route and no API write path (`backend/src/4_api/v1/routers/contentFilter.mjs` is GET only). |
| Where applied | `GET /api/v1/content-filter/{ratingKey}` → `useContentFilter` → `resolveEffectiveCues`. Wiring is at `backend/src/app.mjs:2370-2380`. |

Other facts this plan depends on:

- `parseSrt` (`cli/contentfilter.cli.mjs:543-566`) lowercases and strips tags. `srt-mutes` tokenises on whitespace, normalises each token to `[a-z]` only, places word *i* at `min(line.start + i*0.33, line.end)`, dedups on `round(t*2)`, and gives each cue the id `srt${round(t*1000)}` (`:1095-1128`). If a line's end timestamp fails to parse, `line.end` is `null` and `Math.min(x, null)` gives `0`. Existing bug: that cue would land at t=0 with id `srt0`.
- `srt-mutes --write` replaces all `source: srt` addCues in `household/content-filter/overrides/{rk}.yml` (`:1134-1141`). Only one override exists today (68 SRT cues). Because cue ids are deterministic, a `cueOverrides.srtNNN.disabled` entry keeps working after a re-run.
- The CLI runs `main()` at import (`:1320`), so it cannot be unit-tested. The logic under test has to live in backend modules.
- CLI loggers made with `createLogger` fall back to plain `[LEVEL] event {json}` lines on stdout/stderr, because the dispatcher is not initialised (`backend/src/0_system/logging/logger.mjs:35-44`). **CLI events do not reach the log store.** The review file is the durable record.
- `cli/_bootstrap.mjs` provides `getConfigService()` (requires `DAYLIGHT_BASE_PATH`). No factory builds a decision gateway yet. `app.mjs:708-716` builds `JevAdapter` from `configService.getSystemAuth('jev','api_key')`. The CLI will mirror that.
- `scripts/audit-layer-imports.mjs:25-34` `DOMAIN_LEVELS` has no `content-filter` entry. An unlisted domain is skipped by the hierarchy rule rather than failed (`:388`), so add it to keep the new domain governed.
- Not verified: whether the deploy tree on `{env.prod_host}` is ahead of `main` for these files (SSH to it failed from this session). **Task 0 checks this.**

## Questions for Jev

One `evaluate` call per word hit. Both questions judge the same state.

**State** (plain object, English, well under the 32k limit):

```js
{
  title: 'Back to the Future',           // Plex title, '' when unknown
  word: 'hell',                          // the normalised token the word list matched
  line: 'what the hell is going on here', // the subtitle line (lowercased, tags stripped)
  before: 'doc? doc!',                   // previous subtitle line, '' at start
  after: 'marty, you made it',           // next subtitle line, '' at end
}
```

**Questions** (built in `SubtitleCueReview.questions(groups)`, where `groups` is the distinct `group` values of `bad-words.yml`, in file order):

```js
import { choice, score } from '#apps/common/ports/IDecisionGateway.mjs';

{
  use: choice(
    'The word `word` was flagged in the subtitle `line`. `before` and `after` are the neighbouring subtitle lines, given only for context. How is `word` used in `line`?',
    {
      profanity: 'Swearing or cursing',
      blasphemy: "God's, Jesus's or Christ's name used as an exclamation or a curse",
      vulgarity: 'Crude sexual or bodily language',
      racial: 'A slur against a race or ethnicity',
      childish: 'Mild name-calling or a playground insult',
      none: 'Not offensive here: the plain, innocent meaning (an animal, a place, a prayer, a ghost, a tool)',
    }),
  severity: score(
    'How offensive is `word`, as used in `line`, for a child to hear?',
    [
      'Mild: a parent might let it pass for a young child',
      'Moderate: ordinary swearing a parent would want muted',
      'Severe: a strong curse, a slur, or crude sexual language',
    ]),
}
```

The severity levels are the doc's `low | medium | high`, index 0..2. The word list's own severity comes from `tier`, which is the most permissive setting that still filters the word: `tolerant → high`, `moderate → medium`, `strict → low`. A missing tier counts as `medium`.

**How answers become review items.** An item always carries the word-list cue unchanged. Jev's answers only add reasons:

| Reason | When |
|---|---|
| `not-offensive` | `use.choice === 'none'`. This is the only case where a grown-up might disable a cue. |
| `category-differs` | Jev picked a group other than the word list's group, and not `none` |
| `severity-differs` | `SEVERITY_LEVELS[round(severity.score)]` ≠ tier-derived severity |
| `low-confidence` | `use.confidence < minConfidence` (default 0.7) |
| `model-failed` | `evaluate` threw (timeout, HTTP error) |
| `model-unavailable` | No gateway is configured |

`status` is `agree` when there are no reasons. Otherwise it is `review`.

## Rollout

Nothing decides this today, so there is nothing to shadow. `srt-mutes` mutes every listed word unconditionally. This is a **new capability gated behind human review**:

1. **Slice 1 (this plan):** `srt-review` writes `household/content-filter/review/{ratingKey}.yml`. Each item has `decision: null` for a grown-up to fill in (`keep` or `disable`). To act on a `disable`, the grown-up adds `cueOverrides: { <cueId>: { disabled: true } }` to the title's override. That plumbing already exists in the resolver. The command never writes the override.
2. **Measure:** the `content-filter.cue-review.summary` event (stdout from the CLI) gives per-title counts. Agreement is measured from the review files: over items where `decision` is filled in, a Jev `none` should match a grown-up `disable`, and anything else should match `keep`.
3. **Promote criteria (for slice 2, not built here):** after at least 10 titles and 300 decided items, if `none` has precision ≥ 0.95 against grown-up `disable` **and** no `racial`-group hit was ever marked `none` by Jev with confidence ≥ minConfidence, then an `apply` step may pre-fill `decision` (still shown to the grown-up, never applied silently). Racial slurs stay review-only whatever the numbers say, because leaking a slur is far worse than over-muting (see the `spook` comment in `bad-words.yml`).
4. **Later (out of scope):** an admin review screen that reads the review file and writes `cueOverrides`, an `srt-review apply` command, `phrases:` matching, and asking Jev about unflagged neighbouring lines (the "add a missed cue" direction).

---

## Task 0: Worktree and sync check

**Step 1: Sync with the deployed tree (per `CLAUDE.local.md`)**

```bash
cd "$(git rev-parse --show-toplevel)"
git fetch origin && git log --oneline origin/main..HEAD
ssh {env.prod_host} 'cd <deploy-tree> && git branch --show-current && git log --oneline origin/main..HEAD -- cli/contentfilter.cli.mjs backend/src/3_applications/content-filter | head'
```

If the deploy tree has unpushed commits touching those paths, integrate them before branching.

**Step 2: Create the worktree**

```bash
git worktree add .worktrees/content-filter-cues -b feat/content-filter-cues main
cd .worktrees/content-filter-cues
```

All following paths are relative to the worktree root.

---

## Task 1: Domain module — SRT parsing and compiled word list

**Files:**
- Create: `backend/src/2_domains/content-filter/subtitleWords.mjs`
- Test: `backend/src/2_domains/content-filter/subtitleWords.test.mjs`
- Modify: `scripts/audit-layer-imports.mjs:28` (add `'content-filter': 2` to `DOMAIN_LEVELS`)

**Step 1: Write the failing test**

```js
// backend/src/2_domains/content-filter/subtitleWords.test.mjs
import { describe, expect, it } from 'vitest';
import { SEVERITY_LEVELS, compileWordList, parseSrt } from './subtitleWords.mjs';

const SRT = `1
00:00:01,000 --> 00:00:03,500
<i>What the HELL</i>
is going on?

2
00:00:04,000 --> 00:00:05,000
Doc!
`;

describe('parseSrt', () => {
  it('parses blocks into lowercased, tag-stripped, single-line text with second timings', () => {
    expect(parseSrt(SRT)).toEqual([
      { start: 1, end: 3.5, text: 'what the hell is going on?' },
      { start: 4, end: 5, text: 'doc!' },
    ]);
  });
  it('accepts CRLF and a dot millisecond separator, skips blocks without a timing line', () => {
    const text = 'junk\r\n\r\n1\r\n00:01:02.250 --> 00:01:03.000\r\nHi\r\n';
    expect(parseSrt(text)).toEqual([{ start: 62.25, end: 63, text: 'hi' }]);
  });
});

describe('compileWordList', () => {
  const doc = {
    meta: { source: 'test' },
    words: {
      hell: { group: 'profanity', tier: 'strict', forms: ['hell', 'hells'] },
      fuck: { group: 'profanity', tier: 'tolerant', forms: ['fuck', 'fucking'] },
      god: { group: 'blasphemy', tier: 'moderate' },
      spook: { group: 'racial', tier: 'tolerant', forms: ['spook'] },
      orphan: { tier: 'strict', forms: ['orphan'] },
    },
    phrases: [{ match: 'oh my god', group: 'blasphemy' }],
  };

  it('maps every form to its leaf and the tier to a severity', () => {
    const list = compileWordList(doc);
    expect(list.byForm.get('hells')).toBe('hell');
    expect(list.byForm.get('fucking')).toBe('fuck');
    expect(list.leaves.hell).toEqual({ group: 'profanity', tier: 'strict', severity: 'low' });
    expect(list.leaves.fuck.severity).toBe('high');
    expect(list.leaves.god.severity).toBe('medium');
  });
  it('uses the leaf itself when forms are missing and skips leaves without a group', () => {
    const list = compileWordList(doc);
    expect(list.byForm.get('god')).toBe('god');
    expect(list.byForm.has('orphan')).toBe(false);
  });
  it('lists distinct groups in file order', () => {
    expect(compileWordList(doc).groups).toEqual(['profanity', 'blasphemy', 'racial']);
  });
  it('rejects a document with no words map', () => {
    expect(() => compileWordList({})).toThrow(/words/);
  });
  it('exposes the severity scale lowest first', () => {
    expect(SEVERITY_LEVELS).toEqual(['low', 'medium', 'high']);
  });
});
```

**Step 2: Run it**

```bash
npx vitest run backend/src/2_domains/content-filter/subtitleWords.test.mjs
```

Expected: FAIL, `Failed to resolve import "./subtitleWords.mjs"`.

**Step 3: Minimal implementation**

```js
// backend/src/2_domains/content-filter/subtitleWords.mjs
/**
 * Subtitle word matching for the content filter.
 *
 * Pure rules shared by every SRT producer (`srt-mutes`, `srt-review`): parse
 * an SRT, compile the household word list (`bad-words.yml` shape), find the
 * listed words in subtitle lines, and turn a hit into the mute cue the
 * override stores. One matcher means one cue id per spoken word, so a
 * grown-up's `cueOverrides.<id>` survives a re-import.
 */

/** Severity scale of the filter EDL, lowest first. */
export const SEVERITY_LEVELS = Object.freeze(['low', 'medium', 'high']);

/**
 * Word-list tier -> cue severity. A tier names the most permissive setting at
 * which the word is still filtered, so "tolerant" words are the harshest.
 */
export const TIER_SEVERITY = Object.freeze({ tolerant: 'high', moderate: 'medium', strict: 'low' });

const srtTimeToSec = (t) => {
  const m = String(t || '').trim().match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
  if (!m) return null;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
};

/** Parse an SRT string into [{ start, end, text }] (tags stripped, lowercased). */
export function parseSrt(text) {
  const blocks = String(text || '').replace(/\r\n/g, '\n').split(/\n\s*\n/);
  const out = [];
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim() !== '');
    const tline = lines.find((l) => l.includes('-->'));
    if (!tline) continue;
    const [a, c] = tline.split('-->');
    const start = srtTimeToSec(a);
    const end = srtTimeToSec(c);
    if (start == null) continue;
    const body = lines.slice(lines.indexOf(tline) + 1).join(' ')
      .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').toLowerCase().trim();
    out.push({ start, end, text: body });
  }
  return out;
}

/**
 * Compile a `bad-words.yml` document into lookup tables.
 * Later leaves win when two leaves claim the same form.
 * @returns {{ byForm: Map<string,string>, leaves: Object<string,{group,tier,severity}>, groups: string[] }}
 */
export function compileWordList(doc) {
  const words = doc?.words;
  if (!words || typeof words !== 'object') throw new Error('word list has no `words` map');
  const byForm = new Map();
  const leaves = {};
  for (const [leaf, def] of Object.entries(words)) {
    const group = def?.group;
    if (!group) continue;
    leaves[leaf] = { group, tier: def.tier ?? null, severity: TIER_SEVERITY[def.tier] ?? 'medium' };
    const forms = Array.isArray(def.forms) && def.forms.length ? def.forms : [leaf];
    for (const form of forms) byForm.set(String(form).toLowerCase(), leaf);
  }
  const groups = [...new Set(Object.values(leaves).map((l) => l.group))];
  return { byForm, leaves, groups };
}
```

Then register the domain level. In `scripts/audit-layer-imports.mjs`, the level-2 line `ambient: 2, art: 2, automotive: 2, barcode: 2, camera: 2, concierge: 2, cost: 2,` becomes:

```js
  ambient: 2, art: 2, automotive: 2, barcode: 2, camera: 2, concierge: 2, 'content-filter': 2, cost: 2,
```

**Step 4: Run it**

```bash
npx vitest run backend/src/2_domains/content-filter/subtitleWords.test.mjs && npm run audit:layers
```

Expected: 7 tests pass, and the audit reports no new violations.

**Step 5: Commit**

```bash
git add backend/src/2_domains/content-filter/ scripts/audit-layer-imports.mjs
git commit -m "feat(content-filter): pure SRT parser + compiled word list domain module

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Domain module — word hits, mute cues, line context

**Files:**
- Modify: `backend/src/2_domains/content-filter/subtitleWords.mjs` (append)
- Test: `backend/src/2_domains/content-filter/subtitleWords.test.mjs` (append)

The expected values below are worked out by hand from the current `srt-mutes` algorithm (`cli/contentfilter.cli.mjs:1095-1128`). This test is the characterization that keeps cue ids stable.

**Step 1: Write the failing test** (append)

```js
import { findWordHits, hitToMuteCue, lineContext } from './subtitleWords.mjs';

describe('findWordHits', () => {
  const list = compileWordList({ words: {
    hell: { group: 'profanity', tier: 'strict', forms: ['hell'] },
    damn: { group: 'profanity', tier: 'strict', forms: ['damn'] },
    god: { group: 'blasphemy', tier: 'moderate', forms: ['god', 'gods'] },
  } });

  it('matches whole normalised tokens only (no Scunthorpe)', () => {
    const lines = [{ start: 10, end: 12, text: 'hello shell hell-o' }];
    expect(findWordHits(lines, list)).toEqual([]);
  });
  it('places word i at start + i*0.33, capped at the line end, with the srt-mutes id', () => {
    const lines = [{ start: 10, end: 10.5, text: 'oh my god, what the hell' }];
    const hits = findWordHits(lines, list);
    // god is token 2 -> 10.66, capped to 10.5; hell is token 5 -> 11.65, capped to 10.5 -> same 0.5s key, deduped
    expect(hits).toEqual([{
      cueId: 'srt10500', lineIndex: 0, token: 'god', leaf: 'god', group: 'blasphemy',
      category: 'language/blasphemy/god', severity: 'medium', in: 10.5, out: 10.55,
    }]);
  });
  it('emits one hit per word when they are far enough apart, across lines', () => {
    const lines = [
      { start: 100, end: 104, text: 'god damn it' },
      { start: 200, end: 202, text: "gods, that's hell" },
    ];
    expect(findWordHits(lines, list).map((h) => [h.cueId, h.lineIndex, h.token, h.in])).toEqual([
      ['srt100000', 0, 'god', 100],
      ['srt100330', 0, 'damn', 100.33],
      ['srt200000', 1, 'gods', 200],
      ['srt200660', 1, 'hell', 200.66],
    ]);
  });
  it('does not collapse a word to t=0 when the end timestamp is unparseable', () => {
    const hits = findWordHits([{ start: 50, end: null, text: 'x hell' }], list);
    expect(hits[0].in).toBe(50.33);
  });
});

describe('hitToMuteCue', () => {
  it('builds the override addCue srt-mutes stores, now with severity and channel', () => {
    const hit = { cueId: 'srt100330', lineIndex: 0, token: 'damn', leaf: 'damn', group: 'profanity',
      category: 'language/profanity/damn', severity: 'low', in: 100.33, out: 100.38 };
    expect(hitToMuteCue(hit)).toEqual({
      id: 'srt100330', effect: 'mute', category: 'language/profanity/damn', channel: 'audio',
      severity: 'low', in: 100.33, out: 100.38, label: 'damn', source: 'srt', precision: 'srt-line',
    });
  });
});

describe('lineContext', () => {
  const lines = [{ text: 'a' }, { text: 'b' }, { text: 'c' }];
  it('returns the line and its neighbours', () => {
    expect(lineContext(lines, 1)).toEqual({ line: 'b', before: 'a', after: 'c' });
  });
  it('uses empty strings at the edges', () => {
    expect(lineContext(lines, 0)).toEqual({ line: 'a', before: '', after: 'b' });
    expect(lineContext(lines, 2)).toEqual({ line: 'c', before: 'b', after: '' });
  });
});
```

**Step 2: Run it**

```bash
npx vitest run backend/src/2_domains/content-filter/subtitleWords.test.mjs
```

Expected: FAIL, `findWordHits is not a function` (the import resolves to undefined).

**Step 3: Minimal implementation** (append to `subtitleWords.mjs`)

```js
/** Speech-rate estimate: a caption's START tracks speech onset, its END does not. */
const SECS_PER_WORD = 0.33;

const normToken = (tok) => tok.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Find listed words in parsed SRT lines. Word i of a line is placed at
 * start + i*0.33s, never past the caption end; hits within ~0.5s of an
 * earlier hit are dropped. Ids are `srt<ms>`, the same ids srt-mutes has
 * always written, so overrides keyed on them keep working.
 */
export function findWordHits(lines, wordList) {
  const hits = [];
  const seen = new Set();
  lines.forEach((line, lineIndex) => {
    const cap = Number.isFinite(line.end) ? line.end : Infinity;
    String(line.text || '').split(/\s+/).filter(Boolean).forEach((tok, i) => {
      const token = normToken(tok);
      const leaf = wordList.byForm.get(token);
      if (!leaf) return;
      const t = Math.min(line.start + i * SECS_PER_WORD, cap);
      const key = Math.round(t * 2);
      if (seen.has(key)) return;
      seen.add(key);
      const { group, severity } = wordList.leaves[leaf];
      hits.push({
        cueId: `srt${Math.round(t * 1000)}`, lineIndex, token, leaf, group,
        category: `language/${group}/${leaf}`, severity,
        in: Number(t.toFixed(2)), out: Number((t + 0.05).toFixed(2)),
      });
    });
  });
  return hits;
}

/** The local-time mute addCue for one hit (the resolver widens the point). */
export function hitToMuteCue(hit) {
  return {
    id: hit.cueId, effect: 'mute', category: hit.category, channel: 'audio', severity: hit.severity,
    in: hit.in, out: hit.out, label: hit.leaf, source: 'srt', precision: 'srt-line',
  };
}

/** A subtitle line with its neighbours, for judging a word in context. */
export function lineContext(lines, index) {
  return {
    line: lines[index]?.text ?? '',
    before: lines[index - 1]?.text ?? '',
    after: lines[index + 1]?.text ?? '',
  };
}
```

**Step 4: Run it**

```bash
npx vitest run backend/src/2_domains/content-filter/subtitleWords.test.mjs
```

Expected: 14 tests pass.

**Step 5: Commit**

```bash
git add backend/src/2_domains/content-filter/
git commit -m "feat(content-filter): word hits and srt mute cues as pure domain rules

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Application service — `SubtitleCueReview`

**Files:**
- Create: `backend/src/3_applications/content-filter/SubtitleCueReview.mjs`
- Test: `backend/src/3_applications/content-filter/SubtitleCueReview.test.mjs`

**Step 1: Write the failing test**

```js
// backend/src/3_applications/content-filter/SubtitleCueReview.test.mjs
import { describe, expect, it, vi } from 'vitest';
import { SubtitleCueReview } from './SubtitleCueReview.mjs';

const lines = [
  { start: 1, end: 2, text: 'the sermon is about' },
  { start: 3, end: 5, text: 'hell and how to avoid it' },
  { start: 6, end: 7, text: 'amen' },
];
const hit = (over = {}) => ({
  cueId: 'srt3000', lineIndex: 1, token: 'hell', leaf: 'hell', group: 'profanity',
  category: 'language/profanity/hell', severity: 'low', in: 3, out: 3.05, ...over,
});
const groups = ['profanity', 'blasphemy', 'racial'];
const answers = ({ choice = 'profanity', confidence = 0.9, score = 0, sevConfidence = 0.8 } = {}) => ({
  model: 'jev-test-1',
  answers: {
    use: { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } },
    severity: { type: 'score', score, confidence: sevConfidence, probabilities: [1, 0, 0] },
  },
  usage: { inputTokens: 10, outputTokens: null },
});
const quietLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });
const gateway = (impl) => ({ isConfigured: () => true, evaluate: vi.fn(impl) });

describe('SubtitleCueReview', () => {
  it('asks one choice over the word-list groups + none and one severity score, about the line in context', async () => {
    const g = gateway(async () => answers());
    const review = new SubtitleCueReview({ decisionGateway: g, logger: quietLogger() });
    await review.review({ title: 'Sermon', lines, hits: [hit()], groups });
    const [state, questions, options] = g.evaluate.mock.calls[0];
    expect(state).toEqual({ title: 'Sermon', word: 'hell', line: 'hell and how to avoid it', before: 'the sermon is about', after: 'amen' });
    expect(questions.use.type).toBe('choice');
    expect(Object.keys(questions.use.options)).toEqual(['profanity', 'blasphemy', 'racial', 'none']);
    expect(questions.severity.type).toBe('score');
    expect(questions.severity.levels).toHaveLength(3);
    expect(options).toEqual({ timeout: 5000 });
  });

  it('agrees when Jev matches the word list, keeping the word-list cue unchanged', async () => {
    const review = new SubtitleCueReview({ decisionGateway: gateway(async () => answers()), logger: quietLogger() });
    const { items, summary, model } = await review.review({ lines, hits: [hit()], groups });
    expect(model).toBe('jev-test-1');
    expect(items[0]).toMatchObject({
      cueId: 'srt3000', at: 3, word: 'hell', category: 'language/profanity/hell', severity: 'low',
      status: 'agree', reasons: [], decision: null,
      jev: { category: 'profanity', categoryConfidence: 0.9, severity: 'low', severityScore: 0, severityConfidence: 0.8 },
    });
    expect(summary).toMatchObject({ cues: 1, agree: 1, review: 0 });
  });

  it('flags an innocent use for a grown-up and never drops the cue', async () => {
    const review = new SubtitleCueReview({ decisionGateway: gateway(async () => answers({ choice: 'none' })), logger: quietLogger() });
    const hits = [hit()];
    const before = structuredClone(hits);
    const { items, summary } = await review.review({ lines, hits, groups });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ category: 'language/profanity/hell', status: 'review', reasons: ['not-offensive'] });
    expect(summary.notOffensive).toBe(1);
    expect(hits).toEqual(before);
  });

  it('flags category, severity and confidence disagreements', async () => {
    const review = new SubtitleCueReview({
      decisionGateway: gateway(async () => answers({ choice: 'blasphemy', confidence: 0.5, score: 1.8 })),
      logger: quietLogger(),
    });
    const { items } = await review.review({ lines, hits: [hit()], groups });
    expect(items[0].jev.severity).toBe('high');
    expect(items[0].reasons).toEqual(['category-differs', 'severity-differs', 'low-confidence']);
  });

  it('honours minConfidence', async () => {
    const review = new SubtitleCueReview({ decisionGateway: gateway(async () => answers({ confidence: 0.6 })), minConfidence: 0.5, logger: quietLogger() });
    const { items } = await review.review({ lines, hits: [hit()], groups });
    expect(items[0].status).toBe('agree');
  });

  it('a failed evaluation marks that item and the rest still run', async () => {
    const logger = quietLogger();
    let n = 0;
    const g = gateway(async () => { n += 1; if (n === 1) throw new Error('timeout'); return answers(); });
    const review = new SubtitleCueReview({ decisionGateway: g, concurrency: 1, logger });
    const { items, summary } = await review.review({ lines, hits: [hit(), hit({ cueId: 'srt3330', in: 3.33 })], groups });
    expect(items.map((i) => i.reasons)).toEqual([['model-failed'], []]);
    expect(items[0].jev).toBeNull();
    expect(summary).toMatchObject({ failed: 1, agree: 1 });
    expect(logger.warn).toHaveBeenCalledWith('content-filter.cue-review.failed', expect.objectContaining({ cueId: 'srt3000', error: 'timeout' }));
  });

  it('with no configured gateway, lists every word-list cue for review without calling anything', async () => {
    for (const decisionGateway of [null, { isConfigured: () => false, evaluate: vi.fn() }]) {
      const review = new SubtitleCueReview({ decisionGateway, logger: quietLogger() });
      const { items, model } = await review.review({ lines, hits: [hit()], groups });
      expect(model).toBeNull();
      expect(items[0]).toMatchObject({ status: 'review', reasons: ['model-unavailable'], jev: null, category: 'language/profanity/hell' });
      if (decisionGateway) expect(decisionGateway.evaluate).not.toHaveBeenCalled();
    }
  });

  it('never runs more than `concurrency` evaluations at once and keeps hit order', async () => {
    let inFlight = 0; let peak = 0;
    const g = gateway(async () => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return answers();
    });
    const hits = Array.from({ length: 9 }, (_, i) => hit({ cueId: `srt${i}` }));
    const review = new SubtitleCueReview({ decisionGateway: g, concurrency: 3, logger: quietLogger() });
    const { items } = await review.review({ lines, hits, groups });
    expect(peak).toBe(3);
    expect(items.map((i) => i.cueId)).toEqual(hits.map((h) => h.cueId));
  });

  it('logs a summary event', async () => {
    const logger = quietLogger();
    const review = new SubtitleCueReview({ decisionGateway: gateway(async () => answers()), logger });
    await review.review({ contentId: 'plex:1', lines, hits: [hit()], groups });
    expect(logger.info).toHaveBeenCalledWith('content-filter.cue-review.summary',
      expect.objectContaining({ contentId: 'plex:1', model: 'jev-test-1', cues: 1, agree: 1 }));
  });
});
```

**Step 2: Run it**

```bash
npx vitest run backend/src/3_applications/content-filter/SubtitleCueReview.test.mjs
```

Expected: FAIL, `Failed to resolve import "./SubtitleCueReview.mjs"`.

**Step 3: Minimal implementation**

```js
// backend/src/3_applications/content-filter/SubtitleCueReview.mjs
/**
 * SubtitleCueReview: a second opinion on subtitle word-list mute cues, for a grown-up.
 *
 * The word list (srt-mutes) decides what is muted, and it mutes every listed word.
 * This service asks a typed-decision model (IDecisionGateway, e.g. Jev) how
 * each flagged word is used in its line (with the lines either side for
 * context) and how offensive it is. It never adds, removes or edits a cue.
 * Its output is a review queue: the word-list cue exactly as emitted, plus the
 * model's category/severity/confidence and the reasons a grown-up should look.
 *
 * Offline and batch: bounded concurrency, and any failure marks that one item.
 * No gateway means every item is listed for review, unjudged.
 */
import { choice, score } from '#apps/common/ports/IDecisionGateway.mjs';
import { SEVERITY_LEVELS, lineContext } from '#domains/content-filter/subtitleWords.mjs';

const NONE = 'none';

const GROUP_DESCRIPTIONS = Object.freeze({
  profanity: 'Swearing or cursing',
  blasphemy: "God's, Jesus's or Christ's name used as an exclamation or a curse",
  vulgarity: 'Crude sexual or bodily language',
  racial: 'A slur against a race or ethnicity',
  childish: 'Mild name-calling or a playground insult',
});
const NONE_DESCRIPTION = 'Not offensive here: the plain, innocent meaning (an animal, a place, a prayer, a ghost, a tool)';

const USE_INSTRUCTIONS = 'The word `word` was flagged in the subtitle `line`. `before` and `after` are the '
  + 'neighbouring subtitle lines, given only for context. How is `word` used in `line`?';
const SEVERITY_INSTRUCTIONS = 'How offensive is `word`, as used in `line`, for a child to hear?';
/** Rubric for SEVERITY_LEVELS, same order (low, medium, high). */
const SEVERITY_RUBRIC = Object.freeze([
  'Mild: a parent might let it pass for a young child',
  'Moderate: ordinary swearing a parent would want muted',
  'Severe: a strong curse, a slur, or crude sexual language',
]);

const REASONS = Object.freeze({
  notOffensive: 'not-offensive', categoryDiffers: 'category-differs', severityDiffers: 'severity-differs',
  lowConfidence: 'low-confidence', failed: 'model-failed', unavailable: 'model-unavailable',
});

const round3 = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null);

export class SubtitleCueReview {
  #gateway; #logger; #concurrency; #minConfidence; #timeoutMs;

  /**
   * @param {Object} deps
   * @param {Object} [deps.decisionGateway] - IDecisionGateway; absent or unconfigured = review everything unjudged
   * @param {number} [deps.concurrency=4] - Max evaluations in flight
   * @param {number} [deps.minConfidence=0.7] - Category confidence below this is flagged
   * @param {number} [deps.timeoutMs=5000]
   * @param {Object} [deps.logger]
   */
  constructor({ decisionGateway = null, concurrency = 4, minConfidence = 0.7, timeoutMs = 5000, logger = console } = {}) {
    this.#gateway = decisionGateway?.isConfigured?.() === false ? null : decisionGateway;
    this.#concurrency = Math.max(1, Math.floor(Number(concurrency)) || 1);
    this.#minConfidence = Number.isFinite(minConfidence) ? minConfidence : 0.7;
    this.#timeoutMs = timeoutMs;
    this.#logger = logger;
  }

  /** The two questions, over the word list's own groups plus `none`. */
  static questions(groups) {
    const options = Object.fromEntries(groups.map((g) => [g, GROUP_DESCRIPTIONS[g] ?? null]));
    options[NONE] = NONE_DESCRIPTION;
    return {
      use: choice(USE_INSTRUCTIONS, options),
      severity: score(SEVERITY_INSTRUCTIONS, [...SEVERITY_RUBRIC]),
    };
  }

  /**
   * @param {{ contentId?: string, title?: string, lines: Object[], hits: Object[], groups: string[] }} input
   * @returns {Promise<{ model: string|null, items: Object[], summary: Object }>}
   */
  async review({ contentId = null, title = null, lines, hits, groups }) {
    const startedAt = Date.now();
    const questions = this.#gateway ? SubtitleCueReview.questions(groups) : null;
    let model = null;
    const items = await mapBounded(hits, this.#concurrency, async (hit) => {
      const { item, model: answeredBy } = await this.#reviewHit(hit, lines, questions, { contentId, title });
      model = model ?? answeredBy;
      return item;
    });
    const summary = summarize(items);
    this.#logger.info?.('content-filter.cue-review.summary', { contentId, model, ms: Date.now() - startedAt, ...summary });
    return { model, items, summary };
  }

  async #reviewHit(hit, lines, questions, { contentId, title }) {
    const context = lineContext(lines, hit.lineIndex);
    const item = {
      cueId: hit.cueId, at: hit.in, word: hit.token, category: hit.category, severity: hit.severity,
      ...context, jev: null, status: 'review', reasons: [], decision: null,
    };
    if (!questions) {
      item.reasons.push(REASONS.unavailable);
      return { item, model: null };
    }
    const startedAt = Date.now();
    try {
      const result = await this.#gateway.evaluate({ title: title ?? '', word: hit.token, ...context }, questions,
        { timeout: this.#timeoutMs });
      const use = result.answers.use;
      const sev = result.answers.severity;
      const level = Math.min(SEVERITY_LEVELS.length - 1, Math.max(0, Math.round(sev.score)));
      item.jev = {
        category: use.choice, categoryConfidence: round3(use.confidence),
        severity: SEVERITY_LEVELS[level], severityScore: round3(sev.score), severityConfidence: round3(sev.confidence),
      };
      item.reasons = reasonsFor(hit, item.jev, this.#minConfidence);
      item.status = item.reasons.length ? 'review' : 'agree';
      this.#logger.debug?.('content-filter.cue-review.item', {
        contentId, cueId: hit.cueId, word: hit.token, listGroup: hit.group, listSeverity: hit.severity,
        ...item.jev, status: item.status, reasons: item.reasons, model: result.model, ms: Date.now() - startedAt,
      });
      return { item, model: result.model ?? null };
    } catch (error) {
      item.reasons.push(REASONS.failed);
      this.#logger.warn?.('content-filter.cue-review.failed', { contentId, cueId: hit.cueId, error: error.message, ms: Date.now() - startedAt });
      return { item, model: null };
    }
  }
}

function reasonsFor(hit, jev, minConfidence) {
  const reasons = [];
  if (jev.category === NONE) reasons.push(REASONS.notOffensive);
  else if (jev.category !== hit.group) reasons.push(REASONS.categoryDiffers);
  if (jev.severity !== hit.severity) reasons.push(REASONS.severityDiffers);
  if ((jev.categoryConfidence ?? 0) < minConfidence) reasons.push(REASONS.lowConfidence);
  return reasons;
}

function summarize(items) {
  const count = (pred) => items.filter(pred).length;
  const withReason = (r) => count((i) => i.reasons.includes(r));
  return {
    cues: items.length,
    agree: count((i) => i.status === 'agree'),
    review: count((i) => i.status === 'review'),
    notOffensive: withReason(REASONS.notOffensive),
    categoryDiffers: withReason(REASONS.categoryDiffers),
    severityDiffers: withReason(REASONS.severityDiffers),
    lowConfidence: withReason(REASONS.lowConfidence),
    failed: withReason(REASONS.failed),
    unavailable: withReason(REASONS.unavailable),
  };
}

/** Map with at most `limit` calls in flight; results keep input order. */
async function mapBounded(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export default SubtitleCueReview;
```

**Step 4: Run it**

```bash
npx vitest run backend/src/3_applications/content-filter/SubtitleCueReview.test.mjs && npm run audit:layers
```

Expected: 9 tests pass, and the audit is clean. The app imports only a port and a domain module.

**Step 5: Commit**

```bash
git add backend/src/3_applications/content-filter/SubtitleCueReview.mjs backend/src/3_applications/content-filter/SubtitleCueReview.test.mjs
git commit -m "feat(content-filter): Jev review queue for subtitle word-list cues (never edits cues)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: CLI bootstrap — optional decision gateway factory

**Files:**
- Modify: `cli/_bootstrap.mjs` (imports at lines 13-22; new factory appended after `getHttpClient`, around line 101)

A CLI is its own composition root, so it is allowed to build the adapter (`scripts/audit-layer-imports.mjs:206-209`). This mirrors `backend/src/app.mjs:708-716`. The factory is glue with no branching beyond the null key check, so it has no unit test. It is exercised in Task 5, Step 4.

**Step 1: Add the factory**

Add to the imports:

```js
import axios from 'axios';
import { JevAdapter } from '#adapters/ai/JevAdapter.mjs';
```

Add the module cache var next to the others:

```js
let _decisionGateway;
```

Append after `getHttpClient()`:

```js
/**
 * The typed-decision model (IDecisionGateway, Jev), or null when
 * system/auth/jev.yml has no api_key. Callers must treat null as
 * "no model" and keep their non-model behaviour.
 *
 * @param {{ logger?: Object }} [opts]
 * @returns {Promise<import('#apps/common/ports/IDecisionGateway.mjs').IDecisionGateway|null>}
 */
export async function getDecisionGateway({ logger } = {}) {
  if (_decisionGateway !== undefined) return _decisionGateway;
  const configService = await getConfigService();
  const apiKey = configService.getSystemAuth?.('jev', 'api_key');
  _decisionGateway = apiKey ? new JevAdapter({ apiKey }, { httpClient: axios, logger }) : null;
  return _decisionGateway;
}
```

**Step 2: Smoke check that it resolves**

```bash
node -e "import('./cli/_bootstrap.mjs').then(async (m) => { const g = await m.getDecisionGateway(); console.log('configured:', !!g?.isConfigured?.()); })"
```

Expected: `configured: true` on a machine whose data tree has `system/auth/jev.yml`, otherwise `configured: false`. It should not throw.

**Step 3: Commit**

```bash
git add cli/_bootstrap.mjs
git commit -m "feat(cli): optional decision-gateway factory in the CLI bootstrap

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: CLI — `srt-mutes` on the shared matcher, and the new `srt-review` command

**Files:**
- Modify: `cli/contentfilter.cli.mjs`
  - imports (lines 44-50): add the domain, app, logger and bootstrap imports
  - lines 543-566: delete the local `srtTimeToSec` and `parseSrt` (the domain exports are identical; `calibrate` at `:917` keeps calling `parseSrt`)
  - lines 713-730: add `--srt`, `--concurrency`, `--min-confidence` to `VALUE_FLAGS`
  - lines 1034-1146 (`srt-mutes`): replace the hard-coded `BAD_WORDS` / `STEM_GROUP` / `FORM_TO_LEAF` / emit loop with the shared matcher over `bad-words.yml`, and extract the SRT fetch
  - after `srt-mutes`: new `srt-review` block
  - `printHelp` (`:1276-1310`): document `srt-review`

This is a **behaviour change to `srt-mutes`**, which now reads `bad-words.yml` as its header already claims. Checked 2026-09-24: every form the old hard-coded list muted is in the YAML, so nothing is un-muted. What changes:
- 19 more leaves are muted (for example `cunt`, `cock`, `piss`, `crap`, `jerk`).
- `goddamn`/`goddammit`/`goddamnit` move from `language/profanity/damn` to `language/blasphemy/goddamn`.
- Racial and childish cues move from `language/other_racial/*` and `language/other_childish/*` to `language/racial/*` and `language/childish/*`.
- Cues gain `severity` and `channel: audio`.

SRT cues carry an explicit `effect: mute`, so the category moves change nothing at playback. Ids come from the same timing and dedup rule. The one exception is a line whose end timestamp does not parse: that word used to collapse to `srt0` and now sits at its real time.

**Step 1: Imports and shared helpers**

At the top, after `import axios from 'axios';`:

```js
import { compileWordList, findWordHits, hitToMuteCue, parseSrt } from '#domains/content-filter/subtitleWords.mjs';
import { SubtitleCueReview } from '#apps/content-filter/SubtitleCueReview.mjs';
import { createLogger } from '#system/logging/logger.mjs';
```

Delete lines 543-566 (`const srtTimeToSec = …` through the end of `function parseSrt`).

Add to `VALUE_FLAGS`:

```js
  '--srt': 'srt', '--concurrency': 'concurrency', '--min-confidence': 'min-confidence',
```

Add these helpers just above `async function main()`:

```js
/** The household word list (bad-words.yml), compiled. Exits if it is missing. */
function loadWordList() {
  const p = path.join(filterCacheDir(), 'bad-words.yml');
  const doc = existsSync(p) ? loadYaml(p) : null;
  if (!doc?.words) { console.error(`No word list at ${p}`); process.exit(1); }
  return { ...compileWordList(doc), source: doc.meta?.source ?? null };
}

/** English SRT for a Plex item, in LOCAL time, or --srt <file> when given. */
async function loadSubtitles(rk) {
  if (flags.srt) return { lines: parseSrt(readFileSync(flags.srt, 'utf8')), title: null };
  const { token, host } = loadPlexConfig();
  const meta = (await axios.get(`${host}/library/metadata/${rk}?X-Plex-Token=${token}`, { headers: { Accept: 'application/json' } })).data?.MediaContainer?.Metadata?.[0];
  const part = meta?.Media?.[0]?.Part?.[0];
  const srtStream = (part?.Stream || []).find((s) => s.streamType === 3 && s.codec === 'srt' && /^en/i.test(s.languageCode || s.language || ''));
  if (!srtStream) { console.error('No English SRT on this Plex item (pass --srt <file>).'); process.exit(1); }
  const srtRaw = (await axios.get(`${host}/library/streams/${srtStream.id}?X-Plex-Token=${token}`, { responseType: 'text' })).data;
  return { lines: parseSrt(srtRaw), title: meta?.title ?? null };
}
```

**Step 2: Rewrite the body of `srt-mutes`**

Keep the argument parsing, the `edlPath` / `override` loading and `--write` block as they are. Replace everything from `const coverWin = …` (`:1047`) through the `console.error(\`SRT profanity words: …\`)` line (`:1130`) with:

```js
    const wordList = loadWordList();
    const { lines: srt } = await loadSubtitles(rk);
    // The SRT is authoritative for WHAT is said and roughly WHEN. Emit a mute for
    // EVERY listed word; overlaps with VidAngel mutes are harmless, a missed word is not.
    const newCues = findWordHits(srt, wordList).map(hitToMuteCue);
    console.error(`SRT listed words: mute cues emitted (deduped): ${newCues.length} (word list: ${wordList.source ?? 'bad-words.yml'})`);
```

The `off` variable and `existingMutes`/`covered` were only used for coverage checks, and nothing reads them any more (verified: the emit loop never calls `covered`; the comment at `:1110-1113` explains why). Delete them with the block. `edl` is then unused, but keep the "No EDL" guard so the command still refuses a title with no filter. Update the usage string at `:1036` to `srt-mutes <plexRatingKey> [--srt file] [--write]`.

**Step 3: Add `srt-review`** (a new block directly after `srt-mutes`)

```js
  if (command === 'srt-review') {
    const rk = String(cmdArgs[0] || '').replace(/[^0-9]/g, '');
    if (!rk) { console.error('Usage: contentfilter srt-review <plexRatingKey> [--srt file] [--out path] [--concurrency 4] [--min-confidence 0.7]'); process.exit(1); }
    if (!process.env.DAYLIGHT_BASE_PATH) process.env.DAYLIGHT_BASE_PATH = path.dirname(resolveDataDir());
    const { getDecisionGateway } = await import('./_bootstrap.mjs');
    const logger = createLogger({ source: 'cli', app: 'content-filter', context: { module: 'cue-review' } });

    const wordList = loadWordList();
    const { lines, title } = await loadSubtitles(rk);
    const hits = findWordHits(lines, wordList);
    const decisionGateway = await getDecisionGateway({ logger: logger.child({ module: 'jev' }) });
    if (!decisionGateway) console.error('No decision model configured: every cue will be listed unjudged.');

    const review = new SubtitleCueReview({
      decisionGateway, logger,
      concurrency: Number(flags.concurrency) || 4,
      minConfidence: flags['min-confidence'] != null ? Number(flags['min-confidence']) : 0.7,
    });
    const contentId = `plex:${rk}`;
    const { model, items, summary } = await review.review({ contentId, title, lines, hits, groups: wordList.groups });

    const outPath = flags.out || path.join(filterCacheDir(), 'review', `${rk}.yml`);
    const doc = {
      contentId, title, generatedAt: new Date().toISOString(), model,
      wordList: wordList.source, summary,
      // A grown-up sets `decision: keep|disable` per item; to act on a disable,
      // add `cueOverrides: { <cueId>: { disabled: true } }` to overrides/<rk>.yml.
      items,
    };
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, yaml.dump(doc, { lineWidth: 140 }));
    console.error(`✓ ${summary.cues} cues: ${summary.agree} agree, ${summary.review} for review (${summary.notOffensive} possibly innocent) -> ${outPath}`);
    return;
  }
```

Add to `printHelp` below `srt-mutes`:

```text
  srt-review <ratingKey> Ask the decision model (Jev) how each word-list cue is used in context and
                        write a review file for a grown-up (household/content-filter/review/<rk>.yml).
                        Never edits cues. --srt <file>, --out, --concurrency 4, --min-confidence 0.7.
```

**Step 4: Verify against real data**

Commands:

```bash
# srt-mutes: the dry run must emit >= the 68 srt cues the existing override holds
node cli/contentfilter.cli.mjs srt-mutes 662170 2>&1 | head -3

# srt-review to a scratch path, not the household tree
node cli/contentfilter.cli.mjs srt-review 662170 --out "$TMPDIR/662170.review.yml"
node -e "const y=require('js-yaml');const d=y.load(require('fs').readFileSync(process.env.TMPDIR+'/662170.review.yml','utf8'));console.log(d.model,d.summary,d.items.filter(i=>i.reasons.includes('not-offensive')).map(i=>[i.cueId,i.word,i.line]))"

# The no-model path (every item model-unavailable) is covered by the Task 3 unit test.
```

Expected results:
- `srt-mutes` reports ≥ 68 cues.
- `srt-review` prints the summary line.
- The review file has `model: jev-…`, a `summary` whose `cues` equals the srt-mutes count, and every `items[].category` matches `language/<group>/<leaf>`.
- Confirm by reading, not assuming: every `cueId` in the review file that is also in `overrides/662170.yml`'s `addCues` names the same word.

**Step 5: Commit**

```bash
git add cli/contentfilter.cli.mjs
git commit -m "feat(contentfilter): srt-review writes a Jev review queue; srt-mutes reads bad-words.yml

srt-mutes now uses the shared domain matcher over household bad-words.yml
(a superset of the old hard-coded list; goddamn forms move to blasphemy;
cues gain severity + channel). srt-review never writes the override.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Docs

**Files:**
- Modify: `docs/reference/core/content-filter.md`
  - L3 status line: say that authoring is CLI-only today and that a subtitle review queue exists
  - L36-40: say `severity` is optional in practice (VidAngel EDLs never carry it; SRT cues now do, derived from the word-list tier) and that the resolver does not read it
  - after "Import sources and synchronization" (around L130): new section "Subtitle word-list cues and review"
- Modify: the header comment of `bad-words.yml` in the household data tree is **not** edited by this plan. Its "CONSUMED BY srt-mutes" claim becomes true with Task 5. `srt-review` is not added to it: that file is household data, and data edits are not part of this code change.

**Step 1: Write the new section** (verbatim)

```markdown
## Subtitle word-list cues and review

`contentfilter srt-mutes <ratingKey>` scans the title's English SRT (Plex, or
`--srt <file>`) for words in `household/content-filter/bad-words.yml` and, with
`--write`, stores one local-time mute per word as `addCues` (`source: srt`,
`precision: srt-line`) in the title's override. The matcher lives in
`backend/src/2_domains/content-filter/subtitleWords.mjs`: whole-word forms only,
word *i* of a line placed at `start + i·0.33 s` (capped at the caption end),
~0.5 s dedup, ids `srt<ms>`. Ids are deterministic, so `cueOverrides` keyed on
them survive a re-run. Category is `language/<group>/<leaf>`; severity comes
from the word's tier (`tolerant → high`, `moderate → medium`, `strict → low`).
SRT cues carry an explicit `effect: mute`, so profiles do not change them —
only `cueOverrides.<id>.disabled` does.

`contentfilter srt-review <ratingKey>` is a second opinion for a grown-up.
For every word hit it asks the typed-decision model (`IDecisionGateway`, Jev)
two questions about the line, with the previous and next subtitle lines as
context: which word-list group the use belongs to, or `none` (an innocent use
such as a place, an animal, a prayer, a ghost), and how severe it is on
`low | medium | high`. It writes `household/content-filter/review/<ratingKey>.yml`
(`--out` to redirect): each item is the word-list cue unchanged plus Jev's
answer, `status: agree | review`, `reasons` (`not-offensive`,
`category-differs`, `severity-differs`, `low-confidence`, `model-failed`,
`model-unavailable`) and `decision: null` for the grown-up. **It never adds,
removes or edits a cue.** To act on a review, add
`cueOverrides: { <cueId>: { disabled: true } }` to the title's override.
With no model configured every item is listed as `model-unavailable`.

Run offline; concurrency defaults to 4 (`--concurrency`), the confidence floor
to 0.7 (`--min-confidence`). The CLI's `content-filter.cue-review.summary` /
`.item` / `.failed` events print to the terminal and do not reach the log
store; the review file is the record. There is no review UI yet; the next
slice is an admin screen that reads the review file and writes `cueOverrides`.
```

**Step 2: Link the plan from the refactor/plan index if one exists for Jev work, then commit**

```bash
git add docs/reference/core/content-filter.md
git commit -m "docs(content-filter): subtitle word-list cues and the Jev review queue

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Full suite for touched dirs

**Step 1: Run**

```bash
npx vitest run backend/src/2_domains/content-filter backend/src/3_applications/content-filter backend/src/3_applications/common/ports backend/src/1_adapters/ai frontend/src/lib/Player/contentFilter.test.js frontend/src/lib/Player/useContentFilter.test.jsx
npm run audit:layers
node cli/contentfilter.cli.mjs help | grep -n "srt-review"
```

Expected:
- Every suite passes, with the 14 domain tests and 9 application tests included.
- The frontend resolver tests still pass: SRT cues gained `severity`/`channel` but kept their shape otherwise.
- The layer audit shows no new violations.
- The help output lists `srt-review`.

**Step 2: Merge**

Merge `feat/content-filter-cues` into `main` only after these pass, then delete the branch and worktree as `CLAUDE.md` describes. Record the branch in `docs/_archive/deleted-branches.md`. Do not deploy: nothing here runs in the server.
