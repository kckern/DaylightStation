// Pins what the roadmap's phases 4 to 6 need from each kiosk device file, so a later
// edit cannot drop a capability or arm a device before its cutover.
// ops:docs/superpowers/plans/2026-11-16-daylight-android-roadmap.md (phases 4, 5, 6)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const DEVICES = join(dirname(fileURLToPath(import.meta.url)), '..', 'devices');
const load = (id) => ({ text: readFileSync(join(DEVICES, `${id}.yml`), 'utf8'), file: parse(readFileSync(join(DEVICES, `${id}.yml`), 'utf8')) });

const KIOSK = ['webview-host', 'debug-tools', 'accessibility', 'lockdown', 'screen-power', 'volume', 'app-launcher'];
const ROADMAP = {
  // Phase 4: kiosk set plus volume keys, the USB keyboard and presence.
  portal: [...KIOSK, 'volume-keys', 'hid-input', 'presence'],
  // Phase 5: MIDI and the synth, the audio guard, Bluetooth roles (the pairing dialog exemption
  // lives in lockdown), and debug-tools for the fps comparison.
  piano: [...KIOSK, 'synth', 'midi-bridge', 'bluetooth-controls', 'audio-guard'],
  // Phase 6: the microphone, the app launcher for RetroArch, the lease gate, Bluetooth gamepads.
  // Remote keys reach the page as ordinary keydown through webview-host.
  shield: [...KIOSK, 'bluetooth-controls', 'mic-bridge', 'lease-gate'],
};
const SWITCHES = {
  portal: ['hid.enabled', 'volumeKeys.enabled', 'presence.enabled'],
  piano: ['midi.enabled', 'speaker.enabled'],
  shield: ['mic.enabled', 'lease.enabled'],
};
// Switches that need no further decision once the device is cut over. The Shield's lease
// loop runs only once it has been provisioned, which the owner decides separately.
const ON_WHEN_DONE = { ...SWITCHES, shield: ['mic.enabled'] };

for (const [id, want] of Object.entries(ROADMAP)) {
  test(`${id}: declares exactly the capabilities its roadmap phase names`, () => {
    assert.deepEqual([...load(id).file.capabilities].sort(), [...want].sort());
  });

  // `cutover:` in the device file says where the device is: `before` (installed beside
  // Fully, nothing armed) or `done` (the runbook's make-it-permanent step). The test
  // follows the marker, so making a device permanent is one edit, not a broken test.
  test(`${id}: lockdown and the coexistence switches match the device's cutover marker`, () => {
    const { cutover, defaults } = load(id).file;
    assert.ok(['before', 'done'].includes(cutover), `cutover must be before or done, not ${cutover}`);
    const armed = cutover === 'done';
    assert.equal(defaults['lockdown.enabled'], armed);
    assert.equal(defaults['lockdown.required'] ?? false, armed);
    for (const key of armed ? ON_WHEN_DONE[id] : SWITCHES[id]) assert.equal(defaults[key], armed, key);
  });

  test(`${id}: no address, MAC or token is written into the device file`, () => {
    const { text } = load(id);
    assert.doesNotMatch(text, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    assert.doesNotMatch(text, /\b[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}\b/);
    assert.doesNotMatch(text, /\b[0-9a-f]{32,}\b/);
  });
}

test('shield: the microphone uses the legacy consumer port through cutover and rollback', () => {
  assert.equal(load('shield').file.defaults['mic.port'], 8765);
});

test('shield: the page may launch the emulator the media menu starts today', () => {
  assert.match(load('shield').file.defaults['launcher.allowed'], /(^|,)com\.retroarch\.aarch64(,|$)/);
});

test('piano: until its cutover it ships under the old bridge identity the supervisor queries', () => {
  assert.equal(load('piano').file.defaults['logstore.app'], 'piano-bridge');
});
