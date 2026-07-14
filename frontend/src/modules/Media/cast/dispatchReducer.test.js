import { describe, it, expect } from 'vitest';
import { reduceDispatch, initialDispatchState } from './dispatchReducer.js';

describe('dispatchReducer', () => {
  it('INITIATED creates a new entry in running state', () => {
    const next = reduceDispatch(initialDispatchState, {
      type: 'INITIATED', dispatchId: 'd1', deviceId: 'lr', contentId: 'plex:1', mode: 'transfer',
    });
    const entry = next.byId.get('d1');
    expect(entry.deviceId).toBe('lr');
    expect(entry.contentId).toBe('plex:1');
    expect(entry.mode).toBe('transfer');
    expect(entry.status).toBe('running');
    expect(entry.steps).toEqual([]);
  });

  it('STEP appends to the entry.steps array', () => {
    let state = reduceDispatch(initialDispatchState, {
      type: 'INITIATED', dispatchId: 'd1', deviceId: 'lr', contentId: 'plex:1', mode: 'transfer',
    });
    state = reduceDispatch(state, {
      type: 'STEP', dispatchId: 'd1', step: 'power', status: 'running', elapsedMs: 100,
    });
    state = reduceDispatch(state, {
      type: 'STEP', dispatchId: 'd1', step: 'power', status: 'success', elapsedMs: 500,
    });
    expect(state.byId.get('d1').steps).toHaveLength(2);
    expect(state.byId.get('d1').steps[1].status).toBe('success');
  });

  it('SUCCEEDED sets status=success', () => {
    let state = reduceDispatch(initialDispatchState, {
      type: 'INITIATED', dispatchId: 'd1', deviceId: 'lr', contentId: 'plex:1', mode: 'transfer',
    });
    state = reduceDispatch(state, { type: 'SUCCEEDED', dispatchId: 'd1', totalElapsedMs: 2400 });
    expect(state.byId.get('d1').status).toBe('success');
    expect(state.byId.get('d1').totalElapsedMs).toBe(2400);
  });

  it('FAILED sets status=failed + records error/failedStep', () => {
    let state = reduceDispatch(initialDispatchState, {
      type: 'INITIATED', dispatchId: 'd1', deviceId: 'lr', contentId: 'plex:1', mode: 'transfer',
    });
    state = reduceDispatch(state, {
      type: 'FAILED', dispatchId: 'd1', error: 'WAKE_FAILED', failedStep: 'power',
    });
    expect(state.byId.get('d1').status).toBe('failed');
    expect(state.byId.get('d1').error).toBe('WAKE_FAILED');
    expect(state.byId.get('d1').failedStep).toBe('power');
  });

  it('REMOVED drops the entry', () => {
    let state = reduceDispatch(initialDispatchState, {
      type: 'INITIATED', dispatchId: 'd1', deviceId: 'lr', contentId: 'plex:1', mode: 'transfer',
    });
    state = reduceDispatch(state, { type: 'REMOVED', dispatchId: 'd1' });
    expect(state.byId.has('d1')).toBe(false);
  });

  it('unknown action returns prior state reference', () => {
    const s = reduceDispatch(initialDispatchState, { type: 'NOPE' });
    expect(s).toBe(initialDispatchState);
  });

  it('STEP / SUCCEEDED / FAILED with unknown dispatchId are no-ops', () => {
    const s = reduceDispatch(initialDispatchState, {
      type: 'STEP', dispatchId: 'ghost', step: 'power', status: 'running', elapsedMs: 0,
    });
    expect(s).toBe(initialDispatchState);
  });

  it('INITIATED carries the human content title (null when absent)', () => {
    let state = reduceDispatch(initialDispatchState, {
      type: 'INITIATED', dispatchId: 'd1', deviceId: 'lr', contentId: 'plex:1', title: 'Bluey', mode: 'transfer',
    });
    expect(state.byId.get('d1').title).toBe('Bluey');
    state = reduceDispatch(state, {
      type: 'INITIATED', dispatchId: 'd2', deviceId: 'lr', contentId: 'plex:2', mode: 'transfer',
    });
    expect(state.byId.get('d2').title).toBeNull();
  });

  it('a late playback STEP after SUCCEEDED records the resolution (the watchdog can reach the UI)', () => {
    let state = reduceDispatch(initialDispatchState, {
      type: 'INITIATED', dispatchId: 'd1', deviceId: 'lr', contentId: 'plex:59493', mode: 'transfer',
    });
    state = reduceDispatch(state, { type: 'SUCCEEDED', dispatchId: 'd1', totalElapsedMs: 18087 });
    expect(state.byId.get('d1').playback).toBeNull();

    // 90s later, the backend watchdog resolves — the entry must still exist
    // and record the outcome.
    state = reduceDispatch(state, {
      type: 'STEP', dispatchId: 'd1', step: 'playback', status: 'confirmed', elapsedMs: 90000,
    });
    expect(state.byId.get('d1').status).toBe('success');
    expect(state.byId.get('d1').playback).toBe('confirmed');
  });

  it('playback timeout resolution is recorded as timeout', () => {
    let state = reduceDispatch(initialDispatchState, {
      type: 'INITIATED', dispatchId: 'd1', deviceId: 'lr', contentId: 'plex:59493', mode: 'transfer',
    });
    state = reduceDispatch(state, { type: 'SUCCEEDED', dispatchId: 'd1', totalElapsedMs: 100 });
    state = reduceDispatch(state, {
      type: 'STEP', dispatchId: 'd1', step: 'playback', status: 'timeout', elapsedMs: 90000,
    });
    expect(state.byId.get('d1').playback).toBe('timeout');
  });

  it('non-playback steps never set a playback resolution', () => {
    let state = reduceDispatch(initialDispatchState, {
      type: 'INITIATED', dispatchId: 'd1', deviceId: 'lr', contentId: 'plex:1', mode: 'transfer',
    });
    state = reduceDispatch(state, {
      type: 'STEP', dispatchId: 'd1', step: 'power', status: 'done', elapsedMs: 5,
    });
    expect(state.byId.get('d1').playback).toBeNull();
  });
});
