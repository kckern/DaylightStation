import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRequest, parseArgs, resolveDevice, run, send, usage } from './daylight-device.mjs';

const fleet = { portal: { host: '192.0.2.10', token: 'x'.repeat(64) }, broken: { host: '192.0.2.11' } };
const ports = { port: 8780, lifelinePort: 8781 };

test('resolveDevice returns host and token', () => {
  assert.deepEqual(resolveDevice(fleet, 'portal'), { host: '192.0.2.10', token: 'x'.repeat(64) });
});

test('resolveDevice names the known devices when the name is wrong', () => {
  assert.throws(() => resolveDevice(fleet, 'piano'), /unknown device 'piano'.*portal/);
});

test('resolveDevice refuses a device with no token, without printing anything secret', () => {
  assert.throws(() => resolveDevice(fleet, 'broken'), /no token for 'broken'/);
});

test('status is a GET on the control port with the token header', () => {
  const r = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['status']));
  assert.equal(r.url, 'http://192.0.2.10:8780/status');
  assert.equal(r.method, 'GET');
  assert.equal(r.headers['X-Daylight-Token'], 'x'.repeat(64));
});

test('settings set posts the value as the string that was typed; the device coerces it to the declared type', () => {
  const r = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['settings', 'set', 'debug.execEnabled', 'true']));
  assert.equal(r.method, 'POST');
  assert.equal(r.url, 'http://192.0.2.10:8780/settings');
  assert.deepEqual(JSON.parse(r.body), { key: 'debug.execEnabled', value: 'true' });
  const n = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['settings', 'set', 'a.count', '30']));
  assert.deepEqual(JSON.parse(n.body), { key: 'a.count', value: '30' });
});

test('a string setting can be set to text that looks like a boolean or a number', () => {
  for (const raw of ['true', 'false', '123', '-7', '007']) {
    const r = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['settings', 'set', 'wifi.ssid', raw]));
    assert.strictEqual(JSON.parse(r.body).value, raw);
  }
  const spaced = parseArgs(['settings', 'set', 'kiosk.title', 'Front', 'door', '2']);
  assert.strictEqual(spaced.body.value, 'Front door 2');
});

const fakeFetch = (status, text) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => text });
const sink = () => { const lines = []; return { lines, log: (l) => lines.push(l), error: (l) => lines.push(l) }; };

test('a 2xx response exits 0 and prints the body', async () => {
  const out = sink();
  assert.equal(await send({ url: 'http://192.0.2.10:8781/status', method: 'GET', headers: {} }, fakeFetch(200, '{"ok":true}'), out), 0);
  assert.match(out.lines.join('\n'), /"ok": true/);
});

test('a lifeline refusal (409) exits non-zero and shows the reason', async () => {
  const out = sink();
  const request = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['lifeline', 'rollback']));
  const code = await send(request, fakeFetch(409, '{"ok":false,"error":"no previous payload"}'), out);
  assert.equal(code, 1);
  assert.match(out.lines.join('\n'), /no previous payload/);
  assert.match(out.lines.join('\n'), /HTTP 409/);
});

test('the token never appears in what the CLI prints', async () => {
  const out = sink();
  const request = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['status']));
  await send(request, fakeFetch(401, '{"ok":false,"error":"unauthorized"}'), out);
  assert.ok(!out.lines.join('\n').includes('x'.repeat(64)));
});

test('settings reset is a DELETE with the key', () => {
  const r = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['settings', 'reset', 'a.count']));
  assert.equal(r.method, 'DELETE');
  assert.equal(r.url, 'http://192.0.2.10:8780/settings?key=a.count');
});

test('lifeline commands use the lifeline port', () => {
  const r = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['lifeline', 'rollback']));
  assert.equal(r.url, 'http://192.0.2.10:8781/payload/rollback');
  assert.equal(r.method, 'POST');
});

test('an unknown command is an error', () => {
  assert.throws(() => parseArgs(['frobnicate']), /unknown command 'frobnicate'/);
});

test('get passes a path and query through to the control port', () => {
  const r = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['get', '/midi/tap']));
  assert.equal(r.method, 'GET');
  assert.equal(r.url, 'http://192.0.2.10:8780/midi/tap');
  const q = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['get', '/hid/bluetooth/radio/scan', 'ms=5000']));
  assert.equal(q.url, 'http://192.0.2.10:8780/hid/bluetooth/radio/scan?ms=5000');
  assert.equal(q.body, undefined);
});

