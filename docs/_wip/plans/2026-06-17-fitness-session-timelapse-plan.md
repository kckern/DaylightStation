# Fitness Session Time-Lapse Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** At session-end, automatically render a silent, motion-forward time-lapse MP4 (camera hero + player picture-in-picture + title bar + bottom-third stat strip) named for the session.

**Architecture:** DDD-compliant backend feature. A pure domain service maps session data → per-frame descriptors; a pure `1_rendering` compositor draws each 1080p frame; ffmpeg (frame extraction + encoding) and frame-file I/O sit behind `3_applications` ports implemented in `1_adapters`; a `GenerateSessionTimelapse` use case orchestrates; the `Session` aggregate root owns status. Triggered (background) from the `/end` API hook and a manual re-run endpoint. Companion design: `2026-06-17-fitness-session-timelapse-design.md`.

**Tech Stack:** Node ESM (`.mjs`, subpath imports `#domains/*` `#apps/*` `#adapters/*` `#rendering/*` `#system/*`), `node-canvas` (`canvas`), system `ffmpeg`, `node:test` + `node:assert/strict` (co-located `*.test.mjs`), YAML session store.

## Conventions for the executor

- **Test runner:** co-located `node:test`. Run a single file with:
  `node --test backend/src/<path>.test.mjs` (run from repo root; subpath imports resolve via `backend/package.json` `imports`). If a file uses `#...` aliases and the run can't resolve them, run with cwd `backend/`: `cd backend && node --test src/<path>.test.mjs` — verify on the first test which works and use it consistently.
- **Errors:** domain → `import { ValidationError, DomainInvariantError, EntityNotFoundError } from '#domains/core/errors/index.mjs'`; infrastructure → `import { InfrastructureError } from '#system/utils/errors/index.mjs'`.
- **Logging:** structured events, `logger.info?.('domain.event', {...})` style. Never raw console.
- **Ubiquitous language:** `timelapse`, `recap`, `frame`, `participant`, `session`.
- **Commit after every task** (feature branch `feature/fitness-session-timelapse`; per-task commits are fine here).
- Reference: @docs/reference/core/layers-of-abstraction/ddd-reference.md

---

### Task 1: `FrameDescriptor` value object

**Files:**
- Create: `backend/src/2_domains/fitness/value-objects/FrameDescriptor.mjs`
- Test: `backend/src/2_domains/fitness/value-objects/FrameDescriptor.test.mjs`

**Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameDescriptor } from './FrameDescriptor.mjs';

test('FrameDescriptor holds frame spec and is frozen', () => {
  const fd = new FrameDescriptor({
    frameIndex: 3,
    wallClockMs: 1781312900980,
    elapsedRealMs: 30000,
    cameraTimestamp: 1781312900000,
    playerContentId: 'plex:674287',
    playerOffsetMs: 5000,
    title: 'Daytona USA 2001',
    participants: [{ id: 'user_1', displayName: 'KC', hr: 142, color: '#f00', avatarRef: null }],
    zone: 'hot',
    rpm: 86
  });
  assert.equal(fd.frameIndex, 3);
  assert.equal(fd.rpm, 86);
  assert.equal(fd.participants.length, 1);
  assert.throws(() => { fd.rpm = 0; }, TypeError); // frozen
});

test('FrameDescriptor requires a non-negative frameIndex', () => {
  assert.throws(() => new FrameDescriptor({ frameIndex: -1, wallClockMs: 1, elapsedRealMs: 0 }),
    /frameIndex/);
});

test('FrameDescriptor tolerates absent player + empty participants', () => {
  const fd = new FrameDescriptor({ frameIndex: 0, wallClockMs: 1, elapsedRealMs: 0 });
  assert.equal(fd.playerContentId, null);
  assert.deepEqual(fd.participants, []);
});
```

**Step 2: Run test to verify it fails** — `node --test backend/src/2_domains/fitness/value-objects/FrameDescriptor.test.mjs` → FAIL (module not found).

**Step 3: Write minimal implementation**

```javascript
import { ValidationError } from '#domains/core/errors/index.mjs';

export class FrameDescriptor {
  constructor({
    frameIndex,
    wallClockMs,
    elapsedRealMs,
    cameraTimestamp = null,
    playerContentId = null,
    playerOffsetMs = null,
    title = null,
    participants = [],
    zone = null,
    rpm = null
  }) {
    if (!Number.isFinite(frameIndex) || frameIndex < 0) {
      throw new ValidationError('frameIndex must be a non-negative number', { code: 'INVALID_FRAME_INDEX', field: 'frameIndex', value: frameIndex });
    }
    this.frameIndex = frameIndex;
    this.wallClockMs = wallClockMs;
    this.elapsedRealMs = elapsedRealMs;
    this.cameraTimestamp = cameraTimestamp;
    this.playerContentId = playerContentId;
    this.playerOffsetMs = playerOffsetMs;
    this.title = title;
    this.participants = Object.freeze(participants.map(p => Object.freeze({ ...p })));
    this.zone = zone;
    this.rpm = rpm;
    Object.freeze(this);
  }
}
```

**Step 4: Run test to verify it passes.**

**Step 5: Commit** — `git add -A && git commit -m "feat(fitness): FrameDescriptor value object for timelapse"`

---

### Task 2: `TimelapseFrameMapper` domain service (pure)

Maps session data → ordered `FrameDescriptor[]`. Pure; no I/O. Uses `decodeSeries` from `TimelineService`.

**Files:**
- Create: `backend/src/2_domains/fitness/services/TimelapseFrameMapper.mjs`
- Test: `backend/src/2_domains/fitness/services/TimelapseFrameMapper.test.mjs`
- Reference (read first): `backend/src/2_domains/fitness/services/TimelineService.mjs` (`decodeSeries`, series-key shapes like `bike:7138:rpm`, HR keys), and a real session YAML at `data/household/history/fitness/2026-06-12/20260612180809.yml` to confirm `timeline.events` media shape, `interval_seconds`, and HR/RPM series key naming.

**Step 1: Write the failing test** (synthetic session, 60s long, 2 captures, 1 media event; verify frame count math, nearest-camera, media offset, stat lookup, and the no-data fallbacks).

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimelapseFrameMapper } from './TimelapseFrameMapper.mjs';

function fakeSession() {
  // 60s session, interval 5s -> 12 ticks
  return {
    sessionId: 'S1',
    startTime: 1000_000,            // ms
    endTime: 1000_000 + 60_000,
    timeline: {
      interval_seconds: 5,
      tick_count: 12,
      series: {
        // RLE-encoded JSON strings (as persisted)
        'bike:7138:rpm': JSON.stringify([[80, 6], [90, 6]]), // 80 for ticks 0-5, 90 for 6-11
        'user_1:hr': JSON.stringify([[140, 12]])
      },
      events: [
        { timestamp: 1000_000, type: 'media', data: { contentId: 'plex:674287', title: 'Daytona USA' } }
      ]
    },
    snapshots: { captures: [
      { index: 0, timestamp: 1000_000, path: 'a/0.jpg', filename: '0.jpg' },
      { index: 1, timestamp: 1000_000 + 40_000, path: 'a/1.jpg', filename: '1.jpg' }
    ] },
    roster: [{ id: 'user_1', displayName: 'KC', color: '#f00' }]
  };
}

test('builds frameCount = ceil(outputDuration * fps) for a 10x/10fps spec', () => {
  const mapper = new TimelapseFrameMapper();
  // 60s / 10 = 6s output; * 10fps = 60 frames
  const frames = mapper.buildFrames(fakeSession(), { speedup: 10, outputFps: 10 });
  assert.equal(frames.length, 60);
  assert.equal(frames[0].frameIndex, 0);
});

test('maps elapsed real time, nearest camera capture, and media offset', () => {
  const mapper = new TimelapseFrameMapper();
  const frames = mapper.buildFrames(fakeSession(), { speedup: 10, outputFps: 10 });
  // frame 50 -> elapsedReal = (50/10)*10 = 50s -> wallClock = start+50s
  const f = frames[50];
  assert.equal(f.elapsedRealMs, 50_000);
  assert.equal(f.wallClockMs, 1000_000 + 50_000);
  // nearest capture to 1,050,000 is capture index 1 (at +40s) vs index 0 (at 0s)
  assert.equal(f.cameraTimestamp, 1000_000 + 40_000);
  // media started at session start -> offset = 50s
  assert.equal(f.playerContentId, 'plex:674287');
  assert.equal(f.playerOffsetMs, 50_000);
  assert.equal(f.title, 'Daytona USA');
});

test('reads RLE stats at the right tick', () => {
  const mapper = new TimelapseFrameMapper();
  const frames = mapper.buildFrames(fakeSession(), { speedup: 10, outputFps: 10 });
  // frame 50 -> 50s -> tick floor(50/5)=10 -> rpm 90, hr 140
  assert.equal(frames[50].rpm, 90);
  assert.equal(frames[50].participants[0].hr, 140);
  // frame 10 -> 10s -> tick 2 -> rpm 80
  assert.equal(frames[10].rpm, 80);
});

test('no captures -> empty frame list', () => {
  const mapper = new TimelapseFrameMapper();
  const s = fakeSession(); s.snapshots.captures = [];
  assert.deepEqual(mapper.buildFrames(s, { speedup: 10, outputFps: 10 }), []);
});

test('unresolved media -> playerContentId null but frames still built', () => {
  const mapper = new TimelapseFrameMapper();
  const s = fakeSession(); s.timeline.events = [];
  const frames = mapper.buildFrames(s, { speedup: 10, outputFps: 10 });
  assert.equal(frames[5].playerContentId, null);
  assert.equal(frames.length, 60);
});
```

