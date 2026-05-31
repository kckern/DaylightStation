// frontend/src/modules/WeeklyReview/state/modalReducer.test.js
import { describe, it, expect } from 'vitest';
import { modalReducer, initialModalState, OVERLAY_PRIORITY } from './modalReducer.js';

describe('modalReducer', () => {
  it('starts closed', () => {
    expect(initialModalState).toEqual({ type: null, focusIndex: 0, payload: null });
  });

  it('OPEN sets type, resets focus, carries payload', () => {
    expect(modalReducer(initialModalState, { type: 'OPEN', modal: 'exitGate' }))
      .toEqual({ type: 'exitGate', focusIndex: 0, payload: null });
    expect(modalReducer(initialModalState, { type: 'OPEN', modal: 'resumeDraft', payload: { sessionId: 'x' } }).payload)
      .toEqual({ sessionId: 'x' });
  });

  it('a lower-priority OPEN cannot displace a higher-priority modal', () => {
    const failed = modalReducer(initialModalState, { type: 'OPEN', modal: 'preflightFailed' });
    expect(modalReducer(failed, { type: 'OPEN', modal: 'exitGate' })).toEqual(failed);
  });

  it('equal-priority OPEN replaces (disconnect phase transitions)', () => {
    const reconnecting = modalReducer(initialModalState, { type: 'OPEN', modal: 'disconnect', payload: { phase: 'reconnecting' } });
    const finalizing = modalReducer(reconnecting, { type: 'OPEN', modal: 'disconnect', payload: { phase: 'finalizing' } });
    expect(finalizing.payload).toEqual({ phase: 'finalizing' });
  });

  it('priority order: preflightFailed > disconnect > finalizeError > exitGate > resumeDraft', () => {
    expect(OVERLAY_PRIORITY.preflightFailed).toBeGreaterThan(OVERLAY_PRIORITY.disconnect);
    expect(OVERLAY_PRIORITY.disconnect).toBeGreaterThan(OVERLAY_PRIORITY.finalizeError);
    expect(OVERLAY_PRIORITY.finalizeError).toBeGreaterThan(OVERLAY_PRIORITY.exitGate);
    expect(OVERLAY_PRIORITY.exitGate).toBeGreaterThan(OVERLAY_PRIORITY.resumeDraft);
  });

  it('CLOSE resets; TOGGLE_FOCUS flips 0↔1', () => {
    const open = modalReducer(initialModalState, { type: 'OPEN', modal: 'exitGate' });
    expect(modalReducer(open, { type: 'CLOSE' })).toEqual(initialModalState);
    expect(modalReducer(open, { type: 'TOGGLE_FOCUS' }).focusIndex).toBe(1);
  });
});
