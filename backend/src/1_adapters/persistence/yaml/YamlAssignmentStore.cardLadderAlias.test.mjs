import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlAssignmentStore } from './YamlAssignmentStore.mjs';

const roots = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); });

function storeWith(text) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assign-alias-')); roots.push(root);
  const file = path.join(root, 'school', 'plans', 'learners', 'learner-a.yml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  const configService = { getHouseholdPath: (rel) => path.join(root, rel) };
  return { store: new YamlAssignmentStore({ configService, logger: { error() {}, warn() {} } }), file };
}

describe('YamlAssignmentStore — pre-rename card-ladder enrollments', () => {
  const TEXT = [
    'learnerId: learner-a',
    'programs:',
    '  - { programId: flashcards, deckId: language/korean/week-01, corpusId: language/korean/week-01, title: Korean, policy: { mode: word-ladder } }',
    '  - { programId: flashcards, deckId: biology/cells, policy: { mode: fsrs } }',
    '',
  ].join('\n');

  it('reads policy.mode word-ladder as card-ladder and leaves other modes alone', async () => {
    const { store } = storeWith(TEXT);
    const record = await store.get('learner-a');
    expect(record.programs.map((row) => row.policy.mode)).toEqual(['card-ladder', 'fsrs']);
    expect(store.readProgramEnrollment('learner-a', 'language/korean/week-01').policy.mode).toBe('card-ladder');
  });

  it('never rewrites the file on read', async () => {
    const { store, file } = storeWith(TEXT);
    await store.get('learner-a');
    expect(fs.readFileSync(file, 'utf8')).toBe(TEXT);
  });
});
