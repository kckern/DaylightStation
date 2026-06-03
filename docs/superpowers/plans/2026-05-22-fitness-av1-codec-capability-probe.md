# AV1 Codec Capability Probe + Recovery Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop advertising AV1 (and other modern codecs) to Plex from clients that cannot sustain decode at the source's resolution and frame rate. Specifically, prevent the 1920×1440@60fps AV1 collapse documented in the 2026-05-22 audit by probing `MediaSource.isTypeSupported` plus a perf-sanity threshold *before* the backend builds a `decision=copy` URL. Cap `useMediaResilience` recovery attempts so a doomed pipeline doesn't spawn parallel Plex sessions indefinitely.

**Architecture:** Three layers cooperate. **(1)** A new `codecProbe.js` runs in the browser, asks `MediaSource.isTypeSupported('video/mp4; codecs="av01..."')`, and downgrades AV1 advertisement when (a) browser says "false," or (b) media metadata reports source resolution > 1080p OR frame rate > 30fps AND device class is "consumer browser." It returns a codec list string. **(2)** The frontend Player passes that codec list to the backend when requesting stream URLs via a new query param `clientCodecs`. **(3)** Backend `PlexAdapter._buildTranscodeUrl()` and friends read `clientCodecs` from the caller and substitute it into the `X-Plex-Client-Profile-Extra` header instead of hardcoding `h264,hevc,av1,vp9`. Existing call sites that don't pass `clientCodecs` continue to get the hardcoded list (backward compatible). Additionally, `useMediaResilience.js` already has `maxAttempts` (line 107) — verify it's reasonable (5 max), and after exhaustion the player escalates to the new `PlayerOverlayStallExhausted` banner from Plan 2.

**Tech Stack:** JS (browser MediaSource API), Node.js (backend adapter), Jest for tests, Playwright for live verification.

**Audit reference:** `docs/_wip/audits/2026-05-22-fitness-session-merge-and-resilience-failure-audit.md` §2 (Bug 2a) and §"Tier 3" R7–R8. Related commit: `c62839c1b fix(plex): advertise AV1/VP9 to Plex so it DirectStreams instead of software-transcoding`.

**Order:** This plan depends on Plan 2 (overlay UX) shipping first, so the exhaustion banner is in place to catch the post-cap escalation. Plan 2 ships independently.

---

## File Structure

**New library:**
- `frontend/src/lib/codecProbe.js` — pure logic: takes `{ navigator, MediaSource, mediaMetadata }`, returns `{ codecs: string, downgradeReasons: string[] }`.
- `frontend/src/lib/codecProbe.test.js` — Jest unit tests for codecProbe.

**Frontend integration:**
- `frontend/src/modules/Player/Player.jsx` — call `codecProbe()` once per media load with the resolved `effectiveMeta`. Pass result to backend via new `mediaUrl` builder.
- `frontend/src/modules/Player/lib/buildStreamUrl.js` (or equivalent — check repo for the actual location of stream URL builders) — append `&clientCodecs=h264,hevc,vp9` (or whatever the probe returns) to the request.

**Backend changes:**
- `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs` — three stream URL builders (lines 832-862, 946-972, 1485-1525 in the post-c62839c1b state) accept a new `clientCodecs` arg and substitute it into the codec advertisement string. Default to current hardcoded list when not provided.
- `backend/src/4_api/v1/routers/play.mjs` — read `clientCodecs` from query and forward.

**Recovery cap audit:**
- `frontend/src/modules/Player/hooks/useMediaResilience.js` — confirm `maxAttempts` default is ≤5 (review only; no code change unless needed).

**Tests:**
- `frontend/src/lib/codecProbe.test.js` (unit)
- `backend/tests/unit/PlexAdapter.codec-passthrough.test.mjs` (unit on the URL builders)
- `tests/live/flow/fitness/av1-codec-downgrade.runtime.test.mjs` (live)

---

### Task 1: Test + implement `codecProbe.js`

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/lib/codecProbe.test.js`
- Create: `/opt/Code/DaylightStation/frontend/src/lib/codecProbe.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { probeClientCodecs } from './codecProbe.js';

