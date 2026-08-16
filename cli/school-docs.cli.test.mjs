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
import { pdfText } from '../tests/_lib/school/pdfText.mjs';

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

/** A `school.document-source/v1` fixture with one answer-bearing inline question — mints a derived bank on publish. */
const sourceQuizDoc = (over = {}) => ({
  schema: 'school.document-source/v1',
  id: 'teacher-cli-fixture',
  seed: 42,
  target: ['letter'],
  archetype: 'quiz',
  title: 'CLI Teacher Fixture',
  blocks: [{
    type: 'question',
    itemId: 'q1',
    number: 1,
    blocks: [
      { type: 'rich_text', md: 'Pick a color.' },
      { type: 'omr_response', itemId: 'q1', choices: 2 },
    ],
    choices: ['Red', 'Blue'],
    answer: 'Blue',
  }],
  ...over,
});

/** A purely presentational source — publishes clean but mints no bank. */
const noBankSourceDoc = () => ({
  schema: 'school.document-source/v1',
  id: 'no-bank-fixture',
  seed: 5,
  target: ['letter'],
  archetype: 'infopage',
  blocks: [{ type: 'rich_text', md: 'Some teaching prose with no questions.' }],
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

    // F5 (review finding): a bank-select question's bank must resolve
    // relative to `--data-dir`, not this process's own `$DAYLIGHT_BASE_PATH`
    // — before the fix, `RenderPrintDocument`'s constructor default silently
    // re-resolved `$DAYLIGHT_BASE_PATH` itself, ignoring whatever `--data-dir`
    // the CLI had already computed.
    it('resolves a bank-select question\'s bank from --data-dir, not $DAYLIGHT_BASE_PATH', async () => withTmpDir(async (root) => {
      const customDataDir = path.join(root, 'custom-data');
      const banksDir = path.join(customDataDir, 'content/school/catalog/question-banks');
      await mkdir(banksDir, { recursive: true });
      await writeFile(path.join(banksDir, 'planets.yml'), dump({
        id: 'custom-root-bank',
        title: 'Custom Root Bank',
        items: [{
          id: 'planet1', type: 'multiple_choice', prompt: 'Which planet is closest to the sun?', choices: ['Mercury', 'Venus'], answer: 'Mercury',
        }],
      }));

      const contentRoot = path.join(customDataDir, 'content/school/print-documents');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'doc.yml'), dump({
        schema: 'school.document/v2',
        id: 'bank-select-datadir-fixture',
        seed: 11,
        target: ['letter'],
        archetype: 'worksheet',
        blocks: [{
          type: 'question', bankId: 'custom-root-bank', select: 1, key: 'sel1',
        }],
      }));

      // A DIFFERENT $DAYLIGHT_BASE_PATH with no such bank at all — proves
      // resolution came from --data-dir, never a silent env fallback.
      const bogusEnv = { env: { DAYLIGHT_BASE_PATH: path.join(root, 'unrelated-env-root') } };
      const outPath = path.join(root, 'out.pdf');
      const { exitCode, report } = await runSchoolDocs(
        ['render', 'doc.yml', '--out', outPath, '--data-dir', customDataDir],
        bogusEnv,
      );

      expect(exitCode).toBe(0);
      expect(report.ok).toBe(true);
      const text = pdfText(await readFile(outPath));
      expect(text).toContain('Which planet is closest to the sun?');
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

  describe('publish', () => {
    it('publishes a source file: writes published + derived-bank YAML under the content root, prints id/rev/bankId', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));

      const { exitCode, report } = await runSchoolDocs(['publish', 'quiz.yml', '--content-root', contentRoot]);
      expect(exitCode).toBe(0);
      expect(report.ok).toBe(true);
      expect(report.id).toBe('teacher-cli-fixture');
      expect(report.rev).toMatch(/^[0-9a-f]{9}$/);
      expect(report.bankId).toBe(`derived/teacher-cli-fixture@${report.rev}`);
      expect(report.warnings).toEqual([]);

      const published = await readFile(path.join(contentRoot, 'published', `teacher-cli-fixture@${report.rev}.yml`), 'utf8');
      expect(published).toContain('teacher-cli-fixture');
      expect(published).not.toContain('answer:'); // answer-free (spec §3)

      const bank = await readFile(path.join(contentRoot, 'derived-banks', `teacher-cli-fixture@${report.rev}.yml`), 'utf8');
      expect(bank).toContain('multiple_choice');
      expect(bank).toContain('Blue');
    }));

    it('publishes a purely presentational source with no bank — bankId null and a warning, still exit 0', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'notes.yml'), dump(noBankSourceDoc()));

      const { exitCode, report } = await runSchoolDocs(['publish', 'notes.yml', '--content-root', contentRoot]);
      expect(exitCode).toBe(0);
      expect(report.ok).toBe(true);
      expect(report.bankId).toBeNull();
      expect(report.warnings).toEqual(expect.arrayContaining([
        expect.stringMatching(/no answer-bearing content/i),
      ]));
    }));

    it('exits 1 with the postcondition error message for a structurally invalid source', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      // A v1 (schema-less) document has no `school.document-source/v1` schema
      // at all — fails source-stage validation immediately.
      await writeFile(path.join(contentRoot, 'bad.yml'), dump(invalidDoc()));

      const { exitCode, report } = await runSchoolDocs(['publish', 'bad.yml', '--content-root', contentRoot]);
      expect(exitCode).toBe(1);
      expect(report.ok).toBe(false);
      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.id).toBeNull();
    }));

    it('re-publishing the identical source is idempotent (no error, same rev)', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));

      const first = await runSchoolDocs(['publish', 'quiz.yml', '--content-root', contentRoot]);
      const second = await runSchoolDocs(['publish', 'quiz.yml', '--content-root', contentRoot]);
      expect(first.exitCode).toBe(0);
      expect(second.exitCode).toBe(0);
      expect(second.report.rev).toBe(first.report.rev);
      expect(second.report.warnings).toEqual(expect.arrayContaining([
        expect.stringMatching(/already published/i),
      ]));
    }));

    it('prints {id, rev, bankId} JSON via the CLI text formatter', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));
      const io = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
      const code = await main(['publish', 'quiz.yml', '--content-root', contentRoot], io);
      expect(code).toBe(0);
      const printed = io.stdout.write.mock.calls.map((call) => call[0]).join('');
      expect(printed).toContain('"id":"teacher-cli-fixture"');
      expect(printed).toMatch(/"rev":"[0-9a-f]{9}"/);
    }));
  });

  describe('render --teacher', () => {
    it('renders a source file with --teacher: exits 0, prints extra pages, no warning (an answerable item exists)', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));

      const plain = await runSchoolDocs([
        'render', 'quiz.yml', '--out', path.join(root, 'plain.pdf'), '--content-root', contentRoot,
      ]);
      const teacher = await runSchoolDocs([
        'render', 'quiz.yml', '--out', path.join(root, 'teacher.pdf'), '--content-root', contentRoot, '--teacher',
      ]);
      expect(plain.exitCode).toBe(0);
      expect(teacher.exitCode).toBe(0);
      expect(teacher.report.pages).toBeGreaterThan(plain.report.pages);
      expect(teacher.report.warnings).not.toEqual(expect.arrayContaining([
        expect.stringMatching(/no answerable items/i),
      ]));
    }));

    it('--teacher works on a PUBLISHED file, resolving its derived bank via the repository', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));

      const published = await runSchoolDocs(['publish', 'quiz.yml', '--content-root', contentRoot]);
      expect(published.exitCode).toBe(0);
      const publishedFile = path.join(contentRoot, 'published', `teacher-cli-fixture@${published.report.rev}.yml`);

      const teacher = await runSchoolDocs([
        'render', publishedFile, '--out', path.join(root, 'teacher.pdf'), '--content-root', contentRoot, '--teacher',
      ]);
      expect(teacher.exitCode).toBe(0);
      expect(teacher.report.ok).toBe(true);
      expect(teacher.report.pages).toBeGreaterThan(1);
    }));

    it('warns when the document has zero answerable items', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'worksheet.yml'), dump(v2WorksheetDoc()));

      const { exitCode, report } = await runSchoolDocs([
        'render', 'worksheet.yml', '--out', path.join(root, 'out.pdf'), '--content-root', contentRoot, '--teacher',
      ]);
      expect(exitCode).toBe(0);
      expect(report.warnings).toEqual(expect.arrayContaining([
        expect.stringMatching(/no answerable items/i),
      ]));
    }));

    it('warns that --teacher has no effect on a v1 (legacy) document', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'v1.yml'), dump(v1OkDoc()));

      const { exitCode, report } = await runSchoolDocs([
        'render', 'v1.yml', '--out', path.join(root, 'out.pdf'), '--content-root', contentRoot, '--teacher',
      ]);
      expect(exitCode).toBe(0);
      expect(report.warnings).toContain(
        '--teacher is accepted but has no effect on this v1 (legacy) document; only v2 documents have a teacher key',
      );
    }));

    it('--teacher with a value is rejected as a usage error (exit 2), not silently accepted', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));

      const { exitCode, report } = await runSchoolDocs([
        'render', 'quiz.yml', '--out', path.join(root, 'out.pdf'), '--content-root', contentRoot, '--teacher', 'bogus',
      ]);
      expect(exitCode).toBe(2);
      expect(report.mode).toBe('usage');
      expect(report.errors[0]).toMatch(/--teacher/);
    }));
  });

  describe('render --card/--fresh-card/--start-row (Task 7, spec §5.3/§5.4)', () => {
    it.each([
      [['render', 'quiz.yml', '--out', 'out.pdf', '--card'], /--card/],
      [['render', 'quiz.yml', '--out', 'out.pdf', '--fresh-card', 'bogus'], /--fresh-card/],
      [['render', 'quiz.yml', '--out', 'out.pdf', '--card', '1234567', '--fresh-card'], /mutually exclusive/],
      [['render', 'quiz.yml', '--out', 'out.pdf', '--start-row', '5'], /--start-row/],
      [['render', 'quiz.yml', '--out', 'out.pdf', '--fresh-card', '--start-row', 'nope'], /--start-row/],
      [['render', 'quiz.yml', '--out', 'out.pdf', '--fresh-card', '--start-row', '0'], /--start-row/],
    ])('rejects %j as a usage error (exit 2)', async (args, pattern) => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));
      const { exitCode, report } = await runSchoolDocs([...args, '--content-root', contentRoot]);
      expect(exitCode).toBe(2);
      expect(report.mode).toBe('usage');
      expect(report.errors[0]).toMatch(pattern);
    }));

    it('--fresh-card mints a card allocation, writes it under <content-root>/allocations/, and reports it', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));
      const published = await runSchoolDocs(['publish', 'quiz.yml', '--content-root', contentRoot]);
      expect(published.exitCode).toBe(0);
      const publishedFile = path.join(contentRoot, 'published', `teacher-cli-fixture@${published.report.rev}.yml`);

      const { exitCode, report } = await runSchoolDocs([
        'render', publishedFile, '--out', path.join(root, 'card.pdf'), '--content-root', contentRoot, '--fresh-card',
      ]);
      expect(exitCode).toBe(0);
      expect(report.ok).toBe(true);
      expect(report.allocation).toMatchObject({
        status: 'live',
        rowRange: { start: 1, end: 1 },
      });
      expect(report.allocation.cardId).toMatch(/^\d{7}$/);
      expect(report.allocation.recordId).toMatch(new RegExp(`^teacher-cli-fixture@${published.report.rev}:v0:1-1$`));

      const allocationFile = path.join(contentRoot, 'allocations', `${report.allocation.cardId}.yml`);
      const raw = await readFile(allocationFile, 'utf8');
      expect(raw).toContain('teacher-cli-fixture');
      expect(raw).toContain('live');
    }));

    it('prints {pages, density, allocation} JSON via the CLI text formatter for a card-attached render', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));
      const published = await runSchoolDocs(['publish', 'quiz.yml', '--content-root', contentRoot]);
      const publishedFile = path.join(contentRoot, 'published', `teacher-cli-fixture@${published.report.rev}.yml`);

      const io = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
      const code = await main([
        'render', publishedFile, '--out', path.join(root, 'out.pdf'), '--content-root', contentRoot, '--fresh-card',
      ], io);
      expect(code).toBe(0);
      const printed = io.stdout.write.mock.calls.map((call) => call[0]).join('');
      expect(printed).toContain('"allocation"');
      expect(printed).toContain('"status":"live"');
    }));

    it('a plain render (no card flags) never touches the allocations directory and reports no allocation', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));
      const published = await runSchoolDocs(['publish', 'quiz.yml', '--content-root', contentRoot]);
      const publishedFile = path.join(contentRoot, 'published', `teacher-cli-fixture@${published.report.rev}.yml`);

      const { exitCode, report } = await runSchoolDocs([
        'render', publishedFile, '--out', path.join(root, 'out.pdf'), '--content-root', contentRoot,
      ]);
      expect(exitCode).toBe(0);
      expect(report.allocation).toBeNull();
      await expect(readFile(path.join(contentRoot, 'allocations'), 'utf8')).rejects.toThrow();
    }));

    it('--card <existing> continues on the SAME physical card at a new --start-row, superseding the prior record', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));
      const published = await runSchoolDocs(['publish', 'quiz.yml', '--content-root', contentRoot]);
      const publishedFile = path.join(contentRoot, 'published', `teacher-cli-fixture@${published.report.rev}.yml`);

      const first = await runSchoolDocs([
        'render', publishedFile, '--out', path.join(root, 'a.pdf'), '--content-root', contentRoot, '--fresh-card',
      ]);
      const cardId = first.report.allocation.cardId;

      const second = await runSchoolDocs([
        'render', publishedFile, '--out', path.join(root, 'b.pdf'), '--content-root', contentRoot,
        '--card', cardId, '--start-row', '2',
      ]);
      expect(second.exitCode).toBe(0);
      expect(second.report.allocation).toMatchObject({
        cardId, status: 'live', rowRange: { start: 2, end: 2 },
      });
      expect(second.report.allocation.recordId).not.toBe(first.report.allocation.recordId);

      const raw = await readFile(path.join(contentRoot, 'allocations', `${cardId}.yml`), 'utf8');
      expect(raw).toContain('superseded');
    }));

    it('a card render of a SOURCE file whose published artifact exists pins the PUBLISHED rev and renders the published content, never the drifted on-disk source (re-review wave 2, F2: phantom-rev trap)', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));
      const published = await runSchoolDocs(['publish', 'quiz.yml', '--content-root', contentRoot]);
      expect(published.exitCode).toBe(0);

      // Drift: the source is edited AFTER publish (a real authoring workflow
      // — rewording a prompt) without a re-publish. If `render --card` fell
      // back to re-deriving a rev off THIS content (the bug), it would mint
      // a rev the allocation record pins that `getPublished` can never
      // serve later — the physical card would print fine but never grade.
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc({
        blocks: [{
          type: 'question',
          itemId: 'q1',
          number: 1,
          blocks: [
            { type: 'rich_text', md: 'Pick a SHAPE (drifted).' },
            { type: 'omr_response', itemId: 'q1', choices: 2 },
          ],
          choices: ['Red', 'Blue'],
          answer: 'Blue',
        }],
      })));

      const outPath = path.join(root, 'card.pdf');
      const { exitCode, report } = await runSchoolDocs([
        'render', 'quiz.yml', '--out', outPath, '--content-root', contentRoot, '--fresh-card',
      ]);
      expect(exitCode).toBe(0);
      expect(report.ok).toBe(true);
      // The allocation record's rev (encoded in recordId) is the ORIGINAL
      // published rev — never a freshly re-derived one off the drifted file.
      expect(report.allocation.recordId).toMatch(new RegExp(`^teacher-cli-fixture@${published.report.rev}:`));

      const text = pdfText(await readFile(outPath));
      expect(text).toContain('Pick a color.');
      expect(text).not.toContain('drifted');
    }));

    it('a card render of a source with NO published artifact fails with an instructive error, never silently pinning an unpublishable rev', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));
      // No `publish` call — quiz.yml has never been published under this content root.

      const { exitCode, report } = await runSchoolDocs([
        'render', 'quiz.yml', '--out', path.join(root, 'card.pdf'), '--content-root', contentRoot, '--fresh-card',
      ]);
      expect(exitCode).toBe(1);
      expect(report.ok).toBe(false);
      expect(report.allocation).toBeNull();
      expect(report.errors[0]).toMatch(/publish/i);
      expect(report.errors[0]).toContain('teacher-cli-fixture');

      // Nothing was written — no phantom allocation record on disk.
      await expect(readFile(path.join(contentRoot, 'allocations'), 'utf8')).rejects.toThrow();
    }));
  });

  describe('reprint <instanceId>', () => {
    it('reproduces an exact historical print from a worksheet-instance file alone — no manual flags', async () => withTmpDir(async (root) => {
      const dataDir = path.join(root, 'data');
      const contentRoot = path.join(dataDir, 'content/school/print-documents');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));

      const published = await runSchoolDocs(['publish', 'quiz.yml', '--data-dir', dataDir]);
      expect(published.exitCode).toBe(0);
      const publishedFile = path.join(contentRoot, 'published', `teacher-cli-fixture@${published.report.rev}.yml`);

      // Mint the card the instance will point at, exactly as a real issuance would.
      const minted = await runSchoolDocs([
        'render', publishedFile, '--out', path.join(root, 'first.pdf'), '--data-dir', dataDir,
        '--fresh-card', '--learner-id', 'felix', '--learner-name', 'Felix', '--date', '14 Aug 2026',
      ]);
      expect(minted.exitCode).toBe(0);
      const cardId = minted.report.allocation.cardId;

      const instancesDir = path.join(dataDir, 'household/apps/school/worksheet-instances');
      await mkdir(instancesDir, { recursive: true });
      await writeFile(path.join(instancesDir, 'ws-fixture.yml'), dump({
        id: 'ws-fixture',
        sessionId: 'ses_fixture',
        learnerId: 'felix',
        documentId: 'teacher-cli-fixture',
        documentRevision: published.report.rev,
        issuedAt: '2026-08-14T17:55:20.033Z',
        omr: {
          cardId, recordId: minted.report.allocation.recordId, rowRange: minted.report.allocation.rowRange,
        },
      }));

      const { exitCode, report } = await runSchoolDocs([
        'reprint', 'ws-fixture', '--out', path.join(root, 'reprinted.pdf'), '--data-dir', dataDir,
      ]);

      expect(exitCode).toBe(0);
      expect(report.ok).toBe(true);
      expect(report.allocation).toMatchObject({ cardId, status: 'live' });

      const text = pdfText(await readFile(path.join(root, 'reprinted.pdf')));
      expect(text).toContain('Felix');
      expect(text).toContain('14 Aug 2026');
      expect(text).toContain(cardId);
    }));

    it('reproduces the ORIGINAL print byte-for-byte and leaves the allocation file untouched', async () => withTmpDir(async (root) => {
      const dataDir = path.join(root, 'data');
      const contentRoot = path.join(dataDir, 'content/school/print-documents');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));
      const published = await runSchoolDocs(['publish', 'quiz.yml', '--data-dir', dataDir]);
      const publishedFile = path.join(contentRoot, 'published', `teacher-cli-fixture@${published.report.rev}.yml`);
      const minted = await runSchoolDocs([
        'render', publishedFile, '--out', path.join(root, 'first.pdf'), '--data-dir', dataDir,
        '--fresh-card', '--learner-id', 'felix', '--learner-name', 'Felix', '--date', '14 Aug 2026',
      ]);
      const cardId = minted.report.allocation.cardId;
      const instancesDir = path.join(dataDir, 'household/apps/school/worksheet-instances');
      await mkdir(instancesDir, { recursive: true });
      await writeFile(path.join(instancesDir, 'ws-fixture.yml'), dump({
        id: 'ws-fixture',
        sessionId: 'ses_fixture',
        learnerId: 'felix',
        documentId: 'teacher-cli-fixture',
        documentRevision: published.report.rev,
        issuedAt: '2026-08-14T17:55:20.033Z',
        omr: {
          cardId, recordId: minted.report.allocation.recordId, rowRange: minted.report.allocation.rowRange,
        },
      }));

      const allocationFile = path.join(contentRoot, 'allocations', `${cardId}.yml`);
      const allocationBefore = await readFile(allocationFile, 'utf8');

      await runSchoolDocs(['reprint', 'ws-fixture', '--out', path.join(root, 'a.pdf'), '--data-dir', dataDir]);
      await runSchoolDocs(['reprint', 'ws-fixture', '--out', path.join(root, 'b.pdf'), '--data-dir', dataDir]);

      const [original, a, b] = await Promise.all([
        readFile(path.join(root, 'first.pdf')),
        readFile(path.join(root, 'a.pdf')),
        readFile(path.join(root, 'b.pdf')),
      ]);
      // THE claim this whole command exists to make: a reprint is the ORIGINAL
      // print, not merely two reprints agreeing with each other.
      expect(a.equals(original)).toBe(true);
      expect(b.equals(original)).toBe(true);

      // Byte-identical allocation file is a TOTAL check — it catches an appended
      // record, a supersede (status flip), a refreshed renderedAt, anything. A
      // "still exactly one `status: live`" count does NOT: a supersede leaves
      // exactly one live record while retiring the card already in circulation.
      expect(await readFile(allocationFile, 'utf8')).toBe(allocationBefore);
    }));

    it('reports a FAILURE when the reprint does not reproduce the original allocation', async () => withTmpDir(async (root) => {
      const dataDir = path.join(root, 'data');
      const contentRoot = path.join(dataDir, 'content/school/print-documents');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));
      const published = await runSchoolDocs(['publish', 'quiz.yml', '--data-dir', dataDir]);
      const publishedFile = path.join(contentRoot, 'published', `teacher-cli-fixture@${published.report.rev}.yml`);
      const minted = await runSchoolDocs([
        'render', publishedFile, '--out', path.join(root, 'first.pdf'), '--data-dir', dataDir,
        '--fresh-card', '--learner-id', 'felix', '--learner-name', 'Felix', '--date', '14 Aug 2026',
      ]);
      const cardId = minted.report.allocation.cardId;
      const originalRecordId = minted.report.allocation.recordId;

      const instancesDir = path.join(dataDir, 'household/apps/school/worksheet-instances');
      await mkdir(instancesDir, { recursive: true });
      // Hand-edited instance: the recorded recordId is the original, but the row
      // range it asks the reprint to plan is NOT. `YamlAllocationStore.allocate`
      // then supersedes the original record and appends a new live one — the
      // physical card stops resolving on scan. This used to report ok/exit 0.
      await writeFile(path.join(instancesDir, 'ws-drifted.yml'), dump({
        id: 'ws-drifted',
        sessionId: 'ses_fixture',
        learnerId: 'felix',
        documentId: 'teacher-cli-fixture',
        documentRevision: published.report.rev,
        issuedAt: '2026-08-14T17:55:20.033Z',
        omr: { cardId, recordId: originalRecordId, rowRange: { start: 20, end: 20 } },
      }));

      const outPath = path.join(root, 'drifted.pdf');
      const { exitCode, report } = await runSchoolDocs([
        'reprint', 'ws-drifted', '--out', outPath, '--data-dir', dataDir,
      ]);

      expect(exitCode).toBe(1);
      expect(report.ok).toBe(false);
      expect(report.errors[0]).toContain(originalRecordId); // names the record the operator expected
      expect(report.errors[0]).toMatch(/did NOT reproduce the original allocation/);
      // No sheet is written for an allocation we refuse to vouch for.
      await expect(readFile(outPath)).rejects.toThrow();

      // Detection is POST-HOC: the store write already happened. Asserting it
      // keeps the known limitation honest rather than implying a pre-check.
      const allocationRaw = await readFile(path.join(contentRoot, 'allocations', `${cardId}.yml`), 'utf8');
      expect(allocationRaw).toMatch(/status: superseded/);
    }));

    it('refuses an unsafe instance id instead of traversing out of the instances directory', async () => withTmpDir(async (root) => {
      const dataDir = path.join(root, 'data');
      await mkdir(dataDir, { recursive: true });
      await writeFile(path.join(root, 'secret.yml'), dump({ documentId: 'x', documentRevision: 'y' }));

      const { exitCode, report } = await runSchoolDocs([
        'reprint', '../../../secret', '--out', path.join(root, 'x.pdf'), '--data-dir', dataDir,
      ]);
      expect(exitCode).toBe(1);
      expect(report.ok).toBe(false);
      expect(report.errors[0]).toMatch(/unsafe worksheet instance id/);
    }));

    it('refuses an empty/malformed instance file with a structured error, never an uncaught crash', async () => withTmpDir(async (root) => {
      const dataDir = path.join(root, 'data');
      const instancesDir = path.join(dataDir, 'household/apps/school/worksheet-instances');
      await mkdir(instancesDir, { recursive: true });
      await writeFile(path.join(instancesDir, 'ws-empty.yml'), '');

      const { exitCode, report } = await runSchoolDocs([
        'reprint', 'ws-empty', '--out', path.join(root, 'x.pdf'), '--data-dir', dataDir,
      ]);
      expect(exitCode).toBe(1);
      expect(report.ok).toBe(false);
      expect(report.mode).toBe('reprint'); // a structured report, not a thrown TypeError
      expect(report.errors[0]).toMatch(/ws-empty/);
      expect(report.errors[0]).toMatch(/empty or is not a YAML mapping/);
    }));

    it('refuses an instance with no documentRevision rather than silently reprinting the LATEST revision', async () => withTmpDir(async (root) => {
      const dataDir = path.join(root, 'data');
      const contentRoot = path.join(dataDir, 'content/school/print-documents');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));
      const published = await runSchoolDocs(['publish', 'quiz.yml', '--data-dir', dataDir]);
      expect(published.exitCode).toBe(0);

      const instancesDir = path.join(dataDir, 'household/apps/school/worksheet-instances');
      await mkdir(instancesDir, { recursive: true });
      await writeFile(path.join(instancesDir, 'ws-no-rev.yml'), dump({
        id: 'ws-no-rev',
        learnerId: 'felix',
        documentId: 'teacher-cli-fixture',
        // documentRevision omitted — `getPublished(id, undefined)` would resolve
        // "newest published revision by mtime", i.e. a DIFFERENT sheet.
        issuedAt: '2026-08-14T17:55:20.033Z',
        omr: { cardId: '5922785', recordId: 'x:v0:1-1', rowRange: { start: 1, end: 1 } },
      }));

      const { exitCode, report } = await runSchoolDocs([
        'reprint', 'ws-no-rev', '--out', path.join(root, 'x.pdf'), '--data-dir', dataDir,
      ]);
      expect(exitCode).toBe(1);
      expect(report.ok).toBe(false);
      expect(report.errors[0]).toMatch(/ws-no-rev/);
      expect(report.errors[0]).toMatch(/documentRevision/);
      expect(report.errors[0]).toMatch(/refuses to guess/);
    }));

    it('fails clearly when the instance id does not resolve to a file', async () => withTmpDir(async (root) => {
      const dataDir = path.join(root, 'data');
      await mkdir(dataDir, { recursive: true });
      const { exitCode, report } = await runSchoolDocs(['reprint', 'nope', '--out', path.join(root, 'x.pdf'), '--data-dir', dataDir]);
      expect(exitCode).toBe(1);
      expect(report.errors[0]).toMatch(/nope/);
    }));

    it('fails clearly (not a crash) when the worksheet instance has no card allocation', async () => withTmpDir(async (root) => {
      const dataDir = path.join(root, 'data');
      const contentRoot = path.join(dataDir, 'content/school/print-documents');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));
      const published = await runSchoolDocs(['publish', 'quiz.yml', '--data-dir', dataDir]);
      expect(published.exitCode).toBe(0);

      const instancesDir = path.join(dataDir, 'household/apps/school/worksheet-instances');
      await mkdir(instancesDir, { recursive: true });
      await writeFile(path.join(instancesDir, 'ws-no-card.yml'), dump({
        id: 'ws-no-card',
        sessionId: 'ses_fixture',
        learnerId: 'felix',
        documentId: 'teacher-cli-fixture',
        documentRevision: published.report.rev,
        issuedAt: '2026-08-14T17:55:20.033Z',
        // no `omr` field at all — never attached to a physical card.
      }));

      const { exitCode, report } = await runSchoolDocs([
        'reprint', 'ws-no-card', '--out', path.join(root, 'x.pdf'), '--data-dir', dataDir,
      ]);
      expect(exitCode).toBe(1);
      expect(report.ok).toBe(false);
      expect(report.errors[0]).toMatch(/ws-no-card/);
      expect(report.errors[0]).toMatch(/card allocation/i);
    }));
  });

  describe('list-cards (admin advocacy A5)', () => {
    it('lists every allocation record with card/status/age fields; --status filters', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));
      const published = await runSchoolDocs(['publish', 'quiz.yml', '--content-root', contentRoot]);
      const publishedFile = path.join(contentRoot, 'published', `teacher-cli-fixture@${published.report.rev}.yml`);
      const rendered = await runSchoolDocs([
        'render', publishedFile, '--out', path.join(root, 'a.pdf'), '--content-root', contentRoot, '--fresh-card',
      ]);
      const cardId = rendered.report.allocation.cardId;

      const all = await runSchoolDocs(['list-cards', '--content-root', contentRoot]);
      expect(all.exitCode).toBe(0);
      expect(all.report.cards).toHaveLength(1);
      expect(all.report.cards[0]).toMatchObject({ cardId, status: 'live' });
      expect(all.report.cards[0].renderedAt).toBeTruthy();

      const live = await runSchoolDocs(['list-cards', '--status', 'live', '--content-root', contentRoot]);
      expect(live.report.cards).toHaveLength(1);
      await runSchoolDocs(['release-card', cardId, '--content-root', contentRoot]);
      const liveAfter = await runSchoolDocs(['list-cards', '--status', 'live', '--content-root', contentRoot]);
      expect(liveAfter.report.cards).toEqual([]);
    }));

    it('--older-than filters by render age and rejects malformed values as usage errors', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      const empty = await runSchoolDocs(['list-cards', '--older-than', '30d', '--content-root', contentRoot]);
      expect(empty.exitCode).toBe(0);
      expect(empty.report.cards).toEqual([]);
      const bad = await runSchoolDocs(['list-cards', '--older-than', 'nope', '--content-root', contentRoot]);
      expect(bad.exitCode).toBe(2);
      expect(bad.report.mode).toBe('usage');
    }));
  });

  describe('release-card (Task 7, spec §5.4)', () => {
    it('requires exactly one <cardId> argument (usage error)', async () => {
      const { exitCode, report } = await runSchoolDocs(['release-card']);
      expect(exitCode).toBe(2);
      expect(report.mode).toBe('usage');
    });

    it('rejects a malformed --rows value as a usage error', async () => {
      const { exitCode, report } = await runSchoolDocs(['release-card', '1234567', '--rows', 'nope']);
      expect(exitCode).toBe(2);
      expect(report.mode).toBe('usage');
      expect(report.errors[0]).toMatch(/--rows/);
    });

    it('releases every live record on a card (no --rows) and reports what it released', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));
      const published = await runSchoolDocs(['publish', 'quiz.yml', '--content-root', contentRoot]);
      const publishedFile = path.join(contentRoot, 'published', `teacher-cli-fixture@${published.report.rev}.yml`);
      const rendered = await runSchoolDocs([
        'render', publishedFile, '--out', path.join(root, 'a.pdf'), '--content-root', contentRoot, '--fresh-card',
      ]);
      const cardId = rendered.report.allocation.cardId;

      const { exitCode, report } = await runSchoolDocs(['release-card', cardId, '--content-root', contentRoot]);
      expect(exitCode).toBe(0);
      expect(report.ok).toBe(true);
      expect(report.released).toHaveLength(1);
      expect(report.released[0]).toMatchObject({ cardId, status: 'released' });

      const raw = await readFile(path.join(contentRoot, 'allocations', `${cardId}.yml`), 'utf8');
      expect(raw).toContain('released');
    }));

    it('releasing an already-released (or never-allocated) card is a no-op success, not an error', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      const { exitCode, report } = await runSchoolDocs(['release-card', '1234567', '--content-root', contentRoot]);
      expect(exitCode).toBe(0);
      expect(report.released).toEqual([]);
    }));

    it('exits 1 (not a usage error) for a malformed cardId — the store\'s own validation', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      const { exitCode, report } = await runSchoolDocs(['release-card', 'not-a-card', '--content-root', contentRoot]);
      expect(exitCode).toBe(1);
      expect(report.ok).toBe(false);
      expect(report.errors[0]).toMatch(/7-digit/);
    }));

    it('prints {cardId, rows, released} JSON via the CLI text formatter', async () => withTmpDir(async (root) => {
      const contentRoot = path.join(root, 'content');
      await mkdir(contentRoot, { recursive: true });
      const io = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
      const code = await main(['release-card', '1234567', '--content-root', contentRoot], io);
      expect(code).toBe(0);
      const printed = io.stdout.write.mock.calls.map((call) => call[0]).join('');
      expect(printed).toContain('"cardId":"1234567"');
      expect(printed).toContain('"released":[]');
    }));
  });
});
