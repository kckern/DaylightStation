# Plex Session Collision: Root Cause Analysis & Fix

**Date:** December 13, 2025  
**Status:** Implemented  
**Severity:** High (causes video playback stalls)

---

## Problem Statement

When playing fitness videos with background music, the video player intermittently stalls with repeated 404 errors on DASH segment requests. The video transcode session is unexpectedly terminated by Plex despite no user action to stop playback.

### Symptoms

- Video playback stalls immediately after starting
- Browser console shows repeated 404s for `.m4s` segment files
- Plex logs show "Client stopped playback" reason for session termination
- Transcode process receives SIGKILL (exit code -9)

---

## Evidence from Logs

### 1. Plex Server Log: Session Termination

The video transcode session `e69e4d8b-2c16-41b8-8b5a-b6eeb4fef75e` was killed by Plex itself (not kernel OOM):

```
Dec 13, 2025 13:58:30.482 [Req#34f592] Killing job.
Dec 13, 2025 13:58:30.482 [Req#34f592] Signalling job ID 352719 with 9
Dec 13, 2025 13:58:30.483 [Req#34f592] Stopping transcode session e69e4d8b-2c16-41b8-8b5a-b6eeb4fef75e
Dec 13, 2025 13:58:30.483 [Req#34f592] Streaming Resource: Terminated session 0x7ad5b7c2e408:662548-r0-z7bxmhyp1bfvede948bqp with reason Client stopped playback.
```

### 2. The Triggering Request

The kill occurred within request `#34f592`, which was an **audio file request** for the music player:

```
Dec 13, 2025 13:58:30.480 Request: [172.18.0.1:54884 (Subnet)] GET /library/parts/145739/1587179308/file.mp3 (14 live) #34f592 Signed-in Token ({username}) (range: bytes=0-)
```

### 3. Immediate Session Replacement

Immediately after killing the video session, Plex created a new session for the MP3:

```
Dec 13, 2025 13:58:30.483 [Req#34f592] Streaming Resource: Attempting to create AdHoc dp session 4hOqbP7qay-r0-vypz77fjxle593w6pgicdo for part 145739
Dec 13, 2025 13:58:30.488 [Req#34f592] Streaming Resource: Added session 0x7ad5be02d928:4hOqbP7qay-r0-vypz77fjxle593w6pgicdo
Dec 13, 2025 13:58:30.488 [Req#34f592] Streaming Resource: Reached Decision id=140611 codes=(MDE=1000,Direct play OK.)
```

### 4. Resulting 404 Cascade

After the session was killed and its directory cleaned up, the video player continued requesting segments from the now-deleted session:

```
Dec 13, 2025 13:58:30.562 GET /video/:/transcode/universal/session/e69e4d8b-2c16-41b8-8b5a-b6eeb4fef75e/0/1.m4s → 404
Dec 13, 2025 13:58:31.064 GET /video/:/transcode/universal/session/e69e4d8b-2c16-41b8-8b5a-b6eeb4fef75e/0/1.m4s → 404
Dec 13, 2025 13:58:31.437 GET /video/:/transcode/universal/session/e69e4d8b-2c16-41b8-8b5a-b6eeb4fef75e/1/2.m4s → 404
... (repeated indefinitely)
```

### 5. Ruled Out Causes

| Potential Cause | Evidence | Verdict |
|-----------------|----------|---------|
| Kernel OOM kill | `dmesg` shows no OOM events | ❌ Not the cause |
| Container memory limit | `docker inspect plex` shows `OOMKilled=false`, no memory limits | ❌ Not the cause |
| Disk space | Transcode path has 407GB free (7% used) | ❌ Not the cause |
| Client disconnect | Same client IP initiated both requests | ❌ Not the cause |

---

## Root Cause

### Plex Client Identifier Collision

Both the video player and music player were using the **same `X-Plex-Client-Identifier`**. Plex interprets multiple playback requests from the same client identifier as a single-stream scenario, automatically terminating the prior session when a new playback request arrives.

**Original code in `backend/lib/plex.mjs`:**

```javascript
const clientIdentifier = session || defaultSession || sessionUUID;
```

Both audio and video requests resolved to the same `clientIdentifier`, causing Plex to treat the music player's request as a replacement for the video player's session.

### Timeline of Events

1. **13:58:30.260** — Video transcode session starts for media 662548
2. **13:58:30.348** — Video segments 0/1 successfully served (200 OK)
3. **13:58:30.480** — Music player requests MP3 file with same client identifier
4. **13:58:30.482** — Plex kills video transcode (SIGKILL, "Client stopped playback")
5. **13:58:30.483** — Plex creates new session for MP3 direct play
6. **13:58:30.562+** — Video player requests segments → 404 (session gone)

