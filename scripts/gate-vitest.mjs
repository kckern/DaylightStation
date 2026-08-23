#!/usr/bin/env node
/**
 * GATE-VITEST — regression gate for the vitest test population that lives
 * OUTSIDE tests/unit/suite/ (which the jest harness owns) and outside the
 * node:test tree under backend/tests/. Before this gate, ~594 vitest files
 * were run by no npm script at all — a real regression once shipped through
 * every gate undetected (see docs/_wip/audits/2026-07-08-test-runner-
 * bifurcation-ungated-vitest.md, the P1.4 PeriodResolver escape).
 *
 * Population (SSOT, computed here): every test.{js,jsx,mjs} file under
 * tests/unit, tests/isolated and backend/ that vitest owns, excluding:
 *   - tests/unit/suite/       (jest — gated by `npm run test:unit`)
 *   - any node_modules/ path
 *   - any .claude/ or .worktrees/ path (sibling worktree copies)
 * NOT included: jest files (import '@jest/globals') that live outside suite/.
 * Those are a SEPARATE known gap tracked in the bifurcation audit — they are
 * run by no harness today and must either move into suite/ or get a jest glob.
 *
 * BACKEND IS IN THE POPULATION, by content and not by path. This gate used to
 * exclude `/backend/` wholesale on the belief that the whole tree was
 * node:test. It is not: 92 backend files are node:test, but ~350 colocated
 * `backend/src` and `backend/tests/unit` test files are vitest,
 * and every one of them was gated by nothing. The print-acceptance sweep
 * lived in that hole, which is how `acceptance.phaseB`/`phaseC` sat red
 * without any gate noticing. Ownership is therefore decided by what a file
 * imports: an explicit `from 'vitest'`, or bare globals (`describe`/`it`)
 * with no runner import at all, which vitest supplies via `globals: true`.
 * A `node:test` or `@jest/globals` import means another runner owns it.
 *
 * Ratchet semantics (mirrors scripts/audit-layer-imports.mjs):
 *   node scripts/gate-vitest.mjs            # check: exit 1 if a NEW file fails
 *   node scripts/gate-vitest.mjs --update   # rewrite the baseline (only after
 *                                            # a change legitimately fixes files)
 * The baseline is the SET of currently-failing files. A file failing that is
 * not in the baseline = regression (exit 1). A baseline file that now passes is
 * fine; run --update to drop it so it is protected going forward.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BASELINE = path.join(ROOT, 'scripts/audit-baseline.vitest.txt');
const ROOTS = ['tests/unit', 'tests/isolated', 'backend'];
const EXCLUDE = [/\/suite\//, /\/node_modules\//, /\/\.claude\//, /\/\.worktrees\//];

/**
 * Which runner owns this file, decided by its own imports rather than its
 * path — the two are not the same thing anywhere in this repo.
 */
