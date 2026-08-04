import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dump } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { runCertify } from './school-certify.cli.mjs';

const NOTES_MODULE = { moduleId: 'notes', type: 'lecture_notes', documentId: 'welcome-notes' };
const QUIZ_MODULE = { moduleId: 'check', type: 'quiz', bankId: 'general:welcome-check' };

const WELCOME_DOCUMENT = {
  schema: 'school.learning-document/v1',
  documentId: 'welcome-notes',
  title: 'Welcome',
  blocks: [{ blockId: 'intro', type: 'prose', text: 'Welcome to the course.' }],
};

const WELCOME_BANK = {
  id: 'general:welcome-check',
  title: 'Welcome check',
  audience: 'assigned',
  items: [{
    id: 'q1', type: 'multiple_choice', prompt: 'Ready?', choices: ['Yes', 'No'], answer: 'Yes',
  }],
};

const STANDALONE_BANK = {
  id: 'b1',
  title: 'Standalone bank',
  audience: 'assigned',
  items: [{
    id: 'q1', type: 'multiple_choice', prompt: 'One plus one?', choices: ['1', '2'], answer: '2',
  }],
};

function welcomeLesson() {
  return {
    lessonId: 'welcome', title: 'Welcome', modules: [NOTES_MODULE, QUIZ_MODULE],
  };
}

/** A lesson whose declared requirement no registered surface (only the codec baseline, here) can ever offer. */
function unreachableLesson() {
  return {
    lessonId: 'unreachable',
    title: 'Unreachable',
    modules: [QUIZ_MODULE],
    requiredCapabilities: ['response.text@1'],
  };
}

function baseCatalog({ lessons }) {
  return {
    schema: 'school.catalog/v1',
    catalogId: 'main',
    title: 'Main',
    subjects: [{
      subjectId: 'general',
      title: 'General',
      courses: [{
        courseId: 'foundations',
        title: 'Foundations',
        units: [{ unitId: 'first', title: 'First', lessons }],
      }],
    }],
  };
}

/** Builds a valid tmp-dir School content corpus; returns its directory paths. */
async function buildFixture(root, {
  lessons = [welcomeLesson()],
  document = WELCOME_DOCUMENT,
  includeStandaloneBank = true,
  schemaError = false,
} = {}) {
  const dirs = {
    catalogs: path.join(root, 'catalogs'),
    documents: path.join(root, 'documents'),
    banks: path.join(root, 'question-banks'),
    surfaces: path.join(root, 'surfaces'),
    assets: path.join(root, 'assets'),
  };
  await Promise.all(Object.values(dirs).map((dir) => mkdir(dir, { recursive: true })));

  const catalog = schemaError
    ? { schema: 'school.catalog/v1', catalogId: 'main', title: 'Main' } // missing subjects: schema error
    : baseCatalog({ lessons });

  await Promise.all([
    writeFile(path.join(dirs.catalogs, 'main.yml'), dump(catalog)),
    writeFile(path.join(dirs.documents, 'welcome.yml'), dump(document)),
    writeFile(path.join(dirs.banks, 'welcome.yml'), dump(WELCOME_BANK)),
    ...(includeStandaloneBank
      ? [writeFile(path.join(dirs.banks, 'b1.yml'), dump(STANDALONE_BANK))]
      : []),
  ]);

  return dirs;
}

function certifyFlags(root, extra = {}) {
  return { 'data-dir': root, 'content-root': '.', ...extra };
}

async function withTmpDir(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'school-certify-'));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function flagsToArgv(flags) {
  const argv = [];
  Object.entries(flags).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => argv.push(`--${key}`, entry));
    } else if (value === true) {
      argv.push(`--${key}`);
    } else {
      argv.push(`--${key}`, value);
    }
  });
  return argv;
}

