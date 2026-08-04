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

/** An `asset_choice` item, optionally carrying dangling/valid promptImage and choices[].image refs. */
function assetChoiceItem({ promptImageRef, choiceImageRef } = {}) {
  const item = {
    id: 'q1',
    type: 'asset_choice',
    prompt: 'Pick the correct diagram',
    choices: [
      { value: 'a', label: 'A', ...(choiceImageRef ? { image: { src: choiceImageRef } } : {}) },
      { value: 'b', label: 'B' },
    ],
    answer: 'a',
  };
  if (promptImageRef) item.promptImage = { src: promptImageRef };
  return item;
}

function assetChoiceBank(itemOverrides) {
  return {
    id: 'ac1', title: 'Asset choice bank', audience: 'assigned', items: [assetChoiceItem(itemOverrides)],
  };
}

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

/** A lesson declaring a pattern-valid but never-registered capability ID (F7). */
function unregisteredCapabilityLesson() {
  return {
    lessonId: 'magic',
    title: 'Magic',
    modules: [QUIZ_MODULE],
    requiredCapabilities: ['flying-carpet@1'],
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

  it('(c2) gate mode exits 1 on an unregistered requiredCapabilities ID (F7)', async () => {
    await withTmpDir(async (root) => {
      await buildFixture(root, { lessons: [welcomeLesson(), unregisteredCapabilityLesson()] });
      const { exitCode, report } = await runCertify(flagsToArgv(certifyFlags(root)));
      expect(exitCode).toBe(1);
      expect(report.ok).toBe(false);
      expect(report.rows).toEqual([]);
      expect(report.errors.some((e) => e.includes('flying-carpet@1'))).toBe(true);
      expect(report.errors.some((e) => e.includes('main/general/foundations/first/magic'))).toBe(true);
    });
  });

  it('(c3) gate mode still passes a lesson with only registered requiredCapabilities IDs', async () => {
    await withTmpDir(async (root) => {
      await buildFixture(root, { lessons: [welcomeLesson(), unreachableLesson()] });
      const { exitCode, report } = await runCertify(flagsToArgv(certifyFlags(root)));
      expect(exitCode).toBe(0);
      expect(report.errors).toEqual([]);
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

  // --- Fix-report follow-up tests (review findings) ---

  it('(h) query mode over the whole corpus (no --address/--file) still exits 1 on a schema error', async () => {
    await withTmpDir(async (root) => {
      await buildFixture(root, { schemaError: true });
      const { exitCode, report } = await runCertify(flagsToArgv(
        certifyFlags(root, { surface: ['ti86-codec-baseline'] }),
      ));
      expect(exitCode).toBe(1);
      expect(report.ok).toBe(false);
      expect(report.mode).toBe('query');
      expect(report.rows).toEqual([]);
      expect(report.errors.some((e) => e.includes('subjects'))).toBe(true);
    });
  });

  it('(i) asset-existence validation catches a dangling asset_choice promptImage ref', async () => {
    await withTmpDir(async (root) => {
      const dirs = await buildFixture(root);
      await writeFile(
        path.join(dirs.banks, 'ac1.yml'),
        dump(assetChoiceBank({ promptImageRef: 'missing-prompt' })),
      );
      const { exitCode, report } = await runCertify(flagsToArgv(certifyFlags(root)));
      expect(exitCode).toBe(1);
      expect(report.errors.some((e) => e.includes('promptImage') && e.includes('missing-prompt'))).toBe(true);
    });
  });

  it('(j) asset-existence validation catches a dangling asset_choice choices[].image ref', async () => {
    await withTmpDir(async (root) => {
      const dirs = await buildFixture(root);
      await writeFile(
        path.join(dirs.banks, 'ac1.yml'),
        dump(assetChoiceBank({ choiceImageRef: 'missing-choice-image' })),
      );
      const { exitCode, report } = await runCertify(flagsToArgv(certifyFlags(root)));
      expect(exitCode).toBe(1);
      expect(report.errors.some((e) => e.includes('choices[0].image') && e.includes('missing-choice-image'))).toBe(true);
    });
  });

  it('(k) valid asset_choice promptImage/choices[].image refs pass asset-existence validation', async () => {
    await withTmpDir(async (root) => {
      const dirs = await buildFixture(root);
      await writeFile(path.join(dirs.assets, 'prompt-diagram.svg'), '<svg></svg>');
      await writeFile(path.join(dirs.assets, 'choice-diagram.svg'), '<svg></svg>');
      await writeFile(
        path.join(dirs.banks, 'ac1.yml'),
        dump(assetChoiceBank({ promptImageRef: 'prompt-diagram', choiceImageRef: 'choice-diagram' })),
      );
      const { exitCode, report } = await runCertify(flagsToArgv(certifyFlags(root)));
      expect(exitCode).toBe(0);
      expect(report.rows.some((row) => row.address === 'bank:ac1')).toBe(true);
    });
  });

  it('(l) --write-manifest is rejected in query mode with a usage error, manifest untouched (F8)', async () => {
    await withTmpDir(async (root) => {
      await buildFixture(root);
      const { exitCode, report } = await runCertify(flagsToArgv(
        certifyFlags(root, { address: 'main/general/foundations/first/welcome', 'write-manifest': true }),
      ));
      expect(exitCode).toBe(2);
      expect(report.ok).toBe(false);
      expect(report.mode).toBe('usage');
      expect(report.rows).toEqual([]);
      expect(report.manifestWritten).toBeNull();
      expect(report.errors.some((e) => e.includes('--write-manifest'))).toBe(true);

      const { existsSync } = await import('node:fs');
      const manifestPath = path.join(root, 'certification-manifest.json');
      expect(existsSync(manifestPath)).toBe(false);
    });
  });

  it('(m) --write-manifest with --surface is also rejected as a usage error (F8)', async () => {
    await withTmpDir(async (root) => {
      await buildFixture(root);
      const { exitCode, report } = await runCertify(flagsToArgv(
        certifyFlags(root, { surface: ['ti86-codec-baseline'], 'write-manifest': true }),
      ));
      expect(exitCode).toBe(2);
      expect(report.mode).toBe('usage');
    });
  });

  it('(n) a bare --surface with no value is a usage error, not "unknown surface \'true\'" (F13)', async () => {
    await withTmpDir(async (root) => {
      await buildFixture(root);
      const { exitCode, report } = await runCertify([
        '--data-dir', root, '--content-root', '.', '--surface',
      ]);
      expect(exitCode).toBe(2);
      expect(report.mode).toBe('usage');
      expect(report.errors.some((e) => e.includes('--surface needs a value'))).toBe(true);
      expect(report.errors.some((e) => e.includes("'true'"))).toBe(false);
    });
  });

  it('(o) --json output has canonically sorted keys within each line (F13)', async () => {
    await withTmpDir(async (root) => {
      await buildFixture(root);
      const { formatCertifyReport } = await import('./school-certify.cli.mjs');
      const { report } = await runCertify(flagsToArgv(certifyFlags(root)));
      const json = formatCertifyReport(report, { json: true });
      const firstLine = json.trim().split('\n')[0];
      const keys = Object.keys(JSON.parse(firstLine));
      expect(keys).toEqual([...keys].sort());
    });
  });
});
