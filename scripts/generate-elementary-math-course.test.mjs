import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { validateQuestionBank } from "../__app_modules/learning/school/server/domain/questionBankValidation.mjs";
import { createWorksheetInstance, issueWorksheet, worksheetInstanceDocument } from "../__app_modules/learning/school/server/domain/questionBankV2.mjs";
import { validateUnit } from "../__app_modules/learning/school/server/domain/curriculum/unitValidation.mjs";
import {
  defaultSourceDir, auditElementaryMathBank, auditElementaryMathCourse, generateElementaryMathCourse, publishElementaryMathCourse,
} from './generate-elementary-math-course.mjs';

const SAMPLE_SOURCE = fileURLToPath(new URL('../tests/_fixtures/school/course-sources/sample-math', import.meta.url));
const roots = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe('elementary math course generator', () => {
  it('produces a one-level, six-question, sequential course with valid banks and assets', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elementary-math-course-')); roots.push(root);
    const result = generateElementaryMathCourse({ dataDir: root, sourceDir: SAMPLE_SOURCE });
    expect(result.bankCount).toBe(8);
    expect(result.itemCount).toBe(96);
    expect(result.assetCount).toBe(14);
    const index = yaml.load(fs.readFileSync(path.join(result.courseRoot, '_index.yml'), 'utf8'));
    expect(index).toMatchObject({ work: 'sample-math', medium: 'paper', profiles: { lower: { question_count: 6 } } });
    const banks = fs.readdirSync(result.courseRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
      .flatMap((entry) => fs.readdirSync(path.join(result.courseRoot, entry.name)).filter((file) => file.endsWith('.yml') && file !== '_index.yml')
        .map((file) => yaml.load(fs.readFileSync(path.join(result.courseRoot, entry.name, file), 'utf8'))));
    expect(banks).toHaveLength(8);
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
    expect(banks.filter((bank) => bank.lesson.required === false)).toHaveLength(2);
    const expandedMap = yaml.load(fs.readFileSync(path.join(result.courseRoot, '_study-references.yml'), 'utf8'));
    expect(Object.keys(expandedMap.lessons)).toHaveLength(8);
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
    const placeValue = banks.find((bank) => bank.unit === 'sm-01-01-place-value-to-100');
    expect(placeValue.items.some((entry) => /what amount does the digit/iu.test(entry.prompt))).toBe(true);
    expect(placeValue.items.some((entry) => /Which digit is in the/iu.test(entry.prompt))).toBe(true);
    expect(placeValue.items.some((entry) => /what amount does the digit/iu.test(entry.prompt))).toBe(true);
    const graphBanks = banks.filter((bank) => bank.concepts.some((entry) => entry.conceptId === 'graph'));
    expect(graphBanks.length).toBeGreaterThan(0);
    graphBanks.forEach((bank) => {
      bank.items.filter((entry) => /most/iu.test(entry.prompt)).forEach((entry) => {
        const counts = (entry.stimulus.alt.match(/(?:Red|Blue|Green|Gold): \d+/gu) ?? []).map((label) => Number(label.split(': ')[1]));
        expect(counts.length).toBeGreaterThan(1);
        expect(counts.filter((count) => count === Math.max(...counts))).toHaveLength(1);
      });
    });
    // Source book names that carry a "Practice" suffix must not leak into published references.
    expect(JSON.stringify([index, expandedMap, banks])).not.toMatch(/Practice/u);

    const bareUnderscore = structuredClone(placeValue);
    Object.assign(bareUnderscore.items[0], { prompt: 'What comes next? $230, 240, 250, ___$' });
    expect(auditElementaryMathBank(bareUnderscore).join('\n')).toMatch(/TeX does not render — prompt: Missing open brace for subscript/u);
    const escapedUnderscore = structuredClone(placeValue);
    Object.assign(escapedUnderscore.items[0], { prompt: 'What comes next? $230, 240, 250, \\_\\_\\_$' });
    expect(auditElementaryMathBank(escapedUnderscore).filter((error) => /TeX/u.test(error))).toEqual([]);

    const invalidGreatest = structuredClone(banks.find((bank) => bank.unit === 'sm-01-02-greatest-numbers'));
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
    const course = path.join(root, 'content', 'school', 'math', 'sample-math');
    const assets = path.join(root, 'content', 'assets', 'school', 'math', 'sample-math');
    fs.mkdirSync(course, { recursive: true }); fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(course, 'old.txt'), 'old course'); fs.writeFileSync(path.join(assets, 'old.txt'), 'old assets');

    expect(() => publishElementaryMathCourse({ dataDir: root, sourceDir: SAMPLE_SOURCE, renderPoster: () => { throw new Error('poster failed'); } }))
      .toThrow(/poster failed/);
    expect(fs.readFileSync(path.join(course, 'old.txt'), 'utf8')).toBe('old course');
    expect(fs.readFileSync(path.join(assets, 'old.txt'), 'utf8')).toBe('old assets');

    const result = publishElementaryMathCourse({
      dataDir: root, sourceDir: SAMPLE_SOURCE,
      renderPoster: (courseRoot) => fs.writeFileSync(path.join(courseRoot, 'poster.jpg'), 'poster'),
    });
    expect(result.bankCount).toBe(8);
    expect(fs.existsSync(path.join(result.courseRoot, '_index.yml'))).toBe(true);
    expect(fs.existsSync(path.join(result.courseRoot, 'poster.jpg'))).toBe(true);
    expect(fs.readFileSync(path.join(result.backupRoot, 'course', 'old.txt'), 'utf8')).toBe('old course');
    expect(fs.readFileSync(path.join(result.backupRoot, 'assets', 'old.txt'), 'utf8')).toBe('old assets');
  });

  it('reads the course source from the data mount by default and names that path when it is absent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elementary-math-nosource-')); roots.push(root);
    expect(defaultSourceDir(root, 'sample-math')).toBe(path.join(root, 'content', 'school', 'course-sources', 'sample-math'));
    expect(() => generateElementaryMathCourse({ dataDir: root })).toThrow(
      `course source not found: ${path.join(root, 'content', 'school', 'course-sources', 'elementary-math-2-3', 'course.yml')}`,
    );
    const staged = path.join(root, 'content', 'school', 'course-sources', 'elementary-math-2-3');
    fs.cpSync(SAMPLE_SOURCE, staged, { recursive: true });
    expect(generateElementaryMathCourse({ dataDir: root, requireAbsent: false }).courseId).toBe('sample-math');
  });

  it('takes the course id, title and book names from the source, not from code', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elementary-math-identity-')); roots.push(root);
    const source = path.join(root, 'src'); fs.cpSync(SAMPLE_SOURCE, source, { recursive: true });
    const course = yaml.load(fs.readFileSync(path.join(source, 'course.yml'), 'utf8'));
    course.title = 'Renamed Course'; course.index.title = 'Renamed Course';
    fs.writeFileSync(path.join(source, 'course.yml'), yaml.dump(course));
    const result = generateElementaryMathCourse({ dataDir: path.join(root, 'out'), sourceDir: source });
    expect(fs.readFileSync(path.join(result.courseRoot, 'CURRICULUM.md'), 'utf8')).toMatch(/^# Renamed Course/u);
    expect(yaml.load(fs.readFileSync(path.join(result.courseRoot, '_index.yml'), 'utf8')).title).toBe('Renamed Course');
  });
});
