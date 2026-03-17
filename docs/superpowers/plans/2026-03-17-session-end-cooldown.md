# Session-End Cooldown Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate fitness sessions caused by HR monitors left on after a session ends, by adding a configurable cooldown that persists across component remounts.

**Architecture:** The existing `FITNESS_TIMEOUTS` module-level object and `setFitnessTimeouts()`/`getFitnessTimeouts()` pattern is reused. A new `sessionEndCooldown` key (default 10 minutes) replaces the hardcoded 5-second debounce. The session-end timestamp is promoted from an instance property to a module-scope variable so it survives when the fitness screen unmounts and remounts.

**Tech Stack:** React (FitnessContext), vanilla JS (FitnessSession), YAML config

**Spec:** `docs/superpowers/specs/2026-03-17-session-end-cooldown-design.md`

---

## Chunk 1: Implementation

### Task 1: Add cooldown to FITNESS_TIMEOUTS and module-scope timestamp

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:27-32` (FITNESS_TIMEOUTS)
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:163-170` (setFitnessTimeouts/getFitnessTimeouts)

- [ ] **Step 1: Add module-scope timestamp and sessionEndCooldown to FITNESS_TIMEOUTS**

In `frontend/src/hooks/fitness/FitnessSession.js`, add a module-scope variable after the `FITNESS_TIMEOUTS` declaration (after line 32):

```js
// Module-scope: survives FitnessSession instance destruction on screen navigation
let _lastSessionEndTimestamp = 0;
```

Add `sessionEndCooldown` to `FITNESS_TIMEOUTS` (line 31):

```js
const FITNESS_TIMEOUTS = {
  inactive: 60000,
  remove: 1800000, // 30 minutes — keeps session alive during breaks
  rpmZero: 3000,
  emptySession: 60000, // 6A: Time (ms) with empty roster before auto-ending session
  sessionEndCooldown: 600000 // 10 minutes — prevents duplicate sessions from leftover HR data
};
```

- [ ] **Step 2: Add sessionEndCooldown to setFitnessTimeouts and getFitnessTimeouts**

In `setFitnessTimeouts` (line 163), add the new parameter:

```js
export const setFitnessTimeouts = ({ inactive, remove, rpmZero, emptySession, sessionEndCooldown } = {}) => {
  if (typeof inactive === 'number' && !Number.isNaN(inactive)) FITNESS_TIMEOUTS.inactive = inactive;
  if (typeof remove === 'number' && !Number.isNaN(remove)) FITNESS_TIMEOUTS.remove = remove;
  if (typeof rpmZero === 'number' && !Number.isNaN(rpmZero)) FITNESS_TIMEOUTS.rpmZero = rpmZero;
  if (typeof emptySession === 'number' && !Number.isNaN(emptySession)) FITNESS_TIMEOUTS.emptySession = emptySession;
  if (typeof sessionEndCooldown === 'number' && !Number.isNaN(sessionEndCooldown)) FITNESS_TIMEOUTS.sessionEndCooldown = sessionEndCooldown;
};
```

`getFitnessTimeouts` (line 170) already spreads `FITNESS_TIMEOUTS` — no change needed.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js
git commit -m "feat(fitness): add sessionEndCooldown to FITNESS_TIMEOUTS with module-scope timestamp"
```

### Task 2: Wire cooldown into session start/end logic

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:325-331` (constructor)
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:1061-1066` (_maybeStartSessionFromBuffer)
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:1835` (endSession)

- [ ] **Step 1: Remove instance-level debounce from constructor**

In the constructor (~line 325-331), remove these two lines:

```js
    this._lastSessionEndTime = 0;
    this._sessionEndDebounceMs = 5000;
```

Replace with a comment indicating the module-scope variable is used:

```js
    // Session-end cooldown uses module-scope _lastSessionEndTimestamp (survives remount)
```

- [ ] **Step 2: Update endSession() to write module-scope timestamp**

In `endSession()` (~line 1835), change:

```js
    this._lastSessionEndTime = Date.now();
```

to:

```js
    _lastSessionEndTimestamp = Date.now();
```

- [ ] **Step 3: Update _maybeStartSessionFromBuffer() to use configurable cooldown with logging**

In `_maybeStartSessionFromBuffer()` (~line 1062-1066), replace:

```js
    if (this.sessionId) return false;
    // Debounce: don't start a new session within 5s of the last one ending
    if (this._lastSessionEndTime && (timestamp - this._lastSessionEndTime) < this._sessionEndDebounceMs) {
      return false;
    }
```

with:

```js
    if (this.sessionId) return false;
    // Cooldown: don't auto-start a new session within the cooldown window after the last one ended
    const cooldownMs = FITNESS_TIMEOUTS.sessionEndCooldown;
    if (_lastSessionEndTimestamp && (timestamp - _lastSessionEndTimestamp) < cooldownMs) {
      if (!this._lastCooldownLogAt || (timestamp - this._lastCooldownLogAt) > 10000) {
        this._lastCooldownLogAt = timestamp;
        getLogger().debug('fitness.session.cooldown_active', {
          elapsedMs: timestamp - _lastSessionEndTimestamp,
          cooldownMs,
          remainingMs: cooldownMs - (timestamp - _lastSessionEndTimestamp)
        });
      }
      return false;
    }
```