test('post turns key=value arguments into a query string and a leading { into a JSON body', () => {
  const q = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['post', '/speaker/bt-cycle', 'settleMs=5000']));
  assert.equal(q.method, 'POST');
  assert.equal(q.url, 'http://192.0.2.10:8780/speaker/bt-cycle?settleMs=5000');
  const b = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['post', '/bluetooth/scan', '{"durationMs":5000}']));
  assert.deepEqual(JSON.parse(b.body), { durationMs: 5000 });
  const e = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['post', '/hid/bluetooth/bond', 'address=00:00:5E:00:53:01', 'transport=le']));
  assert.equal(e.url, 'http://192.0.2.10:8780/hid/bluetooth/bond?address=00%3A00%3A5E%3A00%3A53%3A01&transport=le');
});

test('a raw path must start with a slash', () => {
  assert.throws(() => parseArgs(['get', 'status']), /path must start with/);
  assert.throws(() => parseArgs(['post']), /path must start with/);
});

test('a raw JSON body that does not parse is an error before anything is sent', () => {
  assert.throws(() => parseArgs(['post', '/bluetooth/scan', '{durationMs']), /JSON body/);
});

test('lifeline reset-settings posts to the lifeline port, where a stranded device still answers', () => {
  const r = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['lifeline', 'reset-settings']));
  assert.equal(r.method, 'POST');
  assert.equal(r.url, `http://${fleet.portal.host}:8781/settings/reset`);
  assert.equal(r.headers['X-Daylight-Token'], fleet.portal.token);
  assert.equal(r.body, undefined);
});

// ── kiosk commands (phase 3) ────────────────────────────────────────────────

const portal = () => resolveDevice(fleet, 'portal');
const req = (...args) => buildRequest(portal(), ports, parseArgs(args));
const bodyOf = (...args) => JSON.parse(req(...args).body);
const BASE = 'http://192.0.2.10:8780';

test('kiosk commands map to their routes', () => {
  assert.deepEqual([req('kiosk').method, req('kiosk').url], ['GET', `${BASE}/kiosk/status`]);
  assert.deepEqual([req('load-start').method, req('load-start').url], ['POST', `${BASE}/kiosk/load-start`]);
  assert.equal(req('reload').url, `${BASE}/kiosk/reload`);
  assert.equal(req('foreground').url, `${BASE}/kiosk/foreground`);
  assert.equal(req('renderer-reset').url, `${BASE}/kiosk/renderer/reset`);
  assert.equal(req('restart').url, `${BASE}/kiosk/restart`);
  assert.deepEqual([req('lockdown').method, req('lockdown').url], ['GET', `${BASE}/lockdown`]);
  assert.equal(req('lock').url, `${BASE}/lockdown/lock`);
  assert.deepEqual([req('html').method, req('html').url], ['GET', `${BASE}/debug/html`]);
  assert.deepEqual([req('reboot').method, req('reboot').url], ['POST', `${BASE}/device/reboot`]);
  for (const c of ['load-start', 'reload', 'foreground', 'renderer-reset', 'restart', 'lock', 'reboot']) assert.equal(req(c).method, 'POST', c);
});

test('load posts the url and can skip the wait', () => {
  assert.deepEqual(bodyOf('load', 'https://kiosk.example/x'), { url: 'https://kiosk.example/x' });
  assert.deepEqual(bodyOf('load', 'https://kiosk.example/x', '--no-wait'), { url: 'https://kiosk.example/x', wait: false });
  assert.deepEqual(bodyOf('url', 'https://kiosk.example/x'), { url: 'https://kiosk.example/x' });
  assert.equal(req('load', 'https://kiosk.example/x').url, `${BASE}/kiosk/load`);
  assert.deepEqual(bodyOf('load-start', '--no-wait'), { wait: false });
  assert.deepEqual(bodyOf('reload', '--no-wait'), { wait: false });
  assert.equal(req('reload').body, undefined);
  assert.throws(() => parseArgs(['load']), /usage: load <url>/);
  // A waited load can take webview.loadTimeoutSec: the request is given room.
  assert.ok(parseArgs(['load', 'https://kiosk.example/x']).timeoutMs >= 30000);
});

