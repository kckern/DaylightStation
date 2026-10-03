// RELY.1a / RELY.3a / RELY.6a: one outcome record per {attemptId, targetId}.
import { describe, it, expect } from 'vitest';
import { reduceDispatch, initialDispatchState, outcomePhase } from './dispatchReducer.js';

const initiated = (overrides = {}) => ({
  type: 'INITIATED',
  dispatchId: 'a1',
  deviceId: 'office',
  contentId: 'plex:1',
  title: 'Arrival',
  mode: 'fork',
  command: { targetIds: ['office'], play: 'plex:1', mode: 'fork', title: 'Arrival' },
  ...overrides,
});

function run(actions, state = initialDispatchState) {
  return actions.reduce(reduceDispatch, state);
}

describe('outcome records', () => {
  it('is an immutable attempt record keyed by attemptId and targetId', () => {
    const state = run([initiated()]);
    const record = state.byId.get('a1');
    expect(record).toEqual(expect.objectContaining({
      attemptId: 'a1',
      targetId: 'office',
      kind: 'play',
      phase: 'running',
      item: { contentId: 'plex:1', title: 'Arrival' },
      command: expect.objectContaining({ play: 'plex:1', targetIds: ['office'] }),
      snapshot: null,
      reason: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    }));
    expect(Object.isFrozen(record.command)).toBe(true);
    expect(() => { record.command.play = 'plex:2'; }).toThrow();
  });

  it('a late step for another target never lands on this attempt', () => {
    let state = run([initiated()]);
    state = reduceDispatch(state, { type: 'STEP', dispatchId: 'a1', targetId: 'livingroom-tv', step: 'playback', status: 'confirmed' });
    expect(state.byId.get('a1').phase).toBe('running');
    expect(state.byId.get('a1').steps).toEqual([]);
    state = reduceDispatch(state, { type: 'SUCCEEDED', dispatchId: 'a1' });
    state = reduceDispatch(state, { type: 'STEP', dispatchId: 'a1', targetId: 'office', step: 'playback', status: 'confirmed' });
    expect(state.byId.get('a1').phase).toBe('confirmed');
  });

  it('keeps one unconfirmed notice per screen: a newer one replaces the older', () => {
    const state = run([
      initiated({ dispatchId: 'old', command: { targetIds: ['office'], play: 'plex:1' } }),
      initiated({ dispatchId: 'other-screen', deviceId: 'den', command: { targetIds: ['den'], play: 'plex:1' } }),
      initiated({ dispatchId: 'new', contentId: 'plex:2', title: 'Nova', command: { targetIds: ['office'], play: 'plex:2' } }),
      { type: 'SUCCEEDED', dispatchId: 'old' },
      { type: 'SUCCEEDED', dispatchId: 'other-screen' },
      { type: 'SUCCEEDED', dispatchId: 'new' },
      { type: 'STEP', dispatchId: 'old', targetId: 'office', step: 'playback', status: 'timeout' },
      { type: 'STEP', dispatchId: 'other-screen', targetId: 'den', step: 'playback', status: 'timeout' },
      { type: 'STEP', dispatchId: 'new', targetId: 'office', step: 'playback', status: 'timeout' },
    ]);
    expect(state.byId.has('old')).toBe(false);
    expect(state.byId.get('new').phase).toBe('unconfirmed');
    expect(state.byId.get('other-screen').phase).toBe('unconfirmed');
  });

  it('clears an unconfirmed notice once that screen reports the same item playing', () => {
    let state = run([
      initiated(),
      { type: 'SUCCEEDED', dispatchId: 'a1' },
      { type: 'STEP', dispatchId: 'a1', targetId: 'office', step: 'playback', status: 'timeout' },
    ]);
    const unchanged = reduceDispatch(state, { type: 'SCREEN_STATE', targetId: 'office', state: 'playing', contentId: 'plex:9' });
    expect(unchanged.byId.get('a1').phase).toBe('unconfirmed');
    const paused = reduceDispatch(state, { type: 'SCREEN_STATE', targetId: 'office', state: 'paused', contentId: 'plex:1' });
    expect(paused.byId.get('a1').phase).toBe('unconfirmed');
    const elsewhere = reduceDispatch(state, { type: 'SCREEN_STATE', targetId: 'den', state: 'playing', contentId: 'plex:1' });
    expect(elsewhere.byId.get('a1').phase).toBe('unconfirmed');
    state = reduceDispatch(state, { type: 'SCREEN_STATE', targetId: 'office', state: 'playing', contentId: 'plex:1' });
    expect(state.byId.get('a1').phase).toBe('confirmed');
    expect(state.byId.get('a1').reason).toBe('screen-reported-playing');
  });

  it('an undeliverable attempt is a terminal Not sent', () => {
    const state = run([
      initiated(),
      { type: 'FAILED', dispatchId: 'a1', error: 'Device offline', failedStep: 'prepare' },
    ]);
    expect(state.byId.get('a1').phase).toBe('not-sent');
    expect(outcomePhase(state.byId.get('a1'))).toBe('not-sent');
    const loadFailure = run([initiated(), { type: 'FAILED', dispatchId: 'a1', error: 'receiver rejected', failedStep: 'load' }]);
    expect(loadFailure.byId.get('a1').phase).toBe('failed');
  });

  it('a newer confirmation of the same kind on the same screen replaces the older one; failures stay', () => {
    const state = run([
      initiated({ dispatchId: 'first' }),
      { type: 'SUCCEEDED', dispatchId: 'first' },
      { type: 'STEP', dispatchId: 'first', targetId: 'office', step: 'playback', status: 'confirmed' },
      initiated({ dispatchId: 'failed-one', contentId: 'plex:3' }),
      { type: 'FAILED', dispatchId: 'failed-one', error: 'receiver rejected', failedStep: 'load' },
      initiated({ dispatchId: 'second', contentId: 'plex:2', title: 'Nova' }),
    ]);
    expect(state.byId.has('first')).toBe(false);
    expect(state.byId.get('failed-one').phase).toBe('failed');
    expect(state.byId.get('second').phase).toBe('running');
  });

  it('records a quiet local outcome for this device and replaces the previous local confirmation', () => {
    let state = reduceDispatch(initialDispatchState, {
      type: 'LOCAL', attemptId: 'l1', kind: 'play', phase: 'confirmed',
      item: { contentId: 'plex:1', title: 'Arrival' }, command: { kind: 'playNow', item: { contentId: 'plex:1' } },
    });
    expect(state.byId.get('l1')).toEqual(expect.objectContaining({
      attemptId: 'l1', targetId: 'local', distance: 'here', phase: 'confirmed', kind: 'play',
    }));
    state = reduceDispatch(state, {
      type: 'LOCAL', attemptId: 'l2', kind: 'play', phase: 'confirmed',
      item: { contentId: 'plex:2', title: 'Nova' }, command: { kind: 'playNow', item: { contentId: 'plex:2' } },
    });
    expect(state.byId.has('l1')).toBe(false);
    state = reduceDispatch(state, {
      type: 'LOCAL', attemptId: 'f1', kind: 'playback', phase: 'skipped', reason: 'stalled',
      item: { contentId: 'plex:2', title: 'Nova' }, replacement: { contentId: 'plex:3', title: 'Dune' },
      command: { kind: 'playNow', item: { contentId: 'plex:2' } },
    });
    state = reduceDispatch(state, {
      type: 'LOCAL', attemptId: 'f2', kind: 'playback', phase: 'failed', reason: 'error',
      item: { contentId: 'plex:3', title: 'Dune' }, command: { kind: 'playNow', item: { contentId: 'plex:3' } },
    });
    expect(state.byId.get('f1').phase).toBe('skipped');
    expect(state.byId.get('f1').replacement).toEqual({ contentId: 'plex:3', title: 'Dune' });
    expect(state.byId.get('f2').phase).toBe('failed');
  });

  it('review (b): a newer local action never supersedes a RUNNING one — its Undo and later failure survive', () => {
    let state = reduceDispatch(initialDispatchState, {
      type: 'LOCAL', attemptId: 'r1', kind: 'add', phase: 'running', item: { contentId: 'plex:1', title: 'Arrival' },
      undo: { operationId: 'op-1', expiresAt: Date.now() + 10000, run: () => {} },
    });
    state = reduceDispatch(state, { type: 'LOCAL', attemptId: 'r2', kind: 'add', phase: 'running', item: { contentId: 'plex:2', title: 'Nova' } });
    expect(state.byId.has('r1')).toBe(true);
    state = reduceDispatch(state, { type: 'LOCAL_RESOLVED', attemptId: 'r1', phase: 'failed', reason: 'busy' });
    expect(state.byId.get('r1').phase).toBe('failed');
    state = reduceDispatch(state, { type: 'LOCAL_RESOLVED', attemptId: 'r2', phase: 'confirmed' });
    state = reduceDispatch(state, { type: 'LOCAL', attemptId: 'r3', kind: 'add', phase: 'running', item: { contentId: 'plex:3', title: 'Dune' } });
    expect(state.byId.has('r2')).toBe(false);
    expect(state.byId.get('r1').phase).toBe('failed');
  });
});
