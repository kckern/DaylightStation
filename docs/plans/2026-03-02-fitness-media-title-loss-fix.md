# Fitness Media Title Loss Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three bugs that cause media title/show metadata to be lost in persisted fitness sessions.

**Architecture:** Three independent fixes in the fitness frontend layer — a queue mechanism in FitnessSession to buffer events before timeline init, symmetric field sourcing in PersistenceManager consolidation, and expanded Plex metadata enrichment. Each fix is defense-in-depth: any one of them would have prevented the null-title bug in session `20260302124206`.

**Tech Stack:** React hooks, FitnessSession class, PersistenceManager class

**Audit reference:** `docs/_wip/audits/2026-03-02-fitness-media-title-loss-audit.md`

---

### Task 1: Queue media events when timeline is not ready (Bug 1 — primary fix)

When `FitnessSession.logEvent()` is called before the timeline exists (session not started yet), the event is silently dropped. The video player's `useEffect` fires `media_start` with all rich metadata before the timeline is ready — the data evaporates.

**Fix:** Instead of dropping the event, queue it. When `startSession()` creates the timeline, flush the queue.

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:393` (constructor init)
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:1304` (startSession — flush after timeline creation)
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:1941` (reset — clear queue)
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:2459-2468` (logEvent — queue instead of drop)

**Step 1: Add `_pendingEvents` init in constructor**

At line 393, after `this.timeline = null;`, add:

```javascript
    this.timeline = null;
    this._pendingEvents = [];
```

**Step 2: Update `logEvent` to queue when timeline is null**

Replace the current `logEvent` method (lines 2459–2468):

```javascript
  // BEFORE:
  logEvent(type, data = {}, timestamp) {
    if (!type) return null;
    if (!this.timeline) {
      getLogger().warn('fitness.session.logEvent_dropped', {
        type,
        sessionId: this.sessionId || null,
        reason: this.sessionId ? 'timeline_null_after_start' : 'session_not_started'
      });
      return null;
    }
    return this.timeline.logEvent(type, data, timestamp);
  }
```

```javascript
  // AFTER:
  logEvent(type, data = {}, timestamp) {
    if (!type) return null;
    if (!this.timeline) {
      const ts = timestamp || Date.now();
      const entry = { timestamp: ts, type, data: { ...data }, queued: true };
      this._pendingEvents.push(entry);
      getLogger().debug('fitness.session.logEvent_queued', {
        type, sessionId: this.sessionId || null
      });
      return entry;
    }
    return this.timeline.logEvent(type, data, timestamp);
  }
```

Key changes:
- Returns a truthy marker object (so `FitnessPlayer.jsx` line 1041 `if (logged)` succeeds)
- Queues the event with a shallow clone of `data` (prevents mutation issues)
- Downgrades from `warn` to `debug` since queuing is now expected behavior, not data loss

**Step 3: Flush queue in `startSession` after timeline creation**

At line 1308 (after `this._pendingSnapshotRef = null;`), add:

```javascript
    this._pendingSnapshotRef = null;

    // Flush any events that were queued before the timeline was ready
    if (this._pendingEvents.length > 0) {
      getLogger().info('fitness.session.flush_pending_events', {
        sessionId: this.sessionId, count: this._pendingEvents.length
      });
      for (const evt of this._pendingEvents) {
        this.timeline.logEvent(evt.type, evt.data, evt.timestamp);
      }
      this._pendingEvents = [];
    }
```

**Step 4: Clear queue on session reset**

At line 1941, after `this.timeline = null;`, add:

```javascript
    this.timeline = null;
    this._pendingEvents = [];
```

**Step 5: Verify build**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation/frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js
git commit -m "fix(fitness): queue media events when timeline not ready instead of dropping them"
```

---

### Task 2: Guard `media_end` cleanup on successful `media_start` (Bug 1 — safety net)

Currently the React cleanup function (which fires `media_end`) is ALWAYS returned, even when `media_start` failed. This creates orphaned `media_end` events with no matching `media_start`. With Task 1's queue fix, `logged` will now be truthy even for queued events, so this guard is defense-in-depth.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx:1041-1061`

**Step 1: Move cleanup return inside the `if (logged)` block**

Replace lines 1041–1061:

```javascript
  // BEFORE (lines 1041-1061):
    if (logged) {
      loggedVideoMediaRef.current = currentMediaIdentity;
    }
    // Prod-visible log for autoplay SSoT verification
    getLogger().info('fitness.media_start.autoplay', {
      contentId: currentMediaIdentity,
      autoplay: autoplayEnabled,
      videoLocked: governanceState?.videoLocked ?? null,
      isGoverned: governanceState?.isGoverned ?? null,
      governancePhase: governanceState?.status ?? null,
      labels: Array.isArray(media.labels) ? media.labels : []
    });
    return () => {
      // Log media_end for the media that's being replaced
      if (currentMediaIdentity && session) {
        session.logEvent('media_end', {
          contentId: currentMediaIdentity,
          source: 'video_player',
        });
      }
    };
```

```javascript
  // AFTER:
    // Prod-visible log for autoplay SSoT verification
    getLogger().info('fitness.media_start.autoplay', {
      contentId: currentMediaIdentity,
      autoplay: autoplayEnabled,
      videoLocked: governanceState?.videoLocked ?? null,
      isGoverned: governanceState?.isGoverned ?? null,
      governancePhase: governanceState?.status ?? null,
      labels: Array.isArray(media.labels) ? media.labels : []
    });
    if (logged) {
      loggedVideoMediaRef.current = currentMediaIdentity;
      return () => {
        if (currentMediaIdentity && session) {
          session.logEvent('media_end', {
            contentId: currentMediaIdentity,
            source: 'video_player',
          });
        }
      };
    }
    // No cleanup — media_start wasn't logged or queued, effect will retry
```

**Step 2: Verify build**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation/frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx
git commit -m "fix(fitness): only register media_end cleanup when media_start was accepted"
```

---

### Task 3: Fix asymmetric field sourcing in `_consolidateEvents` (Bug 2)

When pairing `media_start` + `media_end` into a consolidated `media` event, 8 fields only read from `startEvt`. If `startEvt` is null (or was queued with incomplete data in some edge case), these fields become null even if `endEvt` has the data.

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:455-465`

**Step 1: Add endEvt fallback for all fields**

Replace the field assignments in the consolidated media event (the lines inside `data: { ... }` that only check `s`):

```javascript
  // BEFORE:
      grandparentTitle: s.grandparentTitle || null,
      parentTitle: s.parentTitle || null,
      grandparentId: s.grandparentId || null,
      parentId: s.parentId || null,
      labels: s.labels || [],
      contentType: s.type || (s.artist ? 'track' : null) || null,
      artist: s.artist || null,
      governed: s.governed ?? null,
```

```javascript
  // AFTER:
      grandparentTitle: s.grandparentTitle || e.grandparentTitle || null,
      parentTitle: s.parentTitle || e.parentTitle || null,
      grandparentId: s.grandparentId || e.grandparentId || null,
      parentId: s.parentId || e.parentId || null,
      labels: s.labels || e.labels || [],
      contentType: s.type || e.type || (s.artist || e.artist ? 'track' : null) || null,
      artist: s.artist || e.artist || null,
      governed: s.governed ?? e.governed ?? null,
```

**Step 2: Verify build**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation/frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/PersistenceManager.js
git commit -m "fix(fitness): fall through to endEvt for all fields in media event consolidation"
```

---

### Task 4: Expand Plex enrichment to include title metadata (Bug 3)

`_enrichMissingPlexDescriptions` fetches Plex API metadata but only extracts `summary` → `description`. The same API response contains `title`, `grandparentTitle`, and `parentTitle` — all discarded. Rename and expand the method to enrich all missing fields.

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:1022` (call site)
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:1050-1078` (method)

**Step 1: Update the call site (line 1022)**

```javascript
  // BEFORE:
    this._enrichMissingPlexDescriptions(persistSessionData.timeline?.events)
  // AFTER:
    this._enrichMissingPlexMetadata(persistSessionData.timeline?.events)
