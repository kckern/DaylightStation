import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlFitnessSchoolAttemptStore } from '#adapters/persistence/yaml/YamlFitnessSchoolAttemptStore.mjs';

const roots = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); });

function createStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fitness-school-attempt-'));
  roots.push(root);
  const logger = { warn: vi.fn() };
  return {
    root, logger,
    store: new YamlFitnessSchoolAttemptStore({
      configService: { getHouseholdPath: (relative, householdId) => path.join(root, householdId ?? 'default', relative) }, logger,
    }),
  };
}

describe('YamlFitnessSchoolAttemptStore', () => {
  it('round-trips the exact attempt record through an atomic YAML replacement', async () => {
    const { store } = createStore();
    const record = { schema: 'fitness.school-attempt/v1', workSessionId: 'work-1', score: 8 };
    await store.put(record, 'home-1');
    expect(await store.get('work-1', 'home-1')).toEqual(record);
  });

  it('keeps missing and malformed attempts absent and reports malformed input', async () => {
    const { root, store, logger } = createStore();
    expect(await store.get('missing')).toBeNull();
    const file = path.join(root, 'default/fitness/school-attempts/broken.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, ': malformed: [');
    expect(await store.get('broken')).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('fitness.school-attempt.read-failed', expect.objectContaining({ workSessionId: 'broken' }));
  });
});
