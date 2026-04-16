// tests/isolated/domain/fitness/voice-memo-dismiss-routing.unit.test.mjs
import { describe, test, expect } from '@jest/globals';

/**
 * dismissAction: 'backdrop' | 'escape' | 'close_button' | 'discard_button'
 * recorderState: 'recording' | 'processing' | 'idle' | 'ready' | 'errored'
 * returns: 'stop_and_transcribe' | 'cancel_and_close'
 */
import { resolveDismissAction } from '../../../../frontend/src/modules/Fitness/player/overlays/voiceMemoOverlayUtils.js';

describe('Voice memo dismiss routing', () => {
  describe('backdrop tap', () => {
    test('stops and transcribes when recording is active', () => {
      expect(resolveDismissAction('backdrop', 'recording')).toBe('stop_and_transcribe');
    });

    test('cancels and closes when idle', () => {
      expect(resolveDismissAction('backdrop', 'idle')).toBe('cancel_and_close');
    });

    test('cancels and closes when ready', () => {
      expect(resolveDismissAction('backdrop', 'ready')).toBe('cancel_and_close');
    });

    test('waits (no action) when processing', () => {
      expect(resolveDismissAction('backdrop', 'processing')).toBe('cancel_and_close');
    });
  });

  describe('escape key', () => {
    test('stops and transcribes when recording is active', () => {
      expect(resolveDismissAction('escape', 'recording')).toBe('stop_and_transcribe');
    });

    test('cancels and closes when idle', () => {
      expect(resolveDismissAction('escape', 'idle')).toBe('cancel_and_close');
    });
  });

  describe('close button (X)', () => {
    test('always cancels — even when recording', () => {
      expect(resolveDismissAction('close_button', 'recording')).toBe('cancel_and_close');
    });

    test('cancels when idle', () => {
      expect(resolveDismissAction('close_button', 'idle')).toBe('cancel_and_close');
    });
  });

  describe('discard button', () => {
    test('always cancels — even when recording', () => {
      expect(resolveDismissAction('discard_button', 'recording')).toBe('cancel_and_close');
    });
  });
});
