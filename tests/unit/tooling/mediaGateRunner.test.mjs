import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runGroups, uniquePath, groupedJourneys, groupStem } from '../../../scripts/media-gate-runner.mjs';
import { validateReport, runGate } from '../../../scripts/media-stable-core-gate.mjs';
import { runP0Gate } from '../../../scripts/media-p0-gate.mjs';

const passing = { suites: [{ specs: [{ tests: [{ results: [{ status: 'passed' }] }] }] }] };
const failing = { suites: [{ specs: [{ tests: [{ title: 'A', results: [{ status: 'failed' }] }] }] }] };
const ok = () => ({ args: ['x'], status: 0, stdout: JSON.stringify(passing), stderr: '' });
const bad = () => ({ args: ['x'], status: 1, stdout: JSON.stringify(failing), stderr: 'boom' });

const groups = ['a', 'b', 'c'].map((n) => ({ file: `${n}.runtime.test.mjs`, grep: n, stories: [{ story: `S.${n}`, criteria: [`S.${n}/AC1`] }] }));

function harness(script, { load = 1, cpus = 4, strict = false } = {}) {
  const files = new Map();
  const calls = [];
  const out = runGroups({
    groups,
    evidenceDir: '/ev',
    strict,
    loadavg: () => [load, 0, 0],
    cpus: () => cpus,
    write: (p, c) => files.set(p, c),
    exists: (p) => files.has(p),
    validate: validateReport,
    execute: (journey, attempt) => {
      calls.push(`${journey.grep}#${attempt}`);
      return script(journey.grep, attempt)();
    },
  });
  return { out, files, calls };
}

