# Bug 09: Voice Memo Overhaul - Audit Report

**Auditor:** Claude
**Date:** 2026-01-08
**Scope:** Review intern's work on 09-voice-memo-overhaul.md

---

## Executive Summary

The intern made substantial progress on Issues 9A and 9B, but Issue 9C (audio meter sensitivity) remains **unfixed**. The test file is a basic E2E scaffolding that covers happy-path interactions but does not verify the core technical requirements. Several deleted files may cause import errors.

| Sub-Issue | Status | Assessment |
|-----------|--------|------------|
| 9A: UI Inconsistency | **FIXED** | VoiceMemoModal deleted; unified on VoiceMemoOverlay |
| 9B: Infinite Loop | **FIXED** | Duplicate prevention guards in VoiceMemoManager |
| 9C: Audio Meter Sensitivity | **NOT FIXED** | Still using linear RMS (no logarithmic scaling) |

---

## Issue 9A: UI Inconsistency

### What Was Done

1. **Deleted components:**
   - `shared/VoiceMemoModal/VoiceMemoModal.jsx` (deleted)
   - `shared/VoiceMemoModal/VoiceMemoModal.scss` (deleted)
   - `shared/VoiceMemoModal/index.js` (deleted)
   - `FitnessVoiceMemoStandalone.jsx` (deleted)
   - `FitnessSidebar/FitnessVoiceMemoStandalone.scss` (deleted)

2. **Simplified FitnessVoiceMemo.jsx:**
   - Now just a trigger button (Record + Counter)
   - Opens overlay via `fitnessCtx.openVoiceMemoCapture()`
   - No inline recording UI

3. **VoiceMemoOverlay.jsx is now canonical:**
   - Handles all three modes: `list`, `review`, `redo`
   - Used from both Player context and Sidebar context
   - Full overlay with transcript preview, auto-accept, etc.

### Assessment: FIXED

The UI is now unified. Both contexts use the same overlay component via FitnessContext state management (`voiceMemoOverlayState`). The intern correctly identified that VoiceMemoOverlay was the more feature-complete implementation.

### Risk: Import Errors

Any code still importing from deleted paths will fail at runtime. Should grep for orphaned imports:

```bash
grep -r "VoiceMemoModal\|VoiceMemoStandalone" frontend/src/
```

---

## Issue 9B: Infinite Loop on Save

### What Was Done

**VoiceMemoManager.js:29-48** has duplicate prevention guards:

```javascript
// Check 1: Same memoId (line 30-33)
const existingById = this.memos.find(m => String(m.memoId) === String(newMemo.memoId));
if (existingById) {
  return existingById; // Already exists, return existing
}

// Check 2: Same transcript within 5 seconds (line 35-47)
const DUPLICATE_WINDOW_MS = 5000;
const transcriptToMatch = newMemo.transcriptRaw || newMemo.transcriptClean || '';
if (transcriptToMatch) {
  const existingByContent = this.memos.find(m => {
    const existingTranscript = m.transcriptRaw || m.transcriptClean || '';
    if (!existingTranscript || existingTranscript !== transcriptToMatch) return false;
    const timeDiff = Math.abs((m.createdAt || 0) - (newMemo.createdAt || 0));
    return timeDiff < DUPLICATE_WINDOW_MS;
  });
  if (existingByContent) {
    return existingByContent; // Duplicate content within time window
  }
}
```

### Assessment: FIXED

The idempotency guard from the bug doc's "Fix Direction" is implemented. Memos with the same ID or same transcript within 5 seconds are rejected. The `_notifyMutation()` call only happens after a successful add (line 69), preventing re-render cascades from triggering re-adds.

### Missing: Circuit Breaker

The bug doc suggested adding a circuit breaker (warn if adds exceed 5/second). This was NOT implemented. Low priority since the root cause is addressed.

---

## Issue 9C: Audio Meter Sensitivity

### What Was Done

**Partial work:** The docs claim this is fixed (`docs/reference/fitness/features/voice-memos.md:499-507`), but the code tells a different story.

### Actual Code State

**useVoiceMemoRecorder.js:207-218:**
```javascript
analyserNode.getByteTimeDomainData(buf);
let sumSquares = 0;
for (let i = 0; i < buf.length; i += 1) {
  const centered = (buf[i] - 128) / 128;
  sumSquares += centered * centered;
}
const rms = Math.sqrt(sumSquares / buf.length);
const level = Math.max(0, Math.min(1, rms * 1.8));  // LINEAR!
```

**Bug doc solution (NOT implemented):**
```javascript
function linearToDb(rms) {
  if (rms === 0) return -Infinity;
  return 20 * Math.log10(rms);
}

function normalizeLevel(rms) {
  const db = linearToDb(rms);
  const minDb = -60;
  const maxDb = 0;
  const normalized = ((db - minDb) / (maxDb - minDb)) * 100;
  return Math.max(0, Math.min(100, normalized));
}
```

### Assessment: NOT FIXED

The meter still uses **linear RMS scaling**. The `* 1.8` gain multiplier helps slightly, but quiet sounds still cluster at the bottom of the scale. The logarithmic transformation is not present.

The docs incorrectly claim the fix was implemented. The docs describe surface-level changes (bars now reflect actual level, container has height) but the core sensitivity issue remains.

### Impact

