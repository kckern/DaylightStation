import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), 'rfid2-config-'));
const source = path.join(dir, 'device.yml');
const output = path.join(dir, 'config.h');
const run = (body) => {
  writeFileSync(source, body);
  return spawnSync(process.execPath, [path.join(here, 'gen-config.mjs'), source], {
    env: { ...process.env, DAYLIGHT_CONFIG_OUT: output }, encoding: 'utf8',
  });
};

const missingPassword = run('device:\n  id: garage-rfid2\nprovisioning:\n  wifi_ssid: House\n  wifi_password: secret\nota:\n  enabled: true\n');
assert.notEqual(missingPassword.status, 0, 'OTA without a password must fail');

const valid = run('device:\n  id: garage-rfid2\nprovisioning:\n  wifi_ssid: House\n  wifi_password: "pass\\\\word\\\"quoted"\nota:\n  enabled: true\n  password: ota-secret\n');
assert.equal(valid.status, 0, valid.stderr);
const header = readFileSync(output, 'utf8');
assert.match(header, /#define DEVICE_ID "garage-rfid2"/);
assert.match(header, /#define OTA_ENABLED 1/);
assert.match(header, /#define OTA_PASSWORD "ota-secret"/);
assert.match(header, /pass\\\\word\\"quoted/);
console.log('gen-config: 2 cases passed');
