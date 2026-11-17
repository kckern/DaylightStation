import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bakedPayloadFailure, buildTypeLine, byVersion, componentFailures, declaredComponents, expectedPermission, newestVersion,
  parseApkComponents, parsePermissions, permissionFailures, sha256Hex, synthLibraryFailure, componentAttributeFailures, generatedComponents, isKiosk, kioskBasePermissions, permissionFailures as permissionFailuresAgain, HOME_ALIAS, homeAliasFailures, parseXmlTree,
} from './verify-lib.mjs';

test('build-tools versions order by number, not by text', () => {
  assert.ok(byVersion('9.0.0', '33.0.2') < 0);
  assert.ok(byVersion('33.0.2', '9.0.0') > 0);
  assert.ok(byVersion('33.0.2', '33.0.10') < 0);
  assert.equal(byVersion('30.0.3', '30.0.3'), 0);
});

test('a release candidate suffix does not outrank a higher number', () => {
  assert.ok(byVersion('34.0.0-rc3', '35.0.0') < 0);
  assert.ok(byVersion('34.0.0-rc1', '34.0.0-rc3') < 0);
});

test('newestVersion picks the numerically highest name', () => {
  assert.equal(newestVersion(['9.0.0', '33.0.2', '30.0.3']), '33.0.2');
  assert.equal(newestVersion([]), undefined);
});

