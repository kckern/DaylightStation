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
 * tests/unit and tests/isolated that imports from 'vitest', excluding:
 *   - tests/unit/suite/       (jest — gated by `npm run test:unit`)
 *   - any backend/ path        (node:test tree — different runner)
 *   - any .claude/ or .worktrees/ path (sibling worktree copies)
 * NOT included: jest files (import '@jest/globals') that live outside suite/.
 * Those are a SEPARATE known gap tracked in the bifurcation audit — they are
 * run by no harness today and must either move into suite/ or get a jest glob.
 *
 * Ratchet semantics (mirrors scripts/audit-layer-imports.mjs):
 *   node scripts/gate-vitest.mjs            # check: exit 1 if a NEW file fails
 *   node scripts/gate-vitest.mjs --update   # rewrite the baseline (only after
 *                                            # a change legitimately fixes files)
 * The baseline is the SET of currently-failing files. A file failing that is
 * not in the baseline = regression (exit 1). A baseline file that now passes is
 * fine; run --update to drop it so it is protected going forward.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BASELINE = path.join(ROOT, 'scripts/audit-baseline.vitest.txt');
const ROOTS = ['tests/unit', 'tests/isolated'];
const EXCLUDE = [/\/suite\//, /\/backend\//, /\/\.claude\//, /\/\.worktrees\//];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.test\.(js|jsx|mjs)$/.test(name)) out.push(full);
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
      const src = readFileSync(f, 'utf8');
      if (/from ['"]vitest['"]/.test(src)) files.push(rel);
    }
  }
  return files.sort();
}

function runVitest(files) {
  const outFile = path.join(ROOT, 'tests/output/results.gate-vitest.json');
  // Default parallelism (fast enough for CI over ~600 files). The audit's
  // ENFILE-flake note applied to the full ~3k-file sweep; this scoped run is
  // stable. Bump --max-workers down here if a machine hits fd limits.
  const res = spawnSync(
    'npx',
    ['vitest', 'run', ...files, '--config', 'vitest.config.mjs',
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
    '# Population: *.test.{js,jsx,mjs} under tests/unit + tests/isolated that',
    '# import from vitest, minus suite/ (jest) and backend/ (node:test).',
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