test('screen and brightness carry typed bodies and refuse nonsense', () => {
  assert.deepEqual(bodyOf('screen', 'off'), { on: false });
  assert.deepEqual(bodyOf('screen', 'on'), { on: true });
  assert.equal(req('screen', 'on').url, `${BASE}/screen`);
  assert.throws(() => parseArgs(['screen', 'dim']), /usage: screen on\|off/);
  assert.deepEqual(bodyOf('brightness', '128'), { level: 128 });
  assert.equal(req('brightness', '128').url, `${BASE}/screen/brightness`);
  for (const bad of ['bright', '256', '-1', undefined]) assert.throws(() => parseArgs(['brightness', bad].filter(Boolean)), /usage: brightness <0-255>/);
});

test('volume reads with no level and sets a percentage', () => {
  assert.deepEqual([req('volume').method, req('volume').url], ['GET', `${BASE}/volume?stream=3`]);
  assert.equal(req('volume', 'get').url, `${BASE}/volume?stream=3`);
  assert.equal(req('volume', 'get', '--stream', '4').url, `${BASE}/volume?stream=4`);
  assert.deepEqual(bodyOf('volume', 'set', '40'), { level: 40 });
  assert.deepEqual(bodyOf('volume', '40'), { level: 40 });
  assert.deepEqual(bodyOf('volume', 'set', '40', '--stream', '4'), { level: 40, stream: 4 });
  assert.equal(req('volume', 'set', '40').method, 'POST');
  for (const bad of [['set'], ['set', '101'], ['set', 'loud'], ['-3'], ['set', '40', '--stream', 'x']]) {
    assert.throws(() => parseArgs(['volume', ...bad]), /usage: volume/);
  }
});

test('overlay sets the text layer, the web layer, or clears', () => {
  assert.deepEqual(bodyOf('overlay', 'text', 'Time', 'is', 'up'), { text: 'Time is up' });
  assert.deepEqual(bodyOf('overlay', 'text'), { text: '' });
  assert.deepEqual(bodyOf('overlay', 'url', 'https://kiosk.example/countdown'), { url: 'https://kiosk.example/countdown' });
  assert.deepEqual(bodyOf('overlay', 'url', 'https://kiosk.example/countdown', '--gravity', 'bottom'),
    { url: 'https://kiosk.example/countdown', gravity: 'bottom' });
  assert.deepEqual(bodyOf('overlay', 'url'), { url: '' });
  assert.deepEqual(bodyOf('overlay', 'clear'), {});
  assert.equal(req('overlay', 'clear').url, `${BASE}/kiosk/overlay`);
  assert.throws(() => parseArgs(['overlay']), /usage: overlay/);
  assert.throws(() => parseArgs(['overlay', 'url', 'https://kiosk.example/c', '--gravity', 'left']), /usage: overlay/);
});

test('lockdown: status, lock, unlock in minutes sent as milliseconds', () => {
  assert.deepEqual([req('lockdown', 'status').method, req('lockdown', 'status').url], ['GET', `${BASE}/lockdown`]);
  assert.deepEqual([req('lockdown', 'lock').method, req('lockdown', 'lock').url], ['POST', `${BASE}/lockdown/lock`]);
  assert.equal(req('lockdown', 'unlock').url, `${BASE}/lockdown/unlock`);
  assert.deepEqual(bodyOf('lockdown', 'unlock', '15'), { forMs: 900000 });
  assert.deepEqual(bodyOf('lockdown', 'unlock'), {});
  assert.deepEqual(bodyOf('unlock', '15'), { forMs: 900000 });
  assert.deepEqual(bodyOf('unlock'), {});
  for (const bad of ['0', '-5', 'soon', '1.5']) assert.throws(() => parseArgs(['lockdown', 'unlock', bad]), /usage: lockdown unlock \[minutes\]/);
  assert.throws(() => parseArgs(['lockdown', 'open']), /usage: lockdown/);
});

test('lockdown home switches the HOME alias on and off', () => {
  assert.deepEqual([req('lockdown', 'home', 'on').method, req('lockdown', 'home', 'on').url], ['POST', `${BASE}/lockdown/home`]);
  assert.deepEqual(bodyOf('lockdown', 'home', 'on'), { enabled: true });
  assert.deepEqual(bodyOf('lockdown', 'home', 'off'), { enabled: false });
  for (const bad of [[], ['yes'], ['on', 'now']]) assert.throws(() => parseArgs(['lockdown', 'home', ...bad]), /usage: lockdown home on\|off/);
});

