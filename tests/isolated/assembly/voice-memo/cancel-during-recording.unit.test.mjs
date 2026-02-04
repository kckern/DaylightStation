/**
 * Voice Memo Cancel During Recording - Bug Reproduction Test
 *
 * BUG: Users report transcription menu appears AFTER pressing CANCEL on a recording.
 *
 * This test verifies the cancel flow when user cancels during ACTIVE RECORDING
 * (before processing/upload has started).
 *
 * Run with: npm run test:unit -- --testPathPattern=cancel-during-recording
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

/**
 * Simulates the cancel logic from handleClose in VoiceMemoOverlay.jsx
 * This is extracted to test the logic in isolation.
 */
function simulateHandleClose({
  isRecording,
  isProcessing,
  recorderState,
  cancelUpload,
  stopRecording,
  setRecorderState,
  onClose
}) {
  const wasRecording = isRecording;
  const wasProcessing = isProcessing || recorderState === 'processing';

  // Cancel any in-flight or pending recording
  if (wasRecording || wasProcessing) {
    cancelUpload?.();
  }

  // Stop recording if active
  if (wasRecording) {
    stopRecording();
  }

  // Force reset recorder state to idle
  setRecorderState('idle');

  onClose?.();
}

/**
 * Simulates the recorder hook's cancel flag and handlers
 */
function createMockRecorder() {
  const state = {
    cancelledRef: { current: false },
    chunksRef: { current: ['chunk1', 'chunk2'] },
    isRecording: true,
    uploading: false,
    onMemoCapturedCalled: false,
    memo: null
  };

  // Simulates cancelUpload from useVoiceMemoRecorder.js
  const cancelUpload = () => {
    state.cancelledRef.current = true;
    state.chunksRef.current = [];
    state.uploading = false;
  };

  // Simulates stopRecording - NOTE: does NOT set cancelledRef
  const stopRecording = () => {
    state.isRecording = false;
    // This triggers MediaRecorder.onstop which calls handleRecordingStop
    // Simulated synchronously for test purposes
    handleRecordingStop();
  };

  // Simulates handleRecordingStop from useVoiceMemoRecorder.js
  const handleRecordingStop = () => {
    // Guard: If already cancelled, discard chunks and exit
    if (state.cancelledRef.current) {
      state.chunksRef.current = [];
      state.cancelledRef.current = false;
      return;
    }

    if (!state.chunksRef.current.length) return;

    // Simulate successful transcription
    state.memo = { memoId: 'test-123', transcriptClean: 'Test memo' };
    state.onMemoCapturedCalled = true;
  };

  return {
    state,
    cancelUpload,
    stopRecording
  };
}

describe('Voice Memo Cancel During Recording', () => {
  describe('Bug Reproduction: Cancel while actively recording', () => {
    it('should NOT call onMemoCaptured when user cancels during recording', () => {
      const recorder = createMockRecorder();
      const setRecorderState = jest.fn();
      const onClose = jest.fn();

      // Scenario: User is RECORDING (not yet processing)
      const isRecording = true;
      const isProcessing = false;
      const recorderState = 'recording';

      simulateHandleClose({
        isRecording,
        isProcessing,
        recorderState,
        cancelUpload: recorder.cancelUpload,
        stopRecording: recorder.stopRecording,
        setRecorderState,
        onClose
      });

      // This is what SHOULD happen: memo capture should NOT be triggered
      expect(recorder.state.onMemoCapturedCalled).toBe(false);
      expect(recorder.state.memo).toBeNull();
    });

    it('should set cancelledRef BEFORE stopRecording triggers onstop', () => {
      const recorder = createMockRecorder();
      const stopRecordingCallOrder = [];

      // Track when cancelledRef is checked vs when it's set
      const trackedStopRecording = () => {
        stopRecordingCallOrder.push({
          action: 'stopRecording',
          cancelledRefAtCall: recorder.state.cancelledRef.current
        });
        recorder.stopRecording();
      };

      const trackedCancelUpload = () => {
        stopRecordingCallOrder.push({
          action: 'cancelUpload',
          cancelledRefAtCall: recorder.state.cancelledRef.current
        });
        recorder.cancelUpload();
      };

      // Scenario: User is RECORDING
      simulateHandleClose({
        isRecording: true,
        isProcessing: false,
        recorderState: 'recording',
        cancelUpload: trackedCancelUpload,
        stopRecording: trackedStopRecording,
        setRecorderState: jest.fn(),
        onClose: jest.fn()
      });

      // cancelUpload should be called BEFORE stopRecording
      // so that cancelledRef is true when onstop fires
      const cancelUploadCall = stopRecordingCallOrder.find(c => c.action === 'cancelUpload');
      const stopRecordingCall = stopRecordingCallOrder.find(c => c.action === 'stopRecording');

      // BUG: cancelUpload is NOT called when isProcessing=false
      // This test documents the expected behavior (should call cancelUpload)
      expect(cancelUploadCall).toBeDefined();
      expect(stopRecordingCall).toBeDefined();

      // cancelledRef should be true when stopRecording runs
      if (stopRecordingCall) {
        expect(stopRecordingCall.cancelledRefAtCall).toBe(true);
      }
    });
  });

  describe('Correct behavior: Cancel during processing', () => {
    it('should correctly cancel when already processing', () => {
      const recorder = createMockRecorder();
      recorder.state.isRecording = false;
      recorder.state.uploading = true;

      const setRecorderState = jest.fn();
      const onClose = jest.fn();

      // Scenario: Recording stopped, now PROCESSING (uploading)
      simulateHandleClose({
        isRecording: false,
        isProcessing: true,
        recorderState: 'processing',
        cancelUpload: recorder.cancelUpload,
        stopRecording: recorder.stopRecording,
        setRecorderState,
        onClose
      });

      // In this case, cancelUpload IS called, so it works correctly
      expect(recorder.state.cancelledRef.current).toBe(true);
      expect(recorder.state.onMemoCapturedCalled).toBe(false);
    });
  });
});
