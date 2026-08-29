import { describe, expect, it } from 'vitest';
import { ALLOWED_CALL_EVENTS, CALL_EVENTS, CALL_STATES, callReducer, initialCallState } from './callMachine.js';

describe('callReducer', () => {
  const allowedTargets = {
    booting: { BOOT_READY: 'idle', BOOT_FAILED: 'failed' },
    idle: { START: 'reserving', RESUME: 'reserving' },
    reserving: { RESERVED: 'probing', BUSY: 'occupied', FAIL: 'failed', CANCEL: 'ending' },
    probing: { TV_READY: 'negotiating', PROBE_TIMEOUT: 'waking', CANCEL: 'ending' },
    waking: { WAKE_OK: 'waiting_tv', WAKE_FAILED: 'waking', RECOVERY_EXHAUSTED: 'recovery_prompt', FAIL: 'failed', CANCEL: 'ending' },
    waiting_tv: { TV_READY: 'negotiating', WAIT_TIMEOUT: 'waking', FAIL: 'failed', CANCEL: 'ending' },
    negotiating: { ANSWERED: 'verifying_media', ICE_INTERRUPTED: 'reconnecting', FAIL: 'failed', CANCEL: 'ending' },
    verifying_media: { MEDIA_HEALTH: 'connected', ICE_INTERRUPTED: 'reconnecting', FAIL: 'failed', CANCEL: 'ending' },
    connected: { MEDIA_HEALTH: 'connected', ICE_INTERRUPTED: 'reconnecting', CONTROL_STATUS: 'connected', CANCEL: 'ending' },
    degraded: { MEDIA_HEALTH: 'connected', ICE_INTERRUPTED: 'reconnecting', RETRY_MEDIA: 'reconnecting', CONTROL_STATUS: 'degraded', CANCEL: 'ending' },
    reconnecting: { MEDIA_HEALTH: 'connected', PEER_REVISION: 'reconnecting', RECOVERY_EXHAUSTED: 'recovery_prompt', FAIL: 'failed', CANCEL: 'ending' },
    recovery_prompt: { SOFT_RECOVERY: 'waking', HARD_RECOVERY: 'waking', RETRY_CALL: 'idle', CANCEL: 'ending' },
    occupied: { DISMISS: 'idle', RETRY_CALL: 'idle' }, ending: { ENDED: 'ended' },
    ended: { START: 'reserving' }, failed: { RETRY_CALL: 'idle', DISMISS: 'idle' },
  };
  const eventFor = type => ({
    type,
    attemptId: 'current',
    target: { id: 'tv' },
    callId: 'call-1',
    error: 'expected',
    connected: false,
    audio: true,
    video: true,
    session: { callId: 'call-1', attemptId: 'current', dispatchId: 'dispatch-1' },
    peerRevision: 1,
  });

  it('covers every legal state/event transition in the explicit table', () => {
    for (const [value, transitions] of Object.entries(allowedTargets)) {
      expect(Object.keys(transitions).sort(), `${value} table drift`).toEqual([...ALLOWED_CALL_EVENTS[value]].sort());
      for (const [type, target] of Object.entries(transitions)) {
        const state = { ...initialCallState, value, attemptId: value === 'booting' || value === 'idle' ? null : 'current',
          target: { id: 'tv' }, recoveryCount: 0, hardRecoveryUsed: false };
        expect(callReducer(state, eventFor(type)).value, `${value} + ${type}`).toBe(target);
      }
    }
  });

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
      for (const type of CALL_EVENTS) {
        if (!ALLOWED_CALL_EVENTS[value].includes(type)) {
          expect(callReducer(state, { type, attemptId: 'current' }), `${value} must reject ${type}`).toBe(state);
        }
      }
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

  it('never exceeds its soft or hard recovery budgets', () => {
    const exhaustedSoft = { ...initialCallState, value: 'recovery_prompt', attemptId: 'a1', recoveryCount: 1 };
    expect(callReducer(exhaustedSoft, { type: 'SOFT_RECOVERY', attemptId: 'a1' })).toBe(exhaustedSoft);
    const exhaustedHard = { ...exhaustedSoft, hardRecoveryUsed: true };
    expect(callReducer(exhaustedHard, { type: 'HARD_RECOVERY', attemptId: 'a1' })).toBe(exhaustedHard);
  });
});
