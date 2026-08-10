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
    const first = store.save('guest', { attempt_id: 'attempt-same', status: 'timeout', score: null });
    const repeated = store.save('guest', { attempt_id: 'attempt-same', status: 'error', score: null });
    expect(repeated).toEqual(first);
    expect(store.listRecent('guest')).toHaveLength(1);
  });
});
