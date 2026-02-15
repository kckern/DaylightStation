import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { WorkingMemoryState } from '../../../../src/3_applications/agents/framework/WorkingMemory.mjs';

describe('Agents Memory API (unit)', () => {
  let mockWorkingMemory;
  let storedState;

  beforeEach(() => {
    storedState = new WorkingMemoryState();
    storedState.set('coaching_style', 'direct feedback');
    storedState.set('temp_note', 'skipped workout', { ttl: 86400000 });

    mockWorkingMemory = {
      load: async (agentId, userId) => storedState,
      save: async (agentId, userId, state) => { storedState = state; },
    };
  });

  describe('getMemoryEntries', () => {
    it('should return all memory entries with metadata', async () => {
      const state = await mockWorkingMemory.load('health-coach', 'kckern');
      const json = state.toJSON();

      assert.ok(json.coaching_style, 'Should have coaching_style entry');
      assert.strictEqual(json.coaching_style.value, 'direct feedback');
      assert.strictEqual(json.coaching_style.expiresAt, null, 'Persistent entry has null expiresAt');

      assert.ok(json.temp_note, 'Should have temp_note entry');
      assert.strictEqual(json.temp_note.value, 'skipped workout');
      assert.ok(json.temp_note.expiresAt, 'Expiring entry has expiresAt');
    });
  });

  describe('deleteMemoryEntry', () => {
    it('should remove a single key from memory', async () => {
      const state = await mockWorkingMemory.load('health-coach', 'kckern');
      state.remove('temp_note');
      await mockWorkingMemory.save('health-coach', 'kckern', state);

      const reloaded = await mockWorkingMemory.load('health-coach', 'kckern');
      assert.strictEqual(reloaded.get('temp_note'), undefined);
      assert.strictEqual(reloaded.get('coaching_style'), 'direct feedback');
    });
  });

  describe('clearAllMemory', () => {
    it('should clear all entries', async () => {
      const emptyState = new WorkingMemoryState();
      await mockWorkingMemory.save('health-coach', 'kckern', emptyState);

      const reloaded = await mockWorkingMemory.load('health-coach', 'kckern');
      assert.deepStrictEqual(reloaded.getAll(), {});
    });
  });
});
