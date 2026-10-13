// @vitest-environment node
import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../../../cli/korean-course.cli.mjs', import.meta.url));

it('build without --source-dir looks in the data volume and says so when the lessons are not there', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'korean-src-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'korean-src-out-'));
  try {
    const run = spawnSync(process.execPath, [cli, 'build', '--base', base, '--out', out], { encoding: 'utf8', timeout: 30000 });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('Lesson source directory not found');
    expect(run.stderr).toContain(path.join(base, 'data/content/school/learning-catalog/documents/language/korean-3-2/full-course/lessons'));
    expect(run.stderr).toContain('--source-dir');
  } finally { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); }
});
