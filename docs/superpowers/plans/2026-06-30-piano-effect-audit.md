# Piano Effect Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained harness that drives the piano via Web MIDI, records the room mic, uploads clips, and analyzes them offline to determine which Suzuki MDG-400 reverb/chorus CCs are actually honored.

**Architecture:** A React harness page (under the existing `/piano/.../test/*` route) runs the whole permutation sweep inside the Fully Kiosk WebView — the only context with both the Web MIDI OUT port and `getUserMedia`. For each permutation it applies the effect via Control Change, plays a fixed staccato note via the existing `scheduleNotes`, records via `MediaRecorder`, and POSTs the clip to a new pair of endpoints on the existing piano router. An offline CLI decodes the clips with ffmpeg and emits an acoustic report + effective/ignored verdict. I trigger the run hands-off over the FKB REST API.

**Tech Stack:** React (frontend harness), Express (backend `piano.mjs` router), Web MIDI / MediaRecorder / getUserMedia (browser), vitest + supertest (tests), ffmpeg 6.1.1 in the `daylight-station` container (offline decode), Node CLI (analysis).

**Key verified facts (do not re-derive):**
- Outbound MIDI originates ONLY in the browser (`useWebMidiBLE.js`); there is no backend→piano path. The send helpers already exist: `sendControlChange`, `sendProgramChange`, `sendVoice`, `sendLocalControl`, `sendPanic`, `scheduleNotes` — all exposed via `usePianoMidi()`.
- Device profile `frontend/src/modules/Piano/PianoKiosk/devices/suzukiMdg400.js` `EFFECTS`: reverb `{typeCC:80, levelCC:91, types:[Room0,LgRoom2,Hall4,LgHall5,Plate8], defaultType:4}`, chorus `{typeCC:81, levelCC:93, defaultType:2}`. Accessible at runtime as `usePianoSound().device.effects`.
- Piano router already mounted at `/api/v1/piano` (routeMap `'/piano':'piano'` in `api.mjs` — NO routeMap change needed). Created via `createPianoRouter({ configService, ..., logger })`.
- App has `express.json({limit:'50mb'})` mounted app-wide; it is a no-op for `audio/webm` bodies, so a route-level `express.raw` works for clips.
- `configService.getMediaDir()` exists (returns the media base). `ensureDir` + `writeBinary` from `#system/utils/FileIO.mjs`.
- Test style: vitest + supertest, `vi.mock('#system/utils/FileIO.mjs', ...)`. Run a single file: `npx vitest run --config vitest.config.mjs <path>`. Non-DOM specs start with `// @vitest-environment node`.
- The piano tablet loads `https://daylightlocal.kckern.net/piano` = the PROD container, so frontend+backend changes MUST be built & deployed before the live run.
- BLE-MIDI link is via a CME "WIDI Master" adapter (live). A connected Bluetooth HFP device ("J2-USB Bluetooth") can hijack `getUserMedia` to the SCO mic → silence; the harness pins the built-in mic and disables EC/NS/AGC.

**File structure:**
- `backend/src/4_api/v1/routers/piano.mjs` (modify) — add `POST /effect-audit/:runId/clip/:label` (raw webm) + `POST /effect-audit/:runId/manifest` (json).
- `backend/src/4_api/v1/routers/piano.effect-audit.test.mjs` (create) — endpoint tests.
- `frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/matrix.js` (create) — pure permutation + stimulus builders.
- `frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/matrix.test.js` (create).
- `frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/micSelect.js` (create) — pure built-in-mic picker + constraints.
- `frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/micSelect.test.js` (create).
- `frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/upload.js` (create) — clip/manifest POST helpers.
- `frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/upload.test.js` (create).
- `frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/EffectAudit.jsx` (create) — orchestrator component.
- `frontend/src/modules/Piano/PianoKiosk/modes/Test/PianoTest.jsx` (modify) — route the `effect-audit` scene.
- `cli/piano-effect-audit/metrics.mjs` (create) — pure PCM envelope metrics.
- `cli/piano-effect-audit/metrics.test.mjs` (create).
- `cli/piano-effect-audit/verdict.mjs` (create) — pure metrics→verdict.
- `cli/piano-effect-audit/verdict.test.mjs` (create).
- `cli/piano-effect-audit/analyze.cli.mjs` (create) — orchestrator (ffmpeg decode + report).

---

### Task 1: Backend — effect-audit upload endpoints

**Files:**
- Modify: `backend/src/4_api/v1/routers/piano.mjs`
- Test: `backend/src/4_api/v1/routers/piano.effect-audit.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `backend/src/4_api/v1/routers/piano.effect-audit.test.mjs`:

```javascript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const written = [];
vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYaml: () => null, saveYaml: () => {}, listYamlFiles: () => [], deleteYaml: () => false,
  ensureDir: vi.fn(),
  writeBinary: vi.fn((p, buf) => { written.push({ path: p, bytes: buf.length, buf }); }),
}));
vi.mock('#system/config/UserService.mjs', () => ({ userService: { hydrateUsers: () => [] } }));
vi.mock('#domains/core/utils/id.mjs', () => ({ shortId: () => 'x' }));

import { createPianoRouter } from './piano.mjs';

const configService = {
  getDefaultHouseholdId: () => 'default',
  getHouseholdPath: (rel) => `/data/household/${rel}`,
  getUserProfile: () => null,
  getUserDir: (id) => `/data/users/${id}`,
  getHouseholdAppConfig: () => ({}),
  getMediaDir: () => '/data/media',
};

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/v1/piano', createPianoRouter({ configService, logger: { info() {}, error() {} } }));
  return a;
}

beforeEach(() => { written.length = 0; });

describe('POST /effect-audit/:runId/clip/:label', () => {
  it('writes a webm clip under media/logs/piano/effect-audit', async () => {
    const res = await request(app())
      .post('/api/v1/piano/effect-audit/run1/clip/00-control')
      .set('Content-Type', 'audio/webm')
      .send(Buffer.from([1, 2, 3, 4]));
    expect(res.status).toBe(201);
    expect(written).toHaveLength(1);
    expect(written[0].path).toBe('/data/media/logs/piano/effect-audit/run1/00-control.webm');
    expect(written[0].bytes).toBe(4);
  });
  it('rejects a path-traversal label', async () => {
    const res = await request(app())
      .post('/api/v1/piano/effect-audit/run1/clip/..%2Fx')
      .set('Content-Type', 'audio/webm').send(Buffer.from([1]));
    expect(res.status).toBe(400);
    expect(written).toHaveLength(0);
  });
  it('rejects an empty body', async () => {
    const res = await request(app())
      .post('/api/v1/piano/effect-audit/run1/clip/00-control')
      .set('Content-Type', 'audio/webm').send(Buffer.alloc(0));
    expect(res.status).toBe(400);
  });
});

