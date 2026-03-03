# Fitness Session Media Title/Show Loss Audit

**Date:** 2026-03-02
**Triggered by:** Session `20260302124206` — Plex video `plex:600174` persisted with `title: null`, `grandparentTitle: null` (show name), `parentTitle: null` (season). Description was enriched correctly ("You'll be slowing down the eccentric...").
**Scope:** Three code paths that independently contribute to media title data loss.

---

## Executive Summary

Session `20260302124206` ("Lunch Weight Training", 3 participants, 34min) has a media event for `plex:600174` with all title fields null. The description was enriched by `_enrichMissingPlexDescriptions`, proving the Plex API returned valid metadata — but the enrichment method only copies `summary`, discarding `title`, `grandparentTitle`, and `parentTitle`.

The root cause is a three-layer failure:
1. **`media_start` never logged** — timeline wasn't ready when the effect fired, so the event (which carries all title data) was dropped
2. **`_consolidateEvents` reads `grandparentTitle` only from `startEvt`** — even if `endEvt` had title data, it would be ignored
3. **`_enrichMissingPlexDescriptions` only enriches `description`** — title fields from the same API response are discarded

---

## Bug 1: `media_start` Dropped — Timeline Not Ready

### Location

`frontend/src/modules/Fitness/FitnessPlayer.jsx:998-1062`

### Mechanism

```javascript
// Line 1019: attempts to log media_start with all rich metadata
const logged = session.logEvent('media_start', {
  source: 'video_player',
  contentId: currentMediaIdentity,
  title: media.title || media.label || null,           // ← has data
  grandparentTitle: media.grandparentTitle || null,     // ← has data
  parentTitle: media.parentTitle || null,                // ← has data
  // ... 10 more fields
});

// Line 1041-1042: only marks as logged if timeline accepted it
if (logged) {
  loggedVideoMediaRef.current = currentMediaIdentity;
}

// Line 1053-1061: cleanup ALWAYS queued regardless of `logged`
return () => {
  if (currentMediaIdentity && session) {
    session.logEvent('media_end', {
      contentId: currentMediaIdentity,   // ← only field
      source: 'video_player',
    });
  }
};
```

### Why `logEvent` Returns Null

`FitnessSession.js:2459-2468`:
```javascript
logEvent(type, data = {}, timestamp) {
  if (!type) return null;
  if (!this.timeline) {                          // ← timeline not initialized yet
    getLogger().warn('fitness.session.logEvent_dropped', {
      type, reason: 'session_not_started'
    });
    return null;
  }
  return this.timeline.logEvent(type, data, timestamp);
}
```

The video player's useEffect fires before the session timeline is ready. `logEvent` returns `null`, so `loggedVideoMediaRef.current` stays unset. But the React cleanup function is already registered and will fire `media_end` later (with only `contentId`, no title data).

### Why the Music Player Doesn't Have This Bug

`FitnessMusicPlayer.jsx:272` sets `loggedTrackRef.current` **before** calling `logEvent`:
```javascript
loggedTrackRef.current = currentTrackIdentity;  // ← unconditional
sessionInstance.logEvent('media_start', { ... });
```

This means the guard at the top of the effect (`if (loggedTrackRef.current === currentTrackIdentity) return`) prevents re-entry, but it also means the cleanup runs even if `logEvent` failed. However, the music player re-fires on track changes, so it's more resilient overall.

The video player's guard (`if (loggedVideoMediaRef.current === currentMediaIdentity) return`) is set **conditionally** (only if `logged` is truthy), so the effect retries on next render — but by then the cleanup from the first render has already been queued.

### Evidence in Session `20260302124206`

```yaml
# Only media event in the persisted file:
- timestamp: 1772486157251
  type: media
  data:
    contentId: plex:600174
    title: null              # ← no media_start to source from
    grandparentTitle: null   # ← no media_start to source from
    start: null              # ← confirms no media_start existed
    end: 1772486157251       # ← only media_end fired
```

---

## Bug 2: `_consolidateEvents` Asymmetric Field Sourcing

### Location

`frontend/src/hooks/fitness/PersistenceManager.js:445-471`

### Mechanism

