# Fix: Session Summary Missing grandparentId/parentId

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the race condition where `summary.media` is computed before Plex metadata enrichment, resulting in null `grandparentId`/`parentId` in session API responses.

**Architecture:** Move enrichment before summary computation in `PersistenceManager.persistSession()`. Add a read-side patch in `YamlSessionDatastore` to fill null summary fields from timeline events. No backfill needed — the read-side patch transparently fixes the 2 affected sessions at query time.

**Tech Stack:** Frontend JS (PersistenceManager), Backend MJS (YamlSessionDatastore), YAML session files

**Bug report:** `docs/_wip/bugs/2026-03-13-summary-missing-grandparentId.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/hooks/fitness/PersistenceManager.js` | Modify (lines 988-1071) | Move enrichment before summary |
| `backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs` | Modify (lines 247-266) | Read-side fallback for null fields |

---

## Chunk 1: Write-Side Fix (PersistenceManager)

### Task 1: Move enrichment before summary computation

The current flow in `persistSession()` (starting ~line 988):
1. Line 991: `buildSessionSummary()` — reads events, writes summary (too early)
2. Line 1000: encode series
3. Line 1070: `_enrichMissingPlexMetadata()` — enriches events async (too late)
4. Line 1071: `.then(() => save_session API call)`

The fix: move the enrichment into the `.then()` chain so it runs before summary, or restructure to await enrichment before building the summary. Since `persistSession()` is synchronous (returns `true`/`false`) and the save is already fire-and-forget via `.then()`, the cleanest approach is to move summary computation into the `.then()` chain after enrichment.

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:988-1071`

- [ ] **Step 1: Restructure the persist flow**

In `PersistenceManager.js`, the current code at lines 988-1071 needs to change. The summary computation (lines 988-998) must move after enrichment (line 1070).

Current code (lines 988-1087):
```javascript
    // Compute summary block from raw (pre-encoded) series
    if (persistSessionData.timeline?.series) {
      const intervalSeconds = persistSessionData.timeline.interval_seconds || 5;
      persistSessionData.summary = buildSessionSummary({
        participants: persistSessionData.participants || {},
        series: persistSessionData.timeline.series,
        events: persistSessionData.timeline?.events || [],
        treasureBox: persistSessionData.treasureBox || sessionData.treasureBox,
        intervalSeconds,
      });
    }

    // Encode series
    if (persistSessionData.timeline?.series) {
      // ... series encoding block (lines 1001-1027) ...
    }

    // ... logging, lock check (lines 1029-1068) ...

    this._enrichMissingPlexMetadata(persistSessionData.timeline?.events)
      .then(() => this._persistApi('api/v1/fitness/save_session', { sessionData: persistSessionData }, 'POST'))
      .then(resp => {
        this.markSaveSucceeded(sessionData.sessionId);
        this._lastSuccessfulSaveAt = Date.now();
        if ((this._debugSaveSuccessCount = (this._debugSaveSuccessCount || 0) + 1) <= 3) {
          console.error(`✅ SESSION_SAVED [${this._debugSaveSuccessCount}/3]: ${persistSessionData.session?.id}`);
        }
      })
      .catch(err => {
        console.error(`❌ SESSION_SAVE_FAILED: ${persistSessionData.session?.id}`, err?.message || err);
        getLogger().error('fitness.persistence.failed', { error: err.message });
      })
      .finally(() => {
        this._saveTriggered = false;
      });
```

Replace with — note two changes: (a) summary computation moves into the `.then()` chain, and (b) we must capture `intervalSeconds` and `treasureBox` before the chain since `persistSessionData.timeline.series` gets encoded:

```javascript
    // Capture summary inputs BEFORE series encoding (encoding mutates series to RLE strings)
    const summaryInputs = persistSessionData.timeline?.series ? {
      participants: persistSessionData.participants || {},
      series: persistSessionData.timeline.series,
      treasureBox: persistSessionData.treasureBox || sessionData.treasureBox,
      intervalSeconds: persistSessionData.timeline.interval_seconds || 5,
    } : null;

    // Encode series
    if (persistSessionData.timeline?.series) {
      // ... series encoding block stays unchanged (lines 1001-1027) ...
    }

    // ... logging, lock check stay unchanged (lines 1029-1068) ...

    this._enrichMissingPlexMetadata(persistSessionData.timeline?.events)
      .then(() => {
        // Build summary AFTER enrichment so grandparentId/parentId are populated
        if (summaryInputs) {
          persistSessionData.summary = buildSessionSummary({
            ...summaryInputs,
            events: persistSessionData.timeline?.events || [],
          });
        }
      })
      .then(() => this._persistApi('api/v1/fitness/save_session', { sessionData: persistSessionData }, 'POST'))
      .then(resp => {
        this.markSaveSucceeded(sessionData.sessionId);
        this._lastSuccessfulSaveAt = Date.now();
        if ((this._debugSaveSuccessCount = (this._debugSaveSuccessCount || 0) + 1) <= 3) {
          console.error(`✅ SESSION_SAVED [${this._debugSaveSuccessCount}/3]: ${persistSessionData.session?.id}`);
        }
      })
      .catch(err => {
        console.error(`❌ SESSION_SAVE_FAILED: ${persistSessionData.session?.id}`, err?.message || err);
        getLogger().error('fitness.persistence.failed', { error: err.message });
      })
      .finally(() => {
        this._saveTriggered = false;
      });