describe('POST /effect-audit/:runId/manifest', () => {
  it('writes manifest.json', async () => {
    const res = await request(app())
      .post('/api/v1/piano/effect-audit/run1/manifest')
      .send({ clips: [{ label: '00-control' }] });
    expect(res.status).toBe(201);
    expect(written[0].path).toBe('/data/media/logs/piano/effect-audit/run1/manifest.json');
    expect(JSON.parse(written[0].buf.toString()).clips).toHaveLength(1);
  });
  it('rejects a manifest without a clips array', async () => {
    const res = await request(app()).post('/api/v1/piano/effect-audit/run1/manifest').send({});
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/piano.effect-audit.test.mjs`
Expected: FAIL (routes return 404 → status assertions fail).

- [ ] **Step 3: Add the routes**

In `backend/src/4_api/v1/routers/piano.mjs`, after the existing route definitions (anywhere inside `createPianoRouter`, before `return router;`), add:

```javascript
  // ── Effect audit (autonomous reverb/chorus audibility test) ────────────────
  // The harness page POSTs each recorded clip as raw audio/webm, then POSTs a
  // manifest. Both land under media/logs/piano/effect-audit/<runId>/ (survives
  // redeploys, like the per-session JSONL logs).
  const SAFE_SEG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/; // no slashes, no leading dot/dash
  const auditDir = (runId) => path.join(configService.getMediaDir(), 'logs', 'piano', 'effect-audit', runId);
  const rawAudio = express.raw({ type: ['audio/webm', 'application/octet-stream'], limit: '25mb' });

  router.post('/effect-audit/:runId/clip/:label', rawAudio, (req, res) => {
    const { runId, label } = req.params;
    if (!SAFE_SEG.test(runId) || !SAFE_SEG.test(label)) {
      return res.status(400).json({ error: 'Invalid runId/label' });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Empty audio body' });
    }
    const dir = auditDir(runId);
    ensureDir(dir);
    const file = path.join(dir, `${label}.webm`);
    writeBinary(file, req.body);
    logger.info?.('piano.effect-audit.clip', { runId, label, bytes: req.body.length });
    res.status(201).json({ ok: true, bytes: req.body.length, path: file });
  });

  router.post('/effect-audit/:runId/manifest', (req, res) => {
    const { runId } = req.params;
    if (!SAFE_SEG.test(runId)) return res.status(400).json({ error: 'Invalid runId' });
    const manifest = req.body;
    if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.clips)) {
      return res.status(400).json({ error: 'manifest.clips (array) required' });
    }
    const dir = auditDir(runId);
    ensureDir(dir);
    const file = path.join(dir, 'manifest.json');
    writeBinary(file, Buffer.from(JSON.stringify(manifest, null, 2)));
    logger.info?.('piano.effect-audit.manifest', { runId, clips: manifest.clips.length });
    res.status(201).json({ ok: true, clips: manifest.clips.length, path: file });
  });
```

Note: `express` and `path` are already imported at the top of `piano.mjs`; `ensureDir`/`writeBinary` are already imported from `#system/utils/FileIO.mjs`. Do not re-import.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/piano.effect-audit.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/piano.mjs backend/src/4_api/v1/routers/piano.effect-audit.test.mjs
git commit -m "feat(piano): effect-audit clip + manifest upload endpoints"
```

---

### Task 2: Frontend — pure permutation + stimulus builders

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/matrix.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/matrix.test.js`

- [ ] **Step 1: Write the failing test**

Create `matrix.test.js`:

```javascript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildAuditMatrix, buildStimulus, STIMULUS, recordTotalMs } from './matrix.js';

const effects = {
  reverb: { typeCC: 80, levelCC: 91, types: [{ value: 0, label: 'Room' }, { value: 4, label: 'Hall' }, { value: 8, label: 'Plate' }] },
  chorus: { typeCC: 81, levelCC: 93 },
};

describe('buildStimulus', () => {
  it('is a single staccato note (on then off)', () => {
    const ev = buildStimulus();
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ type: 'note_on', note: STIMULUS.note });
    expect(ev[1]).toMatchObject({ type: 'note_off', note: STIMULUS.note });
    expect(ev[1].t).toBeGreaterThan(ev[0].t);
  });
});

describe('recordTotalMs', () => {
  it('spans lead + note + tail', () => {
    expect(recordTotalMs()).toBe(STIMULUS.recordLeadMs + STIMULUS.offMs + STIMULUS.recordTailMs);
  });
});

describe('buildAuditMatrix', () => {
  const m = buildAuditMatrix(effects);
  it('starts with the all-off control', () => {
    expect(m[0].group).toBe('control');
    expect(m[0].cc).toEqual([{ controller: 91, value: 0 }, { controller: 93, value: 0 }]);
  });
  it('has unique, index-prefixed labels', () => {
    const labels = m.map((x) => x.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((l) => /^\d\d-/.test(l))).toBe(true);
  });
  it('reverb depth clips set typeCC=Hall(4) and sweep levelCC 0..127', () => {
    const depth = m.filter((x) => x.group === 'reverb-depth');
    expect(depth).toHaveLength(5);
    expect(depth.every((x) => x.cc.some((c) => c.controller === 80 && c.value === 4))).toBe(true);
    expect(depth.map((x) => x.cc.find((c) => c.controller === 91).value)).toEqual([0, 32, 64, 100, 127]);
  });
  it('reverb type clips cover every device type at level 100', () => {
    const types = m.filter((x) => x.group === 'reverb-type');
    expect(types).toHaveLength(3);
    expect(types.every((x) => x.cc.some((c) => c.controller === 91 && c.value === 100))).toBe(true);
  });
  it('chorus depth clips sweep levelCC 0,64,127 with reverb off', () => {
    const ch = m.filter((x) => x.group === 'chorus-depth');
    expect(ch.map((x) => x.cc.find((c) => c.controller === 93).value)).toEqual([0, 64, 127]);
    expect(ch.every((x) => x.cc.some((c) => c.controller === 91 && c.value === 0))).toBe(true);
  });
  it('instrument clips change the voice (piano -> strings -> piano)', () => {
    const inst = m.filter((x) => x.group === 'instrument');
    expect(inst).toHaveLength(3);
    expect(inst.map((x) => x.voice.pc)).toEqual([0, 48, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/matrix.test.js`
Expected: FAIL ("Failed to load ./matrix.js").

- [ ] **Step 3: Write the implementation**

Create `matrix.js`:

```javascript
// matrix.js — pure builders for the effect-audit sweep. No React, no MIDI I/O.
//
// The harness consumes buildAuditMatrix(effects) for the ordered permutation
// list and buildStimulus() for the fixed note events. `effects` is the device
// profile's `effects` object (suzukiMdg400.js): reverb/chorus {typeCC,levelCC,types}.

// Fixed stimulus: one staccato C4 (MIDI 60). The clean release isolates the
// effect tail from the struck note.
export const STIMULUS = {
  note: 60,
  velocity: 96,
  onMs: 0,
  offMs: 300,         // note_off 300ms after note_on
  recordLeadMs: 100,  // start recorder this long before note_on
  recordTailMs: 3300, // keep recording this long after note_off
};

export function buildStimulus() {
  return [
    { t: STIMULUS.onMs, type: 'note_on', note: STIMULUS.note, velocity: STIMULUS.velocity },
    { t: STIMULUS.offMs, type: 'note_off', note: STIMULUS.note, velocity: 0 },
  ];
}

export function recordTotalMs() {
  return STIMULUS.recordLeadMs + STIMULUS.offMs + STIMULUS.recordTailMs;
}

// Voices for the instrument control clips (GM program number = pc).
export const VOICE_PIANO = { name: 'Ac. Grand', pc: 0, bank: 0 };
export const VOICE_STRINGS = { name: 'Strings', pc: 48, bank: 0 };

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Ordered permutation list. Each item:
 *   { label, group, voice:{name,pc,bank}, cc:[{controller,value}] }
 * The harness sends sendVoice(voice.pc, voice.bank), then every cc as a
 * Control Change, then plays the stimulus and records.
 */
export function buildAuditMatrix(effects) {
  const rv = effects.reverb;
  const ch = effects.chorus;
  const m = [];
  let n = 0;
  const pad = () => String(n++).padStart(2, '0');
  const allOff = () => [
    { controller: rv.levelCC, value: 0 },
    { controller: ch.levelCC, value: 0 },
  ];

  // Control: everything off.
  m.push({ label: `${pad()}-control`, group: 'control', voice: VOICE_PIANO, cc: allOff() });

  // Reverb depth sweep @ Hall(4), chorus off.
  for (const level of [0, 32, 64, 100, 127]) {
    m.push({
      label: `${pad()}-reverb-hall-l${String(level).padStart(3, '0')}`,
      group: 'reverb-depth', voice: VOICE_PIANO,
      cc: [
        { controller: ch.levelCC, value: 0 },
        { controller: rv.typeCC, value: 4 },
        { controller: rv.levelCC, value: level },
      ],
    });
  }

  // Reverb type sweep @ level 100, chorus off.
  for (const type of rv.types) {
    m.push({
      label: `${pad()}-reverb-type-${slug(type.label)}`,
      group: 'reverb-type', voice: VOICE_PIANO,
      cc: [
        { controller: ch.levelCC, value: 0 },
        { controller: rv.typeCC, value: type.value },
        { controller: rv.levelCC, value: 100 },
      ],
    });
  }

  // Chorus depth sweep @ Chorus-3(2), reverb off.
  for (const level of [0, 64, 127]) {
    m.push({
      label: `${pad()}-chorus-l${String(level).padStart(3, '0')}`,
      group: 'chorus-depth', voice: VOICE_PIANO,
      cc: [
        { controller: rv.levelCC, value: 0 },
        { controller: ch.typeCC, value: 2 },
        { controller: ch.levelCC, value: level },
      ],
    });
  }

  // Instrument control (rig sanity): PC is known-good, so an audible timbre
  // change here proves the capture+analysis chain can detect a real difference.
  for (const voice of [VOICE_PIANO, VOICE_STRINGS, VOICE_PIANO]) {
    m.push({
      label: `${pad()}-instrument-${slug(voice.name)}`,
      group: 'instrument', voice, cc: allOff(),
    });
  }

  return m;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/matrix.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/matrix.js frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/matrix.test.js
git commit -m "feat(piano): pure permutation + stimulus builders for effect audit"
```

---

### Task 3: Frontend — built-in mic picker + constraints

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/micSelect.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/micSelect.test.js`

- [ ] **Step 1: Write the failing test**

Create `micSelect.test.js`:

```javascript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { pickBuiltInMic, buildMicConstraints } from './micSelect.js';

describe('pickBuiltInMic', () => {
  it('prefers a built-in input over a bluetooth one', () => {
    const id = pickBuiltInMic([
      { kind: 'audioinput', deviceId: 'bt', label: 'J2-USB Bluetooth Hands-Free' },
      { kind: 'audioinput', deviceId: 'mic', label: 'Built-in microphone' },
    ]);
    expect(id).toBe('mic');
  });
  it('skips bluetooth even when no obvious built-in label exists', () => {
    const id = pickBuiltInMic([
      { kind: 'audioinput', deviceId: 'bt', label: 'Headset (SCO)' },
      { kind: 'audioinput', deviceId: 'x', label: 'Mic A' },
    ]);
    expect(id).toBe('x');
  });
  it('returns null when there are no audio inputs', () => {
    expect(pickBuiltInMic([{ kind: 'videoinput', deviceId: 'cam', label: 'cam' }])).toBeNull();
  });
});

describe('buildMicConstraints', () => {
  it('disables EC/NS/AGC and pins the device', () => {
    const c = buildMicConstraints('mic');
    expect(c.audio.echoCancellation).toBe(false);
    expect(c.audio.noiseSuppression).toBe(false);
    expect(c.audio.autoGainControl).toBe(false);
    expect(c.audio.deviceId).toEqual({ exact: 'mic' });
  });
  it('omits deviceId when none given', () => {
    expect(buildMicConstraints(null).audio.deviceId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/micSelect.test.js`
Expected: FAIL ("Failed to load ./micSelect.js").

- [ ] **Step 3: Write the implementation**

Create `micSelect.js`:

```javascript
// micSelect.js — choose the built-in mic and safe capture constraints.
//
// A connected Bluetooth HFP device (the room's "J2-USB Bluetooth") can hijack
// getUserMedia onto the SCO mic -> silence. We pin the built-in input and turn
// off echoCancellation/noiseSuppression/autoGainControl so the room signal is
// captured faithfully.

const BT_RE = /bluetooth|headset|hands-?free|sco|a2dp|j2-usb/i;
const BUILTIN_RE = /built-?in|internal|default|microphone|\bmic\b/i;

/** Pick a built-in audio input deviceId from enumerateDevices() output. */
export function pickBuiltInMic(devices) {
  const inputs = (devices || []).filter((d) => d.kind === 'audioinput');
  if (inputs.length === 0) return null;
  const nonBt = inputs.filter((d) => !BT_RE.test(d.label || ''));
  const builtIn = nonBt.find((d) => BUILTIN_RE.test(d.label || ''));
  return (builtIn || nonBt[0] || inputs[0]).deviceId || null;
}

/** getUserMedia audio constraints pinning a device with processing disabled. */
export function buildMicConstraints(deviceId) {
  const audio = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return { audio };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/micSelect.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/micSelect.js frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/micSelect.test.js
git commit -m "feat(piano): built-in mic picker for effect audit (avoids BT SCO hijack)"
```

---

### Task 4: Frontend — clip + manifest upload helpers

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/upload.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/upload.test.js`

- [ ] **Step 1: Write the failing test**

Create `upload.test.js`:

```javascript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadClip, uploadManifest, API_BASE } from './upload.js';

beforeEach(() => { global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })); });

describe('uploadClip', () => {
  it('POSTs the blob to the clip endpoint with audio/webm', async () => {
    const blob = { size: 10 };
    await uploadClip('run1', '00-control', blob);
    expect(global.fetch).toHaveBeenCalledWith(
      `${API_BASE}/effect-audit/run1/clip/00-control`,
      expect.objectContaining({ method: 'POST', body: blob }),
    );
    expect(global.fetch.mock.calls[0][1].headers['Content-Type']).toBe('audio/webm');
  });
  it('throws on a non-ok response', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }));
    await expect(uploadClip('run1', 'x', {})).rejects.toThrow(/500/);
  });
});

describe('uploadManifest', () => {
  it('POSTs JSON to the manifest endpoint', async () => {
    await uploadManifest('run1', { clips: [] });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe(`${API_BASE}/effect-audit/run1/manifest`);
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({ clips: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/upload.test.js`
Expected: FAIL ("Failed to load ./upload.js").

- [ ] **Step 3: Write the implementation**

Create `upload.js`:

```javascript
// upload.js — POST recorded clips + the manifest to the backend.
export const API_BASE = '/api/v1/piano';

export async function uploadClip(runId, label, blob) {
  const res = await fetch(`${API_BASE}/effect-audit/${runId}/clip/${label}`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm' },
    body: blob,
  });
  if (!res.ok) throw new Error(`clip upload ${label} failed: ${res.status}`);
  return res.json();
}

export async function uploadManifest(runId, manifest) {
  const res = await fetch(`${API_BASE}/effect-audit/${runId}/manifest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manifest),
  });
  if (!res.ok) throw new Error(`manifest upload failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/upload.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/upload.js frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/upload.test.js
git commit -m "feat(piano): effect-audit upload helpers"
```

---

### Task 5: Frontend — EffectAudit orchestrator component

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/EffectAudit.jsx`

This is an integration component (drives real MIDI/mic/MediaRecorder). It is verified by the live run in Task 11, not a unit test. Keep all branching logic in the already-tested pure helpers.

- [ ] **Step 1: Write the component**

Create `EffectAudit.jsx`:

```jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../../lib/logging/Logger.js';
import { usePianoMidi } from '../../../PianoMidiContext.jsx';
import { usePianoSound } from '../../../PianoSoundContext.jsx';
import { buildAuditMatrix, buildStimulus, recordTotalMs, STIMULUS } from './matrix.js';
import { pickBuiltInMic, buildMicConstraints } from './micSelect.js';
import { uploadClip, uploadManifest } from './upload.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SETTLE_MS = 500;       // after CC/voice before recording
const CC_VOLUME = 7;         // channel volume — set high for SNR

function recordFor(stream, ms) {
  return new Promise((resolve, reject) => {
    let rec;
    try {
      rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    } catch (e) { reject(e); return; }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onerror = (e) => reject(e.error || new Error('recorder error'));
    rec.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }));
    rec.start();
    setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, ms);
  });
}

/**
 * EffectAudit — autonomous sweep: for each permutation, apply the effect via
 * MIDI CC, play a fixed staccato note, record the mic, upload the clip. Renders
 * large status text so a Fully Kiosk screenshot reveals run state.
 */
export function EffectAudit({ autoRun = false }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-effect-audit' }), []);
  const midi = usePianoMidi();
  const { device } = usePianoSound();
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState('');
  const [progress, setProgress] = useState({ i: 0, n: 0 });
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    logger.info('effect-audit.start', { runId });
    try {
      // Preflight: MIDI.
      setStatus('preflight'); setDetail('Checking MIDI output…');
      if (!midi.connected) throw new Error('MIDI not connected (WIDI Master offline?)');
      const effects = device?.effects;
      if (!effects) throw new Error('No device profile / effects (config.device unset?)');

      // Preflight: mic. First request permission, then pin the built-in input.
      setDetail('Opening microphone…');
      let permStream;
      try {
        permStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) { throw new Error(`mic permission denied: ${e.name || e.message}`); }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const micId = pickBuiltInMic(devices);
      logger.info('effect-audit.mic', { micId, labels: devices.filter((d) => d.kind === 'audioinput').map((d) => d.label) });
      permStream.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia(buildMicConstraints(micId));

      // Un-mute onboard voice + set a consistent capture volume.
      midi.sendLocalControl(true);
      midi.sendControlChange(CC_VOLUME, 110);

      const matrix = buildAuditMatrix(effects);
      setProgress({ i: 0, n: matrix.length });
      const stimulus = buildStimulus();
      const clips = [];

      for (let i = 0; i < matrix.length; i++) {
        const setup = matrix[i];
        setStatus('recording');
        setDetail(setup.label);
        setProgress({ i: i + 1, n: matrix.length });

        // Apply the setup: voice, then every CC.
        midi.sendVoice(setup.voice.pc, setup.voice.bank || 0);
        for (const cc of setup.cc) midi.sendControlChange(cc.controller, cc.value);
        await sleep(SETTLE_MS);

        // Record; fire the stimulus recordLeadMs into the recording.
        const recording = recordFor(stream, recordTotalMs());
        await sleep(STIMULUS.recordLeadMs);
        midi.scheduleNotes(stimulus);
        const blob = await recording;

        await uploadClip(runId, setup.label, blob);
        logger.info('effect-audit.clip', { label: setup.label, bytes: blob.size });
        clips.push({
          label: setup.label, group: setup.group,
          voicePc: setup.voice.pc, cc: setup.cc, bytes: blob.size,
        });
        midi.sendPanic();
      }

      // Teardown: effects off, manifest.
      midi.sendControlChange(effects.reverb.levelCC, 0);
      midi.sendControlChange(effects.chorus.levelCC, 0);
      midi.sendPanic();
      stream.getTracks().forEach((t) => t.stop());

      await uploadManifest(runId, {
        runId,
        device: device?.id || 'unknown',
        startedAt: runId,
        stimulus: { ...STIMULUS, noteOnAtMs: STIMULUS.recordLeadMs, noteOffAtMs: STIMULUS.recordLeadMs + STIMULUS.offMs },
        clips,
      });

      setStatus('done'); setDetail(`${clips.length} clips uploaded — runId ${runId}`);
      logger.info('effect-audit.done', { runId, clips: clips.length });
    } catch (e) {
      setStatus('fail'); setDetail(String(e.message || e));
      logger.error('effect-audit.fail', { error: String(e.message || e) });
    } finally {
      runningRef.current = false;
    }
  }, [midi, device, logger]);

  useEffect(() => { if (autoRun) run(); }, [autoRun, run]);

  const color = { idle: '#888', preflight: '#06c', recording: '#0a0', done: '#0a0', fail: '#c00' }[status] || '#888';
  return (
    <div style={{ fontFamily: 'monospace', padding: 32, color: '#fff', background: '#111', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 40 }}>Effect Audit</h1>
      <div style={{ fontSize: 64, fontWeight: 'bold', color }}>{status.toUpperCase()}</div>
      <div style={{ fontSize: 32, margin: '16px 0' }}>{progress.n ? `${progress.i} / ${progress.n}` : ''}</div>
      <div style={{ fontSize: 28, wordBreak: 'break-all' }}>{detail}</div>
      {!autoRun && status !== 'recording' && (
        <button type="button" onClick={run} style={{ marginTop: 24, fontSize: 28, padding: '12px 24px' }}>
          Start audit
        </button>
      )}
    </div>
  );
}

