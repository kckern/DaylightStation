# Fitness Playback Resilience & Transcode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the June 8 unrecoverable-stall class of failure — cap the SW transcode so it stays ahead of realtime, allow direct-play for already-h264 sources, break the "re-seek onto the poisoned segment" recovery loop, and make an F5 reload resume the active fitness session in place.

**Architecture:** Four independent changes. (1+2) Backend: the Plex transcode profile gets resolution/bitrate/frame-rate caps and a tightly-gated direct-play path, both via a new pure `transcodeProfile.mjs` helper. (3) Frontend: the media-resilience recovery nudges the seek target forward after repeated same-position failures, via a pure `recoverySeek.js` helper. (4) Frontend: the active fitness play-queue is mirrored to `sessionStorage` and restored on mount, with the sequential-show route guard bypassed when resuming.

**Tech Stack:** Node ESM backend (`.mjs`), React frontend (`.jsx`/`.js`), vitest for all unit tests.

**Root-cause reference:** `docs/_wip/audits/2026-06-08-bug-bash-fitness-multi-issue-audit.md` (Item 4).

---

## File Structure

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `backend/src/1_adapters/content/media/plex/transcodeProfile.mjs` | Pure helpers: resolve transcode caps, build client-profile-extra string, decide h264 direct-play eligibility | Create |
| `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs` | Wire caps + direct-play gate into `requestTranscodeDecision`, `_buildTranscodeUrl`, `loadMediaUrl` | Modify |
| `tests/unit/adapters/plex/transcodeProfile.test.mjs` | Unit tests for the pure helpers | Create |
| `frontend/src/modules/Player/hooks/recoverySeek.js` | Pure helper: compute the (possibly nudged) recovery seek ms | Create |
| `frontend/src/modules/Player/hooks/recoverySeek.test.js` | Unit tests for the nudge logic | Create |
| `frontend/src/modules/Player/hooks/useResilienceConfig.js` | Add `recoverySeekNudgeSeconds` + `maxSamePositionRetries` config | Modify |
| `frontend/src/modules/Player/hooks/useMediaResilience.js` | Use `recoverySeek` in `triggerRecovery`/`retryFromExhausted` | Modify |
| `frontend/src/Apps/fitnessSessionPersistence.js` | sessionStorage save/load/clear of the active play queue | Create |
| `frontend/src/Apps/fitnessSessionPersistence.test.js` | Unit tests for persistence module | Create |
| `frontend/src/Apps/FitnessApp.jsx` | Persist queue on change; restore on mount; `resume` flag bypasses sequential redirect | Modify |

---

## Task 1: Cap the software transcode target

The incident transcode was forced to 1080p60 / 20 Mbit/s libx264 (Plex defaults — callers pass `maxVideoBitrate=null`, `maxResolution=null`). We add default caps and a frame-rate ceiling so the encoder keeps ahead of realtime. The May 18 mitigation (`directPlay=0`, `videoCodec=h264,hevc`) is preserved.

**Files:**
- Create: `backend/src/1_adapters/content/media/plex/transcodeProfile.mjs`
- Create: `tests/unit/adapters/plex/transcodeProfile.test.mjs`
- Modify: `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:951` (`_buildTranscodeUrl`), `:1491` (`requestTranscodeDecision`)

- [ ] **Step 1: Write the failing test for the pure helpers**

Create `tests/unit/adapters/plex/transcodeProfile.test.mjs`:

```javascript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolveTranscodeCaps, buildClientProfileExtra } from '#adapters/content/media/plex/transcodeProfile.mjs';

describe('resolveTranscodeCaps', () => {
  it('applies default caps when caller passes nothing', () => {
    const caps = resolveTranscodeCaps({});
    expect(caps).toEqual({ maxVideoBitrate: 8000, maxResolution: '1080', maxFrameRate: 30 });
  });

  it('lets an explicit lower bitrate win but never raises above the default ceiling', () => {
    expect(resolveTranscodeCaps({ maxVideoBitrate: 4000 }).maxVideoBitrate).toBe(4000);
    expect(resolveTranscodeCaps({ maxVideoBitrate: 50000 }).maxVideoBitrate).toBe(8000);
  });

  it('passes through an explicit resolution', () => {
    expect(resolveTranscodeCaps({ maxResolution: '720' }).maxResolution).toBe('720');
  });
});

describe('buildClientProfileExtra', () => {
  it('appends a frame-rate upper-bound limitation to the codec advertisement', () => {
    const extra = buildClientProfileExtra({ maxFrameRate: 30 });
    expect(extra).toContain('videoCodec=h264,hevc');
    expect(extra).toContain('add-limitation(scope=videoCodec&scopeName=*&type=upperBound&name=video.frameRate&value=30)');
    // The two clauses are '+'-joined within the single X-Plex-Client-Profile-Extra value.
    expect(extra.split('+')).toHaveLength(2);
  });

  it('omits the limitation when no frame rate cap is given', () => {
    const extra = buildClientProfileExtra({});
    expect(extra).not.toContain('frameRate');
    expect(extra.split('+')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/adapters/plex/transcodeProfile.test.mjs`
Expected: FAIL — `Failed to resolve import "#adapters/content/media/plex/transcodeProfile.mjs"`.

- [ ] **Step 3: Implement the pure helpers**

Create `backend/src/1_adapters/content/media/plex/transcodeProfile.mjs`:

```javascript
/**
 * Pure transcode-profile helpers for PlexAdapter.
 *
 * The June 8 incident was a forced 1080p60 / 20 Mbit/s software libx264
 * transcode of an already-h264 source that fell behind realtime. These caps
 * keep the encoder ahead of realtime. The codec advertisement (h264,hevc) and
 * directPlay=0 default from the May 18 mitigation are preserved by the caller.
 */

export const DEFAULT_MAX_VIDEO_BITRATE = 8000; // kbps — was uncapped (~20000 from source)
export const DEFAULT_MAX_RESOLUTION = '1080';  // do not upscale beyond 1080p
export const DEFAULT_MAX_FRAME_RATE = 30;      // was 60 from source — halves encoder load

/**
 * Resolve the effective transcode caps. Explicit values lower the ceiling but
 * never raise it above the defaults (we only ever cap, never amplify).
 * @param {{maxVideoBitrate?:number, maxResolution?:string, maxFrameRate?:number}} opts
 */
export function resolveTranscodeCaps(opts = {}) {
  const reqBitrate = Number(opts.maxVideoBitrate);
  const maxVideoBitrate = Number.isFinite(reqBitrate)
    ? Math.min(reqBitrate, DEFAULT_MAX_VIDEO_BITRATE)
    : DEFAULT_MAX_VIDEO_BITRATE;

  const maxResolution = opts.maxResolution ? String(opts.maxResolution) : DEFAULT_MAX_RESOLUTION;

  const reqFps = Number(opts.maxFrameRate);
  const maxFrameRate = Number.isFinite(reqFps)
    ? Math.min(reqFps, DEFAULT_MAX_FRAME_RATE)
    : DEFAULT_MAX_FRAME_RATE;

  return { maxVideoBitrate, maxResolution, maxFrameRate };
}

const CODEC_ADVERT = 'append-transcode-target-codec(type=videoProfile&context=streaming&videoCodec=h264,hevc&audioCodec=aac&protocol=dash)';

/**
 * Build the X-Plex-Client-Profile-Extra value: the existing codec advertisement
 * plus an optional frame-rate upper-bound limitation, '+'-joined.
 * @param {{maxFrameRate?:number}} opts
 */
export function buildClientProfileExtra(opts = {}) {
  const clauses = [CODEC_ADVERT];
  const fps = Number(opts.maxFrameRate);
  if (Number.isFinite(fps) && fps > 0) {
    clauses.push(`add-limitation(scope=videoCodec&scopeName=*&type=upperBound&name=video.frameRate&value=${fps})`);
  }
  return clauses.join('+');
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/adapters/plex/transcodeProfile.test.mjs`
Expected: PASS — `Test Files 1 passed`, `Tests 5 passed`.

