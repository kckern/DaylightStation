import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadYamlSafe } from '#system/utils/FileIO.mjs';
import { buildExerciseIndex } from './exerciseLibraryIndex.lib.mjs';
import {
  formatWarningReport,
  main,
  summarizeWarnings,
} from './exercise-library.cli.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(REPO_ROOT, 'tests/_fixtures/exercise-library');

function fakeIo() {
  const out = [];
  const err = [];
  return {
    out, err,
    stdout: { write: (s) => { out.push(s); return true; } },
    stderr: { write: (s) => { err.push(s); return true; } },
    stdoutText: () => out.join(''),
    stderrText: () => err.join(''),
  };
}

/** The fixture plus the `core` muscle group it deliberately omits — a clean corpus. */
async function cleanCorpus() {
  const root = await mkdtemp(path.join(tmpdir(), 'exercise-library-clean-'));
  const corpus = path.join(root, 'corpus');
  await cp(FIXTURE, corpus, { recursive: true });
  await writeFile(
    path.join(corpus, 'muscle_groups', 'core.yaml'),
    'id: core\nname: Core\nslug: core\ndescription: Trunk.\nmuscles:\n  - abs\n',
    'utf8',
  );
  return { root, corpus };
}

describe('exercise-library CLI', () => {
  describe('validate', () => {
    it('exits non-zero and names every exercise that resolves to zero groups', async () => {
      const io = fakeIo();
      // The fixture's `sit-up-kneeling` targets only `abs`, whose declared group
      // `core` has no muscle_groups record — so it lands in no group bucket.
      await expect(main(['validate', '--corpus-dir', FIXTURE], io)).resolves.toBe(1);
      expect(io.stdoutText()).toContain('sit-up-kneeling');
      expect(io.stdoutText()).toContain('FAILED');
    });

    it('exits zero on a corpus where every exercise resolves to a group', async () => {
      const { root, corpus } = await cleanCorpus();
      try {
        const io = fakeIo();
        await expect(main(['validate', '--corpus-dir', corpus], io)).resolves.toBe(0);
        expect(io.stdoutText()).toContain('OK');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('reports warnings against the corpus it was pointed at', async () => {
      const io = fakeIo();
      await main(['validate', '--corpus-dir', FIXTURE], io);
      // Names the corpus it read, so a run against the wrong tree is visible.
      expect(io.stdoutText()).toContain(FIXTURE);
      expect(io.stdoutText()).toContain('unmatched-video');
      expect(io.stdoutText()).toContain('Unknown-Movement_Waist.mp4');
    });
  });

  describe('warning report', () => {
    const aggregated = {
      kind: 'unknown-group', subject: 'core', referrer: 'muscle', referencedBy: 'abs', count: 402,
    };
    const perRecord = [
      {
        kind: 'empty-field', subject: 'instructions', referrer: 'exercise', referencedBy: 'ab-wheel', count: 1,
      },
      {
        kind: 'empty-field', subject: 'instructions', referrer: 'exercise', referencedBy: 'sit-up', count: 1,
      },
    ];

    it('summarizes an aggregated kind by defect entry and referencing-record total', () => {
      const [summary] = summarizeWarnings([aggregated]);
      expect(summary).toMatchObject({
        kind: 'unknown-group', perRecord: false, entries: 1, records: 402,
      });
    });

    it('summarizes a per-record kind by record count, not by distinct subject', () => {
      const [summary] = summarizeWarnings(perRecord);
      expect(summary).toMatchObject({
        kind: 'empty-field', perRecord: true, entries: 2, records: 2,
      });
    });

    it('renders the two shapes differently so a reader can tell them apart', () => {
      const text = formatWarningReport([aggregated, ...perRecord]);
      // One defect referenced by 402 records — a single line carrying its own count.
      expect(text).toMatch(/unknown-group.*aggregated/);
      expect(text).toContain('402 referencing record(s)');
      expect(text).toMatch(/core.*402/);
      // Two separate records that each hit the same field — never collapsed to one.
      expect(text).toMatch(/empty-field.*one entry per record/);
      expect(text).toContain('2 record(s)');
      expect(text).toContain('ab-wheel');
      expect(text).toContain('sit-up');
    });

    it('says so plainly when there is nothing to report', () => {
      expect(formatWarningReport([])).toContain('no warnings');
    });
  });

  describe('build', () => {
    it('writes a manifest that round-trips back to the built index', async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'exercise-library-build-'));
      const outPath = path.join(root, 'nested', 'exercise-index.yml');
      try {
        const io = fakeIo();
        await expect(main(['build', '--corpus-dir', FIXTURE, '--out', outPath], io)).resolves.toBe(0);

        const manifest = loadYamlSafe(outPath);
        expect(manifest.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        // Same corpus, same builtAt => byte-identical structure.
        const expected = JSON.parse(JSON.stringify(
          buildExerciseIndex(FIXTURE, { builtAt: manifest.builtAt }),
        ));
        expect(manifest).toEqual(expected);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('prints the record, media and warning counts', async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'exercise-library-counts-'));
      try {
        const io = fakeIo();
        await main(['build', '--corpus-dir', FIXTURE, '--out', path.join(root, 'index.yml')], io);
        const text = io.stdoutText();
        expect(text).toContain('exercises   3');
        expect(text).toContain('muscles     3');
        expect(text).toContain('groups      1');
        expect(text).toContain('equipment   2');
        expect(text).toContain('videos      3');
        expect(text).toContain('stills      2');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('reports the manifest path it wrote', async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'exercise-library-path-'));
      const outPath = path.join(root, 'index.yml');
      try {
        const io = fakeIo();
        await main(['build', '--corpus-dir', FIXTURE, '--out', outPath], io);
        expect(io.stdoutText()).toContain(outPath);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe('usage', () => {
    it('rejects an unknown command without touching the corpus', async () => {
      const io = fakeIo();
      await expect(main(['rebuild'], io)).resolves.toBe(2);
      expect(io.stderrText()).toContain('Unknown command: rebuild');
    });

    it('rejects an unknown option', async () => {
      const io = fakeIo();
      await expect(main(['build', '--wat'], io)).resolves.toBe(2);
      expect(io.stderrText()).toContain('Unknown option: --wat');
    });

    it('rejects a valueless path option before resolving any path', async () => {
      const io = fakeIo();
      await expect(main(['validate', '--corpus-dir'], io)).resolves.toBe(2);
      expect(io.stderrText()).toContain('--corpus-dir needs a path');
    });

    it('prints help on --help', async () => {
      const io = fakeIo();
      await expect(main(['--help'], io)).resolves.toBe(0);
      expect(io.stdoutText()).toContain('exercise-library');
    });
  });
});
