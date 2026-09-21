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
    header: { status: 'complete', artifacts: { content_pack: { id: 'charades:fhe', hash: 'content-hash' } } },
    state: { challenge_order: IDS.map((_, index) => index), clue_presentations: IDS.map((_, index) => [0, 2, 8, 10, 12, 15].includes(index) ? 'image' : 'text') },
  }));
  await fs.writeFile(path.join(gaming, 'definitions/content/content-hash.yml'), YAML.stringify({ challenges: IDS.map(id => ({ id })) }));
  await fs.writeFile(path.join(gaming, 'journals', `${SESSION}.jsonl`), IDS.map((_, index) => JSON.stringify({ events: [{ recorded_at: `2026-09-13T20:${String(index).padStart(2, '0')}:00.000Z`, event: { type: 'challenge.finished' } }] })).join('\n'));
  return dataDir;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('charades history reset CLI', () => {
  it('dry-runs the exact canonical order without writing', async () => {
    const dataDir = await fixture();
    let output = '';
    await runCli(['reset-fhe', '--from-session', SESSION], { dataDir, stdout: value => { output += value; } });
    expect(output).toContain(IDS.join('\n'));
    await expect(fs.access(path.join(dataDir, 'household/gaming/history/charades.yml'))).rejects.toThrow();
  });

  it('backs up existing history and replaces only FHE entries on apply', async () => {
    const dataDir = await fixture();
    const file = path.join(dataDir, 'household/gaming/history/charades.yml');
    const store = new YamlCharadesClueHistory({ file });
    await store.append('charades:other', { key: 'other:0', clue_id: 'camel' });
    await store.append('charades:fhe', { key: 'test:0', clue_id: 'test-only' });
    await runCli(['reset-fhe', '--from-session', SESSION, '--apply'], {
      dataDir, now: () => new Date('2026-09-20T12:34:56.000Z'), stdout: () => {},
    });
    expect((await store.list('charades:fhe')).map(entry => entry.clue_id)).toEqual(IDS);
    expect(await store.list('charades:other')).toEqual([{ key: 'other:0', clue_id: 'camel' }]);
    await expect(fs.access(`${file}.backup-20260920-123456`)).resolves.toBeUndefined();
  });
});
