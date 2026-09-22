import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('compose renders a nonroot private bridge with outbound access and ephemeral storage only', () => {
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const config = JSON.parse(execFileSync('docker', ['compose', '-f', 'docker-compose.yaml', 'config', '--format', 'json'], { cwd, encoding: 'utf8' }));
  const service = config.services['daylight-browser'];
  assert.equal(service.user, 'pwuser');
  assert.equal(service.read_only, true);
  assert.deepEqual(service.cap_drop, ['ALL']);
  assert.equal(service.init, true);
  assert.equal(service.ports, undefined);
  assert.equal(service.volumes, undefined);
  assert.equal(service.environment, undefined);
  assert.equal(service.network_mode, undefined);
  assert.equal(service.tmpfs.length, 2);
  for (const name of Object.keys(service.networks)) assert.notEqual(config.networks[name].internal, true);
});

test('production overlay durably joins the authoritative daylightstation service to the sidecar', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const outside = mkdtempSync(path.join(tmpdir(), 'daylight-production-base-'));
  const base = path.join(outside, 'compose.yaml');
  writeFileSync(base, `services:\n  daylightstation:\n    image: daylightstation:compose-contract-fixture\n    networks: [default]\nnetworks:\n  default: {}\n`);
  let config;
  try {
    config = JSON.parse(execFileSync('docker', ['compose',
      '-f', base, '-f', 'docker/daylight-browser.compose.yaml',
      'config', '--format', 'json'], { cwd: root, encoding: 'utf8' }));
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
  const backend = config.services.daylightstation;
  const browser = config.services['daylight-browser'];
  assert.equal(backend.environment.DAYLIGHT_BROWSER_URL, 'http://daylight-browser:3000');
  assert.equal(Object.hasOwn(backend.networks, 'default'), true);
  assert.equal(Object.hasOwn(backend.networks, 'daylight-private'), true);
  assert.equal(Object.hasOwn(browser.networks, 'daylight-private'), true);
  assert.equal(browser.ports, undefined);
  assert.equal(browser.volumes, undefined);
  assert.deepEqual(browser.cap_drop, ['ALL']);
  assert.equal(browser.read_only, true);
  assert.equal(config.networks['daylight-private'].name, 'daylight-private');
  assert.equal(browser.build, undefined);
  assert.equal(browser.image, 'daylight-browser:1.63.0');
});
