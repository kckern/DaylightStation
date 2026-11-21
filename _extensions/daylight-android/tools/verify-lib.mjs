// Pure helpers of verify-build.mjs, kept apart so they can be tested without an APK.
import { createHash } from 'node:crypto';

const versionParts = (name) => name.split(/[^0-9]+/).filter(Boolean).map(Number);

/** Orders build-tools directory names by numeric components, so 9.0.0 sorts below 33.0.2. */
export function byVersion(a, b) {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const c = (x[i] || 0) - (y[i] || 0);
    if (c !== 0) return c;
  }
  return a.localeCompare(b);
}

/** The newest name in a list of build-tools versions, or undefined for an empty list. */
export function newestVersion(names) {
  return [...names].sort(byVersion).pop();
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Compares the payload baked into the APK with the payload build's .sha256 file.
 * Returns null when they agree, otherwise the failure message. A missing .sha256
 * file is a failure: with nothing to compare against, a stale payload would pass.
 */
export function bakedPayloadFailure(bakedJarBytes, shaFileText) {
  if (shaFileText == null) {
    return 'the payload .sha256 file is missing, so the baked payload cannot be checked against the built one (build the payload first)';
  }
  const expected = shaFileText.trim().split(/\s+/)[0]?.toLowerCase() || '';
  if (!/^[0-9a-f]{64}$/.test(expected)) return 'the payload .sha256 file does not hold a sha256';
  const actual = sha256Hex(bakedJarBytes);
  if (actual === expected) return null;
  return `baked payload sha256 is ${actual}, but the built payload is ${expected}: the APK holds a stale payload`;
}

/**
 * Is this libpianobridge.so the real synth, built the way it ships? What a wrong
 * library cannot show:
 * - the JNI exports under the class name the APK's PianoEngine has;
 * - the log line SfizzEngine.cpp compiles only with HAVE_SFIZZ defined, which also
 *   makes it call into sfizz, so the library cannot link without the sampler (sfizz's
 *   own "[sfizz]" messages are debug output and are gone from an optimized build);
 * - a size between the two bounds below. Measured, stripped: the optimized library is
 *   about 0.9 MB (armeabi-v7a) and 1.3 MB (arm64-v8a); CMake's unoptimized Debug build
 *   is 2.4 MB and 4.2 MB; a build without the sampler is a few tens of kilobytes;
 * - no path under the build machine's home directory (`homeDir`, when given).
 * Returns null when it is, otherwise the failure message.
 */
export const SYNTH_SFIZZ_MARKER = 'SfizzEngine created (sfizz vendored)';
export const SYNTH_LIBRARY_MIN_BYTES = 512 * 1024;
export const SYNTH_LIBRARY_MAX_BYTES = 2 * 1024 * 1024;

export function synthLibraryFailure(bytes, homeDir) {
  if (!bytes || bytes.length === 0) return 'the synth library is missing';
  if (!bytes.includes('Java_net_kckern_daylight_cap_synth_shell_PianoEngine_nativeLoadPreset')) {
    return 'the synth library has no JNI exports for net.kckern.daylight.cap.synth.shell.PianoEngine';
  }
  if (!bytes.includes(SYNTH_SFIZZ_MARKER)) return 'sfizz is not linked into the synth library: it would make no sound';
  if (bytes.length < SYNTH_LIBRARY_MIN_BYTES) return `the synth library is too small to hold the sampler (${bytes.length} bytes)`;
  if (bytes.length > SYNTH_LIBRARY_MAX_BYTES) {
    return `the synth library is ${bytes.length} bytes, the size of an unoptimized or unstripped build (limit ${SYNTH_LIBRARY_MAX_BYTES})`;
  }
  if (homeDir && bytes.includes(homeDir)) return 'the synth library names source paths on the build machine';
  return null;
}

/**
 * The permission entries of `aapt2 dump badging`: each as {name, sdk23, maxSdkVersion}.
 * `uses-permission-sdk-23` (asked for only on API 23 and up) and `maxSdkVersion`
 * (asked for only up to that API) change what a device is granted, so they are part
 * of the entry and not left aside.
 */
export function parsePermissions(badging) {
  const out = [];
  for (const m of badging.matchAll(/^uses-permission(-sdk-23)?: name='([^']+)'(.*)$/gm)) {
    const max = /maxSdkVersion='(\d+)'/.exec(m[3]);
    out.push({ name: m[2], sdk23: Boolean(m[1]), maxSdkVersion: max ? Number(max[1]) : null });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** A permission as a capability.yml or device file states it: a name, or {name, sdk23, maxSdkVersion}. */
export function expectedPermission(entry) {
  if (typeof entry === 'string') return { name: entry, sdk23: false, maxSdkVersion: null };
  return { name: String(entry.name), sdk23: Boolean(entry.sdk23), maxSdkVersion: entry.maxSdkVersion == null ? null : Number(entry.maxSdkVersion) };
}

/**
 * The permissions a device's capabilities give it. An entry marked `kioskOnly: true`
 * (drawing over other apps, the page's camera) is expected of a kiosk and must be
 * absent from any other device's APK.
 */
export function permissionsFor(device, capabilities) {
  const kiosk = isKiosk(device);
  return (device.capabilities || [])
    .flatMap((name) => capabilities[name]?.permissions || [])
    .filter((entry) => kiosk || !(typeof entry === 'object' && entry.kioskOnly))
    .map(expectedPermission);
}

const describePermission = (p) => `${p.sdk23 ? 'uses-permission-sdk-23' : 'uses-permission'} ${p.name}${p.maxSdkVersion == null ? '' : ` maxSdkVersion=${p.maxSdkVersion}`}`;

/** Every way the APK's permissions differ from the expected ones, as messages. Empty when they agree. */
export function permissionFailures(apkPermissions, expectedPermissions) {
  const failures = [];
  const expected = new Map(expectedPermissions.map((p) => [p.name, p]));
  const seen = new Set();
  for (const p of apkPermissions) {
    const want = expected.get(p.name);
    if (seen.has(p.name)) { failures.push(`permission declared twice in the APK: ${p.name}`); continue; }
    seen.add(p.name);
    if (!want) { failures.push(`unexpected permission: ${describePermission(p)}`); continue; }
    if (p.sdk23 !== want.sdk23 || p.maxSdkVersion !== want.maxSdkVersion) {
      failures.push(`permission ${p.name} is declared as "${describePermission(p)}" in the APK, expected "${describePermission(want)}"`);
    }
  }
  for (const want of expectedPermissions) {
    if (!seen.has(want.name)) failures.push(`missing permission: ${describePermission(want)}`);
  }
  return failures;
}

const COMPONENT_KINDS = ['activity', 'activity-alias', 'service', 'receiver', 'provider'];

/**
 * True for an element inside <queries>: there a <provider> names another app's
 * provider this app may look up, and is not a component of this app.
 */
export function inQueries(node) {
  for (let p = node.parent; p; p = p.parent) if (p.name === 'queries') return true;
  return false;
}

/** The component elements of an APK manifest tree, <queries> entries left out. */
const componentNodes = (xmltree) => parseXmlTree(xmltree).filter((n) => COMPONENT_KINDS.includes(n.name) && n.attrs.name && !inQueries(n));

/** The components an APK declares, from `aapt2 dump xmltree --file AndroidManifest.xml`, as "kind name". */
export function parseApkComponents(xmltree) {
  return componentNodes(xmltree).map((n) => `${n.name} ${n.attrs.name}`).sort();
}

/**
 * Components a listed capability brings in from a library it depends on (its
 * capability.yml `libraryComponents:`, each "kind name"). They are in no source
 * manifest of this project, and each still needs a row in EXPECTED_COMPONENTS.
 */
export function libraryComponents(deviceCapabilities, capabilities) {
  return deviceCapabilities.flatMap((name) => capabilities[name]?.libraryComponents || []);
}

/** The components a source AndroidManifest.xml declares, as "kind name"; a leading dot is the module's namespace. */
export function declaredComponents(manifestXml, namespace) {
  const out = [];
  const withoutComments = manifestXml.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of withoutComments.matchAll(/<(activity-alias|activity|service|receiver|provider)\b([^>]*)>/g)) {
    const name = /android:name="([^"]+)"/.exec(m[2]);
    if (!name) continue;
    out.push(`${m[1]} ${name[1].startsWith('.') ? namespace + name[1] : name[1]}`);
  }
  return out.sort();
}