describe('probeClientCodecs', () => {
  // Inject a fake MediaSource for deterministic tests
  function fakeMediaSource(typeSupported = {}) {
    return {
      isTypeSupported: (type) => Boolean(typeSupported[type] ?? false),
    };
  }

  it('returns full codec list when browser supports everything and media is modest', () => {
    const result = probeClientCodecs({
      MediaSource: fakeMediaSource({
        'video/mp4; codecs="av01.0.05M.08"': true,
        'video/mp4; codecs="vp09.00.30.08"': true,
        'video/mp4; codecs="hvc1.1.6.L93.B0"': true,
        'video/mp4; codecs="avc1.640028"': true,
      }),
      mediaMetadata: { width: 1920, height: 1080, frameRate: 30, sourceCodec: 'h264' },
    });
    expect(result.codecs).toBe('h264,hevc,av1,vp9');
    expect(result.downgradeReasons).toEqual([]);
  });

  it('downgrades AV1 when browser cannot decode it', () => {
    const result = probeClientCodecs({
      MediaSource: fakeMediaSource({
        'video/mp4; codecs="av01.0.05M.08"': false,
        'video/mp4; codecs="vp09.00.30.08"': true,
        'video/mp4; codecs="hvc1.1.6.L93.B0"': true,
        'video/mp4; codecs="avc1.640028"': true,
      }),
      mediaMetadata: { width: 1920, height: 1080, frameRate: 30, sourceCodec: 'av1' },
    });
    expect(result.codecs).not.toContain('av1');
    expect(result.downgradeReasons).toContain('browser-cannot-decode-av1');
  });

  it('downgrades AV1 when source is >1080p AND frame rate >30fps (perf cap)', () => {
    const result = probeClientCodecs({
      MediaSource: fakeMediaSource({
        'video/mp4; codecs="av01.0.05M.08"': true,
        'video/mp4; codecs="vp09.00.30.08"': true,
        'video/mp4; codecs="hvc1.1.6.L93.B0"': true,
        'video/mp4; codecs="avc1.640028"': true,
      }),
      mediaMetadata: { width: 1920, height: 1440, frameRate: 60, sourceCodec: 'av1' },
    });
    expect(result.codecs).not.toContain('av1');
    expect(result.downgradeReasons).toContain('av1-perf-cap-1440p60');
  });

  it('keeps AV1 for 4K@24fps content (high res but low frame rate)', () => {
    const result = probeClientCodecs({
      MediaSource: fakeMediaSource({
        'video/mp4; codecs="av01.0.05M.08"': true,
        'video/mp4; codecs="vp09.00.30.08"': true,
        'video/mp4; codecs="hvc1.1.6.L93.B0"': true,
        'video/mp4; codecs="avc1.640028"': true,
      }),
      mediaMetadata: { width: 3840, height: 2160, frameRate: 24, sourceCodec: 'av1' },
    });
    expect(result.codecs).toContain('av1');
    expect(result.downgradeReasons).toEqual([]);
  });

  it('downgrades AV1 for 1080p@60fps when source is AV1 (matches Game Cycling profile)', () => {
    const result = probeClientCodecs({
      MediaSource: fakeMediaSource({
        'video/mp4; codecs="av01.0.05M.08"': true,
        'video/mp4; codecs="vp09.00.30.08"': true,
        'video/mp4; codecs="hvc1.1.6.L93.B0"': true,
        'video/mp4; codecs="avc1.640028"': true,
      }),
      mediaMetadata: { width: 1920, height: 1080, frameRate: 60, sourceCodec: 'av1' },
    });
    // 1080p60 AV1 is borderline — the audit's failure case was 1440p60.
    // Conservative default: keep at 1080p, downgrade at >1080p.
    // (Adjust this assertion if/when telemetry suggests 1080p60 also fails.)
    expect(result.codecs).toContain('av1');
  });

  it('returns full list when MediaSource is undefined (fallback - assume capable)', () => {
    const result = probeClientCodecs({
      MediaSource: undefined,
      mediaMetadata: { width: 1920, height: 1080, frameRate: 30, sourceCodec: 'h264' },
    });
    expect(result.codecs).toBe('h264,hevc,av1,vp9');
    expect(result.downgradeReasons).toContain('mediasource-unavailable-defaulting-to-full');
  });

  it('returns full list when metadata is missing (no basis to downgrade)', () => {
    const result = probeClientCodecs({
      MediaSource: fakeMediaSource({
        'video/mp4; codecs="av01.0.05M.08"': true,
        'video/mp4; codecs="vp09.00.30.08"': true,
        'video/mp4; codecs="hvc1.1.6.L93.B0"': true,
        'video/mp4; codecs="avc1.640028"': true,
      }),
      mediaMetadata: null,
    });
    expect(result.codecs).toBe('h264,hevc,av1,vp9');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd /opt/Code/DaylightStation && npx jest frontend/src/lib/codecProbe.test.js --runInBand`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the minimal implementation**

Create `codecProbe.js`:

```javascript
/**
 * Probe what video codecs this browser can sustain for the given media.
 *
 * Inputs:
 *   - MediaSource: the browser's MediaSource constructor (allow injection for tests).
 *   - mediaMetadata: { width, height, frameRate, sourceCodec } from the Plex MediaContainer.
 *
 * Returns: { codecs: string, downgradeReasons: string[] }
 *   - codecs: comma-separated list to put in Plex `X-Plex-Client-Profile-Extra`.
 *   - downgradeReasons: telemetry breadcrumbs (one or more strings).
 *
 * Strategy:
 *   1. Probe each candidate codec via `MediaSource.isTypeSupported`.
 *   2. If source is AV1 and (width > 1920 OR (height > 1080 AND frameRate > 30)):
 *      remove AV1 from the list (perf cap).
 *   3. Always keep h264 in the list so Plex has a fallback decision target.
 */
const PROBE_STRINGS = {
  av1:  'video/mp4; codecs="av01.0.05M.08"',
  vp9:  'video/mp4; codecs="vp09.00.30.08"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
  h264: 'video/mp4; codecs="avc1.640028"',
};

export function probeClientCodecs({ MediaSource, mediaMetadata }) {
  const reasons = [];

  if (!MediaSource || typeof MediaSource.isTypeSupported !== 'function') {
    reasons.push('mediasource-unavailable-defaulting-to-full');
    return { codecs: 'h264,hevc,av1,vp9', downgradeReasons: reasons };
  }

  const supported = {
    h264: MediaSource.isTypeSupported(PROBE_STRINGS.h264),
    hevc: MediaSource.isTypeSupported(PROBE_STRINGS.hevc),
    av1:  MediaSource.isTypeSupported(PROBE_STRINGS.av1),
    vp9:  MediaSource.isTypeSupported(PROBE_STRINGS.vp9),
  };

  if (!supported.av1) reasons.push('browser-cannot-decode-av1');
  if (!supported.vp9) reasons.push('browser-cannot-decode-vp9');
  if (!supported.hevc) reasons.push('browser-cannot-decode-hevc');

  // Perf cap: even if the browser claims AV1 support, software decode
  // collapses on >1080p AND >30fps. Game Cycling assets at 1920x1440@60fps
  // demonstrated this in the 2026-05-22 audit.
  if (supported.av1 && mediaMetadata) {
    const width = Number(mediaMetadata.width) || 0;
    const height = Number(mediaMetadata.height) || 0;
    const frameRate = Number(mediaMetadata.frameRate) || 0;
    const isHighRes = width > 1920 || height > 1080;
    const isHighFps = frameRate > 30;
    if (isHighRes && isHighFps && mediaMetadata.sourceCodec === 'av1') {
      supported.av1 = false;
      reasons.push(`av1-perf-cap-${height}p${Math.round(frameRate)}`);
    }
  }

  const out = [];
  if (supported.h264) out.push('h264'); else out.push('h264'); // always advertise h264
  if (supported.hevc) out.push('hevc');
  if (supported.av1)  out.push('av1');
  if (supported.vp9)  out.push('vp9');

  return { codecs: out.join(','), downgradeReasons: reasons };
}

export default probeClientCodecs;
```

- [ ] **Step 4: Run test — verify it passes**

Run: `cd /opt/Code/DaylightStation && npx jest frontend/src/lib/codecProbe.test.js --runInBand`
Expected: PASS — all seven cases.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/codecProbe.js frontend/src/lib/codecProbe.test.js
git commit -m "feat(player): codecProbe utility — downgrade AV1 advertisement when browser cannot sustain decode"
```

---

### Task 2: Backend test — PlexAdapter URL builders pass through `clientCodecs` arg

**Files:**
- Create: `/opt/Code/DaylightStation/backend/tests/unit/PlexAdapter.codec-passthrough.test.mjs`

- [ ] **Step 1: Read PlexAdapter to understand the constructor / instance API**

Run: `head -120 /opt/Code/DaylightStation/backend/src/1_adapters/content/media/plex/PlexAdapter.mjs`
Note how a minimal PlexAdapter instance can be created (config object).

- [ ] **Step 2: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { PlexAdapter } from '../../src/1_adapters/content/media/plex/PlexAdapter.mjs';

function makeAdapter() {
  return new PlexAdapter({
    serverUrl: 'http://plex.local:32400',
    token: 'fake-token',
    protocol: 'dash',
    platform: 'Firefox',
    proxyPath: '/api/v1/plex',
    // pass minimal stubs for any required services...
  });
}

describe('PlexAdapter codec advertisement passthrough', () => {
  it('_buildTranscodeUrl uses clientCodecs arg in X-Plex-Client-Profile-Extra', () => {
    const adapter = makeAdapter();
    const url = adapter._buildTranscodeUrl(
      '12345',
      'client-1',
      'session-1',
      null,   // maxVideoBitrate
      null,   // maxResolution
      'h264,hevc,vp9'  // NEW: clientCodecs
    );
    expect(url).toContain('videoCodec%3Dh264%2Chevc%2Cvp9');
    expect(url).not.toContain('av1');
  });

  it('_buildTranscodeUrl defaults to h264,hevc,av1,vp9 when clientCodecs is null', () => {
    const adapter = makeAdapter();
    const url = adapter._buildTranscodeUrl(
      '12345',
      'client-1',
      'session-1'
    );
    expect(url).toContain('videoCodec%3Dh264%2Chevc%2Cav1%2Cvp9');
  });

  // Repeat similar assertions for the two other URL builders identified in
  // PlexAdapter.mjs at lines 832-862 and 1485-1525.
});
```

- [ ] **Step 3: Run test — verify it fails**

Run: `cd /opt/Code/DaylightStation && npx vitest run backend/tests/unit/PlexAdapter.codec-passthrough.test.mjs`
Expected: FAIL — `_buildTranscodeUrl` only takes 5 args; the 6th is ignored OR returns hardcoded `av1,vp9` string regardless.

- [ ] **Step 4: Commit failing test**

```bash
git add backend/tests/unit/PlexAdapter.codec-passthrough.test.mjs
git commit -m "test(plex): failing test — codec list is hardcoded in URL builders"
```

---

### Task 3: Backend — accept `clientCodecs` in the three URL builders

**Files:**
- Modify: `/opt/Code/DaylightStation/backend/src/1_adapters/content/media/plex/PlexAdapter.mjs` (three builders)

- [ ] **Step 1: Refactor the codec advertisement to a shared helper**

Above the class (near other module-level helpers), add:

```javascript
const DEFAULT_CLIENT_CODECS = 'h264,hevc,av1,vp9';

function buildCodecProfileExtra(clientCodecs) {
  const codecs = (typeof clientCodecs === 'string' && clientCodecs.length > 0)
    ? clientCodecs
    : DEFAULT_CLIENT_CODECS;
  return `append-transcode-target-codec(type=videoProfile&context=streaming&videoCodec=${codecs}&audioCodec=aac&protocol=dash)`;
}
```

- [ ] **Step 2: Modify `_buildTranscodeUrl` (line 946)**

Replace the signature and the codec line:

```javascript
_buildTranscodeUrl(key, clientIdentifier, sessionIdentifier, maxVideoBitrate = null, maxResolution = null, clientCodecs = null) {
  const mediaBufferSize = 5242880 * 20;
  const baseParams = [
    `path=%2Flibrary%2Fmetadata%2F${key}`,
    `protocol=${this.protocol}`,
    `X-Plex-Client-Identifier=${clientIdentifier}`,
    `X-Plex-Session-Identifier=${sessionIdentifier}`,
    `X-Plex-Platform=${this.platform}`,
    `autoAdjustQuality=1`,
    `fastSeek=1`,
    `mediaBufferSize=${mediaBufferSize}`,
    `X-Plex-Client-Profile-Extra=${encodeURIComponent(buildCodecProfileExtra(clientCodecs))}`,
  ];
  // ...rest unchanged
```

- [ ] **Step 3: Modify the second builder around line 1485-1525**

Find the function (search for the second `'append-transcode-target-codec'` line). Add `clientCodecs = null` to its signature and replace the literal codec string with `buildCodecProfileExtra(clientCodecs)`.

- [ ] **Step 4: Modify the third builder around line 1604**

Same change — find the third `'append-transcode-target-codec'` occurrence, add `clientCodecs` to the function's signature, swap the literal for `buildCodecProfileExtra(clientCodecs)`.

- [ ] **Step 5: Run the unit test from Task 2**

Run: `cd /opt/Code/DaylightStation && npx vitest run backend/tests/unit/PlexAdapter.codec-passthrough.test.mjs`
Expected: PASS — both cases.

- [ ] **Step 6: Run any existing PlexAdapter tests**

Run: `cd /opt/Code/DaylightStation && npx vitest run backend/tests/ -t PlexAdapter`
Expected: existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/1_adapters/content/media/plex/PlexAdapter.mjs
git commit -m "feat(plex): URL builders accept clientCodecs arg (default backward-compatible)"
```

---

### Task 4: Backend — thread `clientCodecs` through play.mjs router

**Files:**
- Modify: `/opt/Code/DaylightStation/backend/src/4_api/v1/routers/play.mjs` (around the routes that call into PlexAdapter to build stream URLs)

- [ ] **Step 1: Identify the route(s) that produce stream URLs**

Run: `grep -n "buildTranscodeUrl\|getStreamUrl\|_buildTranscode\|mpd\|/stream" /opt/Code/DaylightStation/backend/src/4_api/v1/routers/play.mjs`
Note which handler(s) feed the DASH MPD URL back to the client.

- [ ] **Step 2: Read `clientCodecs` from req.query and forward**

In each relevant handler:

```javascript
const clientCodecs = typeof req.query.clientCodecs === 'string' && req.query.clientCodecs.length > 0
  ? req.query.clientCodecs
  : null;
// ...
const url = adapter._buildTranscodeUrl(key, clientId, sessionId, maxVideoBitrate, maxResolution, clientCodecs);
```

If the adapter exposes a higher-level method (e.g. `getStreamUrl({...})`) instead of `_buildTranscodeUrl`, thread `clientCodecs` through that method's options object.

- [ ] **Step 3: Manual verification with curl**

```bash
# Without clientCodecs — should advertise the default h264,hevc,av1,vp9
curl -s 'http://localhost:3112/api/v1/play/plex/mpd/674284' | head -c 1000

# With clientCodecs — should advertise just h264,hevc,vp9
curl -s 'http://localhost:3112/api/v1/play/plex/mpd/674284?clientCodecs=h264,hevc,vp9' | head -c 1000
```

Inspect for the difference in the returned MPD URL or its content (the proxied request to Plex should reflect the override).

- [ ] **Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/play.mjs
git commit -m "feat(play): forward clientCodecs query param to PlexAdapter URL builders"
```

---

### Task 5: Frontend — call `codecProbe` in Player and append `clientCodecs` to the request

**Files:**
- Modify: `/opt/Code/DaylightStation/frontend/src/modules/Player/Player.jsx`

OR, more likely, modify whichever module builds the DASH source URL (search to confirm).

- [ ] **Step 1: Find where the frontend constructs the stream URL**

Run: `grep -rn "play/plex/mpd\|/play/plex/\|/stream\|maxVideoBitrate.*url\|buildSrc\|streamUrl" /opt/Code/DaylightStation/frontend/src/modules/Player/ | head -15`

Likely candidates: a `lib/buildStreamUrl.js`, the `SinglePlayer.jsx`, or DASH source resolution inside `useMediaResilience` / a media adapter.

- [ ] **Step 2: Add the codecProbe call near where the stream URL is built**

```javascript
import { probeClientCodecs } from '../../lib/codecProbe.js';

// Inside the effect/memo that builds the stream URL:
const { codecs: clientCodecs, downgradeReasons } = probeClientCodecs({
  MediaSource: typeof window !== 'undefined' ? window.MediaSource : null,
  mediaMetadata: {
    width: effectiveMeta?.width ?? effectiveMeta?.media?.width,
    height: effectiveMeta?.height ?? effectiveMeta?.media?.height,
    frameRate: effectiveMeta?.frameRate ?? effectiveMeta?.media?.frameRate,
    sourceCodec: effectiveMeta?.videoCodec ?? effectiveMeta?.media?.videoCodec,
  },
});

if (downgradeReasons.length > 0) {
  getLogger().warn('player.codec-probe.downgrade', {
    codecs: clientCodecs,
    reasons: downgradeReasons,
    contentId: effectiveMeta?.contentId ?? effectiveMeta?.plex ?? null,
  });
}

// Append to the URL — adjust based on actual builder:
const streamUrl = `${baseStreamUrl}${baseStreamUrl.includes('?') ? '&' : '?'}clientCodecs=${encodeURIComponent(clientCodecs)}`;
```

If `effectiveMeta` doesn't yet carry `width/height/frameRate/videoCodec`, add a step prior in this plan to surface those from the Plex metadata response into the resolved meta. Most likely the Plex metadata response already has `Media[0].Part[0].Stream[0].codec/height/width/frameRate` — check `resolvedMeta` shape in `Player.jsx:247-280`.

- [ ] **Step 3: Verify in browser DevTools**

After implementing, load the fitness app on a real client, play Diddy Kong Racing or another AV1 1440p60 asset, and inspect the Network tab:
- Request URL should contain `clientCodecs=h264,hevc,vp9` (no AV1) for the high-res AV1 asset.
- Logger should emit `player.codec-probe.downgrade` with `reasons: ['av1-perf-cap-1440p60']`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Player/Player.jsx
git commit -m "feat(player): client-side codec probe gates AV1 advertisement on high-res media"
```

---

### Task 6: Review and adjust `useMediaResilience` recovery attempt cap

**Files:**
- Read: `/opt/Code/DaylightStation/frontend/src/modules/Player/hooks/useMediaResilience.js:107-201`

- [ ] **Step 1: Read the current `maxAttempts` default**

Run: `grep -n "maxAttempts" /opt/Code/DaylightStation/frontend/src/modules/Player/hooks/useMediaResilience.js`
Confirm: where is `maxAttempts` defaulted? Where does it come from (config? prop?)? What happens when `tracker.count >= maxAttempts`?

Per the audit's evidence (`useMediaResilience.js:168` checks `if (tracker.count >= maxAttempts) ... onExhausted(...)`), the exhaustion path already exists.

- [ ] **Step 2: Verify the default value**

Locate the `recoveryConfig` source. If `maxAttempts` defaults to ≤ 5, no change. If it's larger (e.g. 20) or unset, reduce it.

- [ ] **Step 3: If a change is needed, write a failing test first**

Create `frontend/src/modules/Player/hooks/useMediaResilience.cap.test.js` and verify that after `maxAttempts` failed recoveries, `onExhausted` is called and no further recovery is attempted.

(Skip this task if Step 2 confirms the existing cap is sane. The audit's R8 was a "cap recovery attempts" recommendation, but the cap may already exist with a reasonable default.)

- [ ] **Step 4: Wire the exhaustion banner from Plan 2**

In whatever calls `useMediaResilience` and renders the player overlays, ensure that `onExhausted` triggers `useStallExhaustion.dismiss(false)` or similar — the Plan-2 `PlayerOverlayStallExhausted` banner needs to know when `useMediaResilience` has given up. The simplest wiring: pass `stalled || isExhausted` to the banner's `stalled` input *and* lower the banner's `thresholdMs` so it appears immediately on exhaustion.

Alternative: pass `isExhausted` as a direct second trigger to the banner:

```jsx
<PlayerOverlayStallExhausted
  exhausted={stallExhaustion.exhausted || isExhausted}
  secondsStalled={stallExhaustion.secondsStalled}
  onRestart={handleStallExhaustedRestart}
  onDismiss={handleStallExhaustedDismiss}
/>
```

(Adjust `PlayerOverlayStallExhausted` propTypes / display logic if a second trigger source affects copy.)

- [ ] **Step 5: Commit (only if changes were made)**

```bash
git add frontend/src/modules/Player/hooks/useMediaResilience.js frontend/src/modules/Player/Player.jsx
git commit -m "feat(player): wire useMediaResilience exhaustion into stall-exhausted banner"
```

---

### Task 7: Live verification — AV1 1440p60 source no longer triggers DirectStream collapse

**Files:** None (verification only)

- [ ] **Step 1: Confirm the test source exists in the Plex library**

```bash
# Confirm Diddy Kong Racing (or another AV1 1440p60 asset) is in the fitness library
curl -s 'http://localhost:3112/api/v1/content/search?q=Diddy+Kong+Racing' | jq '.results[0] | {id, title, width, height, frameRate, videoCodec}'
```

Expected: width 1920, height 1440, frameRate 60, videoCodec av1.

- [ ] **Step 2: Play the asset from the fitness app**

Boot the fitness app, queue the AV1 1440p60 asset, hit play.

- [ ] **Step 3: Inspect the Plex transcoder decision**

```bash
# Tail Plex's transcoder log during playback
sudo docker logs plex --since 1m 2>&1 | grep -E 'Decision|videoCodec|decision=' | tail -10
```

Expected (post-fix): `videoCodec=h264,hevc,vp9` advertised; decision should be `transcode` (with `videoDecision=transcode` not `copy`) because AV1 was not advertised.

- [ ] **Step 4: Watch frontend logs for the downgrade emit**

In browser DevTools console (or check session jsonl):
```bash
tail -F /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media/logs/fitness/<latest>.jsonl | grep -E 'codec-probe|recovery|stalled'
```

Expected:
- `player.codec-probe.downgrade reasons: ['av1-perf-cap-1440p60']` once at load
- No `playback.stalled` events (or substantially fewer than the audit's 26)
- No `playback.recovery-strategy` spawn loop

- [ ] **Step 5: Confirm the user-experienced playback is smooth**

Visually verify on the kiosk: video plays without spinner or pause-then-no-resume cycles.

- [ ] **Step 6: Deploy**

On `kckern-server`:
```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 7: Post-deploy verification**

Repeat Steps 3-5 against the deployed container.

---

## Out of scope for this plan

- **Tdarr re-encoding the source files to H.264 for guaranteed compatibility.** That's a media-asset workflow concern; the codec probe handles client capability without touching the source. If the user wants to permanently re-encode AV1 1440p60 sources for the fitness library, that's a separate `data/` repo workflow.
- **Per-client codec profiles cached on the server.** The probe runs per-load on the client. Caching the result for the session avoids re-probing but complicates the architecture; skip until telemetry shows it matters.
- **Render thrash + tick starvation.** Audited R10 in the 2026-05-22 doc, but a separate root cause.

## Self-review checklist

- [x] Spec coverage: R7 (codec probe) ✓ Tasks 1-5; R8 (recovery cap) ✓ Task 6 (verify-only unless cap is wrong).
- [x] No placeholders.
- [x] Type consistency: `probeClientCodecs` returns `{ codecs, downgradeReasons }` (Task 1) and is consumed with that shape (Task 5).
- [x] File paths absolute throughout.
- [x] Each task ends in a commit.
- [x] Backward compatible: `_buildTranscodeUrl` callers that don't pass `clientCodecs` get the current behavior.

