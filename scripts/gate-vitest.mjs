#!/usr/bin/env node
/**
 * GATE-VITEST — regression gate for the vitest test population that lives
 * OUTSIDE tests/unit/suite/ (which the jest harness owns) and outside the
 * node:test tree under backend/tests/. Before this gate, ~594 vitest files
 * were run by no npm script at all — a real regression once shipped through
 * every gate undetected (see docs/_wip/audits/2026-07-08-test-runner-
 * bifurcation-ungated-vitest.md, the P1.4 PeriodResolver escape).
 *
 * FRONTEND IS IN THE POPULATION. It was not, until 2026-08-27, and nothing
 * announced that: `ROOTS` simply did not list it, so all ~1,150 vitest files
 * under `frontend/` were run by no gate at all. The tell was quiet — adding
 * three tests to a branch left the gate's count unchanged — and the cost was
 * not: during the teacher-console remediation a stale `schoolApi` test-double
 * broke ten tests in `TodayTab.test.jsx` and the branch-end gate reported OK,
 * because it never ran the file. A human noticing was the only thing standing
 * there. Note this is a WIDER statement than the "panel specs sit outside the
 * gate" note that work logged repeatedly: it was never about panels.
 *
 * Population (SSOT, computed here): every test.{js,jsx,mjs} file under
 * tests/unit, tests/isolated, backend/ and frontend/ that vitest owns,
 * excluding:
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
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BASELINE = path.join(ROOT, 'scripts/audit-baseline.vitest.txt');
// Module scope, because BOTH the runner and the regression reporter name it.
// It lived inside runVitest() and the reporter's reference to it threw
// `ReferenceError: outFile is not defined` — after the failing files had
// printed, so the gate looked like it worked and then died reporting.
const GATE_REPORT = path.join(ROOT, 'tests/output/results.gate-vitest.json');
const ROOTS = ['tests/unit', 'tests/isolated', 'backend', 'frontend'];
const EXCLUDE = [/\/node_modules\//, /\/\.claude\//, /\/\.worktrees\//];

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
      const src = readFileSync(f, 'utf8');
      // tests/unit/suite remains Jest-owned by default. An explicit Vitest
      // import is the migration marker that transfers an individual file.
      // Matches the suite tree under EITHER root. The check used to be anchored
      // at the start of `rel`, so `backend/tests/unit/suite/` never matched it
      // and that whole tree entered the population unnoticed — 37 stale files
      // testing contracts the DDD remediation had removed, under the old layer
      // numbering (`1_domains`, `2_adapters`). They were deleted 2026-09-01.
      const relPosix = rel.split(path.sep).join('/');
      if (relPosix.includes('tests/unit/suite/')
        && !/from ['"]vitest['"]/.test(src)) continue;
      if (isVitestOwned(src)) files.push(rel);
    }
  }
  return files.sort();
}

function runVitest(files) {
  const outFile = GATE_REPORT;
  // DELETE THE PREVIOUS REPORT FIRST. The existence check below is the only
  // thing standing between a vitest that died before writing and a silently
  // STALE verdict: leave last run's file in place and the gate happily parses
  // it, prints its counts, and reports OK — for tests it never ran. That is
  // not hypothetical. An invalid CLI flag (`--min-workers`, which this vitest
  // does not accept) made vitest exit immediately, and three consecutive
  // "gate-vitest: OK" lines came straight off a report from an earlier run
  // that predated the tests being verified. A gate that can pass without
  // running is worse than no gate.
  // Keep ONE generation before deleting. The delete itself is not negotiable —
  // see the incident above — but wiping the previous report means the evidence
  // for a red run is destroyed by the next run, and triaging a failure days or
  // even minutes later then depends on reproducing it. That cost real time
  // twice: the log names failing FILES only, so the assertion message, the
  // stack and which tests inside the file failed were all gone by the time
  // anyone looked. `.prev` is never read by the gate, so a stale report still
  // cannot be mistaken for a fresh one.
  try {
    if (existsSync(outFile)) renameSync(outFile, `${outFile}.prev`);
  } catch { /* best effort — never let archiving block the run */ }
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
  // NO `shell: true`. With it, node collapses argv into ONE `/bin/sh -c`
  // string, and Linux caps a single argument at MAX_ARG_STRLEN (128 KiB,
  // 32 pages) — a limit independent of the 2 MiB ARG_MAX everyone reaches
  // for first. At 1,447 files the joined command was ~90 KiB and fit; adding
  // frontend/ took it to ~165 KiB and every run died instantly with
  // `spawnSync /bin/sh E2BIG`, an empty stderr, and no JSON report. Without
  // the shell each path is its own argv entry, so only the 2 MiB total
  // applies and 2,605 files use ~165 KiB of it. `npx` resolves from PATH, so
  // the shell bought nothing here anyway.
  // CHUNKED. One spawn over the whole population stopped producing a report
  // once it passed ~2,600 files: vitest exited 249 with an EMPTY stderr and no
  // JSON, which reads exactly like the E2BIG failure above but is not — the
  // argv is fine, the single run simply gets too big to finish. Chunking keeps
  // each run small enough to complete and merge, and it degrades gracefully as
  // the population keeps growing rather than falling off another cliff.
  const CHUNK = 600;
  const chunks = [];
  for (let i = 0; i < files.length; i += CHUNK) chunks.push(files.slice(i, i + CHUNK));

  const merged = { testResults: [], numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, numPendingTests: 0 };
  let res = null;
  for (const [index, chunk] of chunks.entries()) {
    const chunkOut = `${outFile}.${index}`;
    res = spawnSync(
      'npx',
      ['vitest', 'run', ...chunk, '--config', 'vitest.config.mjs',
       `--max-workers=${workers}`,
       '--reporter=json', `--outputFile=${chunkOut}`],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }
    );
    if (!existsSync(chunkOut)) {
      console.error(`gate-vitest: chunk ${index + 1}/${chunks.length} produced no JSON report `
        + `(${chunk.length} files).`);
      break;
    }
    const part = JSON.parse(readFileSync(chunkOut, 'utf8'));
    merged.testResults.push(...(part.testResults || []));
    merged.numTotalTests += part.numTotalTests || 0;
    merged.numPassedTests += part.numPassedTests || 0;
    merged.numFailedTests += part.numFailedTests || 0;
    merged.numPendingTests += part.numPendingTests || 0;
    rmSync(chunkOut, { force: true });
  }
  if (merged.testResults.length) {
    writeFileSync(outFile, JSON.stringify(merged));
  }
  if (!existsSync(outFile)) {
    // SAY WHY, NOT JUST THAT. The two ways this spawn dies most cheaply both
    // leave stderr EMPTY, so a message built from stderr alone printed one
    // bare sentence and nothing after it — which is what made the E2BIG above
    // expensive to find. `spawnSync` reports those failures on `res.error`,
    // not on the child's output, because there was no child:
    //   E2BIG  — the argv is too long (the bug this comment block records).
    //   ENOENT — `npx` is not on PATH. Dropping `shell: true` made this newly
    //            reachable: `npx` is now resolved by execvp rather than by a
    //            login shell, so a minimal PATH (cron, systemd, a non-nvm
    //            shell) fails here with the same silence.
    console.error('gate-vitest: vitest produced no JSON report.');
    console.error(`gate-vitest: spawn error=${res.error ? `${res.error.code || res.error.message}` : 'none'} `
      + `status=${res.status} signal=${res.signal} files=${files.length}`);
    if (res.error) console.error(`gate-vitest: ${res.error.message}`);
    console.error((res.stderr || '(stderr was empty)').slice(-2000));
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(outFile, 'utf8'));
  // RECONCILE THE POPULATION AGAINST WHAT ACTUALLY RAN. `vitest.config.mjs`
  // applies its `exclude` globs even to paths passed explicitly on the command
  // line, so a file can be counted in the population here and quietly not run
  // — the population number would keep rising while coverage fell, which is
  // the precise failure this gate was built to end. There is no overlap today;
  // widening the population by 80% is exactly when to stop trusting that.
  const ran = new Set(report.testResults.map((t) => path.relative(ROOT, t.name)));
  if (report.testResults.length !== files.length) {
    const missing = files.filter((f) => !ran.has(f));
    const extra = [...ran].filter((f) => !files.includes(f));
    console.error(`\ngate-vitest: population/run MISMATCH — ${files.length} files in population, `
      + `${report.testResults.length} in the report.`);
    if (missing.length) {
      console.error(`gate-vitest: ${missing.length} file(s) in the population that vitest did not run `
        + '(check `exclude` in vitest.config.mjs — it applies to explicit paths too):');
      missing.forEach((f) => console.error('  ? ' + f));
    }
    if (extra.length) {
      console.error(`gate-vitest: ${extra.length} file(s) vitest ran that the population does not claim:`);
      extra.forEach((f) => console.error('  ? ' + f));
    }
    process.exit(2);
  }
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