describe('school-certify CLI', () => {
  it('(a) gate mode exits 1 on a schema error, certifying nothing', async () => {
    await withTmpDir(async (root) => {
      await buildFixture(root, { schemaError: true });
      const { exitCode, report } = await runCertify(flagsToArgv(certifyFlags(root)));
      expect(exitCode).toBe(1);
      expect(report.ok).toBe(false);
      expect(report.mode).toBe('gate');
      expect(report.rows).toEqual([]);
      expect(report.errors.some((e) => e.includes('subjects'))).toBe(true);
    });
  });

  it('(b) gate mode exits 1 on a dangling assetId reference', async () => {
    await withTmpDir(async (root) => {
      const document = {
        ...WELCOME_DOCUMENT,
        blocks: [
          ...WELCOME_DOCUMENT.blocks,
          { blockId: 'diagram', type: 'asset', assetId: 'missing-diagram', alt: 'A diagram' },
        ],
      };
      await buildFixture(root, { document });
      const { exitCode, report } = await runCertify(flagsToArgv(certifyFlags(root)));
      expect(exitCode).toBe(1);
      expect(report.ok).toBe(false);
      expect(report.rows).toEqual([]);
      expect(report.errors.some((e) => e.includes('missing-diagram'))).toBe(true);
    });
  });

  it('(c) gate mode exits 0 and warns about a lesson certified nowhere', async () => {
    await withTmpDir(async (root) => {
      await buildFixture(root, { lessons: [welcomeLesson(), unreachableLesson()] });
      const { exitCode, report } = await runCertify(flagsToArgv(certifyFlags(root)));
      expect(exitCode).toBe(0);
      expect(report.ok).toBe(true);
      expect(report.warnings.some((w) => w.includes('main/general/foundations/first/unreachable'))).toBe(true);
      // The clean lesson must NOT be flagged.
      expect(report.warnings.some((w) => w.includes('main/general/foundations/first/welcome'))).toBe(false);
    });
  });

  it('(d) gate mode certifies standalone question banks as bank:<id> rows', async () => {
    await withTmpDir(async (root) => {
      await buildFixture(root);
      const { exitCode, report } = await runCertify(flagsToArgv(certifyFlags(root)));
      expect(exitCode).toBe(0);
      const bankRows = report.rows.filter((row) => row.address === 'bank:b1');
      expect(bankRows.length).toBeGreaterThan(0);
      bankRows.forEach((row) => expect(row.moduleVerdicts).toBeNull());
    });
  });

  it('(e) query mode --surface ti86-codec-baseline exits 0 with verdict rows present', async () => {
    await withTmpDir(async (root) => {
      await buildFixture(root);
      const { exitCode, report } = await runCertify(flagsToArgv(
        certifyFlags(root, { surface: ['ti86-codec-baseline'] }),
      ));
      expect(exitCode).toBe(0);
      expect(report.mode).toBe('query');
      expect(report.rows.length).toBeGreaterThan(0);
      expect(report.rows.every((row) => row.surfaceId === 'ti86-codec-baseline')).toBe(true);
      const welcomeRow = report.rows.find((row) => row.address === 'main/general/foundations/first/welcome');
      expect(welcomeRow).toBeTruthy();
      expect(['full', 'partial', 'none']).toContain(welcomeRow.verdict);
    });
  });

  it('(f) --json output is sorted by (address, surfaceId) and byte-identical across two runs', async () => {
    await withTmpDir(async (root) => {
      await buildFixture(root);
      const { formatCertifyReport } = await import('./school-certify.cli.mjs');
      const first = await runCertify(flagsToArgv(certifyFlags(root)));
      const second = await runCertify(flagsToArgv(certifyFlags(root)));
      const firstJson = formatCertifyReport(first.report, { json: true });
      const secondJson = formatCertifyReport(second.report, { json: true });
      expect(firstJson).toBe(secondJson);
      expect(firstJson.length).toBeGreaterThan(0);

      const rows = firstJson.trim().split('\n').map((line) => JSON.parse(line));
      const sorted = [...rows].sort((a, b) => (
        a.address === b.address ? a.surfaceId.localeCompare(b.surfaceId) : a.address.localeCompare(b.address)
      ));
      expect(rows).toEqual(sorted);
    });
  });

  it('(g) --write-manifest writes the certification manifest', async () => {
    await withTmpDir(async (root) => {
      await buildFixture(root);
      const { exitCode, report } = await runCertify(flagsToArgv(
        certifyFlags(root, { 'write-manifest': true }),
      ));
      expect(exitCode).toBe(0);
      const manifestPath = path.join(root, 'certification-manifest.json');
      expect(report.manifestWritten).toBe(manifestPath);

      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);
      expect(manifest.schema).toBe('school.certification-manifest/v1');
      expect(Object.keys(manifest.entries).length).toBeGreaterThan(0);
    });
  });
});
