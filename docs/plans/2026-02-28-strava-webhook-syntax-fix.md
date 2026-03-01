# Strava Webhook Adapter Syntax Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the syntax error in `buildStravaDescription.mjs` that prevents the entire Strava webhook enrichment subsystem from initializing, add unit tests, and harden startup error handling to prevent silent subsystem failures.

**Architecture:** Remove the dead-code line (line 42) that mixes `??` and `&&` without parentheses. Add comprehensive unit tests for `buildStravaDescription`. Promote the init failure log from `warn` to `error` and add a startup health assertion when Strava credentials are configured.

**Tech Stack:** Node.js ES modules, Jest (via unit harness)

---

## Context

**Audit:** `docs/_wip/audits/2026-02-28-strava-webhook-adapter-init-failure.md`

A syntax error on line 42 of `buildStravaDescription.mjs` prevents the module from parsing. The line `?? summary?.media?.find(m => m?.mediaType !== 'audio' && m?.primary)?.title && null` mixes `??` (nullish coalescing) with `&&` (logical AND) without parentheses — forbidden by ECMAScript. Additionally, `&& null` is logically dead code (always evaluates to `null`). The `_selectPrimaryEpisode()` and subsequent `??` fallbacks already cover the intended behavior.

The failure cascades: `FitnessActivityEnrichmentService` can't import `buildStravaDescription` → the dynamic import in `app.mjs` throws → the catch block logs a `warn` and silently leaves `providerWebhookAdapters` empty → all webhooks are discarded as "unknown."

---

### Task 1: Write unit tests for `buildStravaDescription`

**Why first:** Capture current expected behavior before touching the code. The test file doesn't exist yet. This follows TDD — write the test, confirm it fails (because of the syntax error), then fix.

**Files:**
- Create: `tests/unit/suite/fitness/buildStravaDescription.test.mjs`

**Step 1: Create the test file**