// The last line writeBaseline emits before the body. Everything after it is
// hand-written and must survive --update.
const HEADER_SENTINEL = '# Regenerate with: node scripts/gate-vitest.mjs --update';

/**
 * Split the existing baseline into its generated header (discarded) and the
 * hand-written `#` prose (kept). WHY: --update used to rewrite this file as
 * `header + failed.join('\n')`, which silently deleted every comment in it —
 * including the notes recording WHICH baseline entries had been individually
 * diagnosed and which were merely observed to pass once. That prose is the
 * only thing distinguishing a considered exception from an absorbed failure,
 * and losing it is not recoverable from the file itself.
 *
 * A comment block sitting directly above a path is that path's rationale and
 * moves with it. A block closed by a separator — a blank line or a bare `#` —
 * or one whose path no longer fails, is free-standing and kept in a notes
 * section. The sentinel must stay the LAST generated header line: everything
 * after it is treated as hand-written, so a generated line below it would be
 * re-preserved as prose on every --update and the header would grow forever.
 */
function parseBaseline() {
  const empty = { notes: [], attached: new Map() };
  if (!existsSync(BASELINE)) return empty;
  const lines = readFileSync(BASELINE, 'utf8').split('\n');
  // No sentinel (someone edited the header) => -1 => scan from line 0 and treat
  // the whole file as hand-written. That over-preserves rather than deleting,
  // which is the right direction to fail in for a file whose whole value is
  // prose someone wrote once.
  const sentinel = lines.findIndex((l) => l.trim() === HEADER_SENTINEL);
  const notes = [];
  const attached = new Map();
  let block = [];
  for (let i = sentinel + 1; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line || line.trim() === '#') {
      // A blank line or a bare `#` closes a block without attaching it.
      if (block.length) { notes.push(block); block = []; }
      continue;
    }
    if (line.startsWith('#')) { block.push(line); continue; }
    if (block.length) { attached.set(line.trim(), block); block = []; }
  }
  if (block.length) notes.push(block);
  return { notes, attached };
}

