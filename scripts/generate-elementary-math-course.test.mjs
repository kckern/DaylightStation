import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { validateQuestionBank } from '#domains/school/questionBankValidation.mjs';
import { createWorksheetInstance, issueWorksheet, worksheetInstanceDocument } from '#domains/school/questionBankV2.mjs';
import { validateUnit } from '#domains/school/curriculum/unitValidation.mjs';
import {
  auditElementaryMathBank, auditElementaryMathCourse, generateElementaryMathCourse, publishElementaryMathCourse,
} from './generate-elementary-math-course.mjs';

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
    expect(auditElementaryMathCourse(banks)).toEqual([]);
    banks.forEach((bank) => {
      expect(validateQuestionBank(bank).ok).toBe(true);
      expect(validateUnit(bank.lesson, { bankIds: new Set([bank.id]) }).errors).toEqual([]);
      expect(bank.items).toHaveLength(12);
      expect(bank.lesson.studyReferences.length).toBeGreaterThanOrEqual(1);
      expect(bank.lesson.studyReferences.length).toBeLessThanOrEqual(3);
      expect(bank.lesson.studyReferences[0].role).toBe('primary');
      expect(bank.items.every((item) => item.source === undefined && item.reviewReference)).toBe(true);
      expect(bank.items.every((item) => item.concepts?.length)).toBe(true);
      expect(bank.lesson.worksheet.examples).toHaveLength(1);
      const [example] = bank.lesson.worksheet.examples;
      expect(example.question.prompt).toBeTruthy();
      expect(example.question.choices).toContain(example.solution.answer);
      expect(example.solution.steps.length).toBeGreaterThanOrEqual(1);
      expect(example.solution.steps.length).toBeLessThanOrEqual(3);
      (example.appliesTo?.concepts ?? []).forEach((conceptId) => {
        expect(bank.concepts.map((concept) => concept.conceptId)).toContain(conceptId);
      });
      const issued = issueWorksheet({ bank, learnerId: 'proof', enrollmentId: 'proof', lessonId: bank.unit, profile: 'lower', seed: 'proof' });
      expect(issued.items).toHaveLength(6);
      expect(issued.items.every((item) => item.reviewReference?.pages.length)).toBe(true);
      const instance = createWorksheetInstance({
        id: `math/proof/ws-${bank.unit}`, sessionId: `proof-${bank.unit}`, bank,
        learnerId: 'proof', enrollmentId: 'proof', lessonId: bank.unit, profile: 'lower', seed: 'proof',
        issuedAt: '2026-08-31T00:00:00.000Z', worksheet: bank.lesson.worksheet,
      });
      expect(instance.workedExamples).toHaveLength(1);
      expect(worksheetInstanceDocument(instance).blocks.some((block) => block.layout === 'worked_example')).toBe(true);
      expect(auditElementaryMathBank(bank)).toEqual([]);
      expect(new Set(bank.items.map((item) => JSON.stringify([
        item.prompt, item.answer, [...item.decoys].sort(), item.stimulus?.alt ?? '',
      ]))).size).toBe(12);
      expect(new Set(bank.items.map((item) => item.feedback.incorrect)).size).toBeGreaterThanOrEqual(3);
    });
    banks.filter((bank) => bank.unit.endsWith('-99-mastery')).forEach((bank) => {
      expect(bank.lesson.studyReferences.length).toBeGreaterThanOrEqual(2);
      expect(bank.lesson.studyReferences.length).toBeLessThanOrEqual(3);
      expect(bank.items.every((item) => item.concepts.some((concept) => concept !== 'mastery'))).toBe(true);
    });
    expect(banks.filter((bank) => bank.lesson.required === false)).toHaveLength(14);
    const expandedMap = yaml.load(fs.readFileSync(path.join(result.courseRoot, '_study-references.yml'), 'utf8'));
    expect(Object.keys(expandedMap.lessons)).toHaveLength(84);
    expect(JSON.stringify(expandedMap)).not.toContain('Beast Academy 2A Practice');
    expect(JSON.stringify(index.sources)).not.toContain('Practice');
    expect(JSON.stringify(banks)).not.toContain('Beast Academy 2A Practice');
    const refs = banks.flatMap((bank) => bank.items.map((item) => item.stimulus?.ref).filter(Boolean));
    refs.forEach((ref) => expect(fs.existsSync(path.join(root, 'content', 'assets', `${ref}.svg`))).toBe(true));
    const fractionChoices = banks.flatMap((bank) => bank.items.flatMap((item) => [item.answer, ...item.decoys]))
      .map((choice) => /^(\d+)\/(\d+)$/u.exec(String(choice))).filter(Boolean);
    expect(fractionChoices.length).toBeGreaterThan(0);
    fractionChoices.forEach(([, numerator, denominator]) => {
      expect(Number(numerator)).toBeLessThanOrEqual(Number(denominator));
    });

    const allItems = banks.flatMap((bank) => bank.items);
    const allCopy = allItems.flatMap((item) => [item.prompt, item.feedback.incorrect]).join('\n');
    expect(allItems.map((item) => item.prompt).filter((prompt) => /\bdigit\b/iu.test(prompt)).join('\n')).not.toMatch(/\bvalue\b/iu);
    expect(allCopy).not.toMatch(/Try the .+ strategy again/iu);
    expect(allCopy).not.toMatch(/(^|[^\\])\bBox\b/mu);
    expect(allCopy).not.toMatch(/\b1 (?:quarters|dimes|nickels|pennies)\b/iu);
    expect(allCopy).not.toMatch(/\b(?:0|[2-9]|1\d+) (?:quarter|dime|nickel|penny)\b/iu);
    expect(allCopy).not.toMatch(/\b0 (?:quarters|dimes|nickels|pennies)\b/iu);
    const placeValue = banks.find((bank) => bank.unit === 'em23-01-01-place-value-to-1-000');
    expect(placeValue.items.some((entry) => /what amount does the digit/iu.test(entry.prompt))).toBe(true);
    expect(placeValue.items.some((entry) => /Which digit is in the/iu.test(entry.prompt))).toBe(true);
    expect(placeValue.items.some((entry) => /What amount does it represent/iu.test(entry.prompt))).toBe(true);
    const graphBanks = banks.filter((bank) => ['graph', 'graph-difference'].some((concept) => bank.concepts.some((entry) => entry.conceptId === concept)));
    graphBanks.filter((bank) => bank.concepts.some((entry) => entry.conceptId === 'graph')).forEach((bank) => {
      bank.items.forEach((entry) => {
        if (/most/iu.test(entry.prompt)) {
          const labels = entry.stimulus.alt.match(/(?:Red|Blue|Green|Gold|2|3|4|5): \d+/gu) ?? [];
          const counts = labels.map((label) => Number(label.split(': ')[1]));
          expect(counts.filter((count) => count === Math.max(...counts))).toHaveLength(1);
        }
      });
    });

    const invalidGreatest = structuredClone(banks.find((bank) => bank.unit === 'em23-02-01-greatest-numbers'));
    Object.assign(invalidGreatest.items[0], { answer: '382', decoys: ['383', '328', '283', '238'] });
    expect(auditElementaryMathBank(invalidGreatest).join('\n')).toMatch(/designated greatest answer is not uniquely correct/iu);

    const neighborFallback = structuredClone(placeValue);
    Object.assign(neighborFallback.items[0], { answer: '100', decoys: ['98', '99', '101', '102'] });
    expect(auditElementaryMathBank(neighborFallback).join('\n')).toMatch(/forbidden answer ±1\/±2 fallback/iu);

    const duplicatedItem = structuredClone(placeValue);
    duplicatedItem.items[1] = { ...structuredClone(duplicatedItem.items[0]), id: duplicatedItem.items[1].id };
    expect(auditElementaryMathBank(duplicatedItem).join('\n')).toMatch(/semantically duplicate questions/iu);
  });

  it('builds the complete course before replacing live directories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elementary-math-publish-')); roots.push(root);
    const course = path.join(root, 'content', 'school', 'math', 'elementary-math-2-3');
    const assets = path.join(root, 'content', 'assets', 'school', 'math', 'elementary-math-2-3');
    fs.mkdirSync(course, { recursive: true }); fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(course, 'old.txt'), 'old course'); fs.writeFileSync(path.join(assets, 'old.txt'), 'old assets');

    expect(() => publishElementaryMathCourse({ dataDir: root, renderPoster: () => { throw new Error('poster failed'); } }))
      .toThrow(/poster failed/);
    expect(fs.readFileSync(path.join(course, 'old.txt'), 'utf8')).toBe('old course');
    expect(fs.readFileSync(path.join(assets, 'old.txt'), 'utf8')).toBe('old assets');

    const result = publishElementaryMathCourse({
      dataDir: root,
      renderPoster: (courseRoot) => fs.writeFileSync(path.join(courseRoot, 'poster.jpg'), 'poster'),
    });
    expect(result.bankCount).toBe(84);
    expect(fs.existsSync(path.join(result.courseRoot, '_index.yml'))).toBe(true);
    expect(fs.existsSync(path.join(result.courseRoot, 'poster.jpg'))).toBe(true);
    expect(fs.readFileSync(path.join(result.backupRoot, 'course', 'old.txt'), 'utf8')).toBe('old course');
    expect(fs.readFileSync(path.join(result.backupRoot, 'assets', 'old.txt'), 'utf8')).toBe('old assets');
  });
});
