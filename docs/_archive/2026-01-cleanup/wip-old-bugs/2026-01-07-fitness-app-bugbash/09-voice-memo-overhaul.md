# Bug 09: Voice Memo Overhaul

**Severity:** Critical
**Area:** Voice/UI
**Status:** Open

## Summary

The voice memo feature has three distinct sub-issues requiring attention:
1. UI inconsistency between Fitness Player and Fitness Show recorder UIs
2. Critical infinite loop bug when saving memos
3. Audio meter visualization sensitivity issues

---

## Issue 9A: UI Inconsistency

### Problem
The Fitness Player recorder UI does not match the Fitness Show recorder UI. These must be unified.

### Current Components

**Fitness Player Recorder:**
- **File:** `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx`
- Three modes: `list`, `review`, `redo`
- Auto-accept countdown feature
- Full overlay with transcript preview

**Fitness Show Recorder (Standalone):**
- **File:** `frontend/src/modules/Fitness/FitnessSidebar/FitnessVoiceMemo.jsx`
- **File:** `frontend/src/modules/Fitness/FitnessVoiceMemoStandalone.jsx`
- Compact record button
- Status display (timer/saving)

**Unified Modal (newer):**
- **File:** `frontend/src/modules/Fitness/common/VoiceMemoModal/VoiceMemoModal.jsx`
- Recording view → Preview view flow
- Mic level bars + timer + stop button
- Auto-accept countdown

### Fix Direction

1. **Identify canonical UI:**
   - Determine which UI pattern is preferred
   - Likely `VoiceMemoModal.jsx` as it's marked "newer"

2. **Migrate both contexts to unified component:**
   - Both Player overlay and Sidebar use `VoiceMemoModal`
   - Remove duplicated UI code

3. **Shared state management:**
   - Use `FitnessContext` for overlay state in both contexts
   - Unified `openVoiceMemoReview`, `openVoiceMemoRedo` actions

---

## Issue 9B: Infinite Loop on Save (Critical)

### Problem
Saving a memo causes a "runaway loop," adding the entry to the registry repeatedly until an Out of Memory (OOM) crash occurs.

### Relevant Code

**Memo Manager:**
- **File:** `frontend/src/hooks/fitness/VoiceMemoManager.js`

| Method | Purpose |
|--------|---------|
| `addMemo(memo)` | Adds memo with auto-generated ID |
| `_notifyMutation()` | Triggers UI re-render via callback |

**Context Integration:**
- **File:** `frontend/src/context/FitnessContext.jsx`

| Function | Purpose |
|----------|---------|
| `addVoiceMemoToSession(memo)` | Adds memo and triggers logging |

### Likely Failure Points

1. **State update triggers re-add:**
   - `addMemo()` triggers `_notifyMutation()`
   - Notification triggers component re-render
   - Re-render triggers `addMemo()` again (via useEffect?)

2. **Missing guard in effect:**
   ```javascript
   // Buggy pattern
   useEffect(() => {
     addVoiceMemoToSession(memo); // Runs on every render
   }, [memo]); // memo reference changes each render
   ```

3. **Callback reference instability:**
   - `onMemoSaved` callback recreated each render
   - Effect dependency on unstable callback

### Fix Direction

1. **Add idempotency guard in `addMemo()`:**
   ```javascript
   addMemo(memo) {
     if (this.memos.some(m => m.id === memo.id)) return; // Already exists
     // ... proceed with add
   }
   ```

2. **Stabilize effect dependencies:**
   - Wrap callbacks in `useCallback`
   - Use ref for memo to avoid effect re-runs

3. **Add circuit breaker:**
   - Track add frequency in VoiceMemoManager
   - Warn/block if adds exceed threshold (e.g., 5/second)

---

## Issue 9C: Audio Meter Sensitivity

### Problem
The visualization is not sensitive enough - only bottom 2 bars light up for typical audio input levels.

### Relevant Code

**Audio Metering Hook:**
- **File:** `frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js`

| Function | Purpose |
|----------|---------|
| `startLevelMonitor()` | Sets up AudioContext and analyser |

**Current calculation:** Uses RMS (root mean square) on `getByteTimeDomainData()`
- Level sampling at ~14fps (70ms intervals)
- Linear mapping to 0-100 scale

**Meter Component:**
- **File:** `frontend/src/modules/Fitness/common/primitives/MicLevelIndicator/MicLevelIndicator.jsx`

| Prop | Purpose |
|------|---------|
| `level` | 0-100 normalized level |
| `bars` | Number of bar segments |

### Root Cause

Linear RMS values don't map well to perceived loudness. Human hearing is logarithmic, so quiet sounds cluster at the bottom of a linear scale.

### Fix Direction

**Implement logarithmic scaling:**

```javascript
// In useVoiceMemoRecorder.js
function linearToDb(rms) {
  if (rms === 0) return -Infinity;
  return 20 * Math.log10(rms);
}

function normalizeLevel(rms) {
  const db = linearToDb(rms);
  // Map typical speech range (-60dB to 0dB) to 0-100
  const minDb = -60;
  const maxDb = 0;
  const normalized = ((db - minDb) / (maxDb - minDb)) * 100;
  return Math.max(0, Math.min(100, normalized));
}
```

**Alternative: Use frequency-weighted analysis:**
- Use `getByteFrequencyData()` instead of time-domain
- Focus on speech frequency range (300Hz-3kHz)
- May provide more responsive meter

---

## File Reference Summary

| File | Role |
|------|------|
| `VoiceMemoOverlay.jsx` | Player overlay UI |
| `VoiceMemoModal.jsx` | Unified modal (newer) |
| `FitnessVoiceMemo.jsx` | Sidebar record button |
| `FitnessVoiceMemoStandalone.jsx` | Standalone compact recorder |
| `VoiceMemoManager.js` | Memo registry (bug site) |
| `useVoiceMemoRecorder.js` | Recording hook + metering |
| `MicLevelIndicator.jsx` | Visual meter component |
| `FitnessContext.jsx` | State management |

## Testing Approach

Runtime tests should:

**9A - UI Consistency:**
1. Compare Player overlay vs Sidebar recorder UI
2. Verify feature parity after unification

**9B - Infinite Loop:**
1. Save memo, monitor memo count
2. Verify only one memo added per save
3. Test rapid saves don't cause duplicates
4. Memory profile during save operation

**9C - Audio Meter:**
1. Test with various input volumes (whisper, normal, loud)
2. Verify meter uses full range for typical speech
3. Compare linear vs logarithmic scaling
4. Test meter responsiveness (no lag)


## Tips for simulating microphone input during testing
1. Wrap the AudioContext creation in a factory function that can be mocked.
2. Create a mock AudioContext that simulates varying audio levels programmatically.
3. Inject the mock AudioContext into the `useVoiceMemoRecorder` hook during tests.