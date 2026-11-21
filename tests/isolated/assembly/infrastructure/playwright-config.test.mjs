// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getAppPort } from '../../../_lib/configHelper.mjs';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));

function loadConfig(baseURL) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    const { default: config } = await import('./tests/_infrastructure/config/playwright.config.mjs');
    process.stdout.write(JSON.stringify({ baseURL: config.use.baseURL, webServer: config.webServer ?? null }));
  `], { cwd: repository, env: { ...process.env, BASE_URL: baseURL }, encoding: 'utf8' }));
}

describe('Playwright server ownership', () => {
  it('uses an explicit managed server without starting an unrelated dev stack', () => {
    const config = loadConfig('http://127.0.0.1:45678');
    expect(config.baseURL).toBe('http://127.0.0.1:45678');
    expect(config.webServer).toBeNull();
  });

  it('retains automatic startup when no server was selected', () => {
    const config = loadConfig('');
    expect(config.webServer.command).toBe('npm run dev');
    expect(config.webServer.url).toBe(config.baseURL);
    expect(config.webServer.reuseExistingServer).toBe(true);
  });
});

describe('browser test port configuration', () => {
  it('reads the project .env fallback when explicit data and environment paths are absent', () => {
    const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'daylight-project-'));
    const dataPath = path.join(projectRoot, 'data');
    const configPath = path.join(dataPath, 'system', 'config');
    mkdirSync(configPath, { recursive: true });
    writeFileSync(path.join(projectRoot, '.env'), [
      `DAYLIGHT_BASE_PATH=${projectRoot}`,
      'DAYLIGHT_ENV=fixture-host',
      '',
    ].join('\n'));
    writeFileSync(path.join(configPath, 'system.yml'), [
      'app:',
      '  ports:',
      '    fixture-host: 3123',
      '',
    ].join('\n'));

    const env = { ...process.env };
    delete env.DAYLIGHT_DATA_PATH;
    delete env.DAYLIGHT_BASE_PATH;
    delete env.DAYLIGHT_ENV;
    const helperUrl = new URL('../../../_lib/configHelper.mjs', import.meta.url).href;
    try {
      const port = execFileSync(process.execPath, ['--input-type=module', '-e', `
        delete globalThis.fs;
        const { getAppPort } = await import(${JSON.stringify(helperUrl)});
        process.stdout.write(String(getAppPort()));
      `], { cwd: projectRoot, env, encoding: 'utf8' });
      expect(port).toBe('3123');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('keeps the base app port when a host-local config only overrides logging', () => {
    const dataPath = mkdtempSync(path.join(os.tmpdir(), 'daylight-config-'));
    const configPath = path.join(dataPath, 'system', 'config');
    mkdirSync(configPath, { recursive: true });
    writeFileSync(path.join(configPath, 'system.yml'), [
      'app:',
      '  ports:',
      '    default: 3111',
      '    fixture-host: 3122',
      '',
    ].join('\n'));
    writeFileSync(path.join(configPath, 'system-local.fixture-host.yml'), [
      'logging:',
      '  fileSink:',
      '    path: /tmp/fixture-backend.log',
      '',
    ].join('\n'));

    const previousDataPath = process.env.DAYLIGHT_DATA_PATH;
    const previousBasePath = process.env.DAYLIGHT_BASE_PATH;
    const previousEnv = process.env.DAYLIGHT_ENV;
    try {
      process.env.DAYLIGHT_DATA_PATH = dataPath;
      delete process.env.DAYLIGHT_BASE_PATH;
      process.env.DAYLIGHT_ENV = 'fixture-host';
      expect(getAppPort()).toBe(3122);
    } finally {
      if (previousDataPath === undefined) delete process.env.DAYLIGHT_DATA_PATH;
      else process.env.DAYLIGHT_DATA_PATH = previousDataPath;
      if (previousBasePath === undefined) delete process.env.DAYLIGHT_BASE_PATH;
      else process.env.DAYLIGHT_BASE_PATH = previousBasePath;
      if (previousEnv === undefined) delete process.env.DAYLIGHT_ENV;
      else process.env.DAYLIGHT_ENV = previousEnv;
      rmSync(dataPath, { recursive: true, force: true });
    }
  });
});