```

**Reference safety:** `summaryInputs.series` captures a direct reference to the original series object. Line 1026 reassigns `persistSessionData.timeline.series = mappedSeries` (a new object), but this does not affect the reference held by `summaryInputs`. Additionally, `encodeSeries` does not mutate the input arrays — it builds a new `encodedSeries` object. So `summaryInputs.series` remains valid and unmodified when `buildSessionSummary` reads it later in the `.then()` chain.

- [ ] **Step 2: Apply the edit**

In `frontend/src/hooks/fitness/PersistenceManager.js`, replace the summary computation block (lines 988-998) with the `summaryInputs` capture:

Replace:
```javascript
    // Compute summary block from raw (pre-encoded) series
    if (persistSessionData.timeline?.series) {
      const intervalSeconds = persistSessionData.timeline.interval_seconds || 5;
      persistSessionData.summary = buildSessionSummary({
        participants: persistSessionData.participants || {},
        series: persistSessionData.timeline.series,
        events: persistSessionData.timeline?.events || [],
        treasureBox: persistSessionData.treasureBox || sessionData.treasureBox,
        intervalSeconds,
      });
    }
```

With:
```javascript
    // Capture summary inputs BEFORE series encoding (encoding mutates series to RLE strings).
    // Summary is computed later, after Plex metadata enrichment populates grandparentId/parentId.
    const summaryInputs = persistSessionData.timeline?.series ? {
      participants: persistSessionData.participants || {},
      series: persistSessionData.timeline.series,
      treasureBox: persistSessionData.treasureBox || sessionData.treasureBox,
      intervalSeconds: persistSessionData.timeline.interval_seconds || 5,
    } : null;
```

Then replace the enrichment + save chain (lines 1070-1087):

Replace:
```javascript
    this._enrichMissingPlexMetadata(persistSessionData.timeline?.events)
      .then(() => this._persistApi('api/v1/fitness/save_session', { sessionData: persistSessionData }, 'POST'))
      .then(resp => {
```

With:
```javascript
    this._enrichMissingPlexMetadata(persistSessionData.timeline?.events)
      .then(() => {
        // Build summary AFTER enrichment so grandparentId/parentId are populated
        if (summaryInputs) {
          persistSessionData.summary = buildSessionSummary({
            ...summaryInputs,
            events: persistSessionData.timeline?.events || [],
          });
        }
      })
      .then(() => this._persistApi('api/v1/fitness/save_session', { sessionData: persistSessionData }, 'POST'))
      .then(resp => {
```

- [ ] **Step 3: Verify dev server starts cleanly**

Run: `cd /opt/Code/DaylightStation && node -e "import('./frontend/src/hooks/fitness/PersistenceManager.js')" 2>&1 | head -5`

(This will likely fail due to browser-only imports, but syntax errors would show immediately. Alternatively, start the dev server and check for console errors.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/PersistenceManager.js
git commit -m "fix(fitness): compute session summary after Plex metadata enrichment

Summary was built before _enrichMissingPlexMetadata() ran, so
grandparentId/parentId were null for sessions where the frontend
play queue didn't already have them."
```

---

## Chunk 2: Read-Side Patch (YamlSessionDatastore)

### Task 2: Fill null summary fields from timeline events

Even after the write-side fix, existing sessions have stale summaries. Add a read-side patch that fills null `grandparentId`/`parentId` from timeline events when available.

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs:247-266`

- [ ] **Step 1: Add field-level fallback after summary media is built**

In `YamlSessionDatastore.mjs`, after the summary-based media block (line 266), add a patch that fills null fields from timeline events. This goes between the summary block and the timeline fallback.

After line 266 (after `media = { primary: ... }`), insert:

```javascript
      // Patch: if summary.media has null grandparentId/parentId, try filling from timeline events
      if (media?.primary && (!media.primary.grandparentId || !media.primary.parentId)) {
        const matchingEvt = (data.timeline?.events || []).find(e =>
          e.type === 'media' && e.data?.contentId && ItemId.normalize(e.data.contentId, ItemId.extractSource(e.data.contentId)) === media.primary.contentId
        );
        if (matchingEvt?.data) {
          const evtSource = ItemId.extractSource(matchingEvt.data.contentId);
          if (!media.primary.grandparentId && matchingEvt.data.grandparentId) {
            media.primary.grandparentId = ItemId.normalize(matchingEvt.data.grandparentId, evtSource);
          }
          if (!media.primary.parentId && matchingEvt.data.parentId) {
            media.primary.parentId = ItemId.normalize(matchingEvt.data.parentId, evtSource);
          }
        }
      }
```

- [ ] **Step 2: Verify the fix works for affected sessions**

```bash
# Restart dev server (or the app will hot-reload)
# Then check the affected sessions:
curl -s 'https://daylightlocal.kckern.net/api/v1/fitness/sessions?since=2026-03-12&limit=5' | python3 -c "
import json, sys
data = json.load(sys.stdin)
for s in data.get('sessions', []):
    m = s.get('media', {}).get('primary', {})
    print(f\"{s['sessionId']} gp={m.get('grandparentId')} p={m.get('parentId')} — {m.get('title')}\")
"
```

Expected: All sessions show non-null `grandparentId` and `parentId`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs
git commit -m "fix(fitness): fill null summary media IDs from timeline events

Read-side patch for sessions where summary.media.grandparentId was
written as null before the write-side enrichment fix."
```