```javascript
const s = startEvt?.data || {};
const e = endEvt?.data || {};
mediaEvents.push({
  // ...
  data: {
    contentId: id,
    title: s.title || e.title || null,                // ✅ checks both
    grandparentTitle: s.grandparentTitle || null,      // ❌ only startEvt
    parentTitle: s.parentTitle || null,                // ❌ only startEvt
    grandparentId: s.grandparentId || null,            // ❌ only startEvt
    parentId: s.parentId || null,                      // ❌ only startEvt
    labels: s.labels || [],                            // ❌ only startEvt
    contentType: s.type || (s.artist ? 'track' : null) || null,  // ❌ only startEvt
    artist: s.artist || null,                          // ❌ only startEvt
    governed: s.governed ?? null,                      // ❌ only startEvt
    description: s.description || e.description || null, // ✅ checks both
    durationSeconds: s.durationSeconds ?? e.durationSeconds ?? null, // ✅ checks both
  }
});
```

Only `title`, `description`, and `durationSeconds` fall through to `endEvt`. All other fields are sourced exclusively from `startEvt`. When `startEvt` is null (Bug 1), 8 fields become null even if the data existed on `endEvt`.

### Impact

Even if `media_end` events were enriched with title data, `grandparentTitle`, `parentTitle`, `labels`, etc. would still be lost.

---

## Bug 3: `_enrichMissingPlexDescriptions` Ignores Title Fields

### Location

`frontend/src/hooks/fitness/PersistenceManager.js:1050-1078`

### Mechanism

```javascript
async _enrichMissingPlexDescriptions(events) {
  // ... filters to plex: events missing description ...
  const resp = await this._persistApi(`api/v1/info/plex/${plexId}`, {}, 'GET');
  const summary = resp?.metadata?.summary;
  if (summary) {
    evt.data.description = summary.replace(/\s+/g, ' ').trim();
    //                     ↑ ONLY field written
    // resp.metadata also contains:
    //   .title             → episode title
    //   .grandparentTitle  → show name
    //   .parentTitle       → season name
    //   .grandparentRatingKey → show ID
    //   .parentRatingKey   → season ID
    //   ... all ignored
  }
}
```

This method successfully fetched Plex metadata for `plex:600174` (the enriched description proves it). But it only extracted `summary` → `description`, leaving `title`, `grandparentTitle`, and `parentTitle` null.

### Evidence

```yaml
# Session 20260302124206 — description was enriched, titles were not:
description: >-
  You'll be slowing down the eccentric (or negative) half of each
  movement to carve a ripped lower body—faster.
title: null
grandparentTitle: null
```

### Method Name Is Misleading

The method is called `_enrichMissingPlexDescriptions` (plural "descriptions"), but it only enriches one field. The name should either be narrowed to match its behavior or the method should be expanded to enrich all missing metadata.

---

## Affected Data: Session `20260302124206`

### Timeline Events

| Field | Value | Expected |
|-------|-------|----------|
| `contentId` | `plex:600174` | ✅ |
| `title` | `null` | Episode title from Plex |
| `grandparentTitle` | `null` | Show name (e.g. "P90X3", "630", etc.) |
| `parentTitle` | `null` | Season name |
| `description` | "You'll be slowing down the eccentric..." | ✅ (enriched) |
| `start` | `null` | Should be session media start timestamp |
| `end` | `1772486157251` | ✅ |

### Summary Block

| Field | Value | Expected |
|-------|-------|----------|
| `title` | `null` | Episode title |
| `showTitle` | `null` | Show name |
| `seasonTitle` | `null` | Season name |
| `durationMs` | `0` | Should be `> 0` |
| `primary` | `true` | ✅ |

---

## Fix Plan

### Fix A: Session start captures already-playing media (primary fix)

**Principle:** If a session starts with the video already playing, the session start time IS the video start time. Never silently drop a `media_start` — if the timeline isn't ready yet, the session must retroactively log it when the timeline initializes.

**Why queuing/retrying isn't enough:** The video effect fires before the timeline exists, `logEvent` returns null, and the title data evaporates. Guarding the cleanup (Fix A-alt below) prevents the orphaned `media_end` but doesn't solve the actual data loss — the `media_start` with all its rich metadata is still gone.

**Approach:** When the session timeline initializes, check if media is already playing. If so, synthesize a `media_start` event with the session start timestamp and the current media's full metadata. This means:

1. The session's `initTimeline()` (or equivalent) checks the current media state
2. If media is already playing, it logs `media_start` with all title/metadata fields using the session start timestamp
3. The video player effect sees `loggedVideoMediaRef.current` already set and skips its own `media_start` (no duplicate)

