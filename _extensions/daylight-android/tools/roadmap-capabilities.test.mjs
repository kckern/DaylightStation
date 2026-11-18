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

for (const [id, want] of Object.entries(ROADMAP)) {
  test(`${id}: declares exactly the capabilities its roadmap phase names`, () => {
    assert.deepEqual([...load(id).file.capabilities].sort(), [...want].sort());
  });

  test(`${id}: installing arms nothing before the cutover (lockdown and every coexistence switch off)`, () => {
    const { defaults } = load(id).file;
    assert.equal(defaults['lockdown.enabled'], false);
    assert.equal(defaults['lockdown.required'] ?? false, false);
    for (const key of SWITCHES[id]) assert.equal(defaults[key], false, key);
  });

  test(`${id}: no address, MAC or token is written into the device file`, () => {
    const { text } = load(id);
    assert.doesNotMatch(text, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    assert.doesNotMatch(text, /\b[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}\b/);
    assert.doesNotMatch(text, /\b[0-9a-f]{32,}\b/);
  });
}

test('shield: the page may launch the emulator the media menu starts today', () => {
  assert.match(load('shield').file.defaults['launcher.allowed'], /(^|,)com\.retroarch\.aarch64(,|$)/);
});

test('piano: until its cutover it ships under the old bridge identity the supervisor queries', () => {
  assert.equal(load('piano').file.defaults['logstore.app'], 'piano-bridge');
});
