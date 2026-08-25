// tests/integration/school/bootImage.test.mjs
//
// THE INCIDENT THIS GUARDS AGAINST (2026-08-25): `courseCatalog.mjs` used to
// do `fs.readFileSync('course.yml')` at MODULE SCOPE and throw on a missing
// file. `course.yml` matched both `.gitignore` and `.dockerignore`, so it
// existed only on the laptop of whoever authored it. `schoolLifecycle.mjs`
// imports that module statically, so the whole school subsystem died at
// import — in the image, in a fresh checkout, everywhere but that one
// laptop. `tests/isolated/composition/schoolLifecycleWiring.test.mjs` stayed
// green the entire time, because it runs from THIS working tree, where the
// file happened to exist. "Tests pass" was never a reproducible claim.
//
// This test boots the school composition root against a filesystem built
// from `git ls-files` — exactly the files git tracks, read from the working
// tree — rather than the ambient working directory the rest of the suite
// runs from. A file that is untracked (the real incident) or tracked-but-
// gitignored never reaches that copy, which is the same gap a fresh clone or
// an image build has. Using `git ls-files` + a working-tree copy (rather
// than `git archive HEAD`, which reads committed blobs) is what lets Step 2
// below prove this guard actually guards: it can edit a tracked file's
// on-disk content and see it reflected immediately, without a throwaway
// commit.
//
// The import itself runs in a CHILD `node` PROCESS, not in-process here.
// Two reasons, not one:
//   1. A module-scope throw during a nested static import is not something
//      an in-process `import()` can cleanly recover from and keep asserting
//      after — a fresh process boundary is the natural unit of "did the
//      subsystem come up".
//   2. It is also the only way to get REAL Node module resolution. This
//      repo's `#composition/*` subpath import (package.json `imports`) is
//      resolved by Node natively — jest's own `moduleNameMapper` in
//      `jest.config.js` does not mirror it, so an in-process `import` of
//      `schoolLifecycle.mjs` from inside this test would resolve
//      differently than production does anyway.
//
// `node_modules` is symlinked into the copy rather than reinstalled — swap
// its target if this ever needs to run somewhere without a pre-built tree.
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// `import.meta.url` -> `__dirname` needs babel's CJS `require()` shim, which
// is absent when jest runs this file as real ESM (the harness invokes jest
// with NODE_OPTIONS=--experimental-vm-modules). `process.cwd()` is simpler
// and correct here: both the harness (`spawn(..., { cwd: rootDir })`) and a
// bare `npx jest` from the repo root run with cwd == repo root.
const repoRoot = process.cwd();

// The probe file itself. Written into the copy's root (beside its own
// `package.json`) so Node resolves `#composition/*` etc. against THAT
// package.json, not this one — the whole point of the exercise.
const PROBE_SOURCE = `
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'school-bootimage-probe-'));
  const silent = { info() {}, warn() {}, error() {}, debug() {} };
  try {
    const { createSchoolLifecycle } = await import('#composition/modules/schoolLifecycle.mjs');
    const result = await createSchoolLifecycle({
      configService: {
        getHouseholdAppConfig: () => ({
          lifecycle: { enabled: true },
          printing: { host: 'printer.local' },
        }),
        getDataDir: () => dataDir,
        getHouseholdPath: (rel) => path.join(dataDir, 'household', rel),
        getDeviceConfig: () => null,
      },
      schoolService: { listBanks: () => [], getBank: () => null },
      eventBus: { broadcast() {}, onClientMessage() {}, subscribe() {} },
      logger: silent,
    });

    const routes = (result.router?.stack || [])
      .filter((layer) => layer.route)
      .map((layer) => ({ path: layer.route.path, methods: Object.keys(layer.route.methods) }));

    process.stdout.write(JSON.stringify({
      bootError: null,
      wired: result.wired,
      reason: result.reason,
      hasRouter: !!result.router,
      hasReporter: !!result.reporter,
      routeCount: routes.length,
      hasScanRoute: routes.some((r) => r.path === '/scan' && r.methods.includes('post')),
    }) + '\\n');
  } catch (err) {
    process.stdout.write(JSON.stringify({
      bootError: err?.message || String(err),
      wired: false,
    }) + '\\n');
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main();
`;

let imageDir;

beforeAll(() => {
  imageDir = mkdtempSync(path.join(tmpdir(), 'school-bootimage-'));

  // Copy exactly what git tracks, reading current WORKING-TREE content (not
  // committed blobs) — `git ls-files` lists tracked paths; `tar` reads them
  // off disk. Anything untracked or gitignored is invisible to this list,
  // which is the failure mode being reproduced. Reading from the working
  // tree (rather than `git archive HEAD`, which reads git objects) is what
  // lets Step 2 of this guard's own verification edit a tracked file in
  // place and see the change without committing it.
  execFileSync(
    'bash',
    ['-c', 'git ls-files -z | tar --null -T - -cf - | tar -xf - -C "$1"', '--', imageDir],
    { cwd: repoRoot, stdio: 'pipe' },
  );

  // node_modules is gitignored (never tracked), so it never rides along in
  // the copy above — symlink the real one rather than reinstalling.
  symlinkSync(path.join(repoRoot, 'node_modules'), path.join(imageDir, 'node_modules'), 'dir');

  writeFileSync(path.join(imageDir, '__boot_probe.mjs'), PROBE_SOURCE);
});

afterAll(() => {
  if (imageDir) rmSync(imageDir, { recursive: true, force: true });
});

function runProbe() {
  const result = spawnSync(process.execPath, ['__boot_probe.mjs'], {
    cwd: imageDir,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return result;
}

describe('school composition root boots against an image-shaped tree', () => {
  it('does not leak this working tree’s untracked/gitignored course.yml into the copy', () => {
    // Pin the specific gap the incident lived in, so a future re-widening of
    // the `.gitignore`/`.dockerignore` negation for this exact file (or a
    // reintroduction of a file read at that path) cannot silently stop being
    // exercised by this guard.
    const leaked = path.join(imageDir, 'backend/src/3_applications/school/rubiksCube/course.yml');
    expect(existsSync(leaked)).toBe(false);
  });

  it('wires createSchoolLifecycle from tracked files alone, with the school routes mounted', () => {
    const proc = runProbe();

    // A process-level crash (e.g. an uncaught throw the probe's own
    // try/catch didn't reach) leaves nothing parseable on stdout — surface
    // exit code + stderr so a failure here is diagnosable, not just
    // "expected true, got undefined".
    let payload;
    try {
      payload = JSON.parse(proc.stdout.trim().split('\n').pop());
    } catch {
      throw new Error(
        `school boot probe produced no parseable JSON (exit ${proc.status}).\n`
        + `stdout: ${proc.stdout}\nstderr: ${proc.stderr}`,
      );
    }

    expect(payload.bootError).toBeNull();
    expect(payload).toMatchObject({ wired: true, hasRouter: true, hasReporter: true });
    expect(payload.routeCount).toBeGreaterThan(0);
    expect(payload.hasScanRoute).toBe(true);
  });
});
