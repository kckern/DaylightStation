// tests/isolated/domain/school/documents/companionGate.test.mjs
//
// The gate row on paper (Task 8).
//
// A required companion's worksheet carries one extra printed row before its
// first question: five positions, A–E, where the child fills in the finish
// code the read-along released. This suite pins the DOCUMENT half of that —
// the block the worksheet source grows, the row the allocator plans for it,
// and the two places it must NOT show up.
//
// The gate is deliberately not a bank item. It is never validated by
// `questionBankValidation` (whose two-answer minimum for `multi_select` would
// make the single-letter code `['A']` illegal) and it is never one of the
// items a paper score is out of, so `questionItemIds` — the DENOMINATOR of a
// score, and the list `SubmitPaperWork` walks — must not contain it.
import { describe, it, expect } from 'vitest';
import {
  worksheetInstanceDocument, createWorksheetInstance,
} from '#domains/school/questionBankV2.mjs';
import { COMPANION_GATE_ITEM_ID } from '#domains/school/companionCode.mjs';
import { questionItemIds } from '#domains/school/documents/documentValidation.mjs';
import { planRows, ROW_MAPPABLE_TYPES } from '#domains/school/documents/allocation.mjs';
import { validateDocumentSource } from '#domains/school/documents/documentSource.mjs';

const bank = {
  schema: 'school.question-bank/v2',
  id: 'bank-1',
  title: 'Bank 1',
  items: Array.from({ length: 3 }, (_, index) => ({
    id: `q${index + 1}`,
    type: 'multiple_choice',
    prompt: `Question ${index + 1}?`,
    answer: 'Correct',
    decoys: ['One', 'Two', 'Three', 'Four'],
    levels: ['lower', 'upper'],
  })),
};

const instance = () => createWorksheetInstance({
  id: 'scripture/cfm/ws-1',
  sessionId: 'ses-1',
  bank,
  learnerId: 'kid1',
  enrollmentId: 'enr-1',
  lessonId: 'lesson-1',
  profile: 'lower-3',
  seed: 'ses-1:0',
  issuedAt: '2026-08-27T17:00:00.000Z',
});

const gateBlockOf = (document) => document.blocks.find((block) => block.companionGate === true) ?? null;

describe('the gate row is the worksheet document\'s first question row', () => {
  it('prints five positions, A–E, for a required companion\'s finish code', () => {
    const document = worksheetInstanceDocument(instance(), { finishCode: ['A', 'C', 'E'] });
    const gate = gateBlockOf(document);

    expect(gate).not.toBeNull();
    expect(gate.itemId).toBe(COMPANION_GATE_ITEM_ID);
    expect(gate.choices).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(gate.omr).toBe(true);
    // The gate is not worth points; the sheet is still out of its own questions.
    expect(gate.points).toBe(0);
    // The row is set-valued, but nothing says so on the block: the SET-ness is
    // the gate item's own `companion_code` type, resolved once through the
    // bank, so the paper and the decoder cannot drift apart.
    const response = gate.blocks.find((child) => child.type === 'omr_response');
    expect(response).toMatchObject({ itemId: COMPANION_GATE_ITEM_ID, choices: 5 });
  });

  it('carries the finish code itself, so the paper and the record cannot disagree', () => {
    const document = worksheetInstanceDocument(instance(), { finishCode: ['A', 'C', 'E'] });
    expect(gateBlockOf(document).code).toEqual(['A', 'C', 'E']);
  });

  it('places the gate BEFORE the first question', () => {
    const document = worksheetInstanceDocument(instance(), { finishCode: ['B'] });
    const questionBlocks = document.blocks.filter((block) => block.type === 'question');
    expect(questionBlocks[0].companionGate).toBe(true);
    expect(questionBlocks.slice(1).every((block) => block.companionGate === undefined)).toBe(true);
  });

  it('is still a legal document source', () => {
    const document = worksheetInstanceDocument(instance(), { finishCode: ['A', 'C', 'E'] });
    expect(validateDocumentSource(document).errors).toEqual([]);
  });
});

describe('an optional companion prints no gate row at all', () => {
  it.each([
    ['no finish code option', undefined],
    ['an explicit null', null],
  ])('%s leaves every block exactly as it was', (_label, finishCode) => {
    const withGate = worksheetInstanceDocument(instance(), { finishCode: ['A'] });
    const without = worksheetInstanceDocument(instance(), { finishCode });

    expect(gateBlockOf(without)).toBeNull();
    expect(without.blocks.filter((block) => block.type === 'question')).toHaveLength(3);
    expect(withGate.blocks).toHaveLength(without.blocks.length + 1);
  });
});

describe('the gate is not one of the questions a score is out of', () => {
  it('is excluded from questionItemIds', () => {
    const document = worksheetInstanceDocument(instance(), { finishCode: ['A', 'C', 'E'] });
    const ids = questionItemIds(document);

    expect(ids).not.toContain(COMPANION_GATE_ITEM_ID);
    expect([...ids].sort()).toEqual(['q1', 'q2', 'q3']);
  });
});

describe('the allocator gives the gate a real row on a real card', () => {
  it('treats companion_code as row-mappable', () => {
    expect(ROW_MAPPABLE_TYPES).toContain('companion_code');
  });

  it('plans the gate as the first row, ahead of every question', () => {
    const document = worksheetInstanceDocument(instance(), { finishCode: ['A', 'C', 'E'] });
    const planBank = {
      id: 'derived',
      items: [
        {
          id: COMPANION_GATE_ITEM_ID, type: 'companion_code', choices: ['A', 'B', 'C', 'D', 'E'], code: ['A', 'C', 'E'],
        },
        ...document.blocks
          .filter((block) => block.type === 'question' && !block.companionGate)
          .map((block) => ({ id: block.itemId, type: 'multiple_choice', choices: block.choices, answer: block.answer })),
      ],
    };

    const plan = planRows({ document, bank: planBank, startRow: 7 });

    expect(plan.errors).toBeUndefined();
    expect(plan.rows[0]).toMatchObject({ row: 7, itemId: COMPANION_GATE_ITEM_ID, itemType: 'companion_code', choiceCount: 5 });
    expect(plan.rows).toHaveLength(4);
  });
});
