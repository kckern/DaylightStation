import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeCourse, main, pairedPermutationP, PRACTICAL_LENGTH_AUDIT_METHOD, verifyCourse } from './decoys.mjs';
import { dump } from 'js-yaml';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true })))); });

async function fixture(items, manifest = 'course.yml') {
  const root = await mkdtemp(path.join(tmpdir(), 'school-decoys-'));
  roots.push(root);
  const courseRoot = path.join(root, 'content', 'school', 'science', 'test-course');
  const lesson = path.join(courseRoot, 'units', 'one', 'lessons', 'one');
  await mkdir(lesson, { recursive: true });
  await writeFile(path.join(courseRoot, manifest), dump({ id: 'test-course' }));
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
      item('a', 'red apple', ['blue pear', 'green fig', 'black tea']),
      item('b', 'blue pear', ['red apple', 'green fig', 'black tea']),
      { id: 'select', type: 'multi_select', prompt: 'Pick two', answers: ['red', 'blue'], decoys: ['green'] },
    ]);
    const report = analyzeCourse({ courseId: 'science/test-course', courseRoot, trials: 1000 });
    expect(report.pass).toBe(true);
    expect(report.items).toBe(2);
    expect(report.skipped.multi_select).toBe(1);
    expect(report.inspect25PercentSkew).toEqual([]);
  });

  it('fails a directional long-answer cue and identifies required inspection', async () => {
    const courseRoot = await fixture(Array.from({ length: 12 }, (_, index) => item(
      `q${index}`,
      'the detailed correct scientific explanation',
      ['short wrong answer', 'brief mistaken idea', 'small false claim'],
    )));
    const report = analyzeCourse({ courseId: 'science/test-course', courseRoot, trials: 1000 });
    expect(report.pass).toBe(false);
    expect(report.gates.correctUniqueLengthExtremeRate_lte_0_40).toBe(false);
    expect(report.words.uniqueCorrectLongestRate).toBe(1);
    expect(report.inspect25PercentSkew).toHaveLength(12);
  });

  it('fails a directional short-answer cue as well', async () => {
    const courseRoot = await fixture(Array.from({ length: 12 }, (_, index) => item(
      `q${index}`,
      'no',
      ['a detailed but incorrect scientific claim', 'a plausible alternative explanation here', 'a reasonable but mistaken conclusion'],
    )));
    const report = analyzeCourse({ courseId: 'science/test-course', courseRoot, trials: 1000 });
    expect(report.pass).toBe(false);
    expect(report.words.uniqueCorrectShortestRate).toBe(1);
    expect(report.inspect25PercentSkew).toHaveLength(12);
  });

  it('measures rendered math characters rather than TeX authoring markup', async () => {
    const courseRoot = await fixture([
      item('math', '$x^8$', ['$x^{15}$', '$x^2$', '$x^5$', '$2x^8$']),
    ]);
    const report = analyzeCourse({ courseId: 'science/test-course', courseRoot, trials: 1000 });
    // TeX braces are authoring syntax, not printed characters. The visible
    // options are x⁸ (2), x¹⁵ (3), x² (2), x⁵ (2), and 2x⁸ (3).
    expect(report.characters.answerMean).toBe(2);
    expect(report.characters.decoyMean).toBe(2.5);
  });

  it('rejects an all-course verification request because evidence is per course', async () => {
    expect(await main(['verify', 'all'])).toBe(2);
  });

  it('discovers index.yml-authored courses for an all-school audit', async () => {
    const courseRoot = await fixture([item('a', 'red apple', ['blue pear', 'green fig', 'black tea'])], 'index.yml');
    const root = path.resolve(courseRoot, '../../../..');
    expect(await main(['audit', 'all', '--data-dir', root, '--trials', '1000'])).toBe(0);
  });

  it('rejects a stale audit record after any choice-pool change', async () => {
    const courseRoot = await fixture([item('a', 'red apple', ['blue pear', 'green fig', 'black tea'])]);
    const report = analyzeCourse({ courseId: 'science/test-course', courseRoot, trials: 1000 });
    await writeFile(path.join(courseRoot, 'decoy-audit.yml'), dump({
      schema: 'school.decoy-audit/v1', status: 'pass', content_fingerprint: report.fingerprint,
      length_audit: { method: PRACTICAL_LENGTH_AUDIT_METHOD },
    }));
    expect(verifyCourse(report, courseRoot).pass).toBe(true);
    const bankFile = path.join(courseRoot, 'units', 'one', 'lessons', 'one', 'worksheet.yml');
    const changed = { schema: 'school.question-bank/v2', id: 'test', items: [item('a', 'red apple', ['black plum', 'green fig', 'yellow tea'])] };
    await writeFile(bankFile, dump(changed));
    const stale = analyzeCourse({ courseId: 'science/test-course', courseRoot, trials: 1000 });
    const checked = verifyCourse(stale, courseRoot);
    expect(checked.pass).toBe(false);
    expect(checked.verification.errors).toContain('decoy-audit.yml content_fingerprint does not match live choice pools');
  });
});