test('sha256Hex matches a known digest', () => {
  assert.equal(sha256Hex(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('a baked payload that matches the built payload passes', () => {
  const jar = Buffer.from('payload bytes');
  assert.equal(bakedPayloadFailure(jar, sha256Hex(jar) + '\n'), null);
  assert.equal(bakedPayloadFailure(jar, sha256Hex(jar).toUpperCase() + '  portal.jar\n'), null);
});

test('a baked payload that differs from the built payload fails and says it is stale', () => {
  const message = bakedPayloadFailure(Buffer.from('old payload'), sha256Hex(Buffer.from('new payload')) + '\n');
  assert.match(message, /stale payload/);
});

test('a missing .sha256 file is a failure, not a pass', () => {
  assert.match(bakedPayloadFailure(Buffer.from('x'), null), /\.sha256 file is missing/);
  assert.match(bakedPayloadFailure(Buffer.from('x'), undefined), /\.sha256 file is missing/);
});

test('a .sha256 file without a digest is a failure, not a pass', () => {
  assert.match(bakedPayloadFailure(Buffer.from('x'), 'not a hash\n'), /does not hold a sha256/);
});

const synthLibrary = (parts, size = 1024 * 1024) => {
  const body = Buffer.alloc(size);
  let at = 64;
  for (const part of parts) { body.write(part, at, 'latin1'); at += part.length + 8; }
  return body;
};
const SFIZZ = 'SfizzEngine created (sfizz vendored) sr=%.0f';
const JNI = 'Java_net_kckern_daylight_cap_synth_shell_PianoEngine_nativeLoadPreset';

test('a synth library with the JNI exports and sfizz linked in passes', () => {
  assert.equal(synthLibraryFailure(synthLibrary([JNI, SFIZZ])), null);
});

test('a synth library built without sfizz is refused', () => {
  assert.match(synthLibraryFailure(synthLibrary([JNI])), /sfizz is not linked/);
});

test('a synth library whose JNI names belong to another package is refused', () => {
  const old = 'Java_net_kckern_pianobridge_PianoEngine_nativeLoadPreset';
  assert.match(synthLibraryFailure(synthLibrary([old, SFIZZ])), /JNI exports/);
});

test('a synth library too small to hold a sampler is refused', () => {
  assert.match(synthLibraryFailure(synthLibrary([JNI, SFIZZ], 200 * 1024)), /too small/);
});

test('a missing synth library is refused', () => {
  assert.match(synthLibraryFailure(null), /missing/);
  assert.match(synthLibraryFailure(Buffer.alloc(0)), /missing/);
});

test('an optimized synth library below one mebibyte passes', () => {
  // The optimized armeabi-v7a library is about 0.9 MB.
  assert.equal(synthLibraryFailure(synthLibrary([JNI, SFIZZ], 900 * 1024)), null);
});

test('a synth library the size of an unoptimized build is refused', () => {
  assert.match(synthLibraryFailure(synthLibrary([JNI, SFIZZ], 2400 * 1024)), /unoptimized/);
});

test('a synth library that names the build machine home directory is refused', () => {
  const lib = synthLibrary([JNI, SFIZZ, '/home/builder/src/sfizz/Synth.cpp']);
  assert.match(synthLibraryFailure(lib, '/home/builder'), /build machine/);
  assert.equal(synthLibraryFailure(lib, '/home/someone-else'), null);
  assert.equal(synthLibraryFailure(lib), null);
});

// ── permissions ───────────────────────────────────────────────────────────

const BADGING = [
  "package: name='net.kckern.daylight.example' versionCode='3' versionName='0.1'",
  "sdkVersion:'26'",
  "uses-permission: name='android.permission.INTERNET'",
  "uses-permission: name='android.permission.BLUETOOTH' maxSdkVersion='30'",
  "uses-permission: name='android.permission.BLUETOOTH_SCAN' usesPermissionFlags='neverForLocation'",
  "uses-permission-sdk-23: name='android.permission.ACCESS_FINE_LOCATION'",
  'application-debuggable',
].join('\n');

test('badging permissions are read with their sdk-23 and maxSdkVersion forms', () => {
  assert.deepEqual(parsePermissions(BADGING), [
    { name: 'android.permission.ACCESS_FINE_LOCATION', sdk23: true, maxSdkVersion: null },
    { name: 'android.permission.BLUETOOTH', sdk23: false, maxSdkVersion: 30 },
    { name: 'android.permission.BLUETOOTH_SCAN', sdk23: false, maxSdkVersion: null },
    { name: 'android.permission.INTERNET', sdk23: false, maxSdkVersion: null },
  ]);
});

test('an expected permission is a name or a name with its form', () => {
  assert.deepEqual(expectedPermission('a.b.C'), { name: 'a.b.C', sdk23: false, maxSdkVersion: null });
  assert.deepEqual(expectedPermission({ name: 'a.b.C', maxSdkVersion: 30 }), { name: 'a.b.C', sdk23: false, maxSdkVersion: 30 });
  assert.deepEqual(expectedPermission({ name: 'a.b.C', sdk23: true }), { name: 'a.b.C', sdk23: true, maxSdkVersion: null });
});

test('the same permissions in the same form pass', () => {
  const expected = ['android.permission.INTERNET', { name: 'android.permission.BLUETOOTH', maxSdkVersion: 30 },
    'android.permission.BLUETOOTH_SCAN', { name: 'android.permission.ACCESS_FINE_LOCATION', sdk23: true }].map(expectedPermission);
  assert.deepEqual(permissionFailures(parsePermissions(BADGING), expected), []);
});

test('a permission the APK asks for only from API 23 is not the plain permission', () => {
  const apk = parsePermissions("uses-permission-sdk-23: name='a.b.C'");
  const failures = permissionFailures(apk, [expectedPermission('a.b.C')]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /uses-permission-sdk-23 a\.b\.C/);
});

test('an sdk-23 permission nobody declared is unexpected, where the old check never saw it', () => {
  const failures = permissionFailures(parsePermissions("uses-permission-sdk-23: name='a.b.Hidden'"), []);
  assert.deepEqual(failures, ['unexpected permission: uses-permission-sdk-23 a.b.Hidden']);
});

test('a maxSdkVersion that differs, appears or disappears is a failure', () => {
  const capped = parsePermissions("uses-permission: name='a.b.C' maxSdkVersion='30'");
  assert.equal(permissionFailures(capped, [expectedPermission('a.b.C')]).length, 1);
  assert.equal(permissionFailures(capped, [expectedPermission({ name: 'a.b.C', maxSdkVersion: 28 })]).length, 1);
  assert.equal(permissionFailures(parsePermissions("uses-permission: name='a.b.C'"), [expectedPermission({ name: 'a.b.C', maxSdkVersion: 30 })]).length, 1);
  assert.deepEqual(permissionFailures(capped, [expectedPermission({ name: 'a.b.C', maxSdkVersion: 30 })]), []);
});

test('missing and unexpected permissions are both reported', () => {
  const failures = permissionFailures(parsePermissions("uses-permission: name='a.b.Extra'"), [expectedPermission('a.b.Wanted')]);
  assert.deepEqual(failures, ['unexpected permission: uses-permission a.b.Extra', 'missing permission: uses-permission a.b.Wanted']);
});

// ── components ────────────────────────────────────────────────────────────

const XMLTREE = `
N: android=http://schemas.android.com/apk/res/android (line=2)
  E: manifest (line=2)
      E: application (line=70)
        A: http://schemas.android.com/apk/res/android:label(0x01010001)="Daylight" (Raw: "Daylight")
          E: service (line=73)
            A: http://schemas.android.com/apk/res/android:exported(0x01010010)=false
            A: http://schemas.android.com/apk/res/android:name(0x01010003)="net.example.shell.ShellService" (Raw: "net.example.shell.ShellService")
          E: activity (line=78)
            A: http://schemas.android.com/apk/res/android:name(0x01010003)="net.example.shell.MainActivity" (Raw: "net.example.shell.MainActivity")
              E: intent-filter (line=80)
                  E: action (line=81)
                    A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.intent.action.MAIN" (Raw: "android.intent.action.MAIN")
          E: provider (line=126)
            A: http://schemas.android.com/apk/res/android:authorities(0x01010018)="net.example.mic" (Raw: "net.example.mic")
            A: http://schemas.android.com/apk/res/android:name(0x01010003)="net.example.cap.mic.shell.MicAnchorProvider" (Raw: "net.example.cap.mic.shell.MicAnchorProvider")
`;

test('the components of an APK are read from its manifest tree, intent actions left aside', () => {
  assert.deepEqual(parseApkComponents(XMLTREE), [
    'activity net.example.shell.MainActivity',
    'provider net.example.cap.mic.shell.MicAnchorProvider',
    'service net.example.shell.ShellService',
  ]);
});

const SHELL_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:label="Daylight">
    <!-- <service android:name=".Removed" /> -->
    <activity android:name=".MainActivity" android:exported="true">
      <intent-filter><action android:name="android.intent.action.MAIN" /></intent-filter>
    </activity>
    <service
        android:name=".ShellService"
        android:exported="false" />
  </application>
</manifest>`;

test('a source manifest names its components, a leading dot resolved against the namespace', () => {
  assert.deepEqual(declaredComponents(SHELL_MANIFEST, 'net.example.shell'), [
    'activity net.example.shell.MainActivity',
    'service net.example.shell.ShellService',
  ]);
  assert.deepEqual(declaredComponents('<manifest><application><provider android:name="net.example.cap.mic.shell.MicAnchorProvider" /></application></manifest>', 'ignored'),
    ['provider net.example.cap.mic.shell.MicAnchorProvider']);
});

test('the APK of a device that lists the capability passes', () => {
  const expected = [...declaredComponents(SHELL_MANIFEST, 'net.example.shell'), 'provider net.example.cap.mic.shell.MicAnchorProvider'];
  assert.deepEqual(componentFailures(parseApkComponents(XMLTREE), expected), []);
});

test('a component from a capability the device does not list fails', () => {
  const expected = declaredComponents(SHELL_MANIFEST, 'net.example.shell');
  assert.deepEqual(componentFailures(parseApkComponents(XMLTREE), expected),
    ['unexpected component in the APK: provider net.example.cap.mic.shell.MicAnchorProvider']);
});

test('a declared component that is not in the APK fails', () => {
  const expected = [...parseApkComponents(XMLTREE), 'service net.example.cap.a11y.shell.Service'];
  assert.deepEqual(componentFailures(parseApkComponents(XMLTREE), expected),
    ['component missing from the APK: service net.example.cap.a11y.shell.Service']);
});

// ── build type ────────────────────────────────────────────────────────────

test('the build type line says what was verified', () => {
  assert.equal(buildTypeLine(BADGING, 'Signer #1 certificate DN: C=US, O=Android, CN=Android Debug'),
    'debug build (debuggable), signed with the Android debug key');
  assert.equal(buildTypeLine(BADGING, null), 'debug build (debuggable), signer not checked');
  assert.equal(buildTypeLine("package: name='x'", 'Signer #1 certificate DN: CN=Example Release'),
    'not debuggable, signed with a key that is not the Android debug key');
});

// ── the HOME alias ────────────────────────────────────────────────────────

const NS = 'http://schemas.android.com/apk/res/android';
const homeFilter = (pad) => [
  `${pad}E: intent-filter (line=87)`,
  `${pad}    E: action (line=88)`,
  `${pad}      A: ${NS}:name(0x01010003)="android.intent.action.MAIN" (Raw: "android.intent.action.MAIN")`,
  `${pad}    E: category (line=90)`,
  `${pad}      A: ${NS}:name(0x01010003)="android.intent.category.HOME" (Raw: "android.intent.category.HOME")`,
  `${pad}    E: category (line=91)`,
  `${pad}      A: ${NS}:name(0x01010003)="android.intent.category.DEFAULT" (Raw: "android.intent.category.DEFAULT")`,
];
const KIOSK_ACTIVITY_LINES = [
  '          E: activity (line=76)',
  `            A: ${NS}:name(0x01010003)="net.kckern.daylight.cap.webviewhost.shell.KioskActivity" (Raw: "x")`,
  `            A: ${NS}:exported(0x01010010)=true`,
  `            A: ${NS}:resizeableActivity(0x010104f6)=false`,
  `            A: ${NS}:supportsPictureInPicture(0x010104f7)=false`,
];
const aliasLines = (enabled) => [
  '          E: activity-alias (line=95)',
  `            A: ${NS}:name(0x01010003)="${HOME_ALIAS}" (Raw: "${HOME_ALIAS}")`,
  ...(enabled == null ? [] : [`            A: ${NS}:enabled(0x0101000e)=${enabled}`]),
  `            A: ${NS}:exported(0x01010010)=true`,
  `            A: ${NS}:targetActivity(0x01010202)="net.kckern.daylight.cap.webviewhost.shell.KioskActivity" (Raw: "x")`,
  ...homeFilter('              '),
];
const tree = (...parts) => ['N: android=http://schemas.android.com/apk/res/android (line=2)', '  E: manifest (line=2)', '      E: application (line=60)', ...parts.flat()].join('\n');
const KIOSK_CAPS = ['webview-host', 'accessibility', 'lockdown'];

test('a build that lists lockdown expects the generated alias as a component', () => {
  assert.deepEqual(generatedComponents(KIOSK_CAPS), [`activity-alias ${HOME_ALIAS}`]);
  assert.deepEqual(generatedComponents(['webview-host', 'notifications']), []);
  assert.deepEqual(parseApkComponents(tree(KIOSK_ACTIVITY_LINES, aliasLines('false'))).sort(),
    [`activity net.kckern.daylight.cap.webviewhost.shell.KioskActivity`, `activity-alias ${HOME_ALIAS}`].sort());
});

test('the HOME filter on a disabled alias passes', () => {
  assert.deepEqual(homeAliasFailures(tree(KIOSK_ACTIVITY_LINES, aliasLines('false')), KIOSK_CAPS), []);
});

test('a HOME filter on the kiosk activity itself fails: installing would add a home candidate', () => {
  const failures = homeAliasFailures(tree(KIOSK_ACTIVITY_LINES, homeFilter('              ')), KIOSK_CAPS);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /HOME filter is on activity net\.kckern\.daylight\.cap\.webviewhost\.shell\.KioskActivity/);
});

test('an alias that is enabled, or does not say, fails', () => {
  assert.match(homeAliasFailures(tree(KIOSK_ACTIVITY_LINES, aliasLines('true')), KIOSK_CAPS)[0], /not declared disabled/);
  assert.match(homeAliasFailures(tree(KIOSK_ACTIVITY_LINES, aliasLines(null)), KIOSK_CAPS)[0], /not declared disabled/);
});

test('a lockdown build with no alias fails, and a build without lockdown must have no HOME filter', () => {
  assert.match(homeAliasFailures(tree(KIOSK_ACTIVITY_LINES), KIOSK_CAPS)[0], /expected one HOME filter/);
  assert.deepEqual(homeAliasFailures(tree(KIOSK_ACTIVITY_LINES), ['webview-host']), []);
  assert.match(homeAliasFailures(tree(KIOSK_ACTIVITY_LINES, aliasLines('false')), ['webview-host'])[0], /must have no HOME filter/);
});

test('a lockdown build whose kiosk activity can be resized fails', () => {
  const resizable = KIOSK_ACTIVITY_LINES.filter((l) => !l.includes('resizeableActivity'));
  assert.deepEqual(homeAliasFailures(tree(resizable, aliasLines('false')), KIOSK_CAPS),
    ['the kiosk activity does not declare android:resizeableActivity="false"']);
  assert.deepEqual(homeAliasFailures(tree(resizable), ['webview-host']), [], 'the phone may be resized');
});

// ── exported flags and bind permissions ───────────────────────────────────

const component = (kind, name, exported, permission) => [
  `          E: ${kind} (line=10)`,
  `            A: ${NS}:name(0x01010003)="${name}" (Raw: "${name}")`,
  ...(exported == null ? [] : [`            A: ${NS}:exported(0x01010010)=${exported}`]),
  ...(permission == null ? [] : [`            A: ${NS}:permission(0x01010006)="${permission}" (Raw: "${permission}")`]),
];
const ADMIN = 'net.kckern.daylight.cap.lockdown.shell.DaylightAdminReceiver';

test('components that match the table pass', () => {
  const apk = tree(
    component('service', 'net.kckern.daylight.shell.ShellService', 'false', null),
    component('receiver', ADMIN, 'true', 'android.permission.BIND_DEVICE_ADMIN'),
    KIOSK_ACTIVITY_LINES, aliasLines('false'));
  assert.deepEqual(componentAttributeFailures(apk), []);
});

test('a service that became exported fails', () => {
  assert.deepEqual(componentAttributeFailures(tree(component('service', 'net.kckern.daylight.shell.ShellService', 'true', null))),
    ['service net.kckern.daylight.shell.ShellService is exported=true, expected exported=false']);
});

test('an admin receiver that lost its bind permission fails', () => {
  assert.deepEqual(componentAttributeFailures(tree(component('receiver', ADMIN, 'true', null))),
    [`receiver ${ADMIN} is guarded by no permission, expected android.permission.BIND_DEVICE_ADMIN`]);
  assert.match(componentAttributeFailures(tree(component('receiver', ADMIN, 'true', 'android.permission.INTERNET')))[0], /guarded by android\.permission\.INTERNET/);
});

test('a component with no row, or one that does not say whether it is exported, fails', () => {
  assert.match(componentAttributeFailures(tree(component('service', 'net.example.New', 'false', null)))[0], /no expected exported\/permission entry for service net\.example\.New/);
  assert.deepEqual(componentAttributeFailures(tree(component('service', 'net.kckern.daylight.shell.ShellService', null, null))),
    ['service net.kckern.daylight.shell.ShellService does not state android:exported']);
});

// ── permissions only a kiosk asks for ─────────────────────────────────────

test('a kiosk expects the self-update and secure-settings permissions; the phone expects neither', () => {
  const kiosk = { capabilities: ['webview-host', 'accessibility', 'lockdown'], control: { port: 8780, lifelinePort: 8781 } };
  const phone = { capabilities: ['webview-host', 'notifications'], control: { port: 8780, lifelinePort: 8781, bind: 'none' } };
  assert.equal(isKiosk(kiosk), true);
  assert.equal(isKiosk(phone), false);
  assert.deepEqual(kioskBasePermissions(kiosk), ['android.permission.REQUEST_INSTALL_PACKAGES', 'android.permission.WRITE_SECURE_SETTINGS']);
  assert.deepEqual(kioskBasePermissions(phone), []);
  // A kiosk window with a control API is a kiosk even before lockdown is listed.
  assert.equal(isKiosk({ capabilities: ['webview-host'], control: { bind: 'loopback' } }), true);
  assert.equal(isKiosk({ capabilities: ['debug-tools'], control: {} }), false);
});

test('a phone APK that still asks to install packages fails the permission check', () => {
  const apk = [{ name: 'android.permission.INTERNET', sdk23: false, maxSdkVersion: null },
    { name: 'android.permission.REQUEST_INSTALL_PACKAGES', sdk23: false, maxSdkVersion: null }];
  const expected = [{ name: 'android.permission.INTERNET', sdk23: false, maxSdkVersion: null }];
  assert.deepEqual(permissionFailuresAgain(apk, expected), ['unexpected permission: uses-permission android.permission.REQUEST_INSTALL_PACKAGES']);
});
