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

  it('compiles normalized card geometry into compact immutable LCD commands', async () => {
    const unit = {
      unitId: 'geometry', title: 'Geometry', subject: 'math', bank: 'geometry-bank',
      schoolcalc: { mode: 'adaptive_flashcards', study: { cardCount: 2, maxExposuresPerCard: 4 }, quiz: { itemCount: 1 } },
    };
    const items = [0, 1].map((index) => ({
      id: `g${index + 1}`, type: 'multiple_choice', prompt: 'Name this diagonal.',
      choices: ['radius', 'diameter'], answer: 'diameter',
    }));
    items[0].schoolcalc = { promptGraphic: { primitives: [
      { type: 'line', x1: 0, y1: 0, x2: 100, y2: 100 },
      { type: 'label', x: 50, y: 50, text: 'd' },
    ] } };
    const bank = { id: 'geometry-bank', title: 'Geometry bank', items };
    const builder = new BuildAdaptiveStudyArtifact({
      codec: new Ti86SchoolCalcCodec(), artifacts: { putArtifact: async (value) => value },
    });
    const result = await builder.execute({ unit, bank, curation: curateAdaptiveStudy({ unit, bank }) });
    const decoded = decodeTi86Envelope(result.bytes, 'SCP1');
    const card = decoded.lesson.modules[0].bank.items[0];
    expect(result.interpretation.bundle.capabilities).toContain('graphics.vector@1');
    expect([...card.promptGraphic]).toEqual([1, 4, 11, 123, 38, 2, 64, 25, 1, 100, 0]);
    expect(card.promptPages).toEqual(['Name this diagonal.']);
  });

  it('rejects graphics whose expanded command stream exceeds its exact budget', async () => {
    const unit = {
      unitId: 'circles', title: 'Circles', subject: 'math', bank: 'circle-bank',
      schoolcalc: { mode: 'adaptive_flashcards', study: { cardCount: 1, maxExposuresPerCard: 4 }, quiz: { itemCount: 1 } },
    };
    const item = {
      id: 'c1', type: 'multiple_choice', prompt: 'Concentric circles?', choices: ['yes', 'no'], answer: 'yes',
      schoolcalc: { promptGraphic: { primitives: [10, 20, 30].map((radius) => (
        { type: 'circle', cx: 50, cy: 50, radius }
      )) } },
    };
    const bank = { id: 'circle-bank', title: 'Circle bank', items: [item] };
    const builder = new BuildAdaptiveStudyArtifact({
      codec: new Ti86SchoolCalcCodec(), artifacts: { putArtifact: async (value) => value },
    });
    await expect(builder.execute({ unit, bank, curation: curateAdaptiveStudy({ unit, bank }) }))
      .rejects.toThrow(/more than 160 bytes/);
  });
});
