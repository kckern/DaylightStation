import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { YamlGamingSnapshotRepository } from './YamlGamingSnapshotRepository.mjs';
import { YamlGamingSessionJournal } from './YamlGamingSessionJournal.mjs';

describe('YAML Gaming snapshot plus journal', () => {
  it('fails closed on snapshot conflicts and corrupt journal lines', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gaming-persistence-')); const snapshots = new YamlGamingSnapshotRepository({ snapshotsDir: path.join(root, 'snapshots') }); const journal = new YamlGamingSessionJournal({ journalsDir: path.join(root, 'journals') });
    const session = { header: { session_id: 'game:one', revision: 0 }, state: {} };
    await snapshots.put(session, { expectedRevision: null });
    await expect(snapshots.put({ ...session, header: { ...session.header, revision: 1 } }, { expectedRevision: 9 })).rejects.toMatchObject({ code: 'revision_conflict' });
    await journal.create('game:one', { header: session.header }); await journal.append('game:one', { command: {}, events: [] }, { expectedRevision: 0 });
    fs.appendFileSync(path.join(root, 'journals', 'game:one.jsonl'), '{broken\n');
    await expect(journal.read('game:one')).rejects.toMatchObject({ code: 'journal_corrupt' });
  });

  it('serializes journal commits and preserves one winner for a revision', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gaming-persistence-')); const journal = new YamlGamingSessionJournal({ journalsDir: path.join(root, 'journals') });
    await journal.create('game:race', { header: { session_id: 'game:race', revision: 0 } });
    const outcomes = await Promise.allSettled([
      journal.append('game:race', { command: { command_id: 'a' }, events: [] }, { expectedRevision: 0 }),
      journal.append('game:race', { command: { command_id: 'b' }, events: [] }, { expectedRevision: 0 }),
    ]);
    expect(outcomes.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((entry) => entry.status === 'rejected')[0].reason).toMatchObject({ code: 'revision_conflict' });
    expect((await journal.read('game:race')).filter((entry) => entry.kind === 'command-committed')).toHaveLength(1);
  });
});
