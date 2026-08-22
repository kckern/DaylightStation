// backend/tests/unit/adapters/art/artmodeConfig.schedule.test.mjs
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { loadArtmodeConfig, loadArtCollections } from '#adapters/content/art/artmodeConfig.mjs';

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

const writeGrouped = async (body) => {
  await fs.mkdir(path.join(householdPath, 'art'), { recursive: true });
  return fs.writeFile(path.join(householdPath, 'art', 'artmode.yml'), body, 'utf8');
};

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

  it('reads the grouped art/artmode.yml', async () => {
    await writeGrouped('schedule:\n  - days: [tue]\n    start: "08:00"\n    end: "10:00"\n    preset: baroque\n');
    const cfg = await loadArtmodeConfig(householdPath);
    expect(cfg.schedule).toEqual([{ days: ['tue'], start: '08:00', end: '10:00', preset: 'baroque' }]);
  });

  it('prefers grouped over legacy when both exist', async () => {
    await writeGrouped('presets:\n  a: { collection: paintings }\n');
    await write('presets:\n  b: { collection: sketches }\n');
    const cfg = await loadArtmodeConfig(householdPath);
    expect(Object.keys(cfg.presets)).toEqual(['a']);
  });
});

// The collection catalog is the second facet of the same domain and follows the
// same rule. HOUSEHOLD_APP_CONFIGS.art is 'art/config', so grouped is
// art/config.yml and the retiring flat path is config/art.yml.
describe('loadArtCollections', () => {
  const writeLegacyArt = (body) => fs.writeFile(path.join(householdPath, 'config', 'art.yml'), body, 'utf8');
  const writeGroupedArt = async (body) => {
    await fs.mkdir(path.join(householdPath, 'art'), { recursive: true });
    return fs.writeFile(path.join(householdPath, 'art', 'config.yml'), body, 'utf8');
  };

  it('still reads the legacy config/art.yml', async () => {
    await writeLegacyArt('collections:\n  baroque: { query: caravaggio }\n');
    expect(await loadArtCollections(householdPath)).toEqual({ baroque: { query: 'caravaggio' } });
  });

  it('reads the grouped art/config.yml', async () => {
    await writeGroupedArt('collections:\n  impressionism: { query: monet }\n');
    expect(await loadArtCollections(householdPath)).toEqual({ impressionism: { query: 'monet' } });
  });

  it('prefers grouped over legacy when both exist', async () => {
    await writeGroupedArt('collections:\n  a: { query: grouped }\n');
    await writeLegacyArt('collections:\n  b: { query: legacy }\n');
    expect(Object.keys(await loadArtCollections(householdPath))).toEqual(['a']);
  });

  it('defaults to {} when absent at both paths', async () => {
    expect(await loadArtCollections(householdPath)).toEqual({});
  });
});
