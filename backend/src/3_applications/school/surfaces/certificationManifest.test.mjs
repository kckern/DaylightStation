// backend/src/3_applications/school/surfaces/certificationManifest.test.mjs
import { describe, expect, it } from 'vitest';
import { writeManifest, readManifest } from './certificationManifest.mjs';

const PATH = '/fake/certification-manifest.json';

/** Minimal in-memory fs stub: writeFileSync/readFileSync/existsSync. */
function makeFsStub(initialFiles = {}) {
  const files = { ...initialFiles };
  return {
    files,
    existsSync: (path) => Object.prototype.hasOwnProperty.call(files, path),
    writeFileSync: (path, contents) => { files[path] = contents; },
    readFileSync: (path) => {
      if (!Object.prototype.hasOwnProperty.call(files, path)) {
        const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
        err.code = 'ENOENT';
        throw err;
      }
      return files[path];
    },
  };
}

const lessonRow = {
  address: 'main/sci/wc/wm/evap',
  surfaceId: 'screen-office',
  verdict: 'full',
  reasons: [],
  warnings: [],
  resource: { estimatedBytes: 42 },
  moduleVerdicts: [{ moduleId: 'm1', verdict: 'render', reasons: [], warnings: [] }],
  contentDigest: 'abc123',
  profileDigest: 'def456',
};

const codecLessonRow = {
  address: 'main/sci/wc/wm/evap',
  surfaceId: 'fake-calc-codec-baseline',
  baseline: 'codec',
  verdict: 'full',
  reasons: [],
  warnings: [],
  moduleVerdicts: [{ moduleId: 'm1', verdict: 'render', reasons: [], warnings: [] }],
  contentDigest: 'abc123',
  profileDigest: 'ghi789',
};

const bankRow = {
  address: 'bank:general-choice',
  surfaceId: 'screen-office',
  verdict: 'incompatible',
  reasons: ['standalone banks are not deliverable to calculators in v1'],
  warnings: [],
  moduleVerdicts: null,
  contentDigest: 'jkl012',
  profileDigest: 'def456',
};

describe('certificationManifest', () => {
  it('round-trips rows through an injected fs stub', () => {
    const fs = makeFsStub();
    writeManifest({ rows: [lessonRow, codecLessonRow, bankRow], path: PATH, fs });

    const manifest = readManifest({ path: PATH, fs });
    expect(manifest.schema).toBe('school.certification-manifest/v1');
    expect(Object.keys(manifest.entries).sort()).toEqual([
      'abc123:def456',
      'abc123:ghi789',
      'jkl012:def456',
    ]);
  });

  it('produces byte-identical output regardless of input row order', () => {
    const fsA = makeFsStub();
    const fsB = makeFsStub();

    writeManifest({ rows: [lessonRow, codecLessonRow, bankRow], path: PATH, fs: fsA });
    writeManifest({ rows: [bankRow, codecLessonRow, lessonRow], path: PATH, fs: fsB });

    expect(fsA.files[PATH]).toBe(fsB.files[PATH]);
  });

  it('ends the written file with a trailing newline', () => {
    const fs = makeFsStub();
    writeManifest({ rows: [lessonRow], path: PATH, fs });
    expect(fs.files[PATH].endsWith('\n')).toBe(true);
  });

  it('preserves the baseline field on a codec-baseline row', () => {
    const fs = makeFsStub();
    writeManifest({ rows: [codecLessonRow], path: PATH, fs });
    const manifest = readManifest({ path: PATH, fs });
    const entry = manifest.entries['abc123:ghi789'];
    expect(entry.baseline).toBe('codec');
    expect(entry.moduleVerdicts).toBeUndefined();
    expect(entry.contentDigest).toBeUndefined();
    expect(entry.profileDigest).toBeUndefined();
  });

  it('preserves a bank row (address, null-ish moduleVerdicts stripped) intact', () => {
    const fs = makeFsStub();
    writeManifest({ rows: [bankRow], path: PATH, fs });
    const manifest = readManifest({ path: PATH, fs });
    const entry = manifest.entries['jkl012:def456'];
    expect(entry.address).toBe('bank:general-choice');
    expect(entry.verdict).toBe('incompatible');
    expect(entry.reasons).toEqual(['standalone banks are not deliverable to calculators in v1']);
    expect(entry.moduleVerdicts).toBeUndefined();
  });

  it('preserves the resource field on a row that has one', () => {
    const fs = makeFsStub();
    writeManifest({ rows: [lessonRow], path: PATH, fs });
    const manifest = readManifest({ path: PATH, fs });
    expect(manifest.entries['abc123:def456'].resource).toEqual({ estimatedBytes: 42 });
  });

  it('returns empty entries when the file does not exist, without throwing', () => {
    const fs = makeFsStub();
    expect(() => readManifest({ path: PATH, fs })).not.toThrow();
    const manifest = readManifest({ path: PATH, fs });
    expect(manifest).toEqual({ schema: 'school.certification-manifest/v1', entries: {} });
  });
});
