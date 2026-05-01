# Fitness Primary Min-Duration Threshold + Deprioritized Fallback Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `MIN_PRIMARY_MS = 5*60*1000` floor for primary selection so 48-second demo videos are never picked as primary; and stop the existing fallback that returns longest-of-all-videos (including deprioritized) when no real candidate exists. Apply to both frontend and backend selectPrimaryMedia copies, then backfill the one known bad session and sweep history for similar cases.

**Architecture:** This is an extension of Plan 1's logic, not a replacement. Same TDD red-green pattern, same parallel-frontend-and-backend touch surface, same backfill workflow. The algorithm becomes:

1. Filter audio.
2. Build `realCandidates = videos.filter(!isWarmup && !isDeprioritized)` (unchanged).
3. New: `eligible = realCandidates.filter(durationMs >= MIN_PRIMARY_MS)`.
4. If `eligible.length > 0`: apply existing positional bias (≥2 of `eligible` that are also ≥10 min → last) or longest of eligible.
5. Else if all videos are warmup-or-deprioritized AND a non-deprioritized warmup exists ≥ MIN_PRIMARY_MS: return the longest such warmup (existing "stretch session only" fallback, gated on the new floor).
6. Else: return `null`.

**Tech Stack:** Same as Plan 1 — vitest (frontend) + jest (backend), pure JS module touched in two parallel copies.

---

## File Structure

**Files:**
- Modify: `frontend/src/hooks/fitness/selectPrimaryMedia.js` — add MIN_PRIMARY_MS gate + remove deprioritized-fallback behavior
- Modify: `backend/src/1_adapters/fitness/selectPrimaryMedia.mjs` — same change adapted for event-shape data (`durationSeconds`, threshold = 300 s)
- Modify: `frontend/src/hooks/fitness/selectPrimaryMedia.test.js` — append new test cases
- Modify: `tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs` — append new test cases
- Modify (backfill): `data/household/history/fitness/2026-04-30/20260430192448.yml` — remove `primary: true` from plex:601458 (Strength Challenge 1). Do **not** add it elsewhere; this session has no qualifying primary.

---

## Task 1: Failing tests for the new floor (frontend)

**Files:**
- Modify: `frontend/src/hooks/fitness/selectPrimaryMedia.test.js`

- [ ] **Step 1: Add a new describe block at the end of the outer describe**

Append, INSIDE `describe('selectPrimaryMedia', ...)`:

```javascript
  describe('minimum primary duration floor (Plan 4)', () => {
    const MIN_PRIMARY_MS = 5 * 60 * 1000;

    it('returns null when only a sub-floor non-warmup video survives (regression: 2026-04-30/20260430192448.yml)', () => {
      const media = [
        { contentId: 'plex:606445', mediaType: 'video',
          title: 'F-Zero', durationMs: 1254436, labels: ['kidsfun'] },
        { contentId: 'plex:601458', mediaType: 'video',
          title: 'Strength Challenge 1', durationMs: 48682, labels: [] },
      ];
      const cfg = { deprioritized_labels: ['kidsfun'] };
      expect(selectPrimaryMedia(media, cfg)).toBeNull();
    });

    it('returns null when only a deprioritized video exists', () => {
      const media = [
        { contentId: 'a', mediaType: 'video', title: 'Cartoon Marathon', durationMs: 30 * 60_000, labels: ['kidsfun'] },
      ];
      const cfg = { deprioritized_labels: ['kidsfun'] };
      expect(selectPrimaryMedia(media, cfg)).toBeNull();
    });

    it('returns null when only a sub-floor real video exists', () => {
      const media = [
        { contentId: 'a', mediaType: 'video', title: 'Quick Demo', durationMs: 4 * 60_000 }, // 4 min
      ];
      expect(selectPrimaryMedia(media, {})).toBeNull();
    });

    it('returns the eligible video when it meets exactly MIN_PRIMARY_MS', () => {
      const media = [
        { contentId: 'a', mediaType: 'video', title: 'Workout', durationMs: MIN_PRIMARY_MS },
      ];
      expect(selectPrimaryMedia(media, {}).contentId).toBe('a');
    });

    it('picks the longer of two real candidates when only the longer clears the floor', () => {
      const media = [
        { contentId: 'short', mediaType: 'video', title: 'Brief',  durationMs: 4 * 60_000 },
        { contentId: 'long',  mediaType: 'video', title: 'Real',   durationMs: 12 * 60_000 },
      ];
      expect(selectPrimaryMedia(media, {}).contentId).toBe('long');
    });

    it('falls back to longest non-deprioritized warmup when only warmups exist (≥ MIN_PRIMARY_MS)', () => {
      const media = [
        { contentId: 's1', mediaType: 'video', title: 'Stretch Routine', durationMs: 10 * 60_000 },
        { contentId: 's2', mediaType: 'video', title: 'Cool Down',       durationMs: 6 * 60_000 },
      ];
      expect(selectPrimaryMedia(media, {}).contentId).toBe('s1');
    });

    it('returns null when only sub-floor warmups exist', () => {
      const media = [
        { contentId: 's1', mediaType: 'video', title: 'Stretch', durationMs: 4 * 60_000 },
      ];
      expect(selectPrimaryMedia(media, {})).toBeNull();
    });
  });
```

