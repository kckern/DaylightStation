# Fitness Session Restart Fix: Implementation Plan & Design

**Date:** December 27, 2025

## Objective

Robustly fix the session restart bug by ensuring all stateful modules (`UserManager`, `DeviceManager`, `ParticipantRoster`, etc.) are properly reconfigured after a session reset, preventing stale references and broken user/device mappings.

---

## Approach

Implement a combination of:
- **Solution 2:** Force the configuration effect in `FitnessContext.jsx` to re-run by including the session's unique `sessionId` in the configuration signature.
- **Solution 3:** Update `ParticipantRoster.reset()` to clear all external references, ensuring it cannot operate with stale managers after a session reset.

---

## Implementation Plan

### 1. Update `ParticipantRoster.reset()`

- **Goal:** Ensure that after a session reset, the `ParticipantRoster` cannot use old references to `DeviceManager`, `UserManager`, etc.
- **Steps:**
  - In `ParticipantRoster.js`, modify the `reset()` method to set all external references (`_deviceManager`, `_userManager`, `_treasureBox`, `_activityMonitor`, `_timeline`) to `null`.
  - This forces a call to `configure()` before the roster can be used again.

#### Example:
```js
reset() {
  this._historicalParticipants.clear();
  this._invalidateCache();
  this._deviceManager = null;
  this._userManager = null;
  this._treasureBox = null;
  this._activityMonitor = null;
  this._timeline = null;
}
```

### 2. Include `sessionId` in Configuration Signature

- **Goal:** Ensure the configuration effect in `FitnessContext.jsx` re-runs after every session reset/start.
- **Steps:**
  - In `FitnessContext.jsx`, update the `configurationSignature` calculation to include the current session's `sessionId` (or a version counter).
  - This will cause the effect to re-run and reconfigure all managers and modules after a session reset.

#### Example:
```js
const configurationSignature = React.useMemo(() =>
  JSON.stringify({
    ...configurationInputs,
    sessionId: session?.sessionId || 'none',
  }),
  [configurationInputs, session?.sessionId]
);
```

### 3. Test and Validate

- **Manual Testing:**
  - Start a session, let it end (empty roster or inactivity), then start a new session.
  - Verify that user/device mappings, zones, and avatars are correct without a hard refresh.
  - Test multiple session start/end cycles and WebSocket reconnects.
- **Automated Testing:**
  - Add tests to simulate session resets and verify correct reconfiguration.

### 4. (Optional) Add Debug Logging

- Add debug logs in `reset()`, `configure()`, and the configuration effect to trace when reconfiguration occurs and what references are set.

---

## Design Considerations

- **Backward Compatibility:**
  - The changes are additive and do not break existing interfaces.
  - Legacy fallback logic in `FitnessSession.roster` remains as a safety net.
- **Performance:**
  - The configuration effect will only re-run on actual session transitions, not on every render.
- **Robustness:**
  - Clearing references in `ParticipantRoster` ensures no accidental use of stale managers.
  - Including `sessionId` in the signature guarantees reconfiguration after every session reset.

---

## Summary

This plan ensures that after a session reset, all stateful modules are reconfigured with fresh references and configuration, eliminating the stale state bug. The approach is robust, minimally invasive, and easy to test and validate.
