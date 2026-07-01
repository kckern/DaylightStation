#!/usr/bin/env node
// fkb.cli.mjs — Fully Kiosk Browser REST control for the piano tablet.
//
// Why this exists: the Fully REST API on :2323 survives a reboot (ADB-over-WiFi
// does not), so this is the channel that keeps working when ADB is gone. It
// wraps every command used to administer the kiosk SPA, plus a couple of
// higher-level helpers (JS injection, an fps jank probe).
//
// Host:     FKB_HOST env or default 10.0.0.245:2323
// Password: $FKB_PW, else /tmp/fkb_piano_pw, else `op read op://Private/Fully Kiosk Piano/value`
// ADB:      optional, for OS-level settings the FKB REST API can't reach (e.g.
//           "stay awake while plugged"). Set FKB_ADB to the adb invocation — "adb"
//           if it's on PATH, or "sudo docker exec daylight-station adb" to borrow
//           the container's adb on the prod host. Target IP comes from FKB_HOST;
//           FKB_ADB_PORT overrides the default 5555. See `adb` / `keepawake`.
//
// What needs ADB: OS globals (stay_on_while_plugged_in, wifi_sleep_policy) and any
// shell (top, dumpsys, input, pm/am, logcat) via the `adb` passthrough. See `fps`
// for jank detection without CPU%.
//
// Examples:
//   node fkb.cli.mjs info                       # deviceInfo (RAM/battery/wifi)
//   node fkb.cli.mjs shot /tmp/p.png            # screenshot
//   node fkb.cli.mjs get forceScreenOrientation
//   node fkb.cli.mjs set forceScreenOrientation 2
//   node fkb.cli.mjs restart                    # respawn the WebView/renderer
//   node fkb.cli.mjs reload                     # loadStartUrl
//   node fkb.cli.mjs fps                        # probe frame-rate -> screenshot
//   node fkb.cli.mjs inject "alert(1)"          # run JS in the SPA (sets injectJsCode + reload)
//   node fkb.cli.mjs back-script                # restore the back-button reload injectJsCode
//   node fkb.cli.mjs cmd setBooleanSetting key=kioskMode value=true

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const HOST = process.env.FKB_HOST || '10.0.0.245:2323';
const BASE = `http://${HOST}`;
const PW_CACHE = '/tmp/fkb_piano_pw';

const BACK_BUTTON_JS =
  "history.pushState(null,'',location.href);" +
  "window.addEventListener('popstate',function(){location.reload();});";

function password() {
  if (process.env.FKB_PW) return process.env.FKB_PW.trim();
  if (existsSync(PW_CACHE)) {
    const v = readFileSync(PW_CACHE, 'utf8').trim();
    if (v) return v;
  }
  const v = execSync('op read "op://Private/Fully Kiosk Piano/value"', { encoding: 'utf8' }).trim();
  writeFileSync(PW_CACHE, v, { mode: 0o600 });
  return v;
}
const PW = password();

/** Call a Fully command. opts: {json:true} parse JSON, {raw:true} return Buffer. */
async function call(cmd, params = {}, opts = {}) {
  const u = new URL(BASE + '/');
  u.searchParams.set('cmd', cmd);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (opts.json) u.searchParams.set('type', 'json');
  u.searchParams.set('password', PW);
  const res = await fetch(u, { signal: AbortSignal.timeout(opts.timeout || 15000) });
  if (opts.raw) return Buffer.from(await res.arrayBuffer());
  const text = await res.text();
  if (opts.json) { try { return JSON.parse(text); } catch { return text; } }
  return text;
}