- [ ] **Step 2: Run tests to confirm the new ones fail**

Run: `/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/selectPrimaryMedia.test.js`

(or `npx vitest run --config vitest.config.mjs frontend/src/hooks/fitness/selectPrimaryMedia.test.js`)

Expected:
- The 13 existing tests still PASS.
- All 7 new tests in this describe block FAIL (current implementation has no floor — short videos still become primary).

If any new test passes against the current implementation, STOP — recheck the assertion or current behavior.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/selectPrimaryMedia.test.js
git commit -m "test(fitness): failing tests for MIN_PRIMARY_MS floor + deprioritized fallback removal"
```

---

## Task 2: Failing tests for the new floor (backend)

**Files:**
- Modify: `tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs`

- [ ] **Step 1: Read the file's existing factory and config conventions**

Run: `head -40 tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs`

Note the `videoEvent(title, durationSeconds, dataOverrides)` factory and the `defaultConfig` object. The backend uses seconds (not ms), so threshold = 300 seconds.

- [ ] **Step 2: Append a new describe block at the end of the file**

Use the same scenarios as Task 1 but adapted to the event shape and seconds-based durations. Use the existing `videoEvent` factory:

```javascript
describe('minimum primary duration floor (Plan 4)', () => {
  const MIN_PRIMARY_SEC = 5 * 60;

  test('returns null when only a sub-floor non-warmup event survives (regression for 2026-04-30 session)', () => {
    const events = [
      videoEvent('F-Zero',              1254, { labels: ['kidsfun'] }),
      videoEvent('Strength Challenge 1', 48,  { labels: [] }),
    ];
    expect(selectPrimaryMedia(events, defaultConfig)).toBeNull();
  });

  test('returns null when only a deprioritized event exists', () => {
    const events = [videoEvent('Cartoon Marathon', 30 * 60, { labels: ['kidsfun'] })];
    expect(selectPrimaryMedia(events, defaultConfig)).toBeNull();
  });

  test('returns null when only a sub-floor real event exists', () => {
    const events = [videoEvent('Quick Demo', 4 * 60)];
    expect(selectPrimaryMedia(events, defaultConfig)).toBeNull();
  });

  test('returns the eligible event when it meets exactly MIN_PRIMARY_SEC', () => {
    const events = [videoEvent('Workout', MIN_PRIMARY_SEC)];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Workout');
  });

  test('picks the longer real candidate when only the longer clears the floor', () => {
    const events = [
      videoEvent('Brief', 4 * 60),
      videoEvent('Real',  12 * 60),
    ];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Real');
  });

  test('falls back to longest non-deprioritized warmup when only warmups exist (≥ MIN_PRIMARY_SEC)', () => {
    const events = [
      videoEvent('Stretch Routine', 10 * 60),
      videoEvent('Cool Down',        6 * 60),
    ];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Stretch Routine');
  });

  test('returns null when only sub-floor warmups exist', () => {
    const events = [videoEvent('Stretch', 4 * 60)];
    expect(selectPrimaryMedia(events, defaultConfig)).toBeNull();
  });
});
```

If `defaultConfig` doesn't already include `kidsfun` in `deprioritized_labels`, add a local config inline for the regression test:

```javascript
    const cfg = { ...defaultConfig, deprioritized_labels: ['kidsfun'] };
    expect(selectPrimaryMedia(events, cfg)).toBeNull();
