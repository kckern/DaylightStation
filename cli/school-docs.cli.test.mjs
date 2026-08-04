import {
  mkdtemp, mkdir, rm, writeFile, readFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dump } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';
import {
  main,
  resolveSchoolDocsContentPaths,
  runSchoolDocs,
} from './school-docs.cli.mjs';

/** A single question: short stem + fixed-size answer space (no growth ambiguity). */
const question = (n) => ({
  type: 'question',
  itemId: `q${n}`,
  number: n,
  blocks: [
    { type: 'rich_text', md: `Problem ${n}. Solve and show your work.` },
    { type: 'answer_space', minPt: 30, maxPt: 30 },
  ],
});

const v2WorksheetDoc = (over = {}) => ({
  schema: 'school.document/v2',
  id: 'v2-fixture',
  seed: 7,
  target: ['letter'],
  archetype: 'worksheet',
  blocks: [question(1), question(2)],
  ...over,
});

// 12 fixed-size questions overflow BOTH densities (empirically established by
// RenderPrintDocument.test.mjs against the real measurement pipeline).
const oversetDoc = () => ({
  schema: 'school.document/v2',
  id: 'overset-fixture',
  seed: 7,
  target: ['letter'],
  archetype: 'quiz',
  fit: { policy: 'one-page', typeScale: 'standard' },
  blocks: Array.from({ length: 12 }, (_, i) => question(i + 1)),
});

const v1OkDoc = () => ({
  id: 'v1-ok',
  seed: 1,
  target: ['letter'],
  blocks: [{ type: 'rich_text', md: 'Hello world.' }],
});

const invalidDoc = () => ({
  id: 'v1-bad',
  seed: 1,
  target: ['letter'],
  blocks: [{ type: 'not_a_real_block_type' }],
});

