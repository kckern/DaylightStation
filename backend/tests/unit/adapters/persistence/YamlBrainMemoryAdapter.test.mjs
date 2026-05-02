import { describe, it } from 'node:test';
import assert from 'node:assert';
import { YamlBrainMemoryAdapter } from '../../../../src/1_adapters/persistence/yaml/YamlBrainMemoryAdapter.mjs';

// Working-memory shape exposing get/set (matches WorkingMemoryState).
class FakeStateGetSet {
  #map = new Map();
  get(k) { return this.#map.has(k) ? this.#map.get(k) : undefined; }
  set(k, v) { this.#map.set(k, v); }
}

class FakeWorkingMemoryGetSet {
  #state = new FakeStateGetSet();
  async load() { return this.#state; }
  async save() { /* noop — state is shared */ }
}

// Working-memory shape exposing .data (for backward-compat path).
class FakeWorkingMemoryDataMap {
  store = {};
  async load() { return { data: this.store }; }
  async save(_a, _u, state) { this.store = state.data ?? {}; }
}

describe('YamlBrainMemoryAdapter (get/set state)', () => {
  it('reads and writes household-scoped key/value', async () => {
    const wm = new FakeWorkingMemoryGetSet();
    const mem = new YamlBrainMemoryAdapter({ workingMemory: wm });
    await mem.set('preferences', { tone: 'casual' });
    const value = await mem.get('preferences');
    assert.deepStrictEqual(value, { tone: 'casual' });
  });

  it('merge combines partial values', async () => {
    const wm = new FakeWorkingMemoryGetSet();
    const mem = new YamlBrainMemoryAdapter({ workingMemory: wm });
    await mem.set('preferences', { tone: 'casual' });
    await mem.merge('preferences', { volume: 25 });
    assert.deepStrictEqual(await mem.get('preferences'), { tone: 'casual', volume: 25 });
  });

  it('returns null for missing key', async () => {
    const wm = new FakeWorkingMemoryGetSet();
    const mem = new YamlBrainMemoryAdapter({ workingMemory: wm });
    assert.strictEqual(await mem.get('absent'), null);
  });
});

describe('YamlBrainMemoryAdapter (data map state)', () => {
  it('falls back to .data property when get/set absent', async () => {
    const wm = new FakeWorkingMemoryDataMap();
    const mem = new YamlBrainMemoryAdapter({ workingMemory: wm });
    await mem.set('notes', [{ content: 'a' }]);
    assert.deepStrictEqual(await mem.get('notes'), [{ content: 'a' }]);
  });
});
