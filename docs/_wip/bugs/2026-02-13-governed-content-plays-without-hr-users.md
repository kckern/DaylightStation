# Bug: Governed Content Plays Without HR Users

**Date:** 2026-02-13  
**Severity:** High  
**Component:** GovernanceEngine, FitnessPlayer  
**Status:** Fixed  
**Related:** [2026-01-24-fitness-governance-report.md](2026-01-24-fitness-governance-report.md), [2026-02-13-governance-overlay-display-architecture-audit.md](../audits/2026-02-13-governance-overlay-display-architecture-audit.md)

---

## Summary

Governed content (videos with `KidsFun` label) plays freely when no HR users are checked in. The governance system sets phase to `pending` but never sets `videoLocked = true`, allowing unrestricted playback of content that should require active heart rate monitoring.

---

## Reproduction

1. Open fitness app in browser (no session active, no HR devices connected)
2. Navigate to any governed content (e.g., Game Cycling)
3. Play video `plex:603409` (Super Mario Kart — has `kidsfun` label)
4. Video plays at full quality, unmuted, with no lock screen

**Expected:** Video should be locked/paused until at least one user checks in with an HR monitor and reaches the active zone.

---

## Evidence from dev.log (2026-02-13 21:01 UTC)

### 1. Content is governed (confirmed via API)

```
GET /api/v1/info/plex/603409
→ labels: ["kidsfun", "resumable"]
→ type: "episode"
```

Config in `fitness.yml`:
```yaml
governed_labels:
  - KidsFun
governed_types:
  - show
  - movie
```

The `kidsfun` label matches `KidsFun` (case-insensitive). Content is governed.

### 2. No session, no users, no devices

```json
// fitness-profile (sample 1, T+0s)
{
  "event": "fitness-profile",
  "sessionActive": false,
  "rosterSize": 0,
  "deviceCount": 0,
  "governancePhase": null,
  "videoState": null
}
```

### 3. Governance evaluates but reports no media

```json
// T+0.637s — First evaluation (before media loaded)
{
  "event": "governance.evaluate.no_media_or_rules",
  "data": { "hasMedia": false, "hasGovernanceRules": false }
}
```

```json
// T+0.898s — Second evaluation (governance rules loaded, media still not set)
{
  "event": "governance.evaluate.no_media_or_rules",
  "data": { "hasMedia": false, "hasGovernanceRules": true }
}
```

### 4. Governance transitions to pending→null (idle)

```json
{
  "event": "governance.phase_change",
  "data": { "from": "pending", "to": null, "satisfiedOnce": false, "requirementCount": 0 }
}
```

### 5. Video starts playing anyway

```json
// T+9.5s — Video resolved and begins playing
{
  "event": "playback.started",
  "data": {
    "title": "Super Mario Kart",
    "mediaKey": "plex:603409",
    "currentTime": 21.014058,
    "duration": 2781.1235
  }
}
```

### 6. Playback continues with no governance intervention

```json
// T+30s — Profile shows video playing, still no session
{
  "event": "fitness-profile",
  "governancePhase": "pending",
  "videoState": "playing",
  "sessionActive": false,
  "rosterSize": 0,
  "deviceCount": 0
}
```

```json
// T+60s — Still playing freely
{
  "event": "fitness-profile",
  "governancePhase": "pending",
  "videoState": "playing",
  "sessionActive": false,
  "rosterSize": 0,
  "deviceCount": 0,
  "videoFps": 60
}
```

### 7. Playhead advancing with no HR requirement enforced

Play log updates show continuous playback:
- `21s → 31s → 41s → 51s → 61s → 71s` (every 10 seconds)
- All logged to `storagePath: "plex/14_fitness"`
- 60 FPS rendering, 0% dropped frames
- No governance lock or warning events fired

---

## Root Cause Analysis

### The `videoLocked` gap

FitnessPlayer determines whether to pause/mute via `pauseArbiter.resolvePause()`:

```javascript
// FitnessPlayer.jsx:299-300
const pauseDecision = useMemo(() => resolvePause({
  governance: { locked: Boolean(governanceState?.videoLocked) },
  ...
}), [governanceState?.videoLocked, ...]);
```

`videoLocked` comes from `GovernanceEngine._composeState()`:

```javascript
// GovernanceEngine.js:1160
videoLocked: !!(this.challengeState && this.challengeState.videoLocked),
```

`challengeState.videoLocked` is **only set to `true` during challenge evaluation** (when a challenge fails). It is **never set during the base requirement `pending` phase**.

### The evaluation flow when `activeParticipants.length === 0`

```
GovernanceEngine.evaluate()
  → Step 1: _mediaIsGoverned() → true (kidsfun label)
  → Step 2: activeParticipants.length === 0
    → Sets phase to 'pending'
    → Pre-populates requirement shell for UI display
    → Returns early
    → Does NOT set videoLocked = true
    → Does NOT set challengeState.videoLocked = true
```

The engine correctly identifies that no participants exist, sets the phase to `pending`, but the `pending` phase has **no mechanism to block playback**. The `videoLocked` flag is purely a challenge-state concept.

### Phase vs. Lock decoupling

| Phase | videoLocked | Video State | Correct? |
|-------|-------------|-------------|----------|
| `null`/idle | `false` | Playing | ✅ (non-governed media) |
| `pending` (0 users) | `false` | Playing | **❌ BUG** |
| `pending` (users, below threshold) | `false` | Playing | **❌ BUG** |
| `unlocked` | `false` | Playing | ✅ |
| `warning` | `false` | Playing (dimmed) | ✅ |
| `locked` | `false` | Playing | **❌ BUG** |
| Challenge failed | `true` | Paused/muted | ✅ |

The only time `videoLocked = true` is during a **failed challenge**. The `locked` phase from base requirements never triggers `videoLocked`.

### Missing: Lock on `pending` with governed media

When media is governed and `phase === 'pending'`, the video should be locked until requirements are satisfied. Currently, `pending` is treated identically to `idle` from a playback perspective.

---

## Impact

- Kids can play governed "KidsFun" content without any exercise requirement
- Defeats the purpose of the governance system entirely
- The governance overlay may show "pending" status but the video plays freely behind it
- All governed content is affected, not just this specific video

---

## Suggested Fix

Option A: **Set `videoLocked = true` whenever phase is `pending` or `locked` AND media is governed**

In `_composeState()`:
```javascript
// Current:
videoLocked: !!(this.challengeState && this.challengeState.videoLocked),

// Fixed:
videoLocked: !!(this.challengeState && this.challengeState.videoLocked) 
  || (this._mediaIsGoverned() && (this.phase === 'pending' || this.phase === 'locked')),
```

Option B: **Add a base-requirement lock flag** separate from challenge videoLocked, so `resolvePause` can distinguish governance lock sources.

---

## Related code

- `frontend/src/hooks/fitness/GovernanceEngine.js` — `evaluate()` (L1278-1342), `_composeState()` (L1049-1165)
- `frontend/src/modules/Fitness/FitnessPlayer.jsx` — `resolvePause()` (L299-306), governance lock effect (L353-410)
- `frontend/src/modules/Player/utils/pauseArbiter.js` — `resolvePause()`
- `data/household/config/fitness.yml` — `governed_labels`, `governance` section
