#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { parseDocument } from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const firmwareDir = path.join(here, '..');
const argv = process.argv.slice(2);
const consumed = new Set();
const option = (name) => {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(`ERROR: ${name} requires a value.`);
    process.exit(1);
  }
  consumed.add(index);
  consumed.add(index + 1);
  return value;
};
const explicitHost = option('--host');
const explicitVia = option('--via');
const rotateIndex = argv.indexOf('--rotate-credential');
const rotateCredential = rotateIndex >= 0;
if (rotateCredential) consumed.add(rotateIndex);
const rest = argv.filter((_, index) => !consumed.has(index));
const src = rest[0] || process.env.DAYLIGHT_PRESSURE_MATS_CONFIG;
const id = rest[1] || '';

if (!src) {
  console.error('ERROR: pass pressure-mats config.yml or set DAYLIGHT_PRESSURE_MATS_CONFIG.');
  process.exit(1);
}

const originalConfig = readFileSync(src, 'utf8');
const cfg = yaml.load(originalConfig) || {};
const mats = cfg.pressure_mats || {};
const matId = id || Object.keys(mats)[0];
const mat = mats[matId];
if (!mat) {
  console.error(`ERROR: pressure mat "${matId}" not found. Available: ${Object.keys(mats).join(', ') || '(none)'}`);
  process.exit(1);
}
const ota = mat.ota || {};
if (ota.enabled !== true || !String(ota.password || '')) {
  console.error(`ERROR: ${src} (mat=${matId}) requires ota.enabled: true and a non-empty ota.password.`);
  process.exit(1);
}

const configuredHost = mat.device?.host || `${matId}.local`;
const host = String(explicitHost || configuredHost).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const via = String(explicitVia || ota.via || '');
const run = (command, args, options = {}) => {
  try {
    const stdio = options.input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'];
    execFileSync(command, args, { cwd: firmwareDir, stdio, ...options });
  } catch (error) {
    // Never let Node's default uncaught-exception formatter echo subprocess
    // argv or environment: authentication material may be present there.
    const status = Number.isInteger(error?.status) ? error.status : 1;
    console.error(`[ota] ${command} failed (exit ${status})`);
    const sanitized = new Error(`${command} failed`);
    sanitized.status = status || 1;
    throw sanitized;
  }
};

const originalMode = statSync(src).mode & 0o777;
const writePrivateConfig = (contents) => {
  const temporary = path.join(path.dirname(src), `.${path.basename(src)}.${process.pid}.tmp`);
  writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, src);
  chmodSync(src, Math.min(originalMode, 0o600));
};

let rotated = false;
let remoteFiles = null;
try {
  const uploadPassword = String(ota.password);
  if (rotateCredential) {
    const doc = parseDocument(originalConfig, { keepSourceTokens: true });
    if (doc.errors.length) throw new Error(`cannot parse ${src}: ${doc.errors[0].message}`);
    doc.setIn(['pressure_mats', matId, 'ota', 'password'], randomBytes(24).toString('base64url'));
    writePrivateConfig(String(doc));
    rotated = true;
    console.log(`[ota] ${matId}: staged a new private credential for this image`);
  }

  console.log(`[ota] generating firmware for ${matId}`);
  run('node', ['tools/gen-config.mjs', src, matId]);
  // The OTA environment changes delivery only. Build the base environment so
  // PlatformIO does not instantiate its noisy, credential-logging uploader.
  run('pio', ['run', '-e', 'trampletek-blue']);

  const imagePath = path.join(firmwareDir, '.pio', 'build', 'trampletek-blue', 'firmware.bin');
  const wrapperPath = path.join(here, 'espota-stdin.py');
  const espotaPath = path.join(os.homedir(), '.platformio', 'packages', 'framework-arduinoespressif32', 'tools', 'espota.py');
  if (!existsSync(imagePath) || !existsSync(espotaPath)) {
    throw new Error(`OTA build or uploader missing: ${imagePath}, ${espotaPath}`);
  }

  console.log(`[ota] uploading ${matId} -> ${host}:3232 (authenticated${via ? ` via ${via}` : ''})`);
  if (via) {
    const safeId = matId.replace(/[^a-zA-Z0-9_-]/g, '-');
    const remoteDir = `/tmp/daylight-pressure-mat-ota-${safeId}`;
    remoteFiles = [
      `${remoteDir}/espota.py`,
      `${remoteDir}/espota-stdin.py`,
      `${remoteDir}/firmware.bin`,
    ];
    run('ssh', [via, 'mkdir', '-p', remoteDir]);
    run('scp', [espotaPath, wrapperPath, imagePath, `${via}:${remoteDir}/`]);
    run('ssh', [via, 'python3', remoteFiles[1], host, remoteFiles[2], remoteFiles[0]], {
      input: `${uploadPassword}\n`,
    });
  } else {
    run('python3', [wrapperPath, host, imagePath, espotaPath], { input: `${uploadPassword}\n` });
  }
  console.log(`[ota] complete -> ${host}`);
  if (rotated) console.log(`[ota] ${matId}: credential rotation committed`);
} catch (error) {
  if (rotated) {
    try {
      writePrivateConfig(originalConfig);
      console.error(`[ota] ${matId}: upload failed; private credential rolled back`);
    } catch {
      console.error(`[ota] ${matId}: CRITICAL: upload failed and credential rollback failed`);
    }
  }
  if (!Number.isInteger(error?.status)) console.error(`[ota] ${error.message}`);
  process.exitCode = Number.isInteger(error?.status) ? error.status : 1;
} finally {
  if (via && remoteFiles) {
    try {
      execFileSync('ssh', [via, 'rm', '-f', ...remoteFiles], { cwd: firmwareDir, stdio: 'ignore' });
    } catch {
      console.error('[ota] warning: could not remove staged non-secret OTA files');
    }
  }
}
