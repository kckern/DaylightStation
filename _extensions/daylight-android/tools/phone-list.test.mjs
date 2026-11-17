// The phone's exact list, written out. verify-build.mjs and the Gradle check derive the
// expected permissions and exported components from the device file and each
// capability.yml; this holds what they derive to a list a person has read, so a
// capability that gains a permission or exports a component changes a line here too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { EXPECTED_COMPONENTS, isPersonal, permissionsFor } from './verify-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const phone = parse(readFileSync(join(root, 'devices', 'phone.yml'), 'utf8'));
const capabilities = Object.fromEntries(
  readdirSync(join(root, 'capabilities'))
    .filter((name) => existsSync(join(root, 'capabilities', name, 'capability.yml')))
    .map((name) => [name, parse(readFileSync(join(root, 'capabilities', name, 'capability.yml'), 'utf8')) || {}]),
);

// tools/verify-build.mjs BASE_PERMISSIONS and PersonalBuild.BASE_PERMISSIONS.
const BASE = ['INTERNET', 'FOREGROUND_SERVICE', 'RECEIVE_BOOT_COMPLETED', 'WAKE_LOCK', 'POST_NOTIFICATIONS',
  'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', 'ACCESS_WIFI_STATE', 'ACCESS_NETWORK_STATE'];

test('the phone is a personal build that lists quick-input', () => {
  assert.equal(isPersonal(phone), true);
  assert.deepEqual(phone.capabilities, ['webview-host', 'volume', 'notifications', 'bookmarks', 'one-tap-actions', 'widgets',
    'media-service', 'android-auto', 'quick-input']);
});

test('the phone asks for exactly these twelve permissions', () => {
  const names = new Set([...BASE.map((p) => `android.permission.${p}`), ...permissionsFor(phone, capabilities).map((p) => p.name),
    ...(phone.permissions || [])]);
  assert.deepEqual([...names].sort(), [
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.ACCESS_WIFI_STATE',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
    'android.permission.FOREGROUND_SERVICE_MICROPHONE',
    'android.permission.INTERNET',
    'android.permission.MODIFY_AUDIO_SETTINGS',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.RECEIVE_BOOT_COMPLETED',
    'android.permission.RECORD_AUDIO',
    'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
    'android.permission.WAKE_LOCK',
  ]);
});

test('a photo is taken by the system camera app, so the phone asks for no camera, storage or location permission', () => {
  const names = permissionsFor(phone, capabilities).map((p) => p.name);
  for (const p of ['CAMERA', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'READ_MEDIA_IMAGES', 'ACCESS_MEDIA_LOCATION',
    'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION']) {
    assert.equal(names.includes(`android.permission.${p}`), false, p);
  }
  assert.deepEqual(capabilities['quick-input'].permissions, ['android.permission.RECORD_AUDIO',
    'android.permission.FOREGROUND_SERVICE_MICROPHONE', 'android.permission.ACCESS_NETWORK_STATE']);
});

test('another app can reach exactly these nine components of the phone build', () => {
  const exported = ['net.kckern.daylight.shell.BootReceiver', ...phone.capabilities.flatMap((name) => capabilities[name]?.exported || [])];
  assert.deepEqual(exported.sort(), [
    'net.kckern.daylight.cap.mediaservice.shell.DaylightMediaService',
    'net.kckern.daylight.cap.notifications.shell.LinkActivity',
    'net.kckern.daylight.cap.onetap.shell.ActionTileService$Tile1',
    'net.kckern.daylight.cap.onetap.shell.ActionTileService$Tile2',
    'net.kckern.daylight.cap.onetap.shell.ActionTileService$Tile3',
    'net.kckern.daylight.cap.onetap.shell.ActionTileService$Tile4',
    'net.kckern.daylight.cap.webviewhost.shell.KioskActivity',
    'net.kckern.daylight.cap.widgets.shell.ButtonWidgetConfigActivity',
    'net.kckern.daylight.shell.BootReceiver',
  ]);
});