export default EffectAudit;
```

- [ ] **Step 2: Verify it compiles (lint/build check)**

Run: `npx vite build --mode development 2>&1 | tail -20` (from repo root) — or rely on the full build in Task 10.
Expected: no import/syntax errors referencing `EffectAudit.jsx`. (It is not yet routed, so it won't render — that's Task 6.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/EffectAudit.jsx
git commit -m "feat(piano): EffectAudit orchestrator component (autonomous sweep)"
```

---

### Task 6: Frontend — route the effect-audit scene in PianoTest

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Test/PianoTest.jsx`

`PianoTest` parses the splat into `params.scene` and `sp` (useSearchParams) is already in scope. We add an early return so the harness renders for `scene === 'effect-audit'`, regardless of the existing scene switch.

- [ ] **Step 1: Add the import**

At the top of `PianoTest.jsx`, with the other local imports, add:

```javascript
import { EffectAudit } from './effectAudit/EffectAudit.jsx';
```

- [ ] **Step 2: Add the early return**

Inside the `PianoTest` component body, immediately after `params` is computed (the `const params = useMemo(... )` block) and before the existing scene rendering/return, add:

```javascript
  if (params.scene === 'effect-audit') {
    return <EffectAudit autoRun={sp.get('run') === '1'} />;
  }