function writeBaseline(failed, report) {
  // The population sentence is DERIVED from ROOTS, never restated by hand.
  // It was restated by hand once, and when `frontend` was added to ROOTS the
  // generator kept emitting the old three-root list — so the first --update
  // would have quietly reverted the record to the exact false claim the
  // change existed to correct, in a machine-generated file that reads as
  // authoritative. A drifting header is worse than no header.
  const out = [
    '# GATE-VITEST baseline — the SET of vitest files currently failing.',
    `# Population: *.test.{js,jsx,mjs} under ${ROOTS.join(', ')} that vitest`,
    '# OWNS (explicit vitest import, or bare globals with no runner import),',
    '# minus suite/ (jest) and node:test files.',
    '# A file failing that is NOT listed here is a REGRESSION (gate exits 1).',
    `# Captured: ${report.numTotalTests} tests, ${report.numPassedTests} pass, `
      + `${report.numFailedTests} fail, ${report.numPendingTests} skipped.`,
    '# --update PRESERVES the hand-written `#` prose below: a comment block',
    '# directly above a path travels with that path; a block closed by a bare',
    '# `#` is kept in the notes section. Nothing here records WHICH run wrote a',
    '# line, so say in prose why an entry is here if the reason is not obvious.',
    HEADER_SENTINEL, // must stay last — see parseBaseline
  ];
  const { notes, attached } = parseBaseline();
  // A file that now passes is dropped from the list; its rationale is not
  // dropped with it — it becomes a note, labelled with what it used to hold.
  for (const [file, block] of attached) {
    if (!failed.includes(file)) {
      notes.push([`# (was attached to ${file}, which no longer fails)`, ...block]);
    }
  }
  for (const block of notes) out.push('#', ...block);
  out.push('#');
  for (const f of failed) {
    if (attached.has(f)) out.push(...attached.get(f));
    out.push(f);
  }
  writeFileSync(BASELINE, out.join('\n') + '\n');
}

