import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlFitnessCourseProjectionStore } from '#adapters/persistence/yaml/YamlFitnessCourseProjectionStore.mjs';

const roots = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fitness-projection-store-'));
  roots.push(root);
  const logger = { warn: vi.fn() };
  return {
    root,
    logger,
    store: new YamlFitnessCourseProjectionStore({
      configService: { getHouseholdPath: (relative) => path.join(root, relative) }, logger,
    }),
  };
}

describe('YamlFitnessCourseProjectionStore', () => {
  it('atomically stores and reads the unchanged projection schema', async () => {
    const { store } = makeStore();
    const saved = await store.put('strength-101', { title: 'Strength', units: [{ id: 'u1' }] });
    expect(saved.schema).toBe('school.fitness-course-projection/v1');
    expect(await store.get('strength-101')).toEqual(saved);
  });

  it('treats missing and malformed records as absent while retaining read warnings', async () => {
    const { root, store, logger } = makeStore();
    expect(await store.get('missing')).toBeNull();
    const file = path.join(root, 'school/runtime/fitness-course-projections/broken.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, ': malformed: [');
    expect(await store.get('broken')).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('school.fitness-course.snapshot-read-failed', expect.objectContaining({ work: 'broken' }));
  });
});
