# ArtMode Ambient Brightness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ArtMode auto-dims to the room: a backend HA-websocket listener broadcasts the max of two kitchen illuminance sensors; ArtMode maps that lux to its dim-overlay opacity via a tunable curve (dark room → very dim, daylight → brightest-but-ambient).

**Architecture:** A new backend `AmbientLightService` opens a websocket to Home Assistant, subscribes to `state_changed`, tracks the per-sensor lux in a pure `AmbientLightTracker`, and rebroadcasts `max(lux)` on the eventbus topic `ambient`. ArtMode subscribes to `ambient` and maps lux→opacity with a pure `luxToDim` curve helper, combined with a manual bias.

**Tech Stack:** Node/Express ESM, `ws` (HA websocket client), eventbus, Jest (backend), React + Vitest (frontend).

---

## File Structure

**Create:**
- `frontend/src/screen-framework/widgets/luxToDim.js` — pure lux→dim curve interpolation.
- `tests/unit/art/luxToDim.test.mjs` — Vitest.
- `backend/src/2_domains/home-automation/AmbientLightTracker.mjs` — pure per-entity lux tracker (max + change threshold).
- `tests/unit/home-automation/AmbientLightTracker.test.mjs` — Jest.
- `backend/src/3_applications/home-automation/AmbientLightService.mjs` — HA-websocket subscription → eventbus broadcast.
- `tests/unit/home-automation/AmbientLightService.test.mjs` — Jest.

**Modify:**
- `backend/src/1_adapters/home-automation/homeassistant/HomeAssistantAdapter.mjs` — add `getConnection()` ({baseUrl, token}) for the WS client.
- `backend/src/app.mjs` — construct + start `AmbientLightService` from `ambient.yml`.
- `frontend/src/screen-framework/widgets/ArtMode.jsx` — subscribe to `ambient`, map via `luxToDim`, combine with manual bias.
- `frontend/src/screen-framework/widgets/ArtMode.css` — slow the `.artmode__dim` transition.
- `frontend/src/screen-framework/widgets/ArtMode.test.jsx` — mock the WS hook; add ambient/bias tests.
- `data/household/config/ambient.yml` (container volume) — entity ids + topic.
- `data/household/screens/living-room.yml` (container volume) — `screensaver.props.ambient` curve.

**Conventions:** Backend tests under Jest (`npx jest`), relative imports. Frontend tests under Vitest (`./node_modules/.bin/vitest run --config vitest.config.mjs <file>`).

---

## Task 1: `luxToDim` curve helper (frontend, pure)

**Files:**
- Create: `frontend/src/screen-framework/widgets/luxToDim.js`
- Test: `tests/unit/art/luxToDim.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/art/luxToDim.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { luxToDim } from '../../../frontend/src/screen-framework/widgets/luxToDim.js';

const curve = [
  { lux: 0, dim: 0.92 },
  { lux: 5, dim: 0.85 },
  { lux: 40, dim: 0.55 },
  { lux: 150, dim: 0.32 },
  { lux: 400, dim: 0.15 },
];

describe('luxToDim', () => {
  it('clamps below the first point', () => {
    expect(luxToDim(-10, curve)).toBeCloseTo(0.85, 5); // 0.92 clamped to 0.85 ceiling
    expect(luxToDim(0, curve)).toBeCloseTo(0.85, 5);
  });
  it('clamps above the last point', () => {
    expect(luxToDim(10000, curve)).toBeCloseTo(0.15, 5);
  });
  it('interpolates linearly between points', () => {
    // midway between {40,0.55} and {150,0.32}: lux 95 → t=0.5 → 0.435
    expect(luxToDim(95, curve)).toBeCloseTo(0.435, 3);
  });
  it('caps dim at 0.85 even if a point asks for more', () => {
    expect(luxToDim(0, [{ lux: 0, dim: 2 }, { lux: 100, dim: 0 }])).toBe(0.85);
  });
  it('returns a safe default for an empty/invalid curve', () => {
    expect(luxToDim(50, [])).toBe(0.4);
    expect(luxToDim(50, null)).toBe(0.4);
  });
});
```

- [ ] **Step 2: Run it, verify FAIL**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/luxToDim.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `frontend/src/screen-framework/widgets/luxToDim.js`:**

