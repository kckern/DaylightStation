// backend/tests/unit/adapters/ambient/YamlAmbientStateStore.test.mjs
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { YamlAmbientStateStore } from '#adapters/ambient/YamlAmbientStateStore.mjs';

let dataDir;
beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ambient-state-'));
});
afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('YamlAmbientStateStore', () => {
  it('returns a default empty state when the file is absent', async () => {
    const store = new YamlAmbientStateStore({ dataDir });
    expect(await store.load()).toEqual({ owned: null, handled: {} });
  });

  it('round-trips state through save/load', async () => {
    const store = new YamlAmbientStateStore({ dataDir });
    const state = {
      owned: { key: 'am', device: 'livingroom-tv', preset: 'impressionism', startedAt: '2026-06-22T14:00:00Z' },
      handled: { '2026-06-22': { am: { startHandled: true, endHandled: false } } },
    };
    await store.save(state);
    expect(await store.load()).toEqual(state);
  });

  it('writes to system/state/ambient-runtime.yml', async () => {
    const store = new YamlAmbientStateStore({ dataDir });
    await store.save({ owned: null, handled: {} });
    const raw = await fs.readFile(path.join(dataDir, 'system', 'state', 'ambient-runtime.yml'), 'utf8');
    expect(raw).toContain('owned:');
  });
});