```

(Verify by reading `defaultConfig` first — Plan 1 Task 4 likely shows it has deprioritized_labels: ['KidsFun'] already, in which case the test fixture should use `'kidsfun'` lowercase since the existing implementation lowercases labels for case-insensitive matching.)

- [ ] **Step 3: Run jest to confirm new tests fail**

Run: `npx jest tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs`

Expected: 13 existing tests pass, 7 new tests fail.

- [ ] **Step 4: Commit**

```bash
git add tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs
git commit -m "test(fitness): failing backend tests for MIN_PRIMARY_MS floor + deprioritized fallback removal"
```

---

## Task 3: Implement the floor + remove deprioritized fallback (frontend)

**Files:**
- Modify: `frontend/src/hooks/fitness/selectPrimaryMedia.js`

- [ ] **Step 1: Update `selectPrimaryMedia()` body**

Find the current body (after Plan 1 Tasks 2 and 4 landed):

```javascript
export function selectPrimaryMedia(mediaItems, config) {
  if (!Array.isArray(mediaItems) || mediaItems.length === 0) return null;

  // Step 1: Filter out audio
  const videos = mediaItems.filter(m => m.mediaType !== 'audio');
  if (videos.length === 0) return null;

  // Step 2: Build skip-predicate combining warmup + deprioritized rules
  const titlePatterns = [...BUILTIN_TITLE_PATTERNS];
  // ...existing isWarmup / isDeprioritized helpers...

  // Step 3: Drop warmup + deprioritized; fall back to all videos if filter empties the pool.
  const candidates = videos.filter(v => !isWarmup(v) && !isDeprioritized(v));
  const pool = candidates.length > 0 ? candidates : videos;

  // Step 4: Positional bias — when ≥2 survivors are each ≥10 minutes long, prefer
  // the LAST one. ...
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

Replace **Steps 3-5** (lines starting from `// Step 3: Drop warmup + deprioritized` through the final closing brace of the function — keep Steps 1-2 and the helper definitions intact) with:

```javascript
  // Step 3: Build candidate pools.
  // - realCandidates: non-warmup + non-deprioritized (the universe of eligible primaries)
  // - eligible: realCandidates that clear the minimum primary duration floor
  const MIN_PRIMARY_MS = 5 * 60 * 1000;
  const TEN_MIN_MS = 10 * 60 * 1000;

  const realCandidates = videos.filter(v => !isWarmup(v) && !isDeprioritized(v));
  const eligible = realCandidates.filter(v => (v.durationMs || 0) >= MIN_PRIMARY_MS);

  // Step 4: Positional bias — when ≥2 eligible candidates are each ≥10 minutes long,
  // prefer the LAST one. Events are chronological, and a true main-session video is
  // almost always played AFTER any warmup that survived the filter.
  if (eligible.length > 0) {
    const longSurvivors = eligible.filter(v => (v.durationMs || 0) >= TEN_MIN_MS);
    if (longSurvivors.length >= 2) {
      return longSurvivors[longSurvivors.length - 1];
    }
    // Step 5: Fallback for eligible-only — longest survivor wins.
    return eligible.reduce((best, item) =>
      (item.durationMs || 0) > (best.durationMs || 0) ? item : best
    );
  }

  // Step 6: No eligible real candidate. If the user only did warmup-or-deprioritized
  // content AND there is at least one non-deprioritized warmup ≥ MIN_PRIMARY_MS,
  // surface the longest such warmup (e.g. a stretch-only session). Otherwise return
  // null — never promote browsing/deprioritized content to primary, never promote
  // sub-floor demos to primary.
  const allWarmupOrDeprioritized =
    videos.every(v => isWarmup(v) || isDeprioritized(v));
  if (allWarmupOrDeprioritized) {
    const eligibleWarmups = videos.filter(v =>
      isWarmup(v) && !isDeprioritized(v) && (v.durationMs || 0) >= MIN_PRIMARY_MS
    );
    if (eligibleWarmups.length > 0) {
      return eligibleWarmups.reduce((best, item) =>
        (item.durationMs || 0) > (best.durationMs || 0) ? item : best
      );
    }
  }

  return null;
}
```

Also update the file-level JSDoc at the top to reflect the new behavior. Replace lines 4-9 (the multi-line description from Plan 1 Task 2b) with:

```
 * Filters out audio, then warmup videos AND deprioritized videos (e.g. kids
 * content, browsing). Among non-warmup, non-deprioritized videos that clear
 * the MIN_PRIMARY_MS (5-minute) floor, when ≥2 are each ≥10 minutes long,
 * picks the LAST one (chronologically latest — typically the main workout);
 * otherwise picks the longest survivor by durationMs. Falls back to the
 * longest non-deprioritized warmup ≥ MIN_PRIMARY_MS only when the entire
 * session is warmup/deprioritized content (e.g. stretch-only days). Returns
 * null when no candidate clears the floor — explicitly rejects browsing
 * content and sub-floor demos as primary.
```

- [ ] **Step 2: Run frontend tests**

Run: `/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/selectPrimaryMedia.test.js`

Expected: 20/20 passing (13 from before + 7 new from Task 1).

If any test fails, STOP and inspect — the algorithm has a bug. Do NOT continue to Task 4 until everything is green.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/selectPrimaryMedia.js
git commit -m "fix(fitness): require MIN_PRIMARY_MS floor; never promote browsing to primary"
```

---

## Task 4: Implement the floor + remove deprioritized fallback (backend)

**Files:**
- Modify: `backend/src/1_adapters/fitness/selectPrimaryMedia.mjs`

- [ ] **Step 1: Update `selectPrimaryMedia()` body**

Find the current body (after Plan 1 Tasks 2b and 4):

```javascript
export function selectPrimaryMedia(mediaEvents, config) {
  if (!Array.isArray(mediaEvents) || mediaEvents.length === 0) return null;

  // Step 1: Filter out audio (tracks / items with artist)
  const episodes = mediaEvents.filter(e => {
    const d = e?.data;
    return d && d.contentType !== 'track' && !d.artist;
  });
  if (episodes.length === 0) return null;

  // Step 2: Drop warmups + deprioritized; fall back to all episodes if empty
  const isWarmup = buildWarmupChecker(config);
  const isDeprioritized = buildDeprioritizedChecker(config);
  const candidates = episodes.filter(e => !isWarmup(e) && !isDeprioritized(e));
  const pool = candidates.length > 0 ? candidates : episodes;

  // Step 3: Positional bias ...
  const TEN_MIN_SEC = 10 * 60;
  const longSurvivors = pool.filter(e => (e.data?.durationSeconds || 0) >= TEN_MIN_SEC);
  if (longSurvivors.length >= 2) {
    return longSurvivors[longSurvivors.length - 1];
  }

  // Step 4: Fallback — longest survivor wins.
  return pool.reduce((best, event) => {
    const bestSec = best.data?.durationSeconds || 0;
    const evSec = event.data?.durationSeconds || 0;
    return evSec > bestSec ? event : best;
  });
}
```

Replace **Steps 2-4** (everything after the audio-filter block) with the same structural change as Task 3, adapted for the event shape and seconds:

```javascript
  // Step 2: Build candidate pools.
  // - realCandidates: non-warmup + non-deprioritized
  // - eligible: realCandidates that clear the minimum primary duration floor
  const isWarmup = buildWarmupChecker(config);
  const isDeprioritized = buildDeprioritizedChecker(config);
  const MIN_PRIMARY_SEC = 5 * 60;
  const TEN_MIN_SEC = 10 * 60;

  const realCandidates = episodes.filter(e => !isWarmup(e) && !isDeprioritized(e));
  const eligible = realCandidates.filter(e => (e.data?.durationSeconds || 0) >= MIN_PRIMARY_SEC);

  if (eligible.length > 0) {
    const longSurvivors = eligible.filter(e => (e.data?.durationSeconds || 0) >= TEN_MIN_SEC);
    if (longSurvivors.length >= 2) {
      return longSurvivors[longSurvivors.length - 1];
    }
    return eligible.reduce((best, event) => {
      const bestSec = best.data?.durationSeconds || 0;
      const evSec = event.data?.durationSeconds || 0;
      return evSec > bestSec ? event : best;
    });
  }

  // Step 3: No eligible real candidate. Fall back to longest non-deprioritized warmup
  // ≥ MIN_PRIMARY_SEC only if the whole session is warmup-or-deprioritized
  // (e.g. stretch-only day). Otherwise return null — never promote browsing or
  // sub-floor demos to primary.
  const allWarmupOrDeprioritized = episodes.every(e => isWarmup(e) || isDeprioritized(e));
  if (allWarmupOrDeprioritized) {
    const eligibleWarmups = episodes.filter(e =>
      isWarmup(e) && !isDeprioritized(e) && (e.data?.durationSeconds || 0) >= MIN_PRIMARY_SEC
    );
    if (eligibleWarmups.length > 0) {
      return eligibleWarmups.reduce((best, event) => {
        const bestSec = best.data?.durationSeconds || 0;
        const evSec = event.data?.durationSeconds || 0;
        return evSec > bestSec ? event : best;
      });
    }
  }

  return null;
}
```

Also update the file-level JSDoc near the top with the same wording style as the frontend update — substitute "events" / "durationSeconds" terminology.

- [ ] **Step 2: Run backend tests**

Run: `npx jest tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs`

Expected: 20/20 passing.

- [ ] **Step 3: Commit**

```bash
git add backend/src/1_adapters/fitness/selectPrimaryMedia.mjs
git commit -m "fix(fitness): backend MIN_PRIMARY_SEC floor; never promote browsing to primary"
```

---

## Task 5: Backfill 2026-04-30 evening session

**Files:**
- Modify (in container): `data/household/history/fitness/2026-04-30/20260430192448.yml`

The session has `primary: true` on `plex:601458` (Strength Challenge 1, 48 s). Under the new logic this session has NO primary. Remove the flag — do not move it.

- [ ] **Step 1: Confirm pre-state**

```bash
sudo docker exec daylight-station sh -c 'grep -nE "primary:|contentId: plex:" data/household/history/fitness/2026-04-30/20260430192448.yml'
```

Expected: `primary: true` appears once, on the plex:601458 entry.

- [ ] **Step 2: Apply backfill via node + js-yaml**

```bash
sudo docker exec daylight-station node -e "
const yaml = require('js-yaml');
const fs = require('fs');
const path = 'data/household/history/fitness/2026-04-30/20260430192448.yml';
const obj = yaml.load(fs.readFileSync(path, 'utf8'));