/** Pull a concise status line out of Fully's HTML response. */
function status(html) {
  const ok = html.match(/<p class='success'>([^<]+)</);
  if (ok) return '✓ ' + ok[1];
  const err = html.match(/<p class='error'>([^<]+)</);
  if (err) return '✗ ' + err[1];
  return html.length > 200 ? '(ok)' : html.trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function tsPath() { return `/tmp/fkb-${Date.now()}.png`; }

// ── ADB (optional) — OS-level controls the FKB REST API can't reach ──────────
// FKB_ADB is the adb invocation: "adb" (on PATH) or e.g.
// "sudo docker exec daylight-station adb" to borrow the container's adb. The ADB
// target is the FKB host IP on FKB_ADB_PORT (default 5555).
const ADB = process.env.FKB_ADB || 'adb';
const ADB_SERIAL = `${HOST.split(':')[0]}:${process.env.FKB_ADB_PORT || 5555}`;
function adbRaw(argline) { return execSync(`${ADB} ${argline}`, { encoding: 'utf8' }).trim(); }
function adbShell(cmd) {
  return execSync(`${ADB} -s ${ADB_SERIAL} shell ${JSON.stringify(cmd)}`, { encoding: 'utf8' }).trim();
}
function adbConnect() {
  adbRaw(`connect ${ADB_SERIAL}`);
  if (adbShell('echo ok') !== 'ok') throw new Error(`ADB not authorized on ${ADB_SERIAL}`);
}

const commands = {
  async info(keys) {
    const d = await call('deviceInfo', {}, { json: true });
    if (keys && keys.length) {
      for (const k of keys) console.log(`${k}: ${d[k]}`);
    } else {
      const pick = ['deviceModel', 'androidVersion', 'isLicensed', 'screenOrientation',
        'ramFreeMemory', 'ramTotalMemory', 'batteryLevel', 'wifiSignalLevel', 'startUrl'];
      for (const k of pick) if (k in d) console.log(`${k.padEnd(16)}: ${d[k]}`);
    }
  },
  async shot([out]) {
    const path = out || tsPath();
    const buf = await call('getScreenshot', { format: 'png' }, { raw: true, timeout: 20000 });
    writeFileSync(path, buf);
    console.log(path);
  },
  async get([key]) {
    const all = await call('listSettings', {}, { json: true });
    if (!key) { console.log(JSON.stringify(all, null, 2)); return; }
    console.log(key in all ? `${key} = ${JSON.stringify(all[key])}` : `(no such key: ${key})`);
  },
  async set([key, ...rest]) {
    const value = rest.join(' ');
    const isBool = value === 'true' || value === 'false';
    const cmd = isBool ? 'setBooleanSetting' : 'setStringSetting';
    console.log(status(await call(cmd, { key, value })));
  },
  async reload() { await call('loadStartUrl'); console.log('✓ loadStartUrl'); },
  async url([u]) { await call('loadUrl', { url: u }); console.log('✓ loadUrl ' + u); },
  async restart() { await call('restartApp'); console.log('✓ restartApp (renderer respawns)'); },
  async screen([s]) { await call(s === 'off' ? 'screenOff' : 'screenOn'); console.log('✓ screen ' + s); },
  async brightness([n]) { console.log(status(await call('setScreenBrightness', { level: n }))); },
  async tts(words) { await call('textToSpeech', { text: words.join(' ') }); console.log('✓ tts'); },
  async launch([pkg]) { await call('startApplication', { package: pkg }); console.log('✓ launched ' + pkg); },

  // Install/update an APK via Fully's MDM auto-install (no ADB). Point it at an
  // APK URL the tablet can reach; Fully downloads + installs. Android may show a
  // one-tap "Install" confirm unless Fully is device-owner. Same signing key is
  // required to update in place — else uninstall the old one first.
  async install([url]) {
    if (!url) { console.error('usage: install <apk-url>'); process.exit(1); }
    console.log(status(await call('setBooleanSetting', { key: 'mdmDisableAppsFromUnknownSources', value: 'false' })));
    console.log(status(await call('setStringSetting', { key: 'mdmApkToInstall', value: url })));
    // Nudge Fully to act on it now rather than waiting for the next check.
    await call('restartApp');
    console.log('→ Fully fetching + installing: ' + url);
    console.log('  (tap "Install" on the tablet if Android prompts)');
  },

  async inject(parts) {
    const js = parts.join(' ');
    console.log(status(await call('setStringSetting', { key: 'injectJsCode', value: js })));
    await call('loadStartUrl');
    console.log('✓ reloaded (JS injected)');
  },
  async 'inject-file'([path]) {
    const js = readFileSync(path, 'utf8');
    console.log(status(await call('setStringSetting', { key: 'injectJsCode', value: js })));
    await call('loadStartUrl');
    console.log('✓ reloaded (JS from ' + path + ')');
  },
  async 'back-script'() {
    console.log(status(await call('setStringSetting', { key: 'injectJsCode', value: BACK_BUTTON_JS })));
    await call('loadStartUrl');
    console.log('✓ back-button reload script restored + reloaded');
  },

  // Detect jank without CPU%: measure rAF fps in the live SPA, draw it as a
  // banner, screenshot it. Healthy ~60; a stuck renderer reads single digits.
  async fps([out]) {
    const probe = BACK_BUTTON_JS +
      "setTimeout(function(){var c=0,t=performance.now();function f(){c++;" +
      "if(performance.now()-t<1000){requestAnimationFrame(f);}else{var b=document.createElement('div');" +
      "b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#c00;color:#fff;" +
      "font:bold 40px monospace;padding:16px;text-align:center';b.textContent='rAF fps = '+c+" +
      "'  (60=smooth, single-digit=stuck)';document.body.appendChild(b);}}requestAnimationFrame(f);},2500);";
    await call('setStringSetting', { key: 'injectJsCode', value: probe });
    await call('loadStartUrl');
    process.stdout.write('measuring (waiting for SPA load + 1s sample)…\n');
    await sleep(13000);
    const path = out || tsPath();
    writeFileSync(path, await call('getScreenshot', { format: 'png' }, { raw: true, timeout: 20000 }));
    // leave the back-button script in place (probe banner clears on next reload)
    await call('setStringSetting', { key: 'injectJsCode', value: BACK_BUTTON_JS });
    console.log(path + '   ← view it to read the fps banner');
  },

  async cmd([command, ...kv]) {
    const params = Object.fromEntries(kv.map((s) => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; }));
    const out = await call(command, params);
    console.log(out.length > 400 ? status(out) : out.trim());
  },

  // ── ADB-backed commands (need FKB_ADB) ─────────────────────────────────────
  async 'adb-connect'() {
    adbConnect();
    console.log('✓ adb connected + authorized: ' + ADB_SERIAL);
  },
  async adb(parts) {
    if (!parts.length) {
      console.error('usage: adb <shell command…>   e.g. adb "settings get global stay_on_while_plugged_in"');
      process.exit(1);
    }
    adbConnect();
    console.log(adbShell(parts.join(' ')));
  },

  // Make the tablet never sleep while plugged + survive WiFi doze. Combines the
  // FKB wake-locks (REST, survive without ADB) with the OS-level globals (ADB)
  // that FKB can't set. Idempotent — safe to re-run.
  async keepawake() {
    const fkb = {
      keepScreenOn: 'true',
      setWifiWakelock: 'true',
      setCpuWakelock: 'true',
      preventSleepWhileScreenOff: 'true',
      reloadOnWifiOn: 'true',
    };
    for (const [key, value] of Object.entries(fkb)) {
      console.log(`FKB ${key} → ${status(await call('setBooleanSetting', { key, value }))}`);
    }
    try {
      adbConnect();
    } catch (e) {
      console.log(`✗ ADB unreachable (${e.message}) — FKB wake-locks applied; OS-level skipped.`);
      console.log('  Set FKB_ADB (e.g. "sudo docker exec daylight-station adb") and ensure ADB-over-WiFi is on.');
      return;
    }
    adbShell('settings put global stay_on_while_plugged_in 7'); // AC|USB|Wireless
    adbShell('settings put global wifi_sleep_policy 2');         // never sleep WiFi
    console.log('OS stay_on_while_plugged_in = ' + adbShell('settings get global stay_on_while_plugged_in'));
    console.log('OS wifi_sleep_policy        = ' + adbShell('settings get global wifi_sleep_policy'));
    console.log('✓ keepawake applied');
  },

  // Self-heal a dead kiosk page. After a transient load failure (e.g. the app
  // restarts mid-load) the WebView can get stuck on Chrome's "Webpage not
  // available" error page and never recover — killing the piano SPA and every-
  // thing it runs (screensaver, MIDI wake). These FKB settings make it retry on
  // its own. They only fire on failure / connectivity return, so they don't
  // disturb a healthy idle session or the app's own screensaver logic (unlike
  // reloadOnIdle / reloadEachSeconds, which we assert OFF). Idempotent.
  async recovery() {
    // seconds-valued settings (strings): '0' = disabled
    const str = {
      reloadPageFailure: '30', // retry a failed page load after 30s (the fix)
      reloadOnIdle: '0',       // OFF: would interrupt idle video watching
      reloadEachSeconds: '0',  // OFF: no blind periodic reload
    };
    // boolean settings
    const bool = {
      reloadOnInternet: 'true',     // reload when internet connectivity returns
      reloadOnWifiOn: 'true',       // reload when WiFi comes back
      waitInternetOnReload: 'true', // wait for net rather than hammer while offline
      restartOnCrash: 'true',       // relaunch FKB if the app process dies
    };
    for (const [key, value] of Object.entries(str)) {
      console.log(`FKB ${key} → ${status(await call('setStringSetting', { key, value }))}`);
    }
    for (const [key, value] of Object.entries(bool)) {
      console.log(`FKB ${key} → ${status(await call('setBooleanSetting', { key, value }))}`);
    }
    console.log('✓ recovery applied (a dead kiosk page self-heals within ~30s)');
  },
};

