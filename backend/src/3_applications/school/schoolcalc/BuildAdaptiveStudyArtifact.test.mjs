import { describe, expect, it, vi } from 'vitest';
import { Ti86SchoolCalcCodec, decodeTi86Envelope } from '#adapters/schoolcalc/ti86/index.mjs';
import { curateAdaptiveStudy } from '#domains/school/schoolcalc/index.mjs';
import { BuildAdaptiveStudyArtifact } from './BuildAdaptiveStudyArtifact.mjs';

describe('BuildAdaptiveStudyArtifact', () => {
  it('compiles exact authored card/quiz order and persists immutable bytes', async () => {
    const unit = {
      unitId: 'facts', title: 'Facts', subject: 'math', bank: 'facts-bank', passing: { percent: 75 },
      schoolcalc: { mode: 'adaptive_flashcards', study: { cardCount: 3, maxExposuresPerCard: 4 }, quiz: { itemCount: 2 } },
    };
    const bank = {
      id: 'facts-bank', title: 'Facts bank',
      items: Array.from({ length: 4 }, (_, index) => ({
        id: `q${index + 1}`, type: 'multiple_choice', prompt: `${index + 1}+1?`,
        choices: [`${index + 1}`, `${index + 2}`], answer: `${index + 2}`,
      })),
    };
    const artifacts = { putArtifact: vi.fn(async (value) => value) };
    const builder = new BuildAdaptiveStudyArtifact({ codec: new Ti86SchoolCalcCodec(), artifacts });
    const result = await builder.execute({ unit, bank, curation: curateAdaptiveStudy({ unit, bank }) });
    expect(result).toMatchObject({ platformId: 'ti86', variableName: expect.stringMatching(/^DP[A-Z2-7]{6}$/) });
    const decoded = decodeTi86Envelope(result.bytes, 'SCP1');
    expect(decoded.lesson.modules[0].bank.items.map(({ id }) => id)).toEqual(['q1', 'q2', 'q3']);
    expect(decoded.lesson.modules[1].bank.items.map(({ id }) => id)).toEqual(['q1', 'q2']);
    expect(artifacts.putArtifact).toHaveBeenCalledTimes(1);
  });
});
