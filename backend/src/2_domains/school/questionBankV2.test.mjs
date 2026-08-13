import { describe, expect, it } from 'vitest';
import { validateQuestionBank } from './questionBankValidation.mjs';
import { publishDocument } from './documents/documentSource.mjs';
import {
  normalizeQuestionBankV2, issueWorksheet,
  gradeIssuedWorksheet, remediationReceipt, createWorksheetInstance, worksheetInstanceDocument,
} from './questionBankV2.mjs';

const item = (id, type = 'multiple_choice') => ({
  id, type, prompt: `Question ${id}?`,
  ...(type === 'multi_select' ? { answers: ['Option 1', 'Option 2'], decoys: Array.from({ length: 7 }, (_, i) => `Option ${i + 3}`) }
    : { answer: 'Option 1', decoys: Array.from({ length: 8 }, (_, i) => `Option ${i + 2}`) }),
  levels: ['lower', 'upper'], source: { page: 'p. 50', zone: 'fact-box.capital' },
});
const bank = {
  schema: 'school.question-bank/v2', id: 'atlas/kansas', title: 'Kansas',
  items: [...Array.from({ length: 12 }, (_, i) => item(`q${i}`)), item('m1', 'multi_select'), item('m2', 'multi_select')],
};

describe('question-bank/v2', () => {
  it('validates explicit answers and decoys, pool sizes, and forbids choices', () => {
    expect(validateQuestionBank(bank).ok).toBe(true);
    expect(validateQuestionBank({ ...bank, items: [{ ...item('bad'), choices: ['nope'] }] }).errors).toContainEqual(expect.stringMatching(/choices is forbidden/));
    expect(validateQuestionBank({ ...bank, items: [{ ...item('bad'), answer: undefined }] }).errors).toContainEqual(expect.stringMatching(/requires a non-empty answer/));
    expect(validateQuestionBank({ ...bank, items: [{ ...item('bad'), decoys: ['one'] }] }).errors).toContainEqual(expect.stringMatching(/8\.\.10/));
  });

  it('combines answers and decoys into revision-scoped identities', () => {
    const normalized = normalizeQuestionBankV2(bank);
    expect(normalized.items[0].choices[0]).toMatchObject({ label: 'Option 1', correct: true });
    expect(normalized.items[0].choices[0].id).toMatch(new RegExp(`^${normalized.revision}:q0:`));
  });

  it('issues lower and upper profiles while retaining every correct option', () => {
    const lower = issueWorksheet({ bank, learnerId: 'milo', enrollmentId: 'e1', lessonId: 'kansas', profile: 'lower', seed: 'one' });
    const upper = issueWorksheet({ bank, learnerId: 'felix', enrollmentId: 'e2', lessonId: 'kansas', profile: 'upper', seed: 'two' });
    expect(lower.items).toHaveLength(6);
    expect(lower.items.every((entry) => [3, 4].includes(entry.options.length))).toBe(true);
    expect(upper.items).toHaveLength(10);
    expect(upper.items.every((entry) => entry.options.length === 5)).toBe(true);
    expect(upper.items.filter((entry) => entry.type === 'multi_select')).toHaveLength(2);
    expect(upper.items.filter((entry) => entry.type === 'multi_select').every((entry) => entry.options.filter((option) => option.correct).length === 2)).toBe(true);
  });

  it('grades exact sets from the immutable snapshot and reissues only missed ids freshly', () => {
    const issued = issueWorksheet({ bank, learnerId: 'milo', enrollmentId: 'e1', lessonId: 'kansas', profile: 'lower', seed: 'one' });
    const first = issued.items[0];
    const grade = gradeIssuedWorksheet(issued, { [first.itemId]: first.options.find((option) => option.correct).id });
    expect(grade.results[0].correct).toBe(true);
    expect(grade.missedItemIds).toHaveLength(5);
    const retry = issueWorksheet({ bank, learnerId: 'milo', enrollmentId: 'e1', lessonId: 'kansas', profile: 'lower', seed: 'retry', itemIds: grade.missedItemIds });
    expect(new Set(retry.itemIds)).toEqual(new Set(grade.missedItemIds));
    expect(retry.items[0].options).not.toEqual(issued.items.find((entry) => entry.itemId === retry.items[0].itemId)?.options);
  });

  it('applies receipt disclosure policies', () => {
    const issued = issueWorksheet({ bank, learnerId: 'milo', enrollmentId: 'e1', lessonId: 'kansas', profile: 'lower', seed: 'one' });
    const grade = gradeIssuedWorksheet(issued, {});
    expect(remediationReceipt(issued, grade, 'locator_only').items[0]).not.toHaveProperty('answers');
    expect(remediationReceipt(issued, grade, 'show_answer').items[0].answers).toHaveLength(1);
    expect(remediationReceipt(issued, grade, 'teacher_only').items).toEqual([]);
  });

  it('creates a publishable immutable enrollment-bound OMR instance', () => {
    const instance = createWorksheetInstance({
      id: 'civilization/atlas/ws-one', sessionId: 'ses-one', bank,
      learnerId: 'milo', enrollmentId: 'enr-milo-atlas', lessonId: 'kansas',
      profile: 'lower', seed: 'one', issuedAt: '2026-08-13T00:00:00.000Z',
    });
    expect(Object.isFrozen(instance)).toBe(true);
    expect(instance).toMatchObject({ learnerId: 'milo', enrollmentId: 'enr-milo-atlas' });
    const result = publishDocument(worksheetInstanceDocument(instance, { title: 'Kansas' }));
    expect(result.errors).toBeUndefined();
    expect(result.published.blocks[0].type).toBe('question');
    const questions = result.published.blocks.filter((block) => block.type === 'question');
    expect(questions).toHaveLength(6);
    expect(questions.every((block) => block.omr && block.blocks.at(-1).layout === 'compact')).toBe(true);
    expect(result.bank.items).toHaveLength(6);
  });
});