```javascript
/**
 * Unit tests for buildStravaDescription
 *
 * Tests the pure function that builds Strava activity enrichment payloads
 * from DaylightStation fitness sessions.
 */

import { buildStravaDescription } from '../../../../backend/src/1_adapters/fitness/buildStravaDescription.mjs';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST DATA FACTORIES
// ═══════════════════════════════════════════════════════════════════════════════

function createSession(overrides = {}) {
  return {
    session: { duration_seconds: 3600, start: '2026-02-28T19:00:00', ...overrides.session },
    timeline: { events: overrides.events || [] },
    summary: overrides.summary || {},
    participants: overrides.participants || {},
  };
}

function createMediaEvent(overrides = {}) {
  const now = Date.now();
  return {
    type: 'media',
    timestamp: now,
    data: {
      contentType: 'episode',
      grandparentTitle: 'Show Name',
      title: 'Episode Title',
      durationSeconds: 1800,
      start: now,
      end: now + 30 * 60 * 1000, // 30 min
      ...overrides,
    },
  };
}

function createMusicEvent(overrides = {}) {
  return {
    type: 'media',
    timestamp: Date.now(),
    data: {
      contentType: 'track',
      artist: 'Artist Name',
      title: 'Track Title',
      ...overrides,
    },
  };
}

function createVoiceMemo(transcript = 'Test memo') {
  return {
    type: 'voice_memo',
    timestamp: Date.now(),
    data: { transcript },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// NULL / EMPTY CASES
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildStravaDescription', () => {
  describe('null/empty inputs', () => {
    test('returns null for undefined session', () => {
      expect(buildStravaDescription(undefined)).toBeNull();
    });

    test('returns null for empty session (no events)', () => {
      const session = createSession();
      expect(buildStravaDescription(session)).toBeNull();
    });

    test('returns null for session with only brief media (<2 min)', () => {
      const now = Date.now();
      const session = createSession({
        events: [
          createMediaEvent({
            start: now,
            end: now + 60 * 1000, // 1 min — below MIN_WATCH_MS
            durationSeconds: 60,
          }),
        ],
      });
      expect(buildStravaDescription(session)).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TITLE (name) GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('title generation', () => {
    test('builds "Show—Episode" title from primary episode', () => {
      const session = createSession({
        events: [createMediaEvent()],
      });
      const result = buildStravaDescription(session);
      expect(result).not.toBeNull();
      expect(result.name).toBe('Show Name\u2014Episode Title');
    });

    test('uses show name only when no episode title', () => {
      const session = createSession({
        events: [createMediaEvent({ title: null })],
      });
      const result = buildStravaDescription(session);
      expect(result.name).toBe('Show Name');
    });

    test('uses episode title only when no show name', () => {
      const session = createSession({
        events: [createMediaEvent({ grandparentTitle: null })],
      });
      const result = buildStravaDescription(session);
      expect(result.name).toBe('Episode Title');
    });

    test('picks longest episode as primary (by durationSeconds)', () => {
      const now = Date.now();
      const session = createSession({
        events: [
          createMediaEvent({
            grandparentTitle: 'Short Show',
            title: 'Short Ep',
            durationSeconds: 600,
            start: now,
            end: now + 10 * 60 * 1000,
          }),
          createMediaEvent({
            grandparentTitle: 'Long Show',
            title: 'Long Ep',
            durationSeconds: 1800,
            start: now,
            end: now + 30 * 60 * 1000,
          }),
        ],
      });
      const result = buildStravaDescription(session);
      expect(result.name).toBe('Long Show\u2014Long Ep');
    });

    test('skips title if currentActivity already has em-dash title', () => {
      const session = createSession({
        events: [createMediaEvent()],
      });
      const result = buildStravaDescription(session, { name: 'Already\u2014Set' });
      // Title should be null (already enriched), but description may still be set
      expect(result === null || result.name === null).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DESCRIPTION GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('description generation', () => {
    test('includes voice memos in description', () => {
      const session = createSession({
        events: [
          createMediaEvent(),
          createVoiceMemo('Great workout today'),
        ],
      });
      const result = buildStravaDescription(session);
      expect(result.description).toContain('Great workout today');
      expect(result.description).toContain('\uD83C\uDF99\uFE0F');
    });

    test('includes episode descriptions', () => {
      const session = createSession({
        events: [
          createMediaEvent({ description: 'A thrilling episode about fitness.' }),
        ],
      });
      const result = buildStravaDescription(session);
      expect(result.description).toContain('A thrilling episode about fitness.');
      expect(result.description).toContain('\uD83D\uDDA5\uFE0F');
    });

    test('includes music playlist', () => {
      const session = createSession({
        events: [createMusicEvent()],
      });
      const result = buildStravaDescription(session);
      expect(result.description).toContain('Artist Name');
      expect(result.description).toContain('Track Title');
      expect(result.description).toContain('\uD83C\uDFB5 Playlist');
    });

    test('skips description if currentActivity already has one', () => {
      const session = createSession({
        events: [createMediaEvent()],
      });
      const result = buildStravaDescription(session, {
        description: 'Already has a description',
      });
      expect(result.description).toBeNull();
    });

    test('returns null when only description would be set but already exists', () => {
      const session = createSession({
        events: [createMediaEvent()],
      });
      const result = buildStravaDescription(session, {
        name: 'Show Name\u2014Episode Title',
        description: 'Existing',
      });
      // Both name and description already set → nothing to enrich
      expect(result).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EPISODE FILTERING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('episode watch-time filtering', () => {
    test('filters out episodes watched < 2 minutes', () => {
      const now = Date.now();
      const session = createSession({
        session: { duration_seconds: 3600 },
        events: [
          createMediaEvent({
            grandparentTitle: 'Brief',
            title: 'Brief Ep',
            start: now,
            end: now + 60 * 1000, // 1 min
            durationSeconds: 60,
          }),
          createMediaEvent({
            grandparentTitle: 'Long',
            title: 'Long Ep',
            start: now + 60 * 1000,
            end: now + 31 * 60 * 1000, // 30 min
            durationSeconds: 1800,
          }),
        ],
      });
      const result = buildStravaDescription(session);
      // Description should only include the long episode
      expect(result.description).toContain('Long');
      expect(result.description).not.toContain('Brief');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MUSIC-ONLY SESSIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('music-only sessions', () => {
    test('returns playlist description with no title', () => {
      const session = createSession({
        events: [
          createMusicEvent({ artist: 'Radiohead', title: 'Everything In Its Right Place' }),
          createMusicEvent({ artist: 'Boards of Canada', title: 'Roygbiv' }),
        ],
      });
      const result = buildStravaDescription(session);
      expect(result.name).toBeNull();
      expect(result.description).toContain('Radiohead');
      expect(result.description).toContain('Boards of Canada');
    });
  });
});
```