```javascript
// luxToDim — pure. Map a lux reading to a dim-overlay opacity via a
// piecewise-linear curve of { lux, dim } control points (clamped at the ends).
const DIM_CEIL = 0.85;
const clampDim = (n) => Math.max(0, Math.min(DIM_CEIL, n));

export function luxToDim(lux, curve) {
  if (!Array.isArray(curve) || curve.length === 0) return 0.4;
  const pts = [...curve].sort((a, b) => a.lux - b.lux);
  if (!Number.isFinite(lux) || lux <= pts[0].lux) return clampDim(pts[0].dim);
  const last = pts[pts.length - 1];
  if (lux >= last.lux) return clampDim(last.dim);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (lux >= a.lux && lux <= b.lux) {
      const t = (lux - a.lux) / (b.lux - a.lux);
      return clampDim(a.dim + t * (b.dim - a.dim));
    }
  }
  return clampDim(last.dim);
}

export default luxToDim;
```

- [ ] **Step 4: Run it, verify PASS** (5 passing).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screen-framework/widgets/luxToDim.js tests/unit/art/luxToDim.test.mjs
git commit -m "feat(art): luxToDim — piecewise-linear lux→dim curve helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `AmbientLightTracker` (backend, pure)

**Files:**
- Create: `backend/src/2_domains/home-automation/AmbientLightTracker.mjs`
- Test: `tests/unit/home-automation/AmbientLightTracker.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/home-automation/AmbientLightTracker.test.mjs`:

```javascript
import { AmbientLightTracker } from '../../../backend/src/2_domains/home-automation/AmbientLightTracker.mjs';

describe('AmbientLightTracker', () => {
  it('tracks max across entities and reports changes', () => {
    const t = new AmbientLightTracker({ threshold: 1 });
    expect(t.update('a', '10')).toEqual({ changed: true, lux: 10 });
    expect(t.update('b', '40')).toEqual({ changed: true, lux: 40 });
    // a rises but b still the max → no change
    expect(t.update('a', '12')).toEqual({ changed: false, lux: 40 });
    // b rises → change
    expect(t.update('b', '60')).toEqual({ changed: true, lux: 60 });
  });

  it('ignores non-numeric / unavailable states (keeps last good)', () => {
    const t = new AmbientLightTracker({ threshold: 1 });
    t.update('a', '50');
    expect(t.update('a', 'unavailable')).toEqual({ changed: false, lux: 50 });
    expect(t.max()).toBe(50);
  });

  it('suppresses sub-threshold changes', () => {
    const t = new AmbientLightTracker({ threshold: 1 });
    t.update('a', '50');
    expect(t.update('a', '50.4')).toEqual({ changed: false, lux: 50.4 });
    expect(t.update('a', '52')).toEqual({ changed: true, lux: 52 });
  });

  it('exposes sources', () => {
    const t = new AmbientLightTracker();
    t.update('a', '5');
    t.update('b', '9');
    expect(t.sources()).toEqual({ a: 5, b: 9 });
  });
});
```

- [ ] **Step 2: Run it, verify FAIL** — `npx jest tests/unit/home-automation/AmbientLightTracker.test.mjs`.

- [ ] **Step 3: Create `backend/src/2_domains/home-automation/AmbientLightTracker.mjs`:**

```javascript
/**
 * AmbientLightTracker — pure. Holds the latest lux per entity, computes the max,
 * and reports whether the max moved beyond a threshold since the last accepted
 * reading. Non-numeric states (e.g. 'unavailable') are ignored (last good kept).
 */
export class AmbientLightTracker {
  #readings = new Map();
  #lastMax = null;
  #threshold;

  constructor({ threshold = 1 } = {}) {
    this.#threshold = threshold;
  }

  update(entity, rawState) {
    const lux = Number(rawState);
    if (!Number.isFinite(lux)) return { changed: false, lux: this.max() };
    this.#readings.set(entity, lux);
    const m = this.max();
    if (this.#lastMax === null || Math.abs(m - this.#lastMax) >= this.#threshold) {
      this.#lastMax = m;
      return { changed: true, lux: m };
    }
    return { changed: false, lux: m };
  }

  max() {
    let m = null;
    for (const v of this.#readings.values()) m = m === null ? v : Math.max(m, v);
    return m;
  }

  sources() {
    return Object.fromEntries(this.#readings);
  }
}

export default AmbientLightTracker;
```