test('lockdown owner releases, resumes and transfers device ownership', () => {
  assert.deepEqual([req('lockdown', 'owner', 'release').method, req('lockdown', 'owner', 'release').url], ['POST', `${BASE}/lockdown/owner/release`]);
  assert.equal(req('lockdown', 'owner', 'resume').url, `${BASE}/lockdown/owner/resume`);
  const target = 'net.kckern.portalkeys/net.kckern.portalkeys.PortalAdminReceiver';
  assert.equal(req('lockdown', 'owner', 'transfer', target).url, `${BASE}/lockdown/owner/transfer`);
  assert.deepEqual(bodyOf('lockdown', 'owner', 'transfer', target), { to: target });
  for (const bad of [[], ['transfer'], ['transfer', 'not a component'], ['transfer', 'a/b', 'c'], ['release', 'now'], ['take']]) {
    assert.throws(() => parseArgs(['lockdown', 'owner', ...bad]), /usage: lockdown owner/);
  }
});

test('lifeline owner-release posts to the lifeline port, for a device whose payload is broken', () => {
  const r = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['lifeline', 'owner-release']));
  assert.deepEqual([r.method, r.url], ['POST', 'http://192.0.2.10:8781/owner/release']);
});

test('lockdown input sends the ordered lock and release commands', () => {
  const now = 1_700_000_000_000;
  const p = (...a) => parseArgs(['lockdown', 'input', ...a], { now });
  assert.deepEqual(p('lock', '--revision', '7').body, { locked: true, revision: 7 });
  assert.deepEqual(p('lock', '--revision', '7', '--for', '30').body, { locked: true, revision: 7, lockedUntil: now + 30 * 60000 });
  assert.deepEqual(p('release', '--revision', '8').body, { locked: false, revision: 8 });
  assert.deepEqual(p('lock').body, { locked: true });
  assert.equal(buildRequest(portal(), ports, p('lock')).url, `${BASE}/lockdown/input`);
  assert.equal(p('lock').method, 'POST');
  assert.throws(() => p(), /usage: lockdown input/);
  assert.throws(() => p('release', '--for', '5'), /usage: lockdown input/);
  assert.throws(() => p('lock', '--revision', 'x'), /usage: lockdown input/);
});

test('launch takes a package and an optional activity, or an intent URI', () => {
  assert.deepEqual(bodyOf('launch', 'com.example.game'), { package: 'com.example.game' });
  assert.deepEqual(bodyOf('launch', 'com.example.game', '.Main'), { package: 'com.example.game', activity: '.Main' });
  assert.deepEqual(bodyOf('launch', '--intent', 'intent:#Intent;component=com.example.game/.Main;end'),
    { intent: 'intent:#Intent;component=com.example.game/.Main;end' });
  assert.equal(req('launch', 'com.example.game').url, `${BASE}/launch`);
  assert.throws(() => parseArgs(['launch']), /usage: launch/);
  assert.throws(() => parseArgs(['launch', 'a', 'b', 'c']), /usage: launch/);
});

test('eval, exec, speak and sound', () => {
  assert.deepEqual(bodyOf('eval', 'document.title', '+', '1'), { js: 'document.title + 1' });
  assert.deepEqual(bodyOf('eval', '--timeout', '20000', 'fetch("/x").then(r=>r.status)'), { js: 'fetch("/x").then(r=>r.status)', timeoutMs: 20000 });
  assert.deepEqual(bodyOf('eval', 'i--', '>', '0'), { js: 'i-- > 0' }, 'only a leading option is an option');
  assert.equal(req('eval', '1').url, `${BASE}/debug/eval`);
  assert.throws(() => parseArgs(['eval']), /usage: eval/);
  assert.deepEqual(bodyOf('exec', 'ls', '-l'), { cmd: 'ls -l' });
  assert.deepEqual(bodyOf('exec', '--timeout', '30000', 'dumpsys', 'battery'), { cmd: 'dumpsys battery', timeoutMs: 30000 });
  assert.equal(req('exec', 'id').url, `${BASE}/debug/exec`);
  assert.throws(() => parseArgs(['exec']), /usage: exec/);
  assert.deepEqual(bodyOf('speak', 'hello', 'there'), { text: 'hello there' });
  assert.deepEqual(bodyOf('tts', 'hello'), { text: 'hello' });
  assert.deepEqual(bodyOf('speak', '--locale', 'en-US', 'hello'), { text: 'hello', locale: 'en-US' });
  assert.equal(req('speak', 'hi').url, `${BASE}/speak`);
  assert.throws(() => parseArgs(['speak']), /usage: speak/);
  assert.deepEqual(bodyOf('sound', 'https://kiosk.example/x.mp3'), { url: 'https://kiosk.example/x.mp3' });
  assert.deepEqual(bodyOf('sound', 'https://kiosk.example/x.mp3', '--loop', '--stream', '4'), { url: 'https://kiosk.example/x.mp3', loop: true, stream: 4 });
  assert.deepEqual(bodyOf('sound', 'stop'), { stop: true });
  assert.equal(req('sound', 'stop').url, `${BASE}/sound`);
  assert.throws(() => parseArgs(['sound']), /usage: sound/);
});

