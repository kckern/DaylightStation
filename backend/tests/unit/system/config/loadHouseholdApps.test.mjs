import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig } from '#system/config/configLoader.mjs';

let dataDir;
beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cfgload-'));
  await fs.mkdir(path.join(dataDir, 'system', 'config'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'system', 'config', 'system.yml'), 'timezone: UTC\n');
  await fs.mkdir(path.join(dataDir, 'household'), { recursive: true });
  // Must be non-empty: loadAllHouseholds skips a household whose household.yml
  // parses to null, so an empty file would hide the household entirely.
  await fs.writeFile(path.join(dataDir, 'household', 'household.yml'), 'name: Test\n');
});
afterEach(async () => { await fs.rm(dataDir, { recursive: true, force: true }); });

const write = async (rel, body) => {
  const full = path.join(dataDir, 'household', rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body, 'utf8');
};
const apps = () => loadConfig(dataDir).households.default.apps;

describe('loadHouseholdApps', () => {
  it('loads a grouped config', async () => {
    await write('hardware/scales.yml', 'unit: g\n');
    expect(apps().scales).toEqual({ unit: 'g' });
  });

  it('loads a legacy flat config while data has not moved', async () => {
    await write('config/scales.yml', 'unit: kg\n');
    expect(apps().scales).toEqual({ unit: 'kg' });
  });

  it('lets the grouped config win over the legacy one', async () => {
    await write('hardware/scales.yml', 'unit: g\n');
    await write('config/scales.yml', 'unit: kg\n');
    expect(apps().scales).toEqual({ unit: 'g' });
  });

  it('does not invent an app for a registered path with no file', async () => {
    expect(apps().scales).toBeUndefined();
  });

  it('still loads an UNREGISTERED legacy config so nothing silently vanishes', async () => {
    await write('config/experimental-thing.yml', 'x: 1\n');
    expect(apps()['experimental-thing']).toEqual({ x: 1 });
  });
});
