// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import yaml from 'js-yaml';

describe('cli/_bootstrap.mjs', () => {
  let tmpRoot;
  let originalBasePath;
  let bootstrap;

  beforeEach(async () => {
    // Build a minimal but valid data tree so ConfigService can initialize.
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dscli-boot-'));
    const dataDir = path.join(tmpRoot, 'data');
    const sysDir = path.join(dataDir, 'system', 'config');
    await fs.mkdir(sysDir, { recursive: true });
    await fs.writeFile(path.join(sysDir, 'system.yml'), yaml.dump({
      households: { default: 'default' },
      timezone: 'America/Los_Angeles',
      secrets: { provider: 'yaml' },
    }));

    // Minimal household so validators don't reject the tree.
    const householdDir = path.join(dataDir, 'household', 'config');
    await fs.mkdir(householdDir, { recursive: true });
    await fs.writeFile(path.join(householdDir, 'household.yml'), yaml.dump({
      head: 'testuser',
      users: ['testuser'],
      timezone: 'America/Los_Angeles',
    }));

    // Minimal user profile so user cross-reference validation passes.
    const userDir = path.join(dataDir, 'users', 'testuser');
    await fs.mkdir(userDir, { recursive: true });
    await fs.writeFile(path.join(userDir, 'profile.yml'), yaml.dump({
      name: 'Test User',
      email: 'test@example.com',
    }));

    originalBasePath = process.env.DAYLIGHT_BASE_PATH;
    process.env.DAYLIGHT_BASE_PATH = tmpRoot;

    // Reset the ConfigService singleton between tests so each gets a clean init.
    const cfgMod = await import('#system/config/index.mjs');
    cfgMod.resetConfigService();

    // Re-import bootstrap fresh so its memoization is reset.
    const bustQuery = `?t=${Date.now()}_${Math.random()}`;
    bootstrap = await import('../../../cli/_bootstrap.mjs' + bustQuery);
  });

  afterEach(async () => {
    process.env.DAYLIGHT_BASE_PATH = originalBasePath;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('getConfigService() initializes from DAYLIGHT_BASE_PATH', async () => {
    const cfg = await bootstrap.getConfigService();
    expect(cfg).toBeTruthy();
    expect(typeof cfg.getDataDir).toBe('function');
    expect(cfg.getDataDir()).toBe(path.join(tmpRoot, 'data'));
  });

  it('getConfigService() memoizes — second call returns same instance', async () => {
    const a = await bootstrap.getConfigService();
    const b = await bootstrap.getConfigService();
    expect(a).toBe(b);
  });

  it('getHttpClient() returns an object with a request method', () => {
    const http = bootstrap.getHttpClient();
    expect(http).toBeTruthy();
    expect(typeof http.request).toBe('function');
  });

  it('getHttpClient() memoizes', () => {
    expect(bootstrap.getHttpClient()).toBe(bootstrap.getHttpClient());
  });

  it('getConfigService() throws EXIT_CONFIG-mapped error when DAYLIGHT_BASE_PATH is unset', async () => {
    delete process.env.DAYLIGHT_BASE_PATH;
    const { resetConfigService } = await import('#system/config/index.mjs');
    resetConfigService();
    const bustQuery = `?t=${Date.now()}_${Math.random()}`;
    const fresh = await import('../../../cli/_bootstrap.mjs' + bustQuery);
    await expect(fresh.getConfigService()).rejects.toThrow(/DAYLIGHT_BASE_PATH/);
  });
});
