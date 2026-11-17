import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkBackfillFiles } from './WorkBackfillFiles.mjs';
it('keeps private manifests/results outside data and refuses path/symlink escapes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-job-files-'));
  try {
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir);
    expect(() => new WorkBackfillFiles({
      dataDir,
      outputDir: path.join(dataDir, 'bad')
    })).toThrow(/outside/i);
    expect(fs.existsSync(path.join(dataDir, 'bad'))).toBe(false);
    const files = new WorkBackfillFiles({
      dataDir,
      outputDir: path.join(tmp, 'private', 'job')
    });
    const filename = files.writeJson({
      name: 'job-1.manifest.json',
      value: {
        username: 'sample'
      }
    });
    expect(files.readJson(filename)).toEqual({
      username: 'sample'
    });
    expect(fs.statSync(filename).mode & 0o777).toBe(0o600);
    expect(() => files.writeJson({
      name: '../escape.json',
      value: {}
    })).toThrow(/path/i);
    const outside = path.join(tmp, 'outside.json');
    fs.writeFileSync(outside, '{}');
    const alias = path.join(path.dirname(filename), 'alias.json');
    fs.symlinkSync(outside, alias);
    expect(() => files.readJson(alias)).toThrow(/path/i);
    expect(fs.readdirSync(dataDir)).toEqual([]);
  } finally {
    fs.rmSync(tmp, {
      recursive: true,
      force: true
    });
  }
});
