import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlPianoAttemptStore } from './YamlPianoAttemptStore.mjs';

const scratch = [];
afterEach(() => { for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('YamlPianoAttemptStore.listCreatedBetween', () => {
  it('returns non-voided attempts created inside the window, reading only nearby day folders', () => {
    const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-attempts-'));
    scratch.push(usersDir);
    let now = new Date('2026-11-01T12:00:00Z');
    const store = new YamlPianoAttemptStore({ usersDir, clock: () => now });
    const save = (iso, id) => { now = new Date(iso); return store.save('kidB', { attempt_id: id, purpose: 'challenge', verdict: { passed: true } }); };
    save('2026-10-20T12:00:00Z', 'attempt-old');
    save('2026-11-02T03:00:00Z', 'attempt-early'); // before the window opens
    save('2026-11-03T12:00:00Z', 'attempt-in');
    save('2026-11-09T03:59:00Z', 'attempt-edge');
    save('2026-11-05T12:00:00Z', 'attempt-void');
    store.void('kidB', 'attempt-void', { reason: 'grader wrong' });
    const ids = store.listCreatedBetween('kidB', {
      fromMs: Date.parse('2026-11-02T04:00:00Z'), toMs: Date.parse('2026-11-09T04:00:00Z'),
    }).map((a) => a.attempt_id).sort();
    expect(ids).toEqual(['attempt-edge', 'attempt-in']);
    expect(store.listCreatedBetween('nobody', { fromMs: 0, toMs: 1 })).toEqual([]);
    expect(store.listCreatedBetween('../x', { fromMs: 0, toMs: 1 })).toEqual([]);
  });
});