- [ ] **Step 5: Wire the caps into PlexAdapter**

In `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs`, add the import near the top of the file (next to the other imports):

```javascript
import { resolveTranscodeCaps, buildClientProfileExtra } from './transcodeProfile.mjs';
```

In `requestTranscodeDecision` (starts at `:1491`), replace the hard-coded codec advertisement string and the bitrate/resolution param block. Find the line that appends the `append-transcode-target-codec(...)` profile extra (around `:1513`) and the `maxVideoBitrate`/`maxResolution` appends (around `:1531-1535`), and change the method body so it computes caps first:

```javascript
    // Cap the transcode so software libx264 stays ahead of realtime (June 8 fix).
    const caps = resolveTranscodeCaps({ maxVideoBitrate, maxResolution });
    params.append('X-Plex-Client-Profile-Extra', buildClientProfileExtra({ maxFrameRate: caps.maxFrameRate }));
    params.append('directPlay', '0');
    // ...keep the existing directStream=0 line and other params as-is...
    params.append('maxVideoBitrate', String(caps.maxVideoBitrate));
    params.append('maxVideoResolution', String(caps.maxResolution));
```

Apply the identical change in `_buildTranscodeUrl` (starts at `:1610`): replace the inline `append-transcode-target-codec(...)` in `baseParams` (around `:1628`) with `buildClientProfileExtra({ maxFrameRate: caps.maxFrameRate })` after computing `const caps = resolveTranscodeCaps({ maxVideoBitrate, maxResolution });`, and push `maxVideoBitrate=${caps.maxVideoBitrate}` / `maxVideoResolution=${caps.maxResolution}` unconditionally instead of the `if (maxVideoBitrate != null)` guards.

> NOTE: keep using `encodeURIComponent(...)` exactly where the existing code does — only the value being encoded changes.

- [ ] **Step 6: Run the adapter's existing integrated smoke to confirm no regression**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/services/transcode-prewarm.test.mjs`
Expected: PASS (this exercises the prewarm/transcode decision path). If this file is not vitest-compatible in your checkout, instead re-run Step 4 and verify the helper tests are green; the wiring is a pure string substitution covered by the helper tests.

- [ ] **Step 7: Commit**

```bash
git add backend/src/1_adapters/content/media/plex/transcodeProfile.mjs \
        backend/src/1_adapters/content/media/plex/PlexAdapter.mjs \
        tests/unit/adapters/plex/transcodeProfile.test.mjs
git commit -m "fix(plex): cap transcode to 1080p/30fps/8Mbit so SW libx264 keeps realtime"
```

---

## Task 2: Tightly-gated direct-play for already-h264 sources

When the source is already h264 video + aac audio in an mp4 container, skip the transcode entirely (direct-play). This is the cleanest fix for the encoder bottleneck. We gate it tightly so the May 18 VP9/AV1 SourceBuffer-mismatch crash cannot recur.

**Files:**
- Modify: `backend/src/1_adapters/content/media/plex/transcodeProfile.mjs`
- Modify: `tests/unit/adapters/plex/transcodeProfile.test.mjs`
- Modify: `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:1491` (`requestTranscodeDecision`), `:1660` (`loadMediaUrl`)

- [ ] **Step 1: Write the failing test for `canDirectPlayH264`**

Append to `tests/unit/adapters/plex/transcodeProfile.test.mjs`:

```javascript
import { canDirectPlayH264 } from '#adapters/content/media/plex/transcodeProfile.mjs';

describe('canDirectPlayH264', () => {
  const h264Media = {
    Media: [{ container: 'mp4', videoCodec: 'h264', audioCodec: 'aac',
              Part: [{ container: 'mp4', key: '/library/parts/1/file.mp4' }] }]
  };

  it('allows direct play for h264/aac/mp4', () => {
    expect(canDirectPlayH264(h264Media)).toBe(true);
  });

  it('rejects non-h264 video (the VP9/AV1 mismatch class)', () => {
    expect(canDirectPlayH264({ Media: [{ container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', Part: [{ container: 'webm' }] }] })).toBe(false);
    expect(canDirectPlayH264({ Media: [{ container: 'mkv', videoCodec: 'av1', audioCodec: 'aac', Part: [{ container: 'mkv' }] }] })).toBe(false);
  });

  it('rejects non-mp4 containers and non-aac audio', () => {
    expect(canDirectPlayH264({ Media: [{ container: 'mkv', videoCodec: 'h264', audioCodec: 'aac', Part: [{ container: 'mkv' }] }] })).toBe(false);
    expect(canDirectPlayH264({ Media: [{ container: 'mp4', videoCodec: 'h264', audioCodec: 'ac3', Part: [{ container: 'mp4' }] }] })).toBe(false);
  });

  it('rejects missing/empty metadata', () => {
    expect(canDirectPlayH264(null)).toBe(false);
    expect(canDirectPlayH264({})).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/adapters/plex/transcodeProfile.test.mjs`
Expected: FAIL — `canDirectPlayH264 is not a function`.

- [ ] **Step 3: Implement `canDirectPlayH264`**

Append to `backend/src/1_adapters/content/media/plex/transcodeProfile.mjs`:

```javascript
/**
 * Tight direct-play gate. Only h264 video + aac audio in an mp4 container both
 * at the Media and Part level qualify. Everything else (vp9, av1, hevc-in-mkv,
 * ac3 audio, …) stays on the forced-transcode path so the MSE/SourceBuffer
 * codec-mismatch crash (see 2026-05-18 audit) cannot recur.
 * @param {{Media?: Array}} metadata - the Plex item metadata
 */
export function canDirectPlayH264(metadata) {
  const media = metadata?.Media?.[0];
  if (!media) return false;
  const part = media.Part?.[0];
  const norm = (v) => String(v ?? '').toLowerCase();
  return norm(media.videoCodec) === 'h264'
    && norm(media.audioCodec) === 'aac'
    && norm(media.container) === 'mp4'
    && norm(part?.container || media.container) === 'mp4';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/adapters/plex/transcodeProfile.test.mjs`
Expected: PASS — `Tests 9 passed`.

- [ ] **Step 5: Thread an `allowDirectPlay` flag through the adapter**

In `PlexAdapter.mjs` `loadMediaUrl` (the video branch around `:1716`), compute eligibility from the already-fetched `playableItem.metadata` and pass it into the decision:

```javascript
      const allowDirectPlay = canDirectPlayH264(playableItem.metadata);
      // Video: use decision API to authorize session
      const decisionResult = await this.requestTranscodeDecision(ratingKey, {
        maxVideoBitrate,
        maxResolution: resolvedMaxResolution,
        session,
        startOffset,
        allowDirectPlay
      });
```

Add `canDirectPlayH264` to the existing import from `./transcodeProfile.mjs`.

In `requestTranscodeDecision` (`:1491`), accept the new opt and make the `directPlay`/`directStream` params conditional (default stays `0` — forced transcode):

```javascript
      allowDirectPlay = false,
```
…in the destructured `opts`, then where it currently appends `directPlay`/`directStream`:

```javascript
    params.append('directPlay', allowDirectPlay ? '1' : '0');
    params.append('directStream', allowDirectPlay ? '1' : '0');
```

The existing success branch in `loadMediaUrl` (`:1744-1750`) already returns the `decision.directStreamPath` when `decision.canDirectPlay` — so when Plex agrees, direct-play is used automatically; when it doesn't, the capped transcode path (Task 1) is the fallback.