test('eval-file reads the script from a file', () => {
  const parsed = parseArgs(['eval-file', '/tmp/probe.js'], { readFile: (p) => `/* ${p} */ 1+1` });
  assert.deepEqual(parsed.body, { js: '/* /tmp/probe.js */ 1+1' });
  assert.throws(() => parseArgs(['eval-file']), /usage: eval-file/);
});

test('shot, fps, jank and logcat are GETs with their options', () => {
  const shot = parseArgs(['shot', '/tmp/p.png']);
  assert.equal(buildRequest(portal(), ports, shot).url, `${BASE}/debug/screenshot`);
  assert.equal(shot.saveTo, '/tmp/p.png');
  assert.equal(parseArgs(['shot'], { now: 1234 }).saveTo, 'daylight-1234.png');
  const fps = parseArgs(['fps', '2000', '--min', '20']);
  assert.equal(buildRequest(portal(), ports, fps).url, `${BASE}/debug/fps?ms=2000`);
  assert.equal(fps.minFps, 20);
  assert.equal(parseArgs(['fps']).minFps, undefined);
  assert.equal(buildRequest(portal(), ports, parseArgs(['fps'])).url, `${BASE}/debug/fps?ms=1000`);
  assert.throws(() => parseArgs(['fps', 'fast']), /usage: fps/);
  const jank = parseArgs(['jank']);
  assert.equal(buildRequest(portal(), ports, jank).url, `${BASE}/debug/fps?ms=1000`);
  assert.equal(jank.minFps, 20);
  assert.equal(jank.jank, true);
  assert.deepEqual(jank.pre, { plane: 'control', method: 'POST', path: '/screen', body: { on: true } });
  assert.equal(parseArgs(['jank', '45']).minFps, 45);
  assert.throws(() => parseArgs(['jank', 'low']), /usage: jank/);
  assert.equal(req('logcat', '200', 'Daylight').url, `${BASE}/debug/logcat?lines=200&filter=Daylight`);
  assert.equal(req('logcat', '200', 'a b', '&c').url, `${BASE}/debug/logcat?lines=200&filter=a%20b%20%26c`);
  assert.equal(req('logcat').url, `${BASE}/debug/logcat?lines=500`);
  assert.throws(() => parseArgs(['logcat', 'many']), /usage: logcat/);
});

test('payload and update', () => {
  const sha = 'a'.repeat(64);
  assert.deepEqual([req('payload').method, req('payload').url], ['GET', `${BASE}/payload`]);
  assert.equal(req('payload', 'status').url, `${BASE}/payload`);
  assert.deepEqual(bodyOf('payload', 'push', 'http://192.0.2.20/p.jar', sha), { url: 'http://192.0.2.20/p.jar', sha256: sha });
  assert.deepEqual([req('payload', 'rollback').method, req('payload', 'rollback').url], ['POST', `${BASE}/payload/rollback`]);
  assert.throws(() => parseArgs(['payload', 'push', 'http://192.0.2.20/p.jar']), /usage: payload/);
  assert.throws(() => parseArgs(['payload', 'push', 'http://192.0.2.20/p.jar', 'abc']), /sha256 must be 64 hex/);
  assert.deepEqual([req('update').method, req('update').url], ['GET', `${BASE}/update`]);
  assert.deepEqual(bodyOf('update', 'http://192.0.2.20/a.apk'), { url: 'http://192.0.2.20/a.apk' });
  assert.deepEqual(bodyOf('update', 'http://192.0.2.20/a.apk', sha), { url: 'http://192.0.2.20/a.apk', sha256: sha });
  assert.equal(req('update', 'http://192.0.2.20/a.apk').method, 'POST');
  assert.throws(() => parseArgs(['update', 'http://192.0.2.20/a.apk', 'abc']), /sha256 must be 64 hex/);
  assert.ok(parseArgs(['update', 'http://192.0.2.20/a.apk']).timeoutMs >= 300000, 'a download takes time');
});

