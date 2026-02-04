# Voice Memo Cancel Bug Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix bug where transcription menu appears after user presses CANCEL during voice recording.

**Architecture:** The fix changes one conditional in `handleClose` to call `cancelUpload()` when user is recording OR processing, ensuring `cancelledRef.current` is set before `stopRecording()` triggers the MediaRecorder's `onstop` event.

**Tech Stack:** React, Jest

---

## Background

**Bug:** Users report transcription menu appears AFTER pressing CANCEL on a recording.

**Root Cause:** In `VoiceMemoOverlay.jsx:handleClose`, `cancelUpload()` is only called when `wasProcessing=true`. When user cancels during active recording (`wasRecording=true`, `wasProcessing=false`), `cancelUpload()` is skipped, so `cancelledRef.current` stays `false`. When `stopRecording()` triggers `MediaRecorder.onstop`, the handler sees `cancelledRef=false` and proceeds to upload/transcribe.

**Evidence:** Failing tests in `tests/isolated/assembly/voice-memo/cancel-during-recording.unit.test.mjs` confirm this behavior.

---

### Task 1: Verify Failing Tests Exist

**Files:**
- Read: `tests/isolated/assembly/voice-memo/cancel-during-recording.unit.test.mjs`

**Step 1: Run existing failing tests**

Run:
```bash
npx jest tests/isolated/assembly/voice-memo/cancel-during-recording.unit.test.mjs --no-coverage
```

Expected output:
```
FAIL tests/isolated/assembly/voice-memo/cancel-during-recording.unit.test.mjs
  Voice Memo Cancel During Recording
    Bug Reproduction: Cancel while actively recording
      ✕ should NOT call onMemoCaptured when user cancels during recording
      ✕ should set cancelledRef BEFORE stopRecording triggers onstop
    Correct behavior: Cancel during processing
      ✓ should correctly cancel when already processing

Tests:       2 failed, 1 passed, 3 total
```

**Step 2: Confirm tests document expected behavior**

The tests assert:
1. When cancelling during recording, `onMemoCapturedCalled` should be `false`
2. `cancelUpload()` should be called before `stopRecording()`

---

### Task 2: Fix the Bug in VoiceMemoOverlay.jsx

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx:289-292`

**Step 1: Read current implementation**

Current code at lines 289-292:
```javascript
// Cancel any in-flight upload first
if (wasProcessing) {
  cancelUpload?.();
}
```

**Step 2: Apply the fix**

Change the condition to call `cancelUpload()` when EITHER recording OR processing:

```javascript
// Cancel any in-flight or pending recording
if (wasRecording || wasProcessing) {
  cancelUpload?.();
}
```

**Step 3: Update the misleading comment**

The comment at lines 294-295 is now correct, but update for clarity:

Before:
```javascript
// Stop recording if active (this will NOT trigger handleRecordingStop
// because cancelledRef is now set)
```

After:
```javascript
// Stop recording if active - cancelledRef was set above, so
// handleRecordingStop will discard chunks instead of processing
```

---

### Task 3: Run Tests to Verify Fix

**Files:**
- Test: `tests/isolated/assembly/voice-memo/cancel-during-recording.unit.test.mjs`

**Step 1: Run the cancel-during-recording tests**

Run:
```bash
npx jest tests/isolated/assembly/voice-memo/cancel-during-recording.unit.test.mjs --no-coverage
```

Expected output:
```
PASS tests/isolated/assembly/voice-memo/cancel-during-recording.unit.test.mjs
  Voice Memo Cancel During Recording
    Bug Reproduction: Cancel while actively recording
      ✓ should NOT call onMemoCaptured when user cancels during recording
      ✓ should set cancelledRef BEFORE stopRecording triggers onstop
    Correct behavior: Cancel during processing
      ✓ should correctly cancel when already processing

Tests:       3 passed, 3 total
```

**Step 2: Run related voice memo tests**

Run:
```bash
npx jest tests/isolated/assembly/voice-memo/ --no-coverage
```

Expected: All tests pass

---

### Task 4: Run Full Test Suite

**Files:**
- None (verification only)

**Step 1: Run isolated tests**

Run:
```bash
npx jest tests/isolated/ --no-coverage
```

Expected: No regressions

**Step 2: Run fitness domain tests if available**

Run:
```bash
npm run test:fitness 2>/dev/null || echo "No fitness test script"
```

---

### Task 5: Commit the Fix

**Files:**
- Commit: `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx`

**Step 1: Stage the changes**

Run:
```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx
```

**Step 2: Commit with descriptive message**

Run:
```bash
git commit -m "$(cat <<'EOF'
fix(voice-memo): cancel recording before stopRecording triggers onstop

BUG: Users reported transcription menu appearing after pressing CANCEL.

ROOT CAUSE: handleClose only called cancelUpload() when wasProcessing=true.
When cancelling during active recording (wasRecording=true, wasProcessing=false),
cancelledRef stayed false, so handleRecordingStop proceeded to upload.

FIX: Call cancelUpload() when wasRecording OR wasProcessing, ensuring
cancelledRef.current=true before stopRecording() triggers onstop.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Update Documentation

**Files:**
- Modify: `docs/reference/fitness/voice-memo.md`

**Step 1: Add cancellation behavior to Special Behaviors section**

Add after "Max Recording Duration" section:

```markdown
### Cancel During Recording
When user cancels during active recording, `cancelUpload()` is called BEFORE `stopRecording()` to set `cancelledRef.current = true`. This ensures the MediaRecorder's `onstop` handler discards audio chunks instead of uploading them for transcription.
```

**Step 2: Commit documentation update**

Run:
```bash
git add docs/reference/fitness/voice-memo.md
git commit -m "$(cat <<'EOF'
docs(voice-memo): document cancel-during-recording behavior

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Verification Checklist

- [ ] Failing tests exist and fail for the right reason
- [ ] Fix applied to VoiceMemoOverlay.jsx
- [ ] All cancel-during-recording tests pass
- [ ] No regressions in voice memo tests
- [ ] Changes committed with descriptive message
- [ ] Documentation updated
