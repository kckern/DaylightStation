import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const execFileSync = vi.fn();
vi.mock('child_process', async (orig) => ({ ...(await orig()), execFileSync: (...a) => execFileSync(...a) }));
vi.mock('../../../__app_modules/media/media/server/adapters/content-filter/FfmpegRefineMedia.mjs', () => ({
  FfmpegRefineMedia: class { async probe() { return { width: 1920, height: 1080, fps: 24, duration: 100 }; } },
}));

const { prepareCopy } = await import('../../../__app_modules/media/media/cli/contentfilter/copySetup.mjs');

const plex = { MediaContainer: { Metadata: [{ title: 'T', Media: [{ Part: [{ id: 9, key: '/p' }] }] }] } };
const base = () => ({ rk: '1', flags: { src: '/x.mp4' }, mediaFilterDir: mkdtempSync(path.join(tmpdir(), 'cf-')), loadPlexConfig: () => ({ token: 't', host: 'h' }), getJson: async () => plex });

describe('prepareCopy skipTranscript (refine --kinds visual)', () => {
  beforeEach(() => execFileSync.mockClear());

  it('does not transcribe and returns a null transcript when none is cached', async () => {
    const r = await prepareCopy({ ...base(), skipTranscript: true });
    expect(r.transcript).toBeNull();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('transcribes as before when not skipped', async () => {
    const b = base();
    execFileSync.mockImplementationOnce(() => { throw new Error('transcribe called'); });
    await expect(prepareCopy(b)).rejects.toThrow('transcribe called');
  });
});
