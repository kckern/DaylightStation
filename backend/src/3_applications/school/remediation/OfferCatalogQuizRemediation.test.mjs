import { describe, expect, it, vi } from 'vitest';
import { OfferCatalogQuizRemediation } from './OfferCatalogQuizRemediation.mjs';
import { bankContentRev } from '#domains/school/bankRev.mjs';

const bank = {
  id: 'rate-check', title: 'Rate check', audience: 'assigned',
  concepts: [{ conceptId: 'unit-rate', title: 'Unit rate' }],
  items: [{
    id: 'q1', type: 'multiple_choice', prompt: '12 miles in 3 hours?',
    choices: ['3', '4'], answer: '4', concepts: ['unit-rate'],
  }],
};
const learning = {
  catalogId: 'core', subjectId: 'math', courseId: 'rates',
  unitId: 'intro', lessonId: 'unit-rates', moduleId: 'gate',
};
const module = {
  moduleId: 'gate', type: 'quiz', bank,
  remediation: { enabled: true, launch: 'offer' },
};

function harness({ resolvedModule = module } = {}) {
  const grader = { completedQuizAssessment: vi.fn(() => ({
    sessionId: 'ses-1', learnerId: 'kid1', bankRev: bankContentRev(bank), bank, learning,
    responses: [{ itemId: 'q1', given: '3' }],
  })) };
  const catalog = { lesson: vi.fn(async () => ({
    context: {}, lesson: { lessonId: 'unit-rates', title: 'Unit rates', modules: [resolvedModule] },
  })) };
  const remediationOffers = { execute: vi.fn(async (input) => ({
    status: 'offered', offer: { sessionId: 'REM_1' }, input,
  })) };
  return {
    grader, catalog, remediationOffers,
    useCase: new OfferCatalogQuizRemediation({ catalog, grader, remediationOffers }),
  };
}

describe('OfferCatalogQuizRemediation', () => {
  it('re-resolves the exact lesson and mints an idempotent web tutor offer from authoritative answers', async () => {
    const f = harness();
    await expect(f.useCase.execute({ sessionId: 'ses-1', learnerId: 'kid1' }))
      .resolves.toMatchObject({ status: 'offered', offer: { sessionId: 'REM_1' } });
    expect(f.grader.completedQuizAssessment).toHaveBeenCalledWith({ sessionId: 'ses-1', learnerId: 'kid1' });
    expect(f.catalog.lesson).toHaveBeenCalledWith({
      learnerId: 'kid1', catalogId: 'core', subjectId: 'math', courseId: 'rates',
      unitId: 'intro', lessonId: 'unit-rates',
    });
    expect(f.remediationOffers.execute).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: 'kid1', bank,
      source: expect.objectContaining({ surface: 'web', externalId: 'ses-1', lessonId: 'unit-rates', moduleId: 'gate' }),
      responses: [{ itemId: 'q1', given: '3' }],
    }));
  });

  it('refuses to attach old answers after the catalog quiz bank changes', async () => {
    const changedBank = {
      ...bank,
      items: bank.items.map((item) => ({ ...item, prompt: 'A changed question?' })),
    };
    const f = harness({ resolvedModule: { ...module, bank: changedBank } });
    await expect(f.useCase.execute({ sessionId: 'ses-1', learnerId: 'kid1' }))
      .rejects.toThrow(/changed after this session/i);
    expect(f.remediationOffers.execute).not.toHaveBeenCalled();
  });
});
