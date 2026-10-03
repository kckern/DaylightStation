/**
 * One ledger row per playback START per screen. Starts are derived from the
 * progress-ping stream by PlaybackSessionRegistry.record() returning opened.
 */
import { describe, it, expect, vi } from 'vitest';
import { PlayLedgerRecorder } from './PlayLedgerRecorder.mjs';

function build() {
  const rows = [];
  const store = { append: vi.fn(async (row) => { rows.push(row); }), list: vi.fn(async () => rows) };
  const recorder = new PlayLedgerRecorder({ store, logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() }, resumeGapMs: 15 * 60_000 });
  return { recorder, rows, store };
}
const at = (min) => ({ atEpoch: Date.UTC(2026, 9, 2, 20, min), startedAt: new Date(Date.UTC(2026, 9, 2, 20, min)).toISOString(), localTime: `2026-10-02 13:${String(min).padStart(2, '0')}:00` });

describe('PlayLedgerRecorder', () => {
  it('writes a row when a screen starts an item, not on every heartbeat', async () => {
    const { recorder, rows } = build();
    await recorder.observe({ deviceId: 'fleet:tv', contentId: 'plex:1', ...at(0) });
    await recorder.observe({ deviceId: 'fleet:tv', contentId: 'plex:1', ...at(1) });
    await recorder.observe({ deviceId: 'fleet:tv', contentId: 'plex:1', ...at(2) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ deviceId: 'fleet:tv', contentId: 'plex:1', localTime: '2026-10-02 13:00:00' });
  });
  it('a different item on the same screen is a new start; another screen is its own', async () => {
    const { recorder, rows } = build();
    await recorder.observe({ deviceId: 'fleet:tv', contentId: 'plex:1', ...at(0) });
    await recorder.observe({ deviceId: 'browser:kid', contentId: 'plex:1', ...at(1) });
    await recorder.observe({ deviceId: 'fleet:tv', contentId: 'plex:2', ...at(2) });
    expect(rows.map((r) => `${r.deviceId}|${r.contentId}`)).toEqual(['fleet:tv|plex:1', 'browser:kid|plex:1', 'fleet:tv|plex:2']);
  });
  it('coming back to the same item after a long quiet gap is a new start', async () => {
    const { recorder, rows } = build();
    await recorder.observe({ deviceId: 'fleet:tv', contentId: 'plex:1', ...at(0) });
    await recorder.observe({ deviceId: 'fleet:tv', contentId: 'plex:1', ...at(10) });
    await recorder.observe({ deviceId: 'fleet:tv', contentId: 'plex:1', ...at(40) });
    expect(rows).toHaveLength(2);
  });
  it('a store failure is logged, never thrown into play/log', async () => {
    const { recorder, store } = build();
    store.append.mockRejectedValueOnce(new Error('disk'));
    await expect(recorder.observe({ deviceId: 'fleet:tv', contentId: 'plex:1', ...at(0) })).resolves.toEqual({ opened: true, written: false });
  });
});
