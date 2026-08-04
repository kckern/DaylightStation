import { describe, expect, it } from 'vitest';
import { TRACKED_MODULE_TYPES, deriveModuleDemands, deriveBankDemands } from './demands.mjs';

describe('demand derivation (spec §3.3)', () => {
  it('derives module + item demands for a tracked quiz', () => {
    const { capabilities, tracked } = deriveModuleDemands({
      module: { moduleId: 'check', type: 'quiz', bankId: 'b1' },
      bank: { items: [
        { id: 'q1', type: 'multiple_choice', prompt: 'p', choices: ['a', 'b'], answer: 'a' },
        { id: 'q2', type: 'short_answer', prompt: 'p', answer: 'x' },
      ] },
    });
    expect(capabilities).toContain('quiz@1');
    expect(capabilities).toContain('response.choice@1');
    expect(capabilities).toContain('response.text@1');
    expect(tracked).toBe(true);
  });

  it('derives block demands for lecture notes and marks them untracked', () => {
    const { capabilities, tracked } = deriveModuleDemands({
      module: { moduleId: 'notes', type: 'lecture_notes', documentId: 'd1' },
      document: { blocks: [
        { blockId: 'f', type: 'formula', text: 'x', latex: 'x' },
        { blockId: 't', type: 'table', columns: ['a'], rows: [['1']] },
        { blockId: 'img', type: 'asset', assetId: 'pic', alt: 'a picture' },
        { blockId: 'qr', type: 'scan_action', actionId: 'act', label: 'Go' },
      ] },
    });
    expect(capabilities).toEqual(expect.arrayContaining(['reader@1', 'math@1', 'table-layout@1', 'image@1', 'scan-action@1']));
    expect(tracked).toBe(false);
  });

  it('adds image@1 for image-bearing items and dedupes', () => {
    const { capabilities } = deriveBankDemands({ items: [
      { id: 'q1', type: 'region_click', prompt: 'p', asset: 'map', answer: 'here' },
      { id: 'q2', type: 'asset_choice', prompt: 'p', choices: [{ image: { assetId: 'x' } }], answer: 'x' },
    ] });
    expect(capabilities).toContain('response.region@1');
    expect(capabilities).toContain('response.asset-choice@1');
    expect(capabilities.filter((c) => c === 'image@1')).toHaveLength(1);
  });

  it('falls back to module.bank when no resolved bank is passed', () => {
    const { capabilities } = deriveModuleDemands({
      module: { moduleId: 'm', type: 'quiz', bank: { items: [
        { id: 'q1', type: 'multiple_choice', prompt: 'p', choices: ['a'], answer: 'a' },
      ] } },
    });
    expect(capabilities).toContain('response.choice@1');
  });

  it('falls back to module.document when no resolved document is passed (ledger T3)', () => {
    const { capabilities } = deriveModuleDemands({
      module: { moduleId: 'notes', type: 'lecture_notes', document: { blocks: [
        { blockId: 'f', type: 'formula', text: 'x', latex: 'x' },
      ] } },
    });
    expect(capabilities).toContain('math@1');
  });

  it('flags a genuinely unknown module type instead of dropping its demands (F2)', () => {
    const { capabilities, unknownType } = deriveModuleDemands({
      module: { moduleId: 'mystery', type: 'holo_projection' },
    });
    expect(capabilities).toEqual([]);
    expect(unknownType).toBe('holo_projection');
  });

  it('flags an activity module with an unregistered mechanic (F2)', () => {
    const { unknownType } = deriveModuleDemands({
      module: { moduleId: 'act', type: 'activity', mechanic: 'time_travel', config: {} },
    });
    expect(unknownType).toBe('activity');
  });

  it('does not flag unknownType for a recognized module type', () => {
    const { unknownType } = deriveModuleDemands({
      module: { moduleId: 'notes', type: 'lecture_notes', documentId: 'd1' },
    });
    expect(unknownType).toBeUndefined();
  });

  it('tracks exactly the spec §3.3 tracked types', () => {
    expect([...TRACKED_MODULE_TYPES].sort()).toEqual(
      ['activity', 'flashcards', 'learning_probe', 'problems', 'quiz'],
    );
  });
});