**Step 2: Run the test — expect FAIL (syntax error)**

Run: `node tests/unit/harness.mjs --pattern=buildStravaDescription`
Expected: FAIL — `SyntaxError: Unexpected token '&&'` when importing the module

---

### Task 2: Fix the syntax error in `buildStravaDescription.mjs`

**Files:**
- Modify: `backend/src/1_adapters/fitness/buildStravaDescription.mjs:40-44`

**Step 1: Remove the dead-code line**

Replace lines 40–44:

```javascript
  // Primary episode = longest full video (durationSeconds), fallback to first watched
  const primaryMedia = _selectPrimaryEpisode(watchedEpisodes)
    ?? _selectPrimaryEpisode(episodeEvents)
    ?? summary?.media?.find(m => m?.mediaType !== 'audio' && m?.primary)?.title && null
    ?? summary?.media?.find(m => m?.mediaType !== 'audio')
    ?? null;
```

With:

```javascript
  // Primary episode = longest full video (durationSeconds), fallback to first watched
  const primaryMedia = _selectPrimaryEpisode(watchedEpisodes)
    ?? _selectPrimaryEpisode(episodeEvents)
    ?? summary?.media?.find(m => m?.mediaType !== 'audio')
    ?? null;
```

**Why remove line 42 entirely:**
- `?? x && null` always evaluates to `null` regardless of `x` — it's dead code
- Even if fixed to extract `.title`, it would return a string, but `primaryMedia` is consumed as an object (`.grandparentTitle`, `.title`, `.showTitle` properties) — a bare string would break downstream
- The next fallback (`summary?.media?.find(...)`) already covers the intended case without the `.primary` filter

**Step 2: Verify the file parses**

Run: `node --check backend/src/1_adapters/fitness/buildStravaDescription.mjs`
Expected: Exit 0, no output (syntax OK)

**Step 3: Run the tests — expect PASS**

Run: `node tests/unit/harness.mjs --pattern=buildStravaDescription`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add backend/src/1_adapters/fitness/buildStravaDescription.mjs tests/unit/suite/fitness/buildStravaDescription.test.mjs
git commit -m "fix(fitness): remove dead-code line causing SyntaxError in buildStravaDescription

Line 42 mixed ?? and && without parentheses (ECMAScript forbids this).
The line was also logically dead code — '&& null' always evaluates to null.
Removing it restores the Strava webhook enrichment subsystem.

Adds unit tests for buildStravaDescription."
```

---

### Task 3: Promote `strava.enrichment.init_failed` from `warn` to `error`

**Files:**
- Modify: `backend/src/app.mjs:1303`

**Step 1: Change `warn` to `error` in the catch block**

In `backend/src/app.mjs`, find:

```javascript
  } catch (err) {
    rootLogger.warn?.('strava.enrichment.init_failed', { error: err?.message });
  }
```

Replace with:

```javascript
  } catch (err) {
    rootLogger.error?.('strava.enrichment.init_failed', { error: err?.message, stack: err?.stack });
  }
