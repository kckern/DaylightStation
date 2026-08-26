import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlPianoAttemptStore } from './YamlPianoAttemptStore.mjs';

const scratch = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('YamlPianoAttemptStore', () => {
  it('returns recent attempts newest-first for pedagogy selection', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-attempts-'));
    scratch.push(root);
    let now = new Date('2026-08-09T12:00:00.000Z');
    const store = new YamlPianoAttemptStore({ usersDir: root, clock: () => now });
    store.save('guest', { attempt_id: 'attempt-1', status: 'completed', score: 1 });
    now = new Date('2026-08-10T12:00:00.000Z');
    store.save('guest', { attempt_id: 'attempt-2', status: 'completed', score: 0.5 });
    expect(store.listRecent('guest', { limit: 1 })).toEqual([
      expect.objectContaining({ attempt_id: 'attempt-2', score: 0.5 }),
    ]);
  });

  it('is idempotent for a repeated attempt id', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-attempts-'));
    scratch.push(root);
    const store = new YamlPianoAttemptStore({ usersDir: root });
    const payload = { attempt_id: 'attempt-same', status: 'timeout', diagnostics: { matched_notes: 1 } };
    const first = store.save('guest', payload);
    const repeated = store.save('guest', structuredClone(payload));
    expect(repeated).toEqual(first);
    expect(store.listRecent('guest')).toHaveLength(1);
  });

  it('rejects reuse of an attempt id for a different payload', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-attempts-'));
    scratch.push(root);
    const store = new YamlPianoAttemptStore({ usersDir: root });
    store.save('learner4', { attempt_id: 'attempt-conflict', status: 'timeout' });
    expect(() => store.save('learner4', { attempt_id: 'attempt-conflict', status: 'aborted' })).toThrow(expect.objectContaining({
      code: 'idempotency_conflict', status: 409,
    }));
    expect(store.listRecent('learner4')).toHaveLength(1);
  });

  it('finds an idempotent retry across UTC day directories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-attempts-'));
    scratch.push(root);
    let now = new Date('2026-08-09T23:59:59.000Z');
    const store = new YamlPianoAttemptStore({ usersDir: root, clock: () => now });
    const payload = { attempt_id: 'attempt-midnight', status: 'completed', score: 1 };
    const first = store.save('learner4', payload);
    now = new Date('2026-08-10T00:00:01.000Z');
    expect(store.save('learner4', payload)).toEqual(first);
    expect(store.listRecent('learner4')).toHaveLength(1);
  });
});
