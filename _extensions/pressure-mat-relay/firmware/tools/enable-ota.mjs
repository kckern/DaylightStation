#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';

const argv = process.argv.slice(2);
const rotate = argv.includes('--rotate');
const [src, requestedId] = argv.filter((arg) => arg !== '--rotate');
if (!src) {
  console.error('ERROR: pass pressure-mats config.yml and optionally a mat id.');
  process.exit(1);
}

const original = readFileSync(src, 'utf8');
const doc = parseDocument(original, { keepSourceTokens: true });
if (doc.errors.length) {
  console.error(`ERROR: cannot parse ${src}: ${doc.errors[0].message}`);
  process.exit(1);
}

const mats = doc.get('pressure_mats')?.toJSON?.() || {};
const matId = requestedId || Object.keys(mats)[0];
if (!matId || !Object.hasOwn(mats, matId)) {
  console.error(`ERROR: pressure mat "${matId || ''}" not found. Available: ${Object.keys(mats).join(', ') || '(none)'}`);
  process.exit(1);
}

const passwordPath = ['pressure_mats', matId, 'ota', 'password'];
const existingPassword = String(doc.getIn(passwordPath) || '');
doc.setIn(['pressure_mats', matId, 'ota', 'enabled'], true);
if (rotate || !existingPassword) {
  // URL-safe characters survive PlatformIO/espota argv handling without quoting.
  doc.setIn(passwordPath, randomBytes(24).toString('base64url'));
}

const mode = statSync(src).mode & 0o777;
const temporary = path.join(path.dirname(src), `.${path.basename(src)}.${process.pid}.tmp`);
writeFileSync(temporary, String(doc), { mode: 0o600, flag: 'wx' });
renameSync(temporary, src);
chmodSync(src, Math.min(mode, 0o600));

const credentialAction = rotate ? 'rotated' : existingPassword ? 'existing' : 'new';
console.log(`[enable-ota] ${matId}: enabled with ${credentialAction} private credential`);
console.log('[enable-ota] credential intentionally not printed');
