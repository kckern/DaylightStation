// backend/tests/unit/agents/framework/YamlWorkingMemoryAdapter.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { YamlWorkingMemoryAdapter } from '../../../../src/1_adapters/agents/YamlWorkingMemoryAdapter.mjs';

describe('YamlWorkingMemoryAdapter', () => {
  let adapter;
  let mockDataService;
  let storedData;

  beforeEach(() => {
    storedData = {};

    mockDataService = {
      user: {
        read(relativePath, username) {
          return storedData[`${username}:${relativePath}`] || null;
        },
        write(relativePath, data, username) {
          storedData[`${username}:${relativePath}`] = data;
          return true;
        },
      },
    };

    adapter = new YamlWorkingMemoryAdapter({ dataService: mockDataService });
  });

  describe('load', () => {
    it('should return empty WorkingMemoryState when no file exists', async () => {
      const state = await adapter.load('health-coach', 'kevin');
      assert.deepStrictEqual(state.getAll(), {});
    });

    it('should hydrate state from stored data', async () => {
      storedData['kevin:agents/health-coach/working-memory'] = {
        coaching_style: {
          value: 'direct feedback',
          createdAt: Date.now(),
          expiresAt: null,
        },
      };

      const state = await adapter.load('health-coach', 'kevin');
      assert.strictEqual(state.get('coaching_style'), 'direct feedback');
    });

    it('should prune expired entries on load', async () => {
      storedData['kevin:agents/health-coach/working-memory'] = {
        expired_item: {
          value: 'gone',
          createdAt: Date.now() - 120000,
          expiresAt: Date.now() - 60000,
        },
        alive_item: {
          value: 'here',
          createdAt: Date.now(),
          expiresAt: null,
        },
      };

      const state = await adapter.load('health-coach', 'kevin');
      assert.strictEqual(state.get('expired_item'), undefined);
      assert.strictEqual(state.get('alive_item'), 'here');
    });
  });

  describe('save', () => {
    it('should persist state via DataService', async () => {
      const state = await adapter.load('health-coach', 'kevin');
      state.set('my_key', 'my_value');

      await adapter.save('health-coach', 'kevin', state);

      const saved = storedData['kevin:agents/health-coach/working-memory'];
      assert.ok(saved);
      assert.strictEqual(saved.my_key.value, 'my_value');
    });
  });

  describe('constructor', () => {
    it('should throw if dataService is not provided', () => {
      assert.throws(
        () => new YamlWorkingMemoryAdapter({}),
        /dataService is required/
      );
    });
  });
});
