import { describe, it, expect } from 'vitest';
import { modalReducer, initialModalState, OVERLAY_PRIORITY } from './modalReducer.js';

describe('modalReducer', () => {
  it('starts with no modal', () => {
    expect(initialModalState).toEqual({ type: null, focusIndex: 0, payload: null });
  });

  it('opens stop-confirm modal', () => {
    const next = modalReducer(initialModalState, { type: 'OPEN', modal: 'stopConfirm' });
    expect(next.type).toBe('stopConfirm');
    expect(next.focusIndex).toBe(0);
  });

  it('closes any modal back to null', () => {
    const open = { type: 'finalizeError', focusIndex: 1, payload: 'oops' };
    expect(modalReducer(open, { type: 'CLOSE' })).toEqual(initialModalState);
  });

  it('toggles focus index 0 ↔ 1', () => {
    const a = { type: 'stopConfirm', focusIndex: 0, payload: null };
    const b = modalReducer(a, { type: 'TOGGLE_FOCUS' });
    expect(b.focusIndex).toBe(1);
    const c = modalReducer(b, { type: 'TOGGLE_FOCUS' });
    expect(c.focusIndex).toBe(0);
  });

  it('refuses to open a lower-priority modal over a higher-priority one', () => {
    expect(OVERLAY_PRIORITY.preflightFailed).toBeGreaterThan(OVERLAY_PRIORITY.stopConfirm);
    const high = { type: 'preflightFailed', focusIndex: 0, payload: null };
    const next = modalReducer(high, { type: 'OPEN', modal: 'stopConfirm' });
    expect(next.type).toBe('preflightFailed');
  });

  it('allows higher-priority modal to replace lower-priority one', () => {
    const low = { type: 'stopConfirm', focusIndex: 0, payload: null };
    const next = modalReducer(low, { type: 'OPEN', modal: 'preflightFailed' });
    expect(next.type).toBe('preflightFailed');
  });

  it('OPEN with payload sets payload', () => {
    const next = modalReducer(initialModalState, {
      type: 'OPEN', modal: 'finalizeError', payload: 'network down',
    });
    expect(next.payload).toBe('network down');
  });
});
