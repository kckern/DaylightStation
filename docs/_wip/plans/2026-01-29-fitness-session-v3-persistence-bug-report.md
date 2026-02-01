# Bug Report: v3 Session Payload Dropped by Backend Session Entity

**Date:** 2026-01-29  
**Severity:** Critical  
**Domain:** Fitness / Session Persistence  
**Symptom:** Session files saved with empty data (no series, roster, startTime, endTime)

---

## Summary

The frontend `PersistenceManager.js` builds a **v3 session payload** with transformed field locations (e.g., `session.id`, `session.start`), but the backend `Session.fromJSON()` expects **legacy v1 field locations** (`sessionId`, `startTime`, `endTime` at root level). This mismatch causes all v3-formatted fields to be dropped during deserialization, resulting in empty session files.

---

## Evidence

### Affected Session
- **Session ID:** `20260129063322`
- **File Path:** `household/apps/fitness/sessions/2026-01-29/20260129063322.yml`

### Current File Contents (production)
```yaml
sessionId: '20260129063322'
endTime: null
durationMs: null
timezone: America/Los_Angeles
roster: []
timeline:
  series: {}
  events: []
snapshots:
  captures: []
  updatedAt: null
metadata: {}
```

### Production Logs (session was saved)
```
📤 SESSION_SAVE [1/5]: 20260129063322, ticks=3, series=4
✅ SESSION_SAVED [1/3]: 20260129063322
📤 SESSION_SAVE [2/5]: 20260129063322, ticks=6, series=4
✅ SESSION_SAVED [2/3]: 20260129063322
```

The frontend logged 4 series being sent, but the file has `series: {}`.

---

## Root Cause Analysis

### 1. Frontend PersistenceManager Builds v3 Payload