- [ ] **Step 6: Run the full helper suite again**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/adapters/plex/transcodeProfile.test.mjs`
Expected: PASS — `Tests 9 passed`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/1_adapters/content/media/plex/transcodeProfile.mjs \
        backend/src/1_adapters/content/media/plex/PlexAdapter.mjs \
        tests/unit/adapters/plex/transcodeProfile.test.mjs
git commit -m "feat(plex): direct-play h264/aac/mp4 sources, gated to avoid codec-mismatch"
```

---

## Task 3: Break the poisoned-segment recovery loop

During the incident every retry re-seeked to the exact stuck position (`offset=258`), so the loop never escaped. Add a forward nudge: after repeated same-position startup-deadline failures, advance the recovery seek past the stuck segment.

**Files:**
- Create: `frontend/src/modules/Player/hooks/recoverySeek.js`
- Create: `frontend/src/modules/Player/hooks/recoverySeek.test.js`
- Modify: `frontend/src/modules/Player/hooks/useResilienceConfig.js`
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js:163` (`triggerRecovery`)

- [ ] **Step 1: Write the failing test for the nudge helper**

Create `frontend/src/modules/Player/hooks/recoverySeek.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { computeRecoverySeekMs } from './recoverySeek.js';

const CFG = { nudgeSeconds: 6, maxSamePositionRetries: 2 };

