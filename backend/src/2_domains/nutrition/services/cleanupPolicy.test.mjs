import { describe, expect, it } from 'vitest';
import { validateCleanup } from './cleanupPolicy.mjs';

const now = Date.parse('2026-09-06T01:00:00Z');
const common = { userId: 'alice', date: '2026-09-05', mealTime: 'evening', logUuid: 'burrito', version: 1, settled: false };
const child = parentId => ({ ...common, id: 'tortilla', uuid: 'tortilla', kind: 'item', calories: 290, parentId });
const group = id => ({ ...common, id, uuid: id, kind: 'group', calories: 0, parentId: null });
function proposal(parentId) {
  return { userId: 'alice', now, timezone: 'America/Los_Angeles',
    before: [child(parentId), ...(parentId ? [group(parentId)] : [])],
    after: [child('new-group'), ...(parentId ? [group(parentId)] : []), group('new-group')],
    updates: [{ id: 'tortilla', expectedVersion: 1, changes: { parentId: 'new-group' } }],
    creates: [group('new-group')], evidence: [{ kind: 'capture', id: 'burrito' }],
  };
}
describe('automatic food grouping', () => {
  it('never moves an already-grouped ingredient into a duplicate header', () => {
    expect(() => validateCleanup(proposal('original-group'))).toThrow('existing food group');
  });
  it('still permits a non-additive header for ungrouped ingredients from one capture', () => {
    expect(validateCleanup(proposal(null))).toBe(true);
  });
});
