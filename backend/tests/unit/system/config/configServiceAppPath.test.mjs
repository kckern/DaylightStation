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
  it('prefers the grouped registry path', async () => {
    await write('hardware/scales.yml', 'a: 1\n');
    await write('config/scales.yml', 'a: 2\n');
    expect(svc().reloadHouseholdAppConfig('default', 'scales')).toEqual({ a: 1 });
  });

  it('falls back to the legacy flat path while data has not moved yet', async () => {
    await write('config/scales.yml', 'a: 2\n');
    expect(svc().reloadHouseholdAppConfig('default', 'scales')).toEqual({ a: 2 });
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