```

(`sp` is the `useSearchParams()` value already destructured in this component.)

- [ ] **Step 3: Verify it builds**

Run: `npx vite build --mode development 2>&1 | tail -20`
Expected: build succeeds, no errors referencing PianoTest/EffectAudit.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Test/PianoTest.jsx
git commit -m "feat(piano): route /test/effect-audit to the EffectAudit harness"
```

---

### Task 7: Analysis — pure PCM envelope metrics

**Files:**
- Create: `cli/piano-effect-audit/metrics.mjs`
- Test: `cli/piano-effect-audit/metrics.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `metrics.test.mjs`:

```javascript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { rms, tailEnergyDb, decayTimeMs } from './metrics.mjs';

const SR = 48000;

// Synthetic: silence until `afterMs`, then an exponentially-decaying tone.
function decayingTone({ sr = SR, afterMs = 100, freq = 440, tau = 0.3, durMs = 2000 }) {
  const total = Math.floor(((afterMs + durMs) / 1000) * sr);
  const start = Math.floor((afterMs / 1000) * sr);
  const s = new Float32Array(total);
  for (let i = start; i < total; i++) {
    const t = (i - start) / sr;
    s[i] = Math.exp(-t / tau) * Math.sin(2 * Math.PI * freq * t);
  }
  return s;
}