test('settings get reads one key out of the list', async () => {
  const parsed = parseArgs(['settings', 'get', 'webview.backButton']);
  assert.deepEqual([parsed.method, parsed.path, parsed.pick], ['GET', '/settings', 'webview.backButton']);
  const listing = JSON.stringify({ ok: true, settings: [{ key: 'webview.backButton', value: 'reload' }, { key: 'lockdown.exitPin', value: '(set)' }] });
  const out = sink();
  assert.equal(await send(buildRequest(portal(), ports, parsed), fakeFetch(200, listing), out, parsed), 0);
  assert.deepEqual(out.lines, ['webview.backButton = "reload"']);
  const missing = sink();
  const none = parseArgs(['settings', 'get', 'no.such']);
  assert.equal(await send(buildRequest(portal(), ports, none), fakeFetch(200, listing), missing, none), 1);
  assert.match(missing.lines.join('\n'), /no such setting: no\.such/);
});

// ── responses ───────────────────────────────────────────────────────────────

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from([0, 1, 2, 255, 254])]);
const fakeResponse = ({ status = 200, text = '', bytes, type = 'application/json', headers = {} }) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => ({ 'content-type': type, ...headers })[name.toLowerCase()] ?? null },
  text: async () => text,
  arrayBuffer: async () => (bytes ?? Buffer.from(text)).buffer.slice((bytes ?? Buffer.from(text)).byteOffset, (bytes ?? Buffer.from(text)).byteOffset + (bytes ?? Buffer.from(text)).length),
});
const io = () => { const files = {}; return { files, writeFile: (path, data) => { files[path] = Buffer.from(data); } }; };

test('shot writes the PNG bytes to the file and prints only the path', async () => {
  const parsed = parseArgs(['shot', '/tmp/p.png']);
  const out = sink();
  const disk = io();
  const code = await send(buildRequest(portal(), ports, parsed), fakeResponse({ bytes: PNG, type: 'image/png' }), out, { ...parsed, ...disk });
  assert.equal(code, 0);
  assert.deepEqual(out.lines, ['/tmp/p.png']);
  assert.ok(disk.files['/tmp/p.png'].equals(PNG), 'the bytes are written as they came, not decoded as text');
});

test('shot refuses a response that is not a PNG and writes nothing', async () => {
  const parsed = parseArgs(['shot', '/tmp/p.png']);
  const out = sink();
  const disk = io();
  const code = await send(buildRequest(portal(), ports, parsed), fakeResponse({ bytes: Buffer.from('<html>login</html>'), type: 'image/png' }), out, { ...parsed, ...disk });
  assert.equal(code, 1);
  assert.deepEqual(disk.files, {});
  assert.match(out.lines.join('\n'), /did not return a PNG/);
  const refused = sink();
  const json = fakeResponse({ status: 501, text: '{"ok":false,"error":"unsupported","reason":"capability \'webview-host\' is not in this build"}' });
  assert.equal(await send(buildRequest(portal(), ports, parsed), json, refused, { ...parsed, ...disk }), 1);
  assert.match(refused.lines.join('\n'), /webview-host/);
  assert.deepEqual(disk.files, {});
});

test('eval prints the result and nothing else', async () => {
  const parsed = parseArgs(['eval', 'document.title']);
  const text = sink();
  assert.equal(await send(buildRequest(portal(), ports, parsed), fakeResponse({ text: '{"ok":true,"result":"Piano"}' }), text, parsed), 0);
  assert.deepEqual(text.lines, ['Piano']);
  const object = sink();
  await send(buildRequest(portal(), ports, parsed), fakeResponse({ text: '{"ok":true,"result":{"a":1}}' }), object, parsed);
  assert.deepEqual(JSON.parse(object.lines.join('\n')), { a: 1 });
  const failed = sink();
  assert.equal(await send(buildRequest(portal(), ports, parsed), fakeResponse({ text: '{"ok":false,"error":"js_error","message":"nope is not defined"}' }), failed, parsed), 1);
  assert.match(failed.lines.join('\n'), /js_error/);
  assert.match(failed.lines.join('\n'), /nope is not defined/);
});

