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

it('allows a batch child inside its own reservation while excluding every other writer',()=>{
 const store=createHealthOperations({userId:'u'});
 store.begin({id:'batch',targetIds:['a','b']});
 expect(store.begin({id:'child',parentId:'batch',targetIds:['a']}).ok).toBe(true);
 expect(store.begin({id:'outside',targetIds:['b']}).ok).toBe(false);
 store.discard('batch');
 expect(store.isReserved(['a'])).toBe(true);
});

it('restores unresolved barcode commands per user without overwriting a concurrent intent', () => {
  const userId = 'barcode-test';
  const options = { userId, durableStorage: localStorage };
  const prepare = id => ({ ...intent(id, []), kind: 'barcode-commit',
    request: { path: 'api/v1/health/nutrition/barcode-commit', method: 'POST', body: { operationId: id, upc: '012345678905' } } });
  const first = createHealthOperations(options);
  const second = createHealthOperations(options);
  try {
    first.begin(prepare('first'));
    second.begin(prepare('second'));
    first.dispose();
    second.dispose();
    const restored = createHealthOperations(options);
    expect([...restored.getSnapshot().operations.values()]).toMatchObject([
      { id: 'first', phase: 'error', request: prepare('first').request },
      { id: 'second', phase: 'error', request: prepare('second').request },
    ]);
    expect(createHealthOperations({ ...options, userId: 'another' }).getSnapshot().operations.size).toBe(0);
    restored.transition('first', { phase: 'succeeded' });
    expect([...createHealthOperations(options).getSnapshot().operations.keys()]).toEqual(['second']);
  } finally {
    localStorage.removeItem('daylight.health.barcode-operations:barcode-test:first');
    localStorage.removeItem('daylight.health.barcode-operations:barcode-test:second');
  }
});

it('restores valid barcode commands on both sides of malformed storage', () => {
  const userId = 'barcode-corrupt';
  const prefix = `daylight.health.barcode-operations:${userId}:`;
  const options = { userId, durableStorage: localStorage };
  const store = createHealthOperations(options);
  const prepare = id => ({ ...intent(id, []), kind: 'barcode-commit',
    request: { path: 'api/v1/health/nutrition/barcode-commit', method: 'POST', body: { operationId: id } } });
  try {
    store.begin(prepare('first'));
    localStorage.setItem(prefix + 'broken', '{');
    store.begin(prepare('last'));
    expect([...createHealthOperations(options).getSnapshot().operations.keys()]).toEqual(['first', 'last']);
  } finally {
    for (const id of ['first', 'broken', 'last']) localStorage.removeItem(prefix + id);
  }
});

it('normalizes missing reservation IDs on restored barcode commands and preserves their retry request', () => {
  const userId = 'barcode-missing-targets';
  const prefix = `daylight.health.barcode-operations:${userId}:`;
  const operation = {
    id: 'recoverable',
    userId,
    kind: 'barcode-commit',
    phase: 'pending',
    request: {
      path: 'api/v1/health/nutrition/barcode-commit',
      method: 'POST',
      body: { operationId: 'recoverable', upc: '012345678905' },
    },
  };
  localStorage.setItem(prefix + operation.id, JSON.stringify(operation));

  try {
    const store = createHealthOperations({ userId, durableStorage: localStorage });
    const restored = store.getSnapshot().operations.get(operation.id);
    expect(store.isReserved(['food-row'])).toBe(false);
    expect(restored).toMatchObject({ phase: 'error', targetIds: [], request: operation.request });
    expect(store.begin(intent('disjoint-edit', ['food-row'])).ok).toBe(true);
  } finally {
    localStorage.removeItem(prefix + operation.id);
  }
});
