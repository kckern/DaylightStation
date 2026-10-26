import { describe, it, expect } from 'vitest';
import { createHealthOperations } from './healthOperations.js';
const intent = (id, ids) => ({ id, kind: 'edit', targetIds: ids, request: { body: { operationId: id, value: 2 } } });
describe('food operation reservations', () => {
  it('allows disjoint operations and rejects an intersection atomically before render', () => {
    const store = createHealthOperations({ userId: 'u' });
    expect(store.begin(intent('first', ['g', 'a', 'b'])).ok).toBe(true);
    expect(store.begin(intent('second', ['b', 'c'])).ok).toBe(false);
    expect(store.isReserved(['c'])).toBe(false);
    expect(store.begin(intent('third', ['d'])).ok).toBe(true);
    store.transition('first', { phase: 'error' });
    expect(store.isReserved(['a'])).toBe(true);
    store.discard('first');
    expect(store.isReserved(['a'])).toBe(false);
    expect(store.isReserved(['d'])).toBe(true);
  });
  it('snapshots request bytes and ignores completions after disposal', () => {
    const store = createHealthOperations({ userId: 'u' });
    const original = intent('one', [1]);
    store.begin(original); original.request.body.value = 9;
    expect(store.getSnapshot().operations.get('one').request.body.value).toBe(2);
    expect(store.isReserved(['1'])).toBe(true);
    store.dispose(); store.transition('one', { phase: 'succeeded' });
    expect(store.getSnapshot().operations.size).toBe(0);
    expect(store.begin(intent('two', ['2'])).ok).toBe(false);
  });
});
