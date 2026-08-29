import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { YamlSyllabusStore } from './YamlSyllabusStore.mjs';

const roots = [];

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'syllabus-store-'));
  roots.push(root);
  const logger = { error: vi.fn() };
  const store = new YamlSyllabusStore({
    configService: { getHouseholdPath: (relative) => path.join(root, relative) }, logger,
  });
  return { root, logger, store };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('YamlSyllabusStore', () => {
  it('persists, lists, and soft-archives a syllabus', async () => {
    const { store } = await fixture();
    const record = { syllabusId: 'math-7', title: 'Math 7', updatedAt: '2026-08-28T12:00:00.000Z' };

    await expect(store.put(record)).resolves.toEqual(record);
    await expect(store.list()).resolves.toEqual([record]);
    await expect(store.archive('math-7', { archivedBy: 'teacher', at: '2026-08-28T13:00:00.000Z' })).resolves.toMatchObject({
      archivedBy: 'teacher', archivedAt: '2026-08-28T13:00:00.000Z',
    });
    await expect(store.list()).resolves.toEqual([]);
  });

  it('refuses to overwrite a corrupt hand-edited file', async () => {
    const { root, logger, store } = await fixture();
    const file = path.join(root, 'school/plans/syllabi/math-7.yml');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'syllabusId: { broken', 'utf8');

    await expect(store.put({ syllabusId: 'math-7', title: 'Math 7' })).rejects.toMatchObject({ code: 'SYLLABUS_CORRUPT' });
    expect(logger.error).toHaveBeenCalledWith('school.syllabus.file-corrupt', expect.any(Object));
  });
});
