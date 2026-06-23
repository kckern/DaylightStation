# Piano Multi-Engine Voice Bridge — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:test-driven-development for every JS/backend task.

**Goal:** Add a switchable, YAML-configured, native-rendered instrument layer (best-in-class SFZ grand piano, Dexed/FM DX7 electric, and any future instrument) to the Piano kiosk, rendered by a sideloaded Android APK and controlled from the browser — with a global toggle back to the piano's native onboard sound.

**Architecture:** The browser keeps owning Web-MIDI exactly as today (visualizer, games, lessons, studio all unchanged). A new Android APK (`net.kckern.pianobridge`) is an independent, switchable **multi-engine voice host**: it reads the piano's BLE-MIDI directly via `MidiManager`, renders audio with a per-voice engine (sfizz for SFZ samples, Dexed for FM), and outputs via Oboe/AAudio. A localhost WebSocket carries control (start/stop, load preset, set params) from the browser to the APK; the toggle also flips the piano's **Local Control (CC 122)** so onboard and rendered sound never double. All instrument definitions live in YAML in the existing piano config; the APK is config-dumb (receives a fully-resolved voice spec over WS). Heavy assets are `adb push`ed to the device once; the APK references them locally.

**Tech Stack:** React + Vitest + Playwright (frontend), Express (backend, existing piano router/config), Android NDK/Kotlin + JNI + **sfizz** + **Dexed (MSFA)** + **Oboe** + a WS server (APK), `yaml` (already a dep).