describe('media gate runner', () => {
  it('never aborts: runs every group and lists every failure at the end', () => {
    const { out, calls } = harness((g) => (g === 'a' || g === 'c' ? bad : ok));
    expect(calls).toEqual(['a#1', 'a#2', 'b#1', 'c#1', 'c#2']);
    expect(out.exitCode).toBe(1);
    expect(out.failed.map(({ journey }) => journey.grep)).toEqual(['a', 'c']);
    const text = out.lines.join('\n');
    expect(text).toMatch(/FAILED GROUPS \(2\)/);
    expect(text).toMatch(/FAIL a\.runtime\.test\.mjs/);
    expect(text).toMatch(/FAIL c\.runtime\.test\.mjs/);
    expect(text).toMatch(/^PASS b\.runtime/m);
  });

  it('retries at most once, and only after a failed attempt', () => {
    const { calls, out } = harness(() => bad);
    expect(calls).toEqual(['a#1', 'a#2', 'b#1', 'b#2', 'c#1', 'c#2']);
    expect(out.results.every(({ attempts }) => attempts.length === 2)).toBe(true);
    const clean = harness(() => ok);
    expect(clean.calls).toEqual(['a#1', 'b#1', 'c#1']);
    expect(clean.out.exitCode).toBe(0);
  });

  it('reports PASS-AFTER-RETRY (flaky) distinctly from PASS and FAIL', () => {
    const { out } = harness((g, attempt) => (g === 'a' ? (attempt === 1 ? bad : ok) : g === 'b' ? bad : ok));
    expect(out.results.map(({ status }) => status)).toEqual(['PASS-AFTER-RETRY', 'FAIL', 'PASS']);
    const text = out.lines.join('\n');
    expect(text).toMatch(/^PASS-AFTER-RETRY \(flaky\) a\.runtime/m);
    expect(text).toMatch(/^FAIL b\.runtime/m);
    expect(text).toMatch(/^PASS c\.runtime/m);
    expect(text).toMatch(/SUMMARY: 3 groups; PASS 1; PASS-AFTER-RETRY \(flaky\) 1; FAIL 1; DEFERRED: load 0/);
    expect(out.exitCode).toBe(1);
  });

  it('does not retry when the load average is at or above the CPU count: DEFERRED: load', () => {
    const { out, calls } = harness((g) => (g === 'b' ? bad : ok), { load: 4, cpus: 4 });
    expect(calls).toEqual(['a#1', 'b#1', 'c#1']);
    expect(out.results[1].status).toBe('DEFERRED');
    expect(out.deferred).toHaveLength(1);
    expect(out.lines.join('\n')).toMatch(/^DEFERRED: load b\.runtime/m);
    expect(out.exitCode).toBe(1);
  });

  it('writes every attempt with an -attempt-N suffix and never overwrites', () => {
    const { files } = harness((g, attempt) => (g === 'a' && attempt === 1 ? bad : ok));
    const names = [...files.keys()].sort();
    expect(names).toContain('/ev/01-a.runtime.test.mjs-a-attempt-1.json');
    expect(names).toContain('/ev/01-a.runtime.test.mjs-a-attempt-2.log');
    expect(files.get('/ev/01-a.runtime.test.mjs-a-attempt-1.log')).toMatch(/boom/);
    const taken = new Set(['/ev/s-attempt-1.json']);
    expect(uniquePath('/ev', 's', 1, 'json', (p) => taken.has(p))).toBe('/ev/s-attempt-1-dup2.json');
  });

  it('strict mode refuses ledger-grade acceptance when any group is flaky', () => {
    const script = (g, attempt) => (g === 'a' && attempt === 1 ? bad : ok);
    const lenient = harness(script);
    expect(lenient.out.exitCode).toBe(0);
    const strict = harness(script, { strict: true });
    expect(strict.out.exitCode).toBe(1);
    expect(strict.out.lines.join('\n')).toMatch(/STRICT: refusing ledger-grade acceptance/);
  });

  it('survives a thrown or non-JSON execution without aborting', () => {
    const { out } = harness((g) => (g === 'a' ? () => { throw new Error('spawn failed'); } : g === 'b' ? () => ({ status: 0, stdout: 'not json', stderr: '' }) : ok));
    expect(out.results.map(({ status }) => status)).toEqual(['FAIL', 'FAIL', 'PASS']);
    expect(out.results[1].reason).toMatch(/invalid Playwright JSON/);
  });

  it('keeps evidence file names under the OS limit for a long grep, distinct per grep', () => {
    const long = (n) => Array.from({ length: 30 }, (_, i) => `\\[FIND\\.1a/AC${i}\\] title ${n}`).join('|');
    const a = groupStem(0, { file: 'media-app-find-proof.runtime.test.mjs', grep: long('a') });
    const b = groupStem(0, { file: 'media-app-find-proof.runtime.test.mjs', grep: long('b') });
    expect(a.length).toBeLessThan(120);
    expect(a).not.toBe(b);
    expect(groupStem(2, { file: 'f.mjs', grep: 'short grep' })).toBe('03-f.mjs-short_grep');
  });

  it('groups manifest entries by file and grep', () => {
    expect(groupedJourneys([
      { story: 'A', criteria: ['A/1'], file: 'f', grep: 'g' },
      { story: 'B', criteria: ['B/1'], file: 'f', grep: 'g' },
    ])).toHaveLength(1);
  });
});

describe('validateReport', () => {
  it('names every non-passed test, not only the first', () => {
    const report = { suites: [{ specs: [{ tests: [
      { title: 'one', results: [{ status: 'failed' }] },
      { title: 'two', results: [{ status: 'passed' }] },
      { title: 'three', results: [{ status: 'timedOut' }] },
    ] }] }] };
    expect(() => validateReport(report)).toThrow(/2 of 3 not passed: one: failed; three: timedOut/);
  });
});

describe('gate entry points', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'media-gate-'));
  const env = { BASE_URL: 'http://x', MEDIA_P0_EVIDENCE_DIR: dir, MEDIA_STABLE_CORE_EVIDENCE_DIR: dir };
  it('P0 gate runs every group even when each fails', () => {
    const seen = [];
    const out = runP0Gate({ env, execute: (j) => { seen.push(j.grep); return { args: [], status: 1, stdout: '', stderr: '' }; }, loadavg: () => [99], cpus: () => 1 });
    expect(out.exitCode).toBe(1);
    expect(out.results.length).toBe(seen.length);
    expect(out.deferred.length).toBe(out.results.length);
  });
  it('stable-core gate shares the runner', () => {
    const out = runGate({ env, execute: () => ({ args: [], status: 0, stdout: JSON.stringify(passing), stderr: '' }), loadavg: () => [0], cpus: () => 4 });
    expect(out.exitCode).toBe(0);
  });
});