async function withTmpDir(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'school-docs-cli-'));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('school-docs CLI', () => {
  it('resolves default and explicit content-root paths without a household graph', () => {
    expect(resolveSchoolDocsContentPaths({
      flags: { 'content-root': 'published/print-documents' },
      env: { DAYLIGHT_BASE_PATH: '/srv/daylight' },
    })).toEqual({
      dataDir: '/srv/daylight/data',
      contentRoot: '/srv/daylight/data/published/print-documents',
    });
  });

  it('defaults content-root to content/school/print-documents', () => {
    expect(resolveSchoolDocsContentPaths({ env: { DAYLIGHT_BASE_PATH: '/srv/daylight' } }).contentRoot)
      .toBe('/srv/daylight/data/content/school/print-documents');
  });

  it('rejects unknown or valueless options as usage errors before touching the filesystem', async () => {
    const io = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
    await expect(main(['validate', '--wat', 'x'], io)).resolves.toBe(2);
    await expect(main(['render', 'x.yml', '--data-dir'], io)).resolves.toBe(2);
    expect(io.stderr.write).toHaveBeenCalledWith('ERROR: Unknown option: --wat\n');
    expect(io.stderr.write).toHaveBeenCalledWith('ERROR: --data-dir needs a value\n');
  });

  describe('validate', () => {
    it('exits 0 for a structurally valid document (v1 and v2)', async () => withTmpDir(async (root) => {
      const okFile = path.join(root, 'ok.yml');
      await writeFile(okFile, dump(v1OkDoc()));
      const { exitCode, report } = await runSchoolDocs(['validate', okFile]);
      expect(exitCode).toBe(0);
      expect(report.ok).toBe(true);
      expect(report.errors).toEqual([]);

      const okV2File = path.join(root, 'ok-v2.yml');
      await writeFile(okV2File, dump(v2WorksheetDoc()));
      const v2Result = await runSchoolDocs(['validate', okV2File]);
      expect(v2Result.exitCode).toBe(0);
      expect(v2Result.report.ok).toBe(true);
    }));

    it('exits 1 with dotted-path errors for an invalid document', async () => withTmpDir(async (root) => {
      const badFile = path.join(root, 'bad.yml');
      await writeFile(badFile, dump(invalidDoc()));
      const { exitCode, report } = await runSchoolDocs(['validate', badFile]);
      expect(exitCode).toBe(1);
      expect(report.ok).toBe(false);
      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.errors[0]).toMatch(/^blocks\[0\]:/);
    }));

    it('walks a directory of *.yml files, reporting per-file and failing overall on any error', async () => withTmpDir(async (root) => {
      await writeFile(path.join(root, 'a-ok.yml'), dump(v1OkDoc()));
      await writeFile(path.join(root, 'b-bad.yml'), dump(invalidDoc()));
      await writeFile(path.join(root, 'ignored.txt'), 'not yaml, not walked');

      const { exitCode, report } = await runSchoolDocs(['validate', root]);
      expect(exitCode).toBe(1);
      expect(report.ok).toBe(false);
      expect(report.files.map((f) => f.file)).toEqual(['a-ok.yml', 'b-bad.yml']);
      expect(report.files.find((f) => f.file === 'a-ok.yml').ok).toBe(true);
      expect(report.files.find((f) => f.file === 'b-bad.yml').ok).toBe(false);
      expect(report.errors.some((e) => e.startsWith('b-bad.yml: blocks[0]:'))).toBe(true);
    }));

    it('resolves a bare (non-absolute) file argument relative to the content root', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'data/content/school/print-documents');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'ok.yml'), dump(v1OkDoc()));

      const { exitCode, report } = await runSchoolDocs(
        ['validate', 'ok.yml'],
        { env: { DAYLIGHT_BASE_PATH: root } },
      );
      expect(exitCode).toBe(0);
      expect(report.ok).toBe(true);
    }));
  });

  describe('render', () => {
    it('writes a PDF >= 1KB, byte-stable across two runs with a fixed --creation-date', async () => withTmpDir(async (root) => {
      const docFile = path.join(root, 'worksheet.yml');
      await writeFile(docFile, dump(v2WorksheetDoc()));
      const outA = path.join(root, 'a.pdf');
      const outB = path.join(root, 'b.pdf');

      const runOne = await runSchoolDocs([
        'render', docFile, '--out', outA, '--learner-name', 'Alex', '--creation-date', '2026-01-01T00:00:00.000Z',
      ]);
      const runTwo = await runSchoolDocs([
        'render', docFile, '--out', outB, '--learner-name', 'Alex', '--creation-date', '2026-01-01T00:00:00.000Z',
      ]);

      expect(runOne.exitCode).toBe(0);
      expect(runTwo.exitCode).toBe(0);
      expect(runOne.report.pages).toBe(1);
      expect(runOne.report.density).toBe('normal');

      const bytesA = await readFile(outA);
      const bytesB = await readFile(outB);
      expect(bytesA.length).toBeGreaterThanOrEqual(1024);
      expect(bytesA.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(bytesA.equals(bytesB)).toBe(true);
    }));

    it('prints {pages, density} on success', async () => withTmpDir(async (root) => {
      const docFile = path.join(root, 'worksheet.yml');
      await writeFile(docFile, dump(v2WorksheetDoc()));
      const io = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
      const code = await main(['render', docFile, '--out', path.join(root, 'out.pdf')], io);
      expect(code).toBe(0);
      const printed = io.stdout.write.mock.calls.map((call) => call[0]).join('');
      expect(printed).toContain('"pages":1');
      expect(printed).toContain('"density":"normal"');
    }));

    it('exits 1 and names oversetPt when a document overflows fit.policy one-page at every density', async () => withTmpDir(async (root) => {
      const docFile = path.join(root, 'overset.yml');
      await writeFile(docFile, dump(oversetDoc()));
      const { exitCode, report } = await runSchoolDocs([
        'render', docFile, '--out', path.join(root, 'overset.pdf'),
      ]);
      expect(exitCode).toBe(1);
      expect(report.ok).toBe(false);
      expect(report.errors[0]).toMatch(/oversetPt/);
      expect(report.errors[0]).toMatch(/\d/);
    }));

    it('exits 1 with the validation errors when the document itself is invalid', async () => withTmpDir(async (root) => {
      const docFile = path.join(root, 'bad.yml');
      await writeFile(docFile, dump(invalidDoc()));
      const { exitCode, report } = await runSchoolDocs([
        'render', docFile, '--out', path.join(root, 'bad.pdf'),
      ]);
      expect(exitCode).toBe(1);
      expect(report.ok).toBe(false);
      expect(report.errors[0]).toMatch(/blocks\[0\]/);
    }));

    it('exits 2 when --out is missing', async () => withTmpDir(async (root) => {
      const docFile = path.join(root, 'worksheet.yml');
      await writeFile(docFile, dump(v2WorksheetDoc()));
      const { exitCode, report } = await runSchoolDocs(['render', docFile]);
      expect(exitCode).toBe(2);
      expect(report.errors[0]).toMatch(/--out/);
    }));

    it('changes the rendered bytes when --learner-name is supplied', async () => withTmpDir(async (root) => {
      const docFile = path.join(root, 'worksheet.yml');
      await writeFile(docFile, dump(v2WorksheetDoc()));
      const outBlank = path.join(root, 'blank.pdf');
      const outNamed = path.join(root, 'named.pdf');
      await runSchoolDocs(['render', docFile, '--out', outBlank]);
      await runSchoolDocs(['render', docFile, '--out', outNamed, '--learner-name', 'Riley']);
      const blank = await readFile(outBlank);
      const named = await readFile(outNamed);
      expect(blank.equals(named)).toBe(false);
    }));

    it.each(['normal', 'compact'])('--density %s is accepted, exits 0, and warns that it has no effect', async (density) => withTmpDir(async (root) => {
      const docFile = path.join(root, 'worksheet.yml');
      await writeFile(docFile, dump(v2WorksheetDoc()));
      const { exitCode, report } = await runSchoolDocs([
        'render', docFile, '--out', path.join(root, 'out.pdf'), '--density', density,
      ]);
      expect(exitCode).toBe(0);
      expect(report.ok).toBe(true);
      expect(report.warnings).toContain(
        '--density is accepted but has no effect in Phase A; density is chosen automatically by the fit solver',
      );
    }));

    it('--density bogus is rejected as a usage error (exit 2), not silently accepted', async () => withTmpDir(async (root) => {
      const docFile = path.join(root, 'worksheet.yml');
      await writeFile(docFile, dump(v2WorksheetDoc()));
      const { exitCode, report } = await runSchoolDocs([
        'render', docFile, '--out', path.join(root, 'out.pdf'), '--density', 'bogus',
      ]);
      expect(exitCode).toBe(2);
      expect(report.mode).toBe('usage');
      expect(report.errors[0]).toMatch(/--density/);
    }));

    it('--creation-date warns that it has no effect, and does not change byte-identical output', async () => withTmpDir(async (root) => {
      const docFile = path.join(root, 'worksheet.yml');
      await writeFile(docFile, dump(v2WorksheetDoc()));
      const outPlain = path.join(root, 'plain.pdf');
      const outDated = path.join(root, 'dated.pdf');

      const plainResult = await runSchoolDocs(['render', docFile, '--out', outPlain]);
      const datedResult = await runSchoolDocs([
        'render', docFile, '--out', outDated, '--creation-date', '2026-01-01T00:00:00.000Z',
      ]);

      expect(plainResult.exitCode).toBe(0);
      expect(datedResult.exitCode).toBe(0);
      expect(datedResult.report.warnings).toContain('renders are always deterministic; --creation-date has no effect');
      expect(plainResult.report.warnings).not.toContain('renders are always deterministic; --creation-date has no effect');

      const plainBytes = await readFile(outPlain);
      const datedBytes = await readFile(outDated);
      expect(plainBytes.equals(datedBytes)).toBe(true);
    }));

    it('warns that --type-scale has no effect on a v1 (legacy) document', async () => withTmpDir(async (root) => {
      const docFile = path.join(root, 'v1.yml');
      await writeFile(docFile, dump(v1OkDoc()));
      const { exitCode, report } = await runSchoolDocs([
        'render', docFile, '--out', path.join(root, 'out.pdf'), '--type-scale', 'young',
      ]);
      expect(exitCode).toBe(0);
      expect(report.warnings).toContain(
        '--type-scale is accepted but has no effect on this v1 (legacy) document; only v2 documents have a fit.typeScale',
      );
    }));

    it('prints warnings in the CLI text output', async () => withTmpDir(async (root) => {
      const docFile = path.join(root, 'worksheet.yml');
      await writeFile(docFile, dump(v2WorksheetDoc()));
      const io = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
      const code = await main(['render', docFile, '--out', path.join(root, 'out.pdf'), '--density', 'compact'], io);
      expect(code).toBe(0);
      const printed = io.stdout.write.mock.calls.map((call) => call[0]).join('');
      expect(printed).toContain('Warnings');
      expect(printed).toContain('--density is accepted but has no effect');
    }));
  });
});
