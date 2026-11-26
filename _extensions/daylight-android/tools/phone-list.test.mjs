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

test('the phone is a personal build that lists quick-input and car-actions', () => {
  assert.equal(isPersonal(phone), true);
  assert.deepEqual(phone.capabilities, ['webview-host', 'volume', 'notifications', 'bookmarks', 'one-tap-actions', 'widgets',
    'media-service', 'android-auto', 'quick-input', 'car-actions']);
});

test('the phone asks for exactly these sixteen permissions', () => {
  const names = new Set([...BASE.map((p) => `android.permission.${p}`), ...permissionsFor(phone, capabilities).map((p) => p.name),
    ...(phone.permissions || [])]);
  assert.deepEqual([...names].sort(), [
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.ACCESS_WIFI_STATE',
    'android.permission.BLUETOOTH',
    'android.permission.BLUETOOTH_CONNECT',
    'android.permission.CAMERA',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
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

test('a photo is taken by the meal camera or the system camera app, so the phone asks for no storage or location permission', () => {
  const names = permissionsFor(phone, capabilities).map((p) => p.name);
  for (const p of ['READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'READ_MEDIA_IMAGES', 'ACCESS_MEDIA_LOCATION',
    'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION']) {
    assert.equal(names.includes(`android.permission.${p}`), false, p);
  }
  assert.deepEqual(capabilities['quick-input'].permissions, ['android.permission.RECORD_AUDIO', 'android.permission.CAMERA',
    'android.permission.FOREGROUND_SERVICE_MICROPHONE', 'android.permission.ACCESS_NETWORK_STATE']);
});

test('another app can reach exactly these thirteen components of the phone build', () => {
  const exported = ['net.kckern.daylight.shell.BootReceiver', ...phone.capabilities.flatMap((name) => capabilities[name]?.exported || [])];
  assert.deepEqual(exported.sort(), [
    'androidx.media3.session.MediaButtonReceiver',
    'net.kckern.daylight.cap.caractions.shell.CarHostGateService',
    'net.kckern.daylight.cap.mediaservice.shell.DaylightMediaService',
    'net.kckern.daylight.cap.notifications.shell.LinkActivity',
    'net.kckern.daylight.cap.onetap.shell.ActionTileService$Tile1',
    'net.kckern.daylight.cap.onetap.shell.ActionTileService$Tile2',
    'net.kckern.daylight.cap.onetap.shell.ActionTileService$Tile3',
    'net.kckern.daylight.cap.onetap.shell.ActionTileService$Tile4',
    'net.kckern.daylight.cap.quickinput.shell.ShareActivity',
    'net.kckern.daylight.cap.webviewhost.shell.KioskActivity',
    'net.kckern.daylight.cap.widgets.shell.ButtonWidgetConfigActivity',
    'net.kckern.daylight.cap.widgets.shell.PhoneHomeActivity',
    'net.kckern.daylight.shell.BootReceiver',
  ]);
});

test('the widget chooser is exported and Freematics setup is private', () => {
  assert.deepEqual(capabilities.widgets.exported, ['net.kckern.daylight.cap.widgets.shell.PhoneHomeActivity', 'net.kckern.daylight.cap.widgets.shell.ButtonWidgetConfigActivity']);
  assert.deepEqual(capabilities.widgets.permissions, [
    { name: 'android.permission.BLUETOOTH', maxSdkVersion: 30 },
    'android.permission.BLUETOOTH_CONNECT',
  ]);
  const own = Object.entries(EXPECTED_COMPONENTS).filter(([key]) => key.includes('.cap.widgets.'));
  assert.deepEqual(own.map(([key, row]) => `${key} exported=${row.exported} permission=${row.permission}`).sort(), [
    'activity net.kckern.daylight.cap.widgets.shell.ButtonWidgetConfigActivity exported=true permission=null',
    'activity net.kckern.daylight.cap.widgets.shell.FreematicsActivity exported=false permission=null',
    'activity net.kckern.daylight.cap.widgets.shell.PhoneHomeActivity exported=true permission=null',
    'receiver net.kckern.daylight.cap.widgets.shell.ButtonWidgetProvider exported=false permission=null',
    'service net.kckern.daylight.cap.widgets.shell.TelemetryJob exported=false permission=android.permission.BIND_JOB_SERVICE',
  ]);
});

test('quick-input exports only the share sheet entry: a capture starts inside the app or not at all', () => {
  assert.deepEqual(capabilities['quick-input'].exported, ['net.kckern.daylight.cap.quickinput.shell.ShareActivity']);
  const own = Object.entries(EXPECTED_COMPONENTS).filter(([key]) => key.includes('.cap.quickinput.'));
  assert.deepEqual(own.map(([key]) => key).sort(), [
    'activity net.kckern.daylight.cap.quickinput.shell.CaptureStatusActivity',
    'activity net.kckern.daylight.cap.quickinput.shell.MealCameraActivity',
    'activity net.kckern.daylight.cap.quickinput.shell.PhotoCaptureActivity',
    'activity net.kckern.daylight.cap.quickinput.shell.RecordActivity',
    'activity net.kckern.daylight.cap.quickinput.shell.ShareActivity',
    'activity net.kckern.daylight.cap.quickinput.shell.TextInputActivity',
    'provider net.kckern.daylight.cap.quickinput.shell.InputFileProvider',
    'service net.kckern.daylight.cap.quickinput.shell.MemoRecorderService',
    'service net.kckern.daylight.cap.quickinput.shell.UploadJob',
  ]);
  for (const [key, row] of own) {
    // The share sheet starts ShareActivity for another app; it sends nothing until the owner taps a target.
    assert.equal(row.exported, key.endsWith('.ShareActivity'), key);
    // The job service is bound only by the system's job scheduler, which holds BIND_JOB_SERVICE.
    assert.equal(row.permission, key.endsWith('.UploadJob') ? 'android.permission.BIND_JOB_SERVICE' : null, key);
  }
});

test('the phone sends shares to share destinations, the living-room TV first', () => {
  const lines = Object.entries(phone.defaults).filter(([k]) => k.startsWith('input.dest.')).map(([, v]) => v);
  const shares = lines.filter((v) => /^share(-|\|)/.test(v));
  assert.ok(shares.length >= 1);
  assert.match(shares[0], /^share-livingroom-tv\|[^|]+\|text\|\/api\/v1\/share\/to\/livingroom-tv\/text$/);
});

test('the phone enables Call prompts and keeps general web capture off', () => {
  assert.equal(phone.defaults['webview.callPermissions'], true);
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

test('phone input labels distinguish destination and input method', () => {
  assert.equal(phone.defaults['actions.1'], 'journal|Journal voice|notebook|input:voice:journal');
  assert.equal(phone.defaults['actions.2'], 'meal|Meal voice|fork|input:voice:meal');
  assert.equal(phone.defaults['actions.3'], 'meal-photo|Meal photo|camera|input:photo:meal-photo');
  assert.equal(phone.defaults['actions.4'], 'journal-note|Journal text|notebook|input:text:journal-note');
  assert.equal(phone.defaults['actions.5'], 'meal-note|Meal text|fork|input:text:meal-note');
  assert.equal(Object.values(phone.defaults).some((v) => /New memo/.test(String(v))), false);
});

test('"On my way" is a placeholder action and the phone asks for no location permission for it', () => {
  assert.equal(phone.defaults['actions.8'], 'omw|On my way|bolt|location:share');
  const names = new Set([...permissionsFor(phone, capabilities).map((p) => p.name), ...(phone.permissions || [])]);
  for (const p of ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_BACKGROUND_LOCATION', 'FOREGROUND_SERVICE_LOCATION']) {
    assert.equal(names.has(`android.permission.${p}`), false, p);
  }
  assert.equal(Object.values(EXPECTED_COMPONENTS).some((row) => (row.foregroundServiceType || []).includes('location')), false);
});

test('the car screen added one exported gate, its closed car service, three closed components of the library, and no permission to the list', () => {
  // Android Auto binds the gate; the library's service behind it is not exported.
  assert.deepEqual(capabilities['car-actions'].exported, ['net.kckern.daylight.cap.caractions.shell.CarHostGateService']);
  // The car's microphone: the permission quick-input already brings, so the twelve stay twelve.
  assert.deepEqual(capabilities['car-actions'].permissions, ['android.permission.RECORD_AUDIO']);
  assert.ok(capabilities['quick-input'].permissions.includes('android.permission.RECORD_AUDIO'));
  const own = Object.entries(EXPECTED_COMPONENTS).filter(([key]) => key.includes('.cap.caractions.') || key.includes(' androidx.car.app.'));
  assert.deepEqual(own.map(([key, row]) => `${key} exported=${row.exported} permission=${row.permission}`).sort(), [
    'activity androidx.car.app.CarAppPermissionActivity exported=false permission=null',
    'receiver androidx.car.app.notification.CarAppNotificationBroadcastReceiver exported=false permission=null',
    'service androidx.car.app.CarAppMetadataHolderService exported=false permission=null',
    'service net.kckern.daylight.cap.caractions.shell.CarHostGateService exported=true permission=null',
    'service net.kckern.daylight.cap.caractions.shell.DaylightCarAppService exported=false permission=null',
  ]);
  // Android Auto's own host is pinned on the first connection; nothing is pinned in the file.
  assert.equal(phone.defaults['car.hostPins'], '');
  // The journal voice memo (recorded through the car's microphone) and "On my way".
  assert.equal(phone.defaults['car.actions'], 'journal,omw');
  assert.ok(capabilities['car-actions'].requires.includes('quick-input'));
});

test('a pinned media shortcut is recorded through one closed receiver, and one-tap-actions exports only its tiles', () => {
  const own = Object.entries(EXPECTED_COMPONENTS).filter(([key]) => key.includes('.cap.onetap.'));
  assert.deepEqual(own.filter(([, row]) => !row.exported).map(([key, row]) => `${key} permission=${row.permission}`),
    ['receiver net.kckern.daylight.cap.onetap.shell.PinResultReceiver permission=null']);
  assert.equal(own.filter(([, row]) => row.exported).length, 4);
});

test('playing with no window adds one service of media-service, not exported, and no permission', () => {
  assert.deepEqual(capabilities['media-service'].exported, ['net.kckern.daylight.cap.mediaservice.shell.DaylightMediaService',
    'androidx.media3.session.MediaButtonReceiver']);
  assert.deepEqual(capabilities['media-service'].permissions, ['android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
    'android.permission.FOREGROUND_SERVICE_DATA_SYNC', 'android.permission.ACCESS_NETWORK_STATE']);
  const own = Object.entries(EXPECTED_COMPONENTS).filter(([key]) => key.includes('.cap.mediaservice.'));
  assert.deepEqual(own.map(([key, row]) => `${key} exported=${row.exported} permission=${row.permission}`).sort(), [
    'activity net.kckern.daylight.cap.mediaservice.shell.DownloadsActivity exported=false permission=null',
    'activity net.kckern.daylight.cap.mediaservice.shell.NowPlayingActivity exported=false permission=null',
    'activity net.kckern.daylight.cap.mediaservice.shell.PlayActivity exported=false permission=null',
    'service net.kckern.daylight.cap.mediaservice.shell.DaylightMediaService exported=true permission=null',
    'service net.kckern.daylight.cap.mediaservice.shell.KeepJob exported=false permission=android.permission.BIND_JOB_SERVICE',
    'service net.kckern.daylight.cap.mediaservice.shell.KeepService exported=false permission=null',
    'service net.kckern.daylight.cap.mediaservice.shell.PlayActionService exported=false permission=null',
    'service net.kckern.daylight.cap.mediaservice.shell.RemoteControlService exported=false permission=null',
  ]);
  assert.deepEqual(EXPECTED_COMPONENTS['service net.kckern.daylight.cap.mediaservice.shell.RemoteControlService'].foregroundServiceType,
    ['mediaPlayback']);
  assert.deepEqual(EXPECTED_COMPONENTS['service net.kckern.daylight.cap.mediaservice.shell.PlayActionService'].foregroundServiceType,
    ['mediaPlayback']);
  assert.deepEqual(EXPECTED_COMPONENTS['service net.kckern.daylight.cap.mediaservice.shell.KeepService'].foregroundServiceType,
    ['dataSync']);
  // Media3's PlatformScheduler is not used (its job starts a foreground service from the background).
  assert.equal(EXPECTED_COMPONENTS['service androidx.media3.exoplayer.scheduler.PlatformScheduler$PlatformSchedulerService'], undefined);
});

test('the setup screen has direct destinations for Home and Lifelog', () => {
  const entries = Object.entries(phone.defaults);
  const byPrefix = (prefix) => entries.filter(([key]) => key.startsWith(prefix)).map(([, value]) => value);
  const bookmarks = Object.fromEntries(byPrefix('bookmarks.').map(row => {
    const [id, , , path] = row.split('|');
    return [id, path];
  }));
  assert.deepEqual(bookmarks, {media: '/media', call: '/call', health: '/health', home: '/home', lifelog: '/life/log'});
  const actions = Object.fromEntries(byPrefix('actions.').filter(row => row.includes('|')).map(row => {
    const [id, , , target] = row.split('|');
    return [id, target];
  }));
  for (const id of Object.keys(bookmarks)) assert.equal(actions[id], 'bookmark:' + id);
  for (const [id, target] of Object.entries({
    journal: 'input:voice:journal', 'journal-note': 'input:text:journal-note',
    meal: 'input:voice:meal', 'meal-note': 'input:text:meal-note', 'meal-photo': 'input:photo:meal-photo',
    'capture-status': 'input:status',
  })) assert.equal(actions[id], target);
});

test('launcher setup reports callback confirmation and keeps installed shortcut IDs', () => {
  const read = (...path) => readFileSync(join(root, 'capabilities', ...path), 'utf8');
  const home = read('widgets/shell/src/main/java/net/kckern/daylight/cap/widgets/shell/PhoneHomeActivity.java');
  const provider = read('widgets/shell/src/main/java/net/kckern/daylight/cap/widgets/shell/ButtonWidgetProvider.java');
  const actions = read('one-tap-actions/payload/src/main/java/net/kckern/daylight/cap/onetap/AndroidSurfaces.java');
  const plan = read('one-tap-actions/payload/src/main/java/net/kckern/daylight/cap/onetap/SurfacePlan.java');
  assert.match(home, /"bookmark-" \+ id/);
  assert.match(plan, /PIN_PREFIX = "pin-"/);
  assert.match(actions, /info\(action, uri, SurfacePlan\.pinId\(action\)\), confirm/);
  assert.match(home, /requestPinShortcut\(shortcut,.*getIntentSender\(\)/s);
  assert.match(provider, /SHORTCUT_PIN_ACTION\.equals\(intent\.getAction\(\)\)/);
  assert.match(home, /LauncherCaptureShortcut\.issue\(this, action\.optString\("id"\)\)/);
  assert.match(home, /daylight:\/\/bookmark\//);
  assert.match(home, /Confirm in Android/);
  assert.match(home, /Placement unconfirmed/);
});