describe('rms', () => {
  it('is ~0.707 for a unit sine, 0 for silence', () => {
    const s = new Float32Array(SR);
    for (let i = 0; i < SR; i++) s[i] = Math.sin((2 * Math.PI * 440 * i) / SR);
    expect(rms(s)).toBeGreaterThan(0.69);
    expect(rms(s)).toBeLessThan(0.72);
    expect(rms(new Float32Array(SR))).toBe(0);
  });
});

describe('tailEnergyDb', () => {
  it('is much higher with a long tail than with a short one', () => {
    const longTail = tailEnergyDb(decayingTone({ tau: 0.6 }), SR, 100);
    const shortTail = tailEnergyDb(decayingTone({ tau: 0.05 }), SR, 100);
    expect(longTail).toBeGreaterThan(shortTail + 6);
  });
  it('is near the silence floor for an empty tail', () => {
    expect(tailEnergyDb(new Float32Array(SR), SR, 100)).toBeLessThan(-100);
  });
});

describe('decayTimeMs', () => {
  it('is longer for a slower decay (bigger tau)', () => {
    const slow = decayTimeMs(decayingTone({ tau: 0.6 }), SR, 100, 20);
    const fast = decayTimeMs(decayingTone({ tau: 0.1 }), SR, 100, 20);
    expect(slow).toBeGreaterThan(fast);
  });
  it('approximates tau*ln(10) for a 20 dB drop', () => {
    const tau = 0.3;
    const dt = decayTimeMs(decayingTone({ tau }), SR, 100, 20);
    const expected = tau * Math.log(10) * 1000; // ms
    expect(Math.abs(dt - expected)).toBeLessThan(80);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs cli/piano-effect-audit/metrics.test.mjs`
Expected: FAIL ("Failed to load ./metrics.mjs").

- [ ] **Step 3: Write the implementation**

Create `metrics.mjs`:

```javascript
// metrics.mjs — pure acoustic metrics over mono PCM (Float32Array @ sampleRate).
// No I/O. The CLI handles ffmpeg decoding; these are the O(N) envelope measures
// the reverb verdict relies on (robust, no FFT).

/** Root-mean-square over [start, end). */
export function rms(samples, start = 0, end = samples.length) {
  let sum = 0;
  let n = 0;
  const a = Math.max(0, start | 0);
  const b = Math.min(samples.length, end | 0);
  for (let i = a; i < b; i++) { sum += samples[i] * samples[i]; n++; }
  return n ? Math.sqrt(sum / n) : 0;
}

/** Energy of the tail after a marker time, in dBFS. */
export function tailEnergyDb(samples, sampleRate, afterMs) {
  const start = Math.floor((afterMs / 1000) * sampleRate);
  const r = rms(samples, start);
  return 20 * Math.log10(r + 1e-9);
}

/**
 * Decay time (ms): from the post-marker envelope peak, time to fall `dropDb`.
 * Coarse RT-style measure on a windowed envelope. Returns null if never reached.
 */
export function decayTimeMs(samples, sampleRate, afterMs, dropDb = 20, winMs = 20) {
  const start = Math.floor((afterMs / 1000) * sampleRate);
  const win = Math.max(1, Math.floor((winMs / 1000) * sampleRate));
  const env = (i) => rms(samples, i, i + win);
  let peak = 0;
  let peakAt = start;
  for (let i = start; i < samples.length - win; i += win) {
    const e = env(i);
    if (e > peak) { peak = e; peakAt = i; }
  }
  if (peak <= 0) return null;
  const target = peak * Math.pow(10, -dropDb / 20);
  for (let i = peakAt; i < samples.length - win; i += win) {
    if (env(i) <= target) return ((i - peakAt) / sampleRate) * 1000;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs cli/piano-effect-audit/metrics.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/piano-effect-audit/metrics.mjs cli/piano-effect-audit/metrics.test.mjs
git commit -m "feat(piano): pure PCM envelope metrics for effect-audit analysis"
```

---

### Task 8: Analysis — metrics→verdict

**Files:**
- Create: `cli/piano-effect-audit/verdict.mjs`
- Test: `cli/piano-effect-audit/verdict.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `verdict.test.mjs`:

```javascript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { verdict } from './verdict.mjs';

// Helper: build a clip metrics record.
const clip = (label, group, metrics) => ({ label, group, metrics });

function buildClips({ reverbEffective, typeEffective, chorusEffective, instOk }) {
  const off = -60;
  const on = reverbEffective ? -45 : -59; // +15 dB tail when effective, ~flat when not
  return [
    clip('00-control', 'control', { tailDb: off, decayMs: 200, centroid: 500, spread: 100 }),
    clip('01-reverb-hall-l000', 'reverb-depth', { tailDb: off, decayMs: 200, centroid: 500, spread: 100 }),
    clip('02-reverb-hall-l127', 'reverb-depth', { tailDb: on, decayMs: 900, centroid: 500, spread: 100 }),
    clip('03-reverb-type-room', 'reverb-type', { tailDb: -50, decayMs: typeEffective ? 300 : 500, centroid: 500, spread: 100 }),
    clip('04-reverb-type-plate', 'reverb-type', { tailDb: -50, decayMs: typeEffective ? 700 : 510, centroid: 500, spread: 100 }),
    clip('05-chorus-l000', 'chorus-depth', { tailDb: -50, decayMs: 300, centroid: 500, spread: 100 }),
    clip('06-chorus-l127', 'chorus-depth', { tailDb: chorusEffective ? -44 : -50, decayMs: 300, centroid: 500, spread: chorusEffective ? 160 : 100 }),
    clip('07-instrument-ac-grand', 'instrument', { tailDb: -50, decayMs: 300, centroid: 500, spread: 100 }),
    clip('08-instrument-strings', 'instrument', { tailDb: -50, decayMs: 300, centroid: instOk ? 1800 : 520, spread: 100 }),
    clip('09-instrument-ac-grand', 'instrument', { tailDb: -50, decayMs: 300, centroid: 500, spread: 100 }),
  ];
}

describe('verdict', () => {
  it('flags reverb depth effective when tail energy rises', () => {
    const v = verdict(buildClips({ reverbEffective: true, typeEffective: true, chorusEffective: true, instOk: true }));
    expect(v.reverbDepth.effective).toBe(true);
    expect(v.reverbType.effective).toBe(true);
    expect(v.chorus.effective).toBe(true);
    expect(v.instrument.detectable).toBe(true);
    expect(v.recommendations.some((r) => /KEEP reverb depth/.test(r))).toBe(true);
  });
  it('flags reverb ignored when the tail is flat', () => {
    const v = verdict(buildClips({ reverbEffective: false, typeEffective: false, chorusEffective: false, instOk: true }));
    expect(v.reverbDepth.effective).toBe(false);
    expect(v.reverbType.effective).toBe(false);
    expect(v.chorus.effective).toBe(false);
    expect(v.recommendations.some((r) => /REMOVE\/REVIEW reverb depth/.test(r))).toBe(true);
  });
  it('warns when the instrument control shows no timbre change (rig suspect)', () => {
    const v = verdict(buildClips({ reverbEffective: false, typeEffective: false, chorusEffective: false, instOk: false }));
    expect(v.instrument.detectable).toBe(false);
    expect(v.recommendations.some((r) => /WARNING: instrument control/.test(r))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs cli/piano-effect-audit/verdict.test.mjs`
Expected: FAIL ("Failed to load ./verdict.mjs").

- [ ] **Step 3: Write the implementation**

Create `verdict.mjs`:

```javascript
// verdict.mjs — turn per-clip metrics into effective/ignored verdicts.
// Input clips: [{ label, group, metrics:{ tailDb, decayMs, centroid, spread } }]

const byGroup = (clips, g) => clips.filter((c) => c.group === g);
const round = (x) => Math.round(x * 10) / 10;

export function verdict(clips) {
  const depth = byGroup(clips, 'reverb-depth');
  const types = byGroup(clips, 'reverb-type');
  const chorus = byGroup(clips, 'chorus-depth');
  const inst = byGroup(clips, 'instrument');

  const tail = (c) => c?.metrics?.tailDb ?? -120;
  const decay = (c) => c?.metrics?.decayMs ?? 0;
  const centroid = (c) => c?.metrics?.centroid ?? 0;
  const spread = (c) => c?.metrics?.spread ?? 0;

  // Reverb depth: loudest-reverb vs reverb-off tail energy.
  const rOff = depth.find((c) => /l000$/.test(c.label));
  const rMax = depth.find((c) => /l127$/.test(c.label));
  const reverbDepthDeltaDb = tail(rMax) - tail(rOff);
  const reverbDepthEffective = reverbDepthDeltaDb >= 3; // >=3 dB more tail = audible

  // Reverb type: spread of decay times (hall should ring longer than plate/room).
  const typeDecays = types.map(decay).filter((x) => x > 0);
  const reverbTypeSpreadMs = typeDecays.length ? Math.max(...typeDecays) - Math.min(...typeDecays) : 0;
  const reverbTypeEffective = reverbTypeSpreadMs >= 120; // >=120 ms spread = distinguishable

  // Chorus: tail energy or spectral-spread change off->max.
  const cOff = chorus.find((c) => /l000$/.test(c.label));
  const cMax = chorus.find((c) => /l127$/.test(c.label));
  const chorusDeltaDb = tail(cMax) - tail(cOff);
  const chorusSpreadHz = Math.abs(spread(cMax) - spread(cOff));
  const chorusEffective = chorusDeltaDb >= 3 || chorusSpreadHz >= 20;

  // Instrument control (rig sanity): centroid must change piano->strings.
  const instCentroids = inst.map(centroid);
  const instCentroidSpread = instCentroids.length ? Math.max(...instCentroids) - Math.min(...instCentroids) : 0;
  const instrumentDetectable = instCentroidSpread >= 150;

  const rec = [];
  rec.push(reverbDepthEffective
    ? 'KEEP reverb depth slider — measurable tail-energy change.'
    : 'REMOVE/REVIEW reverb depth slider — no measurable tail change (CC 91 likely ignored).');
  rec.push(reverbTypeEffective
    ? 'KEEP reverb type selector — types produce distinguishable decay.'
    : 'REMOVE/REVIEW reverb type selector — types indistinguishable (CC 80 likely ignored).');
  rec.push(chorusEffective
    ? 'KEEP chorus controls — measurable modulation/energy change.'
    : 'REMOVE/REVIEW chorus controls — no measurable change (CC 93 likely ignored).');
  if (!instrumentDetectable) {
    rec.push('WARNING: instrument control clips show no timbre change — the capture/analysis rig may be faulty; treat "ignored" verdicts with suspicion.');
  }

  return {
    reverbOnOff: { effective: reverbDepthEffective, deltaDb: round(reverbDepthDeltaDb) },
    reverbDepth: { effective: reverbDepthEffective, deltaDb: round(reverbDepthDeltaDb) },
    reverbType: { effective: reverbTypeEffective, spreadMs: round(reverbTypeSpreadMs) },
    chorus: { effective: chorusEffective, deltaDb: round(chorusDeltaDb), spreadHz: round(chorusSpreadHz) },
    instrument: { detectable: instrumentDetectable, centroidSpreadHz: round(instCentroidSpread) },
    recommendations: rec,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs cli/piano-effect-audit/verdict.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/piano-effect-audit/verdict.mjs cli/piano-effect-audit/verdict.test.mjs
git commit -m "feat(piano): effect-audit verdict (effective/ignored + recommendations)"
```

---

### Task 9: Analysis — CLI orchestrator

**Files:**
- Create: `cli/piano-effect-audit/analyze.cli.mjs`

Reads the run's `manifest.json` + clips from the media volume via `docker exec`, decodes each clip with ffmpeg to mono f32 PCM (stdout), computes envelope metrics (Task 7) + spectral centroid/spread (ffmpeg `aspectralstats`), builds the verdict (Task 8), and writes `report/verdict.md` + `report/metrics.json` into the run folder. Integration script — verified in Task 11.

- [ ] **Step 1: Write the script**

Create `analyze.cli.mjs`:

```javascript
#!/usr/bin/env node
// analyze.cli.mjs — offline analysis of an effect-audit run.
//
// Usage: node cli/piano-effect-audit/analyze.cli.mjs <runId>
//
// Reads media/logs/piano/effect-audit/<runId>/{manifest.json,*.webm} from inside
// the daylight-station container, decodes each clip with ffmpeg, computes
// reverb/chorus/timbre metrics, and writes report/verdict.md + report/metrics.json.

import { execSync } from 'child_process';
import { rms, tailEnergyDb, decayTimeMs } from './metrics.mjs';
import { verdict } from './verdict.mjs';

const CONTAINER = 'daylight-station';
const APP = '/usr/src/app';
const SR = 48000;

const runId = process.argv[2];
if (!runId) { console.error('usage: analyze.cli.mjs <runId>'); process.exit(1); }
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) { console.error('bad runId'); process.exit(1); }

const runRel = `media/logs/piano/effect-audit/${runId}`;

function exec(cmd) { return execSync(cmd, { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }); }
function execBin(cmd) { return execSync(cmd, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }); }
function inContainer(shCmd) { return exec(`sudo docker exec ${CONTAINER} sh -c ${JSON.stringify(shCmd)}`); }

// 1. Read manifest.
const manifest = JSON.parse(inContainer(`cat ${APP}/${runRel}/manifest.json`));
const noteOffMs = manifest.stimulus?.noteOffAtMs ?? 400;
const measureFromMs = noteOffMs + 30; // start tail measurement just after release

// 2. Decode a clip to Float32Array via ffmpeg (stdout f32le).
function decode(label) {
  const buf = execBin(
    `sudo docker exec ${CONTAINER} ffmpeg -v error -i ${APP}/${runRel}/${label}.webm -ac 1 -ar ${SR} -f f32le -`,
  );
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
}

// 3. Spectral centroid + spread over the sustain (note_on..note_off), via ffmpeg.
function spectral(label) {
  // aspectralstats prints per-frame metadata; average centroid + spread.
  let out = '';
  try {
    out = inContainer(
      `ffmpeg -v error -i ${APP}/${runRel}/${label}.webm -af aspectralstats=measure=centroid+spread,ametadata=print:file=- -f null - 2>&1`,
    );
  } catch (e) { out = ''; }
  const grab = (key) => {
    const vals = [...out.matchAll(new RegExp(`aspectralstats\\.[0-9]+\\.${key}=([0-9.]+)`, 'g'))].map((mm) => Number(mm[1]));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };
  return { centroid: grab('centroid'), spread: grab('spread') };
}

// 4. Per-clip metrics.
const clips = [];
for (const c of manifest.clips) {
  const samples = decode(c.label);
  const sp = spectral(c.label);
  const metrics = {
    tailDb: round(tailEnergyDb(samples, SR, measureFromMs)),
    decayMs: round(decayTimeMs(samples, SR, measureFromMs, 20) ?? 0),
    centroid: round(sp.centroid),
    spread: round(sp.spread),
    onsetDb: round(20 * Math.log10(rms(samples, Math.floor((manifest.stimulus.noteOnAtMs / 1000) * SR), Math.floor(((manifest.stimulus.noteOnAtMs + 200) / 1000) * SR)) + 1e-9)),
  };
  clips.push({ label: c.label, group: c.group, metrics });
  console.log(`${c.label.padEnd(34)} tail=${metrics.tailDb}dB decay=${metrics.decayMs}ms centroid=${metrics.centroid}Hz spread=${metrics.spread}Hz`);
}

// 5. Verdict + report.
const v = verdict(clips);
const md = renderMarkdown(runId, manifest, clips, v);
const metricsJson = JSON.stringify({ runId, clips, verdict: v }, null, 2);

// Write report files into the run folder (inside container; node user owns it).
writeInContainer(`${runRel}/report/metrics.json`, metricsJson);
writeInContainer(`${runRel}/report/verdict.md`, md);

console.log('\n' + md);
console.log(`\nReport written to ${runRel}/report/`);

function round(x) { return x == null ? 0 : Math.round(x * 10) / 10; }

function writeInContainer(rel, content) {
  const b64 = Buffer.from(content).toString('base64');
  inContainer(`mkdir -p ${APP}/${rel.split('/').slice(0, -1).join('/')} && printf '%s' '${b64}' | base64 -d > ${APP}/${rel}`);
}

function renderMarkdown(rid, man, cs, vv) {
  const row = (c) => `| ${c.label} | ${c.group} | ${c.metrics.tailDb} | ${c.metrics.decayMs} | ${c.metrics.centroid} | ${c.metrics.spread} |`;
  return [
    `# Piano Effect Audit — ${rid}`,
    '',
    `Device: ${man.device}  ·  clips: ${cs.length}  ·  note-off at ${man.stimulus.noteOffAtMs}ms`,
    '',
    '## Verdict',
    '',
    `- **Reverb on/off:** ${vv.reverbOnOff.effective ? 'EFFECTIVE' : 'IGNORED'} (Δtail ${vv.reverbOnOff.deltaDb} dB)`,
    `- **Reverb depth (CC 91):** ${vv.reverbDepth.effective ? 'EFFECTIVE' : 'IGNORED'} (Δtail ${vv.reverbDepth.deltaDb} dB)`,
    `- **Reverb type (CC 80):** ${vv.reverbType.effective ? 'EFFECTIVE' : 'IGNORED'} (decay spread ${vv.reverbType.spreadMs} ms)`,
    `- **Chorus (CC 93):** ${vv.chorus.effective ? 'EFFECTIVE' : 'IGNORED'} (Δtail ${vv.chorus.deltaDb} dB, Δspread ${vv.chorus.spreadHz} Hz)`,
    `- **Instrument control (rig check):** ${vv.instrument.detectable ? 'DETECTABLE' : 'NOT DETECTABLE'} (centroid spread ${vv.instrument.centroidSpreadHz} Hz)`,
    '',
    '## Recommendations',
    '',
    ...vv.recommendations.map((r) => `- ${r}`),
    '',
    '## Per-clip metrics',
    '',
    '| clip | group | tailDb | decayMs | centroidHz | spreadHz |',
    '|------|-------|--------|---------|-----------|----------|',
    ...cs.map(row),
    '',
  ].join('\n');
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check cli/piano-effect-audit/analyze.cli.mjs`
Expected: no output (valid). (Full functional run is Task 11, against real clips.)

- [ ] **Step 3: Commit**

```bash
git add cli/piano-effect-audit/analyze.cli.mjs
git commit -m "feat(piano): effect-audit analysis CLI (ffmpeg decode + verdict report)"
```

---

### Task 10: Build & deploy to the container

The piano tablet loads the prod container, so the frontend (Vite build) and backend changes must be deployed before the live run.

- [ ] **Step 1: Run all new unit tests together (green gate)**

Run:
```bash
npx vitest run --config vitest.config.mjs \
  backend/src/4_api/v1/routers/piano.effect-audit.test.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/matrix.test.js \
  frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/micSelect.test.js \
  frontend/src/modules/Piano/PianoKiosk/modes/Test/effectAudit/upload.test.js \
  cli/piano-effect-audit/metrics.test.mjs \
  cli/piano-effect-audit/verdict.test.mjs
```
Expected: all files pass. Confirm by reading the final `Test Files  N passed` / `Tests  M passed` summary line (not a piped exit code).

- [ ] **Step 2: Deploy gate — confirm the garage is NOT in use**

Per CLAUDE.local.md, never redeploy during an active fitness session or a playing Player video. Run as its own step and HALT if not clear:
```bash
sudo docker logs --since 75s daylight-station 2>&1 | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```
Clear means: zero recurring render lines, no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`. If either gate is active, STOP and wait/ask before deploying.

- [ ] **Step 3: Build the image**

Run:
```bash
cd /opt/Code/DaylightStation
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  .
```
Expected: build completes (includes `vite build`).

- [ ] **Step 4: Deploy**

Run:
```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```
Expected: container recreated. Verify: `sudo docker ps --filter name=daylight-station --format '{{.Status}}'` shows `Up`.

- [ ] **Step 5: Smoke-test the new endpoint is live**

Run:
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' -d '{}' \
  http://localhost:3111/api/v1/piano/effect-audit/smoke/manifest
```
Expected: `400` (manifest without clips array is rejected — proves the route exists and validates).

---

### Task 11: Live run on the tablet + analyze + write report

This is the end-to-end integration test. It makes ~2 minutes of audible piano notes.

- [ ] **Step 1: Pre-flight the tablet**

Run:
```bash
cd /opt/Code/DaylightStation
export FKB_PW=$(sudo docker exec daylight-station sh -c 'node -e "const y=require(\"js-yaml\");const f=require(\"fs\");console.log(y.load(f.readFileSync(\"data/household/auth/fullykiosk-piano.yml\",\"utf8\")).password)"')
export FKB_ADB="sudo docker exec daylight-station adb"
node cli/fkb.cli.mjs info                       # reachable, battery, startUrl
node cli/fkb.cli.mjs adb 'dumpsys bluetooth_manager | grep -iE "WIDI|Connected"'  # WIDI Master connected
```
Expected: device info prints; `WIDI Master` shows `Connected` (BLE-MIDI live).

- [ ] **Step 2: Grant mic + launch the harness (hands-off)**

Run:
```bash
node cli/fkb.cli.mjs set microphoneAccess true
node cli/fkb.cli.mjs url 'https://daylightlocal.kckern.net/piano/yellow-room/test/effect-audit?run=1'
```
Expected: `✓ loadUrl …`. The harness auto-starts (autoRun) and begins the sweep.

- [ ] **Step 3: Watch progress to completion**

Run (repeat every ~20s until status reads DONE):
```bash
node cli/fkb.cli.mjs shot /tmp/audit.png && echo "saved /tmp/audit.png"
```
Read `/tmp/audit.png`: expect status to advance `PREFLIGHT → RECORDING (i/N) → DONE`. If it shows `FAIL`, read the detail line:
- "MIDI not connected" → re-pair / re-check WIDI Master (Step 1), retry.
- "mic permission denied" → re-run Step 2's `set microphoneAccess true`, then relaunch.
Note the `runId` printed in the DONE detail line.

- [ ] **Step 4: Confirm clips landed**

Run:
```bash
sudo docker exec daylight-station sh -c 'ls -la media/logs/piano/effect-audit/*/ | tail -40'
```
Expected: a run folder with `manifest.json` + ~18 `*.webm` clips, each > a few KB. If clips are ~0 bytes or missing, the mic captured silence — re-check the BT-SCO pinning (the `effect-audit.mic` log line shows which mic was chosen):
```bash
sudo docker logs --since 5m daylight-station 2>&1 | grep effect-audit.mic
```

- [ ] **Step 5: Run the analysis**

Run (use the runId from Step 3):
```bash
node cli/piano-effect-audit/analyze.cli.mjs <runId>
```
Expected: per-clip metric lines, then the verdict markdown. The **instrument control must read DETECTABLE** — if not, the rig is suspect and reverb/chorus "IGNORED" verdicts are unreliable (investigate mic capture before trusting them).

- [ ] **Step 6: Restore the kiosk**

Run:
```bash
node cli/fkb.cli.mjs back-script
```
Expected: `✓ back-button reload script restored + reloaded` — tablet returns to the normal piano menu.

- [ ] **Step 7: Record findings + commit the report**

Copy the generated report out of the container into the repo docs and commit:
```bash
sudo docker exec daylight-station sh -c 'cat media/logs/piano/effect-audit/<runId>/report/verdict.md' \
  > docs/_wip/audits/2026-06-30-piano-effect-audit-<runId>.md
git add docs/_wip/audits/2026-06-30-piano-effect-audit-<runId>.md
git commit -m "docs(piano): effect-audit results (<runId>) — reverb/chorus effectiveness"
```
Expected: report committed. The verdict answers the original question (are the reverb/chorus sliders real?) and gives keep/remove recommendations for the Settings UI.

---

## Notes for the implementer

- **Run order:** Tasks 1–9 are independent of hardware and can be done in any order, but keep them in sequence for clean commits. Tasks 10–11 must come last (deploy before the tablet can load the harness).
- **No new dependencies:** everything uses libraries already present (express, vitest, supertest, ffmpeg-in-container, Web MIDI/MediaRecorder in the browser).
- **The reverb verdict is robust** (PCM tail energy / decay, no FFT). Chorus + instrument checks lean on ffmpeg `aspectralstats`; if that filter prints nothing on this ffmpeg build, those secondary metrics degrade to 0 and only their sub-verdicts weaken — the core reverb answer still stands. If `aspectralstats` is unavailable, that's a known acceptable limitation; note it in the report rather than faking values.
- **Logging:** the harness uses the structured logger (`getLogger().child({ component: 'piano-effect-audit' })`) at start/clip/mic/done/fail — per the project logging rule.
- **Idempotent re-runs:** each run mints a fresh `runId`, so re-runs never clobber prior clips.
```
