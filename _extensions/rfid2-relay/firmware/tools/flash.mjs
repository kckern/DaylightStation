#!/usr/bin/env node
// Build and deliver the RFID2 shell. Private OTA auth never appears in argv or logs.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const firmwareDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const ota = args.includes('--ota');
const portIndex = args.indexOf('--port');
const hostIndex = args.indexOf('--host');
const viaIndex = args.indexOf('--via');
const source = args.find((arg, index) => !arg.startsWith('--')
  && (portIndex < 0 || index !== portIndex + 1)
  && (hostIndex < 0 || index !== hostIndex + 1)
  && (viaIndex < 0 || index !== viaIndex + 1));
const port = portIndex >= 0 ? args[portIndex + 1] : null;
const host = hostIndex >= 0 ? args[hostIndex + 1] : null;
const via = viaIndex >= 0 ? args[viaIndex + 1] : null;
if (!source || (ota && port) || (!ota && (host || via)) || (via && !/^[a-zA-Z0-9._-]+$/.test(via))) {
  console.error('usage: node tools/flash.mjs <private-device.yml> [--port /dev/cu.usbserial-...] [--ota --host ip-or-name --via garage]');
  process.exit(2);
}

const config = yaml.load(readFileSync(source, 'utf8')) || {};
const password = String(config.ota?.password || '');
const destination = ota ? (host || config.device?.ip || `${config.device?.id}.local`)
  : (port || readdirSync('/dev').filter((name) => /^cu\.usbserial-/.test(name)).map((name) => `/dev/${name}`)[0]);
if (!destination || (ota && (!password || config.ota?.enabled !== true))) {
  console.error(ota ? 'OTA requires an enabled private password and host' : 'No USB serial port found');
  process.exit(2);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: firmwareDir, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  // PlatformIO may run espota in debug mode; it can print --auth. Buffer and
  // redact before displaying any output, including failures.
  const redact = (value) => password
    ? String(value || '').split(password).join('<redacted>')
    : String(value || '');
  process.stdout.write(redact(result.stdout));
  process.stderr.write(redact(result.stderr));
  if (result.error || result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.error?.code ?? 'unknown'})`);
}

let remoteDir = null;
let remoteCreated = false;
try {
  run('node', ['tools/gen-config.mjs', source]);
  console.log(`[flash] ${ota ? 'OTA' : 'USB'} ${config.device?.id} -> ${destination}${via ? ` via ${via}` : ''}`);
  if (!ota) {
    run('pio', ['run', '-e', 'm5-atom', '-t', 'upload', '--upload-port', destination]);
  } else {
    run('pio', ['run', '-e', 'm5-atom']);
    const image = path.join(firmwareDir, '.pio', 'build', 'm5-atom', 'firmware.bin');
    const uploader = path.join(os.homedir(), '.platformio', 'packages', 'framework-arduinoespressif32', 'tools', 'espota.py');
    const wrapper = path.join(firmwareDir, 'tools', 'espota-stdin.py');
    chmodSync(image, 0o600);
    if (via) {
      remoteDir = `/tmp/daylight-rfid2-ota-${randomBytes(8).toString('hex')}`;
      run('ssh', [via, 'mkdir', '-m', '700', remoteDir]);
      remoteCreated = true;
      run('scp', [image, uploader, wrapper, `${via}:${remoteDir}/`]);
      run('ssh', [via, 'python3', `${remoteDir}/espota-stdin.py`, destination,
        `${remoteDir}/firmware.bin`, `${remoteDir}/espota.py`], { input: `${password}\n` });
    } else {
      run('python3', [wrapper, destination, image, uploader], { input: `${password}\n` });
    }
  }
  console.log('[flash] upload finished; verify /status build and ota.ready');
} catch (error) {
  console.error(`[flash] ${error.message}`);
  process.exitCode = 1;
} finally {
  if (remoteCreated) {
    try { run('ssh', [via, 'rm', '-rf', remoteDir]); }
    catch { console.error(`[flash] WARNING: remove staged firmware at ${via}:${remoteDir}`); }
  }
}
