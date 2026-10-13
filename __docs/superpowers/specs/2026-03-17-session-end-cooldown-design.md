# Session-End Cooldown — Design Spec

**Date:** 2026-03-17
**Problem:** When an HR monitor is left on after a fitness session ends, re-entering the fitness screen triggers a duplicate session within seconds. The current 5-second debounce is too short — BLE HR monitors broadcast every ~1 second, so the pre-session buffer (3 samples) fills immediately after the debounce expires. Worse, the debounce timestamp (`_lastSessionEndTime`) is an instance property on `FitnessSession` — it is lost entirely when the user navigates away, since the component unmounts and the instance is destroyed.

**Real-world usage pattern:** Back-to-back sessions never happen sooner than ~30 minutes apart, so a 10-minute cooldown has zero false-positive risk.

## Solution

Add a configurable `session_end_cooldown_ms` value that replaces the hardcoded 5-second `_sessionEndDebounceMs`. After a session ends, HR data cannot auto-start a new session until the cooldown expires. The cooldown timestamp is stored at **module scope** so it survives component remounts.

This reuses the existing debounce check in `_maybeStartSessionFromBuffer()` (line 1064) — no new mechanism, just a longer configurable value and a persistent timestamp.

Manual session starts (e.g., explicit calls to `ensureStarted()`) are unaffected — the cooldown only gates auto-start via the pre-session buffer.

## Changes

### 1. Config — `data/system/config/fitness.yml`

Add `session_end_cooldown_ms` under the existing `sessions:` section:

```yaml
sessions:
  autosave_interval_ms: 30000
  session_end_cooldown_ms: 600000  # 10 minutes — prevents duplicate sessions from leftover HR data
```

### 2. Plumbing — `frontend/src/context/FitnessContext.jsx`

Extract `sessionsConfig` from the config root in the existing `useMemo` block (~line 464):

```js
sessionsConfig: root?.sessions || {},
```

Add `sessionsConfig` to the `configurationInputs` memo (~line 561) so the config effect re-fires when it changes.

In the config effect (~line 586), read the cooldown and pass it to `setFitnessTimeouts()`:

```js
const sessionEndCooldown = sessionsConfig?.session_end_cooldown_ms;
setFitnessTimeouts({ inactive, remove, sessionEndCooldown });
```

### 3. Logic — `frontend/src/hooks/fitness/FitnessSession.js`

**Module-scope timestamp** (survives component remount):
```js
let _lastSessionEndTimestamp = 0;
```

**FITNESS_TIMEOUTS:** Add `sessionEndCooldown: 600000` (default 10 minutes).

**setFitnessTimeouts / getFitnessTimeouts:** Add `sessionEndCooldown` to both, following the existing pattern.

**Constructor:** Remove the hardcoded `_sessionEndDebounceMs = 5000`. Instead, read from the module-scope timestamp and `FITNESS_TIMEOUTS.sessionEndCooldown`.

**endSession():** Write to the module-scope timestamp instead of `this._lastSessionEndTime`:
```js
_lastSessionEndTimestamp = Date.now();
```

**_maybeStartSessionFromBuffer():** Use module-scope timestamp and configurable cooldown:
```js
const cooldownMs = FITNESS_TIMEOUTS.sessionEndCooldown;
if (_lastSessionEndTimestamp && (timestamp - _lastSessionEndTimestamp) < cooldownMs) {
  logger.debug('fitness.session.cooldown_active', {
    elapsed: timestamp - _lastSessionEndTimestamp,
    cooldownMs,
    remainingMs: cooldownMs - (timestamp - _lastSessionEndTimestamp)
  });
  return false;
}
```

The debug log follows the project's logging mandate ("New Features Must Ship With Logging") and aids debugging if a session unexpectedly fails to start.

## Files Touched

| File | Change |
|------|--------|
| `data/system/config/fitness.yml` | Add `session_end_cooldown_ms: 600000` under `sessions:` |
| `frontend/src/context/FitnessContext.jsx` | Extract `sessionsConfig`, pass cooldown to `setFitnessTimeouts()` |
| `frontend/src/hooks/fitness/FitnessSession.js` | Module-scope timestamp, add `sessionEndCooldown` to timeout system, throttled debug log |
