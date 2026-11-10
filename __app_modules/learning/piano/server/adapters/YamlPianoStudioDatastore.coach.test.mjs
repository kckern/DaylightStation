// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { YamlPianoStudioDatastore } from './YamlPianoStudioDatastore.mjs';
const roots = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
it('writes the complete coaching summary while retaining legacy progress and refusing an unknown profile', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-coach-summary-'));roots.push(root);
  const datastore = new YamlPianoStudioDatastore({ configService: {
    getUserProfile: (id) => id === 'learner4' ? { id } : null,
    getUserDir: (id) => path.join(root, id),
  } });
  const record = { learn: { revision: 'old' }, measures: { 0: { rh: { passes: 6 } } }, learnCoach: { revision: 1, achievements: { notes: true } } };
  expect(datastore.savePracticeAtomic('learner4', 'files-test', record)).toBe(true);
  expect(datastore.getPractice('learner4', 'files-test')).toEqual(record);
  expect(datastore.savePracticeAtomic('unknown', 'files-test', record)).toBe(false);
  expect(fs.existsSync(path.join(root, 'unknown'))).toBe(false);
});
