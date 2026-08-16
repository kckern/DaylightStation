/**
 * Reading dash.js state at subscribe time — Task 4.5.
 *
 * The behaviour under test is the one that cost the 2026-08-16 investigation a
 * wrong conclusion: our logs showed no `dash.manifest-loaded`, and that was read
 * as "the manifest never loaded" when in fact it had loaded before we subscribed.
 * A state read makes the two cases separable, but only if a null in the payload
 * always says which kind of null it is — otherwise the fix reproduces the defect
 * in a new place.
 */
import { describe, it, expect } from 'vitest';
import { readDashApiState } from './dashApiState.js';

/** A dash.js player mid-playback, with every accessor answering. */
const healthyApi = (overrides = {}) => ({
  isReady: () => true,
  getActiveStream: () => ({ getId: () => 'stream-0' }),
  time: () => 42.5,
  duration: () => 3600,
  getSource: () => 'https://plex.test/video/:/transcode/start.mpd?offset=42',
  ...overrides
});

describe('readDashApiState — the healthy case', () => {
  it('reports the state that proves a manifest loaded even with no events seen', () => {
    const { state, unreadable } = readDashApiState(healthyApi());

    expect(state.isReady).toBe(true);
    expect(state.activeStreamId).toBe('stream-0');
    expect(state.time).toBe(42.5);
    expect(state.duration).toBe(3600);
    expect(state.source).toContain('start.mpd');
    // Nothing named here means every field above is a measurement.
    expect(unreadable).toEqual({});
  });

  it('coerces isReady to a boolean rather than leaking dash.js truthiness', () => {
    const { state } = readDashApiState(healthyApi({ isReady: () => 1 }));
    expect(state.isReady).toBe(true);
  });

  it('truncates a long source so a signed url cannot dominate the payload', () => {
    const long = `https://plex.test/${'x'.repeat(500)}.mpd`;
    const { state, unreadable } = readDashApiState(healthyApi({ getSource: () => long }));
    expect(state.source).toHaveLength(150);
    expect(unreadable.source).toBeUndefined();
  });
});

describe('readDashApiState — every null says which null it is', () => {
  it('marks an accessor that this dash.js build does not have', () => {
    const { state, unreadable } = readDashApiState(healthyApi({ duration: undefined }));
    expect(state.duration).toBeNull();
    expect(unreadable.duration).toBe('absent');
  });

  it('marks an accessor that threw, and keeps the other fields', () => {
    const api = healthyApi({ time: () => { throw new Error('not initialised'); } });
    const { state, unreadable } = readDashApiState(api);

    expect(state.time).toBeNull();
    expect(unreadable.time).toBe('threw');
    // One bad getter must not cost the whole snapshot — that is the reason each
    // read is probed on its own.
    expect(state.duration).toBe(3600);
    expect(state.isReady).toBe(true);
  });

  it('marks NaN separately, because JSON transport would flatten it to null', () => {
    const { state, unreadable } = readDashApiState(healthyApi({ time: () => NaN }));
    expect(state.time).toBeNull();
    expect(unreadable.time).toBe('not-finite');
  });

  it('marks an accessor that returned undefined', () => {
    const { state, unreadable } = readDashApiState(healthyApi({ isReady: () => undefined }));
    expect(state.isReady).toBeNull();
    expect(unreadable.isReady).toBe('undefined');
  });

  it('distinguishes "no stream selected yet" from "could not ask"', () => {
    const noStream = readDashApiState(healthyApi({ getActiveStream: () => null }));
    expect(noStream.state.activeStreamId).toBeNull();
    expect(noStream.unreadable.activeStreamId).toBe('no-active-stream');

    const cannotAsk = readDashApiState(healthyApi({ getActiveStream: undefined }));
    expect(cannotAsk.state.activeStreamId).toBeNull();
    expect(cannotAsk.unreadable.activeStreamId).toBe('absent');
  });

  it('marks a stream object whose getId throws', () => {
    const api = healthyApi({
      getActiveStream: () => ({ getId: () => { throw new Error('gone'); } })
    });
    const { state, unreadable } = readDashApiState(api);
    expect(state.activeStreamId).toBeNull();
    expect(unreadable.activeStreamId).toBe('threw');
  });

  it('reports every field as absent when there is no api at all', () => {
    const { state, unreadable } = readDashApiState(null);
    expect(state).toEqual({
      isReady: null,
      activeStreamId: null,
      time: null,
      duration: null,
      source: null
    });
    expect(unreadable).toEqual({
      isReady: 'absent',
      activeStreamId: 'absent',
      time: 'absent',
      duration: 'absent',
      source: 'absent'
    });
  });
});

describe('readDashApiState — the uninitialised player', () => {
  it('is distinguishable from a healthy one field by field', () => {
    // dash.js before a manifest: constructed, not ready, NaN clocks.
    const { state, unreadable } = readDashApiState({
      isReady: () => false,
      getActiveStream: () => null,
      time: () => NaN,
      duration: () => NaN,
      getSource: () => null
    });

    expect(state.isReady).toBe(false);
    expect(state.activeStreamId).toBeNull();
    expect(unreadable.activeStreamId).toBe('no-active-stream');
    expect(unreadable.time).toBe('not-finite');
    expect(unreadable.duration).toBe('not-finite');
    // A measured null source, which is not the same as an unreadable one.
    expect(state.source).toBeNull();
    expect(unreadable.source).toBeUndefined();
  });
});
