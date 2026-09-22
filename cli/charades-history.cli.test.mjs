import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlCharadesClueHistory } from '#adapters/persistence/yaml/gaming/YamlCharadesClueHistory.mjs';
import { runCli } from './charades-history.cli.mjs';

const roots = [];
const SESSION = 'game:canonical';
const IDS = ['rabbit', 'climbing-a-ladder', 'elephant', 'catching-a-butterfly', 'driving-a-car', 'carrying-a-heavy-box', 'making-pizza', 'blowing-out-birthday-candles', 'turtle', 'picking-apples', 'koala', 'washing-your-hair', 'duck', 'shooting-a-basketball', 'vacuuming-a-rug', 'alligator', 'peeling-a-banana', 'catching-popcorn-in-your-mouth'];

async function fixture() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'charades-history-cli-'));
  roots.push(dataDir);
  const gaming = path.join(dataDir, 'household/gaming');
  await fs.mkdir(path.join(gaming, 'snapshots'), { recursive: true });
  await fs.mkdir(path.join(gaming, 'journals'), { recursive: true });
  await fs.mkdir(path.join(gaming, 'definitions/content'), { recursive: true });
  await fs.writeFile(path.join(gaming, 'snapshots', `${SESSION}.yml`), YAML.stringify({
    header: { session_id: SESSION, status: 'complete', artifacts: { content_pack: { id: 'charades:fhe', hash: 'content-hash' } } },
    state: { challenge_order: IDS.map((_, index) => index), clue_presentations: IDS.map((_, index) => [0, 2, 8, 10, 12, 15].includes(index) ? 'image' : 'text') },
  }));
  await fs.writeFile(path.join(gaming, 'definitions/content/content-hash.yml'), YAML.stringify({ challenges: IDS.map(id => ({ id })) }));
  await fs.writeFile(path.join(gaming, 'journals', `${SESSION}.jsonl`), IDS.map((id, index) => JSON.stringify({ events: [{ recorded_at: `2026-09-13T20:${String(index).padStart(2, '0')}:00.000Z`, event: { type: 'challenge.finished', challenge_index: index, clue_index: 0, clue_id: id } }] })).join('\n'));
  return dataDir;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('charades history import CLI', () => {
  it('imports completed turns additively and remains idempotent', async () => {
    const dataDir = await fixture();
    const gaming = path.join(dataDir, 'household/gaming');
    const snapshotFile = path.join(gaming, 'snapshots', `${SESSION}.yml`);
    const snapshot = YAML.parse(await fs.readFile(snapshotFile, 'utf8'));
    snapshot.header.status = 'active';
    await fs.writeFile(snapshotFile, YAML.stringify(snapshot));
    const journalFile = path.join(gaming, 'journals', `${SESSION}.jsonl`);
    const journal = (await fs.readFile(journalFile, 'utf8')).split('\n').slice(0, 2).join('\n');
    await fs.writeFile(journalFile, journal);

    const file = path.join(gaming, 'history/charades.yml');
    const store = new YamlCharadesClueHistory({ file });
    await store.append('charades:fhe', {
      key: `legacy:${SESSION}:0`, clue_id: 'rabbit', session_id: SESSION,
      challenge_index: 0, clue_index: 0, played_at: '2026-09-13T20:00:00.000Z',
    });
    await store.append('charades:fhe', { key: 'existing:later', clue_id: 'later', played_at: '2026-09-14T21:00:00.000Z' });

    await runCli(['import-fhe', '--from-session', SESSION, '--apply'], {
      dataDir, now: () => new Date('2026-09-20T12:34:56.000Z'), stdout: () => {},
    });
    const firstBackup = `${file}.backup-20260920-123456-000`;
    const backupBeforeRetry = await fs.readFile(firstBackup, 'utf8');
    const retry = await runCli(['import-fhe', '--from-session', SESSION, '--apply'], {
      dataDir, now: () => new Date('2026-09-20T12:34:56.001Z'), stdout: () => {},
    });

    expect((await store.list('charades:fhe')).map(entry => entry.clue_id)).toEqual([
      'rabbit', 'climbing-a-ladder', 'later',
    ]);
    expect(retry).toMatchObject({ applied: false, entries: [] });
    expect(await fs.readFile(firstBackup, 'utf8')).toBe(backupBeforeRetry);
    await expect(fs.access(`${file}.backup-20260920-123456-001`)).rejects.toThrow();
  });

  it('rejects diagnostic sessions even when they use the FHE content pack', async () => {
    const dataDir = await fixture();
    const gaming = path.join(dataDir, 'household/gaming');
    const diagnostic = 'diagnostic:canonical';
    await fs.copyFile(path.join(gaming, 'snapshots', `${SESSION}.yml`), path.join(gaming, 'snapshots', `${diagnostic}.yml`));
    await fs.copyFile(path.join(gaming, 'journals', `${SESSION}.jsonl`), path.join(gaming, 'journals', `${diagnostic}.jsonl`));

    await expect(runCli(['import-fhe', '--from-session', diagnostic], { dataDir, stdout: () => {} }))
      .rejects.toThrow('real game session');
  });

  it('uses authoritative event indexes with a nontrivial challenge order', async () => {
    const dataDir = await fixture();
    const gaming = path.join(dataDir, 'household/gaming');
    const snapshotFile = path.join(gaming, 'snapshots', `${SESSION}.yml`);
    const snapshot = YAML.parse(await fs.readFile(snapshotFile, 'utf8'));
    [snapshot.state.challenge_order[0], snapshot.state.challenge_order[1]] = [1, 0];
    await fs.writeFile(snapshotFile, YAML.stringify(snapshot));
    const journalFile = path.join(gaming, 'journals', `${SESSION}.jsonl`);
    const journal = (await fs.readFile(journalFile, 'utf8')).split('\n').slice(0, 2).join('\n');
    await fs.writeFile(journalFile, journal);

    const result = await runCli(['import-fhe', '--from-session', SESSION], { dataDir, stdout: () => {} });

    expect(result.entries.map(entry => entry.clue_id)).toEqual(['climbing-a-ladder', 'rabbit']);
  });

  it('dry-runs the played order without writing', async () => {
    const dataDir = await fixture();
    let output = '';
    await runCli(['import-fhe', '--from-session', SESSION], { dataDir, stdout: value => { output += value; } });
    expect(output).toContain(IDS.join('\n'));
    await expect(fs.access(path.join(dataDir, 'household/gaming/history/charades.yml'))).rejects.toThrow();
  });

  it('backs up existing history and preserves existing entries on apply', async () => {
    const dataDir = await fixture();
    const file = path.join(dataDir, 'household/gaming/history/charades.yml');
    const store = new YamlCharadesClueHistory({ file });
    await store.append('charades:other', { key: 'other:0', clue_id: 'camel' });
    await store.append('charades:fhe', { key: 'test:0', clue_id: 'test-only' });
    await runCli(['import-fhe', '--from-session', SESSION, '--apply'], {
      dataDir, now: () => new Date('2026-09-20T12:34:56.000Z'), stdout: () => {},
    });
    expect((await store.list('charades:fhe')).map(entry => entry.clue_id)).toEqual(['test-only', ...IDS]);
    expect(await store.list('charades:other')).toEqual([{ key: 'other:0', clue_id: 'camel' }]);
    await expect(fs.access(`${file}.backup-20260920-123456-000`)).resolves.toBeUndefined();
  });
});
