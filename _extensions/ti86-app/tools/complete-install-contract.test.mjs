import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditCompleteReadback } from './audit-complete-readback.mjs';
import { parseTi86StringFile } from './inspect-ti86-string.mjs';
import { decodeSchoolCalcLocalState } from './lib/schoolcalc-local-state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

describe('complete TI86A installation boundary', () => {
  it('ships retryable individual programs, both reset slots, and exact auditable content', () => {
    const output = execFileSync(process.execPath, [path.join(HERE, 'build-complete-install.mjs')], {
      cwd: ROOT, encoding: 'utf8',
    });
    const match = output.match(/complete audited install ([a-f0-9]{12}): (.+)\n/);
    expect(match).not.toBeNull();
    const [, releaseId, bundle] = match;
    const manifest = JSON.parse(readFileSync(path.join(bundle, 'complete-install.json'), 'utf8'));
    expect(manifest.releaseId).toBe(releaseId);
    expect(manifest.transfer.filter(({ kind }) => kind === 'program')).toHaveLength(10);
    expect(manifest.transfer).toContainEqual(expect.objectContaining({ fileName: 'DSPROG.86s', magic: 'SCG1' }));
    expect(manifest.transfer.some(({ fileName }) => fileName.endsWith('.86g'))).toBe(false);
    const packs = manifest.transfer.filter(({ kind }) => kind === 'content-pack');
    expect(packs).toHaveLength(manifest.courses.length);
    expect(manifest.transfer.slice(-(packs.length + 3)).map(({ fileName }) => fileName)).toEqual([
      ...packs.map(({ fileName }) => fileName),
      'DSLOCAL0.86s', 'DSLOCAL1.86s', 'ASCHL.86p',
    ]);
    const generations = ['DSLOCAL0.86s', 'DSLOCAL1.86s'].map((fileName) => {
      const parsed = parseTi86StringFile(readFileSync(path.join(bundle, fileName)));
      return decodeSchoolCalcLocalState(parsed.variableData.subarray(2)).generation;
    });
    expect(generations).toEqual([1, 2]);
    expect(auditCompleteReadback(bundle, bundle).verified).toHaveLength(19 + packs.length);
  });
});