function isVitestOwned(src) {
  if (/from ['"]vitest['"]/.test(src)) return true;
  // Another runner named explicitly always wins.
  if (/from ['"]node:test['"]|require\(['"]node:test['"]\)/.test(src)) return false;
  if (/from ['"]@jest\/globals['"]/.test(src)) return false;
  // No runner import at all: vitest's `globals: true` is what supplies these.
  return /^\s*(describe|it|test)\s*[(.]/m.test(src);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    // NEVER follow a symlink. `backend/shared` and `backend/shared-contracts`
    // both point up at `shared/`, so a walk that followed them would collect
    // the same file twice under two paths — and the aliased copy fails to
    // load at all, because its own relative imports resolve against the real
    // directory, not the link. `lstat` semantics (withFileTypes) keep the
    // population to real files reached by their real path.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.test\.(js|jsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function vitestPopulation() {
  const files = [];
  for (const r of ROOTS) {
    const abs = path.join(ROOT, r);
    if (!existsSync(abs)) continue;
    for (const f of walk(abs)) {
      const rel = path.relative(ROOT, f);
      if (EXCLUDE.some((re) => re.test('/' + rel))) continue;
      if (isVitestOwned(readFileSync(f, 'utf8'))) files.push(rel);
    }
  }
  return files.sort();
}

function runVitest(files) {
  const outFile = path.join(ROOT, 'tests/output/results.gate-vitest.json');
  // DELETE THE PREVIOUS REPORT FIRST. The existence check below is the only
  // thing standing between a vitest that died before writing and a silently
  // STALE verdict: leave last run's file in place and the gate happily parses
  // it, prints its counts, and reports OK — for tests it never ran. That is
  // not hypothetical. An invalid CLI flag (`--min-workers`, which this vitest
  // does not accept) made vitest exit immediately, and three consecutive
  // "gate-vitest: OK" lines came straight off a report from an earlier run
  // that predated the tests being verified. A gate that can pass without
  // running is worse than no gate.
  try { rmSync(outFile, { force: true }); } catch { /* first run, or already gone */ }
  // Parallelism is CAPPED, not default. Default workers were fine while the
  // population was ~600 files; folding backend/ in took it past 1200 and the
  // contention started producing flakes — the same file passing alone and in
  // one gate run, failing in the next, with a different file each time
  // (quizScanRecorder, RenderPrintDocument, curriculumPlanner, scripture all
  // took a turn). A gate that flakes is a gate people learn to re-run until
  // it is green, which is the same as having no gate. Half the cores keeps
  // the run parallel while leaving each worker enough headroom to be
  // deterministic.
  const workers = Math.max(2, Math.floor((os.cpus?.().length ?? 4) / 2));
  const res = spawnSync(
    'npx',
    ['vitest', 'run', ...files, '--config', 'vitest.config.mjs',
     `--max-workers=${workers}`,
     '--reporter=json', `--outputFile=${outFile}`],
    { cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 1 << 28 }
  );
  if (!existsSync(outFile)) {
    console.error('gate-vitest: vitest produced no JSON report.\n' + (res.stderr || '').slice(-2000));
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(outFile, 'utf8'));
  const failed = report.testResults
    .filter((t) => t.status === 'failed')
    .map((t) => path.relative(ROOT, t.name))
    .sort();
  return { report, failed };
}

function readBaseline() {
  if (!existsSync(BASELINE)) return null;
  return new Set(
    readFileSync(BASELINE, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  );
}

function writeBaseline(failed, report) {
  const header = [
    '# GATE-VITEST baseline — the SET of vitest files currently failing.',
    '# Population: *.test.{js,jsx,mjs} under tests/unit, tests/isolated and',
    '# backend/ that vitest OWNS (explicit vitest import, or bare globals with',
    '# no runner import), minus suite/ (jest) and node:test files.',
    '# A file failing that is NOT listed here is a REGRESSION (gate exits 1).',
    `# Captured: ${report.numTotalTests} tests, ${report.numPassedTests} pass, ${report.numFailedTests} fail.`,
    '# Regenerate with: node scripts/gate-vitest.mjs --update',
    '',
  ].join('\n');
  writeFileSync(BASELINE, header + failed.join('\n') + '\n');
}

// ---- main ----
const update = process.argv.includes('--update');
const files = vitestPopulation();
console.log(`gate-vitest: ${files.length} vitest files in population`);
const { report, failed } = runVitest(files);
console.log(`gate-vitest: ${report.numPassedTests}/${report.numTotalTests} tests pass; ${failed.length} files failing`);

if (update || !existsSync(BASELINE)) {
  writeBaseline(failed, report);
  console.log(`gate-vitest: baseline ${update ? 'updated' : 'created'} with ${failed.length} failing files`);
  process.exit(0);
}

const baseline = readBaseline();
const regressions = failed.filter((f) => !baseline.has(f));
if (regressions.length) {
  console.error(`\ngate-vitest: ${regressions.length} NEW failing file(s) (not in baseline):`);
  regressions.forEach((f) => console.error('  ✗ ' + f));
  process.exit(1);
}
const fixed = [...baseline].filter((f) => !failed.includes(f));
if (fixed.length) {
  console.log(`gate-vitest: ${fixed.length} baseline file(s) now pass — run --update to protect them.`);
}
console.log('gate-vitest: OK (no new failures vs baseline)');
process.exit(0);
