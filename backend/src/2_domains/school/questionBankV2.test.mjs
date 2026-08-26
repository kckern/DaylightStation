import { describe, expect, it } from 'vitest';
import { validateQuestionBank } from './questionBankValidation.mjs';
import { publishDocument } from './documents/documentSource.mjs';
import {
  normalizeQuestionBankV2, issueWorksheet,
  createWorksheetInstance, worksheetInstanceDocument, composedWorksheetDocument, formatPageSpans,
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
  it('formats authored printed-page ranges without dropping string spans', () => {
    expect(formatPageSpans(['8-10', 12, '14–15'])).toBe('8–10, 12, 14–15');
  });
  it('validates explicit answers and decoys, pool sizes, and forbids choices', () => {
    expect(validateQuestionBank(bank).ok).toBe(true);
    expect(validateQuestionBank({ ...bank, items: [{ ...item('bad'), choices: ['nope'] }] }).errors).toContainEqual(expect.stringMatching(/choices is forbidden/));
    expect(validateQuestionBank({ ...bank, items: [{ ...item('bad'), answer: undefined }] }).errors).toContainEqual(expect.stringMatching(/requires a non-empty answer/));
    expect(validateQuestionBank({ ...bank, items: [{ ...item('five'), decoys: ['two', 'three', 'four', 'five'] }] }).ok).toBe(true);
    expect(validateQuestionBank({ ...bank, items: [{ ...item('bad'), decoys: ['one', 'two', 'three'] }] }).errors).toContainEqual(expect.stringMatching(/5\.\.10/));
  });

  it('combines answers and decoys into revision-scoped identities', () => {
    const normalized = normalizeQuestionBankV2(bank);
    expect(normalized.items[0].choices[0]).toMatchObject({ label: 'Option 1', correct: true });
    expect(normalized.items[0].choices[0].id).toMatch(new RegExp(`^${normalized.revision}:q0:`));
  });

  it('issues lower and upper profiles while retaining every correct option', () => {
    const lower = issueWorksheet({ bank, learnerId: 'learner3', enrollmentId: 'e1', lessonId: 'kansas', profile: 'lower', seed: 'one' });
    const upper = issueWorksheet({ bank, learnerId: 'learner4', enrollmentId: 'e2', lessonId: 'kansas', profile: 'upper', seed: 'two' });
    expect(lower.items).toHaveLength(6);
    expect(lower.items.every((entry) => [3, 4].includes(entry.options.length))).toBe(true);
    expect(upper.items).toHaveLength(10);
    expect(upper.items.every((entry) => entry.options.length === 5)).toBe(true);
    expect(upper.items.filter((entry) => entry.type === 'multi_select')).toHaveLength(2);
    expect(upper.items.filter((entry) => entry.type === 'multi_select').every((entry) => entry.options.filter((option) => option.correct).length === 2)).toBe(true);
  });

  it('reissues only the missed ids, freshly shuffled', () => {
    const issued = issueWorksheet({ bank, learnerId: 'learner3', enrollmentId: 'e1', lessonId: 'kansas', profile: 'lower', seed: 'one' });
    // The missed set as a caller derives it — every item but the first.
    const missedItemIds = issued.items.slice(1).map((entry) => entry.itemId);
    expect(missedItemIds).toHaveLength(5);
    const retry = issueWorksheet({ bank, learnerId: 'learner3', enrollmentId: 'e1', lessonId: 'kansas', profile: 'lower', seed: 'retry', itemIds: missedItemIds });
    expect(new Set(retry.itemIds)).toEqual(new Set(missedItemIds));
    expect(retry.items[0].options).not.toEqual(issued.items.find((entry) => entry.itemId === retry.items[0].itemId)?.options);
  });

  it('creates a publishable immutable enrollment-bound OMR instance', () => {
    const instance = createWorksheetInstance({
      id: 'civilization/atlas/ws-one', sessionId: 'ses-one', bank,
      learnerId: 'learner3', enrollmentId: 'enr-learner3-atlas', lessonId: 'kansas',
      profile: 'lower', seed: 'one', issuedAt: '2026-08-13T00:00:00.000Z',
    });
    expect(Object.isFrozen(instance)).toBe(true);
    expect(instance).toMatchObject({ learnerId: 'learner3', enrollmentId: 'enr-learner3-atlas' });
    const result = publishDocument(worksheetInstanceDocument(instance, { title: 'Kansas' }));
    expect(result.errors).toBeUndefined();
    expect(result.published.blocks[0]).toMatchObject({ type: 'inset', layout: 'lesson_card' });
    const questions = result.published.blocks.filter((block) => block.type === 'question');
    expect(questions).toHaveLength(6);
    expect(questions.every((block) => block.omr && block.blocks.at(-1).layout === 'compact')).toBe(true);
    expect(result.bank.items).toHaveLength(6);
  });

  it('never emits a book-only or placeholder reading instruction', () => {
    const instance = createWorksheetInstance({
      id: 'ws-reading', sessionId: 'session-reading', bank, learnerId: 'learner3', enrollmentId: 'enr',
      lessonId: 'kansas', profile: 'lower', seed: 'one', issuedAt: '2026-08-13T00:00:00.000Z',
    });
    expect(worksheetInstanceDocument(instance, { title: 'Kansas', sourceTitle: 'Atlas', printedPages: [] }).header.reading)
      .toBeUndefined();
    const composed = composedWorksheetDocument({
      id: 'no-placeholder',
      sections: [{ instance, subjectId: 'science', courseId: 'matter', title: 'Atoms' }],
    });
    expect(composed.source.blocks[0].reading).toBeUndefined();
    expect(JSON.stringify(composed.source)).not.toContain('assigned section');
  });

  it('prints a lesson-companion panel code in the semantic lesson card', () => {
    const instance = createWorksheetInstance({
      id: 'ws-companion', sessionId: 'session-companion', bank, learnerId: 'learner3', enrollmentId: 'enr',
      lessonId: 'psalms', profile: 'lower', seed: 'one', issuedAt: '2026-08-13T00:00:00.000Z',
    });
    const result = publishDocument(worksheetInstanceDocument(instance, { title: 'Psalms', companionCode: '123456' }));
    expect(result.errors).toBeUndefined();
    expect(result.published.blocks[0].companionCode).toBe('123456');
  });

  it('uses an authored printed range on a composed card without an empty Read line', () => {
    const instance = createWorksheetInstance({
      id: 'ws-page-range', sessionId: 'session-range', bank, learnerId: 'learner3', enrollmentId: 'enr',
      lessonId: 'range', profile: 'lower', seed: 'one', issuedAt: '2026-08-13T00:00:00.000Z',
    });
    const composed = composedWorksheetDocument({
      id: 'pages', sections: [{ instance, title: 'Ranges', printedPages: ['8-10'] }],
    });
    expect(composed.source.blocks[0].reading).toBe('Read: pages 8–10');
  });

  it('pairs a composed worksheet page range with the printed reading source', () => {
    const instance = createWorksheetInstance({
      id: 'ws-source-range', sessionId: 'session-source', bank, learnerId: 'learner3', enrollmentId: 'enr',
      lessonId: 'psalms', profile: 'lower', seed: 'one', issuedAt: '2026-08-13T00:00:00.000Z',
    });
    const composed = composedWorksheetDocument({
      id: 'source-pages', sections: [{
        instance, title: 'Psalms', sourceTitle: 'NIrV Adventure Bible', printedPages: [681, 682],
        citation: 'Weekday 2 of the assigned week.',
      }],
    });
    expect(composed.source.blocks[0]).toMatchObject({
      reading: 'Read: NIrV Adventure Bible, pages 681–682.',
      citation: 'Weekday 2 of the assigned week.',
    });
  });

  it('composes immutable lesson instances with scoped item identities and attribution', () => {
    const first = createWorksheetInstance({
      id: 'ws-first', sessionId: 'session-first', bank, learnerId: 'learner3', enrollmentId: 'enr',
      lessonId: 'first', profile: 'lower', seed: 'one', issuedAt: '2026-08-13T00:00:00.000Z',
    });
    const second = createWorksheetInstance({
      id: 'ws-second', sessionId: 'session-second', bank, learnerId: 'learner3', enrollmentId: 'enr',
      lessonId: 'second', profile: 'lower', seed: 'two', issuedAt: '2026-08-13T00:00:00.000Z',
    });
    const composed = composedWorksheetDocument({
      id: 'packet-today', seed: 42,
      sections: [
        { id: 'a', instance: first, subject: 'Science', subjectId: 'science', course: 'Matter', courseId: 'matter', title: 'First' },
        { id: 'b', instance: second, subject: 'Science', subjectId: 'science', course: 'Matter', courseId: 'matter', title: 'Second' },
      ],
    });
    const published = publishDocument(composed.source);
    expect(published.errors).toBeUndefined();
    expect(published.bank.items).toHaveLength(12);
    expect(published.bank.items.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      composed.sections[0].itemIds[0], composed.sections[1].itemIds[0],
    ]));
    expect(composed.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'a', sessionId: 'session-first', worksheetInstanceId: 'ws-first' }),
      expect.objectContaining({ id: 'b', sessionId: 'session-second', worksheetInstanceId: 'ws-second' }),
    ]));
  });
});
