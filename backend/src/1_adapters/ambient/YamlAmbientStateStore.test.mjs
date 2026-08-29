import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { YamlAmbientStateStore } from './YamlAmbientStateStore.mjs';

let dataDir;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ambient-state-store-'));
});

describe('YamlAmbientStateStore', () => {
  it('returns the empty runtime state when no persisted state exists', async () => {
    const store = new YamlAmbientStateStore({ dataDir });

    await expect(store.load()).resolves.toEqual({ owned: null, handled: {} });
  });

  it('persists only the runtime state shape it owns', async () => {
    const store = new YamlAmbientStateStore({ dataDir });

    await store.save({ owned: 'quiet-hours', handled: { display: '2026-08-28T12:00:00Z' }, ignored: true });

    await expect(store.load()).resolves.toEqual({
      owned: 'quiet-hours', handled: { display: '2026-08-28T12:00:00Z' },
    });
  });

  it('warns and degrades to an empty state for malformed YAML', async () => {
    const logger = { warn: vi.fn() };
    const store = new YamlAmbientStateStore({ dataDir, logger });
    const file = path.join(dataDir, 'system/state/ambient-runtime.yml');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'owned: { broken', 'utf8');

    await expect(store.load()).resolves.toEqual({ owned: null, handled: {} });
    expect(logger.warn).toHaveBeenCalledWith('ambient.state.read_failed', expect.any(Object));
  });
});
