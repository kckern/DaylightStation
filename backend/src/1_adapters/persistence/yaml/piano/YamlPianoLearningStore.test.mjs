import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlPianoLearningStore } from './YamlPianoLearningStore.mjs';

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function store() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-learning-'));
  roots.push(root);
  return new YamlPianoLearningStore({
    usersDir: path.join(root, 'users'), assignmentsDir: path.join(root, 'household', 'programs'),
    clock: () => new Date('2026-08-12T17:00:00.000Z'),
  });
}

describe('YamlPianoLearningStore', () => {
  it('enrolls idempotently and removes only the requested program', () => {
    const subject = store();
    subject.enroll('learner4', 'hanon');
    subject.enroll('learner4', 'hanon');
    subject.enroll('learner4', 'scales');
    expect(subject.getEnrollments('learner4').map((entry) => entry.programId)).toEqual(['hanon', 'scales']);
    expect(subject.unenroll('learner4', 'hanon').map((entry) => entry.programId)).toEqual(['scales']);
  });

  it('guards assignment writes against stale teacher edits', () => {
    const subject = store();
    subject.putAssignment({ learnerId: 'learner4', programs: ['hanon'], assignedBy: 'dad', baseUpdatedAt: null });
    expect(() => subject.putAssignment({ learnerId: 'learner4', programs: [], assignedBy: 'dad', baseUpdatedAt: null }))
      .toThrow(/changed since/);
  });

  it('keeps one pending video checkpoint per content id', () => {
    const subject = store();
    subject.putPendingCheckpoint('learner4', { contentId: 'plex:123', title: 'First', requirement: { exercise_id: 'scale-c' } });
    subject.putPendingCheckpoint('learner4', { contentId: 'plex:123', title: 'Revised', requirement: { exercise_id: 'scale-d' } });
    expect(subject.getPendingCheckpoints('learner4')).toMatchObject([
      { contentId: 'plex:123', title: 'Revised', requirement: { exercise_id: 'scale-d' } },
    ]);
  });
});