// ---- main ----
const update = process.argv.includes('--update');
const files = vitestPopulation();
console.log(`gate-vitest: ${files.length} vitest files in population`);
const { report, failed } = runVitest(files);
// SPELL OUT THE THREE NUMBERS. "28903/28971 pass" invites a reader to subtract
// and quote 68 failures when 13 failed and 52 were skipped; skipped tests are
// not failures and must not be reported as the same shortfall.
console.log(`gate-vitest: ${report.numTotalTests} tests — ${report.numPassedTests} pass, `
  + `${report.numFailedTests} fail, ${report.numPendingTests} skipped; `
  + `${failed.length} file(s) failing across ${report.testResults.length} files run`);

if (update || !existsSync(BASELINE)) {
  writeBaseline(failed, report);
  console.log(`gate-vitest: baseline ${update ? 'updated' : 'created'} with ${failed.length} failing files`);
  process.exit(0);
}

const baseline = readBaseline();
const regressions = failed.filter((f) => !baseline.has(f));
if (regressions.length) {
  console.error(`\ngate-vitest: ${regressions.length} NEW failing file(s) (not in baseline):`);
  // The failing TEST and its message, not just the file. A bare file name sends
  // the reader off to reproduce a failure that may depend on how the run was
  // sharded, what else was writing to the tree at the time, or which chunk it
  // landed in — none of which they can recover afterwards. Printing the first
  // failure per file puts the actual assertion in the log, which outlives every
  // report file.
  const byFile = new Map();
  for (const t of report.testResults || []) byFile.set(t.name, t);
  for (const f of regressions) {
    console.error('  ✗ ' + f);
    const detail = byFile.get(f) || byFile.get(path.join(ROOT, f));
    const firstFail = (detail?.assertionResults || []).find((a) => a.status === 'failed');
    if (firstFail) {
      console.error(`      ${firstFail.fullName || firstFail.title || '(unnamed test)'}`);
      const msg = (firstFail.failureMessages || [])[0];
      if (msg) console.error(msg.split('\n').slice(0, 4).map((l) => '      ' + l).join('\n'));
    } else if (detail?.message) {
      console.error(detail.message.split('\n').slice(0, 4).map((l) => '      ' + l).join('\n'));
    }
  }
  console.error(`\ngate-vitest: full report kept at ${path.relative(ROOT, GATE_REPORT)} (previous run at the same path + .prev)`);
  process.exit(1);
}
const fixed = [...baseline].filter((f) => !failed.includes(f));
if (fixed.length) {
  console.log(`gate-vitest: ${fixed.length} baseline file(s) now pass — run --update to protect them.`);
}
console.log('gate-vitest: OK (no new failures vs baseline)');
process.exit(0);
