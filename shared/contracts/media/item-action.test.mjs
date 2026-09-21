import { it, expect } from 'vitest';
import { buildCommandEnvelope, validateCommandEnvelope } from './envelopes.mjs';

const command = params => buildCommandEnvelope({ targetDevice: 'tv', commandId: 'cmd', command: 'queue', params });
it('accepts operation-correlated item actions and cancellation without content', () => {
  expect(validateCommandEnvelope(command({ op: 'item-action', operationId: 'op', kind: 'playNext', item: { contentId: 'plex:a' }, tappedAt: 1000, clearRest: false })).valid).toBe(true);
  expect(validateCommandEnvelope(command({ op: 'undo', operationId: 'op' })).valid).toBe(true);
});
it.each([
  { op: 'item-action', kind: 'delete', item: { contentId: 'plex:a' }, operationId: 'op', tappedAt: 1000 },
  { op: 'item-action', kind: 'add', item: {}, operationId: 'op', tappedAt: 1000 },
  { op: 'undo', operationId: '' },
])('rejects malformed item operation %#', params => {
  expect(validateCommandEnvelope(command(params)).valid).toBe(false);
});
