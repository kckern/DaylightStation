// backend/tests/unit/adapters/art/artmodeConfig.schedule.test.mjs
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { loadArtmodeConfig } from '#adapters/content/art/artmodeConfig.mjs';

let dataPath;
beforeEach(async () => {
  dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'artmode-'));
  await fs.mkdir(path.join(dataPath, 'household', 'config'), { recursive: true });
});
afterEach(async () => { await fs.rm(dataPath, { recursive: true, force: true }); });

const write = (body) => fs.writeFile(path.join(dataPath, 'household', 'config', 'artmode.yml'), body, 'utf8');

describe('loadArtmodeConfig schedule', () => {
  it('returns the schedule array when present', async () => {
    await write('schedule:\n  - days: [mon]\n    start: "07:00"\n    end: "09:00"\n    preset: impressionism\n');
    const cfg = await loadArtmodeConfig(dataPath);
    expect(cfg.schedule).toEqual([{ days: ['mon'], start: '07:00', end: '09:00', preset: 'impressionism' }]);
  });

  it('defaults schedule to [] when absent', async () => {
    await write('presets:\n  gallery-silent: { collection: paintings }\n');
    const cfg = await loadArtmodeConfig(dataPath);
    expect(cfg.schedule).toEqual([]);
  });
});
