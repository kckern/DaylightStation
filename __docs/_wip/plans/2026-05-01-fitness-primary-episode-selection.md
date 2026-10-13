# Fitness Primary Episode Selection Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `selectPrimaryMedia()` so it stops marking warmup videos like "Cold Start" as the session's primary media, then backfill the one known incorrect session.

**Architecture:** Two changes to `selectPrimaryMedia.js`. First, broaden warmup detection by adding a "cold start" pattern to the built-in title regexes (handles cases like "Cold Start" that don't say "warmup"). Second, add a positional-bias step **before** the longest-wins fallback: when ≥2 survivors are each ≥10 minutes long, prefer the **last** one in the array (events are chronological in `media[]`, so the last long video is almost always the main session, not the warmup). Single-survivor cases keep using the longest-wins behavior. Then write unit tests covering all branches and backfill the known-bad session yaml.

**Tech Stack:** Vanilla JS module (`selectPrimaryMedia.js`), vitest for tests. The same module is consumed both client-side (`buildSessionSummary.js`) and server-side (`FitnessActivityEnrichmentService.mjs`) via `buildSelectionConfig(plex)`, so a single fix flows through to Strava enrichment automatically.

---

## File Structure

**Files:**
- Modify: `frontend/src/hooks/fitness/selectPrimaryMedia.js` — add positional bias + "cold start" pattern
- Create: `frontend/src/hooks/fitness/selectPrimaryMedia.test.js` — vitest unit tests (no existing test file)
- Modify (backfill): `data/household/history/fitness/2026-05-01/20260501061820.yml` — move `primary: true` flag

**Why no other files:** `buildSessionSummary.js` already calls `selectPrimaryMedia(media, warmupConfig)` and `media[]` is built event-chronological at L66 (`safeEvents.filter(e => e.type === 'media').map(...)`), so positional ordering is already correct without any caller change. `FitnessActivityEnrichmentService.mjs` consumes the same module via `buildStravaDescription(...)` and inherits the fix.

---

## Task 1: Unit-test scaffold + first failing test (positional bias)

**Files:**
- Create: `frontend/src/hooks/fitness/selectPrimaryMedia.test.js`

- [ ] **Step 1: Write the failing test for positional bias**

Create `frontend/src/hooks/fitness/selectPrimaryMedia.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { selectPrimaryMedia } from './selectPrimaryMedia.js';

const MIN_LONG_MS = 10 * 60 * 1000; // 10 minutes

describe('selectPrimaryMedia', () => {
  describe('positional bias for multiple ≥10-min survivors', () => {
    it('prefers the LAST ≥10-min video when two or more survive warmup filtering', () => {
      const media = [
        { contentId: 'a', mediaType: 'video', title: 'First Workout',  durationMs: MIN_LONG_MS + 60000 },
        { contentId: 'b', mediaType: 'video', title: 'Second Workout', durationMs: MIN_LONG_MS + 30000 },
      ];
      const primary = selectPrimaryMedia(media, {});
      expect(primary.contentId).toBe('b');
    });

    it('prefers the LAST ≥10-min video even when an earlier one is longer', () => {
      const media = [
        { contentId: 'a', mediaType: 'video', title: 'First',  durationMs: MIN_LONG_MS + 5 * 60_000 }, // 15 min
        { contentId: 'b', mediaType: 'video', title: 'Second', durationMs: MIN_LONG_MS + 30_000 },     // 10.5 min
      ];
      const primary = selectPrimaryMedia(media, {});
      expect(primary.contentId).toBe('b');
    });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/selectPrimaryMedia.test.js`

Expected: tests fail. The current implementation picks the **longest** so the first test case may coincidentally pass (b is longer); the second test case (a is longer) MUST fail because current code returns `a`.

- [ ] **Step 3: Commit failing tests**

```bash
git add frontend/src/hooks/fitness/selectPrimaryMedia.test.js
git commit -m "test(fitness): add failing tests for primary media positional bias"
```

---

## Task 2: Implement positional bias

**Files:**
- Modify: `frontend/src/hooks/fitness/selectPrimaryMedia.js:89-95`

- [ ] **Step 1: Add a positional-bias step before the longest-wins reduce**

Edit `frontend/src/hooks/fitness/selectPrimaryMedia.js`. Replace lines 89-95:

```javascript
  // Step 3: Drop warmup + deprioritized, pick longest. Fall back to all videos.
  const candidates = videos.filter(v => !isWarmup(v) && !isDeprioritized(v));
  const pool = candidates.length > 0 ? candidates : videos;

  return pool.reduce((best, item) =>
    (item.durationMs || 0) > (best.durationMs || 0) ? item : best
  );
}
```

with:

```javascript
  // Step 3: Drop warmup + deprioritized; fall back to all videos if filter empties the pool.
  const candidates = videos.filter(v => !isWarmup(v) && !isDeprioritized(v));
  const pool = candidates.length > 0 ? candidates : videos;

  // Step 4: Positional bias — when ≥2 survivors are each ≥10 minutes long, prefer
  // the LAST one. Events are chronological, and a true main-session video is
  // almost always played AFTER any warmup that survived the filter.
  const TEN_MIN_MS = 10 * 60 * 1000;
  const longSurvivors = pool.filter(v => (v.durationMs || 0) >= TEN_MIN_MS);
  if (longSurvivors.length >= 2) {
    return longSurvivors[longSurvivors.length - 1];
  }

  // Step 5: Fallback — longest survivor wins.
  return pool.reduce((best, item) =>
    (item.durationMs || 0) > (best.durationMs || 0) ? item : best
  );
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/selectPrimaryMedia.test.js`

Expected: both positional-bias tests PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/selectPrimaryMedia.js
git commit -m "fix(fitness): prefer last ≥10-min video when multiple survive warmup filter"
```

---

## Task 3: Add regression tests for existing behaviors

**Files:**
- Modify: `frontend/src/hooks/fitness/selectPrimaryMedia.test.js`

- [ ] **Step 1: Append regression tests covering existing logic that must still hold**

Append the following `describe` blocks inside the outer `describe('selectPrimaryMedia', () => { ... })`:

```javascript
  describe('warmup filter (built-in patterns)', () => {
    it('drops a "Warm Up" titled video when a workout video also exists', () => {
      const media = [
        { contentId: 'wu', mediaType: 'video', title: 'Warm Up Routine', durationMs: 5 * 60_000 },
        { contentId: 'wo', mediaType: 'video', title: 'Workout',         durationMs: 30 * 60_000 },
      ];
      expect(selectPrimaryMedia(media, {}).contentId).toBe('wo');
    });

    it('drops a "Cool Down" titled video', () => {
      const media = [
        { contentId: 'wo', mediaType: 'video', title: 'Workout',   durationMs: 30 * 60_000 },
        { contentId: 'cd', mediaType: 'video', title: 'Cool Down', durationMs: 5 * 60_000 },
      ];
      expect(selectPrimaryMedia(media, {}).contentId).toBe('wo');
    });

    it('drops a "Stretch" titled video', () => {
      const media = [
        { contentId: 'st', mediaType: 'video', title: 'Stretch Series', durationMs: 5 * 60_000 },
        { contentId: 'wo', mediaType: 'video', title: 'Workout',        durationMs: 30 * 60_000 },
      ];
      expect(selectPrimaryMedia(media, {}).contentId).toBe('wo');
    });
  });

  describe('audio + fallback handling', () => {
    it('returns null when no items', () => {
      expect(selectPrimaryMedia([], {})).toBeNull();
    });

    it('returns null when only audio tracks', () => {
      const media = [{ contentId: 't1', mediaType: 'audio', title: 'song', durationMs: 200_000 }];
      expect(selectPrimaryMedia(media, {})).toBeNull();
    });

    it('falls back to longest of all videos when every video is filtered as warmup', () => {
      const media = [
        { contentId: 'a', mediaType: 'video', title: 'Warm Up',   durationMs: 300_000 },
        { contentId: 'b', mediaType: 'video', title: 'Cool Down', durationMs: 600_000 },
      ];
      expect(selectPrimaryMedia(media, {}).contentId).toBe('b');
    });

    it('uses longest-wins (no positional bias) when only ONE survivor is ≥10 min', () => {
      const media = [
        { contentId: 'short', mediaType: 'video', title: 'Short',      durationMs: 5 * 60_000 },
        { contentId: 'long',  mediaType: 'video', title: 'Long',       durationMs: 12 * 60_000 },
      ];
      expect(selectPrimaryMedia(media, {}).contentId).toBe('long');
    });
  });

  describe('config-driven warmup detection', () => {
    it('drops items whose label is in warmup_labels', () => {
      const media = [
        { contentId: 'a', mediaType: 'video', title: 'Anything',  durationMs: 5 * 60_000, labels: ['warmup'] },
        { contentId: 'b', mediaType: 'video', title: 'Workout',   durationMs: 30 * 60_000 },
      ];
      const cfg = { warmup_labels: ['warmup'] };
      expect(selectPrimaryMedia(media, cfg).contentId).toBe('b');
    });

    it('drops items whose description contains a configured warmup_description_tag', () => {
      const media = [
        { contentId: 'a', mediaType: 'video', title: 'Anything', durationMs: 5 * 60_000,
          description: 'Optional warmup that prepares your muscles' },
        { contentId: 'b', mediaType: 'video', title: 'Workout',  durationMs: 30 * 60_000 },
      ];
      const cfg = { warmup_description_tags: ['Optional warmup'] };
      expect(selectPrimaryMedia(media, cfg).contentId).toBe('b');
    });
  });
```

- [ ] **Step 2: Run tests to verify ALL pass**

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/selectPrimaryMedia.test.js`

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/selectPrimaryMedia.test.js
git commit -m "test(fitness): add regression coverage for selectPrimaryMedia"
```

---

## Task 4: Add "cold start" to built-in title patterns

**Files:**
- Modify: `frontend/src/hooks/fitness/selectPrimaryMedia.test.js`
- Modify: `frontend/src/hooks/fitness/selectPrimaryMedia.js:16-20`

- [ ] **Step 1: Write failing test for "Cold Start" detection**

Append to `selectPrimaryMedia.test.js` inside the outer describe:

```javascript
  describe('"Cold Start" warmup pattern (regression for 20260501061820.yml bug)', () => {
    it('treats "22 Minute Hard Corps—Cold Start" as a warmup', () => {
      const media = [
        { contentId: 'plex:600877', mediaType: 'video',
          title: '22 Minute Hard Corps—Cold Start', durationMs: 686164 },
        { contentId: 'plex:674501', mediaType: 'video',
          title: 'Week 1 Day 4 - Upper Body',       durationMs: 642081 },
      ];
      expect(selectPrimaryMedia(media, {}).contentId).toBe('plex:674501');
    });

    it('matches "cold start" case-insensitively', () => {
      const media = [
        { contentId: 'a', mediaType: 'video', title: 'cold start', durationMs: 5 * 60_000 },
        { contentId: 'b', mediaType: 'video', title: 'Workout',    durationMs: 30 * 60_000 },
      ];
      expect(selectPrimaryMedia(media, {}).contentId).toBe('b');
    });
  });
```

- [ ] **Step 2: Run test to confirm "Cold Start" case fails**

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/selectPrimaryMedia.test.js`

Expected: the new "Cold Start" tests FAIL. Current `BUILTIN_TITLE_PATTERNS` doesn't include a `cold start` regex.

- [ ] **Step 3: Add the pattern to `selectPrimaryMedia.js`**

Edit `frontend/src/hooks/fitness/selectPrimaryMedia.js:16-20`. Replace:

```javascript
const BUILTIN_TITLE_PATTERNS = [
  /warm[\s-]?up/i,
  /cool[\s-]?down/i,
  /stretch/i,
];
```

with:

```javascript
const BUILTIN_TITLE_PATTERNS = [
  /warm[\s-]?up/i,
  /cool[\s-]?down/i,
  /stretch/i,
  /cold[\s-]?start/i,  // 2026-05-01: catches Beachbody-style intro episodes
];
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/selectPrimaryMedia.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/selectPrimaryMedia.js frontend/src/hooks/fitness/selectPrimaryMedia.test.js
git commit -m "fix(fitness): treat 'Cold Start' titles as warmup in primary selection"
```

---

## Task 5: Backfill the known-bad session

**Files:**
- Modify (in container): `data/household/history/fitness/2026-05-01/20260501061820.yml`

The session yaml has TWO occurrences of `primary: true` to repair: the one inside `summary.media[]` (the canonical flag) and a `is_primary: true` line earlier in the file (a participant flag — DO NOT touch that one).

The target is in `summary.media`. Currently:

```yaml
    - contentId: plex:600877
      title: 22 Minute Hard Corps—Cold Start
      …
      primary: true       # ← REMOVE
    - contentId: plex:674501
      title: Week 1 Day 4 - Upper Body
      …
      grandparentId: 674496
                          # ← ADD primary: true here
```

- [ ] **Step 1: Read the current file inside the container to confirm exact indentation**

Run:

```bash
sudo docker exec daylight-station sh -c 'awk "/^summary:/{p=1} p" data/household/history/fitness/2026-05-01/20260501061820.yml'
```

Note the exact indentation of `primary: true` under `plex:600877` and the matching field-indent under `plex:674501`. The flag should be added at the same indent level as `contentId`, `title`, etc.

- [ ] **Step 2: Apply the backfill via heredoc (no `sed -i` per CLAUDE.local.md)**

Read the file, modify it locally, then write back. Easiest path: use a small node one-liner inside the container.

```bash
sudo docker exec daylight-station node -e "
const fs = require('fs');
const path = 'data/household/history/fitness/2026-05-01/20260501061820.yml';
let s = fs.readFileSync(path, 'utf8');

// Locate the summary.media block.
const summaryIdx = s.indexOf('\nsummary:');
if (summaryIdx < 0) throw new Error('no summary block');
const head = s.slice(0, summaryIdx);
let tail = s.slice(summaryIdx);

// 1) Remove the (single) 'primary: true' that sits within the plex:600877 entry of summary.media.
//    Use a guard regex so we only touch the one inside the plex:600877 block.
tail = tail.replace(
  /(- contentId: plex:600877[\\s\\S]*?)\\n      primary: true\\n/,
  '\$1\\n'
);

// 2) Add 'primary: true' at the end of the plex:674501 entry, before the next list element or block end.
//    The entry ends right before the next '    - ' (next media item) OR before the next top-level key.
tail = tail.replace(
  /(- contentId: plex:674501[\\s\\S]*?)(\\n    - |\\n[a-z])/,
  '\$1\\n      primary: true\$2'
);

fs.writeFileSync(path, head + tail);
console.log('backfill: done');
"
```

- [ ] **Step 3: Verify the backfill**

```bash
sudo docker exec daylight-station sh -c 'grep -nE "contentId: plex:|primary: true" data/household/history/fitness/2026-05-01/20260501061820.yml | tail -20'
```

Expected: `primary: true` appears once, on the plex:674501 entry. The plex:600877 entry has no `primary:` line.

- [ ] **Step 4: Spot-check that yaml still parses**

```bash
sudo docker exec daylight-station node -e "
const yaml = require('js-yaml');
const fs = require('fs');
const obj = yaml.load(fs.readFileSync('data/household/history/fitness/2026-05-01/20260501061820.yml', 'utf8'));
const m = obj.summary.media;
const primary = m.find(x => x.primary);
console.log('primary contentId =', primary?.contentId);
"
```

Expected: `primary contentId = plex:674501`.

- [ ] **Step 5: Note in commit (no app code changed by this step)**

This step modifies persisted user data, not source. Document it in the next code commit's body, or in a session note — there is nothing to `git add`.

---

## Task 6: Sweep recent history for similar misclassifications

**Files:**
- Read-only sweep — no commits unless additional backfills are needed.

- [ ] **Step 1: Scan recent (last 60 days) sessions for primary entries that look like warmups under the NEW rules**

Run inside the container:

```bash
sudo docker exec daylight-station node -e "
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = 'data/household/history/fitness';
const cutoff = new Date(Date.now() - 60*24*3600*1000);

// New warmup heuristics (mirrors selectPrimaryMedia changes — keep in sync).
const TITLE_RE = [/warm[\\s-]?up/i, /cool[\\s-]?down/i, /stretch/i, /cold[\\s-]?start/i];
const isWarmupTitle = t => TITLE_RE.some(r => r.test(t || ''));

const dates = fs.readdirSync(ROOT).filter(d => /^\\d{4}-\\d{2}-\\d{2}\$/.test(d) && new Date(d) >= cutoff);
const suspect = [];
for (const d of dates) {
  const dir = path.join(ROOT, d);
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.yml'))) {
    let obj;
    try { obj = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    const media = obj?.summary?.media;
    if (!Array.isArray(media)) continue;
    const primary = media.find(m => m.primary);
    if (!primary) continue;
    if (isWarmupTitle(primary.title)) {
      // Find a candidate replacement: ≥10-min, non-warmup-titled.
      const TEN = 10*60*1000;
      const better = media
        .filter(m => m.mediaType === 'video' && (m.durationMs||0) >= TEN && !isWarmupTitle(m.title))
        .pop();
      suspect.push({ file: path.join(dir, f), oldPrimary: primary.title, candidate: better?.title || null });
    }
  }
}
console.log(JSON.stringify(suspect, null, 2));
"
```

- [ ] **Step 2: Review the output with the user**

If `suspect[]` is empty, sweep is done — no further backfills needed.

If `suspect[]` is non-empty, present the list to the user and ask which to backfill. **Do not auto-backfill** — these are persistent records and the user wants to review.

- [ ] **Step 3: Commit any additional backfills the user approves**

Per-file, repeat Task 5 Steps 2-4 with the file path substituted. No code commit, document via session notes.

---

## Self-review

- [x] **Spec coverage:** Bug write-up `2026-05-01-fitness-primary-episode-warmup-misclassified.md` lists three required behaviors — positional bias (Task 2), tightened warmup detection (Task 4), and backfill (Task 5+6). All covered.
- [x] **Placeholder scan:** No "TBD", no "add appropriate handling", every step has executable code or commands.
- [x] **Type consistency:** `selectPrimaryMedia()` signature unchanged. `BUILTIN_TITLE_PATTERNS` is the same export. `media[]` shape unchanged.
- [x] **Note on the second `primary: true` in the yaml file:** there is a participant `is_primary: true` (different field name) that the backfill must not disturb. The backfill regexes are anchored on `\n      primary: true\n` (six spaces of indent), which matches only the media-entry flag, not the participant flag.
- [x] **Note on config-driven detection:** The bug doc mentions populating `warmup_description_tags` (e.g. `["Optional warmup"]`) for the deployed fitness config. That is a config-side change in `data/...` and is **out of scope for this code plan** — flag it to the user as a follow-up after the code lands. The new `cold[\s-]?start` regex covers the immediate "Cold Start" case without requiring config changes.