- [ ] **Step 4: Run it, verify PASS** (4 passing).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/home-automation/AmbientLightTracker.mjs tests/unit/home-automation/AmbientLightTracker.test.mjs
git commit -m "feat(ambient): AmbientLightTracker — max-lux across sensors with change threshold

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `AmbientLightService` + HA connection + wiring

**Files:**
- Create: `backend/src/3_applications/home-automation/AmbientLightService.mjs`
- Test: `tests/unit/home-automation/AmbientLightService.test.mjs`
- Modify: `backend/src/1_adapters/home-automation/homeassistant/HomeAssistantAdapter.mjs`
- Modify: `backend/src/app.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/home-automation/AmbientLightService.test.mjs`:

```javascript
import { createAmbientLightService } from '../../../backend/src/3_applications/home-automation/AmbientLightService.mjs';

const noopLogger = { warn: () => {}, error: () => {}, debug: () => {}, info: () => {} };
const makeService = (over = {}) => {
  const broadcasts = [];
  const eventBus = { broadcast: (topic, payload) => broadcasts.push({ topic, payload }) };
  const haGateway = {
    getStates: async () => new Map(),
    getConnection: () => ({ baseUrl: 'http://ha:8123', token: 'TKN' }),
  };
  let now = 100000;
  const svc = createAmbientLightService({
    haGateway, eventBus, logger: noopLogger,
    config: { entities: ['sensor.a', 'sensor.b'], topic: 'ambient' },
    now: () => now,
    ...over,
  });
  return { svc, broadcasts, setNow: (n) => { now = n; } };
};

const evt = (entity, state) =>
  JSON.stringify({ type: 'event', event: { event_type: 'state_changed', data: { entity_id: entity, new_state: { state } } } });

describe('AmbientLightService', () => {
  it('authenticates then subscribes on the HA handshake', () => {
    const { svc } = makeService();
    const sent = [];
    const send = (m) => sent.push(m);
    svc._onHaMessage(JSON.stringify({ type: 'auth_required' }), send);
    svc._onHaMessage(JSON.stringify({ type: 'auth_ok' }), send);
    expect(sent[0]).toEqual({ type: 'auth', access_token: 'TKN' });
    expect(sent[1].type).toBe('subscribe_events');
    expect(sent[1].event_type).toBe('state_changed');
  });

  it('broadcasts max lux on a configured-entity state change', () => {
    const { svc, broadcasts } = makeService();
    svc._onHaMessage(evt('sensor.a', '50'), () => {});
    svc._onHaMessage(evt('sensor.b', '120'), () => {});
    expect(broadcasts.at(-1)).toEqual({ topic: 'ambient', payload: { topic: 'ambient', lux: 120, sources: { 'sensor.a': 50, 'sensor.b': 120 } } });
  });

  it('ignores entities not in the config', () => {
    const { svc, broadcasts } = makeService();
    svc._onHaMessage(evt('sensor.other', '999'), () => {});
    expect(broadcasts).toHaveLength(0);
  });

  it('throttles broadcasts within the window', () => {
    const { svc, broadcasts, setNow } = makeService();
    svc._onHaMessage(evt('sensor.a', '50'), () => {});   // t=100000 → broadcast
    svc._onHaMessage(evt('sensor.a', '80'), () => {});   // same instant → throttled
    expect(broadcasts).toHaveLength(1);
    setNow(103000);                                       // +3s past the 2s window
    svc._onHaMessage(evt('sensor.a', '110'), () => {});
    expect(broadcasts).toHaveLength(2);
    expect(broadcasts.at(-1).payload.lux).toBe(110);
  });
});
```

- [ ] **Step 2: Run it, verify FAIL** — `npx jest tests/unit/home-automation/AmbientLightService.test.mjs`.

- [ ] **Step 3: Add `getConnection()` to the HA adapter**

In `backend/src/1_adapters/home-automation/homeassistant/HomeAssistantAdapter.mjs`, find the `isConfigured`/health area (the method around line 290 returning `!!(this.#baseUrl && this.#token)`). Add this method just before it:

```javascript
  /**
   * Connection info for a websocket client (the WS listener builds ws(s)://…/api/websocket).
   * @returns {{ baseUrl: string, token: string }}
   */
  getConnection() {
    return { baseUrl: this.#baseUrl, token: this.#token };
  }
```

- [ ] **Step 4: Create `backend/src/3_applications/home-automation/AmbientLightService.mjs`:**