/**
 * A component in the APK that neither the base shell nor a listed capability's shell
 * half declares is code from somewhere it should not be (an unlisted capability's
 * service, a library's provider nobody decided on). One that is declared and absent
 * is a capability that will not work.
 */
export function componentFailures(apkComponents, expectedComponents) {
  const failures = [];
  for (const c of apkComponents) if (!expectedComponents.includes(c)) failures.push(`unexpected component in the APK: ${c}`);
  for (const c of expectedComponents) if (!apkComponents.includes(c)) failures.push(`component missing from the APK: ${c}`);
  return failures;
}

/** What kind of build was verified, for the last line of the output. */
export function buildTypeLine(badging, signerText) {
  const debuggable = /^application-debuggable/m.test(badging);
  const signer = signerText == null ? 'signer not checked'
    : /CN=Android Debug/.test(signerText) ? 'signed with the Android debug key' : 'signed with a key that is not the Android debug key';
  return `${debuggable ? 'debug build (debuggable)' : 'not debuggable'}, ${signer}`;
}

/** The alias the generated device manifest adds to a build that lists lockdown (DeviceManifestSource.HOME_ALIAS). */
export const HOME_ALIAS = 'net.kckern.daylight.cap.lockdown.shell.KioskHome';

export const KIOSK_ACTIVITY = 'net.kckern.daylight.cap.webviewhost.shell.KioskActivity';

