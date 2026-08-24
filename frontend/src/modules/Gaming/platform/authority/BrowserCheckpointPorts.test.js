import { describe, expect, it } from 'vitest';
import { BrowserSessionJournal, BrowserSnapshotRepository } from './BrowserCheckpointPorts.js';

function storage() { const values = new Map(); return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) }; }

describe('browser checkpoint ports', () => {
  it('persists snapshots and append-only journals independently', async () => {
    const local = storage(); const snapshots = new BrowserSnapshotRepository({ storage: local, namespace: 'test' }); const journal = new BrowserSessionJournal({ storage: local, namespace: 'test' });
    const session = { header: { session_id: 's1', revision: 0 }, state: {} }; await snapshots.put(session, { expectedRevision: null }); await journal.create('s1', { header: session.header }); await journal.append('s1', { command: { command_id: 'c1' }, events: [] }, { expectedRevision: 0 });
    expect((await snapshots.get('s1')).header.revision).toBe(0); expect(await journal.read('s1')).toHaveLength(2);
  });
});
