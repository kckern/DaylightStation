import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { YamlPlayLedgerDatastore } from '#adapters/persistence/yaml/YamlPlayLedgerDatastore.mjs';
import { PLAY_LEDGER_RETENTION_DAYS } from '#domains/media/playLedger.mjs';

describe('YamlPlayLedgerDatastore', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'play-ledger-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const row = (localTime, contentId) => ({ startedAt: `${localTime.replace(' ', 'T')}.000Z`, localTime, deviceId: 'fleet:tv', contentId });

  test('appends one file per local day and lists rows back', async () => {
    const store = new YamlPlayLedgerDatastore({ root: dir, retentionDays: 90, today: () => '2026-10-02' });
    await store.append(row('2026-10-01 20:00:00', 'plex:1'));
    await store.append(row('2026-10-02 08:00:00', 'plex:2'));
    await store.append(row('2026-10-02 09:00:00', 'plex:3'));
    expect(readdirSync(dir).sort()).toEqual(['2026-10-01.yml', '2026-10-02.yml']);
    expect((await store.list({ fromDay: '2026-10-02' })).map((r) => r.contentId)).toEqual(['plex:2', 'plex:3']);
    expect((await store.list({})).map((r) => r.contentId)).toEqual(['plex:1', 'plex:2', 'plex:3']);
  });

  test('prunes day files past retention when it writes', async () => {
    writeFileSync(join(dir, '2026-01-01.yml'), '- contentId: old\n');
    writeFileSync(join(dir, '2026-07-05.yml'), '- contentId: keep\n');
    const store = new YamlPlayLedgerDatastore({ root: dir, retentionDays: 90, today: () => '2026-10-02' });
    await store.append(row('2026-10-02 08:00:00', 'plex:2'));
    expect(readdirSync(dir).sort()).toEqual(['2026-07-05.yml', '2026-10-02.yml']);
  });

  test('with the production retention, day 90 is kept and day 91 is pruned', async () => {
    writeFileSync(join(dir, '2026-07-03.yml'), '- contentId: day-91\n');
    writeFileSync(join(dir, '2026-07-04.yml'), '- contentId: day-90\n');
    const store = new YamlPlayLedgerDatastore({ root: dir, retentionDays: PLAY_LEDGER_RETENTION_DAYS, today: () => '2026-10-02' });
    await store.append(row('2026-10-02 08:00:00', 'plex:2'));
    expect(readdirSync(dir).sort()).toEqual(['2026-07-04.yml', '2026-10-02.yml']);
  });
});
