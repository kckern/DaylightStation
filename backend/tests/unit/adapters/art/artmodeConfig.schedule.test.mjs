// backend/tests/unit/adapters/art/artmodeConfig.schedule.test.mjs
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { loadArtmodeConfig } from '#adapters/content/art/artmodeConfig.mjs';

// loadArtmodeConfig takes the HOUSEHOLD dir and joins `config/artmode.yml`
// itself — it is not given the data root. Passing dataPath made it look under
// <tmp>/config/, which never existed, so it fell back to defaults: the first
// case failed and the second ("defaults to [] when absent") passed vacuously,
// proving nothing because the file was never found either way.
let dataPath, householdPath;
beforeEach(async () => {
  dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'artmode-'));
  householdPath = path.join(dataPath, 'household');
  await fs.mkdir(path.join(householdPath, 'config'), { recursive: true });
});
afterEach(async () => { await fs.rm(dataPath, { recursive: true, force: true }); });

const write = (body) => fs.writeFile(path.join(householdPath, 'config', 'artmode.yml'), body, 'utf8');

describe('loadArtmodeConfig schedule', () => {
  it('returns the schedule array when present', async () => {
    await write('schedule:\n  - days: [mon]\n    start: "07:00"\n    end: "09:00"\n    preset: impressionism\n');
    const cfg = await loadArtmodeConfig(householdPath);
    expect(cfg.schedule).toEqual([{ days: ['mon'], start: '07:00', end: '09:00', preset: 'impressionism' }]);
  });

  it('defaults schedule to [] when absent', async () => {
    await write('presets:\n  gallery-silent: { collection: paintings }\n');
    const cfg = await loadArtmodeConfig(householdPath);
    expect(cfg.schedule).toEqual([]);
  });
});
