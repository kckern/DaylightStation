import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const tools = path.dirname(fileURLToPath(import.meta.url));
const generator = path.join(tools, 'gen-config.mjs');

function fixture(address = 'AA:BB:CC:DD:EE:FF') {
  return `
provisioning:
  wifi_ssid: TestNet
  wifi_password: "line\\nquote\\\""
backend:
  host: station.local
  port: 3112
  scheme: http
relays:
  relay-01:
    label: Test relay
    api_token: 0123456789abcdef0123456789abcdef
    link:
      transmit_enabled: true
      plug_detect_pin: 22
      plug_detect_active_high: true
    input:
      ble_keyboard:
        enabled: true
        address: "${address}"
        address_type: random
        label: Test keyboard
        pairing_window_ms: 45000
`;
}

test('generates a redaction-safe identifiable BLE keyboard configuration', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ticalc-config-'));
  const source = path.join(directory, 'relay.yml');
  const output = path.join(directory, 'config.h');
  writeFileSync(source, fixture());
  const generated = spawnSync(process.execPath, [generator, source, 'relay-01', output], {
    encoding: 'utf8',
  });
  assert.equal(generated.status, 0, generated.stderr);
  const header = readFileSync(output, 'utf8');
  assert.match(header, /#define BLE_KEYBOARD_ENABLED 1/);
  assert.match(header, /#define BLE_KEYBOARD_ADDRESS "AA:BB:CC:DD:EE:FF"/);
  assert.match(header, /#define BLE_KEYBOARD_ADDRESS_TYPE 1/);
  assert.match(header, /#define BLE_KEYBOARD_PAIRING_WINDOW_MS 45000/);
  assert.match(header, /#define BLE_KEYBOARD_REQUIRE_MITM 1/);
  assert.match(header, /#define PLUG_DETECT_PIN 22/);
  assert.match(header, /#define PLUG_DETECT_ACTIVE_HIGH 1/);
  assert.match(header, /#define FIRMWARE_CONFIG_FINGERPRINT "[0-9a-f]{16}"/);
  assert.equal(
    header.split('\n').find(line => line.startsWith('#define WIFI_PASSWORD ')),
    '#define WIFI_PASSWORD "line\\nquote\\\""',
  );
});

test('rejects a plug-detect pin that overlaps the TI interface', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ticalc-config-'));
  const source = path.join(directory, 'relay.yml');
  const output = path.join(directory, 'config.h');
  writeFileSync(source, fixture().replace('plug_detect_pin: 22', 'plug_detect_pin: 32'));
  const generated = spawnSync(process.execPath, [generator, source, 'relay-01', output], {
    encoding: 'utf8',
  });
  assert.notEqual(generated.status, 0);
  assert.match(generated.stderr, /plug_detect_pin conflicts/);
});

test('rejects an enabled keyboard without a canonical identity address', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ticalc-config-'));
  const source = path.join(directory, 'relay.yml');
  const output = path.join(directory, 'config.h');
  writeFileSync(source, fixture('not-an-address'));
  const generated = spawnSync(process.execPath, [generator, source, 'relay-01', output], {
    encoding: 'utf8',
  });
  assert.notEqual(generated.status, 0);
  assert.match(generated.stderr, /canonical Bluetooth identity address/);
});