---

## Recommendation

### Solution: Distinct Client Identifiers by Media Type

Plex allows concurrent playback from different "devices" (client identifiers). By giving audio and video requests distinct client identifiers, Plex will treat them as separate devices and allow simultaneous playback.

### Implementation Plan

#### 1. Backend: Differentiate Audio Client Identifier

**File:** `backend/lib/plex.mjs`

**Change:** Append `-audio` suffix to client identifier for audio requests:

```javascript
// Before
const clientIdentifier = session || defaultSession || sessionUUID;

// After
const baseClientId = session || defaultSession || sessionUUID;
const clientIdentifier = media_type === 'audio' ? `${baseClientId}-audio` : baseClientId;
```

**Status:** ✅ Implemented

#### 2. Frontend: Distinct Plex Client Sessions for Composite Players

**File:** `frontend/src/modules/Player/components/CompositePlayer.jsx`

**Change:** Generate unique Plex client session IDs for primary and overlay players:

```javascript
// Stable Plex client session IDs for each player to ensure distinct X-Plex-Client-Identifier values
const primaryPlexSession = React.useMemo(() => `composite-primary-${guid()}`, []);
const overlayPlexSession = React.useMemo(() => `composite-overlay-${guid()}`, []);

// Pass to each Player
<Player plexClientSession={overlayPlexSession} ... />
<Player plexClientSession={primaryPlexSession} ... />
```

**Status:** ✅ Implemented

#### 3. Frontend: FitnessMusicPlayer Has Distinct Plex Session

**File:** `frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx`

The music player generates a unique Plex client session ID:

```javascript
// Stable Plex client session ID - ensures music player has distinct X-Plex-Client-Identifier from video player
const musicPlexSession = useMemo(() => `fitness-music-${guid()}`, []);
```

Combined with the backend fix, this now uses client identifier `fitness-music-xxx-audio`.

**Status:** ✅ Implemented

#### 4. Naming Clarification

**Renamed:** `sessionId` → `plexClientSession` in Player components

This clarifies the distinction between:
- `plexClientSession`: Stable per-player-instance, used for Plex `X-Plex-Client-Identifier`
- `currentMediaGuid`: Changes per queue item, used for React keys and internal state tracking

**Files updated:**
- `SinglePlayer.jsx` - prop renamed to `plexClientSession`
- `Player.jsx` - bridge prop renamed, `activeEntryGuid` → `currentMediaGuid`
- `CompositePlayer.jsx` - variable renamed to `primaryPlexSession`/`overlayPlexSession`
- `FitnessMusicPlayer.jsx` - variable renamed to `musicPlexSession`

---

## Verification Steps

After deploying the fix:

1. Start a fitness video with background music enabled
2. Verify video plays without stalling
3. Check Plex logs for two distinct client identifiers:
   - Video: `X-Plex-Client-Identifier=<session>`
   - Audio: `X-Plex-Client-Identifier=<session>-audio`
4. Confirm no "Client stopped playback" terminations for video sessions when music starts
5. Check Loggly/backend logs for `plex.media-url-generated` events showing distinct `clientIdentifier` values

---

## Files Modified

| File | Change |
|------|--------|
| `backend/lib/plex.mjs` | Audio requests use distinct client identifier suffix; added session logging |
| `frontend/src/modules/Player/components/SinglePlayer.jsx` | Renamed `sessionId` → `plexClientSession` |
| `frontend/src/modules/Player/Player.jsx` | Renamed bridge prop to `plexClientSession` |
| `frontend/src/modules/Player/components/CompositePlayer.jsx` | Added unique Plex sessions for primary/overlay players |
| `frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx` | Renamed to `musicPlexSession` with clarifying comment |

---

## Logging Added

The backend now logs session identifiers when generating media URLs:

```javascript
plexLogger.info('plex.media-url-generated', {
  mediaType: media_type,      // 'audio' or 'video'
  plexId: key,                // Plex rating key
  clientIdentifier,           // X-Plex-Client-Identifier value
  sessionIdentifier,          // X-Plex-Session-Identifier value
  baseClientId,               // Base client ID before audio suffix
  optsSession                 // Session ID passed from frontend
});
```

This enables diagnosing future session collision issues by searching Loggly for:
- `plex.media-url-generated` to see all media URL generations
- Filter by `clientIdentifier` to trace which requests share the same client identity

---

## References

- Plex API: `X-Plex-Client-Identifier` identifies the device/app to Plex
- Plex API: `X-Plex-Session-Identifier` is unique per playback session
- Plex behavior: Same client identifier + new playback = terminate previous session
