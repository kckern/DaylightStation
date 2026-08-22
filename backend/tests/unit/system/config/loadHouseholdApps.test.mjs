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

  // INVERTED in Phase E (was 'loads a legacy flat config while data has not
  // moved'). The config/ scan is gone, so a flat file no longer produces an app.
  it('IGNORES a flat config/<app>.yml — it no longer produces an app', async () => {
    await write('config/scales.yml', 'unit: kg\n');
    expect(apps().scales).toBeUndefined();
  });

  // INVERTED in Phase E (was 'lets the grouped config win over the legacy one').
  // Not precedence any more — the flat file is simply not read.
  it('loads the grouped config and never merges a flat one over it', async () => {
    await write('hardware/scales.yml', 'unit: g\n');
    await write('config/scales.yml', 'unit: kg\n');
    expect(apps().scales).toEqual({ unit: 'g' });
  });

  it('does not invent an app for a registered path with no file', async () => {
    expect(apps().scales).toBeUndefined();
  });

  // INVERTED in Phase E (was 'still loads an UNREGISTERED legacy config so
  // nothing silently vanishes'). That guarantee is now carried by
  // registryCompleteness.test.mjs, which fails against the REAL data dir if any
  // app config exists that the registry does not know — a check the fallback
  // made impossible to run, since the fallback hid every omission. Here we
  // assert the flat scan cannot invent an app NAME: it was the only thing that
  // could put a name into the app map that the registry never declared.
  it('cannot invent an app name from a stray flat file', async () => {
    await write('config/experimental-thing.yml', 'x: 1\n');
    expect(apps()['experimental-thing']).toBeUndefined();
    expect(Object.keys(apps())).toEqual([]);
  });

  // household.yml / integrations.yml / devices.yml were name-filtered out of the
  // old flat scan. With the scan gone they cannot leak in as apps at all.
  it('never surfaces non-app config as an app', async () => {
    await write('config/household.yml', 'name: X\n');
    await write('config/integrations.yml', 'plex: {}\n');
    await write('config/devices.yml', 'devices: {}\n');
    expect(Object.keys(apps())).toEqual([]);
  });
});
