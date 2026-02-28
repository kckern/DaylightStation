# Bug: Playback Recovery Reuses Broken Plex Transcode Session

**Date:** 2026-02-28
**Severity:** Critical
**Component:** Frontend / Player Resilience + SinglePlayer
**Status:** Open

---

## Summary

When a DASH video stalls and the resilience system triggers recovery (player remount), the player reuses the same broken Plex transcode session URL instead of requesting a fresh one from the backend. This causes recovery to fail repeatedly until all attempts are exhausted, leaving the player permanently stuck.

---

## Evidence from Production Logs (2026-02-28 02:14 UTC)

### Timeline

```
02:14:15 — Player starts seeking to 0:10 for plex:350694
02:14:16–02:14:30 — 14 seconds stuck in "Seeking…" (playhead at t=0.0)
02:14:28 — QuotaExceededError on audio SourceBuffer
02:14:28 — InvalidStateError on video SourceBuffer (repeated 6x)
02:14:30 — Stall threshold exceeded (15s), resilience recovery attempt 1/3
02:14:30 — Hard reset accepted → player remount
02:14:31–02:14:55 — Still stuck in "Recovering…" (readyState=0)
02:15:00 — Recovery attempt 3/3 (max) — still stuck
02:15:01 — 45+ seconds with loading overlay visible, no playback
```

### Key Log Entries

```json
{"event":"playback.stall_threshold_exceeded","data":{"duration":15092,"playheadPosition":null,"status":"recovering"}}
{"event":"playback.player-remount","data":{"reason":"startup-deadline-exceeded","remountNonce":0,"hardResetInvoked":true}}
{"event":"playback.resilience-recovery","data":{"reason":"startup-deadline-exceeded","attempt":3,"maxAttempts":3}}
```

### SourceBuffer Errors

```
[SourceBufferSink][audio] QuotaExceededError: MediaSource buffer not sufficient
[SourceBufferSink][video] InvalidStateError: object is not, or is no longer, usable (6x)
[StreamProcessor][video] Blacklisting segment ... /session/6f973c9d-.../0/72.m4s
```

The same Plex transcode session (`6f973c9d-8c00-41da-8b91-81d84429e8e3`) persists across all recovery attempts.

---

## Root Cause

### Direct-Play Bypass in SinglePlayer.jsx

**File:** `frontend/src/modules/Player/components/SinglePlayer.jsx`
**Lines:** 215-238

```javascript
// Direct-play bypass: if the play prop already contains mediaUrl and a media format,
// skip the /play API call entirely.
const directFormat = play?.format;
const directMediaUrl = play?.mediaUrl;
if (directMediaUrl && directFormat && !getRenderer(directFormat)) {
  const directInfo = { ...play, /* ... */ };
  setMediaInfo(directInfo);
  setIsReady(true);
  return;  // ← Skips /play API, reuses stale URL with broken transcode session
}
```

Queue items from the `/queue` endpoint come with pre-resolved `mediaUrl` and `format` properties. When the player first loads, this bypass is **correct** — it avoids a redundant API call. But during resilience recovery:

1. Resilience system detects stall → triggers hard reset
2. Player.jsx increments `remountState.nonce` and sets `remountState.context` with diagnostics
3. SinglePlayer remounts with a new React key (triggering fresh mount)
4. `fetchVideoInfoCallback` runs...
5. **But the direct-play bypass fires first**, seeing the same `play.mediaUrl` from the queue
6. Returns the stale URL with the broken Plex transcode session baked in
7. DASH player tries to use the dead session → SourceBuffer errors → stall again
8. Recovery exhausts all attempts with the same broken URL

### Why the Plex Session is Per-URL

The PlexAdapter (`backend/src/1_adapters/content/media/plex/PlexAdapter.mjs`) generates fresh session IDs in `_generateSessionIds()` every time `loadMediaUrl()` is called. These IDs are baked into the returned URL:

```
/api/v1/proxy/plex/video/:/transcode/universal/start.mpd?
  X-Plex-Client-Identifier={clientId}&
  X-Plex-Session-Identifier={sessionId}&...
```

The backend **does** generate fresh sessions — but only when the `/play` API is actually called. The direct-play bypass prevents this call during recovery.

### Why `plexClientSession` Change Doesn't Help

Player.jsx correctly updates `plexClientSession` on each remount:
```javascript
plexClientSession: currentMediaGuid ? `${currentMediaGuid}-r${remountState.nonce}` : null
```

And `plexClientSession` IS in the `fetchVideoInfoCallback` dependency array, so the callback IS recreated. But the direct-play bypass fires before `plexClientSession` is used (it's only passed to the `/play` API call on line 247).

---

## Fix

### Approach

Skip the direct-play bypass when `remountDiagnostics` indicates a resilience recovery. This forces a fresh `/play` API call, which generates a new Plex transcode session.

### Change (SinglePlayer.jsx)

At line 221, add a recovery check:

```javascript
const isRecoveryRemount = !!remountDiagnostics;
if (directMediaUrl && directFormat && !getRenderer(directFormat) && !isRecoveryRemount) {
```

And add `remountDiagnostics` to the `useCallback` dependency array at line 315.

### Why This Works

- **Normal playback:** `remountDiagnostics` is `null` → bypass fires, no extra API call (preserves optimization)
- **Recovery remount:** `remountDiagnostics` has `{ reason, source, remountNonce, ... }` → bypass skipped → `/play` API called → fresh transcode session → working DASH URL

---

## Affected Code

| File | Lines | Role |
|------|-------|------|
| `frontend/src/modules/Player/components/SinglePlayer.jsx` | 215-238, 315 | **Direct-play bypass + deps** |
| `frontend/src/modules/Player/Player.jsx` | 336-396 | Remount nonce + diagnostics |
| `frontend/src/modules/Player/Player.jsx` | 814, 819 | Props to SinglePlayer |
| `frontend/src/modules/Player/hooks/useMediaResilience.js` | 130-162 | Recovery trigger |
| `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs` | 1428-1442 | Session generation (works correctly) |

---

## Testing

### Manual Verification

1. Play a Plex video queue item
2. Trigger a stall (e.g., kill the Plex transcode session server-side)
3. Wait for resilience recovery to trigger (15s)
4. **Before fix:** Player stays stuck, recovery exhausts all attempts
5. **After fix:** Recovery fetches fresh URL, playback resumes

### Log Verification

After fix, recovery logs should show:
- `playback.player-remount` with incrementing `remountNonce`
- Fresh `/play` API call in network tab during recovery
- New Plex session ID in the media URL after recovery
- `playback.started` event after recovery (not more `stall_threshold_exceeded`)
