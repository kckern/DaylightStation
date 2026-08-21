import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeCourse, main, pairedPermutationP, verifyCourse } from './decoys.mjs';
import { dump } from 'js-yaml';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true })))); });

async function fixture(items) {
  const root = await mkdtemp(path.join(tmpdir(), 'school-decoys-'));
  roots.push(root);
  const courseRoot = path.join(root, 'science', 'test-course');
  const lesson = path.join(courseRoot, 'units', 'one', 'lessons', 'one');
  await mkdir(lesson, { recursive: true });
  await writeFile(path.join(courseRoot, 'course.yml'), dump({ id: 'test-course' }));
  await writeFile(path.join(lesson, 'worksheet.yml'), dump({ schema: 'school.question-bank/v2', id: 'test', items }));
  return courseRoot;
}

function item(id, answer, decoys) { return { id, type: 'multiple_choice', prompt: id, answer, decoys, levels: ['lower', 'upper'] }; }

describe('school decoys audit', () => {
  it('is deterministic for a fixed choice pool', () => {
    const differences = [1, -2, 3, -1];
    expect(pairedPermutationP(differences, 1000, 'fixed')).toBe(pairedPermutationP(differences, 1000, 'fixed'));
  });

  it('passes balanced pools and reports non-classic pools separately', async () => {
    const courseRoot = await fixture([
      item('a', 'red apple', ['blue berry', 'green pear', 'yellow plum']),
      item('b', 'blue berry', ['red apple', 'green pear', 'yellow plum']),
      { id: 'select', type: 'multi_select', prompt: 'Pick two', answers: ['red', 'blue'], decoys: ['green'] },
    ]);
    const report = analyzeCourse({ courseId: 'science/test-course', courseRoot, trials: 1000 });
    expect(report.pass).toBe(true);
    expect(report.items).toBe(2);
    expect(report.skipped.multi_select).toBe(1);
    expect(report.inspect25PercentLonger).toEqual([]);
  });

  it('fails a directional long-answer cue and identifies required inspection', async () => {
    const courseRoot = await fixture(Array.from({ length: 12 }, (_, index) => item(
      `q${index}`,
      'the detailed correct scientific explanation',
      ['short wrong answer', 'brief mistaken idea', 'small false claim'],
    )));
    const report = analyzeCourse({ courseId: 'science/test-course', courseRoot, trials: 1000 });
    expect(report.pass).toBe(false);
    expect(report.gates.wordPermutationP_gte_0_05).toBe(false);
    expect(report.words.uniqueCorrectLongestRate).toBe(1);
    expect(report.inspect25PercentLonger).toHaveLength(12);
  });

  it('rejects an all-course verification request because evidence is per course', async () => {
    expect(await main(['verify', 'all'])).toBe(2);
  });

  it('rejects a stale audit record after any choice-pool change', async () => {
    const courseRoot = await fixture([item('a', 'red apple', ['blue berry', 'green pear', 'yellow plum'])]);
    const report = analyzeCourse({ courseId: 'science/test-course', courseRoot, trials: 1000 });
    await writeFile(path.join(courseRoot, 'decoy-audit.yml'), dump({
      schema: 'school.decoy-audit/v1', status: 'pass', content_fingerprint: report.fingerprint,
      length_audit: { method: 'Paired two-sided permutation test, 1000 sign permutations per metric.' },
    }));
    expect(verifyCourse(report, courseRoot).pass).toBe(true);
    const bankFile = path.join(courseRoot, 'units', 'one', 'lessons', 'one', 'worksheet.yml');
    const changed = { schema: 'school.question-bank/v2', id: 'test', items: [item('a', 'red apple', ['black cherry', 'green pear', 'yellow plum'])] };
    await writeFile(bankFile, dump(changed));
    const stale = analyzeCourse({ courseId: 'science/test-course', courseRoot, trials: 1000 });
    const checked = verifyCourse(stale, courseRoot);
    expect(checked.pass).toBe(false);
    expect(checked.verification.errors).toContain('decoy-audit.yml content_fingerprint does not match live choice pools');
  });
});
