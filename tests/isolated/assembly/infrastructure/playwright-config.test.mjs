import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));

function loadConfig(baseURL) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    const { default: config } = await import('./playwright.config.mjs');
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
