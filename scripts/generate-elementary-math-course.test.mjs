import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { validateQuestionBank } from '#domains/school/questionBankValidation.mjs';
import { issueWorksheet } from '#domains/school/questionBankV2.mjs';
import { validateUnit } from '#domains/school/curriculum/unitValidation.mjs';
import { generateElementaryMathCourse } from './generate-elementary-math-course.mjs';

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe('elementary math course generator', () => {
  it('produces a one-level, six-question, sequential course with valid banks and assets', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elementary-math-course-')); roots.push(root);
    const result = generateElementaryMathCourse({ dataDir: root });
    expect(result.bankCount).toBe(84);
    expect(result.itemCount).toBe(1008);
    expect(result.assetCount).toBeGreaterThan(100);
    const index = yaml.load(fs.readFileSync(path.join(result.courseRoot, '_index.yml'), 'utf8'));
    expect(index).toMatchObject({ work: 'elementary-math-2-3', medium: 'paper', profiles: { lower: { question_count: 6 } } });
    const banks = fs.readdirSync(result.courseRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
      .flatMap((entry) => fs.readdirSync(path.join(result.courseRoot, entry.name)).filter((file) => file.endsWith('.yml') && file !== '_index.yml')
        .map((file) => yaml.load(fs.readFileSync(path.join(result.courseRoot, entry.name, file), 'utf8'))));
    expect(banks).toHaveLength(84);
    banks.forEach((bank) => {
      expect(validateQuestionBank(bank).ok).toBe(true);
      expect(validateUnit(bank.lesson, { bankIds: new Set([bank.id]) }).errors).toEqual([]);
      expect(bank.items).toHaveLength(12);
      expect(bank.lesson.studyReferences.length).toBeGreaterThanOrEqual(1);
      expect(bank.lesson.studyReferences.length).toBeLessThanOrEqual(3);
      expect(bank.lesson.studyReferences[0].role).toBe('primary');
      expect(bank.items.every((item) => item.source === undefined && item.reviewReference)).toBe(true);
      const issued = issueWorksheet({ bank, learnerId: 'proof', enrollmentId: 'proof', lessonId: bank.unit, profile: 'lower', seed: 'proof' });
      expect(issued.items).toHaveLength(6);
      expect(issued.items.every((item) => item.reviewReference?.pages.length)).toBe(true);
    });
    banks.filter((bank) => bank.unit.endsWith('-99-mastery')).forEach((bank) => {
      expect(bank.lesson.studyReferences.length).toBeGreaterThanOrEqual(2);
      expect(bank.lesson.studyReferences.length).toBeLessThanOrEqual(3);
    });
    expect(banks.filter((bank) => bank.lesson.required === false)).toHaveLength(14);
    const expandedMap = yaml.load(fs.readFileSync(path.join(result.courseRoot, '_study-references.yml'), 'utf8'));
    expect(Object.keys(expandedMap.lessons)).toHaveLength(84);
    const refs = banks.flatMap((bank) => bank.items.map((item) => item.stimulus?.ref).filter(Boolean));
    refs.forEach((ref) => expect(fs.existsSync(path.join(root, 'content', 'assets', `${ref}.svg`))).toBe(true));
    const fractionChoices = banks.flatMap((bank) => bank.items.flatMap((item) => [item.answer, ...item.decoys]))
      .map((choice) => /^(\d+)\/(\d+)$/u.exec(String(choice))).filter(Boolean);
    expect(fractionChoices.length).toBeGreaterThan(0);
    fractionChoices.forEach(([, numerator, denominator]) => {
      expect(Number(numerator)).toBeLessThanOrEqual(Number(denominator));
    });
  });
});
