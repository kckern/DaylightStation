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

  it('freezes a remediation reference without printing it beside the question', () => {
    const referenced = {
      ...bank,
      items: bank.items.map((entry) => ({ ...entry,
        reviewReference: { title: 'Beast Academy 2A Guide', pages: [24, 25], section: 'Place Value' },
      })),
    };
    const issued = issueWorksheet({
      bank: referenced, learnerId: 'learner', enrollmentId: 'enrollment',
      lessonId: 'place-value', profile: 'lower', seed: 'reference',
    });
    expect(issued.items[0].reviewReference).toEqual({
      title: 'Beast Academy 2A Guide', pages: [24, 25], section: 'Place Value',
    });
    const document = worksheetInstanceDocument(createWorksheetInstance({
      id: 'ws-reference', sessionId: 'ses-reference', bank: referenced,
      learnerId: 'learner', enrollmentId: 'enrollment', lessonId: 'place-value',
      profile: 'lower', seed: 'reference', issuedAt: '2026-08-30T00:00:00.000Z', itemIds: ['q0'],
    }));
    const question = document.blocks.find((block) => block.type === 'question');
    expect(question.blocks.map((block) => block.type)).toEqual(['rich_text', 'omr_response']);
  });

  it('freezes an asset stimulus into both solo and composed worksheet questions', () => {
    const illustrated = {
      ...bank,
      items: bank.items.map((entry, index) => (index === 0 ? {
        ...entry,
        stimulus: { type: 'asset', ref: 'school/math/number-line-12', alt: 'A number line ending at twelve.' },
      } : entry)),
    };
    expect(validateQuestionBank(illustrated).ok).toBe(true);
    const instance = createWorksheetInstance({
      id: 'ws-illustrated', sessionId: 'ses-illustrated', bank: illustrated,
      learnerId: 'learner3', enrollmentId: 'enr', lessonId: 'number-lines',
      profile: 'lower', seed: 'q0', issuedAt: '2026-08-30T00:00:00.000Z', itemIds: ['q0'],
    });
    expect(instance.questions[0].stimulus).toEqual({
      type: 'asset', ref: 'school/math/number-line-12', alt: 'A number line ending at twelve.',
    });
    const soloQuestion = worksheetInstanceDocument(instance).blocks.find((block) => block.type === 'question');
    expect(soloQuestion.blocks.map((block) => block.type)).toEqual(['rich_text', 'asset', 'omr_response']);
    const composedQuestion = composedWorksheetDocument({
      id: 'illustrated-packet', sections: [{ instance, title: 'Number Lines' }],
    }).source.blocks.find((block) => block.type === 'question');
    expect(composedQuestion.blocks[1]).toMatchObject({ type: 'asset', ref: 'school/math/number-line-12' });
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

  it('uses a profile prompt override without duplicating the assessed item or its options', () => {
    const shared = item('scaffolded');
    shared.prompt = 'What helps the fishing cat swim?';
    shared.prompt_by_profile = { lower: 'Look on p. 132. What helps the fishing cat swim?' };
    const scaffoldedBank = {
      ...bank,
      items: Array.from({ length: 12 }, (_, index) => ({ ...shared, id: `scaffolded-${index}` })),
    };
    expect(validateQuestionBank(scaffoldedBank).ok).toBe(true);
    const lower = issueWorksheet({ bank: scaffoldedBank, learnerId: 'lower', enrollmentId: 'e', lessonId: 'cats', profile: 'lower', seed: 'one' });
    const upper = issueWorksheet({ bank: scaffoldedBank, learnerId: 'upper', enrollmentId: 'e', lessonId: 'cats', profile: 'upper-5', seed: 'two' });
    expect(lower.items.every((entry) => entry.prompt.startsWith('Look on p. 132.'))).toBe(true);
    expect(upper.items.every((entry) => entry.prompt === 'What helps the fishing cat swim?')).toBe(true);
    expect(lower.items[0].options.map((option) => option.label).sort()).toEqual(expect.arrayContaining(['Option 1']));
  });

  it('composes profile prefixes and suffixes around a shared or replaced prompt', () => {
    const shared = item('affixed');
    shared.prompt = 'What helps the fishing cat swim?';
    shared.prompt_by_profile = { upper: 'Which adaptation helps the fishing cat swim?' };
    shared.prompt_prefix_by_profile = { lower: 'Look on p. 132.' };
    shared.prompt_suffix_by_profile = { lower: 'Read the caption carefully.' };
    const affixedBank = { ...bank, items: Array.from({ length: 12 }, (_, index) => ({ ...shared, id: `affixed-${index}` })) };
    const lower = issueWorksheet({ bank: affixedBank, learnerId: 'lower', enrollmentId: 'e', lessonId: 'cats', profile: 'lower', seed: 'one' });
    const upper = issueWorksheet({ bank: affixedBank, learnerId: 'upper', enrollmentId: 'e', lessonId: 'cats', profile: 'upper-5', seed: 'two' });
    expect(lower.items.every((entry) => entry.prompt === 'Look on p. 132. What helps the fishing cat swim? Read the caption carefully.')).toBe(true);
    expect(upper.items.every((entry) => entry.prompt === 'Which adaptation helps the fishing cat swim?')).toBe(true);
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

  it('freezes one solved lesson example and publishes it ahead of the assessed questions', () => {
    const instance = createWorksheetInstance({
      id: 'math/place-value/ws-example', sessionId: 'ses-example', bank,
      learnerId: 'learner3', enrollmentId: 'enr-math', lessonId: 'place-value',
      profile: 'lower', seed: 'example', issuedAt: '2026-08-31T00:00:00.000Z',
      worksheet: { examples: [{
        id: 'digit-value', title: 'Worked example',
        question: {
          type: 'multiple_choice', prompt: 'In 364, what value does the digit 6 represent?',
          choices: ['6', '60', '600'],
        },
        solution: { steps: ['The 6 is in the tens place.', 'Six tens equal 60.'], answer: '60' },
      }] },
    });
    expect(instance.workedExamples).toEqual([expect.objectContaining({
      id: 'digit-value', solution: expect.objectContaining({ answer: '60' }),
    })]);
    expect(Object.isFrozen(instance.workedExamples[0])).toBe(true);

    const source = worksheetInstanceDocument(instance, { title: 'Place Value' });
    expect(source.blocks[1]).toMatchObject({
      type: 'inset', layout: 'worked_example', keepWithNext: true,
      questionPrompt: 'In 364, what value does the digit 6 represent?',
      choiceLabels: ['6', '60', '600'], correctChoiceIndex: 1, correctText: '60',
    });
    expect(source.blocks[2].type).toBe('question');
    const published = publishDocument(source);
    expect(published.errors).toBeUndefined();
    expect(published.published.blocks[1]).toMatchObject({ layout: 'worked_example', correctText: '60' });
  });

  it('selects an example that applies to the concepts on the frozen questions', () => {
    const conceptual = {
      ...bank,
      items: bank.items.map((entry) => ({ ...entry, concepts: ['place-value'] })),
    };
    const instance = createWorksheetInstance({
      id: 'math/place-value/ws-concept', sessionId: 'ses-concept', bank: conceptual,
      learnerId: 'learner3', enrollmentId: 'enr-math', lessonId: 'place-value',
      profile: 'lower', seed: 'concept', issuedAt: '2026-08-31T00:00:00.000Z',
      worksheet: { examples: [
        { id: 'fractions', title: 'Fraction example', appliesTo: { concepts: ['fractions'] },
          question: { type: 'multiple_choice', prompt: 'Which fraction?', choices: ['1/2', '1/3'] },
          solution: { steps: ['Count the parts.'], answer: '1/2' } },
        { id: 'place-value', title: 'Place-value example', appliesTo: { concepts: ['place-value'] },
          question: { type: 'multiple_choice', prompt: 'What value?', choices: ['6', '60'] },
          solution: { steps: ['Count tens.'], answer: '60' } },
      ] },
    });
    expect(instance.workedExamples.map((example) => example.id)).toEqual(['place-value']);
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
