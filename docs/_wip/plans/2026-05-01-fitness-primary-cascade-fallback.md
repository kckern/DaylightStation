# Fitness Primary Cascading Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "return null when nothing qualifies" terminal behavior added in Plan 4 with a four-tier cascading fallback so every session that has any video ends up with a primary. Preserves the "never prioritize browsing when a non-browsing alternative exists" principle by ordering tiers carefully. Then backfill the two known sessions that should now have primaries (yesterday evening + 2026-04-29 Bucket 3) and re-run the sweep.

**Architecture:** The new algorithm cascades through four tiers, returning the first one that yields a candidate:

1. **Tier 1 — Eligible real workouts:** non-warmup, non-deprioritized, ≥ MIN_PRIMARY_MS. Positional bias applies (≥2 candidates ≥ 10 min → last; else longest).
2. **Tier 2 — Real candidates of any duration:** non-warmup, non-deprioritized. Longest. (Drops the floor.)
3. **Tier 3 — Non-deprioritized of any kind:** allows warmups but still blocks browsing/deprioritized. Longest. (E.g. stretch-only sessions, or "stretch + cartoon" — stretch wins because cartoon is browsing.)
4. **Tier 4 — Anything that survived audio filtering:** allows browsing/deprioritized as a last resort. Longest. (E.g. Game Cycling sessions where every track is `kidsfun`-labeled — F-Zero wins because there is literally no non-browsing video.)

Returns `null` only when there are no non-audio media items at all.

**Behavioral diff vs Plan 4:**

| Session shape | Plan 4 result | Plan 5 result |
|---|---|---|
| Long real workout | longest real | same (T1) |
| Multiple long reals | last (positional bias) | same (T1) |
| Sub-floor real + browsing long | null | sub-floor real (T2 — Strength Challenge 1 case) |
| Browsing only (no real) | null | longest browsing (T4 — Bucket 3 / F-Zero case) |
| Stretch only | longest stretch (≥ floor only) | longest stretch (any duration, T3) |
| Stretch + cartoon | null (or longest stretch in old fallback) | stretch (T3 wins over T4) |

**Tech Stack:** Same as Plans 1 and 4 — vitest (frontend), jest (backend), parallel implementations in two files. Backfills via docker exec + node + js-yaml.

---

## File Structure

**Files:**
- Modify: `frontend/src/hooks/fitness/selectPrimaryMedia.js` — replace Plan 4's branch structure with the cascade. Update JSDoc.
- Modify: `backend/src/1_adapters/fitness/selectPrimaryMedia.mjs` — same structural change adapted for event shape (`durationSeconds`).
- Modify: `frontend/src/hooks/fitness/selectPrimaryMedia.test.js` — update Plan 4's "returns null" tests, add cascade-tier tests.
- Modify: `tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs` — same updates for backend.
- Modify (backfills, in container):
  - `data/household/history/fitness/2026-04-30/20260430192448.yml` — re-add `primary: true` on `plex:601458` (Strength Challenge 1) since T2 cascade picks it.
  - `data/household/history/fitness/2026-04-29/20260429194446.yml` — already has `primary: true` on F-Zero (Bucket 3 deferred file). Verify it still has it; under T4 cascade, F-Zero is the correct primary anyway. **No change needed**, but confirm.

---

## Task 1: Update existing test expectations + add cascade tier tests (frontend)

**Files:**
- Modify: `frontend/src/hooks/fitness/selectPrimaryMedia.test.js`

Plan 4 added 7 tests in `describe('minimum primary duration floor (Plan 4)')`. Several of those return `null` under Plan 4 but should return a video under Plan 5's cascade. They need updating.

Plan 4 also has a test `falls back to longest of all videos when every video is filtered as warmup` from earlier (Plan 1 Task 3) that already expects T4 behavior — that one is fine.

- [ ] **Step 1: Update Plan 4's test expectations to match the cascade**

Inside `describe('minimum primary duration floor (Plan 4)', () => { ... })`, find and modify these tests:

**Test 1** — `returns null when only a sub-floor non-warmup video survives (regression: 2026-04-30/20260430192448.yml)`
- Old expectation: `toBeNull()`
- New expectation: returns Strength Challenge 1 (T2 picks it — only non-warmup non-deprio survivor)
- Replace the assertion:

```javascript
    it('returns the sub-floor non-warmup video via cascade T2 when no eligible real workout exists (regression: 2026-04-30/20260430192448.yml)', () => {
      const media = [
        { contentId: 'plex:606445', mediaType: 'video',
          title: 'F-Zero', durationMs: 1254436, labels: ['kidsfun'] },
        { contentId: 'plex:601458', mediaType: 'video',
          title: 'Strength Challenge 1', durationMs: 48682, labels: [] },
      ];
      const cfg = { deprioritized_labels: ['kidsfun'] };
      expect(selectPrimaryMedia(media, cfg).contentId).toBe('plex:601458');
    });
```

**Test 2** — `returns null when only a deprioritized video exists`
- Old expectation: `toBeNull()`
- New expectation: T4 picks the cartoon (last-resort browsing)
- Replace:

```javascript
    it('returns the deprioritized video via cascade T4 when nothing else exists', () => {
      const media = [
        { contentId: 'a', mediaType: 'video', title: 'Cartoon Marathon', durationMs: 30 * 60_000, labels: ['kidsfun'] },
      ];
      const cfg = { deprioritized_labels: ['kidsfun'] };
      expect(selectPrimaryMedia(media, cfg).contentId).toBe('a');
    });
```

**Test 3** — `returns null when only a sub-floor real video exists`
- Old expectation: `toBeNull()`
- New expectation: T2 picks the sub-floor real video
- Replace:

```javascript
    it('returns the sub-floor real video via cascade T2 when no eligible real workout exists', () => {
      const media = [
        { contentId: 'a', mediaType: 'video', title: 'Quick Demo', durationMs: 4 * 60_000 },
      ];
      expect(selectPrimaryMedia(media, {}).contentId).toBe('a');
    });
```

**Test 7** — `returns null when only sub-floor warmups exist`
- Old expectation: `toBeNull()`
- New expectation: T3 picks the longest non-deprio (allows warmup)
- Replace:

```javascript
    it('returns the sub-floor warmup via cascade T3 when only warmups exist', () => {
      const media = [
        { contentId: 's1', mediaType: 'video', title: 'Stretch', durationMs: 4 * 60_000 },
      ];
      expect(selectPrimaryMedia(media, {}).contentId).toBe('s1');
    });
```

The other Plan 4 tests (4, 5, 6) — exact-floor, longer-real-clears-floor, longest-warmup — keep their expectations. They still pass under cascade.

- [ ] **Step 2: Add a new describe block for cascade-tier-specific tests**

Inside the outer `describe('selectPrimaryMedia', ...)`, just before its closing `});`, append:

```javascript
  describe('cascading fallback tiers (Plan 5)', () => {
    it('T3: prefers non-deprioritized (warmup) over deprioritized (browsing) — never browses when alternative exists', () => {
      const media = [
        { contentId: 's1', mediaType: 'video', title: 'Stretch Routine', durationMs: 8 * 60_000 },
        { contentId: 'k1', mediaType: 'video', title: 'Cartoon',          durationMs: 30 * 60_000, labels: ['kidsfun'] },
      ];
      const cfg = { deprioritized_labels: ['kidsfun'] };
      expect(selectPrimaryMedia(media, cfg).contentId).toBe('s1');
    });

    it('T4: returns longest deprioritized video when every video is deprioritized (regression: 2026-04-29 Game Cycling)', () => {
      const media = [
        { contentId: 'plex:606445', mediaType: 'video', title: 'F-Zero',                  durationMs: 1314306, labels: ['kidsfun'] },
        { contentId: 'plex:606054', mediaType: 'video', title: 'Super Smash Bros Fitness', durationMs: 718078,  labels: ['kidsfun'] },
      ];
      const cfg = { deprioritized_labels: ['kidsfun'] };
      expect(selectPrimaryMedia(media, cfg).contentId).toBe('plex:606445');
    });

    it('T1 still wins when an eligible real workout exists alongside a longer deprioritized video', () => {
      const media = [
        { contentId: 'k1', mediaType: 'video', title: 'Cartoon Marathon', durationMs: 30 * 60_000, labels: ['kidsfun'] },
        { contentId: 'r1', mediaType: 'video', title: 'Real Workout',     durationMs: 6  * 60_000 },
      ];
      const cfg = { deprioritized_labels: ['kidsfun'] };
      expect(selectPrimaryMedia(media, cfg).contentId).toBe('r1');
    });

    it('returns null only when there are no non-audio items', () => {
      expect(selectPrimaryMedia([], {})).toBeNull();
      expect(selectPrimaryMedia([{ contentId: 'a', mediaType: 'audio', title: 'song', durationMs: 200_000 }], {})).toBeNull();
    });
  });
```

