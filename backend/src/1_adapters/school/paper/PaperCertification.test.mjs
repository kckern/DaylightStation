// backend/src/1_adapters/school/paper/PaperCertification.test.mjs
import { describe, expect, it } from 'vitest';
import { PaperCertification } from './PaperCertification.mjs';
import { runCertificationPortContract } from '../../../../../tests/_lib/school/certificationContract.mjs';

export const paperProfile = {
  surfaceId: 'paper-letter-mono', family: 'paper', liveness: 'static',
  capabilities: [
    'reader@1', 'examples@1', 'quiz@1', 'problems@1', 'flashcards@1',
    'image@1', 'math@1', 'table-layout@1', 'scan-action@1',
    'response.choice@1', 'response.asset-choice@1', 'return.scan@1',
  ],
  limits: { omrChannels: 12, maxItemsPerSheet: 25, maxPagesPerDocument: 20 },
};

export const choiceBank = { id: 'b1', items: [
  { id: 'q1', type: 'multiple_choice', prompt: 'p', choices: ['a', 'b', 'c'], answer: 'a' },
] };
const textBank = { id: 'b2', items: [
  { id: 'q1', type: 'short_answer', prompt: 'p', answer: 'x' },
] };

export const renderableBundle = { lesson: { modules: [
  { moduleId: 'notes', type: 'lecture_notes', document: { blocks: [{ blockId: 'p', type: 'prose', text: 't' }] } },
  { moduleId: 'check', type: 'quiz', bank: choiceBank },
] } };
const incompatibleBundle = { lesson: { modules: [
  { moduleId: 'probe', type: 'learning_probe', bank: choiceBank },
] } };
const unknownTypeBundle = { lesson: { modules: [
  { moduleId: 'mystery', type: 'holo_projection' },
] } };

runCertificationPortContract({
  name: 'paper', makePort: () => new PaperCertification(),
  profile: paperProfile, renderableBundle, incompatibleBundle, unknownTypeBundle,
});

describe('PaperCertification specifics (spec §6.3)', () => {
  const port = new PaperCertification();

  it('disqualifies a text-answer quiz with an item-level capability reason', () => {
    const result = port.certify({ lesson: { modules: [{ moduleId: 'q', type: 'quiz', bank: textBank }] } }, paperProfile);
    expect(result.modules[0].verdict).toBe('incompatible');
    expect(result.modules[0].reasons.join()).toMatch(/response\.text@1/);
  });

  it('disqualifies a choice item exceeding the OMR channel count, naming the item', () => {
    const wide = { id: 'b3', items: [{ id: 'q9', type: 'multiple_choice', prompt: 'p', choices: Array.from({ length: 13 }, (_, i) => `c${i}`), answer: 'c0' }] };
    const bank = port.certifyBank(wide, paperProfile);
    expect(bank.verdict).toBe('incompatible');
    expect(bank.reasons.join()).toMatch(/q9/);
    expect(bank.reasons.join()).toMatch(/12/);
  });

  it('certifies a conforming choice bank render', () => {
    expect(port.certifyBank(choiceBank, paperProfile).verdict).toBe('render');
  });

  it('rejects interactive module types with a stated reason', () => {
    const result = port.certify(incompatibleBundle, paperProfile);
    expect(result.modules[0].reasons.join()).toMatch(/do not render on paper/);
  });

  it('enforces sheet and page budgets', () => {
    const bigBank = { id: 'b4', items: Array.from({ length: 26 }, (_, i) => ({ id: `q${i}`, type: 'multiple_choice', prompt: 'p', choices: ['a', 'b'], answer: 'a' })) };
    expect(port.certifyBank(bigBank, paperProfile).reasons.join()).toMatch(/25/);
    const longDoc = { lesson: { modules: [{ moduleId: 'n', type: 'lecture_notes', document: { blocks: Array.from({ length: 12 * 21 }, (_, i) => ({ blockId: `b${i}`, type: 'prose', text: 't' })) } }] } };
    expect(port.certify(longDoc, paperProfile).modules[0].reasons.join()).toMatch(/20/);
  });
});
