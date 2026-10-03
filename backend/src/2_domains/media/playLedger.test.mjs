import { describe, it, expect } from 'vitest';
import { buildPlayLedgerRow, selectPlays, PLAY_LEDGER_RETENTION_DAYS } from './playLedger.mjs';

describe('buildPlayLedgerRow', () => {
  it('keeps the start facts and nothing else', () => {
    const row = buildPlayLedgerRow({
      deviceId: 'fleet:livingroom-tv', contentId: 'plex:12', startedAt: '2026-10-02T03:00:00.000Z', localTime: '2026-10-01 20:00:00',
      metadata: { title: 'S1E2', type: 'episode', parentId: '10', grandparentId: '100', summary: 'long' }, origin: 'routine:morning',
    });
    expect(row).toEqual({
      startedAt: '2026-10-02T03:00:00.000Z', localTime: '2026-10-01 20:00:00', deviceId: 'fleet:livingroom-tv', contentId: 'plex:12',
      title: 'S1E2', kind: 'episode', parentId: 'plex:10', grandparentId: 'plex:100', origin: 'routine:morning',
    });
  });
  it('nulls what is unknown and bounds origin', () => {
    const row = buildPlayLedgerRow({ deviceId: 'browser:a', contentId: 'files:x/y', startedAt: 't', localTime: 'l', origin: 'x'.repeat(200) });
    expect(row).toMatchObject({ title: null, kind: null, parentId: null, grandparentId: null });
    expect(row.origin).toHaveLength(64);
  });
  it('keeps 90 days', () => expect(PLAY_LEDGER_RETENTION_DAYS).toBe(90));
});

describe('selectPlays', () => {
  const rows = [
    { startedAt: '2026-10-01T10:00:00.000Z', deviceId: 'fleet:a', contentId: 'plex:1' },
    { startedAt: '2026-10-02T10:00:00.000Z', deviceId: 'browser:b', contentId: 'plex:2' },
    { startedAt: '2026-10-03T10:00:00.000Z', deviceId: 'fleet:a', contentId: 'plex:3' },
  ];
  it('filters by device and window, newest first, limited', () => {
    expect(selectPlays(rows, { deviceId: 'fleet:a' }).map((r) => r.contentId)).toEqual(['plex:3', 'plex:1']);
    expect(selectPlays(rows, { from: '2026-10-02T00:00:00Z', to: '2026-10-02T23:59:59Z' }).map((r) => r.contentId)).toEqual(['plex:2']);
    expect(selectPlays(rows, { limit: 1 }).map((r) => r.contentId)).toEqual(['plex:3']);
  });
});
