// @vitest-environment node
/**
 * Regression coverage for the bug reported 2026-08-14: `barcode-scan-sim.cli.mjs`
 * silently reported `{ ok: true, sections: 0, offers: [], errors: [] }` for a
 * learner (learner4) whose real agenda had exactly one offer, because the CLI never
 * loaded `.env` (so `DAYLIGHT_BASE_PATH` was unset in a plain shell invocation)
 * and fell back to the Docker-only default `/usr/src/app/data`, which doesn't
 * exist outside the container. Every Yaml adapter downstream treats a missing
 * directory as "an empty shelf, legitimately" (correct FOR THEM — a household
 * really can have nothing published yet), so the whole pipeline "succeeded"
 * against a data root that was never there. That is a diagnostic tool lying,
 * which is worse than no tool.
 *
 * These tests pin down the fix: `validateDataDir` (and its wiring into
 * `runBarcodeScanSim`) must turn "no curriculum reachable at this dataDir" into
 * a loud `ok: false` failure with a specific error, for EVERY command that reads
 * real household data — never into the `sections: 0, errors: []` shape that is
 * indistinguishable from "nothing assigned today". If a future change
 * reintroduces a path that quietly loses the curriculum tree (a reintroduced
 * scratch-copy step, the dotenv load being removed again, a bad default), these
 * tests fail.
 */
import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateDataDir, runBarcodeScanSim, resolveScanSimPaths,
} from '../../../cli/barcode-scan-sim.cli.mjs';

let tmpRoot;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'barcode-scan-sim-test-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeCurriculumFixture(dataDir, { withUnit = true } = {}) {
  const workDir = path.join(dataDir, 'content/school/curriculum/civilization/young-peoples-atlas-us');
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, 'index.yml'), 'schema: school.course/v2\ntitle: Young People\'s Atlas of the US\n');
  if (withUnit) {
    const lessonDir = path.join(workDir, 'units/00-united-states/lessons/atlas-us-p006-united-states');
    fs.mkdirSync(lessonDir, { recursive: true });
    fs.writeFileSync(path.join(lessonDir, 'index.yml'), 'title: The United States\n');
  }
}

describe('validateDataDir', () => {
  it('reports every missing input loudly when dataDir does not exist at all', () => {
    const errors = validateDataDir(path.join(tmpRoot, 'nope'));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/data directory not found/);
  });

  it('reports missing curriculum AND missing household separately when dataDir exists but is empty', () => {
    // This is the exact shape of the bug: a real, existing directory
    // (the Docker-only default resolved on a host without it mounted, or a
    // future reintroduced scratch copy) that simply has nothing in it.
    const errors = validateDataDir(tmpRoot);
    expect(errors.some((e) => /no curriculum content found/.test(e))).toBe(true);
    expect(errors.some((e) => /household config\/data not found/.test(e))).toBe(true);
  });

  it('reports only the household gap when curriculum exists but household does not', () => {
    writeCurriculumFixture(tmpRoot);
    const errors = validateDataDir(tmpRoot);
    expect(errors.some((e) => /no curriculum content found/.test(e))).toBe(false);
    expect(errors.some((e) => /household config\/data not found/.test(e))).toBe(true);
  });

  it('passes clean when curriculum and household both exist', () => {
    writeCurriculumFixture(tmpRoot);
    fs.mkdirSync(path.join(tmpRoot, 'household'), { recursive: true });
    expect(validateDataDir(tmpRoot)).toEqual([]);
  });

  it('treats an empty (but present) curriculum directory the same as a missing one', () => {
    fs.mkdirSync(path.join(tmpRoot, 'content/school/curriculum'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'household'), { recursive: true });
    const errors = validateDataDir(tmpRoot);
    expect(errors.some((e) => /no curriculum content found/.test(e))).toBe(true);
  });
});

describe('runBarcodeScanSim — data-dir gate', () => {
  it('card fails loudly (ok:false, non-empty errors, exit 1) against an empty dataDir instead of reporting a fictional empty agenda', async () => {
    const stateDir = path.join(tmpRoot, 'state');
    const { exitCode, report } = await runBarcodeScanSim(
      ['card', 'learner4', '--data-dir', tmpRoot, '--state-dir', stateDir],
      { env: {} },
    );
    expect(exitCode).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
    // The bug this guards against: this exact shape must never come back for
    // a broken dataDir — it is the "everything is fine, nothing is assigned"
    // shape a real empty-but-valid household would produce, and it is what
    // shipped the wrong report to the household owner.
    expect(report).not.toMatchObject({ ok: true, sections: 0, errors: [] });
  });

  it('lesson fails loudly against an empty dataDir rather than a bare "no unit found" that looks like a content problem', async () => {
    const stateDir = path.join(tmpRoot, 'state');
    const { exitCode, report } = await runBarcodeScanSim(
      ['lesson', 'learner4', 'atlas-us-p006-united-states', '--data-dir', tmpRoot, '--state-dir', stateDir],
      { env: {} },
    );
    expect(exitCode).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toMatch(/no curriculum content found/);
  });

  it('reproduces the exact original bug scenario: no DAYLIGHT_BASE_PATH in the environment must not silently resolve to a nonexistent default', async () => {
    // This is the literal repro from the bug report: `node
    // cli/barcode-scan-sim.cli.mjs card learner4` with no --data-dir and no
    // DAYLIGHT_BASE_PATH exported in the calling shell. Before the fix, this
    // fell back to the Docker-only '/usr/src/app/data' default and reported
    // `{ ok: true, sections: 0, offers: [], errors: [] }` on any host where
    // that path doesn't exist. `env: {}` here simulates exactly that shell.
    const paths = resolveScanSimPaths({ flags: {}, env: {} });
    expect(fs.existsSync(paths.dataDir)).toBe(false); // sanity: this really is a nonexistent default
    const { exitCode, report } = await runBarcodeScanSim(['card', 'learner4'], { env: {} });
    expect(exitCode).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => /data directory not found/.test(e))).toBe(true);
  });

  it('printer-status is exempt from the data-dir gate (it never reads curriculum/household)', async () => {
    const { report } = await runBarcodeScanSim(
      ['printer-status', '--data-dir', tmpRoot, '--skip-printer-check'],
      { env: {} },
    );
    // Not asserting ok:true here (no printer config exists in the fixture
    // dir either) — only that it did NOT get short-circuited by the data-dir
    // gate with a curriculum/household error, since printer-status never
    // depends on either.
    expect(report.errors ?? []).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/no curriculum content found/)]),
    );
  });
});