**Key naming decision:** `voices` (existing) = onboard Program-Change timbres — **leave untouched**. New rendered instruments use a separate key `instruments`. The chrome gains a **source selector**: `Onboard` (default, today's behavior) vs an instrument id.

---

## Phase 0 — Worktree & scaffolding

### Task 0: Create the worktree

**Step 1:** Use superpowers:using-git-worktrees to create an isolated worktree off `main` named `feat/piano-voice-bridge`.

**Step 2:** Confirm the dev server port for this machine (`lsof -i :3111`) before running any Vitest/Playwright that needs the backend. Do NOT start a second dev server if one is running (CLAUDE.md rule).

---

## Phase 1 — Config layer (instrument definitions)

The browser is the single config authority. Instruments are defined in the household piano config (`data/household/apps/piano/config.yml`), served via the existing `api/v1/admin/apps/piano/config`, and resolved in `PianoConfig.jsx` alongside `voices`/`videos`/`music`.

### Task 1: Add `instruments` to config defaults + resolver

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoConfig.jsx` (add to `PIANO_CONFIG_DEFAULTS` ~line 11-25, and to `resolvePianoConfig` ~line 56-69)
- Test: `frontend/src/modules/Piano/PianoKiosk/PianoConfig.test.js` (exists)

**Step 1: Write the failing test**

Add to `PianoConfig.test.js`:

```javascript
import { resolvePianoConfig, PIANO_CONFIG_DEFAULTS } from './PianoConfig.jsx';

describe('instruments config', () => {
  it('defaults instruments to an empty list when unset', () => {
    const cfg = resolvePianoConfig({}, 'default');
    expect(cfg.instruments).toEqual([]);
  });

  it('passes through per-piano instruments over shared', () => {
    const raw = {
      instruments: [{ id: 'shared_grand', name: 'Shared', engine: 'sfizz', asset: 'a.sfz' }],
      pianos: {
        upstairs: {
          instruments: [{ id: 'dx7', name: 'DX7', engine: 'dexed', asset: 'b.syx', patch: 3 }],
        },
      },
    };
    expect(resolvePianoConfig(raw, 'upstairs').instruments[0].id).toBe('dx7');
    expect(resolvePianoConfig(raw, 'default').instruments).toEqual([]); // 'default' inherits shared top-level
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/PianoConfig.test.js`
Expected: FAIL — `cfg.instruments` is `undefined`.

**Step 3: Minimal implementation**

In `PIANO_CONFIG_DEFAULTS` add:

```javascript
  instruments: [], // rendered-voice definitions (sfizz/dexed/…); [] = onboard-only
```

In `resolvePianoConfig` return object add:

```javascript
    instruments: p.instruments || shared.instruments || PIANO_CONFIG_DEFAULTS.instruments,
```

**Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/PianoConfig.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/PianoConfig.jsx frontend/src/modules/Piano/PianoKiosk/PianoConfig.test.js
git commit -m "feat(piano): add instruments config key + resolver"
```

### Task 2: Instrument-spec validator (shared contract)

A pure validator both the UI and (mirrored later) the APK honor. Rejects malformed specs early; defines the WS `preset.load` payload shape.

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/instrumentSpec.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/instrumentSpec.test.js`

**Step 1: Write the failing test**

```javascript
import { validateInstrument, resolveInstrumentSpec, ENGINES } from './instrumentSpec.js';

describe('validateInstrument', () => {
  it('accepts a valid sfizz instrument', () => {
    const r = validateInstrument({ id: 'g', name: 'Grand', engine: 'sfizz', asset: 'x.sfz' });
    expect(r.ok).toBe(true);
  });
  it('rejects unknown engine', () => {
    const r = validateInstrument({ id: 'g', name: 'G', engine: 'reaktor', asset: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/engine/);
  });
  it('rejects missing id/asset', () => {
    expect(validateInstrument({ name: 'x', engine: 'sfizz', asset: 'a' }).ok).toBe(false);
    expect(validateInstrument({ id: 'x', name: 'x', engine: 'sfizz' }).ok).toBe(false);
  });
  it('rejects path traversal in asset', () => {
    expect(validateInstrument({ id: 'g', name: 'G', engine: 'sfizz', asset: '../etc/x' }).ok).toBe(false);
  });
});

describe('resolveInstrumentSpec', () => {
  it('produces the WS preset.load payload with defaults applied', () => {
    const spec = resolveInstrumentSpec({ id: 'g', name: 'Grand', engine: 'sfizz', asset: 'x.sfz' });
    expect(spec).toMatchObject({ id: 'g', engine: 'sfizz', asset: 'x.sfz', gain_db: 0, transpose: 0 });
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/instrumentSpec.test.js`
Expected: FAIL — module not found.

**Step 3: Minimal implementation**

```javascript
// instrumentSpec.js — shared instrument-spec contract (UI + APK mirror this).
export const ENGINES = ['sfizz', 'dexed'];

const SAFE = (s) => typeof s === 'string' && s.length > 0
  && !s.includes('..') && !s.startsWith('/') && !s.includes('\\');

/** Validate a raw instrument definition from config. Returns {ok, error?}. */
export function validateInstrument(inst) {
  if (!inst || typeof inst !== 'object') return { ok: false, error: 'not an object' };
  if (!SAFE(inst.id)) return { ok: false, error: 'invalid id' };
  if (typeof inst.name !== 'string' || !inst.name) return { ok: false, error: 'missing name' };
  if (!ENGINES.includes(inst.engine)) return { ok: false, error: `unknown engine: ${inst.engine}` };
  if (!SAFE(inst.asset)) return { ok: false, error: 'invalid asset path' };
  return { ok: true };
}

/** Resolve a config instrument into the WS preset.load payload (defaults applied). */
export function resolveInstrumentSpec(inst) {
  return {
    id: inst.id,
    name: inst.name,
    engine: inst.engine,
    asset: inst.asset,
    patch: inst.patch ?? 0,            // dexed bank index; ignored by sfizz
    gain_db: inst.gain_db ?? 0,
    transpose: inst.transpose ?? 0,
    tune: inst.tune ?? 0,
    velocity_curve: inst.velocity_curve ?? 'natural',
    reverb: inst.reverb ?? null,
    eq: inst.eq ?? null,
    chorus: inst.chorus ?? null,
  };
}
```

**Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/instrumentSpec.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/instrumentSpec.js frontend/src/modules/Piano/PianoKiosk/instrumentSpec.test.js
git commit -m "feat(piano): instrument-spec validator + WS payload resolver"
```

---

## Phase 2 — Browser bridge (WS client + Local Control)

### Task 3: `sendLocalControl` on the MIDI surface

The toggle must mute/unmute the piano's onboard voice. CC 122 (Local Control) value 0 = off, 127 = on.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.js` (add near `sendProgramChange` ~line 172-178, export in the `useMemo` return ~line 255-270)
- Test: `frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.localControl.test.js`

**Step 1: Write the failing test**

```javascript
import { renderHook } from '@testing-library/react';
import { useWebMidiBLE } from './useWebMidiBLE.js';

// Minimal Web-MIDI mock: one output capturing send() calls.
function mockMidi() {
  const sent = [];
  const output = { send: (msg) => sent.push(msg) };
  global.navigator.requestMIDIAccess = async () => ({
    inputs: new Map([['i', { id: 'i', name: 'Piano', onmidimessage: null }]]),
    outputs: new Map([['o', output]]),
    onstatechange: null,
  });
  return sent;
}

it('sends CC122 0 to disable local control, 127 to enable', async () => {
  const sent = mockMidi();
  const { result } = renderHook(() => useWebMidiBLE({}));
  await result.current.connect();
  result.current.sendLocalControl(false);
  result.current.sendLocalControl(true);
  expect(sent).toContainEqual([0xb0, 122, 0]);
  expect(sent).toContainEqual([0xb0, 122, 127]);
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.localControl.test.js`
Expected: FAIL — `sendLocalControl is not a function`.

**Step 3: Minimal implementation**

Add after `sendProgramChange`:

```javascript
  // Local Control (CC 122): false silences the piano's onboard voice so a
  // rendered instrument (APK) is the only sound; true restores onboard sound.
  const sendLocalControl = useCallback((on, channel = 0) => {
    const out = outputRef.current;
    if (!out) return false;
    out.send([0xb0 | (channel & 0x0f), 122, on ? 127 : 0]);
    logger().info('midi.out.local-control', { on, channel });
    return true;
  }, []);
```

Add `sendLocalControl` to the returned object and to the `useMemo` dependency array.

**Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.localControl.test.js`
Expected: PASS. Also run the existing `usePianoScreensaver.test.js` siblings to confirm no regression: `npx vitest run frontend/src/modules/Piano/PianoKiosk/`.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.js frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.localControl.test.js
git commit -m "feat(piano): sendLocalControl (CC122) on MIDI surface"
```

### Task 4: `usePianoVoiceBridge` hook (WS to the APK)

Owns the localhost WebSocket to the APK. Kept separate from `useWebMidiBLE` so that hook stays clean. Connects lazily, reconnects with backoff, exposes `status` and the control verbs. WS URL configurable; default `ws://localhost:8770`.

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/usePianoVoiceBridge.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/usePianoVoiceBridge.test.js`

**Step 1: Write the failing test** (drive a fake WebSocket)

```javascript
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePianoVoiceBridge } from './usePianoVoiceBridge.js';

class FakeWS {
  constructor(url) { this.url = url; this.sent = []; FakeWS.last = this; }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.onclose?.({}); }
  _open() { this.readyState = 1; this.onopen?.(); }
  _msg(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}
FakeWS.OPEN = 1;

beforeEach(() => { global.WebSocket = FakeWS; });

it('loads a preset and reflects status from the APK', async () => {
  const { result } = renderHook(() => usePianoVoiceBridge({ url: 'ws://localhost:8770' }));
  act(() => FakeWS.last._open());
  act(() => result.current.loadPreset({ id: 'g', engine: 'sfizz', asset: 'x.sfz' }));
  expect(FakeWS.last.sent).toContainEqual({ type: 'engine.start' });
  expect(FakeWS.last.sent.find(m => m.type === 'preset.load').spec.id).toBe('g');
  act(() => FakeWS.last._msg({ type: 'status', engine: 'running', preset: 'g' }));
  await waitFor(() => expect(result.current.status.preset).toBe('g'));
});

it('stop sends engine.stop', () => {
  const { result } = renderHook(() => usePianoVoiceBridge({ url: 'ws://localhost:8770' }));
  act(() => FakeWS.last._open());
  act(() => result.current.stop());
  expect(FakeWS.last.sent).toContainEqual({ type: 'engine.stop' });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/usePianoVoiceBridge.test.js`
Expected: FAIL — module not found.

**Step 3: Minimal implementation**

```javascript
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'piano-voice-bridge' }));

const DEFAULT_URL = 'ws://localhost:8770';

/**
 * usePianoVoiceBridge — control channel to the native rendered-voice APK.
 * Browser stays the config authority: loadPreset() ships a fully-resolved spec.
 */
export function usePianoVoiceBridge({ url = DEFAULT_URL, enabled = true } = {}) {
  const [status, setStatus] = useState({ link: 'idle', engine: 'stopped', preset: null });
  const wsRef = useRef(null);
  const retryRef = useRef(0);

  const send = useCallback((msg) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) { logger().warn('bridge.send-no-link', { type: msg.type }); return false; }
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let closed = false;
    const open = () => {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => { retryRef.current = 0; setStatus((s) => ({ ...s, link: 'connected' })); logger().info('bridge.open', { url }); };
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.type === 'status') setStatus((s) => ({ ...s, engine: m.engine ?? s.engine, preset: m.preset ?? s.preset }));
          else if (m.type === 'error') logger().error('bridge.remote-error', { code: m.code, msg: m.msg });
        } catch { /* ignore malformed */ }
      };
      ws.onclose = () => {
        setStatus((s) => ({ ...s, link: 'closed' }));
        if (closed) return;
        const delay = Math.min(5000, 250 * 2 ** retryRef.current++);
        setTimeout(open, delay);
      };
    };
    open();
    return () => { closed = true; wsRef.current?.close?.(); };
  }, [url, enabled]);

  const loadPreset = useCallback((spec) => {
    send({ type: 'engine.start' });
    return send({ type: 'preset.load', spec });
  }, [send]);
  const setParam = useCallback((pathStr, value) => send({ type: 'param.set', path: pathStr, value }), [send]);
  const panic = useCallback(() => send({ type: 'panic' }), [send]);
  const stop = useCallback(() => send({ type: 'engine.stop' }), [send]);

  return useMemo(() => ({ status, loadPreset, setParam, panic, stop }), [status, loadPreset, setParam, panic, stop]);
}

export default usePianoVoiceBridge;
```

**Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/usePianoVoiceBridge.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/usePianoVoiceBridge.js frontend/src/modules/Piano/PianoKiosk/usePianoVoiceBridge.test.js
git commit -m "feat(piano): usePianoVoiceBridge WS control hook"
```

---

## Phase 3 — Chrome source selector (the toggle)

### Task 5: Source selector in PianoChrome

Replace the bare `voices` `<select>` with a **source selector**: `Onboard` (today — shows the Program-Change voice picker) + each configured instrument. Selecting an instrument: `loadPreset(resolveInstrumentSpec(inst))` + `sendLocalControl(false)`. Selecting Onboard: `stop()` + `sendLocalControl(true)`.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoChrome.jsx`
- Modify: wherever PianoChrome is rendered, pass `instruments` from `usePianoKioskConfig()` (grep for `<PianoChrome`)
- Test: extend `frontend/src/modules/Piano/PianoKiosk/` chrome tests (create `PianoChrome.test.jsx` if absent)

**Step 1: Write the failing test**

```javascript
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PianoChrome } from './PianoChrome.jsx';

const bridge = { loadPreset: vi.fn(), stop: vi.fn(), status: { engine: 'stopped' } };
const midi = { connected: true, status: 'connected', inputName: 'Piano',
  sendProgramChange: vi.fn(), sendLocalControl: vi.fn(), connect: vi.fn() };
vi.mock('./PianoMidiContext.jsx', () => ({ usePianoMidi: () => midi }));
vi.mock('./usePianoVoiceBridge.js', () => ({ usePianoVoiceBridge: () => bridge }));

const instruments = [{ id: 'grand', name: 'Concert Grand', engine: 'sfizz', asset: 'g.sfz' }];

it('selecting an instrument loads it and disables local control', () => {
  render(<MemoryRouter><PianoChrome pianoId="default" instruments={instruments} /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Sound source'), { target: { value: 'grand' } });
  expect(bridge.loadPreset).toHaveBeenCalledWith(expect.objectContaining({ id: 'grand', engine: 'sfizz' }));
  expect(midi.sendLocalControl).toHaveBeenCalledWith(false);
});

it('selecting Onboard stops the engine and restores local control', () => {
  render(<MemoryRouter><PianoChrome pianoId="default" instruments={instruments} /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Sound source'), { target: { value: 'grand' } });
  fireEvent.change(screen.getByLabelText('Sound source'), { target: { value: '__onboard__' } });
  expect(bridge.stop).toHaveBeenCalled();
  expect(midi.sendLocalControl).toHaveBeenCalledWith(true);
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/PianoChrome.test.jsx`
Expected: FAIL — no `Sound source` control.

**Step 3: Minimal implementation**

In `PianoChrome.jsx`: accept `instruments = []`; call `usePianoVoiceBridge()` and `sendLocalControl` from `usePianoMidi()`; add state `source` (default `__onboard__`). Render a `<select aria-label="Sound source">` with an `Onboard` option + one per instrument. On change:

```javascript
import { useState, useMemo } from 'react';
import { resolveInstrumentSpec } from './instrumentSpec.js';
import { usePianoVoiceBridge } from './usePianoVoiceBridge.js';
// ...
const ONBOARD = '__onboard__';
const { sendProgramChange, sendLocalControl, /*…*/ } = usePianoMidi();
const bridge = usePianoVoiceBridge({ enabled: instruments.length > 0 });
const [source, setSource] = useState(ONBOARD);

const onSource = (value) => {
  setSource(value);
  if (value === ONBOARD) {
    bridge.stop();
    sendLocalControl(true);
    logger.info('piano.source.onboard', { pianoId });
    return;
  }
  const inst = instruments.find((i) => i.id === value);
  if (!inst) return;
  bridge.loadPreset(resolveInstrumentSpec(inst));
  sendLocalControl(false);
  logger.info('piano.source.instrument', { pianoId, id: inst.id, engine: inst.engine });
};
```

Keep the existing Program-Change `voices` picker, but only render it when `source === ONBOARD`. Hide it otherwise (onboard is muted).

**Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/PianoChrome.test.jsx`
Expected: PASS.

**Step 5: Wire `instruments` from config at the call site**

Grep: `grep -rn "<PianoChrome" frontend/src`. Pass `instruments={config.instruments}` from `usePianoKioskConfig()`.

**Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/PianoChrome.jsx frontend/src/modules/Piano/PianoKiosk/PianoChrome.test.jsx <call-site-file>
git commit -m "feat(piano): chrome sound-source selector (onboard vs rendered instrument)"
```

### Task 6: Playwright smoke (toggle dispatches local control)

**Files:**
- Create: `tests/live/flow/piano/piano-voice-source.runtime.test.mjs`

**Step 1:** Write a flow test that loads the piano kiosk with a stub `instruments` config, mocks `window.WebSocket` (so no real APK needed), selects an instrument, and asserts (a) the select shows the instrument, (b) a `preset.load` frame was captured by the WS stub. Read `tests/_fixtures/runtime/urls.mjs` for the URL — do NOT hardcode. Follow the discipline rules in CLAUDE.md (no vacuous passes).

**Step 2:** Run: `npx playwright test tests/live/flow/piano/piano-voice-source.runtime.test.mjs --reporter=line`. Expected: PASS (after ensuring the dev server is up on the configured port).

**Step 3: Commit.**

---

## Phase 4 — The APK (`_extensions/piano-bridge/`)

> **Honesty note for the implementer:** Tasks 7–11 are native Android/NDK work; each is an epic, not a 2–5 min step. There is no JS-style TDD harness here — verification is build success + on-device instrumented checks + the latency/fan-out measurements in Phase 5. Mirror the existing `_extensions/audio-bridge/` project layout, Gradle setup, and `JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew assembleDebug` build convention (see memory `Shield TV Audio Bridge`). Break each task down further as you go.

### Task 7: Scaffold the Gradle/NDK project

- Create `_extensions/piano-bridge/` mirroring `_extensions/audio-bridge/app/` (Gradle wrapper, `build.gradle` with NDK + `externalNativeBuild` CMake, `local.properties`).
- Package: `net.kckern.pianobridge`. Min SDK 30 (matches the tablet/Shield baseline).
- Vendor native deps as git submodules or prebuilt `.aar`/static libs: **sfizz** (`externalNativeBuild`), **Dexed/MSFA** FM core (the `music-synthesizer-for-android` `fm_core`), **Oboe** (`com.google.oboe:oboe`).
- **Verify:** `JAVA_HOME=… ./gradlew assembleDebug` produces an APK with the native libs linked (`unzip -l app-debug.apk | grep '\.so'` shows `libsfizz`, `liboboe`, the FM core).

### Task 8: Engine abstraction + two backends (native, C++/JNI)

- Define a C++ `Engine` interface: `bool load(const VoiceSpec&)`, `void noteOn(int, int)`, `void noteOff(int)`, `void controlChange(int,int)`, `void render(float* out, int frames)`, `void allNotesOff()`.
- `SfizzEngine` wraps `sfizz::Sfizz` — `loadSfzFile(asset)`, feed MIDI, `renderBlock`. Apply `velocity_curve`, `gain_db`, `transpose`, `tune` from the spec.
- `DexedEngine` wraps the MSFA FM core — load `.syx` bank, select `patch` index, render. (Dexed FM gives the continuous dynamic touch you want for the DX7.)
- A `VoiceHost` owns the active engine, switches on `preset.load` (load on demand; release prior engine), and is the audio source for Oboe.
- **Verify:** a JNI unit harness (an instrumented `androidTest`) that loads a tiny test SFZ + a test `.syx`, pumps a NoteOn, and asserts `render()` produces non-silent buffers (peak > 0). This is the closest thing to a unit test for the native layer — write it.

### Task 9: Oboe audio output

- Open a low-latency Oboe stream (`PerformanceMode::LowLatency`, `SharedingMode::Exclusive` where available), 48 kHz, float. In the audio callback, pull from `VoiceHost::render`.
- Handle xruns/restarts (Oboe error callback → reopen). Log via Android `Log` with a tag that the bridge can surface in `status`.
- **Verify:** on device, selecting an instrument and playing a key produces sound out the configured output (built-in or USB DAC). Confirm `PerformanceMode` actually granted (log `getPerformanceMode()` post-open).

### Task 10: MidiManager BLE-MIDI input (direct read)

- Use `android.media.midi.MidiManager`. Enumerate devices; open the BLE piano via `openBluetoothDevice(BluetoothDevice)` (the piano is already OS-paired). Attach a `MidiReceiver` that parses note/CC and drives `VoiceHost`.
- Make the input device selectable/configurable by name (mirror `preferredInputName` in piano config) for multi-piano households.
- **Verify (fan-out — the open architectural risk from the design):** with the kiosk browser running (Chromium holding Web-MIDI on the same device), confirm the APK *also* receives MIDI. If the BLE stack refuses two readers, fall back to **relay mode**: APK accepts `note.on/off` WS frames from the browser (already in the protocol) and the browser forwards from `useWebMidiBLE`. Document which mode this tablet needs.

### Task 11: WS control server + protocol

- Embed a tiny WS server (NanoWSD or Ktor) on `ws://0.0.0.0:8770` (localhost-reachable from the kiosk WebView).
- Implement the contract from `usePianoVoiceBridge` / `instrumentSpec.js`:
  - **in:** `engine.start`, `engine.stop`, `preset.load {spec}`, `param.set {path,value}`, `panic`, (`note.on/off` only in relay mode)
  - **out:** `ready`, `status {engine, preset, cpu, xruns}`, `error {code,msg}`
- Resolve `spec.asset` under the on-device instruments dir (`getExternalFilesDir()/instruments/`), with the same `..`/absolute-path rejection as `instrumentSpec.SAFE`.
- Emit a periodic `status` heartbeat (engine state, CPU, xrun count) so the chrome can show health.
- **Verify:** from a laptop, `websocat ws://<tablet-ip>:8770`, send `{"type":"preset.load","spec":{...}}`, hear sound; send `{"type":"engine.stop"}`, silence.

---

## Phase 5 — On-device integration & assets

### Task 12: Assets on the device

- Master copies live in the backend media tree: `media/piano/instruments/<id>/` (SFZ + samples for sfizz voices; `.syx` banks for dexed). This is the version-controlled source (Dropbox-synced).
- Push to the tablet once: `adb push media/piano/instruments/ /sdcard/Android/data/net.kckern.pianobridge/files/instruments/`.
- Pick the grand: **Salamander Grand C5** (16 velocity layers, free) to start; swap for a premium SFZ later by dropping it in and updating `config.yml`. DX7: a quality `.syx` bank (e.g. a curated Rhodes/EP patch).
- Document the push step in `_extensions/piano-bridge/README.md`.

### Task 13: Author the household config

Add to `data/household/apps/piano/config.yml`:

```yaml
instruments:
  - id: concert_grand
    name: Concert Grand
    engine: sfizz
    asset: instruments/salamander/SalamanderC5.sfz
    velocity_curve: natural
    gain_db: -3
    reverb: { type: hall, mix: 0.18 }
  - id: dx7_rhodes
    name: DX7 Electric
    engine: dexed
    asset: instruments/dx7/rhodes_mk1.syx
    patch: 3
    chorus: { mix: 0.25 }
```

**Verify:** reload the kiosk; the source selector lists `Onboard`, `Concert Grand`, `DX7 Electric`.

### Task 14: End-to-end + latency/quality acceptance

- **Toggle round-trip:** Onboard → Concert Grand → DX7 → Onboard. Confirm onboard is silent when an instrument is active (CC122) and returns when back to Onboard.
- **Latency:** measure key-press → audible onset. Target < ~30 ms in direct-read mode. Use the `audio_cue`/timing approach from memory `Fitness Audio Cue Playback` style instrumentation, or a mic + scope. If relay mode is forced, record the measured penalty.
- **Dynamic touch:** verify pp→ff produces real timbral/velocity change (sfizz layers; Dexed FM) — not just volume.
- **Output quality:** confirm a real DAC/amp/monitor is used; note that the tablet's built-in speaker caps perceived quality regardless of engine.
- Record results in `_extensions/piano-bridge/DESIGN.md` (mirror the audio-bridge DESIGN doc), including which MIDI mode (direct vs relay) this tablet uses.

### Task 15: Docs + memory

- Write `_extensions/piano-bridge/DESIGN.md` (architecture, protocol, build, on-device setup, known issues) and `_extensions/piano-bridge/README.md` (build + adb-push runbook).
- Update `docs/reference/` if the piano app gains a reference page; at minimum link the new extension from the piano docs.
- Add a memory entry (reference type) capturing: the multi-engine APK, the `instruments` vs `voices` distinction, the WS protocol, the direct-vs-relay MIDI decision, and the asset adb-push location.

---

## Done-When

- Toggling `Onboard ↔ Concert Grand ↔ DX7 Electric` works from the chrome; onboard mutes via CC122 when a rendered instrument is active.
- The SFZ grand has audible dynamic touch and best-available quality through a real output; the DX7 sounds like FM.
- Adding a new instrument requires only: drop assets in `media/piano/instruments/`, `adb push`, add a `config.yml` entry — **no code change** (the "not 1:1" requirement).
- All JS/backend tests pass (`npm test`), the Playwright smoke passes, and the APK builds + runs on the tablet.