**Step 2: Run → FAIL.**

**Step 3: Write minimal implementation.** Confirm the HR series key convention against the real YAML (it may be `{deviceId}:hr` or `{participantId}:hr`); the mapper should resolve per-participant HR by trying `\`${p.id}:hr\`` then any key ending `:hr`. RPM: any key ending `:rpm` (pick the first / configured device).

```javascript
import { decodeSeries } from './TimelineService.mjs';
import { FrameDescriptor } from '#domains/fitness/value-objects/FrameDescriptor.mjs';

export class TimelapseFrameMapper {
  /**
   * @param {object} session - plain session data (as from datastore.findById)
   * @param {object} spec - { speedup, outputFps }
   * @returns {FrameDescriptor[]}
   */
  buildFrames(session, { speedup, outputFps }) {
    const captures = session?.snapshots?.captures || [];
    if (!captures.length) return [];

    const startMs = toMs(session.startTime);
    const endMs = toMs(session.endTime);
    const durationSec = Math.max(0, (endMs - startMs) / 1000);
    if (!(durationSec > 0)) return [];

    const outputDurationSec = durationSec / speedup;
    const frameCount = Math.ceil(outputDurationSec * outputFps);

    const intervalSec = session?.timeline?.interval_seconds || 5;
    const decoded = decodeSeries(session?.timeline?.series || {});
    const rpmKey = Object.keys(decoded).find(k => k.endsWith(':rpm')) || null;
    const mediaEvents = (session?.timeline?.events || [])
      .filter(e => e?.type === 'media' && Number.isFinite(toMs(e.timestamp)))
      .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
    const roster = session?.roster || [];

    const sortedCaptures = [...captures].sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));

    const frames = [];
    for (let i = 0; i < frameCount; i++) {
      const elapsedRealMs = (i / outputFps) * speedup * 1000;
      const wallClockMs = startMs + elapsedRealMs;
      const tickIndex = Math.floor((elapsedRealMs / 1000) / intervalSec);

      const camera = nearestByTimestamp(sortedCaptures, wallClockMs);
      const media = activeMedia(mediaEvents, wallClockMs);

      const participants = roster.map(p => ({
        id: p.id,
        displayName: p.displayName || p.display_name || p.id,
        color: p.color || null,
        avatarRef: p.avatarRef || p.avatar || null,
        hr: valueAtTick(decoded, hrKeyFor(decoded, p.id), tickIndex)
      }));

      frames.push(new FrameDescriptor({
        frameIndex: i,
        wallClockMs,
        elapsedRealMs,
        cameraTimestamp: camera ? toMs(camera.timestamp) : null,
        playerContentId: media?.data?.contentId || null,
        playerOffsetMs: media ? Math.max(0, wallClockMs - toMs(media.timestamp)) : null,
        title: media?.data?.title || null,
        participants,
        zone: zoneAtTick(decoded, tickIndex),
        rpm: rpmKey ? valueAtTick(decoded, rpmKey, tickIndex) : null
      }));
    }
    return frames;
  }
}

function toMs(t) {
  if (Number.isFinite(t)) return t;
  const n = Date.parse(t);
  return Number.isFinite(n) ? n : NaN;
}
function nearestByTimestamp(sorted, t) {
  if (!sorted.length) return null;
  let best = sorted[0], bestD = Math.abs(toMs(sorted[0].timestamp) - t);
  for (const c of sorted) {
    const d = Math.abs(toMs(c.timestamp) - t);
    if (d < bestD) { best = c; bestD = d; }
  }
  return best;
}
function activeMedia(events, t) {
  let active = null;
  for (const e of events) { if (toMs(e.timestamp) <= t) active = e; else break; }
  return active;
}
function hrKeyFor(decoded, participantId) {
  if (decoded[`${participantId}:hr`]) return `${participantId}:hr`;
  return Object.keys(decoded).find(k => k.endsWith(':hr')) || null;
}
function valueAtTick(decoded, key, tick) {
  if (!key) return null;
  const arr = decoded[key];
  if (!Array.isArray(arr)) return null;
  const v = arr[tick];
  return v == null ? null : v;
}
function zoneAtTick(decoded, tick) {
  const key = Object.keys(decoded).find(k => k.endsWith(':zone'));
  return key ? valueAtTick(decoded, key, tick) : null;
}
```