In [PersistenceManager.js#L631-L639](frontend/src/hooks/fitness/PersistenceManager.js#L631-L639), the persistence payload is transformed to v3 format:

```javascript
// Remove root-level duplicates of session.* fields
delete persistSessionData.sessionId;    // ← DELETED from root
delete persistSessionData.startTime;    // ← DELETED from root
delete persistSessionData.endTime;      // ← DELETED from root
delete persistSessionData.durationMs;   // ← DELETED from root
```

The v3 payload puts these in nested `session` block instead:
```javascript
session: {
  id: String(numericSessionId),     // "20260129063322"
  date: sessionDate,                // "2026-01-29"
  start: startReadable,             // "2026-01-29 06:33:22"
  end: endReadable,
  duration_seconds: durationSeconds
}
```

### 2. Backend Session Entity Expects v1 Fields

In [Session.mjs#L203-L210](backend/src/1_domains/fitness/entities/Session.mjs#L203-L210), `fromJSON()` reads from root level:

```javascript
static fromJSON(data) {
  const sessionId = data.sessionId || data.id;  // ← reads root.sessionId
  return new Session({
    ...data,                                     // ← spreads root fields
    sessionId
  });
}
```

The `Session` constructor destructures root-level fields:
```javascript
constructor({
  sessionId,
  startTime,      // ← undefined (was in session.start)
  endTime = null, // ← null (was in session.end)
  durationMs = null,
  timezone = null,
  roster = [],    // ← empty (frontend deleted it)
  timeline = { series: {}, events: [] },  // ← empty defaults
  ...
})
```

### 3. SessionService Doesn't Transform v3→v1

In [SessionService.mjs#L136-L140](backend/src/1_domains/fitness/services/SessionService.mjs#L136-L140):

```javascript
// Normalize to Session entity
const session = Session.fromJSON({
  ...sessionData,       // ← v3 payload, missing root-level fields
  sessionId: sanitizedId
});
```

The only transformation is `sessionId` extraction via `session?.id` fallback, but `startTime`, `endTime`, `roster`, `participants`, `timeline.series` are NOT mapped from their v3 locations.

### 4. Session.toJSON() Writes v1 Format

In [Session.mjs#L185-L195](backend/src/1_domains/fitness/entities/Session.mjs#L185-L195):

```javascript
toJSON() {
  return {
    sessionId: this.sessionId.toString(),
    startTime: this.startTime,     // ← null/undefined
    endTime: this.endTime,         // ← null
    durationMs: this.durationMs,   // ← null
    timezone: this.timezone,
    roster: this.roster,           // ← []
    timeline: this.timeline,       // ← { series: {}, events: [] }
    snapshots: this.snapshots,
    metadata: this.metadata
  };
}
```

---

## Data Flow Diagram

```
Frontend (PersistenceManager)         Backend (SessionService/Session)
─────────────────────────────        ────────────────────────────────
                                     
Build v3 payload:                    saveSession(sessionData):
{                                    │
  session: {                         │  const rawSessionId = sessionData.sessionId 
    id: "20260129063322",            │                    || sessionData.session?.id
    start: "2026-01-29 06:33:22"     │  // ✓ sessionId extracted correctly
  },                                 │
  participants: {...},               │
  timeline: {                        │  Session.fromJSON(sessionData):
    series: { "kckern:hr": [...] }   │  │
  }                                  │  │  constructor({
  // NO root sessionId/startTime!    │  │    startTime,    // ← undefined!
}                                    │  │    roster,       // ← []
      │                              │  │    timeline,     // ← undefined!
      │ POST save_session            │  │  })
      ▼                              │  │
                                     │  ▼
                                     │
                                     session.toJSON():
                                     {
                                       sessionId: "20260129063322",
                                       startTime: undefined,  // ← LOST
                                       roster: [],            // ← LOST
                                       timeline: { series: {}, events: [] }  // ← LOST
                                     }
```

---

## Impact

1. **All fitness sessions saved as empty** - no HR data, no events, no participant info
2. **Historical fitness stats broken** - dashboard shows zero data
3. **User coins/achievements not credited** - gamification data lost
4. **Voice memos orphaned** - transcripts not associated with sessions

---

## Proposed Fix

### Option A: Backend Adapter Layer (Recommended)

Add a `SessionPayloadAdapter` or transform logic in `SessionService.saveSession()` to map v3→v1:

```javascript
// SessionService.mjs
function normalizePayloadV3ToV1(data) {
  // If v3 format detected, extract nested fields
  if (data.session && !data.startTime) {
    return {
      ...data,
      sessionId: data.session.id || data.sessionId,
      startTime: parseTimestamp(data.session.start),
      endTime: parseTimestamp(data.session.end),
      durationMs: (data.session.duration_seconds || 0) * 1000,
      roster: buildRosterFromParticipants(data.participants),
      timeline: data.timeline || { series: {}, events: [] }
    };
  }
  return data;
}

async saveSession(sessionData, householdId) {
  const normalized = normalizePayloadV3ToV1(sessionData);
  const session = Session.fromJSON(normalized);
  // ...
}
```

### Option B: Frontend Revert to v1 Payload

Remove the v3 transformation from PersistenceManager and keep root-level fields:

```javascript
// DON'T delete these
// delete persistSessionData.sessionId;
// delete persistSessionData.startTime;
// etc.
```

**Recommendation:** Option A is preferred as it maintains forward compatibility and keeps the clean v3 API contract. The backend should handle payload normalization as an adapter concern.

---

## Files Requiring Changes

| File | Change |
|------|--------|
| `backend/src/1_domains/fitness/services/SessionService.mjs` | Add v3→v1 normalizer before `Session.fromJSON()` |
| `backend/src/1_domains/fitness/entities/Session.mjs` | Update `fromJSON()` to handle v3 structure OR add v3-aware factory |
| `backend/src/2_adapters/persistence/yaml/YamlSessionDatastore.mjs` | Consider writing v3 format directly instead of via entity |

---

## Related Documentation

- `docs/_archive/.../sessions.md` - v3 schema design (archived)
- `frontend/src/hooks/fitness/PersistenceManager.js` - v3 payload builder
- `frontend/src/hooks/fitness/SessionSerializerV3.js` - v3 serializer (unused?)

---

## Verification Steps

After fix:

1. Start a fitness session with HR device
2. Exercise for 30+ seconds (3+ ticks)
3. Check session file has:
   - `startTime` populated
   - `timeline.series` with HR data
   - `roster` or `participants` with participant info
4. Verify fitness dashboard shows session data

---

## Resolution

**Fixed:** 2026-01-29

**Implementation:** Added `normalizeV3Payload()` function in `SessionService.mjs` that:
1. Detects v3 payloads by checking for `session` object without root `startTime`
2. Extracts `sessionId`, `startTime`, `endTime`, `durationMs` from nested `session` block
3. Converts `participants` object to `roster` array with proper field mapping
4. Preserves `timeline.series` as-is (already in correct format)

**Files Changed:**
- `backend/src/1_domains/fitness/services/SessionService.mjs` - Added normalization layer
- `backend/src/1_domains/fitness/services/TimelineService.mjs` - Preserve already-encoded series strings
- `tests/unit/suite/domains/fitness/services/SessionService.test.mjs` - Added v3 tests

**Verification:**
- [ ] Deploy to production
- [ ] Start a new fitness session with HR device
- [ ] Exercise for 1+ minute
- [ ] Check session file has populated `startTime`, `timeline.series`, `roster`
- [ ] Verify fitness dashboard shows session data