```

**Step 2: Replace the method (lines 1050-1078)**

```javascript
  // BEFORE:
  async _enrichMissingPlexDescriptions(events) {
    if (!Array.isArray(events)) return;

    const toFetch = events.filter(evt => {
      if (evt?.type !== 'media') return false;
      const d = evt.data || {};
      if (d.description) return false;
      if (d.artist || d.contentType === 'track') return false;
      return (d.contentId || '').startsWith('plex:');
    });

    if (toFetch.length === 0) return;

    getLogger().debug('fitness.persistence.plex_enrich_start', { count: toFetch.length });

    await Promise.all(toFetch.map(async (evt) => {
      const plexId = evt.data.contentId.split(':', 2)[1];
      try {
        const resp = await this._persistApi(`api/v1/info/plex/${plexId}`, {}, 'GET');
        const summary = resp?.metadata?.summary;
        if (summary) {
          evt.data.description = summary.replace(/\s+/g, ' ').trim();
          getLogger().debug('fitness.persistence.plex_enrich_hit', { plexId });
        }
      } catch (err) {
        getLogger().warn('fitness.persistence.plex_enrich_fail', { plexId, error: err?.message });
      }
    }));
  }
```

```javascript
  // AFTER:
  async _enrichMissingPlexMetadata(events) {
    if (!Array.isArray(events)) return;

    const toFetch = events.filter(evt => {
      if (evt?.type !== 'media') return false;
      const d = evt.data || {};
      if (d.artist || d.contentType === 'track') return false;
      if (!(d.contentId || '').startsWith('plex:')) return false;
      // Enrich if any metadata field is missing
      return !d.description || !d.title || !d.grandparentTitle;
    });

    if (toFetch.length === 0) return;

    getLogger().debug('fitness.persistence.plex_enrich_start', { count: toFetch.length });

    await Promise.all(toFetch.map(async (evt) => {
      const plexId = evt.data.contentId.split(':', 2)[1];
      try {
        const resp = await this._persistApi(`api/v1/info/plex/${plexId}`, {}, 'GET');
        const meta = resp?.metadata;
        if (!meta) return;
        const enriched = [];
        if (meta.summary && !evt.data.description) {
          evt.data.description = meta.summary.replace(/\s+/g, ' ').trim();
          enriched.push('description');
        }
        if (meta.title && !evt.data.title) {
          evt.data.title = meta.title;
          enriched.push('title');
        }
        if (meta.grandparentTitle && !evt.data.grandparentTitle) {
          evt.data.grandparentTitle = meta.grandparentTitle;
          enriched.push('grandparentTitle');
        }
        if (meta.parentTitle && !evt.data.parentTitle) {
          evt.data.parentTitle = meta.parentTitle;
          enriched.push('parentTitle');
        }
        if (enriched.length > 0) {
          getLogger().debug('fitness.persistence.plex_enrich_hit', { plexId, enriched });
        }
      } catch (err) {
        getLogger().warn('fitness.persistence.plex_enrich_fail', { plexId, error: err?.message });
      }
    }));
  }
```

Key changes:
- Renamed `_enrichMissingPlexDescriptions` → `_enrichMissingPlexMetadata`
- Filter triggers when ANY of `description`, `title`, `grandparentTitle` is missing (not just `description`)
- Enriches `title`, `grandparentTitle`, `parentTitle` in addition to `description`
- Only writes fields that are actually missing (won't overwrite existing data)
- Logs which fields were enriched

**Step 3: Verify build**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation/frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/PersistenceManager.js
git commit -m "fix(fitness): expand Plex enrichment to backfill title, grandparentTitle, parentTitle"
```

---

## Verification

After all tasks are complete, verify the full fix chain with a live fitness session:

1. Start a fitness session with a Plex video already playing
2. Check frontend logs for `fitness.session.logEvent_queued` (confirms Task 1 queuing)
3. Check frontend logs for `fitness.session.flush_pending_events` (confirms Task 1 flush)
4. End the session and check persisted YAML for non-null `title`, `grandparentTitle`, `parentTitle`
5. If any titles are still null, check for `fitness.persistence.plex_enrich_hit` log (confirms Task 4 backfill)

---

## Summary

| Task | Bug | Fix | Files |
|------|-----|-----|-------|
| 1 | media_start dropped (timeline not ready) | Queue events, flush on timeline init | FitnessSession.js |
| 2 | Orphaned media_end without media_start | Guard cleanup on successful media_start | FitnessPlayer.jsx |
| 3 | Consolidation ignores endEvt fields | Fall through to endEvt for all fields | PersistenceManager.js |
| 4 | Plex enrichment ignores title fields | Expand to enrich all metadata | PersistenceManager.js |
