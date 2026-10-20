import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlAdminConfigStore } from '#adapters/persistence/yaml/YamlAdminConfigStore.mjs';

describe('YamlAdminConfigStore.readSchedulerRuntime', () => {
  let dataRoot;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-config-store-'));
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('reads the runtime file the scheduler writes (system/scheduling/cron-runtime.yml)', () => {
    const dir = path.join(dataRoot, 'system', 'scheduling');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cron-runtime.yml'), 'withings:\n  status: failed\n');

    const store = new YamlAdminConfigStore({ dataRoot });

    expect(store.readSchedulerRuntime()).toEqual({ withings: { status: 'failed' } });
  });

  it('returns an empty map when the scheduler has not written a runtime file yet', () => {
    const store = new YamlAdminConfigStore({ dataRoot });
    expect(store.readSchedulerRuntime()).toEqual({});
  });
});