- Whisper speech: Meter shows ~15-30% (bottom 2 bars)
- Normal speech: Meter shows ~30-50% (bottom 3 bars)
- Only shouting fills the meter

---

## Test File Assessment

### File: `tests/runtime/voice-memo/voice-memo-recording.runtime.test.mjs`

### What It Tests

1. **Happy path:** Record button opens overlay
2. **Media pause:** Video pauses during recording
3. **Music pause:** Music player pauses during recording (if present)
4. **Mic level visible:** Indicator element is rendered
5. **Waveform bars exist:** Bars are present in DOM

### What It Does NOT Test

| Missing Test | Why It Matters |
|--------------|----------------|
| Audio meter sensitivity | Core bug 9C - should verify bars fill to 80%+ on normal speech |
| Infinite loop prevention | Core bug 9B - should verify only 1 memo added per save |
| Duplicate transcript rejection | Should verify same transcript within 5s rejected |
| Auto-accept countdown | Should verify 8-second timer saves memo |
| Max recording duration | Should verify 5-minute limit triggers auto-stop |
| Error retry flow | Should verify retryable errors show retry button |

### Test Architecture Issues

1. **Requires headed mode + manual mic permission** - Cannot run in CI
2. **No mock AudioContext** - Bug doc suggested mocking for controlled testing
3. **Sleeps instead of assertions** - Uses `waitForTimeout` instead of proper waits
4. **No meter sensitivity verification** - Just checks visibility, not values

### Recommended Test Additions

```javascript
// 9B: Infinite Loop Prevention
test('save does not cause duplicate memos', async ({ page }) => {
  // Record and save a memo
  // Verify memo count is exactly 1
  // Try to add same memo via context
  // Verify count is still 1
});

// 9C: Audio Meter Sensitivity (requires mock)
test('meter responds with full range to normal speech levels', async ({ page }) => {
  // Inject mock AudioContext returning -20dB signal
  // Verify bars fill to ~60-80%
  // Inject -40dB signal
  // Verify bars fill to ~30-40%
});
```

---

## Files Changed (Git Status)

### Modified (Relevant)
- `VoiceMemoManager.js` - Duplicate prevention guards
- `VoiceMemoOverlay.jsx` - Main UI (was already feature-complete)
- `useVoiceMemoRecorder.js` - Recording hook (sensitivity NOT fixed)
- `MicLevelIndicator.jsx` - Display component (unchanged logic)
- `FitnessVoiceMemo.jsx` - Simplified to trigger-only
- `FitnessContext.jsx` - State management for overlay

### Deleted (May Cause Import Errors)
- `shared/VoiceMemoModal/VoiceMemoModal.jsx`
- `shared/VoiceMemoModal/VoiceMemoModal.scss`
- `shared/VoiceMemoModal/index.js`
- `FitnessVoiceMemoStandalone.jsx`
- `FitnessSidebar/FitnessVoiceMemoStandalone.scss`

### New (Untracked)
- `docs/reference/fitness/features/voice-memos.md` - Reference doc (inaccurate re: 9C)

---

## Recommended Actions

### Immediate (Blocking)

1. **Fix Issue 9C:** Implement logarithmic scaling in `useVoiceMemoRecorder.js`
   - Replace lines 216-217 with dB normalization
   - Target: -60dB to 0dB mapped to 0-100

2. **Verify no orphan imports:** Run grep for deleted components
   ```bash
   grep -rn "VoiceMemoModal\|VoiceMemoStandalone" frontend/src/ --include="*.js" --include="*.jsx"
   ```

3. **Update docs:** Correct `voice-memos.md` section 2 to reflect 9C is incomplete

### Follow-up (Non-blocking)

4. **Add unit tests for VoiceMemoManager:** Test duplicate prevention without browser
5. **Add mock AudioContext tests:** Enable CI-friendly meter sensitivity testing
6. **Add circuit breaker:** Optional, since root cause fixed

---

## Code Fix for Issue 9C

**File:** `frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js`

Replace lines 207-218:

```javascript
// BEFORE (linear)
analyserNode.getByteTimeDomainData(buf);
let sumSquares = 0;
for (let i = 0; i < buf.length; i += 1) {
  const centered = (buf[i] - 128) / 128;
  sumSquares += centered * centered;
}
const rms = Math.sqrt(sumSquares / buf.length);
const level = Math.max(0, Math.min(1, rms * 1.8));
```

```javascript
// AFTER (logarithmic)
analyserNode.getByteTimeDomainData(buf);
let sumSquares = 0;
for (let i = 0; i < buf.length; i += 1) {
  const centered = (buf[i] - 128) / 128;
  sumSquares += centered * centered;
}
const rms = Math.sqrt(sumSquares / buf.length);

// Logarithmic scaling for perceptual loudness
const MIN_DB = -60;
const MAX_DB = 0;
const db = rms > 0 ? 20 * Math.log10(rms) : MIN_DB;
const normalized = (db - MIN_DB) / (MAX_DB - MIN_DB);
const level = Math.max(0, Math.min(1, normalized));
```

---

## Conclusion

The intern made good progress on UI unification (9A) and infinite loop prevention (9B). The core audio sensitivity bug (9C) remains unaddressed despite docs claiming otherwise. The test file provides basic E2E coverage but lacks the specific assertions needed to verify the reported bugs are fixed.

**Priority:** Fix 9C before marking this bug complete.