describe('computeRecoverySeekMs', () => {
  it('returns the base seek unchanged on the first failure at a position', () => {
    const r = computeRecoverySeekMs({ baseSeekMs: 258000, tracker: { lastSeekMs: null, sameCount: 0 }, config: CFG });
    expect(r.seekMs).toBe(258000);
    expect(r.tracker).toEqual({ lastSeekMs: 258000, sameCount: 1 });
  });

  it('does NOT nudge until the same position has failed maxSamePositionRetries times', () => {
    const r = computeRecoverySeekMs({ baseSeekMs: 258000, tracker: { lastSeekMs: 258000, sameCount: 1 }, config: CFG });
    expect(r.seekMs).toBe(258000);
    expect(r.tracker.sameCount).toBe(2);
  });

  it('nudges forward once the same position exceeds the retry budget', () => {
    const r = computeRecoverySeekMs({ baseSeekMs: 258000, tracker: { lastSeekMs: 258000, sameCount: 2 }, config: CFG });
    expect(r.seekMs).toBe(264000); // +6s past the poisoned segment
    expect(r.tracker.lastSeekMs).toBe(264000);
  });

  it('resets the counter when the base position changes (genuine progress)', () => {
    const r = computeRecoverySeekMs({ baseSeekMs: 300000, tracker: { lastSeekMs: 258000, sameCount: 5 }, config: CFG });
    expect(r.seekMs).toBe(300000);
    expect(r.tracker).toEqual({ lastSeekMs: 300000, sameCount: 1 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Player/hooks/recoverySeek.test.js`
Expected: FAIL — cannot resolve `./recoverySeek.js`.

- [ ] **Step 3: Implement the nudge helper**

Create `frontend/src/modules/Player/hooks/recoverySeek.js`:

```javascript
/**
 * Decide the recovery seek position. A Plex transcode that wedges at a segment
 * makes re-seeking to the same offset reproduce the stall forever (June 8
 * incident). After `maxSamePositionRetries` consecutive failures at the same
 * position, nudge the seek forward by `nudgeSeconds` to move past the poisoned
 * segment. A changed base position resets the counter.
 *
 * @param {object} args
 * @param {number} args.baseSeekMs - the seek the resilience layer would use
 * @param {{lastSeekMs:number|null, sameCount:number}} args.tracker - prior state
 * @param {{nudgeSeconds:number, maxSamePositionRetries:number}} args.config
 * @returns {{seekMs:number, tracker:{lastSeekMs:number, sameCount:number}}}
 */
export function computeRecoverySeekMs({ baseSeekMs, tracker, config }) {
  const base = Number.isFinite(baseSeekMs) ? Math.max(0, baseSeekMs) : 0;
  const samePosition = tracker?.lastSeekMs != null && Math.abs(tracker.lastSeekMs - base) < 1000;

  if (!samePosition) {
    return { seekMs: base, tracker: { lastSeekMs: base, sameCount: 1 } };
  }

  const nextCount = (tracker.sameCount || 0) + 1;
  if (nextCount > config.maxSamePositionRetries) {
    const nudged = base + config.nudgeSeconds * 1000;
    return { seekMs: nudged, tracker: { lastSeekMs: nudged, sameCount: 1 } };
  }
  return { seekMs: base, tracker: { lastSeekMs: base, sameCount: nextCount } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Player/hooks/recoverySeek.test.js`
Expected: PASS — `Tests 4 passed`.

- [ ] **Step 5: Add the config knobs**

In `frontend/src/modules/Player/hooks/useResilienceConfig.js`, add to `DEFAULT_MEDIA_RESILIENCE_CONFIG.monitor` (after `recoveryCooldownBackoffMultiplier: 3`):

```javascript
    // Poisoned-segment escape: nudge the recovery seek forward after this many
    // consecutive same-position startup failures.
    maxSamePositionRetries: 2,
    recoverySeekNudgeSeconds: 6
```

And expose them in the returned `monitorSettings` block (after `recoveryCooldownBackoffMultiplier`):

```javascript
        maxSamePositionRetries: coerceNumber(monitorConfig.maxSamePositionRetries, 2),
        recoverySeekNudgeSeconds: coerceNumber(monitorConfig.recoverySeekNudgeSeconds, 6),
```

- [ ] **Step 6: Wire the helper into `triggerRecovery`**

In `frontend/src/modules/Player/hooks/useMediaResilience.js`:

Add the import at the top (with the other hook imports):

```javascript
import { computeRecoverySeekMs } from './recoverySeek.js';
```

Pull the new config values where `maxAttempts` is destructured (`:107` area) and where `monitorSettings` are read:

```javascript
  const { maxSamePositionRetries, recoverySeekNudgeSeconds } = monitorSettings;
```

Add a tracker ref next to `hasEverPlayedRef` (`:159`):

```javascript
  const recoverySeekTrackerRef = useRef({ lastSeekMs: null, sameCount: 0 });
```

In `triggerRecovery` (`:163`), replace the inline `seekToIntentMs` computation in the `onReload(...)` call (`:202`) with the nudged value:

```javascript
    if (typeof onReload === 'function') {
      const baseSeekMs = (targetTimeSeconds || playbackHealth.lastProgressSeconds || seconds || initialStart || 0) * 1000;
      const { seekMs, tracker } = computeRecoverySeekMs({
        baseSeekMs,
        tracker: recoverySeekTrackerRef.current,
        config: { nudgeSeconds: recoverySeekNudgeSeconds, maxSamePositionRetries: maxSamePositionRetries }
      });
      recoverySeekTrackerRef.current = tracker;
      onReload({
        reason,
        meta,
        waitKey,
        refreshUrl: shouldRefreshUrlForReason(reason),
        seekToIntentMs: seekMs
      });
    }
```

Reset the tracker when progress is observed. In the effect that clears the startup deadline on progress (`useMediaResilience.js:244-253`), add inside the `if (playbackHealth.progressToken > 0) {` block, right after `hasEverPlayedRef.current = true;`:

```javascript
      recoverySeekTrackerRef.current = { lastSeekMs: null, sameCount: 0 };
```

Add `maxSamePositionRetries`, `recoverySeekNudgeSeconds` to the `triggerRecovery` `useCallback` dependency array.

- [ ] **Step 7: Verify the helper + existing resilience tests still pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Player/hooks/recoverySeek.test.js`
Expected: PASS.

Run any existing resilience specs to confirm no regression:
`./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Player`
Expected: PASS (or "no test files" for dirs without specs — that is acceptable, not a failure of this task).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Player/hooks/recoverySeek.js \
        frontend/src/modules/Player/hooks/recoverySeek.test.js \
        frontend/src/modules/Player/hooks/useResilienceConfig.js \
        frontend/src/modules/Player/hooks/useMediaResilience.js
git commit -m "fix(player): nudge recovery seek past a poisoned transcode segment"
```

---

## Task 4: Persist & restore the active fitness session across F5

The active play queue lives only in React state (`FitnessApp.jsx:54`), so a hard reload loses it. Mirror it to `sessionStorage` and restore on mount.

**Files:**
- Create: `frontend/src/Apps/fitnessSessionPersistence.js`
- Create: `frontend/src/Apps/fitnessSessionPersistence.test.js`
- Modify: `frontend/src/Apps/FitnessApp.jsx:54` (state), and the play-queue setters / mount effect

- [ ] **Step 1: Write the failing test for the persistence module**

Create `frontend/src/Apps/fitnessSessionPersistence.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { saveActiveSession, loadActiveSession, clearActiveSession } from './fitnessSessionPersistence.js';

describe('fitnessSessionPersistence', () => {
  beforeEach(() => { window.sessionStorage.clear(); });

  it('round-trips a non-empty queue', () => {
    const queue = [{ id: '674287', contentId: 'plex:674287', title: 'Daytona' }];
    saveActiveSession(queue);
    expect(loadActiveSession()).toEqual(queue);
  });

  it('clears persisted state when an empty queue is saved', () => {
    saveActiveSession([{ id: '1' }]);
    saveActiveSession([]);
    expect(loadActiveSession()).toBeNull();
  });

  it('clearActiveSession removes the entry', () => {
    saveActiveSession([{ id: '1' }]);
    clearActiveSession();
    expect(loadActiveSession()).toBeNull();
  });

  it('returns null on corrupt JSON instead of throwing', () => {
    window.sessionStorage.setItem('daylight.fitness.activeSession', '{not json');
    expect(loadActiveSession()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/Apps/fitnessSessionPersistence.test.js`
Expected: FAIL — cannot resolve `./fitnessSessionPersistence.js`.

- [ ] **Step 3: Implement the persistence module**

Create `frontend/src/Apps/fitnessSessionPersistence.js`:

```javascript
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'fitness-session-persistence' });
  return _logger;
}

const KEY = 'daylight.fitness.activeSession';

/** Persist the active play queue. An empty/absent queue clears the entry. */
export function saveActiveSession(queue) {
  try {
    if (!Array.isArray(queue) || queue.length === 0) { clearActiveSession(); return; }
    window.sessionStorage.setItem(KEY, JSON.stringify({ queue, savedAt: Date.now() }));
  } catch (err) {
    logger().warn('fitness.session_persist.save_failed', { message: err?.message ?? null });
  }
}

/** Load the active play queue, or null if none/corrupt. */
export function loadActiveSession() {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const queue = parsed?.queue;
    return Array.isArray(queue) && queue.length > 0 ? queue : null;
  } catch (err) {
    logger().warn('fitness.session_persist.load_failed', { message: err?.message ?? null });
    return null;
  }
}

export function clearActiveSession() {
  try { window.sessionStorage.removeItem(KEY); } catch { /* noop */ }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/Apps/fitnessSessionPersistence.test.js`
Expected: PASS — `Tests 4 passed`.

- [ ] **Step 5: Wire persistence into FitnessApp**

In `frontend/src/Apps/FitnessApp.jsx`, add the import near the other local imports:

```javascript
import { saveActiveSession, loadActiveSession, clearActiveSession } from './fitnessSessionPersistence.js';
```

Persist whenever the queue changes — add this effect right after the `fitnessPlayQueue` state declaration (`:54`):

```javascript
  useEffect(() => {
    if (fitnessPlayQueue.length > 0) saveActiveSession(fitnessPlayQueue);
    else clearActiveSession();
  }, [fitnessPlayQueue]);
```

Restore on mount — at the start of the URL-init effect (`:1051`, the `if (fitnessPlayQueue.length > 0) return;` guard), restore from storage before consulting the URL:

```javascript
    if (fitnessPlayQueue.length > 0) return;
    const restored = loadActiveSession();
    if (restored) {
      setFitnessPlayQueue(restored);
      logger.info('fitness-session-restored-from-storage', { id: restored[0]?.id, size: restored.length });
      return;
    }
    handlePlayFromUrl(urlState.id, { nogovern });
```

(Confirm `useEffect` is already imported in `FitnessApp.jsx` — it is used throughout; no import change needed.)

- [ ] **Step 6: Verify the persistence test still passes and the app builds**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/Apps/fitnessSessionPersistence.test.js`
Expected: PASS.

Run a lint/build sanity check on the changed file:
`cd frontend && npx vite build --mode development 2>&1 | tail -5` (from repo root: `npm run build` if defined).
Expected: build completes without errors referencing `FitnessApp.jsx`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/Apps/fitnessSessionPersistence.js \
        frontend/src/Apps/fitnessSessionPersistence.test.js \
        frontend/src/Apps/FitnessApp.jsx
git commit -m "feat(fitness): persist active play queue to sessionStorage and restore on F5"
```

---

## Task 5: Resume sequential shows in place instead of redirecting

`handlePlayFromUrl` redirects a sequential-show episode to the show list (`FitnessApp.jsx:768-776`). On a resume/reload we want the player to resume, not bounce to the episode list.

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx:739` (`handlePlayFromUrl`) and its mount-resume call site

- [ ] **Step 1: Add a `resume` option that bypasses the sequential redirect**

Change the `handlePlayFromUrl` signature (`:739`):

```javascript
  const handlePlayFromUrl = async (episodeId, { nogovern = false, resume = false } = {}) => {
```

Guard the sequential-redirect block (`:768`) so it is skipped when resuming:

```javascript
      if (isInSequentialShow && !nogovern && !resume) {
```

- [ ] **Step 2: Pass `resume: true` from the storage-restore / URL-init path**

In the URL-init effect (the code added in Task 4 Step 5), the storage restore already calls `setFitnessPlayQueue(restored)` directly (no redirect risk). For the URL-only fallback after a reload, pass `resume: true`:

```javascript
    handlePlayFromUrl(urlState.id, { nogovern, resume: true });
```

(Fresh menu navigations call `handlePlayFromUrl(id, { nogovern })` from `handleNavigation` at `:1135` WITHOUT `resume`, so the sequential redirect still applies for intentional navigation — only reload/resume bypasses it.)

- [ ] **Step 3: Manual verification on the dev server**

This path is integration-level (router + effects). Verify against a running dev server rather than a unit test:

```bash
ss -tlnp | grep 3112 || node backend/index.js &   # ensure backend is up (see CLAUDE.local.md)
```
Then in a browser at `/fitness/play/<sequential-episode-id>`, start playback, press F5, and confirm the player resumes the same episode instead of dropping to the show list or the home screen. Capture the console `fitness-session-restored-from-storage` log line as evidence.

Expected: after F5, `fitness-session-restored-from-storage` is logged and the player view reappears with the same queue item.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx
git commit -m "fix(fitness): resume sequential shows on reload instead of redirecting to show list"
```

---

## Final Verification

- [ ] Run all new unit suites together:

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  tests/unit/adapters/plex/transcodeProfile.test.mjs \
  frontend/src/modules/Player/hooks/recoverySeek.test.js \
  frontend/src/Apps/fitnessSessionPersistence.test.js
```
Expected: all files passed, 0 failed.

- [ ] Deploy to the garage fitness host and reload the kiosk Firefox (see CLAUDE.local.md), then play the Game Cycling content that stalled (`plex:674287`) and confirm: (a) playback stays ahead of realtime / direct-plays, (b) an induced stall recovers by nudging forward rather than looping, (c) F5 resumes the session.
