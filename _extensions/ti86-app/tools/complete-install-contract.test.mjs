import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditCompleteReadback } from './audit-complete-readback.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

describe('SchoolCalc Adaptive Study v1 installation boundary', () => {
  it('ships only the active code-first runtime and installs the launcher last', () => {
    const output = execFileSync(process.execPath, [path.join(HERE, 'build-complete-install.mjs')], {
      cwd: ROOT, encoding: 'utf8',
    });
    const match = output.match(/adaptive v1 audited install ([a-f0-9]{12}): (.+)\n/);
    expect(match).not.toBeNull();
    const [, releaseId, bundle] = match;
    const manifest = JSON.parse(readFileSync(path.join(bundle, 'complete-install.json'), 'utf8'));
    expect(manifest).toMatchObject({
      releaseId,
      product: 'schoolcalc-adaptive-study/v1',
      programs: ['SCHLCALC', 'SCLEARN', 'SCQUEUE', 'SCQR', 'SCSYNC'],
      launcher: 'ASCHL',
    });
    expect(manifest.transfer.map(({ fileName }) => fileName)).toEqual([
      'SCHLCALC.86p', 'SCLEARN.86p', 'SCQUEUE.86p', 'SCQR.86p', 'SCSYNC.86p',
      'DSID.86s', 'ASCHL.86p',
    ]);
    for (const inactive of ['SCCAT', 'SCPROF', 'SCTUTOR', 'SCNATIVE', 'SCREQ', 'DSCODE']) {
      expect(manifest.transfer.some(({ fileName }) => fileName.startsWith(inactive))).toBe(false);
    }
    expect(auditCompleteReadback(bundle, bundle).verified).toHaveLength(7);
  });
});
