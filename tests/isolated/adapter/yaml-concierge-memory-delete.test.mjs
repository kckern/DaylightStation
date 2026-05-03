// @vitest-environment node
/**
 * Targeted test for YamlConciergeMemoryAdapter.delete(key) — added in Phase C
 * to support `dscli memory delete`. Verifies idempotency and that the
 * underlying working-memory state actually loses the key after delete + save.
 */
import { describe, it, expect } from 'vitest';
import { YamlConciergeMemoryAdapter } from '#adapters/persistence/yaml/YamlConciergeMemoryAdapter.mjs';

/**
 * Tiny in-memory fake of YamlWorkingMemoryAdapter that tracks load/save calls.
 * The state object mimics WorkingMemoryState's get/set/remove/getAll surface.
 */
function makeFakeWorkingMemory(initial = {}) {
  const data = { ...initial };
  const state = {
    get(key) { return data[key]; },
    set(key, value) { data[key] = value; },
    remove(key) { delete data[key]; },
    getAll() { return { ...data }; },
  };
  let saveCount = 0;
  return {
    async load() { return state; },
    async save() { saveCount++; },
    _data: data,
    _saveCount: () => saveCount,
  };
}

describe('YamlConciergeMemoryAdapter.delete', () => {
  it('removes an existing key and returns true', async () => {
    const wm = makeFakeWorkingMemory({ notes: ['a', 'b'], prefs: { diet: 'low-carb' } });
    const mem = new YamlConciergeMemoryAdapter({ workingMemory: wm });

    const result = await mem.delete('notes');
    expect(result).toBe(true);
    expect(wm._data.notes).toBeUndefined();
    expect(wm._data.prefs).toEqual({ diet: 'low-carb' });
    expect(wm._saveCount()).toBe(1);
  });

  it('returns false for an absent key without saving', async () => {
    const wm = makeFakeWorkingMemory({ notes: ['a'] });
    const mem = new YamlConciergeMemoryAdapter({ workingMemory: wm });

    const result = await mem.delete('missing');
    expect(result).toBe(false);
    expect(wm._data.notes).toEqual(['a']);
    expect(wm._saveCount()).toBe(0);
  });

  it('is idempotent: second delete returns false', async () => {
    const wm = makeFakeWorkingMemory({ notes: ['a'] });
    const mem = new YamlConciergeMemoryAdapter({ workingMemory: wm });

    expect(await mem.delete('notes')).toBe(true);
    expect(await mem.delete('notes')).toBe(false);
  });
});
