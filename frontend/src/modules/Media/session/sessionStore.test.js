import { describe, it, expect, vi } from 'vitest';
import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';
import { createSessionStore } from './sessionStore.js';

function makeStore() {
  return createSessionStore(createIdleSessionSnapshot({ sessionId: 's1', ownerId: 'c1' }));
}

describe('sessionStore', () => {
  it('dispatch runs the reducer and notifies subscribers', () => {
    const store = makeStore();
    const sub = vi.fn();
    store.subscribe(sub);
    store.dispatch({ type: 'SET_CONFIG', patch: { volume: 70 } });
    expect(sub).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().config.volume).toBe(70);
  });

  it('dispatch is a no-op when the reducer returns the same snapshot', () => {
    const store = makeStore();
    const sub = vi.fn();
    store.subscribe(sub);
    store.dispatch({ type: 'NOT_A_REAL_ACTION' });
    expect(sub).not.toHaveBeenCalled();
  });

  it('replace swaps the snapshot and notifies', () => {
    const store = makeStore();
    const sub = vi.fn();
    store.subscribe(sub);
    const next = { ...store.getSnapshot(), position: 12 };
    store.replace(next);
    expect(store.getSnapshot().position).toBe(12);
    expect(sub).toHaveBeenCalledWith(next);
  });

  it('onTransition listeners see (prev, next, action) before subscribers', () => {
    const store = makeStore();
    const order = [];
    store.onTransition((prev, next, action) => {
      order.push(['transition', prev.config.volume, next.config.volume, action.type]);
    });
    store.subscribe(() => order.push(['subscriber']));
    store.dispatch({ type: 'SET_CONFIG', patch: { volume: 33 } });
    expect(order[0]).toEqual(['transition', 50, 33, 'SET_CONFIG']);
    expect(order[1]).toEqual(['subscriber']);
  });

  it('unsubscribe and detach work', () => {
    const store = makeStore();
    const sub = vi.fn();
    const trans = vi.fn();
    const unsub = store.subscribe(sub);
    const detach = store.onTransition(trans);
    unsub();
    detach();
    store.dispatch({ type: 'SET_CONFIG', patch: { volume: 10 } });
    expect(sub).not.toHaveBeenCalled();
    expect(trans).not.toHaveBeenCalled();
  });
});
