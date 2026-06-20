# Fitness Scanner-Abuse Auto-Lockdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-trigger the existing emergency DEFCON lockdown when the garage fingerprint reader sees 3 failed scans within 30s, to stop unauthorized users overheating the sensor.

**Architecture:** The backend identity relay (`identityRelay.mjs`) already classifies every `biometric.scan`. We add a sliding-window failed-scan counter there. On trip it stamps a *synthetic pending detection* (so the existing frontend ceremony → `POST /commit` path locks unchanged) and broadcasts a new WS topic `fitness.emergency.ceremony`. The frontend `useEmergencyLockdown` hook subscribes to that topic and runs the same `triggerCeremony()` an admin press would — identical overlay, audio, admin-abort window, commit, and HA shutdown downstream. Trip authority stays server-side (a client can't be trusted to self-report abuse). A failed scan = unrecognized OR recognized-but-holds-zero-locks; any recognized member holding ≥1 lock (incl. admins) is safe and resets the streak.

**Tech Stack:** Node ESM backend (vitest), React hook (vitest + @testing-library/react), WS event bus, YAML household config.

---

## File Structure

- **Modify** `backend/src/3_applications/fitness/identityRelay.mjs` — abuse counter, trip logic, new topic, accept `getLockdownState`.
- **Modify** `backend/src/3_applications/fitness/identityRelay.test.mjs` — abuse test suite.
- **Modify** `backend/src/app.mjs` (line ~1715) — pass `getLockdownState` into `createIdentityRelay`.
- **Modify** `frontend/src/modules/Fitness/hooks/useEmergencyLockdown.js` — subscribe to `fitness.emergency.ceremony`, reorder `triggerCeremony` above the WS effect.
- **Modify** `frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.jsx` — ceremony-broadcast test.
- **Modify** `docs/runbooks/fitness-emergency-lockdown.md` — document the auto-trip + config + new topic.
- **Optional/config** `data/household/config/fitness.yml` — `emergency.abuse` block (defaults are baked into code; this only tunes/disables).

**Design decisions (locked):** `enabled` defaults **on**; new topic name is **`fitness.emergency.ceremony`**.

---

### Task 1: Backend — abuse counter + trip in the identity relay

**Files:**
- Modify: `backend/src/3_applications/fitness/identityRelay.mjs`
- Test: `backend/src/3_applications/fitness/identityRelay.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append this `describe` block to the END of `identityRelay.test.mjs` (after the existing `describe('createIdentityRelay', ...)` closes, before EOF). It reuses the file's existing `profiles()` and `makeBus()` helpers.

```javascript
describe('scanner-abuse auto-lockdown', () => {
  // kc = admin (holds ADMIN_LOCK); guest = holds dance_party. Both are "safe".
  const abuseDeps = (now, overrides = {}) => ({
    eventBus: makeBus(),
    userService: { getAllProfiles: () => profiles() },
    loadFitnessConfig: () => ({
      locks: { dance_party: ['kc', 'guest'] },
      users: { admin: ['kc'] },
      emergency: { abuse: { enabled: true, threshold: 3, window_sec: 30 } },
    }),
    now,
    logger: { debug() {}, info() {}, warn() {} },
    ...overrides,
  });
  const fail = (bus) => bus.deliver({ topic: 'biometric.scan', matched: false });

  it('trips the ceremony after N unrecognized scans within the window', () => {
    let t = 1000;
    const d = abuseDeps(() => t);
    const relay = createIdentityRelay(d);
    t = 1000; fail(d.eventBus);
    t = 2000; fail(d.eventBus);
    expect(d.eventBus.broadcasts.find((b) => b.topic === 'fitness.emergency.ceremony')).toBeUndefined();
    t = 3000; fail(d.eventBus);
    const evt = d.eventBus.broadcasts.find((b) => b.topic === 'fitness.emergency.ceremony');
    expect(evt).toBeDefined();
    expect(evt.payload).toMatchObject({ reason: 'abuse', count: 3, windowSec: 30 });
    // A synthetic pending is stamped so the existing ceremony→commit path can lock.
    expect(relay.consumePendingDetection(3000)).toEqual({ userId: 'abuse-protection', at: 3000 });
  });

  it('does not trip when failures fall outside the window', () => {
    let t = 0;
    const d = abuseDeps(() => t);
    createIdentityRelay(d);
    t = 1000; fail(d.eventBus);
    t = 2000; fail(d.eventBus);
    t = 32000; fail(d.eventBus); // prunes the two >30s-old entries; only 1 in window
    expect(d.eventBus.broadcasts.find((b) => b.topic === 'fitness.emergency.ceremony')).toBeUndefined();
  });

  it('an authorized scan resets the streak', () => {
    let t = 0;
    const d = abuseDeps(() => t);
    createIdentityRelay(d);
    t = 1000; fail(d.eventBus);
    t = 2000; fail(d.eventBus);
    t = 2500; d.eventBus.deliver({ topic: 'biometric.scan', matched: true, uuid: 'uuid-guest' }); // holds dance_party → safe
    t = 3000; fail(d.eventBus);
    expect(d.eventBus.broadcasts.find((b) => b.topic === 'fitness.emergency.ceremony')).toBeUndefined();
  });

  it('counts a recognized identity holding no locks as a failed scan', () => {
    let t = 0;
    const d = {
      eventBus: makeBus(),
      userService: { getAllProfiles: () => profiles() },
      loadFitnessConfig: () => ({ locks: {}, users: { admin: ['kc'] }, emergency: { abuse: { threshold: 3, window_sec: 30 } } }),
      now: () => t,
      logger: { debug() {}, info() {}, warn() {} },
    };
    createIdentityRelay(d);
    const noAccess = () => d.eventBus.deliver({ topic: 'biometric.scan', matched: true, uuid: 'uuid-guest' });
    t = 1000; noAccess();
    t = 2000; noAccess();
    t = 3000; noAccess();
    expect(d.eventBus.broadcasts.find((b) => b.topic === 'fitness.emergency.ceremony')).toBeDefined();
  });

  it('does not trip when abuse protection is disabled', () => {
    let t = 0;
    const d = abuseDeps(() => t, {
      loadFitnessConfig: () => ({ locks: {}, users: { admin: ['kc'] }, emergency: { abuse: { enabled: false } } }),
    });
    createIdentityRelay(d);
    for (let i = 1; i <= 5; i++) { t = 1000 * i; fail(d.eventBus); }
    expect(d.eventBus.broadcasts.find((b) => b.topic === 'fitness.emergency.ceremony')).toBeUndefined();
  });

  it('suppresses re-trips during the cooldown window', () => {
    let t = 0;
    const d = abuseDeps(() => t);
    createIdentityRelay(d);
    t = 1000; fail(d.eventBus);
    t = 2000; fail(d.eventBus);
    t = 3000; fail(d.eventBus); // trips; cooldown until 63000
    t = 4000; fail(d.eventBus);
    t = 5000; fail(d.eventBus);
    t = 6000; fail(d.eventBus);
    const ceremonies = d.eventBus.broadcasts.filter((b) => b.topic === 'fitness.emergency.ceremony');
    expect(ceremonies).toHaveLength(1);
  });

  it('does not trip (or stamp a synthetic pending) while a lockdown is already active', async () => {
    let t = 0;
    const d = abuseDeps(() => t, { getLockdownState: { execute: async () => ({ lockedUntil: 9999999999 }) } });
    const relay = createIdentityRelay(d);
    t = 1000; fail(d.eventBus);
    t = 2000; fail(d.eventBus);
    t = 3000; fail(d.eventBus);
    await new Promise((r) => setTimeout(r, 0)); // let tripAbuse's async lock-check settle
    expect(d.eventBus.broadcasts.find((b) => b.topic === 'fitness.emergency.ceremony')).toBeUndefined();
    expect(relay.consumePendingDetection(3000)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/fitness/identityRelay.test.mjs`
Expected: the new `scanner-abuse auto-lockdown` tests FAIL (no `fitness.emergency.ceremony` broadcast is ever emitted). Existing tests still pass.

- [ ] **Step 3: Implement the counter + trip in `identityRelay.mjs`**

3a. Add constants. Replace the existing top constants block:

```javascript
const SCAN_TOPIC = 'biometric.scan';
const IDENTITY_TOPIC = 'fitness.identity.detected';
const DEFAULT_PENDING_TTL_MS = 30000;
```

with:

```javascript
const SCAN_TOPIC = 'biometric.scan';
const IDENTITY_TOPIC = 'fitness.identity.detected';
const CEREMONY_TOPIC = 'fitness.emergency.ceremony';
const DEFAULT_PENDING_TTL_MS = 30000;

// Scanner-abuse auto-lockdown defaults (overridable via fitness.yml emergency.abuse).
const DEFAULT_ABUSE_THRESHOLD = 3;
const DEFAULT_ABUSE_WINDOW_SEC = 30;
// After a trip, ignore further failed scans for this long so the in-flight ceremony
// (and the lock it produces) isn't re-tripped. Once the lock is active getLockdownState
// keeps suppressing; an aborted ceremony resumes counting after this window.
const ABUSE_COOLDOWN_MS = 60000;
// Sentinel recorded as lockedBy when the lockdown is auto-tripped by scanner abuse.
const ABUSE_USER = 'abuse-protection';
```

3b. Add `getLockdownState` to the factory params. Change the `createIdentityRelay({ ... })` destructure to include it (insert after `loadFitnessConfig,`):

```javascript
export function createIdentityRelay({
  eventBus,
  userService,
  loadFitnessConfig,
  getLockdownState = null,
  now = () => Date.now(),
  pendingTtlMs = DEFAULT_PENDING_TTL_MS,
  adminSessionTtlMs = DEFAULT_ADMIN_SESSION_TTL_MS,
  logger = console,
}) {
```

3c. Add abuse state next to the existing `pending`/`lastAdmin` declarations:

```javascript
  let pending = null;   // { userId, at } — emergency ceremony guard
  let lastAdmin = null; // { userId, at } — most recent admin verification (sliding session)
  let failedTimes = [];        // ms timestamps of recent failed scans (abuse counter)
  let abuseSuppressUntil = 0;  // ms; ignore failed scans until this time after a trip
```

3d. Add the trip + record helpers immediately above `function handleScan(message) {`:

```javascript
  // Auto-trip: stamp a synthetic pending so the existing frontend ceremony →
  // POST /commit path locks unchanged, then broadcast the "start ceremony" signal.
  async function tripAbuse(at, threshold, windowMs) {
    // Never auto-trip while a lockdown is already active: a synthetic pending stamped
    // during a lock would let the LockedScreen press-and-hold release succeed without
    // an admin scan (it consumes pending too). Bail if already locked.
    if (getLockdownState) {
      try {
        const state = await getLockdownState.execute({ now: Math.floor(at / 1000) });
        if (state) return;
      } catch { /* lookup failed — fall through and trip (fail-safe toward locking) */ }
    }
    pending = { userId: ABUSE_USER, at: now() };
    eventBus.broadcast(CEREMONY_TOPIC, {
      reason: 'abuse', count: threshold, windowSec: Math.round(windowMs / 1000), at,
    });
    logger.warn?.('identity.abuse_tripped', { count: threshold, windowSec: Math.round(windowMs / 1000) });
  }

  // Feed each scan's outcome into the sliding-window abuse counter. A safe
  // (authorized) scan breaks the streak; threshold failures within the window trip.
  function recordScanOutcome(failed, at) {
    const abuseCfg = loadFitnessConfig?.()?.emergency?.abuse || {};
    if (abuseCfg.enabled === false) return;
    if (!failed) { failedTimes = []; return; }
    if (at < abuseSuppressUntil) return;
    const threshold = Number(abuseCfg.threshold) > 0 ? Math.floor(Number(abuseCfg.threshold)) : DEFAULT_ABUSE_THRESHOLD;
    const windowMs = (Number(abuseCfg.window_sec) > 0 ? Number(abuseCfg.window_sec) : DEFAULT_ABUSE_WINDOW_SEC) * 1000;
    failedTimes.push(at);
    failedTimes = failedTimes.filter((t) => at - t < windowMs);
    if (failedTimes.length >= threshold) {
      failedTimes = [];
      abuseSuppressUntil = at + ABUSE_COOLDOWN_MS; // sync guard against re-entrant trips
      tripAbuse(at, threshold, windowMs).catch((err) =>
        logger.warn?.('identity.abuse_trip_failed', { message: err?.message ?? null }));
    }
  }
```

3e. Call `recordScanOutcome` at each terminal point in `handleScan`. The two `emitUnrecognized` early-returns become failed; the recognized path classifies by lock count. Update the body so it reads:

```javascript
    if (!message.matched || !message.uuid) {
      emitUnrecognized(modality, at);
      logger.debug?.('identity.unrecognized', { modality });
      recordScanOutcome(true, at);
      return;
    }
    const index = buildFingerprintIdentityIndex(userService?.getAllProfiles?.() || {});
    const entry = index[message.uuid];
    if (!entry) {
      emitUnrecognized(modality, at);
      logger.warn?.('identity.unknown_uuid', { modality });
      recordScanOutcome(true, at);
      return;
    }
    const fitnessConfig = loadFitnessConfig?.() || {};
    const authz = buildAuthz(entry.userId, fitnessConfig);
```

…and after the existing `eventBus.broadcast(IDENTITY_TOPIC, {...})` + `logger.info?.('identity.detected', {...})` at the end of `handleScan`, add:

```javascript
    // Recognized members holding ≥1 lock are legitimate (resets the abuse streak);
    // a recognized identity holding NO locks counts as a failed/abusive scan.
    recordScanOutcome(authz.locks.length === 0, at);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/fitness/identityRelay.test.mjs`
Expected: PASS (all existing + 7 new tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/identityRelay.mjs backend/src/3_applications/fitness/identityRelay.test.mjs
git commit -m "feat(fitness): auto-trip emergency lockdown on scanner abuse (relay counter)"
```

---

### Task 2: Backend — wire `getLockdownState` into the relay

**Files:**
- Modify: `backend/src/app.mjs` (the `createIdentityRelay({ ... })` call, ~line 1715)

- [ ] **Step 1: Pass `getLockdownState` into the relay**

`getLockdownState` is already constructed just above (line ~1711). Add it to the relay's deps. Change:

```javascript
  const identityRelay = createIdentityRelay({
    eventBus,
    userService,
    loadFitnessConfig: () => loadFitnessConfig(householdId) || {},
    logger: emergencyLogger,
  });
```

to:

```javascript
  const identityRelay = createIdentityRelay({
    eventBus,
    userService,
    loadFitnessConfig: () => loadFitnessConfig(householdId) || {},
    getLockdownState,
    logger: emergencyLogger,
  });
```

- [ ] **Step 2: Syntax-check the file**

Run: `node --check backend/src/app.mjs`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(fitness): give the identity relay lockdown-state for the abuse guard"
```

---

### Task 3: Frontend — start the ceremony on the abuse broadcast

**Files:**
- Modify: `frontend/src/modules/Fitness/hooks/useEmergencyLockdown.js`
- Test: `frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.jsx`

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('useEmergencyLockdown', ...)` block in `useEmergencyLockdown.test.jsx` (alongside the other `it(...)` cases). It uses the file's existing `emit()` helper.

```javascript
  it('a fitness.emergency.ceremony broadcast starts the ceremony (normal → triggering)', async () => {
    DaylightAPI.mockResolvedValue({ locked: false });
    const { result } = renderHook(() => useEmergencyLockdown());
    await waitFor(() => expect(result.current.phase).toBe('normal'));
    act(() => { emit({ topic: 'fitness.emergency.ceremony', reason: 'abuse', count: 3, windowSec: 30 }); });
    expect(result.current.phase).toBe('triggering');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.jsx`
Expected: the new test FAILS — phase stays `normal` (the hook ignores the unknown topic).

- [ ] **Step 3: Add the topic + handle it**

3a. Add the topic constant and extend `TOPICS`. Replace:

```javascript
const TOPICS = [
  'fitness.emergency.locked',
  'fitness.emergency.released'
];
```

with:

```javascript
const CEREMONY_TOPIC = 'fitness.emergency.ceremony';
const TOPICS = [
  'fitness.emergency.locked',
  'fitness.emergency.released',
  CEREMONY_TOPIC
];
```

3b. Move the `triggerCeremony` `useCallback` ABOVE the websocket effect (the WS effect's dependency array will reference it, so it must be initialized first — referencing it later would hit a temporal-dead-zone error). Cut this block from its current location in the `--- Actions ---` section:

```javascript
  const triggerCeremony = useCallback(() => {
    setPhase((prev) => {
      if (prev === PHASE_NORMAL) {
        logger().info('emergency.triggering', { source: 'triggerCeremony' });
        return PHASE_TRIGGERING;
      }
      return prev;
    });
  }, []);
```

and paste it immediately AFTER the `enterNormal` `useCallback` and BEFORE the `// --- Mount: hydrate current lock state` effect. (Also delete the now-stale `// Imperative entry point...` comment that sat above it in the Actions section.)

3c. Handle the topic in the websocket switch. In the `wsService.subscribe(TOPICS, (msg) => { ... })` handler, add a case:

```javascript
        case 'fitness.emergency.released':
          logger().info('emergency.released', { by: msg.by ?? null, at: msg.at ?? null });
          enterNormal('ws-released');
          break;
        case CEREMONY_TOPIC:
          logger().info('emergency.ceremony_broadcast', { reason: msg.reason ?? null, count: msg.count ?? null });
          triggerCeremony();
          break;
```

3d. Add `triggerCeremony` to that effect's dependency array:

```javascript
  }, [enterLocked, enterNormal, triggerCeremony]);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.jsx`
Expected: PASS (all existing + the new ceremony test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/hooks/useEmergencyLockdown.js frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.jsx
git commit -m "feat(fitness): start the lockdown ceremony on fitness.emergency.ceremony broadcast"
```

---

### Task 4: Docs + config knobs

**Files:**
- Modify: `docs/runbooks/fitness-emergency-lockdown.md`
- Optional: `data/household/config/fitness.yml` (see Step 2 caveat)

- [ ] **Step 1: Document the auto-trip in the runbook**

In `docs/runbooks/fitness-emergency-lockdown.md`:

4a. Under `## How to trigger`, add a new subsection after the admin-press paragraph:

```markdown
### Automatic trip on scanner abuse

To stop an unauthorized person overheating the reader by mashing fingers, the
backend counts **failed** scans (unrecognized, OR a recognized identity that
holds no locks). On `emergency.abuse.threshold` failures within
`emergency.abuse.window_sec` it auto-runs the same ceremony as an admin press —
DEFCON screen, cancel window, then commit + `garage_deactivate`. An **admin scan
during the ceremony still aborts it**, so a false positive is recoverable. A
recognized member holding ≥1 lock (incl. admins) is "safe" and resets the streak.
The lock records `lockedBy: abuse-protection`.
```

4b. In the `## Configuration` YAML block, add the `abuse` keys under `emergency:`:

```yaml
emergency:
  duration_sec: 1800                 # lockdown length (default 30 min)
  ha_script: garage_deactivate       # HA script.<name> fired on commit
  audio: apps/fitness/ux/powerdown.mp3
  abuse:                             # scanner-abuse auto-lockdown (default ON)
    enabled: true                    # set false to disable entirely
    threshold: 3                     # failed scans to trip
    window_sec: 30                   # sliding window for the count
  arming:                            # hardware hedge for the always-armed reader
    inter_arm_idle_ms: 1000
```

4c. In the `## API` section's "WebSocket broadcasts" line, add the new topic:

```markdown
WebSocket broadcasts: `fitness.emergency.detected`, `fitness.emergency.ceremony`
(auto-trip → start ceremony), `fitness.emergency.locked`,
`fitness.emergency.released`.
```

- [ ] **Step 2: (Optional) add the config block to live `fitness.yml`**

Defaults are baked into code, so the feature is live on deploy **without** this step. Only do this to tune or disable. Because nested YAML must not be edited with `sed -i`, read the whole file first, then write it back complete with the new `abuse:` block under the existing `emergency:` key:

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/fitness.yml' > /tmp/fitness.yml
# hand-edit /tmp/fitness.yml: add the abuse: block under emergency:, then:
sudo docker exec daylight-station sh -c "cat > data/household/config/fitness.yml << 'EOF'
$(cat /tmp/fitness.yml)
EOF"
```

- [ ] **Step 3: Commit the docs**

```bash
git add docs/runbooks/fitness-emergency-lockdown.md
git commit -m "docs(fitness): document scanner-abuse auto-lockdown + config knobs"
```

---

### Task 5: Build, deploy, reload garage, verify

**Files:** none (deploy on `kckern-server`).

- [ ] **Step 1: Run the full affected test files once more**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  backend/src/3_applications/fitness/identityRelay.test.mjs \
  frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.jsx
```
Expected: all PASS. Confirm the pass/fail summary line (don't trust a piped tail's exit code).

- [ ] **Step 2: Confirm the deploy gate is clear (no active workout / no playing video)**

Per `CLAUDE.local.md`, never redeploy while the garage is in use:
```bash
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' \
  | sort | uniq -c
```
Clear = zero render lines, no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`. If either gate is active, wait.

- [ ] **Step 3: Build the image**

```bash
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  .
```
Expected: build succeeds (includes `vite build`).

- [ ] **Step 4: Deploy**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 5: Reload the garage fitness display**

```bash
ssh garage 'DISPLAY=:0 XAUTHORITY=/home/kckern/.Xauthority \
  xdotool search --onlyvisible --class firefox windowactivate --sync key ctrl+shift+r'
```
(The `XGetWindowProperty[_NET_WM_DESKTOP] failed` warning is benign.)

- [ ] **Step 6: Verify the relay is live and the gate is wired**

```bash
sudo docker logs --since 60s daylight-station 2>&1 | grep -iE 'fitness-emergency|identity\.' | tail -20
```
Expected: relay logs present, no startup errors. The auto-trip path itself is exercised by the Task 1 unit tests; on hardware, three unrecognized presses within 30s should produce a `identity.abuse_tripped` warn log and flip the garage screen into the DEFCON ceremony.

---

## Self-Review Notes

- **Spec coverage:** failed-scan definition (unrecognized + recognized-no-locks) → Task 1 Step 3e + tests; 3-in-30s sliding window + config knobs → Task 1; trip authority server-side via synthetic pending → Task 1 `tripAbuse`; ceremony-first response → Task 3 reuses `triggerCeremony` + unchanged overlay; no re-trip while locked (security: stray pending vs release) → Task 1 `tripAbuse` guard + async test; config-driven defaults-on → `recordScanOutcome` + Task 4; docs → Task 4; deploy + garage reload → Task 5.
- **Naming consistency:** `CEREMONY_TOPIC = 'fitness.emergency.ceremony'`, `ABUSE_USER = 'abuse-protection'`, `recordScanOutcome`, `tripAbuse`, `failedTimes`, `abuseSuppressUntil` used identically across relay code, relay tests, hook, and hook test.