if (!obj?.summary?.media) { console.error('no summary.media'); process.exit(1); }
const target = obj.summary.media.find(m => m.contentId === 'plex:601458');
if (!target) { console.error('expected plex:601458 entry'); process.exit(1); }

console.log('before: 601458 primary =', target.primary);
delete target.primary;
fs.writeFileSync(path, yaml.dump(obj, { lineWidth: -1, noRefs: true }));

const after = yaml.load(fs.readFileSync(path, 'utf8'));
const a = after.summary.media.find(m => m.contentId === 'plex:601458');
console.log('after:  601458 primary =', a.primary);

const anyPrimary = after.summary.media.find(m => m.primary);
console.log('any primary in summary.media:', anyPrimary?.contentId || '(none)');
"
```

Expected output:
```
before: 601458 primary = true
after:  601458 primary = undefined
any primary in summary.media: (none)
```

- [ ] **Step 3: Verify yaml integrity**

```bash
sudo docker exec daylight-station node -e "
const yaml = require('js-yaml');
const fs = require('fs');
const obj = yaml.load(fs.readFileSync('data/household/history/fitness/2026-04-30/20260430192448.yml', 'utf8'));
console.log('media count:', obj.summary.media.length);
console.log('primary count:', obj.summary.media.filter(m => m.primary).length);
console.log('events count:', obj.timeline?.events?.length);
"
```

Expected:
```
media count: 3
primary count: 0
events count: 3
```

- [ ] **Step 4: No source commit needed (data-only change). Document in next code commit body or session notes.**

---

## Task 6: Re-sweep history with the new heuristics

**Files:** read-only sweep, no commits unless additional backfills are approved by user.

- [ ] **Step 1: Run a combined sweep**

Heuristics now cover:
- (A) Primary title matches a warmup pattern (existing — Plan 1 Task 6)
- (B) Primary's `durationMs` is below MIN_PRIMARY_MS (`300_000` ms = 5 min) → demo misclassified
- (C) Session has a long deprioritized video and a short non-deprioritized primary → likely "Game Cycling style" session where the actual workout is a deprioritized track (informational only — fix is data-side, not auto-applicable)

```bash
sudo docker exec daylight-station node -e "
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = 'data/household/history/fitness';
const SIXTY_DAYS_MS = 60 * 24 * 3600 * 1000;
const cutoff = new Date(Date.now() - SIXTY_DAYS_MS);