```javascript
/**
 * AmbientLightService — subscribes to Home Assistant illuminance sensors over the
 * HA websocket and rebroadcasts max(lux) on the eventbus so the frontend (ArtMode)
 * can auto-dim to the room. Reconnects with backoff; seeds an initial value via REST.
 */
import WebSocket from 'ws';
import { AmbientLightTracker } from '../../2_domains/home-automation/AmbientLightTracker.mjs';

export function createAmbientLightService({
  haGateway, eventBus, config, logger = console,
  WebSocketImpl = WebSocket, now = () => Date.now(),
}) {
  const entities = config?.entities ?? [];
  const topic = config?.topic ?? 'ambient';
  const tracker = new AmbientLightTracker({ threshold: 1 });
  const THROTTLE_MS = 2000;
  let lastBroadcast = 0;
  let ws = null;
  let backoff = 1000;
  let stopped = false;

  function publish(lux, force = false) {
    const t = now();
    if (!force && t - lastBroadcast < THROTTLE_MS) return;
    lastBroadcast = t;
    eventBus.broadcast(topic, { topic, lux, sources: tracker.sources() });
  }

  // Handle one HA websocket frame. `send` serializes+sends a reply object.
  function _onHaMessage(raw, send) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'auth_required') {
      const { token } = haGateway.getConnection?.() ?? {};
      send({ type: 'auth', access_token: token });
      return;
    }
    if (msg.type === 'auth_ok') {
      send({ id: 1, type: 'subscribe_events', event_type: 'state_changed' });
      return;
    }
    if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
      const entity = msg.event.data?.entity_id;
      if (!entities.includes(entity)) return;
      const r = tracker.update(entity, msg.event.data?.new_state?.state);
      if (r.changed) publish(r.lux);
    }
  }

  async function seed() {
    try {
      const states = await haGateway.getStates(entities);
      for (const [entity, s] of states) tracker.update(entity, s.state);
      const m = tracker.max();
      if (m !== null) publish(m, true);
    } catch (err) {
      logger.warn?.('ambient.seed.failed', { error: err.message });
    }
  }

  function connect() {
    if (stopped) return;
    const conn = haGateway.getConnection?.();
    if (!conn?.baseUrl) { logger.warn?.('ambient.no_connection'); return; }
    const url = conn.baseUrl.replace(/^http/i, 'ws') + '/api/websocket';
    ws = new WebSocketImpl(url);
    ws.on('open', () => { backoff = 1000; logger.info?.('ambient.ws.open'); });
    ws.on('message', (data) => _onHaMessage(data.toString(), (m) => ws.send(JSON.stringify(m))));
    const retry = () => {
      if (stopped) return;
      logger.warn?.('ambient.ws.reconnect', { inMs: backoff });
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 30000);
    };
    ws.on('close', retry);
    ws.on('error', (err) => { logger.warn?.('ambient.ws.error', { error: err.message }); });
  }

  async function start() {
    if (!entities.length) { logger.info?.('ambient.disabled', { reason: 'no entities' }); return; }
    await seed();
    connect();
  }

  function stop() {
    stopped = true;
    try { ws?.close(); } catch { /* ignore */ }
  }

  return { start, stop, _onHaMessage };
}

export default createAmbientLightService;
```

- [ ] **Step 5: Run it, verify PASS** (4 passing). Then `node --check` both new backend files.

- [ ] **Step 6: Wire into `app.mjs`**

Add the import near the other home-automation imports (search for `createHomeAutomationAdapters` import at the top of `backend/src/app.mjs` and add below it):

```javascript
import { createAmbientLightService } from './3_applications/home-automation/AmbientLightService.mjs';
```

Then find the `const homeAutomationAdapters = createHomeAutomationAdapters({` block (≈ line 1632) and, AFTER that call completes (after its closing `});`), add:

```javascript
  // Ambient brightness: HA illuminance sensors → eventbus 'ambient' → ArtMode dim.
  const ambientConfig = configService.getAppConfig('ambient') || {};
  if (ambientConfig?.illuminance?.entities?.length && homeAutomationAdapters.haGateway?.getConnection) {
    const ambientLight = createAmbientLightService({
      haGateway: homeAutomationAdapters.haGateway,
      eventBus,
      config: {
        entities: ambientConfig.illuminance.entities,
        topic: ambientConfig.illuminance.topic || 'ambient',
      },
      logger: rootLogger.child({ module: 'ambient-light' }),
    });
    ambientLight.start();
  }
```