- [ ] **Step 3: Run the test file to confirm a mix of pass/fail**

```
/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/selectPrimaryMedia.test.js
```

(or `npx vitest run --config vitest.config.mjs frontend/src/hooks/fitness/selectPrimaryMedia.test.js`)

Expected (under current Plan 4 implementation):
- Plan 1-4 unchanged tests: PASS
- Plan 4 tests with updated assertions: FAIL (currently return null; assertions now expect content)
- New Plan 5 cascade tier tests: most FAIL (T2/T3/T4 paths don't exist yet); some may PASS coincidentally

Don't proceed if NO tests fail — that means the implementation is somehow already cascading.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/selectPrimaryMedia.test.js
git commit -m "test(fitness): cascade-tier expectations replacing null returns"
```

---

## Task 2: Update existing test expectations + add cascade tier tests (backend)

**Files:**
- Modify: `tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs`

Same shape as Task 1, in jest with event-shape data and seconds-based durations.

- [ ] **Step 1: Update Plan 4's "returns null" tests to expect the cascade tier results**

In the `describe('minimum primary duration floor (Plan 4)')` block:

**Update** `returns null when only a sub-floor non-warmup event survives (regression for 2026-04-30 session)`:

```javascript
  test('returns the sub-floor non-warmup event via cascade T2 (regression for 2026-04-30 session)', () => {
    const events = [
      videoEvent('F-Zero',              1254, { labels: ['kidsfun'] }),
      videoEvent('Strength Challenge 1', 48,  { labels: [] }),
    ];
    const cfg = { ...defaultConfig, deprioritized_labels: ['kidsfun'] };
    expect(selectPrimaryMedia(events, cfg).data.title).toBe('Strength Challenge 1');
  });
```

**Update** `returns null when only a deprioritized event exists`:

```javascript
  test('returns the deprioritized event via cascade T4 when nothing else exists', () => {
    const events = [videoEvent('Cartoon Marathon', 30 * 60, { labels: ['kidsfun'] })];
    const cfg = { ...defaultConfig, deprioritized_labels: ['kidsfun'] };
    expect(selectPrimaryMedia(events, cfg).data.title).toBe('Cartoon Marathon');
  });
```

**Update** `returns null when only a sub-floor real event exists`:

```javascript
  test('returns the sub-floor real event via cascade T2', () => {
    const events = [videoEvent('Quick Demo', 4 * 60)];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Quick Demo');
  });
```

**Update** `returns null when only sub-floor warmups exist`:

```javascript
  test('returns the sub-floor warmup via cascade T3', () => {
    const events = [videoEvent('Stretch', 4 * 60)];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Stretch');
  });
```

- [ ] **Step 2: Append a Plan 5 cascade-tier describe block at the end of the file**

```javascript
describe('cascading fallback tiers (Plan 5)', () => {
  test('T3: prefers non-deprioritized (warmup) over deprioritized (browsing)', () => {
    const events = [
      videoEvent('Stretch Routine', 8 * 60),
      videoEvent('Cartoon',        30 * 60, { labels: ['kidsfun'] }),
    ];
    const cfg = { ...defaultConfig, deprioritized_labels: ['kidsfun'] };
    expect(selectPrimaryMedia(events, cfg).data.title).toBe('Stretch Routine');
  });

  test('T4: returns longest deprioritized event when every event is deprioritized (regression: 2026-04-29)', () => {
    const events = [
      videoEvent('F-Zero',                  1314, { labels: ['kidsfun'] }),
      videoEvent('Super Smash Bros Fitness', 718, { labels: ['kidsfun'] }),
    ];
    const cfg = { ...defaultConfig, deprioritized_labels: ['kidsfun'] };
    expect(selectPrimaryMedia(events, cfg).data.title).toBe('F-Zero');
  });

  test('T1 still wins when an eligible real workout exists alongside a longer deprioritized event', () => {
    const events = [
      videoEvent('Cartoon Marathon', 30 * 60, { labels: ['kidsfun'] }),
      videoEvent('Real Workout',      6 * 60),
    ];
    const cfg = { ...defaultConfig, deprioritized_labels: ['kidsfun'] };
    expect(selectPrimaryMedia(events, cfg).data.title).toBe('Real Workout');
  });

  test('returns null only when there are no non-audio events', () => {
    expect(selectPrimaryMedia([], defaultConfig)).toBeNull();
    const audioOnly = [
      { type: 'media', data: { contentType: 'track', title: 'song', durationSeconds: 200, artist: 'X' } },
    ];
    expect(selectPrimaryMedia(audioOnly, defaultConfig)).toBeNull();
  });
});
```

- [ ] **Step 3: Run jest to confirm appropriate pass/fail mix**

```
npx jest tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs
```

Expected: similar mix as frontend — some failures due to the cascade not being implemented yet.

Note: in the previous Plan 4 backend implementation, the "filters out audio events" test was modified to use 8-min duration (was 60s). Under cascade rules, even 60s would now succeed at T2 (non-deprio non-warmup). But since the test's purpose is asserting audio is filtered out, the existing 8-min duration is fine — keep it.

Also: if the Plan 4 backend test "falls back to longest deprioritized when only deprioritized + audio" was renamed and flipped to `toBeNull()`, it must now flip BACK to pick the deprioritized — T4 picks it. Re-update that test to expect the deprioritized item and rename appropriately.

- [ ] **Step 4: Commit**

```bash
git add tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs
git commit -m "test(fitness): backend cascade-tier expectations replacing null returns"
```

---

## Task 3: Implement cascade in frontend

**Files:**
- Modify: `frontend/src/hooks/fitness/selectPrimaryMedia.js`

- [ ] **Step 1: Replace the function body Steps 3-6 with the cascade**

The current function body (post Plan 4) starts with audio filtering and the `isWarmup` / `isDeprioritized` helpers. Keep those intact. Replace EVERYTHING from `// Step 3: Build candidate pools` through the function's closing `}` with:

```javascript
  // Step 3: Constants for the cascade.
  const MIN_PRIMARY_MS = 5 * 60 * 1000;
  const TEN_MIN_MS = 10 * 60 * 1000;

  // Step 4: Tier 1 — Eligible real workouts (≥ MIN_PRIMARY_MS, non-warmup, non-deprio).
  // Positional bias when ≥2 are also ≥10 min — events are chronological so the LAST
  // one is almost always the actual main workout, not a warmup that survived filtering.
  const realCandidates = videos.filter(v => !isWarmup(v) && !isDeprioritized(v));
  const eligible = realCandidates.filter(v => (v.durationMs || 0) >= MIN_PRIMARY_MS);
  if (eligible.length > 0) {
    const longSurvivors = eligible.filter(v => (v.durationMs || 0) >= TEN_MIN_MS);
    if (longSurvivors.length >= 2) {
      return longSurvivors[longSurvivors.length - 1];
    }
    return eligible.reduce((best, item) =>
      (item.durationMs || 0) > (best.durationMs || 0) ? item : best
    );
  }

  // Step 5: Tier 2 — any real candidate (drops the floor, still non-warmup non-deprio).
  if (realCandidates.length > 0) {
    return realCandidates.reduce((best, item) =>
      (item.durationMs || 0) > (best.durationMs || 0) ? item : best
    );
  }

  // Step 6: Tier 3 — non-deprioritized of any kind (allows warmups but blocks browsing).
  // E.g. stretch-only sessions, or [stretch + cartoon] where stretch wins.
  const nonDeprio = videos.filter(v => !isDeprioritized(v));
  if (nonDeprio.length > 0) {
    return nonDeprio.reduce((best, item) =>
      (item.durationMs || 0) > (best.durationMs || 0) ? item : best
    );
  }

  // Step 7: Tier 4 — anything that survived audio filtering. Last-resort browsing.
  // E.g. Game Cycling sessions where every video is kidsfun-labeled.
  return videos.reduce((best, item) =>
    (item.durationMs || 0) > (best.durationMs || 0) ? item : best
  );
}
```

- [ ] **Step 2: Update the file-level JSDoc**

Replace the description block at the top of the file (lines describing Plan 4 behavior) with:

```
 * Filters out audio, then applies a four-tier cascade so every session that
 * has any video item ends up with a primary:
 *
 *   T1: Real workouts (non-warmup, non-deprioritized) ≥ MIN_PRIMARY_MS (5 min).
 *       When ≥2 are also ≥10 min, picks the LAST one (chronologically latest);
 *       otherwise picks the longest. This is the main success path.
 *   T2: Any real candidate (non-warmup, non-deprioritized) of any duration.
 *       Longest. (E.g. a 48-second strength demo when the only other content
 *       was a kidsfun-labeled track — the demo is still the user's intended
 *       workout, just brief.)
 *   T3: Non-deprioritized of any kind, allowing warmups but blocking
 *       browsing. Longest. (E.g. stretch-only sessions, or stretch + cartoon
 *       where stretch wins — never primary on browsing if a non-browsing
 *       alternative exists.)
 *   T4: Anything that survived audio filtering, including deprioritized.
 *       Longest. (E.g. Game Cycling sessions where every video is kidsfun;
 *       returns F-Zero rather than nothing.)
 *
 * Returns null only when there are no non-audio items at all.
```

- [ ] **Step 3: Run vitest**

```
/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/selectPrimaryMedia.test.js
```

Expected: ALL frontend tests PASS (Plan 1, Plan 4 updated, Plan 5 new).

If any test fails, STOP and inspect the cascade for off-by-one or tier-ordering errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/selectPrimaryMedia.js
git commit -m "fix(fitness): cascading fallback so every video session gets a primary"
```

---

## Task 4: Implement cascade in backend

**Files:**
- Modify: `backend/src/1_adapters/fitness/selectPrimaryMedia.mjs`

- [ ] **Step 1: Replace the function body with the cascade adapted for events**

The current body (post Plan 4 backend) starts with audio filtering, then has two branches (eligible-or-warmup-only). Replace EVERYTHING from `// Step 2: Build candidate pools` through the function's closing `}` with:

```javascript
  // Step 2: Constants for the cascade.
  const isWarmup = buildWarmupChecker(config);
  const isDeprioritized = buildDeprioritizedChecker(config);
  const MIN_PRIMARY_SEC = 5 * 60;
  const TEN_MIN_SEC = 10 * 60;

  // Step 3: Tier 1 — Eligible real workouts.
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

  // Step 4: Tier 2 — any real candidate (drops the floor).
  if (realCandidates.length > 0) {
    return realCandidates.reduce((best, event) => {
      const bestSec = best.data?.durationSeconds || 0;
      const evSec = event.data?.durationSeconds || 0;
      return evSec > bestSec ? event : best;
    });
  }

  // Step 5: Tier 3 — non-deprioritized of any kind (allows warmups, blocks browsing).
  const nonDeprio = episodes.filter(e => !isDeprioritized(e));
  if (nonDeprio.length > 0) {
    return nonDeprio.reduce((best, event) => {
      const bestSec = best.data?.durationSeconds || 0;
      const evSec = event.data?.durationSeconds || 0;
      return evSec > bestSec ? event : best;
    });
  }

  // Step 6: Tier 4 — anything that survived audio filtering. Last-resort browsing.
  return episodes.reduce((best, event) => {
    const bestSec = best.data?.durationSeconds || 0;
    const evSec = event.data?.durationSeconds || 0;
    return evSec > bestSec ? event : best;
  });
}
```

- [ ] **Step 2: Update file-level JSDoc to match the frontend's wording, adapted for events**

Use the same four-tier description as the frontend, substituting "events" / `data.durationSeconds` / "MIN_PRIMARY_SEC" / "5 min".

- [ ] **Step 3: Run jest**

```
npx jest tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs
```

Expected: all backend tests PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/1_adapters/fitness/selectPrimaryMedia.mjs
git commit -m "fix(fitness): backend cascading fallback so every video session gets a primary"
```

---

## Task 5: Backfill 2026-04-30 evening (re-add primary)

**Files:**
- Modify (in container): `data/household/history/fitness/2026-04-30/20260430192448.yml`

Plan 4 stripped `primary: true` from this session because the algorithm returned `null` for it. Under Plan 5's cascade, T2 returns Strength Challenge 1 (`plex:601458`). Restore the flag.

- [ ] **Step 1: Confirm pre-state — no primary present**

```bash
sudo docker exec daylight-station sh -c 'grep -nE "primary:|contentId: plex:" data/household/history/fitness/2026-04-30/20260430192448.yml | head -10'
```

Expected: NO `primary: true` line (Plan 4 backfill stripped it).

If a `primary: true` already exists, STOP and report — someone else may have edited.

- [ ] **Step 2: Add primary back to plex:601458**

```bash
sudo docker exec daylight-station node -e "
const yaml = require('js-yaml');
const fs = require('fs');
const path = 'data/household/history/fitness/2026-04-30/20260430192448.yml';
const obj = yaml.load(fs.readFileSync(path, 'utf8'));

if (!obj?.summary?.media) { console.error('no summary.media'); process.exit(1); }
const target = obj.summary.media.find(m => m.contentId === 'plex:601458');
if (!target) { console.error('expected plex:601458'); process.exit(1); }

console.log('before:', obj.summary.media.find(m => m.primary)?.contentId || '(no primary)');
target.primary = true;
fs.writeFileSync(path, yaml.dump(obj, { lineWidth: -1, noRefs: true }));

const after = yaml.load(fs.readFileSync(path, 'utf8'));
console.log('after :', after.summary.media.find(m => m.primary)?.contentId);
"
```

Expected:
```
before: (no primary)
after : plex:601458
```

- [ ] **Step 3: Verify integrity**

```bash
sudo docker exec daylight-station node -e "
const yaml = require('js-yaml');
const fs = require('fs');
const obj = yaml.load(fs.readFileSync('data/household/history/fitness/2026-04-30/20260430192448.yml', 'utf8'));
console.log('media count:', obj.summary.media.length);
console.log('primary count:', obj.summary.media.filter(m => m.primary).length);
console.log('primary contentId:', obj.summary.media.find(m => m.primary)?.contentId);
"
```

Expected: 3 media, 1 primary, contentId = `plex:601458`.

---

## Task 6: Verify 2026-04-29 (Bucket 3) primary

**Files:** read-only verification

Bucket 3 was deferred — `2026-04-29/20260429194446.yml` already has `primary: true` on F-Zero (`plex:606445`). Under Plan 5's cascade, T4 picks F-Zero (longest of all videos when all are deprioritized). So the existing flag is correct — no backfill needed, just confirm.

- [ ] **Step 1: Verify the file's current primary**

```bash
sudo docker exec daylight-station node -e "
const yaml = require('js-yaml');
const fs = require('fs');
const obj = yaml.load(fs.readFileSync('data/household/history/fitness/2026-04-29/20260429194446.yml', 'utf8'));
const m = obj.summary.media;
console.log('primary:', m.find(x => x.primary)?.contentId, '|', m.find(x => x.primary)?.title);
"
```

Expected: `plex:606445 | F-Zero`.

If anything else, STOP — someone may have changed the file.

---

## Task 7: Final sweep with cascade rules

**Files:** read-only sweep, no commits unless additional backfills are approved.

Re-run the sweep using the new cascade. Now that every session gets a primary, the only remaining "suspects" should be:
- Sessions whose primary is currently on something the cascade would NOT have picked (drift between historical data and current code)
- Note: under Plan 4 we backfilled 14 sessions to "longest video" via the user's per-task rule. Under Plan 5's cascade, those same 14 sessions might pick a different primary (e.g. now there's a tier-2 candidate where Plan 4 fell back to the only video). Worth flagging.

- [ ] **Step 1: Run the sweep that compares each session's current primary to the cascade's prediction**

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
const KIDSFUN = 'kidsfun';
const isKidsfun = m => Array.isArray(m.labels) && m.labels.map(l => String(l).toLowerCase()).includes(KIDSFUN);
const MIN_PRIMARY_MS = 5 * 60 * 1000;
const TEN_MIN_MS = 10 * 60 * 1000;

function cascadePick(media) {
  const videos = media.filter(m => m.mediaType !== 'audio');
  if (videos.length === 0) return null;
  const real = videos.filter(v => !isWarmupTitle(v.title) && !isKidsfun(v));
  const eligible = real.filter(v => (v.durationMs||0) >= MIN_PRIMARY_MS);
  if (eligible.length > 0) {
    const long = eligible.filter(v => (v.durationMs||0) >= TEN_MIN_MS);
    if (long.length >= 2) return long[long.length - 1];
    return eligible.reduce((b, v) => (v.durationMs||0) > (b.durationMs||0) ? v : b);
  }
  if (real.length > 0) return real.reduce((b, v) => (v.durationMs||0) > (b.durationMs||0) ? v : b);
  const nonDeprio = videos.filter(v => !isKidsfun(v));
  if (nonDeprio.length > 0) return nonDeprio.reduce((b, v) => (v.durationMs||0) > (b.durationMs||0) ? v : b);
  return videos.reduce((b, v) => (v.durationMs||0) > (b.durationMs||0) ? v : b);
}

const dates = fs.readdirSync(ROOT)
  .filter(d => /^\\d{4}-\\d{2}-\\d{2}\$/.test(d) && new Date(d) >= cutoff)
  .sort();

const drift = [];
let scanned = 0;
for (const d of dates) {
  const dir = path.join(ROOT, d);
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.yml'))) {
    let obj;
    try { obj = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    scanned++;
    const media = obj?.summary?.media;
    if (!Array.isArray(media)) continue;
    const current = media.find(m => m.primary);
    const predicted = cascadePick(media);
    if (!current && !predicted) continue;
    if (current?.contentId === predicted?.contentId) continue;
    drift.push({
      file: path.join(dir, f),
      currentPrimary: current ? { contentId: current.contentId, title: current.title, durationMs: current.durationMs } : null,
      cascadePicks:   predicted ? { contentId: predicted.contentId, title: predicted.title, durationMs: predicted.durationMs } : null,
    });
  }
}
console.log(JSON.stringify({ scanned, driftCount: drift.length, drift }, null, 2));
"
```

- [ ] **Step 2: Sanity check**

The two known-good sessions should NOT appear in drift:
- `2026-05-01/20260501061820.yml` — primary already on plex:674501 (Upper Body) which the cascade also picks (T1)
- `2026-04-30/20260430192448.yml` — after Task 5 backfill, primary on plex:601458 (Strength Challenge 1) which the cascade also picks (T2)
- `2026-04-29/20260429194446.yml` — primary on plex:606445 (F-Zero) which the cascade also picks (T4)

Drift entries that DO appear are sessions where Plan 4's "longest video as fallback" rule placed primary on a different item than Plan 5's cascade would. Most are likely "single-video session — same primary either way" (will not appear because they match). The ones that drift are sessions where there was a tier-2 candidate that wasn't the longest overall video (e.g. real workout video shorter than a kidsfun video).

- [ ] **Step 3: Report drift to user**

Present the JSON output. **Do NOT auto-backfill** drifted files. The user reviews and decides.

---

## Self-review

- [x] **Spec coverage:** User asked for cascading fallback so Bucket 3 always has a primary. Tier 1-4 cascade with explicit "non-deprioritized before deprioritized" preference satisfies that AND the "never browsing if alternative exists" principle. Frontend + backend both updated. Yesterday evening + Bucket 3 backfilled. Final drift sweep included.
- [x] **Placeholder scan:** No TBDs.
- [x] **Type consistency:** `MIN_PRIMARY_MS` (frontend) ↔ `MIN_PRIMARY_SEC` (backend); same cascade structure, same tier ordering.
- [x] **Test maintenance:** Plan 4 tests that previously expected `null` are explicitly rewritten to expect cascade-tier results in Tasks 1 & 2 — no test left in inconsistent state.
- [x] **Backfill ordering:** Task 5 (re-add primary on yesterday evening) is independent of code changes — runs against persisted data only. Task 6 verifies an existing primary is correct under new rules. Task 7 sweeps the whole window for drift.
- [x] **No regression of Plan 1's positional bias:** Tier 1 of the cascade IS Plan 1's positional bias logic, so it's preserved verbatim.
- [x] **Test for "stretch + cartoon" included** (Task 1 Step 2 and Task 2 Step 2): explicit assertion that warmup wins over browsing — encodes the user's stated principle.
- [x] **Final fallback returns longest of all videos:** maintains the user's directive that every session with any video should have a primary.
