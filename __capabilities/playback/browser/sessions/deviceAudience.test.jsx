import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
vi.mock('../../../../frontend/src/lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ debug() {}, info() {}, warn() {} }) }) }));
import { createAudienceStore, audienceKey, useDeviceAudience } from './deviceAudience.js';

const A = (id, activity = 'workout') => ({ activity, people: [{ id, name: id, role: 'rider', guest: false }] });

describe('audience store', () => {
  it('latest live declaration wins; withdrawing reveals the previous one', () => {
    const s = createAudienceStore();
    const seen = vi.fn(); s.subscribe(seen);
    s.declare('shell', A('rider-a', 'lesson'));
    s.declare('game', A('rider-a', 'game'));
    expect(s.get().activity).toBe('game');
    s.withdraw('game');
    expect(s.get().activity).toBe('lesson');
    s.withdraw('shell');
    expect(s.get()).toBeNull();
    expect(seen).toHaveBeenCalledTimes(4);
  });

  it("a name arriving later re-publishes (the reader learns the child's name after the session opens)", () => {
    const s = createAudienceStore();
    const seen = vi.fn(); s.subscribe(seen);
    s.declare('reader', { activity: 'story', people: [{ id: 'learner-a', name: null, role: 'learner', guest: false }] });
    s.declare('reader', { activity: 'story', people: [{ id: 'learner-a', name: 'Learner A', role: 'learner', guest: false }] });
    expect(s.get().people[0].name).toBe('Learner A');
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('re-declaring keeps the stack position: an outer change never jumps over a live inner one', () => {
    const s = createAudienceStore();
    s.declare('shell', A('rider-a', 'lesson'));
    s.declare('game', A('rider-a', 'game'));
    s.declare('shell', A('rider-b', 'lesson'));
    expect(s.get().activity).toBe('game');
    s.withdraw('game');
    expect(s.get().people[0].id).toBe('rider-b');
  });

  it('re-declaring the same token with an identical key does not notify', () => {
    const s = createAudienceStore();
    const seen = vi.fn(); s.subscribe(seen);
    s.declare('t', A('rider-a'));
    s.declare('t', { ...A('rider-a') }); // new object, same people
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('keys by activity and sorted people, ignoring order and extra fields', () => {
    const one = { activity: 'workout', people: [{ id: 'b', role: 'rider' }, { id: 'a', role: 'rider', heartRate: 120 }] };
    const two = { activity: 'workout', people: [{ id: 'a', role: 'rider' }, { id: 'b', role: 'rider' }] };
    expect(audienceKey(one)).toBe(audienceKey(two));
    expect(audienceKey(A('a', 'story'))).not.toBe(audienceKey(A('a', 'workout')));
  });
});

describe('useDeviceAudience', () => {
  it('declares while mounted, follows changes, withdraws on null and unmount', () => {
    const store = createAudienceStore();
    const { rerender, unmount } = renderHook(({ a }) => useDeviceAudience(a, { store }), { initialProps: { a: A('rider-a') } });
    expect(store.get().people[0].id).toBe('rider-a');
    rerender({ a: A('rider-b') });
    expect(store.get().people[0].id).toBe('rider-b');
    rerender({ a: null });
    expect(store.get()).toBeNull();
    rerender({ a: A('rider-c') });
    unmount();
    expect(store.get()).toBeNull();
  });
});
