import { existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Shared Playwright group runner for the Media gates (stable core + P0).
 *
 * Contract: never abort the loop; every group runs; failures are collected
 * and reported together. A failed group may retry once, only when the host is
 * not overloaded (1-minute load average below the CPU count); otherwise it is
 * reported `DEFERRED: load`. Every attempt writes its own `-attempt-N` files,
 * never overwriting an earlier one. A group that passes only on retry is
 * `PASS-AFTER-RETRY (flaky)`; `--strict` refuses ledger-grade acceptance
 * when any group is flaky.
 */

export const MEDIA_JOURNEY_DIRECTORY = 'tests/live/flow/media';
export const MAX_ATTEMPTS = 2;

export function groupedJourneys(entries) {
  const journeys = new Map();
  for (const entry of entries) {
    const key = `${entry.file}\u0000${entry.grep}`;
    const journey = journeys.get(key) || { file: entry.file, grep: entry.grep, stories: [] };
    journey.stories.push(entry);
    journeys.set(key, journey);
  }
  return [...journeys.values()];
}

export function groupStem(index, journey) {
  const safe = (value) => value.replace(/[^a-zA-Z0-9._-]/g, '_');
  // A grep can be a long alternation of titles: keep the file name readable and unique (hash), never over the OS name limit.
  const grep = journey.grep.length > 40
    ? `${safe(journey.grep).slice(0, 32)}-${createHash('sha1').update(journey.grep).digest('hex').slice(0, 8)}`
    : safe(journey.grep);
  return `${String(index + 1).padStart(2, '0')}-${safe(journey.file)}-${grep}`;
}

/** Evidence path that never replaces an existing file. */
export function uniquePath(evidenceDir, stem, attempt, ext, exists = existsSync) {
  let candidate = path.join(evidenceDir, `${stem}-attempt-${attempt}.${ext}`);
  for (let dup = 2; exists(candidate); dup += 1) {
    candidate = path.join(evidenceDir, `${stem}-attempt-${attempt}-dup${dup}.${ext}`);
  }
  return candidate;
}

export function loadAllowsRetry(loadavg = os.loadavg, cpus = () => os.cpus().length) {
  return loadavg()[0] < cpus();
}

export function playwrightExecute(journey, { cwd, env }) {
  const target = path.join(MEDIA_JOURNEY_DIRECTORY, journey.file);
  const args = ['playwright', 'test', target, '--grep', journey.grep, '--workers=1', '--reporter=json'];
  const result = spawnSync('npx', args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { args, status: result.status, signal: result.signal, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error };
}

function judgeAttempt(run, validate) {
  if (run.error) return { ok: false, reason: `Playwright could not start: ${run.error.message}` };
  if (run.status !== 0) return { ok: false, reason: `exit ${run.status ?? 'null'}${run.signal ? ` signal ${run.signal}` : ''}` };
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch (error) {
    return { ok: false, reason: `invalid Playwright JSON: ${error.message}` };
  }
  try {
    return { ok: true, ...validate(report) };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

/**
 * @returns {{results: object[], failed: object[], flaky: object[], deferred: object[], exitCode: number, lines: string[]}}
 */
export function runGroups({
  groups,
  execute,
  validate,
  evidenceDir,
  strict = false,
  loadavg = os.loadavg,
  cpus = () => os.cpus().length,
  write = writeFileSync,
  exists = existsSync,
}) {
  const results = [];

  groups.forEach((journey, index) => {
    const stem = groupStem(index, journey);
    const attempts = [];
    let outcome = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let run;
      try {
        run = execute(journey, attempt);
      } catch (error) {
        run = { args: [], status: null, stdout: '', stderr: String(error?.message || error), error };
      }
      const jsonPath = uniquePath(evidenceDir, stem, attempt, 'json', exists);
      const textPath = uniquePath(evidenceDir, stem, attempt, 'log', exists);
      write(jsonPath, run.stdout || '');
      write(textPath, [
        `$ npx ${(run.args || []).join(' ')}`,
        `attempt=${attempt} exit=${run.status ?? 'null'} signal=${run.signal ?? 'none'}`,
        run.stderr || '',
      ].join('\n'));
      const judged = judgeAttempt(run, validate);
      attempts.push({ attempt, ok: judged.ok, reason: judged.reason, tests: judged.tests, paths: { jsonPath, textPath } });
      if (judged.ok) {
        outcome = { status: attempt === 1 ? 'PASS' : 'PASS-AFTER-RETRY', tests: judged.tests };
        break;
      }
      if (attempt < MAX_ATTEMPTS && !loadAllowsRetry(loadavg, cpus)) {
        outcome = { status: 'DEFERRED', reason: 'load' };
        break;
      }
    }
    if (!outcome) outcome = { status: 'FAIL' };
    const last = attempts.at(-1);
    results.push({ journey, attempts, ...outcome, reason: outcome.reason === 'load' ? `load; first attempt: ${attempts[0].reason}` : last.reason });
  });

  const failed = results.filter(({ status }) => status === 'FAIL' || status === 'DEFERRED');
  const flaky = results.filter(({ status }) => status === 'PASS-AFTER-RETRY');
  const deferred = results.filter(({ status }) => status === 'DEFERRED');
  const lines = formatResults(results);
  const passed = results.filter(({ status }) => status === 'PASS').length;
  lines.push(
    `SUMMARY: ${results.length} groups; PASS ${passed}; PASS-AFTER-RETRY (flaky) ${flaky.length}; FAIL ${failed.length - deferred.length}; DEFERRED: load ${deferred.length}`,
  );
  if (failed.length) {
    lines.push(`FAILED GROUPS (${failed.length}):`, ...failed.map(({ journey, status, reason }) => `  ${status === 'DEFERRED' ? 'DEFERRED: load' : 'FAIL'} ${journey.file} --grep ${journey.grep}: ${reason}`));
  }
  let exitCode = failed.length ? 1 : 0;
  if (strict && flaky.length) {
    lines.push(
      `STRICT: refusing ledger-grade acceptance; ${flaky.length} group(s) passed only after retry:`,
      ...flaky.map(({ journey }) => `  ${journey.file} --grep ${journey.grep}`),
    );
    exitCode = 1;
  }
  return { results, failed, flaky, deferred, exitCode, lines };
}

export function formatResults(results) {
  const lines = [];
  for (const { journey, status, tests, attempts, reason } of results) {
    const supported = journey.stories.map(({ story, criteria }) => `${story} (${criteria.join(', ')})`).join(', ');
    const label = status === 'PASS-AFTER-RETRY' ? 'PASS-AFTER-RETRY (flaky)' : status === 'DEFERRED' ? 'DEFERRED: load' : status;
    if (status === 'PASS' || status === 'PASS-AFTER-RETRY') {
      lines.push(`${label} ${journey.file} --grep ${journey.grep}: ${tests} tests; ${supported}`);
    } else {
      lines.push(`${label} ${journey.file} --grep ${journey.grep}: ${reason}; ${supported}`);
    }
    for (const attempt of attempts) {
      lines.push(`  attempt ${attempt.attempt} ${attempt.ok ? 'ok' : `failed (${attempt.reason})`} json=${attempt.paths.jsonPath} text=${attempt.paths.textPath}`);
    }
  }
  return lines;
}