**Step 4: Run → PASS.** If a stat assertion fails because the real series key differs, adjust `hrKeyFor`/`rpmKey`/`zoneAtTick` to the verified convention and re-run.

**Step 5: Commit** — `git commit -am "feat(fitness): TimelapseFrameMapper builds frame descriptors from session data"`

---

### Task 3: `Session` aggregate — timelapse status methods

**Files:**
- Modify: `backend/src/2_domains/fitness/entities/Session.mjs` (constructor default; new methods; `toJSON`/`fromJSON`)
- Test: `backend/src/2_domains/fitness/entities/Session.timelapse.test.mjs`

**Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from './Session.mjs';

function activeSession() {
  return new Session({ sessionId: '20260612180809', startTime: 1000 });
}

test('markTimelapseProcessing sets processing status', () => {
  const s = activeSession();
  s.markTimelapseProcessing();
  assert.equal(s.timelapse.status, 'processing');
});

test('attachTimelapse records the ready video', () => {
  const s = activeSession();
  s.attachTimelapse({ videoPath: 'media/video/fitness/x.mp4', durationSeconds: 180, fps: 10, frameCount: 1800 });
  assert.equal(s.timelapse.status, 'ready');
  assert.equal(s.timelapse.videoPath, 'media/video/fitness/x.mp4');
  assert.equal(s.timelapse.frameCount, 1800);
});

test('attachTimelapse requires videoPath', () => {
  assert.throws(() => activeSession().attachTimelapse({ durationSeconds: 1 }), /videoPath/);
});

test('markTimelapseFailed records the error message', () => {
  const s = activeSession();
  s.markTimelapseFailed(new Error('ffmpeg blew up'));
  assert.equal(s.timelapse.status, 'failed');
  assert.match(s.timelapse.error, /ffmpeg/);
});