```

**Why:** This is a critical subsystem failure, not a warning. The entire real-time enrichment pipeline is dead when this fires. Logging it as `error` ensures it triggers alerts and is visible in error dashboards.

**Step 2: Commit**

```bash
git add backend/src/app.mjs
git commit -m "fix(fitness): promote strava.enrichment.init_failed to error level

This is a critical subsystem failure that silently disables all real-time
Strava enrichment. Logging as error ensures visibility in monitoring."
```

---

### Task 4: Add startup health assertion for webhook adapters

**Files:**
- Modify: `backend/src/app.mjs:1301-1305`

**Step 1: Add post-init validation**

After the `rootLogger.info?.('strava.enrichment.initialized')` line (1301) and before the catch block, add a health check. Find:

```javascript
      providerWebhookAdapters = { strava: stravaWebhookAdapter };

      // Recover pending jobs on startup
      stravaEnrichmentService.recoverPendingJobs();

      rootLogger.info?.('strava.enrichment.initialized');
    }
  } catch (err) {
    rootLogger.error?.('strava.enrichment.init_failed', { error: err?.message, stack: err?.stack });
  }
```

Replace with:

```javascript
      providerWebhookAdapters = { strava: stravaWebhookAdapter };

      // Recover pending jobs on startup
      stravaEnrichmentService.recoverPendingJobs();

      rootLogger.info?.('strava.enrichment.initialized', {
        adapters: Object.keys(providerWebhookAdapters),
      });
    }
  } catch (err) {
    rootLogger.error?.('strava.enrichment.init_failed', { error: err?.message, stack: err?.stack });
  }

  // Health check: warn if Strava creds are configured but no adapters registered
  if (configService.getSystemAuth?.('strava', 'client_id') && Object.keys(providerWebhookAdapters).length === 0) {
    rootLogger.error?.('strava.enrichment.health_check_failed', {
      reason: 'Strava credentials configured but no webhook adapters registered — enrichment is dead',
    });
  }
```

**Why:** This catches the failure mode where init throws but is silently swallowed. The health check runs after the try/catch so it detects the empty `providerWebhookAdapters` even when the error was caught.

**Step 2: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(fitness): add startup health check for Strava webhook adapters

Logs an error if Strava credentials are configured but no webhook
adapters were registered, catching silent init failures."
```

---

### Task 5: Verify end-to-end on local dev

**Step 1: Parse-check all affected modules**

Run:
```bash
node --check backend/src/1_adapters/fitness/buildStravaDescription.mjs && \
node --check backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs
```
Expected: Exit 0 for both (no syntax errors)

**Step 2: Run unit tests**

Run: `node tests/unit/harness.mjs --pattern=buildStravaDescription`
Expected: All tests PASS

**Step 3: Run full unit suite (regression check)**

Run: `node tests/unit/harness.mjs`
Expected: No regressions

---

### Task 6: Archive the WIP audit doc

**Files:**
- Modify: `docs/_wip/audits/2026-02-28-strava-webhook-adapter-init-failure.md` — add resolution note at top

**Step 1: Add resolution header**

Prepend to the audit doc:

```markdown
> **Resolved:** 2026-02-28. Syntax error removed (line 42 deleted), init_failed promoted to error, health check added. See commit history.

```

**Step 2: Commit**

```bash
git add docs/_wip/audits/2026-02-28-strava-webhook-adapter-init-failure.md
git commit -m "docs: mark strava webhook init failure audit as resolved"
```

---

## Post-Deploy (Manual)

After deploying the fix:

1. **Verify init succeeds:**
   ```bash
   ssh homeserver.local 'docker logs daylight-station 2>&1 | grep "strava.enrichment.initialized"'
   ```

2. **Backfill missed enrichments:** Trigger a manual harvest with enrichment enabled for activities created since 2026-02-28T15:45Z. This is a manual operation — do not automate in this plan.