(Confirm `eventBus`, `configService`, and `rootLogger` are in scope at that point — they are defined earlier in `createApp`. If `homeAutomationAdapters.haGateway` is null/NoOp, the guard skips cleanly.)

- [ ] **Step 7: `node --check backend/src/app.mjs`** (expect clean).

- [ ] **Step 8: Commit**

```bash
git add backend/src/3_applications/home-automation/AmbientLightService.mjs \
        tests/unit/home-automation/AmbientLightService.test.mjs \
        backend/src/1_adapters/home-automation/homeassistant/HomeAssistantAdapter.mjs \
        backend/src/app.mjs
git commit -m "feat(ambient): HA-websocket lux listener broadcasting max on the eventbus

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: ArtMode auto-dims from ambient lux

**Files:**
- Modify: `frontend/src/screen-framework/widgets/ArtMode.jsx`
- Modify: `frontend/src/screen-framework/widgets/ArtMode.css`
- Test: `frontend/src/screen-framework/widgets/ArtMode.test.jsx`
- Modify: `data/household/config/ambient.yml`, `data/household/screens/living-room.yml` (container volume)

- [ ] **Step 1: Update the ArtMode test file**

In `frontend/src/screen-framework/widgets/ArtMode.test.jsx`, add a WS-hook mock near the top (after the existing `vi.mock('../../lib/api.mjs', …)`), capturing the ambient callback so tests can drive it:

```javascript
let ambientCb = null;
vi.mock('../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_filter, cb) => { ambientCb = cb; },
}));
```

Add these tests inside the `describe('ArtMode', …)` block (the `single`/`matte` helpers already exist; ArtMode reads `ambient` from props):

```javascript
  it('auto-dims from an ambient lux message via the curve', async () => {
    ambientCb = null;
    DaylightAPI.mockResolvedValue(single());
    const ambient = { defaultLux: 80, curve: [{ lux: 0, dim: 0.9 }, { lux: 100, dim: 0.2 }] };
    const { getByTestId } = render(<ArtMode ambient={ambient} />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    act(() => ambientCb({ lux: 0 }));   // dark room → max dim 0.85 (ceiling)
    expect(getByTestId('artmode-dim').style.opacity).toBe('0.85');
    act(() => ambientCb({ lux: 100 })); // bright → 0.2
    expect(getByTestId('artmode-dim').style.opacity).toBe('0.2');
  });

  it('manual Up/Down biases the auto level', async () => {
    ambientCb = null;
    DaylightAPI.mockResolvedValue(single());
    const ambient = { defaultLux: 80, curve: [{ lux: 0, dim: 0.9 }, { lux: 100, dim: 0.2 }] };
    const { getByTestId } = render(<ArtMode ambient={ambient} />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    act(() => ambientCb({ lux: 100 }));   // auto 0.2
    press('ArrowDown');                    // +0.1 bias → 0.3
    expect(getByTestId('artmode-dim').style.opacity).toBe('0.3');
    press('ArrowUp'); press('ArrowUp');    // -0.2 → 0.1
    expect(getByTestId('artmode-dim').style.opacity).toBe('0.1');
  });
```

- [ ] **Step 2: Run it, verify FAIL** — `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/widgets/ArtMode.test.jsx` (new tests fail; the dim is not yet ambient-driven).

- [ ] **Step 3: Update `ArtMode.jsx`**

Add the hook + helper imports after the existing imports:

```javascript
import { useWebSocketSubscription } from '../../hooks/useWebSocket.js';
import { luxToDim } from './luxToDim.js';
```

Replace the dim state declaration:

```javascript
  const [dim, setDim] = useState(0);
```

with auto + bias state:

```javascript
  const ambientCurve = ambient?.curve ?? null;
  const [autoDim, setAutoDim] = useState(() => (ambientCurve ? luxToDim(ambient?.defaultLux ?? 0, ambientCurve) : 0));
  const [manualBias, setManualBias] = useState(0);
  const round2 = (n) => Math.round(n * 100) / 100;
  const dim = round2(Math.max(0, Math.min(0.85, autoDim + manualBias)));
```

Add `ambient` to the props destructure (the function signature) — change:

```javascript
function ArtMode({
  placard = true, onExit, dismiss,
  frame = DEFAULT_FRAME, matMargin = 4, cropMaxPerSide = 8,
}) {
```

to:

```javascript
function ArtMode({
  placard = true, onExit, dismiss,
  frame = DEFAULT_FRAME, matMargin = 4, cropMaxPerSide = 8, ambient = null,
}) {
```

(There is already a module-level `round2` constant; remove the duplicate you just added inside the component and use the existing one — i.e., do NOT redeclare `round2`; the line above showing `const round2` is only illustrative. Use the existing top-level `round2`.)

Subscribe to the ambient topic (add near the other `useEffect`s, after the key-handler effect):

```javascript
  useWebSocketSubscription(['ambient'], (msg) => {
    if (!ambientCurve || !msg) return;
    setAutoDim(luxToDim(Number(msg.lux), ambientCurve));
  }, [ambientCurve]);
```

Change the key handler's brightness lines from setting `dim` to setting `manualBias`:

```javascript
      else if (BRIGHTER_KEYS.has(k)) setDim((d) => round2(Math.max(0, d - DIM_STEP)));
      else setDim((d) => round2(Math.min(DIM_MAX, d + DIM_STEP)));
```

becomes:

```javascript
      else if (BRIGHTER_KEYS.has(k)) setManualBias((b) => round2(b - DIM_STEP));
      else setManualBias((b) => round2(b + DIM_STEP));
```

The dim overlay already uses `style={{ opacity: dim }}` — `dim` is now the derived value, so no JSX change there. (Remove the old `setDim`/`const [dim,setDim]` entirely; `dim` is derived.)

- [ ] **Step 4: Slow the dim transition in `ArtMode.css`**

In `.artmode__dim`, change:

```css
  transition: opacity 0.35s ease;
```

to:

```css
  transition: opacity 1.5s ease;   /* gentle ambient changes, no flicker */
```

- [ ] **Step 5: Run tests, verify PASS** — `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/widgets/ArtMode.test.jsx` (all pass, incl. the 2 new). Then run the screensaver suite for no regression: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/`.

- [ ] **Step 6: Write the config files (container volume)**

Create `ambient.yml` (per CLAUDE.local.md, heredoc inside `sh -c`):

```bash
sudo docker exec daylight-station sh -c "cat > data/household/config/ambient.yml << 'EOF'
illuminance:
  entities:
    - sensor.kitchen_desk_nightlight_illuminance
    - sensor.kitchen_night_light_illuminance
  topic: ambient
EOF"
```

Add `ambient` to the living-room screensaver props. Read the current file, then rewrite it whole (no sed) adding under `screensaver.props`:

```yaml
    ambient:
      defaultLux: 80
      curve:
        - { lux: 0, dim: 0.92 }
        - { lux: 5, dim: 0.85 }
        - { lux: 40, dim: 0.55 }
        - { lux: 150, dim: 0.32 }
        - { lux: 400, dim: 0.15 }
```

Verify: `curl -s http://localhost:3111/api/v1/screens/living-room | python3 -c 'import sys,json;print(json.load(sys.stdin)["screensaver"]["props"].get("ambient"))'` shows the curve.

- [ ] **Step 7: Commit the frontend files**

```bash
git add frontend/src/screen-framework/widgets/ArtMode.jsx frontend/src/screen-framework/widgets/ArtMode.css frontend/src/screen-framework/widgets/ArtMode.test.jsx
git commit -m "feat(art): ArtMode auto-dims from ambient lux (curve) with manual bias

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** HA-websocket listener + auth/subscribe + max-of-two + eventbus broadcast + reconnect + REST seed (Task 3, with Task 2 tracker); `luxToDim` curve helper (Task 1); ArtMode subscribe + curve map + manual bias + slowed transition (Task 4); backend `ambient.yml` (entities/topic) + frontend `screensaver.props.ambient` (defaultLux/curve) (Task 4 step 6). Dark→0.92, daylight→0.15 via the default curve.
- **Type consistency:** `tracker.update(entity, rawState) → { changed, lux }`; `tracker.sources()`; service broadcasts `{ topic, lux, sources }` on topic `ambient`; `luxToDim(lux, curve)` with `{lux,dim}` points; ArtMode props `ambient = { defaultLux, curve }`; `getConnection() → {baseUrl, token}`. All consistent across tasks.
- **Note:** `dim` in ArtMode becomes derived (`autoDim + manualBias`, clamped); the old `setDim` is removed and Up/Down adjust `manualBias`. The existing top-level `round2` is reused (don't redeclare).
- **Deferred:** whole-screen dimming; time-of-day curves; EMA smoothing.
