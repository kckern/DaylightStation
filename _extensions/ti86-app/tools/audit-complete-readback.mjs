#!/usr/bin/env node
/** Prove that calculator-received variables match one complete install. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseTi86StringFile } from './inspect-ti86-string.mjs';
import { verifyTi86BasicProgram, verifyTi86Program } from './lib/ti86-program.mjs';

export function auditCompleteReadback(bundleDirectory, readbackDirectory) {
  const manifest = JSON.parse(readFileSync(path.join(bundleDirectory, 'complete-install.json'), 'utf8'));
  if (manifest.schema !== 'school.calc.ti86-complete-install/v1') {
    throw new Error('complete install manifest schema is invalid');
  }
  const verified = [];
  for (const entry of manifest.transfer) {
    const expectedFile = readFileSync(path.join(bundleDirectory, entry.fileName));
    if (sha256(expectedFile) !== entry.sha256) {
      throw new Error(`${entry.fileName} no longer matches its release manifest`);
    }
    const receivedFile = readFileSync(path.join(readbackDirectory, entry.fileName));
    if (entry.kind === 'program') {
      const expected = verifyTi86Program(expectedFile);
      const received = verifyTi86Program(receivedFile, { expectedName: expected.name });
      if (!received.code.equals(expected.code)) throw new Error(`${entry.fileName} program bytes differ`);
    } else if (entry.kind === 'basic-launcher') {
      const expected = verifyTi86BasicProgram(expectedFile);
      const received = verifyTi86BasicProgram(receivedFile, { expectedName: expected.name });
      if (!received.tokens.equals(expected.tokens)) throw new Error(`${entry.fileName} launcher bytes differ`);
    } else {
      const expected = parseTi86StringFile(expectedFile);
      const received = parseTi86StringFile(receivedFile);
      if (received.name !== expected.name
          || !received.variableData.equals(expected.variableData)) {
        throw new Error(`${entry.fileName} String bytes differ`);
      }
    }
    verified.push(entry.fileName);
  }
  return Object.freeze({ releaseId: manifest.releaseId, verified: Object.freeze(verified) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [bundleDirectory, readbackDirectory] = process.argv.slice(2);
  if (!bundleDirectory || !readbackDirectory) {
    process.stderr.write('usage: node audit-complete-readback.mjs BUNDLE_DIR READBACK_DIR\n');
    process.exit(64);
  }
  const result = auditCompleteReadback(path.resolve(bundleDirectory), path.resolve(readbackDirectory));
  process.stdout.write(`[ti86] read-back verified ${result.verified.length} variables for ${result.releaseId}\n`);
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