const TITLE_RE = [/warm[\\s-]?up/i, /cool[\\s-]?down/i, /stretch/i, /cold[\\s-]?start/i];
const isWarmupTitle = t => TITLE_RE.some(r => r.test(t || ''));
const MIN_PRIMARY_MS = 5 * 60 * 1000;
const TEN_MIN_MS = 10 * 60 * 1000;
const KIDSFUN = 'kidsfun';

const dates = fs.readdirSync(ROOT)
  .filter(d => /^\\d{4}-\\d{2}-\\d{2}\$/.test(d) && new Date(d) >= cutoff)
  .sort();

const suspect = [];
let scanned = 0;
for (const d of dates) {
  const dir = path.join(ROOT, d);
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.yml'))) {
    let obj;
    try { obj = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    scanned++;
    const media = obj?.summary?.media;
    if (!Array.isArray(media)) continue;
    const primary = media.find(m => m.primary);
    if (!primary) continue;

    const reasons = [];
    if (isWarmupTitle(primary.title)) reasons.push('A:title-warmup');
    if ((primary.durationMs || 0) < MIN_PRIMARY_MS) reasons.push('B:sub-floor');
    const longDeprioritizedSibling = media.find(m =>
      m !== primary &&
      m.mediaType !== 'audio' &&
      (m.durationMs || 0) >= TEN_MIN_MS &&
      Array.isArray(m.labels) && m.labels.map(l => String(l).toLowerCase()).includes(KIDSFUN)
    );
    if (longDeprioritizedSibling) reasons.push('C:long-deprioritized-sibling');

    if (reasons.length === 0) continue;

    // Find a candidate replacement under the NEW rules:
    // last ≥10-min real (non-warmup, non-deprioritized) wins; else longest ≥5-min real;
    // else null (no replacement — backfill should clear primary).
    const realCandidates = media.filter(m =>
      m.mediaType !== 'audio' &&
      !isWarmupTitle(m.title) &&
      !(Array.isArray(m.labels) && m.labels.map(l => String(l).toLowerCase()).includes(KIDSFUN))
    );
    const eligible = realCandidates.filter(m => (m.durationMs || 0) >= MIN_PRIMARY_MS);
    let candidate = null;
    if (eligible.length > 0) {
      const longSurvivors = eligible.filter(m => (m.durationMs || 0) >= TEN_MIN_MS);
      candidate = longSurvivors.length >= 2
        ? longSurvivors[longSurvivors.length - 1]
        : eligible.reduce((b, m) => (m.durationMs || 0) > (b.durationMs || 0) ? m : b);
    }

    suspect.push({
      file: path.join(dir, f),
      reasons,
      oldPrimary: { title: primary.title, contentId: primary.contentId, durationMs: primary.durationMs, labels: primary.labels || [] },
      candidateReplacement: candidate
        ? { title: candidate.title, contentId: candidate.contentId, durationMs: candidate.durationMs }
        : null
    });
  }
}
console.log(JSON.stringify({ scanned, suspectCount: suspect.length, suspect }, null, 2));
"
```

- [ ] **Step 2: Sanity-check that already-backfilled files don't appear**

The result should NOT contain:
- `data/household/history/fitness/2026-05-01/20260501061820.yml` (Plan 1 backfill)
- `data/household/history/fitness/2026-04-30/20260430192448.yml` (Plan 4 Task 5 backfill, just done)

If either appears, the backfill didn't take effect — STOP and investigate.

- [ ] **Step 3: Report the JSON output to the user**

Do NOT auto-backfill. Present the suspects with their `reasons` and `candidateReplacement`. The user reviews and decides per-file whether to backfill.

For reason `C:long-deprioritized-sibling` specifically: surface the issue but explain it cannot be auto-fixed by code — the deprioritized video might genuinely have been the user's workout (Game Cycling) but with mislabeled `kidsfun`. The fix is data-side (relabel in Plex) or session-side (manual primary override).

---

## Self-review

- [x] **Spec coverage:** Bug doc `docs/_wip/bugs/2026-05-01-fitness-primary-browsing-and-short-demo-misclassification.md` lists three required behaviors — MIN_PRIMARY_MS floor (Tasks 3-4), removal of "all videos" deprioritized fallback (Tasks 3-4 — the new code path goes to `null` instead), backfill (Task 5), re-sweep with new heuristics (Task 6). All covered.
- [x] **Placeholder scan:** No "TBD"; every step has executable code or commands.
- [x] **Type consistency:** Frontend uses `MIN_PRIMARY_MS` (ms), backend uses `MIN_PRIMARY_SEC` (seconds). Tests on each side use the matching unit.
- [x] **Frontend/backend parallel:** Same fix applied in two parallel files (Plan 1 already established this pattern; Plan 4 follows it). `selectPrimaryMedia` interface unchanged — callers already null-safe.
- [x] **No caller change needed:** `buildSessionSummary.js:88` already does `if (primary) primary.primary = true;` — null-safe. Strava enrichment uses optional chaining throughout.
- [x] **Note on "Strength Challenge 1" specifically:** The fix returns null, removing the flag. The session yaml will still contain the media item — only the `primary: true` flag is dropped. Downstream consumers fall back to `summary.media[0]` or render a "no primary" state per their existing null handling.
- [x] **Threshold tuning:** 5 minutes is a defensible default; if real-world usage shows it filters too aggressively or too loosely, change `MIN_PRIMARY_MS` in one place each. Both files use a const — no string interpolation hazard.
- [x] **No regression of Plan 1's tests:** All 13 frontend + 13 backend tests from Plan 1 must still pass. The new logic is a STRICT EXTENSION of the existing positional bias / longest-wins behavior — when a real candidate ≥ MIN_PRIMARY_MS exists, the inner branch is identical to Plan 1's logic.
