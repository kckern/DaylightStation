// cli/karaoke-ingest/ingestRun.test.mjs
import { describe, it, expect } from 'vitest';
import { runIngest } from './ingestRun.mjs';

const baseCfg = {
  mediaDir: '/m', showName: 'Karaoke', formatSort: 'res:1080', mergeFormat: 'mp4', searchCount: 12,
  karaokeTerms: ['karaoke'], rejectTerms: [], channelWeights: {}, minDurationS: 90, maxDurationS: 480, scoreFloor: 0,
  seasonName: (n) => `Season ${n}`,
};
const pendingRow = (over) => ({ season: 1, episode: null, artist: 'Coldplay', song: 'Viva la Vida', searchHint: '', status: 'pending', videoId: '', ...over });

function fakeDeps(over = {}) {
  const calls = { downloads: [], embeds: [], saved: null, logs: [] };
  return {
    calls,
    deps: {
      search: async () => [{ id: 'vid1', title: 'Viva la Vida Karaoke', channel: 'Sing King', viewCount: 100, duration: 240 }],
      download: async (a) => { calls.downloads.push(a); },
      embed: async (a) => { calls.embeds.push(a); },
      fileExists: async () => false,
      saveRows: async (rows) => { calls.saved = rows; },
      log: (m) => calls.logs.push(m),
      ...over,
    },
  };
}

describe('runIngest', () => {
  it('downloads a pending row: search → download tmp → embed final → record video id', async () => {
    const { deps, calls } = fakeDeps();
    const rows = [pendingRow()];
    const summary = await runIngest({ rows, config: baseCfg, deps, options: {} });
    expect(summary.downloaded).toBe(1);
    expect(calls.downloads[0].outPath).toBe('/m/Karaoke - S01E01 - Viva la Vida (Coldplay).mp4.tmp.mp4');
    expect(calls.embeds[0].outPath).toBe('/m/Karaoke - S01E01 - Viva la Vida (Coldplay).mp4');
    expect(calls.embeds[0].title).toBe('Viva la Vida (Coldplay)');
    expect(calls.saved[0].status).toBe('downloaded');
    expect(calls.saved[0].videoId).toBe('vid1');
  });

  it('skips already-downloaded rows and does not save on dry-run', async () => {
    const { deps, calls } = fakeDeps();
    const rows = [pendingRow({ status: 'downloaded', episode: 1, videoId: 'old' })];
    const summary = await runIngest({ rows, config: baseCfg, deps, options: {} });
    expect(summary.skipped).toBe(1);
    expect(calls.downloads).toHaveLength(0);
  });

  it('marks failed when no candidate is acceptable', async () => {
    const { deps } = fakeDeps({ search: async () => [{ id: 'x', title: 'Unrelated Official Video', channel: 'z', viewCount: 9, duration: 200 }] });
    const summary = await runIngest({ rows: [pendingRow()], config: baseCfg, deps, options: {} });
    expect(summary.failed).toBe(1);
  });

  it('dry-run plans without downloading or saving', async () => {
    const { deps, calls } = fakeDeps();
    const summary = await runIngest({ rows: [pendingRow()], config: baseCfg, deps, options: { dryRun: true } });
    expect(summary.planned).toHaveLength(1);
    expect(calls.downloads).toHaveLength(0);
    expect(calls.saved).toBeNull();
  });
});
