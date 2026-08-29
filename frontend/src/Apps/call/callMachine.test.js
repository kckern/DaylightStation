import { describe, expect, it } from 'vitest';
import { CALL_STATES, callReducer, initialCallState } from './callMachine.js';

describe('callReducer', () => {
  it('covers the complete successful state path', () => {
    let state = callReducer(initialCallState, { type: 'BOOT_READY' });
    state = callReducer(state, { type: 'START', attemptId: 'a1', target: { id: 'tv' } });
    state = callReducer(state, { type: 'RESERVED', attemptId: 'a1', session: { callId: 'c1', dispatchId: 'd1' } });
    state = callReducer(state, { type: 'TV_READY', attemptId: 'a1' });
    state = callReducer(state, { type: 'ANSWERED', attemptId: 'a1' });
    state = callReducer(state, { type: 'MEDIA_HEALTH', attemptId: 'a1', audio: true, video: true });
    expect(state).toMatchObject({ value: 'connected', callId: 'c1', attemptId: 'a1', media: { audio: true, video: true } });
  });

  it.each([
    [true, false, 'degraded'], [false, true, 'degraded'], [false, false, 'recovery_prompt'],
  ])('maps verified media audio=%s video=%s to %s', (audio, video, value) => {
    const state = { ...initialCallState, value: 'verifying_media', attemptId: 'a1' };
    expect(callReducer(state, { type: 'MEDIA_HEALTH', attemptId: 'a1', audio, video }).value).toBe(value);
  });

  it('rejects stale attempts and illegal transitions in every state', () => {
    for (const value of CALL_STATES) {
      const state = { ...initialCallState, value, attemptId: 'current' };
      expect(callReducer(state, { type: 'FAIL', attemptId: 'stale', error: 'late' })).toBe(state);
      expect(callReducer(state, { type: 'NOT_AN_EVENT', attemptId: 'current' })).toBe(state);
    }
  });

  it('permits one automatic soft recovery and then prompts', () => {
    let state = { ...initialCallState, value: 'waiting_tv', attemptId: 'a1', recoveryCount: 0 };
    state = callReducer(state, { type: 'WAIT_TIMEOUT', attemptId: 'a1' });
    expect(state).toMatchObject({ value: 'waking', recoveryCount: 1, reason: 'soft_recovery' });
    state = { ...state, value: 'waiting_tv' };
    expect(callReducer(state, { type: 'WAIT_TIMEOUT', attemptId: 'a1' }).value).toBe('recovery_prompt');
  });

  it('moves cancellation through ending and ended', () => {
    let state = { ...initialCallState, value: 'waking', attemptId: 'a1', callId: 'c1' };
    state = callReducer(state, { type: 'CANCEL', attemptId: 'a1', reason: 'user_cancelled' });
    expect(state.value).toBe('ending');
    state = callReducer(state, { type: 'ENDED', attemptId: 'a1' });
    expect(state).toMatchObject({ value: 'ended', attemptId: null, callId: null });
  });
});
