# Bug 05: Challenge Trigger Failure on Governed Videos

**Severity:** High
**Area:** Logic
**Status:** Open

## Summary

Challenges are completely absent during governed videos. This is a regression in the gamification system.

## Symptoms

1. Challenges never appear during governed video playback
2. Challenge scheduling appears to be broken
3. No manual or automatic challenge triggers fire

## Relevant Code

### Challenge Lifecycle Management
**File:** `frontend/src/hooks/fitness/GovernanceEngine.js`

**Class:** `GovernanceEngine` (Line 137)

| Method | Lines | Purpose |
|--------|-------|---------|
| `_evaluateChallenges()` | 1087-1497 | Manages challenge lifecycle |
| `triggerChallenge(payload)` | 1500-1506 | Manual challenge trigger |
| `_pickIntervalMs(rangeSeconds)` | 1079-1085 | Random interval generation |
| `_schedulePulse(delayMs)` | 522-530 | Sets timer for next challenge |
| `_triggerPulse()` | 474-485 | Main pulse mechanism |

### Challenge State Structure
```javascript
this.challengeState = {
  activePolicyId: null,
  activePolicyName: null,
  selectionCursor: {},           // For cyclic selection
  activeChallenge: null,         // Current active challenge
  nextChallengeAt: null,         // Scheduled time
  nextChallengeRemainingMs: null,
  nextChallenge: null,           // Preview
  videoLocked: false,
  forceStartRequest: null,       // Manual trigger
  selectionRandomBag: {},
  challengeHistory: []
}
```

### Challenge Evaluation Chain
```
evaluate()
  └─ _evaluateChallenges()
       ├─ chooseSelectionPayload()
       ├─ queueNextChallenge(delayMs)
       │   └─ _schedulePulse(scheduledFor - now)
       │       └─ setTimeout(() => _triggerPulse(), delay)
       ├─ startChallenge()
       │   └─ _schedulePulse(expiresAt - startedAt)
       └─ buildChallengeSummary()
```

### Phase Integration
**Phase states (lines 870-921):**
- **pending:** Requirements not met → challenges blocked
- **unlocked:** Requirements satisfied → **challenges should proceed**
- **warning:** Grace period → challenges paused
- **locked:** Failed → challenges blocked

### Challenge Overlay
**File:** `frontend/src/modules/Fitness/FitnessPlayerOverlay/ChallengeOverlay.jsx`

| Function | Lines | Purpose |
|----------|-------|---------|
| `useChallengeMachine(challenge)` | 79-136 | State machine for display lifecycle |
| `useChallengeOverlays(governanceState, zones)` | 138-356 | Creates overlay objects |

**Challenge pause during warning (lines 224-228):**
- When `governanceState.status === 'warning'`: countdown freezes
- Progress snapshot captured at pause point

## Likely Failure Points

1. **Phase check blocking challenges:**
   - `_evaluateChallenges()` may have incorrect phase validation
   - Challenges only fire in specific phases

2. **Policy not loaded:**
   - `activePolicyId` may be null for governed videos
   - Challenge config not attached to governance policy

3. **Interval scheduling broken:**
   - `_schedulePulse()` timer may not be set
   - `nextChallengeAt` never populated

4. **Wiring to Single Source of Truth:**
   - Challenge trigger conditions disconnected from SSoT
   - Policy evaluation skipping challenge evaluation

5. **Selection mechanism failure:**
   - No valid challenge selections in policy config
   - Empty `challenges[]` array in policy

## Fix Direction

1. **Audit policy config:**
   - Verify governed videos have `challenges[]` defined
   - Check policy YAML structure

2. **Add challenge evaluation logging:**
   - Log entry to `_evaluateChallenges()`
   - Log challenge scheduling decisions
   - Track `nextChallengeAt` state

3. **Verify phase requirements:**
   - Ensure `unlocked` phase triggers challenge evaluation
   - Check phase transitions during governed playback

4. **Restore SSoT wiring:**
   - Trace data flow from policy → challenge selection
   - Verify `activePolicy.challenges` is populated

5. **Test manual trigger:**
   - Call `triggerChallenge()` directly
   - Verify manual path works to isolate scheduling vs execution

## Testing Approach

Runtime tests should:
1. Start governed video session
2. Verify challenge appears within expected interval
3. Test manual `triggerChallenge()` API
4. Verify challenge pauses during warning phase
5. Test challenge completion flow (success/failure)
6. Verify challenge history is populated


### Tip
We recently gutted governance dropdown from the FitnessSidebar, but it may have taken out too much.  The head of the governance UI should still be there.  Check git diff and recover any missing governance UI.  Only the 