test('the one-action button added one exported component, its chooser, and no permission', () => {
  assert.deepEqual(capabilities.widgets.exported, ['net.kckern.daylight.cap.widgets.shell.ButtonWidgetConfigActivity']);
  assert.deepEqual(capabilities.widgets.permissions, []);
  const own = Object.entries(EXPECTED_COMPONENTS).filter(([key]) => key.includes('.cap.widgets.'));
  assert.deepEqual(own.map(([key, row]) => `${key} exported=${row.exported} permission=${row.permission}`).sort(), [
    'activity net.kckern.daylight.cap.widgets.shell.ButtonWidgetConfigActivity exported=true permission=null',
    'receiver net.kckern.daylight.cap.widgets.shell.ActionWidgetProvider exported=false permission=null',
    'receiver net.kckern.daylight.cap.widgets.shell.ButtonWidgetProvider exported=false permission=null',
  ]);
});

test('nothing of quick-input is exported: a capture starts inside the app or not at all', () => {
  assert.equal(capabilities['quick-input'].exported, undefined);
  const own = Object.entries(EXPECTED_COMPONENTS).filter(([key]) => key.includes('.cap.quickinput.'));
  assert.deepEqual(own.map(([key]) => key).sort(), [
    'activity net.kckern.daylight.cap.quickinput.shell.PhotoCaptureActivity',
    'activity net.kckern.daylight.cap.quickinput.shell.RecordActivity',
    'activity net.kckern.daylight.cap.quickinput.shell.TextInputActivity',
    'provider net.kckern.daylight.cap.quickinput.shell.InputFileProvider',
    'service net.kckern.daylight.cap.quickinput.shell.MemoRecorderService',
  ]);
  for (const [key, row] of own) {
    assert.equal(row.exported, false, key);
    assert.equal(row.permission, null, key);
  }
});

test('no page of the phone build is given the microphone or the camera', () => {
  assert.equal(phone.defaults['webview.allowMic'], false);
  assert.equal(phone.defaults['webview.allowCamera'], false);
  assert.equal(phone.defaults['webview.showWhenLocked'], false);
});

test('Feed is gone from the phone: no bookmark, action, shortcut, tile or widget button names it', () => {
  for (const [key, value] of Object.entries(phone.defaults)) {
    if (!/^(bookmarks|actions|widgets)\./.test(key)) continue;
    assert.equal(/\bfeed\b/i.test(String(value)), false, key);
  }
});

test('the memo button is called Journal and is a voice input for the journal', () => {
  assert.equal(phone.defaults['actions.1'], 'journal|Journal|mic|input:voice:journal');
  assert.equal(Object.values(phone.defaults).some((v) => /New memo/.test(String(v))), false);
});

test('playing with no window adds one service of media-service, not exported, and no permission', () => {
  assert.deepEqual(capabilities['media-service'].exported, ['net.kckern.daylight.cap.mediaservice.shell.DaylightMediaService']);
  assert.deepEqual(capabilities['media-service'].permissions, ['android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
    'android.permission.ACCESS_NETWORK_STATE']);
  const own = Object.entries(EXPECTED_COMPONENTS).filter(([key]) => key.includes('.cap.mediaservice.'));
  assert.deepEqual(own.map(([key, row]) => `${key} exported=${row.exported} permission=${row.permission}`).sort(), [
    'activity net.kckern.daylight.cap.mediaservice.shell.PlayActivity exported=false permission=null',
    'service net.kckern.daylight.cap.mediaservice.shell.DaylightMediaService exported=true permission=null',
    'service net.kckern.daylight.cap.mediaservice.shell.PlayActionService exported=false permission=null',
  ]);
  assert.deepEqual(EXPECTED_COMPONENTS['service net.kckern.daylight.cap.mediaservice.shell.PlayActionService'].foregroundServiceType,
    ['mediaPlayback']);
});