Note: `getLogger` is already imported in this file.

- [ ] **Step 4: Add `_lastCooldownLogAt` to constructor**

In the constructor, alongside the other tracking variables (~line 329):

```js
    this._lastCooldownLogAt = 0;
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js
git commit -m "feat(fitness): use module-scope cooldown timestamp in session start/end"
```

### Task 3: Plumb config value from FitnessContext

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx:464-484` (config memo return)
- Modify: `frontend/src/context/FitnessContext.jsx:560-570` (configurationInputs memo)
- Modify: `frontend/src/context/FitnessContext.jsx:583-586` (config effect)

- [ ] **Step 1: Extract sessionsConfig from config root**

In the `useMemo` return block (~line 464), add after `governedTypes` (line 482):

```js
      governedTypes: normalizedGovernedTypes,
      sessionsConfig: root?.sessions || {}
```

Add `sessionsConfig` to the destructuring at the end of the list (~line 444, after `governedTypes`):

```js
    governedTypes,
    sessionsConfig,
```

- [ ] **Step 2: Add sessionsConfig to configurationInputs**

In the `configurationInputs` memo (~line 560), add `sessionsConfig`:

```js
  const configurationInputs = React.useMemo(() => ({
    ant_devices,
    usersConfig,
    zoneConfig,
    governanceConfig,
    coinTimeUnitMs,
    equipmentConfig,
    nomusicLabels,
    governedLabels,
    governedTypes,
    sessionsConfig
  }), [ant_devices, usersConfig, zoneConfig, governanceConfig, coinTimeUnitMs, equipmentConfig, nomusicLabels, governedLabels, governedTypes, sessionsConfig]);
```

- [ ] **Step 3: Pass cooldown to setFitnessTimeouts in config effect**

In the config effect (~line 583-586), change:

```js
    // Configure Timeouts
    const inactive = ant_devices?.timeout?.inactive;
    const remove = ant_devices?.timeout?.remove;
    setFitnessTimeouts({ inactive, remove });
```

to:

```js
    // Configure Timeouts
    const inactive = ant_devices?.timeout?.inactive;
    const remove = ant_devices?.timeout?.remove;
    const sessionEndCooldown = sessionsConfig?.session_end_cooldown_ms;
    setFitnessTimeouts({ inactive, remove, sessionEndCooldown });
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "feat(fitness): plumb session_end_cooldown_ms from config to timeout system"
```

### Task 4: Add config value to fitness.yml

**Files:**
- Modify: `data/system/config/fitness.yml` (sessions section, inside Docker volume)

- [ ] **Step 1: Add session_end_cooldown_ms to fitness.yml**

```bash
sudo docker exec daylight-station sh -c "cat data/system/config/fitness.yml" > /tmp/fitness-config-backup.yml
```

Edit the `sessions:` section to add the new key. The section should read:

```yaml
sessions:
  autosave_interval_ms: 30000
  session_end_cooldown_ms: 600000  # 10 minutes — prevents duplicate sessions from leftover HR data
  screenshots:
    enabled: true
    interval_ms: 60000
    max_per_session: 60
```

Read the full current file, add the line, and write the complete file back (never use `sed` on YAML in the container):

```bash
# Read current, add line, write complete file back
sudo docker exec daylight-station sh -c 'cat data/system/config/fitness.yml' > /tmp/fitness-config.yml
# Edit /tmp/fitness-config.yml to add session_end_cooldown_ms after autosave_interval_ms
# Then write back the complete file:
sudo docker cp /tmp/fitness-config.yml daylight-station:/usr/src/app/data/system/config/fitness.yml
```

Verify:

```bash
sudo docker exec daylight-station sh -c "grep -A5 'sessions:' data/system/config/fitness.yml"
```

Expected output should show both `autosave_interval_ms` and `session_end_cooldown_ms` under `sessions:`.

- [ ] **Step 2: Also update the local copy in the repo**

The file also exists at `data/system/config/fitness.yml` in the repo. Add the same line there.

- [ ] **Step 3: Commit**

```bash
git add data/system/config/fitness.yml
git commit -m "config(fitness): add session_end_cooldown_ms (10 min default)"
```

### Task 5: Manual verification

- [ ] **Step 1: Verify the dev server starts without errors**

```bash
# Check if dev server is running
lsof -i :3112
# If not running, start it and check logs for errors
```

- [ ] **Step 2: Verify cooldown works**

Open the fitness screen in a browser. With an HR monitor active, start a session, then end it. Refresh the page. Check browser console for `fitness.session.cooldown_active` debug log entries — these confirm the cooldown is blocking auto-start.

- [ ] **Step 3: Delete the duplicate session from today**

Check which of today's two sessions (`20260317115647` and `20260317115848`) is the duplicate (the one without voice memos) and delete it via the API if needed.
