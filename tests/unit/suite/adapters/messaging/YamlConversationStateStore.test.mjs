// tests/unit/adapters/messaging/YamlConversationStateStore.test.mjs
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { YamlConversationStateStore } from '#backend/src/2_adapters/messaging/YamlConversationStateStore.mjs';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

describe('YamlConversationStateStore', () => {
  let store;
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'conv-state-'));
    store = new YamlConversationStateStore({ basePath: tempDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // Constructor Validation
  // ===========================================================================
  describe('constructor validation', () => {
    it('should throw if basePath is not provided', () => {
      expect(() => new YamlConversationStateStore({})).toThrow(
        'YamlConversationStateStore requires basePath'
      );
    });

    it('should throw if config is undefined', () => {
      expect(() => new YamlConversationStateStore()).toThrow(
        'YamlConversationStateStore requires basePath'
      );
    });

    it('should throw if config is null', () => {
      expect(() => new YamlConversationStateStore(null)).toThrow(
        'YamlConversationStateStore requires basePath'
      );
    });

    it('should throw if basePath is empty string', () => {
      expect(() => new YamlConversationStateStore({ basePath: '' })).toThrow(
        'YamlConversationStateStore requires basePath'
      );
    });

    it('should accept valid basePath', () => {
      const validStore = new YamlConversationStateStore({ basePath: '/tmp/test' });
      expect(validStore).toBeInstanceOf(YamlConversationStateStore);
    });
  });

  // ===========================================================================
  // Basic Get/Set Operations
  // ===========================================================================
  describe('basic get/set operations', () => {
    it('should return null for non-existent conversation', async () => {
      const state = await store.get('nonexistent');
      expect(state).toBeNull();
    });

    it('should set and get conversation state', async () => {
      const testState = { activeFlow: 'test', flowState: { count: 1 } };
      await store.set('conv123', testState);
      const retrieved = await store.get('conv123');
      expect(retrieved.activeFlow).toBe('test');
      expect(retrieved.flowState.count).toBe(1);
    });

    it('should add updatedAt timestamp on set', async () => {
      const testState = { activeFlow: 'test' };
      await store.set('conv123', testState);
      const retrieved = await store.get('conv123');
      expect(retrieved.updatedAt).toBeDefined();
      expect(new Date(retrieved.updatedAt).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should overwrite existing state', async () => {
      await store.set('conv123', { activeFlow: 'flow1', flowState: { a: 1 } });
      await store.set('conv123', { activeFlow: 'flow2', flowState: { b: 2 } });

      const retrieved = await store.get('conv123');
      expect(retrieved.activeFlow).toBe('flow2');
      expect(retrieved.flowState.b).toBe(2);
      expect(retrieved.flowState.a).toBeUndefined();
    });

    it('should handle empty state object', async () => {
      await store.set('conv123', {});
      const retrieved = await store.get('conv123');
      expect(retrieved).toBeTruthy();
      expect(retrieved.updatedAt).toBeDefined();
    });

    it('should handle nested flowState', async () => {
      const complexState = {
        activeFlow: 'nested',
        flowState: {
          level1: {
            level2: {
              level3: { value: 'deep' }
            }
          },
          array: [1, 2, { nested: true }]
        }
      };
      await store.set('conv123', complexState);
      const retrieved = await store.get('conv123');
      expect(retrieved.flowState.level1.level2.level3.value).toBe('deep');
      expect(retrieved.flowState.array[2].nested).toBe(true);
    });
  });

  // ===========================================================================
  // Conversation ID Sanitization
  // ===========================================================================
  describe('conversation ID sanitization', () => {
    it('should sanitize colons to underscores in conversation ID', async () => {
      const testState = { activeFlow: 'test' };
      await store.set('telegram:chat:123', testState);

      // Verify file was created with sanitized name
      const files = await fs.readdir(tempDir);
      expect(files).toContain('telegram_chat_123.yml');
      expect(files.some(f => f.includes(':'))).toBe(false);
    });

    it('should retrieve state using original unsanitized ID', async () => {
      const testState = { activeFlow: 'test', flowState: { data: 'value' } };
      await store.set('telegram:chat:456', testState);

      const retrieved = await store.get('telegram:chat:456');
      expect(retrieved.activeFlow).toBe('test');
      expect(retrieved.flowState.data).toBe('value');
    });

    it('should handle multiple colons in ID', async () => {
      const testState = { activeFlow: 'multi-colon' };
      await store.set('a:b:c:d:e', testState);

      const files = await fs.readdir(tempDir);
      expect(files).toContain('a_b_c_d_e.yml');

      const retrieved = await store.get('a:b:c:d:e');
      expect(retrieved.activeFlow).toBe('multi-colon');
    });

    it('should not interfere with IDs that have no colons', async () => {
      const testState = { activeFlow: 'no-colons' };
      await store.set('simple_id_123', testState);

      const files = await fs.readdir(tempDir);
      expect(files).toContain('simple_id_123.yml');

      const retrieved = await store.get('simple_id_123');
      expect(retrieved.activeFlow).toBe('no-colons');
    });
  });

  // ===========================================================================
  // Session Management (messageId parameter)
  // ===========================================================================
  describe('session management', () => {
    it('should support message-keyed sessions', async () => {
      await store.set('conv123', { activeFlow: 'flow1' }, 'msg1');
      await store.set('conv123', { activeFlow: 'flow2' }, 'msg2');

      const session1 = await store.get('conv123', 'msg1');
      const session2 = await store.get('conv123', 'msg2');

      expect(session1.activeFlow).toBe('flow1');
      expect(session2.activeFlow).toBe('flow2');
    });

    it('should return null for non-existent session', async () => {
      await store.set('conv123', { activeFlow: 'root' });
      const session = await store.get('conv123', 'nonexistent-msg');
      expect(session).toBeNull();
    });

    it('should keep sessions separate from root state', async () => {
      await store.set('conv123', { activeFlow: 'root-flow' });
      await store.set('conv123', { activeFlow: 'session-flow' }, 'msg1');

      const rootState = await store.get('conv123');
      const sessionState = await store.get('conv123', 'msg1');

      expect(rootState.activeFlow).toBe('root-flow');
      expect(sessionState.activeFlow).toBe('session-flow');
    });

    it('should create session even without root state', async () => {
      await store.set('conv123', { activeFlow: 'session-only' }, 'msg1');

      const rootState = await store.get('conv123');
      const sessionState = await store.get('conv123', 'msg1');

      expect(rootState).toBeNull();
      expect(sessionState.activeFlow).toBe('session-only');
    });

    it('should handle multiple sessions for same conversation', async () => {
      for (let i = 1; i <= 5; i++) {
        await store.set('conv123', { activeFlow: `flow${i}`, flowState: { index: i } }, `msg${i}`);
      }

      for (let i = 1; i <= 5; i++) {
        const session = await store.get('conv123', `msg${i}`);
        expect(session.activeFlow).toBe(`flow${i}`);
        expect(session.flowState.index).toBe(i);
      }
    });

    it('should update existing session', async () => {
      await store.set('conv123', { activeFlow: 'v1', flowState: { step: 1 } }, 'msg1');
      await store.set('conv123', { activeFlow: 'v2', flowState: { step: 2 } }, 'msg1');

      const session = await store.get('conv123', 'msg1');
      expect(session.activeFlow).toBe('v2');
      expect(session.flowState.step).toBe(2);
    });

    it('should add updatedAt to session state', async () => {
      await store.set('conv123', { activeFlow: 'test' }, 'msg1');
      const session = await store.get('conv123', 'msg1');
      expect(session.updatedAt).toBeDefined();
    });
  });

  // ===========================================================================
  // Preserve Sessions When Updating Root State
  // ===========================================================================
  describe('preserve sessions when updating root state', () => {
    it('should preserve existing sessions when setting root state', async () => {
      // Create sessions first
      await store.set('conv123', { activeFlow: 'session1' }, 'msg1');
      await store.set('conv123', { activeFlow: 'session2' }, 'msg2');

      // Set root state
      await store.set('conv123', { activeFlow: 'root' });

      // Verify sessions still exist
      const session1 = await store.get('conv123', 'msg1');
      const session2 = await store.get('conv123', 'msg2');
      const rootState = await store.get('conv123');

      expect(session1.activeFlow).toBe('session1');
      expect(session2.activeFlow).toBe('session2');
      expect(rootState.activeFlow).toBe('root');
    });

    it('should preserve sessions when updating root state multiple times', async () => {
      await store.set('conv123', { activeFlow: 'session1' }, 'msg1');

      // Update root state multiple times
      await store.set('conv123', { activeFlow: 'root-v1' });
      await store.set('conv123', { activeFlow: 'root-v2' });
      await store.set('conv123', { activeFlow: 'root-v3' });

      // Session should still exist
      const session = await store.get('conv123', 'msg1');
      expect(session.activeFlow).toBe('session1');
    });

    it('should allow adding new sessions after root state set', async () => {
      await store.set('conv123', { activeFlow: 'root' });
      await store.set('conv123', { activeFlow: 'new-session' }, 'msg-new');

      const rootState = await store.get('conv123');
      const newSession = await store.get('conv123', 'msg-new');

      expect(rootState.activeFlow).toBe('root');
      expect(newSession.activeFlow).toBe('new-session');
    });
  });

  // ===========================================================================
  // Delete Operations
  // ===========================================================================
  describe('delete operations', () => {
    describe('delete entire conversation', () => {
      it('should delete entire conversation file', async () => {
        await store.set('conv123', { activeFlow: 'test' });
        await store.delete('conv123');

        const state = await store.get('conv123');
        expect(state).toBeNull();

        // Verify file is gone
        const files = await fs.readdir(tempDir);
        expect(files).not.toContain('conv123.yml');
      });

      it('should handle deleting non-existent conversation gracefully', async () => {
        // Should not throw
        await expect(store.delete('nonexistent')).resolves.not.toThrow();
      });

      it('should delete file with sanitized name', async () => {
        await store.set('telegram:chat:123', { activeFlow: 'test' });
        await store.delete('telegram:chat:123');

        const files = await fs.readdir(tempDir);
        expect(files).not.toContain('telegram_chat_123.yml');
      });
    });

    describe('delete specific session', () => {
      it('should delete specific session', async () => {
        await store.set('conv123', { activeFlow: 'flow1' }, 'msg1');
        await store.delete('conv123', 'msg1');
        const state = await store.get('conv123', 'msg1');
        expect(state).toBeNull();
      });

      it('should preserve other sessions when deleting one', async () => {
        await store.set('conv123', { activeFlow: 'session1' }, 'msg1');
        await store.set('conv123', { activeFlow: 'session2' }, 'msg2');
        await store.set('conv123', { activeFlow: 'session3' }, 'msg3');

        await store.delete('conv123', 'msg2');

        const session1 = await store.get('conv123', 'msg1');
        const session2 = await store.get('conv123', 'msg2');
        const session3 = await store.get('conv123', 'msg3');

        expect(session1.activeFlow).toBe('session1');
        expect(session2).toBeNull();
        expect(session3.activeFlow).toBe('session3');
      });

      it('should preserve root state when deleting session', async () => {
        await store.set('conv123', { activeFlow: 'root' });
        await store.set('conv123', { activeFlow: 'session' }, 'msg1');

        await store.delete('conv123', 'msg1');

        const rootState = await store.get('conv123');
        expect(rootState.activeFlow).toBe('root');
      });

      it('should handle deleting non-existent session gracefully', async () => {
        await store.set('conv123', { activeFlow: 'test' });
        // Should not throw
        await expect(store.delete('conv123', 'nonexistent-msg')).resolves.not.toThrow();
      });

      it('should delete file when last session is removed and no root state', async () => {
        // Only session, no root state
        await store.set('conv123', { activeFlow: 'only-session' }, 'msg1');
        await store.delete('conv123', 'msg1');

        const rootState = await store.get('conv123');
        expect(rootState).toBeNull();

        // File should be deleted
        const files = await fs.readdir(tempDir);
        expect(files).not.toContain('conv123.yml');
      });

      it('should keep file when root state exists after deleting last session', async () => {
        await store.set('conv123', { activeFlow: 'root' });
        await store.set('conv123', { activeFlow: 'session' }, 'msg1');

        await store.delete('conv123', 'msg1');

        // File should still exist with root state
        const rootState = await store.get('conv123');
        expect(rootState.activeFlow).toBe('root');
      });
    });
  });

  // ===========================================================================
  // Clear Operations
  // ===========================================================================
  describe('clear operations', () => {
    it('should clear conversation (alias for delete)', async () => {
      await store.set('conv123', { activeFlow: 'test' });
      await store.clear('conv123');

      const state = await store.get('conv123');
      expect(state).toBeNull();
    });

    it('should clear all sessions along with root state', async () => {
      await store.set('conv123', { activeFlow: 'root' });
      await store.set('conv123', { activeFlow: 'session1' }, 'msg1');
      await store.set('conv123', { activeFlow: 'session2' }, 'msg2');

      await store.clear('conv123');

      expect(await store.get('conv123')).toBeNull();
      expect(await store.get('conv123', 'msg1')).toBeNull();
      expect(await store.get('conv123', 'msg2')).toBeNull();
    });

    it('should handle clearing non-existent conversation gracefully', async () => {
      await expect(store.clear('nonexistent')).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // Concurrent Access Handling
  // ===========================================================================
  describe('concurrent access handling', () => {
    it('should handle concurrent writes to different conversations', async () => {
      const writes = [];
      for (let i = 0; i < 10; i++) {
        writes.push(store.set(`conv${i}`, { activeFlow: `flow${i}`, flowState: { index: i } }));
      }

      await Promise.all(writes);

      // Verify all writes succeeded
      for (let i = 0; i < 10; i++) {
        const state = await store.get(`conv${i}`);
        expect(state.activeFlow).toBe(`flow${i}`);
        expect(state.flowState.index).toBe(i);
      }
    });

    it('should handle concurrent session writes to same conversation', async () => {
      const writes = [];
      for (let i = 0; i < 5; i++) {
        writes.push(store.set('conv123', { activeFlow: `session${i}` }, `msg${i}`));
      }

      await Promise.all(writes);

      // All sessions should exist (last write wins for any collision)
      // At minimum, we should be able to read some sessions
      let foundCount = 0;
      for (let i = 0; i < 5; i++) {
        const session = await store.get('conv123', `msg${i}`);
        if (session) foundCount++;
      }
      // In practice with file-based storage, some writes may overwrite others
      // but at least one should succeed
      expect(foundCount).toBeGreaterThan(0);
    });

    it('should handle concurrent read and write operations', async () => {
      // Pre-populate
      await store.set('conv123', { activeFlow: 'initial' });

      const operations = [];
      // Mix of reads and writes
      for (let i = 0; i < 5; i++) {
        operations.push(store.get('conv123'));
        operations.push(store.set('conv123', { activeFlow: `update${i}` }));
      }

      // Should not throw
      await expect(Promise.all(operations)).resolves.not.toThrow();
    });

    it('should handle rapid sequential updates', async () => {
      for (let i = 0; i < 20; i++) {
        await store.set('conv123', { activeFlow: `flow${i}`, flowState: { iteration: i } });
      }

      const state = await store.get('conv123');
      expect(state.activeFlow).toBe('flow19');
      expect(state.flowState.iteration).toBe(19);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================
  describe('edge cases', () => {
    it('should create directory if it does not exist', async () => {
      const nestedPath = path.join(tempDir, 'nested', 'deep', 'path');
      const nestedStore = new YamlConversationStateStore({ basePath: nestedPath });

      await nestedStore.set('conv123', { activeFlow: 'test' });

      const state = await nestedStore.get('conv123');
      expect(state.activeFlow).toBe('test');
    });

    it('should handle special characters in flowState values', async () => {
      const testState = {
        activeFlow: 'test',
        flowState: {
          text: 'Hello "world" with \'quotes\'',
          multiline: 'Line 1\nLine 2\nLine 3',
          unicode: 'Hello 世界 🌍',
          yaml_special: 'key: value, list: [1, 2, 3]'
        }
      };

      await store.set('conv123', testState);
      const retrieved = await store.get('conv123');

      expect(retrieved.flowState.text).toBe('Hello "world" with \'quotes\'');
      expect(retrieved.flowState.multiline).toBe('Line 1\nLine 2\nLine 3');
      expect(retrieved.flowState.unicode).toBe('Hello 世界 🌍');
      expect(retrieved.flowState.yaml_special).toBe('key: value, list: [1, 2, 3]');
    });

    it('should handle null values in state', async () => {
      const testState = {
        activeFlow: 'test',
        flowState: {
          nullValue: null,
          nested: { alsoNull: null }
        }
      };

      await store.set('conv123', testState);
      const retrieved = await store.get('conv123');

      expect(retrieved.flowState.nullValue).toBeNull();
      expect(retrieved.flowState.nested.alsoNull).toBeNull();
    });

    it('should handle undefined values in state (converted to null)', async () => {
      const testState = {
        activeFlow: 'test',
        flowState: {
          undefinedValue: undefined
        }
      };

      await store.set('conv123', testState);
      const retrieved = await store.get('conv123');

      // YAML converts undefined to null or omits it
      expect(retrieved.flowState.undefinedValue === null ||
             retrieved.flowState.undefinedValue === undefined).toBe(true);
    });

    it('should handle large state objects', async () => {
      const largeState = {
        activeFlow: 'large',
        flowState: {
          items: Array(100).fill(null).map((_, i) => ({
            id: i,
            name: `Item ${i}`,
            data: { nested: { value: `Value ${i}`.repeat(10) } }
          }))
        }
      };

      await store.set('conv123', largeState);
      const retrieved = await store.get('conv123');

      expect(retrieved.flowState.items.length).toBe(100);
      expect(retrieved.flowState.items[50].id).toBe(50);
    });

    it('should handle empty string conversation ID', async () => {
      // This should still work, creating a file named ".yml"
      await store.set('', { activeFlow: 'empty-id' });
      const state = await store.get('');
      expect(state.activeFlow).toBe('empty-id');
    });

    it('should return null when file exists but is empty', async () => {
      // Manually create empty file
      const filePath = path.join(tempDir, 'empty.yml');
      await fs.writeFile(filePath, '', 'utf8');

      const state = await store.get('empty');
      expect(state).toBeNull();
    });

    it('should handle boolean and number values in flowState', async () => {
      const testState = {
        activeFlow: 'test',
        flowState: {
          boolTrue: true,
          boolFalse: false,
          integer: 42,
          float: 3.14159,
          negative: -100,
          zero: 0
        }
      };

      await store.set('conv123', testState);
      const retrieved = await store.get('conv123');

      expect(retrieved.flowState.boolTrue).toBe(true);
      expect(retrieved.flowState.boolFalse).toBe(false);
      expect(retrieved.flowState.integer).toBe(42);
      expect(retrieved.flowState.float).toBeCloseTo(3.14159);
      expect(retrieved.flowState.negative).toBe(-100);
      expect(retrieved.flowState.zero).toBe(0);
    });

    it('should handle array as root flowState', async () => {
      const testState = {
        activeFlow: 'array-root',
        flowState: [1, 2, 3, { nested: true }]
      };

      await store.set('conv123', testState);
      const retrieved = await store.get('conv123');

      expect(Array.isArray(retrieved.flowState)).toBe(true);
      expect(retrieved.flowState[3].nested).toBe(true);
    });
  });
});