/** Components that come from the generated device manifest and so are in no module's source manifest. */
export function generatedComponents(capabilities) {
  return capabilities.includes('lockdown') && capabilities.includes('webview-host') ? [`activity-alias ${HOME_ALIAS}`] : [];
}

/**
 * The elements of `aapt2 dump xmltree`, each with its attributes and its ancestors'
 * names. aapt2 indents two spaces per level and prints an element as "E: name (line=N)"
 * and an attribute as "A: [namespace:]name(0x..)=value".
 */
export function parseXmlTree(xmltree) {
  const out = [];
  const stack = [];
  for (const line of xmltree.split('\n')) {
    const el = /^(\s*)E: ([A-Za-z0-9_.:-]+)/.exec(line);
    if (el) {
      const depth = el[1].length;
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      const node = { name: el[2], depth, attrs: {}, parent: stack.length ? stack[stack.length - 1] : null };
      stack.push(node);
      out.push(node);
      continue;
    }
    const at = /^\s*A: (?:[^\s(]*:)?([A-Za-z0-9_]+)(?:\(0x[0-9a-f]+\))?=(.*)$/.exec(line);
    if (at && stack.length) {
      let value = at[2].trim();
      const quoted = /^"(.*?)"/.exec(value);
      if (quoted) value = quoted[1];
      else if (/^(?:\(type 0x12\))?0xffffffff$/i.test(value) || value === 'true') value = 'true';
      else if (/^(?:\(type 0x12\))?0x0$/i.test(value) || value === 'false') value = 'false';
      stack[stack.length - 1].attrs[at[1]] = value;
    }
  }
  return out;
}

/**
 * Installing a build must change no device's home candidate set. Every HOME category
 * in the APK's manifest must sit in an intent filter of the one alias, and that alias
 * must be declared disabled. A build without lockdown has no HOME category at all.
 */
export function homeAliasFailures(xmltree, capabilities) {
  const failures = [];
  const wantsAlias = generatedComponents(capabilities).length > 0;
  const homes = parseXmlTree(xmltree).filter((n) => n.name === 'category' && n.attrs.name === 'android.intent.category.HOME');
  for (const home of homes) {
    const owner = home.parent?.parent;
    if (!owner || owner.name !== 'activity-alias' || owner.attrs.name !== HOME_ALIAS) {
      failures.push(`a HOME filter is on ${owner ? `${owner.name} ${owner.attrs.name}` : 'an unknown element'}: installing would add a home candidate`);
    } else if (owner.attrs.enabled !== 'false') {
      failures.push(`the HOME alias is not declared disabled (android:enabled=${owner.attrs.enabled ?? 'absent'}): installing would add a home candidate`);
    }
  }
  if (wantsAlias) {
    // A kiosk that can be locked is never half of a split screen or a picture-in-picture window.
    const kiosk = parseXmlTree(xmltree).find((n) => n.name === 'activity' && n.attrs.name === KIOSK_ACTIVITY);
    for (const attribute of ['resizeableActivity', 'supportsPictureInPicture']) {
      if (kiosk?.attrs[attribute] !== 'false') failures.push(`the kiosk activity does not declare android:${attribute}="false"`);
    }
  }
  if (wantsAlias && homes.length !== 1) failures.push(`expected one HOME filter on the disabled alias, found ${homes.length}`);
  if (!wantsAlias && homes.length !== 0) failures.push(`a build without lockdown must have no HOME filter, found ${homes.length}`);
  return failures;
}

const BIND_ADMIN = 'android.permission.BIND_DEVICE_ADMIN';
const BIND_TILE = 'android.permission.BIND_QUICK_SETTINGS_TILE';

/**
 * Every component this project declares, with whether another app may reach it and
 * the permission a caller must hold. Written out here, apart from the manifests, on
 * purpose: a manifest edit that exports a component, or drops the permission that
 * guards one, then fails the verifier until this table is changed to match, which is
 * a decision somebody has to make. An exported component with no permission is one
 * any app on the device can start or send to; each of those says why it is.
 */
export const EXPECTED_COMPONENTS = {
  // The setup screen and the kiosk window are started by the launcher and by adb.
  'activity net.kckern.daylight.shell.MainActivity': { exported: true, permission: null },
  'activity net.kckern.daylight.cap.webviewhost.shell.KioskActivity': { exported: true, permission: null },
  // The HOME alias: the system starts it as the home app once it is enabled.
  [`activity-alias ${HOME_ALIAS}`]: { exported: true, permission: null },
  // Opened by a link in another app; every link is checked by the payload before anything happens.
  'activity net.kckern.daylight.cap.notifications.shell.LinkActivity': { exported: true, permission: null },
  'service net.kckern.daylight.shell.ShellService': { exported: false, permission: null },
  'receiver net.kckern.daylight.shell.InstallReceiver': { exported: false, permission: null },
  // BOOT_COMPLETED and MY_PACKAGE_REPLACED are protected broadcasts: only the system sends them.
  'receiver net.kckern.daylight.shell.BootReceiver': { exported: true, permission: null },
  'receiver net.kckern.daylight.cap.lockdown.shell.DaylightAdminReceiver': { exported: true, permission: BIND_ADMIN },
  'service net.kckern.daylight.cap.lockdown.shell.DaylightOwnerService': { exported: true, permission: BIND_ADMIN },
  'service net.kckern.daylight.cap.accessibility.shell.DaylightAccessibilityService': { exported: true, permission: 'android.permission.BIND_ACCESSIBILITY_SERVICE' },
  'provider net.kckern.daylight.cap.micbridge.shell.MicAnchorProvider': { exported: false, permission: null },
  'provider net.kckern.daylight.cap.synth.shell.SynthEngineProvider': { exported: false, permission: null },
  'activity net.kckern.daylight.cap.widgets.shell.FreematicsActivity': { exported: false, permission: null },
  'activity net.kckern.daylight.cap.widgets.shell.PhoneHomeActivity': { exported: true, permission: null },
  'receiver net.kckern.daylight.cap.widgets.shell.ButtonWidgetProvider': { exported: false, permission: null },
  // Exported with no permission: the launcher starts it when a one-action button is
  // placed (APPWIDGET_CONFIGURE), and no permission exists that only a launcher holds.
  // It reads the widget id and nothing else, uses it only for a widget Android says is
  // this app's button, lists the configured actions and stores the choice. It runs no
  // action and starts nothing.
  'activity net.kckern.daylight.cap.widgets.shell.ButtonWidgetConfigActivity': { exported: true, permission: null },
  'service net.kckern.daylight.cap.onetap.shell.ActionTileService$Tile1': { exported: true, permission: BIND_TILE },
  'service net.kckern.daylight.cap.onetap.shell.ActionTileService$Tile2': { exported: true, permission: BIND_TILE },
  'service net.kckern.daylight.cap.onetap.shell.ActionTileService$Tile3': { exported: true, permission: BIND_TILE },
  'service net.kckern.daylight.cap.onetap.shell.ActionTileService$Tile4': { exported: true, permission: BIND_TILE },
  // Reached only through the immutable PendingIntent the payload gives requestPinShortcut:
  // the system sends it when the owner has pinned a media shortcut, with a single-use token.
  'receiver net.kckern.daylight.cap.onetap.shell.PinResultReceiver': { exported: false, permission: null },
  // Exported with no permission: a car (Android Auto), the system's media controls and
  // Bluetooth reach it by binding it, and no permission exists that only they hold. Who is
  // accepted is decided per connection (ControllerPolicy), and a controller hands over
  // media ids only; what an id plays is the payload's answer from the backend.
  'service net.kckern.daylight.cap.mediaservice.shell.DaylightMediaService': { exported: true, permission: null, foregroundServiceType: ['mediaPlayback'] },
  // Started by this app only, when the payload has accepted a keyed media link.
  'activity net.kckern.daylight.cap.mediaservice.shell.PlayActivity': { exported: false, permission: null },
  // Started by this app only: a widget button's immutable PendingIntent and a tile, with
  // one action id that the payload resolves against the configured and pinned actions.
  'service net.kckern.daylight.cap.mediaservice.shell.PlayActionService': { exported: false, permission: null, foregroundServiceType: ['mediaPlayback'] },
  // Opening the record screen starts a recording, so only this app can: the payload on a
  // keyed memo link, and the recording's own notification.
  'activity net.kckern.daylight.cap.quickinput.shell.RecordActivity': { exported: false, permission: null },
  // The text screen sends what is typed on it, so only this app can open it: the payload
  // on a keyed input link.
  'activity net.kckern.daylight.cap.quickinput.shell.TextInputActivity': { exported: false, permission: null },
  // Opening the photo screen opens the camera, so only this app can: the payload on a
  // keyed input link.
  'activity net.kckern.daylight.cap.quickinput.shell.PhotoCaptureActivity': { exported: false, permission: null },
  'activity net.kckern.daylight.cap.quickinput.shell.CaptureStatusActivity': { exported: false, permission: null },
  // The camera app reaches the one file of a capture through a grant the photo screen
  // makes; the provider itself is closed, and grants are limited to /capture/.
  'provider net.kckern.daylight.cap.quickinput.shell.InputFileProvider': { exported: false, permission: null, grantsOnly: '/capture/' },
  'service net.kckern.daylight.cap.quickinput.shell.MemoRecorderService': { exported: false, permission: null, foregroundServiceType: ['microphone'] },
  // Exported with no permission: Android Auto binds it, and no permission exists that only
  // Android Auto holds. Every transaction is judged by its own calling uid (CarGate): only
  // Android Auto's package owned by that uid and signed with the certificate pinned in
  // car.hostPins gets through, in process, to the library's binder; any other is refused.
  'service net.kckern.daylight.cap.caractions.shell.CarHostGateService': { exported: true, permission: null },
  // The Car App Library's service. Bound only by the gate above, in process.
  'service net.kckern.daylight.cap.caractions.shell.DaylightCarAppService': { exported: false, permission: null },
  // Merged in by the Car App Library (androidx.car.app:app); neither is exported.
  'activity androidx.car.app.CarAppPermissionActivity': { exported: false, permission: null },
  'receiver androidx.car.app.notification.CarAppNotificationBroadcastReceiver': { exported: false, permission: null },
  // Merged in by app-projected, which the car's microphone needs; disabled and not exported.
  'service androidx.car.app.CarAppMetadataHolderService': { exported: false, permission: null },
};

/** The bits of android:foregroundServiceType, as aapt2 prints the attribute's mask. */
export const FOREGROUND_TYPE_BITS = { dataSync: 1, mediaPlayback: 2, phoneCall: 4, location: 8, connectedDevice: 16, mediaProjection: 32, camera: 64, microphone: 128 };

/** The shell's own service: its foreground types come from the device file, and verify-build checks them. */
export const SHELL_SERVICE = 'net.kckern.daylight.shell.ShellService';

const typeMaskOf = (node) => {
  const m = /(0x[0-9a-f]+|\d+)$/i.exec(node?.attrs.foregroundServiceType ?? '');
  return m ? Number(m[1]) : 0;
};

/** The foregroundServiceType mask of one named service; 0 when it has none or is absent. */
export function foregroundTypeMask(xmltree, serviceName) {
  return typeMaskOf(parseXmlTree(xmltree).find((n) => n.name === 'service' && n.attrs.name === serviceName));
}

/**
 * Holds each component in the APK to the table: its `exported` flag and the permission
 * that guards it. A component with no row fails too, so a new one cannot ship without
 * somebody deciding both.
 */
/**
 * The table for one device. On a device with control.bind none whose launcher is the
 * kiosk window, the setup activity is not exported: any app on a phone could
 * otherwise start it to raise the battery-exemption screen and the permission prompts.
 */
export function expectedComponentTable(device) {
  const table = { ...EXPECTED_COMPONENTS };
  if (isPersonal(device) && (device.capabilities || []).includes('webview-host')) {
    table['activity net.kckern.daylight.shell.MainActivity'] = { exported: false, permission: null };
  }
  return table;
}

/** A device with no control API: somebody's own phone. */
export function isPersonal(device) {
  return (device.control?.bind ?? 'lan') === 'none';
}

const BOOT_RECEIVER = 'net.kckern.daylight.shell.BootReceiver';

/** Manifest attributes that put a window over the lock screen or wake the screen for it. */
const LOCK_SCREEN_ATTRIBUTES = ['showWhenLocked', 'turnScreenOn', 'showOnLockScreen'];

/**
 * A personal device's APK is held to an exact list: the components another app can
 * reach are the boot receiver and what each listed capability names under `exported:`
 * in its capability.yml. No cleartext traffic, no TV launcher entry, no lock task.
 */
export function personalBuildFailures(xmltree, device, capabilities) {
  if (!isPersonal(device)) return [];
  const failures = [];
  const nodes = parseXmlTree(xmltree);
  const caps = device.capabilities || [];
  const wanted = new Set([BOOT_RECEIVER, ...caps.flatMap((name) => capabilities[name]?.exported || [])]);
  if (!caps.includes('webview-host')) wanted.add('net.kckern.daylight.shell.MainActivity');
  const exported = new Set(nodes.filter((n) => COMPONENT_KINDS.includes(n.name) && n.attrs.name && !inQueries(n) && n.attrs.exported !== 'false').map((n) => n.attrs.name));
  for (const name of [...exported].sort()) {
    if (!wanted.has(name)) failures.push(`exported component not declared by the base shell or a listed capability: ${name}`);
  }
  for (const name of [...wanted].sort()) {
    if (!exported.has(name)) failures.push(`a declared exported component is not exported in the APK: ${name}`);
  }
  const app = nodes.find((n) => n.name === 'application');
  if (app?.attrs.usesCleartextTraffic !== 'false') failures.push('a device with control.bind none must declare android:usesCleartextTraffic="false"');
  if (nodes.some((n) => n.name === 'category' && n.attrs.name === 'android.intent.category.LEANBACK_LAUNCHER')) {
    failures.push('a LEANBACK_LAUNCHER category is in the manifest of a device with control.bind none');
  }
  for (const n of nodes) {
    if (COMPONENT_KINDS.includes(n.name) && n.attrs.lockTaskMode !== undefined) failures.push(`${n.attrs.name} declares android:lockTaskMode on a device with control.bind none`);
    // The site, a recording screen, a draft being typed: all of it is behind the lock.
    for (const attribute of LOCK_SCREEN_ATTRIBUTES) {
      if (COMPONENT_KINDS.includes(n.name) && n.attrs[attribute] === 'true') {
        failures.push(`${n.attrs.name} declares android:${attribute} on a device with control.bind none: nothing of a personal build shows over the lock screen`);
      }
    }
  }
  return failures;
}

/** Nothing the app keeps is backed up or carried to another device. */
export function backupFailures(xmltree) {
  const failures = [];
  const app = parseXmlTree(xmltree).find((n) => n.name === 'application');
  if (app?.attrs.allowBackup !== 'false') failures.push('the application does not declare android:allowBackup="false"');
  for (const attribute of ['dataExtractionRules', 'fullBackupContent']) {
    if (!app?.attrs[attribute]) failures.push(`the application does not declare android:${attribute}`);
  }
  return failures;
}

export function componentAttributeFailures(xmltree, table = EXPECTED_COMPONENTS) {
  const failures = [];
  const nodes = parseXmlTree(xmltree);
  for (const n of nodes) {
    if (!COMPONENT_KINDS.includes(n.name) || !n.attrs.name || inQueries(n)) continue;
    const key = `${n.name} ${n.attrs.name}`;
    const want = table[key];
    if (!want) { failures.push(`no expected exported/permission entry for ${key} (tools/verify-lib.mjs EXPECTED_COMPONENTS)`); continue; }
    // A component that does not say is exported when it has an intent filter (below API 31): it must say.
    const exported = n.attrs.exported === 'true' ? true : n.attrs.exported === 'false' ? false : undefined;
    if (exported === undefined) failures.push(`${key} does not state android:exported`);
    else if (exported !== want.exported) failures.push(`${key} is exported=${exported}, expected exported=${want.exported}`);
    const permission = n.attrs.permission ?? null;
    if (permission !== want.permission) {
      failures.push(`${key} is guarded by ${permission ?? 'no permission'}, expected ${want.permission ?? 'no permission'}`);
    }
    // A provider that is not exported can still hand out access to what it serves, one
    // URI at a time. A row says for which path prefix that may be done (`grantsOnly`);
    // a provider whose row names none allows no grants at all.
    if (n.name === 'provider') {
      const grants = nodes.filter((g) => g.name === 'grant-uri-permission' && g.parent === n);
      if (n.attrs.grantUriPermissions === 'true') {
        failures.push(`${key} declares android:grantUriPermissions="true": access could be granted to any path it serves`);
      } else if (want.grantsOnly) {
        const only = grants.length === 1 && grants[0].attrs.pathPrefix === want.grantsOnly
          && grants[0].attrs.path === undefined && grants[0].attrs.pathPattern === undefined;
        if (!only) failures.push(`${key} must allow grants for the path prefix ${want.grantsOnly} and for nothing else`);
      } else if (grants.length) {
        failures.push(`${key} allows URI grants and its row names no path for them`);
      }
    }
    // A foreground type is what lets a service hold the microphone or keep playing with
    // the app out of sight: each service has exactly the types its row gives it.
    if (n.name === 'service' && n.attrs.name !== SHELL_SERVICE) {
      const types = want.foregroundServiceType || [];
      const wanted = types.reduce((mask, t) => mask | FOREGROUND_TYPE_BITS[t], 0);
      const built = typeMaskOf(n);
      if (built !== wanted) {
        failures.push(`${key} has foregroundServiceType mask ${built}, expected ${wanted} (${types.join('|') || 'none'})`);
      }
    }
  }
  return failures;
}

/**
 * Base-shell permissions only a kiosk needs (DeviceManifestSource.KIOSK_BASE_PERMISSIONS):
 * the app installing its own update when told to over the control API, and turning
 * its own accessibility service on. A kiosk lists lockdown, or shows the kiosk window
 * and has a control API. Every other device (the phone) gets neither.
 */
export const KIOSK_BASE_PERMISSIONS = ['android.permission.REQUEST_INSTALL_PACKAGES', 'android.permission.WRITE_SECURE_SETTINGS'];

export function isKiosk(device) {
  const caps = device.capabilities || [];
  return caps.includes('lockdown') || (caps.includes('webview-host') && (device.control?.bind ?? 'lan') !== 'none');
}

export function kioskBasePermissions(device) {
  return isKiosk(device) ? KIOSK_BASE_PERMISSIONS : [];
}

const CAR_META = 'com.google.android.gms.car.application';

/**
 * Android Auto lists an app as a media app when its manifest carries this meta-data
 * and the resource it names. A build has both exactly when its device lists
 * android-auto, and then it also has the media library service the car binds.
 */
export function carDeclarationFailures(xmltree, capabilities, apkEntries, resourceNamesKept = true) {
  const failures = [];
  const declared = parseXmlTree(xmltree).some((n) => n.name === 'meta-data' && n.attrs.name === CAR_META);
  const resource = apkEntries.some((e) => /^res\/.*automotive_app_desc.*\.xml$/.test(e));
  if (!capabilities.includes('android-auto')) {
    if (declared) failures.push(`the manifest declares ${CAR_META} but the device does not list android-auto`);
    return failures;
  }
  if (!capabilities.includes('media-service')) {
    failures.push("capability 'android-auto' is listed without media-service: the car would find no media library service");
  }
  if (!declared) failures.push(`capability 'android-auto' is listed but the manifest has no ${CAR_META} meta-data`);
  // A release build shortens resource file names, so the file cannot be found by name
  // there; the meta-data's reference to it was resolved when the APK was linked.
  if (!resource && resourceNamesKept) failures.push("capability 'android-auto' is listed but the APK has no automotive_app_desc resource");
  return failures.concat(carAppServiceFailures(xmltree, capabilities));
}

/** The services that offer the Car App Library's binding action: the car screen. */
const CAR_APP_SERVICE_ACTION = 'androidx.car.app.CarAppService';

/** A car screen is in a build exactly when the device lists car-actions. */
function carAppServiceFailures(xmltree, capabilities) {
  const nodes = parseXmlTree(xmltree);
  const services = nodes.filter((n) => n.name === 'action' && n.attrs.name === CAR_APP_SERVICE_ACTION)
    .map((n) => n.parent?.parent).filter((s) => s && s.name === 'service').map((s) => s.attrs.name);
  if (capabilities.includes('car-actions')) {
    return services.length ? [] : ["capability 'car-actions' is listed but no service of the APK offers androidx.car.app.CarAppService"];
  }
  return services.map((name) => `a car app service is declared but the device does not list car-actions: ${name}`);
}