test('an ok:false answer with HTTP 200 exits non-zero', async () => {
  const parsed = parseArgs(['foreground']);
  const out = sink();
  const code = await send(buildRequest(portal(), ports, parsed), fakeResponse({ text: '{"ok":false,"error":"not_in_foreground","foreground":"com.example.game"}' }), out, parsed);
  assert.equal(code, 1);
  assert.match(out.lines.join('\n'), /not_in_foreground/);
});

test('fps exits 1 below the minimum and 0 at or above it', async () => {
  const parsed = parseArgs(['fps', '--min', '30']);
  const answer = (fps) => fakeResponse({ text: JSON.stringify({ ok: true, fps, frames: fps, ms: 1000 }) });
  assert.equal(await send(buildRequest(portal(), ports, parsed), answer(58), sink(), parsed), 0);
  assert.equal(await send(buildRequest(portal(), ports, parsed), answer(30), sink(), parsed), 0);
  const low = sink();
  assert.equal(await send(buildRequest(portal(), ports, parsed), answer(12), low, parsed), 1);
  assert.match(low.lines.join('\n'), /12 fps is below 30/);
});

test('jank exits 0 when smooth, 1 below the threshold and 2 with no reading', async () => {
  const parsed = parseArgs(['jank']);
  const request = buildRequest(portal(), ports, parsed);
  const ok = sink();
  assert.equal(await send(request, fakeResponse({ text: '{"ok":true,"fps":57,"frames":57,"ms":1001}' }), ok, parsed), 0);
  assert.match(ok.lines.join('\n'), /rAF fps = 57 +\[OK\] +\(threshold 20/);
  const janky = sink();
  assert.equal(await send(request, fakeResponse({ text: '{"ok":true,"fps":7,"frames":7,"ms":1001}' }), janky, parsed), 1);
  assert.match(janky.lines.join('\n'), /rAF fps = 7 +\[JANK\]/);
  const dark = sink();
  assert.equal(await send(request, fakeResponse({ status: 408, text: '{"ok":false,"error":"timeout","message":"no animation frame ran"}' }), dark, parsed), 2);
  assert.match(dark.lines.join('\n'), /jank: no reading/);
  assert.equal(await send(request, fakeResponse({ text: '{"ok":false,"error":"no_kiosk_activity"}' }), sink(), parsed), 2);
  assert.equal(await send(request, fakeResponse({ text: '{"ok":true}' }), sink(), parsed), 2);
  const unreachable = async () => { throw new Error('fetch failed'); };
  assert.equal(await send(request, unreachable, sink(), parsed), 2);
});

test('exec prints the output and exits with the command\'s own code', async () => {
  const parsed = parseArgs(['exec', 'false']);
  const request = buildRequest(portal(), ports, parsed);
  const out = { stdout: [], stderr: [], log: (l) => out.stdout.push(l), error: (l) => out.stderr.push(l) };
  const code = await send(request, fakeResponse({ text: '{"ok":true,"exitCode":3,"stdout":"hello\\n","stderr":"oops\\n","timedOut":false}' }), out, parsed);
  assert.equal(code, 3);
  assert.deepEqual(out.stdout, ['hello']);
  assert.deepEqual(out.stderr, ['oops']);
  assert.equal(await send(request, fakeResponse({ text: '{"ok":true,"exitCode":0,"stdout":"","stderr":""}' }), sink(), parsed), 0);
  assert.equal(await send(request, fakeResponse({ text: '{"ok":true,"exitCode":-1,"stdout":"","stderr":"","timedOut":true}' }), sink(), parsed), 124);
  const off = sink();
  assert.equal(await send(request, fakeResponse({ status: 501, text: '{"ok":false,"error":"unsupported","reason":"debug.execEnabled is false"}' }), off, parsed), 1);
  assert.match(off.lines.join('\n'), /debug\.execEnabled is false/);
});

test('logcat prints plain text and says when it holds this app\'s lines only', async () => {
  const parsed = parseArgs(['logcat', '50']);
  const request = buildRequest(portal(), ports, parsed);
  const own = sink();
  assert.equal(await send(request, fakeResponse({ text: 'line one\nline two\n', type: 'text/plain', headers: { 'x-daylight-log-scope': 'own' } }), own, parsed), 0);
  assert.equal(own.lines[0], 'line one\nline two');
  assert.match(own.lines.join('\n'), /READ_LOGS/);
  const all = sink();
  await send(request, fakeResponse({ text: 'line one\n', type: 'text/plain', headers: { 'x-daylight-log-scope': 'all' } }), all, parsed);
  assert.deepEqual(all.lines, ['line one']);
});

test('html prints the document, or saves it to a file', async () => {
  const parsed = parseArgs(['html']);
  const out = sink();
  await send(buildRequest(portal(), ports, parsed), fakeResponse({ text: '{"ok":true,"html":"<html><body>hi</body></html>"}' }), out, parsed);
  assert.deepEqual(out.lines, ['<html><body>hi</body></html>']);
  const saving = parseArgs(['html', '/tmp/page.html']);
  const disk = io();
  const saved = sink();
  await send(buildRequest(portal(), ports, saving), fakeResponse({ text: '{"ok":true,"html":"<html></html>"}' }), saved, { ...saving, ...disk });
  assert.equal(disk.files['/tmp/page.html'].toString(), '<html></html>');
  assert.deepEqual(saved.lines, ['/tmp/page.html']);
});

// ── the token ───────────────────────────────────────────────────────────────

test('the token is only ever a header: never in a URL, a body or a printed line', async () => {
  const token = 'x'.repeat(64);
  const commands = [['status'], ['kiosk'], ['load', 'https://kiosk.example/'], ['shot', '/tmp/p.png'], ['eval', '1'], ['exec', 'id'],
    ['jank'], ['fps'], ['logcat'], ['lockdown', 'unlock', '5'], ['lockdown', 'input', 'lock'], ['volume', 'set', '5'], ['overlay', 'clear'],
    ['payload', 'push', 'http://192.0.2.20/p.jar', 'a'.repeat(64)], ['update', 'http://192.0.2.20/a.apk'], ['settings', 'get', 'a.b'],
    ['lifeline', 'log'], ['html'], ['speak', 'hi'], ['sound', 'stop'], ['launch', 'com.example.game'], ['get', '/wifi']];
  for (const args of commands) {
    const parsed = parseArgs(args);
    for (const r of [buildRequest(portal(), ports, parsed), ...(parsed.pre ? [buildRequest(portal(), ports, parsed.pre)] : [])]) {
      assert.ok(!r.url.includes(token), `${args[0]}: url`);
      assert.ok(!(r.body || '').includes(token), `${args[0]}: body`);
      assert.equal(r.headers['X-Daylight-Token'], token);
    }
    // A device or a proxy that echoes the token back, and a network error that quotes the request.
    for (const reply of [fakeResponse({ status: 500, text: `{"ok":false,"error":"internal","message":"header was ${token}"}` }),
      fakeResponse({ text: `echo ${token}`, type: 'text/plain' }),
      async () => { throw new Error(`connect ECONNREFUSED 192.0.2.10:8780 (X-Daylight-Token: ${token})`); }]) {
      const out = sink();
      let thrown = '';
      try { await send(buildRequest(portal(), ports, parsed), reply, out, { ...parsed, ...io() }); } catch (e) { thrown = String(e.message || e); }
      assert.ok(!(out.lines.join('\n') + thrown).includes(token), `${args[0]}: printed`);
    }
  }
});

test('the usage text names every command', () => {
  for (const c of ['status', 'kiosk', 'load', 'load-start', 'reload', 'foreground', 'renderer-reset', 'restart', 'reboot', 'screen', 'brightness',
    'volume', 'overlay', 'lockdown', 'launch', 'shot', 'eval', 'eval-file', 'html', 'fps', 'jank', 'exec', 'logcat', 'speak', 'sound',
    'payload', 'update', 'settings', 'lifeline', 'get', 'post']) {
    assert.match(usage(), new RegExp(`(^|\\n)  ${c}( |$|\\n)`), c);
  }
  assert.throws(() => parseArgs(['frobnicate']), /daylight-device help/);
});

test('run sends the wake request before a jank reading and never fails on it', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(`${init.method} ${url}`);
    if (url.endsWith('/screen')) return fakeResponse({ status: 501, text: '{"ok":false,"error":"unsupported"}' })();
    return fakeResponse({ text: '{"ok":true,"fps":60,"frames":60,"ms":1000}' })();
  };
  const out = sink();
  const code = await run(portal(), ports, parseArgs(['jank']), { fetchImpl, out, sleep: async () => {} });
  assert.equal(code, 0);
  assert.deepEqual(calls, [`POST ${BASE}/screen`, `GET ${BASE}/debug/fps?ms=1000`]);
  assert.ok(!out.lines.join('\n').includes('unsupported'), 'the wake request\'s answer is not printed');
});
