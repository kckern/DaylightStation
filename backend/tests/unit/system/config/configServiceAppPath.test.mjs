import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { ConfigService } from '#system/config/ConfigService.mjs';

let dataDir;
beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cfgsvc-'));
});
afterEach(async () => { await fs.rm(dataDir, { recursive: true, force: true }); });

const write = async (rel, body) => {
  const full = path.join(dataDir, 'household', rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body, 'utf8');
};

// VERIFIED against ConfigService.mjs:22 — constructor(config, secretsHandler).
// getDataDir() reads config.system.dataDir (line 368) and
// getDefaultHouseholdId() reads config.system.defaultHouseholdId (line 86),
// so BOTH live under `system`, not at the top level.
const svc = () => new ConfigService({
  system: { dataDir, defaultHouseholdId: 'default' },
  households: { default: { _folderName: 'household', apps: {} } },
});

describe('ConfigService app config path resolution', () => {
  it('reads the grouped registry path even when a flat file also exists', async () => {
    await write('hardware/scales.yml', 'a: 1\n');
    await write('config/scales.yml', 'a: 2\n');
    expect(svc().reloadHouseholdAppConfig('default', 'scales')).toEqual({ a: 1 });
  });

  // INVERTED in Phase E (was 'falls back to the legacy flat path while data has
  // not moved yet'). The flat path is dead: a registered app with ONLY a flat
  // file must now read as absent, not as configured. Kept rather than deleted
  // because this is the exact assertion that would catch the fallback being
  // reintroduced.
  it('IGNORES the retired flat path — a flat-only config reads as absent', async () => {
    await write('config/scales.yml', 'a: 2\n');
    expect(svc().reloadHouseholdAppConfig('default', 'scales')).toBeNull();
  });

  // An app the registry does not know has no path at all. It must NOT degrade
  // to config/<app>.yml — that is what would recreate the retired directory on
  // the next admin write.
  it('returns no path for an UNREGISTERED app rather than a flat one', async () => {
    await write('config/experimental-thing.yml', 'a: 3\n');
    expect(svc().reloadHouseholdAppConfig('default', 'experimental-thing')).toBeNull();
    expect(svc().getHouseholdAppConfigPath('default', 'experimental-thing')).toBeNull();
  });

  it('resolves the WRITE path to the same file the read side picked', async () => {
    await write('hardware/scales.yml', 'a: 1\n');
    expect(svc().getHouseholdAppConfigPath('default', 'scales'))
      .toBe(path.join(dataDir, 'household', 'hardware', 'scales.yml'));
  });

  it('defaults an unwritten config to its grouped path, not the legacy one', () => {
    expect(svc().getHouseholdAppConfigPath('default', 'sheets'))
      .toBe(path.join(dataDir, 'household', 'sheets', 'config.yml'));
  });
});