const [, , name, ...args] = process.argv;
if (!name || name === 'help' || !commands[name]) {
  console.log(`fkb — Fully Kiosk control (${BASE})\n`);
  console.log('Commands:');
  console.log('  info [keys...]            deviceInfo (RAM/battery/wifi)');
  console.log('  shot [path]              screenshot -> file');
  console.log('  fps [path]               probe frame-rate (jank w/o CPU%) -> screenshot');
  console.log('  get [key]                all settings, or one value');
  console.log('  set <key> <value>        set a setting (bool auto-detected)');
  console.log('  reload | restart         loadStartUrl | restartApp (respawn renderer)');
  console.log('  url <url>                loadUrl');
  console.log('  screen <on|off> | brightness <0-255> | tts <text>');
  console.log('  launch <package>         startApplication');
  console.log('  inject <js> | inject-file <path> | back-script');
  console.log('  cmd <fullyCmd> [k=v...]  raw passthrough');
  console.log('  adb-connect              connect + authorize ADB over WiFi');
  console.log('  adb <shell…>             run a shell command via ADB (top/dumpsys/settings/…)');
  console.log('  keepawake                FKB wake-locks + OS stay-awake-while-plugged (needs FKB_ADB)');
  console.log('  recovery                 FKB auto-reload settings so a dead kiosk page self-heals');
  console.log('\nADB commands need FKB_ADB set (e.g. "adb" or "sudo docker exec daylight-station adb").');
  process.exit(name && name !== 'help' ? 1 : 0);
}
try { await commands[name](args); } catch (e) { console.error('✗ ' + (e.message || e)); process.exit(1); }
