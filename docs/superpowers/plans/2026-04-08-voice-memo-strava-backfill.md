# Voice Memo → Strava Description Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a voice memo is transcribed for a session that already has a Strava activityId, rebuild and push the Strava description to include the memo text.

**Architecture:** Add a `reEnrichDescription(sessionId, newMemo)` method to `FitnessActivityEnrichmentService`. Call it fire-and-forget from the voice memo API handler after transcription succeeds. The method loads the session from disk, injects the new memo into a copy of the timeline events (since the frontend hasn't saved the session yet), rebuilds the description via `buildStravaDescription`, compares with the current Strava description, and pushes if different.

**Tech Stack:** Node.js/Express, existing StravaClientAdapter, buildStravaDescription, YAML session files

---

### Task 1: Add `reEnrichDescription` method to FitnessActivityEnrichmentService

**Files:**
- Modify: `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs`

- [ ] **Step 1: Add the `reEnrichDescription` method after `_addToCooldown` (line ~613)**

Add this method to the class body, before the closing brace:

```javascript
  /**
   * Re-enrich a Strava activity description after a voice memo is added.
   * Loads the session from disk, injects the new memo into timeline events,
   * rebuilds the description, and pushes to Strava if it changed.
   *
   * Fire-and-forget — callers should .catch() errors.
   *
   * @param {string} sessionId - Session ID (YYYYMMDDHHmmss format)
   * @param {Object} newMemo - Transcribed memo object from VoiceMemoTranscriptionService
   * @param {string} newMemo.transcriptClean - Cleaned transcript text
   * @param {number} [newMemo.startedAt] - Memo start timestamp (epoch ms)
   * @param {number} [newMemo.durationSeconds] - Memo duration
   */
  async reEnrichDescription(sessionId, newMemo) {
    if (!sessionId || !newMemo?.transcriptClean) return;

    // Derive date directory from sessionId (first 8 chars = YYYYMMDD)
    const dateStr = `${sessionId.slice(0, 4)}-${sessionId.slice(4, 6)}-${sessionId.slice(6, 8)}`;
    const filePath = path.join(this.#fitnessHistoryDir, dateStr, `${sessionId}.yml`);
    const session = loadYamlSafe(filePath);

    if (!session) {
      this.#logger.debug?.('strava.voice_memo_backfill.no_session', { sessionId, filePath });
      return;
    }

    // Extract activityId from session
    const activityId = this.#extractActivityId(session);
    if (!activityId) {
      this.#logger.debug?.('strava.voice_memo_backfill.no_activity_id', { sessionId });
      return;
    }

    // Inject the new memo into a copy of timeline events (session on disk doesn't have it yet)
    const augmentedSession = {
      ...session,
      timeline: {
        ...session.timeline,
        events: [
          ...(session.timeline?.events || []),
          {
            timestamp: newMemo.startedAt || Date.now(),
            type: 'voice_memo',
            data: {
              transcript: newMemo.transcriptClean,
              duration_seconds: newMemo.durationSeconds || 0,
            },
          },
        ],
      },
    };

    // Read warmup config
    const fitnessConfig = this.#configService.getAppConfig('fitness');
    const plex = fitnessConfig?.plex || {};
    const warmupConfig = {
      warmup_labels: plex.warmup_labels || [],
      warmup_description_tags: plex.warmup_description_tags || [],
      warmup_title_patterns: plex.warmup_title_patterns || [],
    };

    // Build fresh description with the new memo included
    const enrichment = buildStravaDescription(augmentedSession, {}, warmupConfig);
    if (!enrichment?.description) {
      this.#logger.debug?.('strava.voice_memo_backfill.no_description', { sessionId, activityId });
      return;
    }

    // Ensure auth
    await this._ensureAuth();

    // Fetch current Strava activity to compare
    const currentActivity = await this.#stravaClient.getActivity(activityId);
    if (currentActivity?.description?.trim() === enrichment.description.trim()) {
      this.#logger.debug?.('strava.voice_memo_backfill.unchanged', { sessionId, activityId });
      return;
    }

    // Push description only
    await this.#stravaClient.updateActivity(activityId, { description: enrichment.description });

    this.#logger.info?.('strava.voice_memo_backfill.pushed', {
      sessionId,
      activityId,
      descriptionLength: enrichment.description.length,
    });
  }

  /**
   * Extract a Strava activityId from session data.
   * @private
   */
  #extractActivityId(session) {
    if (session.strava?.activityId) return String(session.strava.activityId);
    for (const participant of Object.values(session.participants || {})) {
      if (participant?.strava?.activityId) return String(participant.strava.activityId);
    }
    return null;
  }
```

**Important:** The `#extractActivityId` method already exists in `StravaReconciliationService` but not in `FitnessActivityEnrichmentService`. We need it here. Check if it already exists in the class — if so, reuse it. If not, add it as shown above.

- [ ] **Step 2: Verify the method compiles by checking the file for syntax errors**

Run: `node -c backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs`
Expected: no syntax errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs
git commit -m "feat(fitness): add reEnrichDescription for voice memo backfill to Strava"
```

---

### Task 2: Wire up the call site in the fitness API router

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs:577-610` (voice_memo handler)

- [ ] **Step 1: Add the re-enrichment call after transcription succeeds**

In the `POST /api/fitness/voice_memo` handler (line ~577), after the `transcribeVoiceMemo` call succeeds and before the response is sent, add the fire-and-forget re-enrichment. Change lines 601-605 from:

```javascript
      const memo = await transcriptionService.transcribeVoiceMemo({
        audioBase64,
        mimeType,
        sessionId,
        startedAt,
        endedAt,
        context: {
          ...sessionContext,
          householdMembers
        }
      });

      return res.json({ ok: true, memo });
```

To:

```javascript
      const memo = await transcriptionService.transcribeVoiceMemo({
        audioBase64,
        mimeType,
        sessionId,
        startedAt,
        endedAt,
        context: {
          ...sessionContext,
          householdMembers
        }
      });

      // Fire-and-forget: backfill Strava description with the new voice memo
      if (sessionId && memo?.transcriptClean && memo.transcriptClean !== '[No Memo]' && enrichmentService) {
        enrichmentService.reEnrichDescription(sessionId, memo).catch(err => {
          logger.warn?.('strava.voice_memo_backfill.failed', {
            sessionId,
            error: err?.message,
          });
        });
      }

      return res.json({ ok: true, memo });
```

- [ ] **Step 2: Verify syntax**

Run: `node -c backend/src/4_api/v1/routers/fitness.mjs`
Expected: no syntax errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs
git commit -m "feat(fitness): trigger Strava description backfill after voice memo transcription"
```

---

### Task 3: Manual integration test

- [ ] **Step 1: Verify the enrichment service is wired up in the bootstrap**

Check that `enrichmentService` is passed to `createFitnessRouter` in the bootstrap. It's already referenced in the webhook handler (line ~838), so it should be wired.

Run: `grep -n 'enrichmentService' backend/src/0_system/bootstrap/*.mjs` (or equivalent bootstrap file)
Expected: find where `enrichmentService` is created and passed to the router config

- [ ] **Step 2: Test with a curl call**

Start or ensure dev server is running. Find a recent session with a Strava activityId:

```bash
sudo docker exec daylight-station sh -c 'cat data/household/history/fitness/2026-04-06/20260406060032.yml | head -30'
```

Confirm it has `strava.activityId`. Then test the voice memo endpoint with a fake memo to verify the backfill fires (check logs for `strava.voice_memo_backfill.*` entries):

```bash
curl -s -X POST http://localhost:3112/api/fitness/voice_memo \
  -H "Content-Type: application/json" \
  -d '{"audioBase64":"...", "sessionId":"20260406060032"}'
```

(This will fail transcription since audioBase64 is fake, but confirms the wiring. For a real test, use an actual voice memo recording.)

- [ ] **Step 3: Check dev server logs for backfill log entries**

Look for `strava.voice_memo_backfill.pushed` or `strava.voice_memo_backfill.no_activity_id` in the output to confirm the code path is being hit.