```javascript
// In session timeline init (conceptual):
initTimeline() {
  this.timeline = new Timeline(this.startTime);

  // If media is already playing when session starts,
  // the session start IS the media start
  if (this.currentMedia) {
    this.timeline.logEvent('media_start', {
      source: 'video_player',
      contentId: this.currentMedia.contentId,
      title: this.currentMedia.title,
      grandparentTitle: this.currentMedia.grandparentTitle,
      parentTitle: this.currentMedia.parentTitle,
      // ... all metadata fields
    }, this.startTime);  // timestamp = session start
  }
}
```

**Result:** No data loss. The session start and media start are synchronized. The video player's effect becomes a no-op for already-logged media.

### Fix A-alt: Guard `media_end` cleanup on successful `media_start`

**File:** `frontend/src/modules/Fitness/FitnessPlayer.jsx:1053-1061`

This is a secondary safety net — prevents orphaned `media_end` events when `media_start` fails, but does NOT solve the data loss itself.

Don't return a cleanup function unless `media_start` was actually logged:

```javascript
// Current (broken): cleanup always queued
return () => {
  if (currentMediaIdentity && session) {
    session.logEvent('media_end', { ... });
  }
};

// Fixed: only queue cleanup if media_start succeeded
if (logged) {
  loggedVideoMediaRef.current = currentMediaIdentity;
  return () => {
    if (currentMediaIdentity && session) {
      session.logEvent('media_end', { ... });
    }
  };
}
// No cleanup returned — effect will retry on next render
```

### Fix B: `_consolidateEvents` — fall through to `endEvt` for all fields

**File:** `frontend/src/hooks/fitness/PersistenceManager.js:456-462`

```javascript
// Current: 8 fields only check startEvt
grandparentTitle: s.grandparentTitle || null,

// Fixed: fall through to endEvt
grandparentTitle: s.grandparentTitle || e.grandparentTitle || null,
parentTitle: s.parentTitle || e.parentTitle || null,
grandparentId: s.grandparentId || e.grandparentId || null,
parentId: s.parentId || e.parentId || null,
labels: s.labels || e.labels || [],
contentType: s.type || e.type || (s.artist || e.artist ? 'track' : null) || null,
artist: s.artist || e.artist || null,
governed: s.governed ?? e.governed ?? null,
```

### Fix C: `_enrichMissingPlexDescriptions` → `_enrichMissingPlexMetadata`

**File:** `frontend/src/hooks/fitness/PersistenceManager.js:1050-1078`

Rename method and enrich all missing fields from the API response:

```javascript
async _enrichMissingPlexMetadata(events) {
  // ... same filter logic ...
  const resp = await this._persistApi(`api/v1/info/plex/${plexId}`, {}, 'GET');
  const meta = resp?.metadata;
  if (!meta) return;

  if (meta.summary && !evt.data.description) {
    evt.data.description = meta.summary.replace(/\s+/g, ' ').trim();
  }
  if (meta.title && !evt.data.title) {
    evt.data.title = meta.title;
  }
  if (meta.grandparentTitle && !evt.data.grandparentTitle) {
    evt.data.grandparentTitle = meta.grandparentTitle;
  }
  if (meta.parentTitle && !evt.data.parentTitle) {
    evt.data.parentTitle = meta.parentTitle;
  }
}
```

Also update the filter condition to trigger when ANY of title/description/grandparentTitle are missing, not just description.

---

## Relationship to Prior Audits

| Audit | Overlap |
|-------|---------|
| `2026-02-28-fitness-session-media-data-quality-audit.md` | Bug B (missing `media_end`) is the same root mechanism. Bug A/C in that audit are orthogonal. The title-loss issue was not identified. |
| `2026-02-26-fitness-session-media-visibility-audit.md` | Null titles cause sessions to appear as "Unknown" on the fitness dashboard. |
| `2026-02-23-fitness-session-silent-failures-audit.md` | Same pattern of data silently dropping without error logging. |

---

## Verification Plan

After fixes are deployed:
1. Run a fitness session with a Plex video
2. Confirm `media_start` event is logged (check frontend logs for `fitness.media_start.autoplay`)
3. End session and check persisted YAML for non-null `title`, `grandparentTitle`
4. If `media_start` still drops on first render, verify enrichment backfills titles from Plex API
