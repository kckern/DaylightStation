// backend/tests/unit/adapters/art/artmodeConfig.schedule.test.mjs
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { loadArtmodeConfig, loadArtCollections } from '#adapters/content/art/artmodeConfig.mjs';

// loadArtmodeConfig takes the HOUSEHOLD dir and joins its own relative path —
// it is not given the data root. Passing dataPath made it look under <tmp>/…,
// which never existed, so it fell back to defaults and the "defaults to []
// when absent" case passed vacuously, proving nothing.
//
// Phase E: `art/artmode.yml` is now the ONLY path. `writeFlat` still exists so
// the inverted cases below can prove the retired `config/` file is IGNORED —
// deleting those cases would leave the removal unguarded.
let dataPath, householdPath;
beforeEach(async () => {
  dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'artmode-'));
  householdPath = path.join(dataPath, 'household');
  await fs.mkdir(path.join(householdPath, 'config'), { recursive: true });
});
afterEach(async () => { await fs.rm(dataPath, { recursive: true, force: true }); });

const writeFlat = (body) => fs.writeFile(path.join(householdPath, 'config', 'artmode.yml'), body, 'utf8');

const writeGrouped = async (body) => {
  await fs.mkdir(path.join(householdPath, 'art'), { recursive: true });
  return fs.writeFile(path.join(householdPath, 'art', 'artmode.yml'), body, 'utf8');
};

describe('loadArtmodeConfig schedule', () => {
  it('returns the schedule array when present', async () => {
    await writeGrouped('schedule:\n  - days: [mon]\n    start: "07:00"\n    end: "09:00"\n    preset: impressionism\n');
    const cfg = await loadArtmodeConfig(householdPath);
    expect(cfg.schedule).toEqual([{ days: ['mon'], start: '07:00', end: '09:00', preset: 'impressionism' }]);
  });

  it('defaults schedule to [] when absent', async () => {
    await writeGrouped('presets:\n  gallery-silent: { collection: paintings }\n');
    const cfg = await loadArtmodeConfig(householdPath);
    expect(cfg.schedule).toEqual([]);
  });

  it('reads the grouped art/artmode.yml', async () => {
    await writeGrouped('schedule:\n  - days: [tue]\n    start: "08:00"\n    end: "10:00"\n    preset: baroque\n');
    const cfg = await loadArtmodeConfig(householdPath);
    expect(cfg.schedule).toEqual([{ days: ['tue'], start: '08:00', end: '10:00', preset: 'baroque' }]);
  });

  // INVERTED in Phase E (was 'prefers grouped over legacy when both exist').
  // Preference is no longer the claim — the flat file must not be consulted at
  // all, so a flat file ALONE yields defaults rather than its contents.
  it('IGNORES the retired flat config/artmode.yml entirely', async () => {
    await writeFlat('presets:\n  b: { collection: sketches }\n  schedule: []\n');
    const cfg = await loadArtmodeConfig(householdPath);
    expect(cfg.presets).toEqual({});

    await writeGrouped('presets:\n  a: { collection: paintings }\n');
    expect(Object.keys((await loadArtmodeConfig(householdPath)).presets)).toEqual(['a']);
  });
});

// The collection catalog is the second facet of the same domain and follows the
// same rule. HOUSEHOLD_APP_CONFIGS.art is 'art/config', so the catalog lives at
// art/config.yml. The retired flat path was config/art.yml.
describe('loadArtCollections', () => {
  const writeFlatArt = (body) => fs.writeFile(path.join(householdPath, 'config', 'art.yml'), body, 'utf8');
  const writeGroupedArt = async (body) => {
    await fs.mkdir(path.join(householdPath, 'art'), { recursive: true });
    return fs.writeFile(path.join(householdPath, 'art', 'config.yml'), body, 'utf8');
  };

  // INVERTED in Phase E (was 'still reads the legacy config/art.yml').
  it('IGNORES the retired flat config/art.yml', async () => {
    await writeFlatArt('collections:\n  baroque: { query: caravaggio }\n');
    expect(await loadArtCollections(householdPath)).toEqual({});
  });

  it('reads the grouped art/config.yml', async () => {
    await writeGroupedArt('collections:\n  impressionism: { query: monet }\n');
    expect(await loadArtCollections(householdPath)).toEqual({ impressionism: { query: 'monet' } });
  });

  // INVERTED in Phase E (was 'prefers grouped over legacy when both exist').
  it('reads only the grouped file when a flat one also exists', async () => {
    await writeGroupedArt('collections:\n  a: { query: grouped }\n');
    await writeFlatArt('collections:\n  b: { query: legacy }\n');
    expect(Object.keys(await loadArtCollections(householdPath))).toEqual(['a']);
  });

  it('defaults to {} when the grouped file is absent', async () => {
    expect(await loadArtCollections(householdPath)).toEqual({});
  });
});