test('timelapse survives toJSON/fromJSON round-trip', () => {
  const s = activeSession();
  s.attachTimelapse({ videoPath: 'p.mp4', durationSeconds: 5, fps: 10, frameCount: 50 });
  const round = Session.fromJSON(s.toJSON());
  assert.equal(round.timelapse.status, 'ready');
  assert.equal(round.timelapse.videoPath, 'p.mp4');
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** — read `Session.mjs` first to match the existing private-field/style. Add `timelapse = null` to the constructor destructure + assign; add the three methods; include `timelapse` in both `toJSON()` and `fromJSON()`.

```javascript
// constructor: add `timelapse = null,` to the destructured options and `this.timelapse = timelapse;`

markTimelapseProcessing() {
  this.timelapse = { status: 'processing', startedAt: Date.now() };
}

attachTimelapse({ videoPath, durationSeconds = null, fps = null, frameCount = null }) {
  if (videoPath == null) {
    throw new ValidationError('videoPath required', { code: 'MISSING_VIDEO_PATH', field: 'videoPath' });
  }
  this.timelapse = { status: 'ready', videoPath, durationSeconds, fps, frameCount, createdAt: Date.now() };
}

markTimelapseSkipped(reason = 'no-captures') {
  this.timelapse = { status: 'skipped', reason, createdAt: Date.now() };
}

markTimelapseFailed(error) {
  this.timelapse = { status: 'failed', error: error?.message || String(error), failedAt: Date.now() };
}
```

(Ensure `ValidationError` is already imported in `Session.mjs`; it is — `end()` uses it.)

**Step 4: Run → PASS.**

**Step 5: Commit** — `git commit -am "feat(fitness): Session aggregate owns timelapse status"`

---

### Task 4: Ports (application interfaces)

**Files (create):**
- `backend/src/3_applications/fitness/ports/IVideoFrameExtractor.mjs`
- `backend/src/3_applications/fitness/ports/IVideoEncoder.mjs`
- `backend/src/3_applications/fitness/ports/IRecapSnapshotStore.mjs`
- Test: `backend/src/3_applications/fitness/ports/timelapsePorts.test.mjs`

**Step 1: Write the failing test** (base methods throw "must be implemented").

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IVideoFrameExtractor } from './IVideoFrameExtractor.mjs';
import { IVideoEncoder } from './IVideoEncoder.mjs';
import { IRecapSnapshotStore } from './IRecapSnapshotStore.mjs';

test('ports throw when not implemented', async () => {
  await assert.rejects(() => new IVideoFrameExtractor().extractFrame({}), /must be implemented/);
  await assert.rejects(() => new IVideoEncoder().encodeSequence({}), /must be implemented/);
  await assert.rejects(() => new IRecapSnapshotStore().listCaptures('x'), /must be implemented/);
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** (one per file). Example:

```javascript
// IVideoFrameExtractor.mjs
/** @interface — extract a single still frame from a source video at an offset. */
export class IVideoFrameExtractor {
  /** @param {{source:string, offsetMs:number}} _ @returns {Promise<Buffer>} JPEG buffer */
  async extractFrame(_) { throw new Error('IVideoFrameExtractor.extractFrame must be implemented'); }
}
```

```javascript
// IVideoEncoder.mjs
/** @interface — stitch an ordered frame sequence into a silent MP4. */
export class IVideoEncoder {
  /** @param {{framesDir:string, pattern:string, fps:number, outputPath:string, crf?:number}} _ @returns {Promise<{outputPath:string, frameCount:number}>} */
  async encodeSequence(_) { throw new Error('IVideoEncoder.encodeSequence must be implemented'); }
}
```

```javascript
// IRecapSnapshotStore.mjs
/** @interface — read & clean up raw webcam capture frames for a session. */
export class IRecapSnapshotStore {
  async listCaptures(_sessionId, _householdId) { throw new Error('IRecapSnapshotStore.listCaptures must be implemented'); }
  async readCapture(_path, _householdId) { throw new Error('IRecapSnapshotStore.readCapture must be implemented'); }
  async cleanup(_sessionId, _householdId, _opts) { throw new Error('IRecapSnapshotStore.cleanup must be implemented'); }
}
```

**Step 4: Run → PASS. Step 5: Commit** — `git commit -am "feat(fitness): timelapse ports (frame extractor, encoder, snapshot store)"`

---

### Task 5: `TimelapseFrameRenderer` (pure `1_rendering` compositor)

Draws one 1080p composite frame from plain buffers + a `FrameDescriptor`. No I/O, no adapter imports.

**Files:**
- Create: `backend/src/1_rendering/fitness/TimelapseFrameRenderer.mjs`
- Test: `backend/src/1_rendering/fitness/TimelapseFrameRenderer.test.mjs`
- Reference (read first): `backend/src/1_rendering/fitness/FitnessReceiptRenderer.mjs` (canvas init + font registration + `canvas.toBuffer`), `backend/src/0_system/canvas/compositeHero.mjs` (loadImage/drawImage pattern).

**Step 1: Write the failing test** — generate small solid-color JPEG buffers with `canvas`, render, then load the output back and assert dimensions == resolution and buffer non-empty.

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from 'canvas';
import { createTimelapseFrameRenderer } from './TimelapseFrameRenderer.mjs';
import { FrameDescriptor } from '#domains/fitness/value-objects/FrameDescriptor.mjs';

function solidJpeg(w, h, color) {
  const c = createCanvas(w, h); const ctx = c.getContext('2d');
  ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
  return c.toBuffer('image/jpeg');
}

test('renders a 1920x1080 composite JPEG', async () => {
  const renderer = createTimelapseFrameRenderer({ resolution: [1920, 1080], pip: { enabled: true, size: [480, 270] } });
  const out = await renderer.renderFrame({
    cameraBuffer: solidJpeg(640, 480, '#0a0'),
    playerBuffer: solidJpeg(640, 360, '#00a'),
    avatarBuffers: {},
    descriptor: new FrameDescriptor({
      frameIndex: 0, wallClockMs: 1, elapsedRealMs: 0,
      title: 'Daytona USA', zone: 'hot', rpm: 86,
      participants: [{ id: 'kc', displayName: 'KC', hr: 142, color: '#f00', avatarRef: null }]
    })
  });
  assert.ok(Buffer.isBuffer(out) && out.length > 1000);
  const img = await loadImage(out);
  assert.equal(img.width, 1920);
  assert.equal(img.height, 1080);
});

test('renders without a player buffer (PiP gracefully skipped)', async () => {
  const renderer = createTimelapseFrameRenderer({ resolution: [1280, 720], pip: { enabled: true, size: [320, 180] } });
  const out = await renderer.renderFrame({
    cameraBuffer: solidJpeg(640, 480, '#0a0'),
    playerBuffer: null, avatarBuffers: {},
    descriptor: new FrameDescriptor({ frameIndex: 0, wallClockMs: 1, elapsedRealMs: 0, participants: [] })
  });
  const img = await loadImage(out);
  assert.equal(img.width, 1280);
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** — cover-fit camera; PiP top-right when buffer present; title bar; bottom-third strip. Register Roboto Condensed if `fontDir` provided (else system font fallback, like `FitnessReceiptRenderer`).

```javascript
import { createCanvas, loadImage, registerFont } from 'canvas';

const ZONE_COLORS = { warm: '#f4a000', hot: '#e0301e', cool: '#2f86d6', max: '#b3001b' };

export function createTimelapseFrameRenderer(config = {}) {
  const [W, H] = config.resolution || [1920, 1080];
  const pip = config.pip || { enabled: true, size: [480, 270] };
  const fontFamily = 'Roboto Condensed';
  if (config.fontDir) {
    try { registerFont(`${config.fontDir}/roboto-condensed/RobotoCondensed-Regular.ttf`, { family: fontFamily }); } catch { /* system fallback */ }
  }

  async function renderFrame({ cameraBuffer, playerBuffer, avatarBuffers = {}, descriptor }) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

    // Camera hero — cover-fit
    if (cameraBuffer) drawCover(ctx, await loadImage(cameraBuffer), 0, 0, W, H);

    // Player PiP — top-right with border
    if (pip.enabled && playerBuffer) {
      const [pw, ph] = pip.size; const pad = 24;
      const px = W - pw - pad, py = pad + 56; // below title bar
      ctx.fillStyle = '#000'; ctx.fillRect(px - 4, py - 4, pw + 8, ph + 8);
      drawCover(ctx, await loadImage(playerBuffer), px, py, pw, ph);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3; ctx.strokeRect(px, py, pw, ph);
    }

    // Title bar (top)
    if (config.title_bar !== false) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, 56);
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
      ctx.font = `600 32px "${fontFamily}"`;
      ctx.fillText(descriptor.title || 'Workout', 24, 28);
      const elapsed = formatElapsed(descriptor.elapsedRealMs);
      ctx.textAlign = 'right'; ctx.fillText(elapsed, W - 24, 28); ctx.textAlign = 'left';
    }

    // Bottom-third stat strip
    if (config.stat_strip !== false) {
      const stripH = Math.round(H / 6);
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, H - stripH, W, stripH);
      ctx.textBaseline = 'middle';
      let x = 24; const cy = H - stripH / 2;
      for (const p of descriptor.participants || []) {
        const avatar = avatarBuffers[p.id];
        if (avatar) { drawCircleImage(ctx, await loadImage(avatar), x, cy - 28, 56); x += 68; }
        ctx.fillStyle = p.color || '#fff'; ctx.font = `600 30px "${fontFamily}"`;
        const label = `${p.displayName} ${p.hr ?? '--'}♥`;
        ctx.fillText(label, x, cy); x += ctx.measureText(label).width + 40;
      }
      ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.font = `600 30px "${fontFamily}"`;
      const right = [descriptor.zone ? String(descriptor.zone).toUpperCase() : null, descriptor.rpm != null ? `${descriptor.rpm} rpm` : null].filter(Boolean).join('    ');
      if (right) ctx.fillText(right, W - 24, cy);
      ctx.textAlign = 'left';
    }

    return canvas.toBuffer('image/jpeg', { quality: 0.9 });
  }

  return { renderFrame };
}

function drawCover(ctx, img, dx, dy, dw, dh) {
  const scale = Math.max(dw / img.width, dh / img.height);
  const sw = dw / scale, sh = dh / scale;
  const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}
function drawCircleImage(ctx, img, x, y, d) {
  ctx.save(); ctx.beginPath(); ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); ctx.clip();
  drawCover(ctx, img, x, y, d, d); ctx.restore();
}
function formatElapsed(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
```

**Step 4: Run → PASS.**

**Step 5: Verify visually** (per feedback memory: don't ask the user to look — check yourself). Write a temp script that renders one frame to `/tmp/timelapse-frame.jpg` using real fixture JPEGs, then dispatch a vision-capable agent (or use Read on the image) to confirm layout (camera fills, PiP top-right, title bar, stat strip). Delete the temp script after.

**Step 6: Commit** — `git commit -am "feat(fitness): TimelapseFrameRenderer composites camera+PiP+stats"`

---

### Task 6: `FfmpegVideoAdapter` (implements extractor + encoder)

**Files:**
- Create: `backend/src/1_adapters/video/FfmpegVideoAdapter.mjs`
- Test: `backend/src/1_adapters/video/FfmpegVideoAdapter.test.mjs`
- Reference: `backend/src/4_api/v1/routers/local.mjs` `generateVideoThumbnail` (spawn + stderr + close/error + timeout).

**Step 1: Write the failing integration test** (uses real ffmpeg — generate a tiny source + frames with ffmpeg lavfi, then exercise the adapter; `ffprobe` the output).

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FfmpegVideoAdapter } from './FfmpegVideoAdapter.mjs';

const ffmpegOk = spawnSync('ffmpeg', ['-version']).status === 0;

test('extractFrame returns a JPEG buffer from a source video', { skip: !ffmpegOk && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-'));
  const src = path.join(dir, 'src.mp4');
  spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=10', src]);
  const adapter = new FfmpegVideoAdapter({ logger: { debug(){}, warn(){} } });
  const buf = await adapter.extractFrame({ source: src, offsetMs: 1000 });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 500);
  assert.equal(buf[0], 0xff); assert.equal(buf[1], 0xd8); // JPEG SOI
  fs.rmSync(dir, { recursive: true, force: true });
});

test('encodeSequence stitches frames into an mp4', { skip: !ffmpegOk && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-'));
  for (let i = 0; i < 5; i++) {
    spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=red:size=320x240`, '-frames:v', '1', path.join(dir, `frame_${String(i).padStart(5, '0')}.jpg`)]);
  }
  const out = path.join(dir, 'out.mp4');
  const adapter = new FfmpegVideoAdapter({ logger: { debug(){}, warn(){} } });
  const res = await adapter.encodeSequence({ framesDir: dir, pattern: 'frame_%05d.jpg', fps: 10, outputPath: out, crf: 23 });
  assert.equal(res.outputPath, out);
  assert.ok(fs.existsSync(out) && fs.statSync(out).size > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** — extend both port classes (JS allows `extends` one; implement the other method directly and document both interfaces). Use a shared private `#run(args, { capture })`.

```javascript
import { spawn } from 'node:child_process';
import path from 'node:path';
import { IVideoEncoder } from '#apps/fitness/ports/IVideoEncoder.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const DEFAULT_TIMEOUT_MS = 120_000;

export class FfmpegVideoAdapter extends IVideoEncoder { // also fulfils IVideoFrameExtractor (duck-typed)
  #logger; #timeoutMs;
  constructor({ logger = console, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    super();
    this.#logger = logger; this.#timeoutMs = timeoutMs;
  }

  async extractFrame({ source, offsetMs }) {
    if (!source) throw new InfrastructureError('extractFrame requires source', { code: 'MISSING_SOURCE' });
    const ss = (Math.max(0, offsetMs || 0) / 1000).toFixed(3);
    // -ss before -i = fast input seek; mjpeg to stdout
    const buf = await this.#run(['-ss', ss, '-i', source, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], { capture: true });
    return buf;
  }

  async encodeSequence({ framesDir, pattern, fps, outputPath, crf = 20 }) {
    if (!framesDir || !pattern || !outputPath) throw new InfrastructureError('encodeSequence missing args', { code: 'MISSING_ARGS' });
    await this.#run([
      '-y', '-framerate', String(fps), '-i', path.join(framesDir, pattern),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(crf), '-an', outputPath
    ], { capture: false });
    return { outputPath };
  }

  #run(args, { capture }) {
    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args, { stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'] });
      const out = []; let stderr = '';
      if (capture) proc.stdout.on('data', d => out.push(d));
      proc.stderr.on('data', d => { stderr += d.toString(); });
      const timer = setTimeout(() => { proc.kill(); reject(new InfrastructureError('ffmpeg timeout', { code: 'FFMPEG_TIMEOUT' })); }, this.#timeoutMs);
      proc.on('error', err => { clearTimeout(timer); reject(new InfrastructureError(`ffmpeg spawn failed: ${err.message}`, { code: 'FFMPEG_SPAWN' })); });
      proc.on('close', code => {
        clearTimeout(timer);
        if (code === 0) { this.#logger.debug?.('ffmpeg.ok', { args: args[0] }); resolve(capture ? Buffer.concat(out) : null); }
        else reject(new InfrastructureError(`ffmpeg exited ${code}: ${stderr.slice(-300)}`, { code: 'FFMPEG_EXIT', exitCode: code }));
      });
    });
  }
}
```

**Step 4: Run → PASS** (requires ffmpeg; if the harness lacks it the tests self-skip, but per the project No-Excuses policy ensure ffmpeg is present in the dev/prod env and confirm a real pass).

**Step 5: Commit** — `git commit -am "feat(fitness): FfmpegVideoAdapter (frame extract + sequence encode)"`

---

### Task 7: `YamlRecapSnapshotStore` (implements `IRecapSnapshotStore`)

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlRecapSnapshotStore.mjs`
- Test: `backend/src/1_adapters/persistence/yaml/YamlRecapSnapshotStore.test.mjs`
- Reference: `YamlSessionDatastore.getStoragePaths()` (returns `screenshotsDir`).

**Step 1: Write the failing test** with a fake datastore + temp dirs (write 3 fake jpgs, list, read, cleanup-delete and cleanup-archive).

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlRecapSnapshotStore } from './YamlRecapSnapshotStore.mjs';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
  const screenshotsDir = path.join(root, 'screenshots'); fs.mkdirSync(screenshotsDir);
  ['0000', '0001', '0002'].forEach(i => fs.writeFileSync(path.join(screenshotsDir, `2026-06-12_${i}.jpg`), Buffer.from([0xff, 0xd8, i.charCodeAt(3)])));
  const datastore = { getStoragePaths: () => ({ screenshotsDir }), findById: async () => ({ snapshots: { captures: [
    { index: 0, filename: '2026-06-12_0000.jpg', path: `${screenshotsDir}/2026-06-12_0000.jpg`, timestamp: 1 },
    { index: 1, filename: '2026-06-12_0001.jpg', path: `${screenshotsDir}/2026-06-12_0001.jpg`, timestamp: 2 }
  ] } }) };
  return { root, screenshotsDir, datastore };
}

test('listCaptures returns captures in timestamp order with absolute paths', async () => {
  const { datastore, screenshotsDir } = setup();
  const store = new YamlRecapSnapshotStore({ sessionDatastore: datastore, fileIO: fs, logger: { debug(){} } });
  const caps = await store.listCaptures('S1', 'h');
  assert.equal(caps.length, 2);
  assert.ok(caps[0].absolutePath.startsWith(screenshotsDir));
});

test('readCapture returns the file buffer', async () => {
  const { datastore } = setup();
  const store = new YamlRecapSnapshotStore({ sessionDatastore: datastore, fileIO: fs, logger: { debug(){} } });
  const caps = await store.listCaptures('S1', 'h');
  const buf = await store.readCapture(caps[0].absolutePath);
  assert.equal(buf[0], 0xff);
});

test('cleanup deletes the screenshots dir when not archiving', async () => {
  const { datastore, screenshotsDir } = setup();
  const store = new YamlRecapSnapshotStore({ sessionDatastore: datastore, fileIO: fs, logger: { debug(){} } });
  await store.cleanup('S1', 'h', { archive: false });
  assert.equal(fs.existsSync(screenshotsDir), false);
});

test('cleanup archives instead of deletes when archive:true', async () => {
  const { datastore, screenshotsDir, root } = setup();
  const store = new YamlRecapSnapshotStore({ sessionDatastore: datastore, fileIO: fs, logger: { debug(){} } });
  await store.cleanup('S1', 'h', { archive: true });
  assert.equal(fs.existsSync(screenshotsDir), false);
  assert.equal(fs.existsSync(path.join(root, 'screenshots_archive')), true);
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** (use `fs` via injected `fileIO`; default to `node:fs`). `listCaptures` reads the session's `snapshots.captures`, resolves each to an absolute path under `screenshotsDir`, sorts by timestamp. `readCapture` → `fs.readFileSync`/`promises.readFile`. `cleanup` → rename to `screenshots_archive` (archive) or `rm -rf` (delete).

**Step 4: Run → PASS. Step 5: Commit** — `git commit -am "feat(fitness): YamlRecapSnapshotStore lists/reads/cleans recap frames"`

---

### Task 8: `GenerateSessionTimelapse` use case (orchestration)

**Files:**
- Create: `backend/src/3_applications/fitness/usecases/GenerateSessionTimelapse.mjs`
- Test: `backend/src/3_applications/fitness/usecases/GenerateSessionTimelapse.test.mjs`

**Dependencies (constructor):** `{ sessionDatastore, snapshotStore, frameExtractor, videoEncoder, frameRenderer, frameMapper, contentSourceResolver, avatarProvider, mediaDir, config, fileIO, logger }`.
- `contentSourceResolver(contentId) -> Promise<string|null>` — resolves `plex:674287` → local file path (`item.Media[0].Part[0].file`); returns null on failure.
- `avatarProvider(participantIds) -> Promise<{[id]: Buffer}>` — optional; default returns `{}`.
- `mediaDir` — from `configService.getMediaDir()`.

**Step 1: Write the failing test** with fakes for every port. Assert the happy path (processing → frames written → encode → attach → cleanup) and the branches (no captures → skipped; player resolve fails → still encodes; encoder throws → markTimelapseFailed + nothing cleaned).

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import { GenerateSessionTimelapse } from './GenerateSessionTimelapse.mjs';

function fakes(overrides = {}) {
  const saved = [];
  const sessionData = overrides.sessionData || {
    sessionId: 'S1', startTime: 0, endTime: 60_000,
    timeline: { interval_seconds: 5, tick_count: 12, series: {}, events: [{ timestamp: 0, type: 'media', data: { contentId: 'plex:1', title: 'X' } }] },
    snapshots: { captures: [{ index: 0, timestamp: 0, path: 'a/0.jpg', filename: '0.jpg' }] },
    roster: []
  };
  return {
    saved,
    sessionDatastore: { findById: async () => sessionData, save: async (s) => saved.push(typeof s.toJSON === 'function' ? s.toJSON() : s) },
    snapshotStore: {
      listCaptures: async () => (sessionData.snapshots.captures).map(c => ({ ...c, absolutePath: '/abs/' + c.filename })),
      readCapture: async () => Buffer.from([0xff, 0xd8]),
      cleanup: async (...a) => { fakes._cleaned = a; }
    },
    frameMapper: { buildFrames: () => (sessionData.snapshots.captures.length ? [{ frameIndex: 0, cameraTimestamp: 0, playerContentId: 'plex:1', playerOffsetMs: 0, participants: [], elapsedRealMs: 0, wallClockMs: 0, title: 'X', zone: null, rpm: null }] : []) },
    frameExtractor: { extractFrame: async () => Buffer.from([0xff, 0xd8]) },
    frameRenderer: { renderFrame: async () => Buffer.from([0xff, 0xd8, 1, 2, 3]) },
    videoEncoder: { encodeSequence: async ({ outputPath }) => ({ outputPath }) },
    contentSourceResolver: async () => '/media/plex/x.mp4',
    avatarProvider: async () => ({}),
    mediaDir: fs.mkdtempSync(path.join(os.tmpdir(), 'media-')),
    config: { enabled: true, speedup: 10, output_fps: 10, crf: 20, resolution: [1280, 720], archive_frames: false },
    fileIO: fs,
    logger: { info(){}, warn(){}, error(){}, debug(){} },
    ...overrides
  };
}

test('happy path: marks processing, encodes, attaches ready, cleans up', async () => {
  const f = fakes();
  const uc = new GenerateSessionTimelapse(f);
  const result = await uc.execute({ sessionId: 'S1', householdId: 'h' });
  assert.equal(result.status, 'ready');
  // first save = processing, last save = ready
  assert.equal(f.saved[0].timelapse.status, 'processing');
  assert.equal(f.saved.at(-1).timelapse.status, 'ready');
});

test('no captures -> skipped, no encode', async () => {
  const f = fakes({ sessionData: { sessionId: 'S1', startTime: 0, endTime: 60_000, timeline: { interval_seconds: 5, series: {}, events: [] }, snapshots: { captures: [] }, roster: [] } });
  let encoded = false; f.videoEncoder.encodeSequence = async () => { encoded = true; return {}; };
  const uc = new GenerateSessionTimelapse(f);
  const res = await uc.execute({ sessionId: 'S1', householdId: 'h' });
  assert.equal(res.status, 'skipped');
  assert.equal(encoded, false);
});

test('player resolve failure still encodes (PiP skipped)', async () => {
  const f = fakes(); f.contentSourceResolver = async () => null;
  let renderedWithoutPlayer = false;
  f.frameRenderer.renderFrame = async ({ playerBuffer }) => { if (!playerBuffer) renderedWithoutPlayer = true; return Buffer.from([0xff, 0xd8]); };
  const uc = new GenerateSessionTimelapse(f);
  const res = await uc.execute({ sessionId: 'S1', householdId: 'h' });
  assert.equal(res.status, 'ready');
  assert.equal(renderedWithoutPlayer, true);
});

test('encoder failure -> failed status, no cleanup', async () => {
  const f = fakes(); f.videoEncoder.encodeSequence = async () => { throw new Error('boom'); };
  let cleaned = false; f.snapshotStore.cleanup = async () => { cleaned = true; };
  const uc = new GenerateSessionTimelapse(f);
  const res = await uc.execute({ sessionId: 'S1', householdId: 'h' });
  assert.equal(res.status, 'failed');
  assert.equal(cleaned, false);
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** the orchestration. Reconstitute the entity with `Session.fromJSON(data)` so the aggregate methods exist; write composite frames to a temp dir (`fs.mkdtempSync`); per descriptor: read camera buffer (skip frame if missing), resolve+extract player buffer (cache per contentId+offset bucket; null on failure), render, write `frame_%05d.jpg`; build output path `${mediaDir}/video/fitness/${slug}.mp4`; encode; `attachTimelapse`; save; cleanup raw frames + remove temp dir. Wrap the body in try/catch → `markTimelapseFailed` + save + return `{status:'failed'}` (do NOT cleanup on failure). Use a content-source cache to avoid re-resolving the same video each frame.

```javascript
import os from 'node:os'; import path from 'node:path';
import { Session } from '#domains/fitness/entities/Session.mjs';

export class GenerateSessionTimelapse {
  #d;
  constructor(deps) { this.#d = deps; }

  async execute({ sessionId, householdId }) {
    const { sessionDatastore, snapshotStore, frameMapper, frameExtractor, frameRenderer,
            videoEncoder, contentSourceResolver, avatarProvider, mediaDir, config, fileIO, logger } = this.#d;

    const data = await sessionDatastore.findById(sessionId, householdId);
    if (!data) return { status: 'not-found' };
    const session = Session.fromJSON(data);

    if (config?.enabled === false) return { status: 'disabled' };

    const descriptors = frameMapper.buildFrames(data, { speedup: config.speedup ?? 10, outputFps: config.output_fps ?? 10 });
    if (!descriptors.length) {
      session.markTimelapseSkipped('no-captures'); await sessionDatastore.save(session, householdId);
      return { status: 'skipped' };
    }

    session.markTimelapseProcessing(); await sessionDatastore.save(session, householdId);
    logger.info?.('fitness.timelapse.started', { sessionId, frames: descriptors.length });

    const tmpDir = fileIO.mkdtempSync(path.join(os.tmpdir(), `tl-${sessionId}-`));
    try {
      const captures = await snapshotStore.listCaptures(sessionId, householdId);
      const captureByTs = new Map(captures.map(c => [c.timestamp, c]));
      const avatarBuffers = avatarProvider ? await avatarProvider(uniqueParticipantIds(descriptors)) : {};
      const playerCache = new Map();

      let written = 0;
      for (const d of descriptors) {
        const cap = captureByTs.get(d.cameraTimestamp) || captures[nearestIndex(captures, d.cameraTimestamp)];
        if (!cap) continue;
        const cameraBuffer = await snapshotStore.readCapture(cap.absolutePath, householdId);
        const playerBuffer = await resolvePlayer(d, playerCache, contentSourceResolver, frameExtractor, logger);
        const frameBuffer = await frameRenderer.renderFrame({ cameraBuffer, playerBuffer, avatarBuffers, descriptor: d });
        const name = `frame_${String(written).padStart(5, '0')}.jpg`;
        fileIO.writeFileSync(path.join(tmpDir, name), frameBuffer);
        written++;
      }
      if (!written) throw new Error('no-frames-rendered');

      const fps = config.output_fps ?? 10;
      const slug = buildSlug(data);
      const outDir = path.join(mediaDir, 'video', 'fitness');
      fileIO.mkdirSync(outDir, { recursive: true });
      const outputPath = path.join(outDir, `${slug}.mp4`);
      await videoEncoder.encodeSequence({ framesDir: tmpDir, pattern: 'frame_%05d.jpg', fps, outputPath, crf: config.crf ?? 20 });

      const durationSeconds = Math.round(written / fps);
      const relPath = path.relative(mediaDir, outputPath);
      session.attachTimelapse({ videoPath: `media/${relPath}`, durationSeconds, fps, frameCount: written });
      await sessionDatastore.save(session, householdId);

      await snapshotStore.cleanup(sessionId, householdId, { archive: !!config.archive_frames });
      safeRm(fileIO, tmpDir);
      logger.info?.('fitness.timelapse.ready', { sessionId, videoPath: session.timelapse.videoPath, frames: written });
      return { status: 'ready', ...session.timelapse };
    } catch (err) {
      safeRm(fileIO, tmpDir);
      session.markTimelapseFailed(err); await sessionDatastore.save(session, householdId);
      logger.error?.('fitness.timelapse.failed', { sessionId, error: err.message });
      return { status: 'failed', error: err.message };
    }
  }
}

async function resolvePlayer(d, cache, resolver, extractor, logger) {
  if (!d.playerContentId || !resolver) return null;
  try {
    if (!cache.has(d.playerContentId)) cache.set(d.playerContentId, await resolver(d.playerContentId));
    const source = cache.get(d.playerContentId);
    if (!source) return null;
    return await extractor.extractFrame({ source, offsetMs: d.playerOffsetMs || 0 });
  } catch (err) { logger.warn?.('fitness.timelapse.player_frame_failed', { contentId: d.playerContentId, error: err.message }); return null; }
}
function uniqueParticipantIds(descriptors) { const s = new Set(); descriptors.forEach(d => (d.participants||[]).forEach(p => s.add(p.id))); return [...s]; }
function nearestIndex(arr, ts) { let bi = 0, bd = Infinity; arr.forEach((c, i) => { const dd = Math.abs(c.timestamp - ts); if (dd < bd) { bd = dd; bi = i; } }); return bi; }
function buildSlug(data) {
  const title = data?.summary?.media?.[0]?.showTitle || data?.summary?.media?.[0]?.title || data?.strava?.name || 'workout';
  const date = (data.sessionId || '').slice(0, 8);
  return `${date}_${data.sessionId}_${String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`;
}
function safeRm(fileIO, dir) { try { fileIO.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
```

**Step 4: Run → PASS.**

**Step 5: Commit** — `git commit -am "feat(fitness): GenerateSessionTimelapse use case orchestration"`

---

### Task 9: Config defaults in `FitnessConfigService`

**Files:**
- Modify: `backend/src/3_applications/fitness/FitnessConfigService.mjs` (expose a normalized `timelapse` block with defaults)
- Test: add to existing `FitnessConfigService` test (or create `FitnessConfigService.timelapse.test.mjs`)

**Step 1: Failing test** — given raw config with partial `timelapse`, `getNormalizedConfig()` returns merged defaults (`enabled:true, speedup:10, output_fps:10, capture_interval_ms:1000, crf:20, resolution:[1920,1080], pip:{enabled:true,size:[480,270]}, archive_frames:false`); given no block, returns defaults with `enabled:true`.

**Step 2: Run → FAIL. Step 3:** add a `timelapse` field to the returned normalized object, deep-merging raw over defaults. **Step 4: PASS. Step 5:** `git commit -am "feat(fitness): normalized timelapse config defaults"`

---

### Task 10: Wire dependencies in `bootstrap.mjs`

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (the `createFitnessRouter({...})` composition near line 1059)

**Steps (no new unit test — covered by Task 11 router test + manual boot):**
1. Import the new classes (`FfmpegVideoAdapter`, `YamlRecapSnapshotStore`, `TimelapseFrameMapper`, `createTimelapseFrameRenderer`, `GenerateSessionTimelapse`).
2. Build them using existing locals: `fitnessServices.sessionStore` (datastore), `configService.getMediaDir()`, `fitnessContentAdapter`, the `fontDir` used by `createReceiptCanvas`/receipt renderer, and `{ ensureDir, writeBinary }` already imported for `ScreenshotService` (add `fs` ops as needed):

```javascript
const timelapseConfig = fitnessConfigService.getNormalizedConfig(/* default hid */)?.timelapse;
const recapSnapshotStore = new YamlRecapSnapshotStore({ sessionDatastore: fitnessServices.sessionStore, fileIO: fs, logger });
const ffmpegVideoAdapter = new FfmpegVideoAdapter({ logger });
const timelapseFrameRenderer = createTimelapseFrameRenderer({ ...timelapseConfig, fontDir });
const contentSourceResolver = async (contentId) => {
  const localId = String(contentId).replace(/^[a-z]+:/i, '');
  const item = await fitnessContentAdapter?.getItem?.(localId);
  return item?.media?.[0]?.Part?.[0]?.file || item?.Media?.[0]?.Part?.[0]?.file || null;
};
const generateSessionTimelapse = new GenerateSessionTimelapse({
  sessionDatastore: fitnessServices.sessionStore,
  snapshotStore: recapSnapshotStore,
  frameMapper: new TimelapseFrameMapper(),
  frameExtractor: ffmpegVideoAdapter,
  videoEncoder: ffmpegVideoAdapter,
  frameRenderer: timelapseFrameRenderer,
  contentSourceResolver,
  avatarProvider: null, // wire avatar buffers in a later iteration
  mediaDir: configService.getMediaDir(),
  config: timelapseConfig,
  fileIO: fs,
  logger
});
```
3. Pass `generateSessionTimelapse` into `createFitnessRouter({ ... })`.
4. **Verify the actual `getItem` return shape** (Task-0 spike) — confirm whether the playable file path is at `item.media[...]` or `item.Media[...]`; adjust `contentSourceResolver` accordingly.

**Commit** — `git commit -am "chore(fitness): wire GenerateSessionTimelapse in bootstrap"`

---

### Task 11: API hook — background trigger on `/end` + manual re-run

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs` (accept `generateSessionTimelapse` in the factory config; fire on session end; add `POST /sessions/:sessionId/timelapse`)
- Test: `backend/src/4_api/v1/routers/fitness.timelapse.test.mjs` (mirror `fitness.grouping.test.mjs` — build the router with a fake use case + express + a fetch/supertest call)

**Step 1: Failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createFitnessRouter } from './fitness.mjs';

const silent = { info(){}, warn(){}, error(){}, debug(){} };

function appWith(useCase, sessionService) {
  const app = express(); app.use(express.json());
  app.use('/', createFitnessRouter({ sessionService, generateSessionTimelapse: useCase, logger: silent }));
  return app;
}

test('POST /sessions/:id/timelapse triggers the use case', async () => {
  let called = null;
  const uc = { execute: async (args) => { called = args; return { status: 'ready' }; } };
  const app = appWith(uc, { /* minimal */ });
  const server = app.listen(0); const { port } = server.address();
  const res = await fetch(`http://localhost:${port}/sessions/S1/timelapse`, { method: 'POST' });
  assert.equal(res.status, 202);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(called?.sessionId, 'S1');
  server.close();
});
```

(If the existing `/sessions/:sessionId/end` handler is easy to exercise in this harness, add a test that ending a session also fires the use case; otherwise assert the manual endpoint and confirm the `/end` wiring by code review + manual boot.)

**Step 2: Run → FAIL.**

**Step 3: Implement** — destructure `generateSessionTimelapse` from the factory config. In the existing `/sessions/:sessionId/end` handler, after the session is finalized, fire-and-forget:

```javascript
if (generateSessionTimelapse) {
  Promise.resolve(generateSessionTimelapse.execute({ sessionId, householdId }))
    .catch(err => logger.error?.('fitness.timelapse.trigger_failed', { sessionId, error: err.message }));
}
```

Add the manual endpoint (returns `202 Accepted` immediately, runs in background):

```javascript
router.post('/sessions/:sessionId/timelapse', async (req, res) => {
  const { sessionId } = req.params;
  const householdId = req.body?.household;
  if (!generateSessionTimelapse) return res.status(501).json({ ok: false, error: 'timelapse not configured' });
  Promise.resolve(generateSessionTimelapse.execute({ sessionId, householdId }))
    .catch(err => logger.error?.('fitness.timelapse.manual_failed', { sessionId, error: err.message }));
  res.status(202).json({ ok: true, status: 'processing', sessionId });
});
```

**Step 4: Run → PASS. Step 5:** `git commit -am "feat(fitness): trigger timelapse on session end + manual re-run endpoint"`

---

### Task 12: Frontend camera cadence knob

The camera must capture ~every `capture_interval_ms` (≈1s) for a watchable result, instead of the 5s timeline tick.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CameraViewApp/CameraViewApp.jsx`
- Reference: the fitness config is available via the API response (`config.timelapse.capture_interval_ms`); confirm how `CameraViewApp` accesses fitness config (via `useFitnessModule`/context or a fetch).

**Steps:**
1. Resolve `timelapseCaptureMs` from fitness config (`timelapse.enabled` && `timelapse.capture_interval_ms`).
2. When timelapse is enabled, use `Math.max(1000, timelapseCaptureMs)` for `captureIntervalMs` instead of the timeline tick interval; otherwise keep current behavior.
3. Add a structured log on mount: `logger.info('camera.timelapse_cadence', { intervalMs })` (use the logging framework).
4. **Verify** via the existing fitness Playwright flow or a manual kiosk check that uploads occur at the new cadence and don't regress kiosk perf (watch `dev.log` / the `fitness-profile` samples). Per CLAUDE.md, do not add new display fonts or raw console logs.

**Commit** — `git commit -am "feat(fitness): camera capture cadence driven by timelapse config"`

---

### Task 13: Docs

**Files:**
- Create: `docs/runbooks/fitness-session-timelapse.md` — how it triggers, config knobs, where output lands, how to manually re-run (`POST /api/v1/fitness/sessions/:id/timelapse`), how to read `timelapse.status` in the session YAML, and the ffmpeg dependency.
- Update: `docs/reference/core/...` only if a new cross-cutting pattern was introduced (a video-encoding adapter category under `1_adapters/video/` — note it in the adapter layer guidelines if that doc enumerates categories).
- Update the docs marker: `git rev-parse HEAD > docs/docs-last-updated.txt`.

**Commit** — `git commit -am "docs(fitness): session time-lapse runbook"`

---

### Task 14: End-to-end verification

1. Pick a real recorded session that has `snapshots.captures` (check `data/household/history/fitness/<date>/<id>.yml`). If none has camera captures, record a short session on the garage kiosk with `CameraViewApp` open (post-Task-12) to produce ~1s frames.
2. Trigger generation: `curl -X POST http://<backend>/api/v1/fitness/sessions/<id>/timelapse`.
3. Confirm `timelapse.status: ready` in the session YAML and the MP4 at `media/video/fitness/<name>.mp4`.
4. `ffprobe` the output: silent (`-an`), expected duration ≈ `sessionDuration/speedup`, 1920×1080.
5. **Verify visually without asking the user** (feedback memory): extract a mid frame (`ffmpeg -i out.mp4 -ss <t> -frames:v 1 /tmp/mid.jpg`) and Read it / dispatch a vision agent to confirm camera hero + PiP + title bar + stat strip render correctly.
6. Report results with evidence (ffprobe output + the inspected frame). Per superpowers:verification-before-completion — no success claim without this evidence.

**Commit** — none (verification only) unless fixes are needed.

---

## Out of scope (YAGNI for v1)

- Music/audio track on the recap (kept silent).
- Per-participant avatar rendering can ship as a stub (`avatarProvider: null`) and be wired in a follow-up.
- A session-detail "Play recap" button in the frontend (the `timelapse.videoPath` is recorded so this is a trivial later add).
- Pause/seek-accurate player offsets (continuous-playback approximation is fine for a fun keepsake).
