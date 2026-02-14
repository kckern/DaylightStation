// backend/tests/unit/agents/framework/WorkingMemoryState.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { WorkingMemoryState } from '../../../../src/3_applications/agents/framework/WorkingMemory.mjs';

describe('WorkingMemoryState', () => {
  let memory;

  beforeEach(() => {
    memory = new WorkingMemoryState();
  });

  describe('set/get', () => {
    it('should store and retrieve a value', () => {
      memory.set('key1', 'value1');
      assert.strictEqual(memory.get('key1'), 'value1');
    });

    it('should return undefined for missing key', () => {
      assert.strictEqual(memory.get('nonexistent'), undefined);
    });

    it('should overwrite existing key', () => {
      memory.set('key1', 'old');
      memory.set('key1', 'new');
      assert.strictEqual(memory.get('key1'), 'new');
    });

    it('should store complex values', () => {
      const obj = { nested: { data: [1, 2, 3] } };
      memory.set('complex', obj);
      assert.deepStrictEqual(memory.get('complex'), obj);
    });
  });

  describe('TTL expiry', () => {
    it('should return value before TTL expires', () => {
      memory.set('temp', 'data', { ttl: 60000 });
      assert.strictEqual(memory.get('temp'), 'data');
    });

    it('should return undefined after TTL expires', () => {
      memory.set('temp', 'data', { ttl: 0 });
      assert.strictEqual(memory.get('temp'), undefined);
    });

    it('should persist entries without TTL indefinitely', () => {
      memory.set('permanent', 'stays');
      assert.strictEqual(memory.get('permanent'), 'stays');
    });
  });

  describe('remove', () => {
    it('should remove an existing key', () => {
      memory.set('key1', 'value1');
      memory.remove('key1');
      assert.strictEqual(memory.get('key1'), undefined);
    });

    it('should not throw when removing nonexistent key', () => {
      assert.doesNotThrow(() => memory.remove('nonexistent'));
    });
  });

  describe('getAll', () => {
    it('should return all non-expired entries', () => {
      memory.set('a', 1);
      memory.set('b', 2);
      memory.set('expired', 3, { ttl: 0 });
      const all = memory.getAll();
      assert.deepStrictEqual(all, { a: 1, b: 2 });
    });

    it('should return empty object when empty', () => {
      assert.deepStrictEqual(memory.getAll(), {});
    });
  });

  describe('serialize', () => {
    it('should return "(empty)" when no entries', () => {
      assert.strictEqual(memory.serialize(), '(empty)');
    });

    it('should group persistent and expiring entries', () => {
      memory.set('permanent', 'stays');
      memory.set('temp', 'goes', { ttl: 60000 });
      const serialized = memory.serialize();
      assert.ok(serialized.includes('### Persistent'));
      assert.ok(serialized.includes('### Expiring'));
      assert.ok(serialized.includes('permanent'));
      assert.ok(serialized.includes('temp'));
    });

    it('should omit section header when no entries of that type', () => {
      memory.set('only_permanent', 'value');
      const serialized = memory.serialize();
      assert.ok(serialized.includes('### Persistent'));
      assert.ok(!serialized.includes('### Expiring'));
    });
  });

  describe('pruneExpired', () => {
    it('should remove expired entries', () => {
      memory.set('expired1', 'a', { ttl: 0 });
      memory.set('expired2', 'b', { ttl: 0 });
      memory.set('alive', 'c', { ttl: 60000 });
      memory.pruneExpired();
      assert.strictEqual(memory.get('expired1'), undefined);
      assert.strictEqual(memory.get('expired2'), undefined);
      assert.strictEqual(memory.get('alive'), 'c');
    });
  });

  describe('toJSON / fromJSON', () => {
    it('should round-trip through JSON serialization', () => {
      memory.set('persistent', 'value1');
      memory.set('expiring', 'value2', { ttl: 60000 });

      const json = memory.toJSON();
      const restored = WorkingMemoryState.fromJSON(json);

      assert.strictEqual(restored.get('persistent'), 'value1');
      assert.strictEqual(restored.get('expiring'), 'value2');
    });

    it('should prune expired entries on toJSON', () => {
      memory.set('expired', 'gone', { ttl: 0 });
      memory.set('alive', 'here');
      const json = memory.toJSON();
      assert.ok(!json.expired);
      assert.ok(json.alive);
    });
  });
});
