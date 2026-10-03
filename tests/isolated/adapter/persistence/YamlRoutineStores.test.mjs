// Routine history (household[-{id}]/history/media-routines.yml) and the
// imported routine catalog (household[-{id}]/media/routines.yml).
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { YamlRoutineHistoryDatastore } from '#adapters/persistence/yaml/YamlRoutineHistoryDatastore.mjs';
import { YamlRoutineSnapshotDatastore } from '#adapters/persistence/yaml/YamlRoutineSnapshotDatastore.mjs';

describe('routine YAML stores', () => {
  let dir;
  let configService;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'routine-stores-'));
    configService = { getHouseholdPath: (rel, hid) => join(dir, hid ? `household-${hid}` : 'household', rel) };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('history: empty reads [], round-trips runs, drops junk rows', async () => {
    const store = new YamlRoutineHistoryDatastore({ configService });
    expect(await store.load()).toEqual([]);
    const runs = [{ at: 't', routine: { id: 'r', name: 'R' }, deviceId: 'fleet:x', outcome: 'started' }];
    await store.save([...runs, null]);
    expect(await store.load()).toEqual(runs);
    expect(existsSync(join(dir, 'household', 'history', 'media-routines.yml'))).toBe(true);
  });

  test('snapshot: absent is null; round-trips with importedAt and source', async () => {
    const store = new YamlRoutineSnapshotDatastore({ configService });
    expect(await store.load()).toBeNull();
    const snapshot = { routines: [{ id: 'a', name: 'A', targets: [{ deviceId: 'fleet:x' }] }], importedAt: 't', source: 'cli' };
    await store.save(snapshot, 'h2');
    expect(await store.load('h2')).toEqual(snapshot);
    expect(existsSync(join(dir, 'household-h2', 'media', 'routines.yml'))).toBe(true);
  });
});
