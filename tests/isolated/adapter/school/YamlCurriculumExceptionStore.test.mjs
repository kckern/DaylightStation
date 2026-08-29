import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlCurriculumExceptionStore } from '#adapters/persistence/yaml/YamlCurriculumExceptionStore.mjs';

const roots = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); });

function createStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'curriculum-exceptions-'));
  roots.push(root);
  return new YamlCurriculumExceptionStore({
    configService: { getHouseholdPath: (relative) => path.join(root, relative) },
  });
}

describe('YamlCurriculumExceptionStore', () => {
  it('serializes appends and derives active exceptions from the unchanged ledger records', async () => {
    const store = createStore();
    await Promise.all([
      store.append({ operation: 'applied', exceptionId: 'one', reason: 'test' }),
      store.append({ operation: 'retracted', exceptionId: 'one' }),
    ]);
    expect(await store.list()).toEqual([
      { operation: 'applied', exceptionId: 'one', reason: 'test' },
      { operation: 'retracted', exceptionId: 'one' },
    ]);
    expect(await store.active()).toEqual([]);
  });
});
