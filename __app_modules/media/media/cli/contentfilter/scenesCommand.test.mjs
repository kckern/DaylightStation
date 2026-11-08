import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { runScenes } from './scenesCommand.mjs';
import { refinedEdlName } from '../../server/domain/content-filter/refine/refinedEdl.mjs';

describe('runScenes source', () => {
  it('without --src uses the Plex part from prepareCopy, with no transcript', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'cf-scenes-'));
    const media = path.join(root, 'media'); const data = path.join(root, 'data');
    const edl = { title: 'T', sourceRef: { workId: 1, tagSetId: 2 }, cues: [] };
    for (const d of ['edl', 'refined']) mkdirSync(path.join(media, d), { recursive: true });
    mkdirSync(path.join(data, 'overrides'), { recursive: true });
    writeFileSync(path.join(media, 'edl', '9.edl.yml'), JSON.stringify(edl));
    writeFileSync(path.join(media, 'refined', refinedEdlName(edl)), JSON.stringify({ cues: [] }));
    writeFileSync(path.join(data, 'overrides', '9.yml'), JSON.stringify({ sync: { part: 'p', scale: 1, offsetSec: 0 } }));
    const calls = [];
    const prepare = async (o) => { calls.push(o); return { src: 'http://plex/part' }; };
    await expect(runScenes({ rk: '9', flags: {}, args: [], mediaFilterDir: media, dataFilterDir: data,
      getDecisionGateway: async () => null, prepare })).rejects.toThrow('No decision model');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ rk: '9', skipTranscript: true });
  });
});
