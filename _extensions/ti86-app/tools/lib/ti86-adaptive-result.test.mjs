import { describe, expect, it } from 'vitest';
import {
  encodeTi86ResultQueue,
  encodeTi86ResultRecord,
} from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import {
  formatTi86AdaptiveResultInspection,
  inspectTi86AdaptiveResultQueue,
} from './ti86-adaptive-result.mjs';

function adaptiveRecord({ sequence = 7, sessionCode = '012345' } = {}) {
  const quizChoices = [1, 3, 5];
  return encodeTi86ResultRecord({
    schema: 'school.calc.result/v1', kind: 'responses',
    deviceId: '86A001', sequence, learnerKey: 4,
    artifactId: 'sc:ti86:ABC234DEFG', moduleIndex: 0,
    responses: quizChoices.map((given, itemIndex) => ({ itemIndex, given })),
    localScore: { correct: 2, total: 3, percent: 67, basis: 'embedded_answer_key' },
    adaptiveStudy: {
      sessionCode,
      attemptCount: 2,
      cards: [
        { rating: 'again', exposureCount: 4 },
        { rating: 'know', exposureCount: 1 },
        { rating: 'hard', exposureCount: 4 },
      ],
      quizChoices,
    },
  });
}

describe('TI-86 adaptive result queue inspection', () => {
  it('decodes semantic telemetry from the newest exact DSQ record', () => {
    const queue = encodeTi86ResultQueue({
      deviceId: '86A001',
      records: [adaptiveRecord({ sequence: 7, sessionCode: '000007' }), adaptiveRecord({ sequence: 8 })],
    });
    const inspected = inspectTi86AdaptiveResultQueue(queue);
    expect(inspected).toMatchObject({
      index: 1, recordCount: 2, sessionCode: '012345', attemptCount: 2, sequence: 8,
      cards: [
        { index: 0, rating: 'again', exposureCount: 4 },
        { index: 1, rating: 'know', exposureCount: 1 },
        { index: 2, rating: 'hard', exposureCount: 4 },
      ],
      quizChoices: ['A', 'C', 'E'],
      score: { correct: 2, total: 3, percent: 67 },
    });
    expect(formatTi86AdaptiveResultInspection(inspected)).toContain(
      'sessionCode=012345 attemptCount=2 cards=0:AGAIN/4,1:KNOW/1,2:HARD/4 quizChoices=A,C,E score=2/3',
    );
  });

  it('selects an explicit retained result and rejects non-adaptive records', () => {
    const ordinary = encodeTi86ResultRecord({
      schema: 'school.calc.result/v1', kind: 'responses',
      deviceId: '86A001', sequence: 9, learnerKey: 4,
      artifactId: 'sc:ti86:ABC234DEFG', moduleIndex: 0,
      responses: [{ itemIndex: 0, given: 1 }],
      localScore: { correct: 1, total: 1, percent: 100 },
    });
    const queue = encodeTi86ResultQueue({ deviceId: '86A001', records: [adaptiveRecord(), ordinary] });
    expect(inspectTi86AdaptiveResultQueue(queue, { index: 0 }).sessionCode).toBe('012345');
    expect(() => inspectTi86AdaptiveResultQueue(queue)).toThrow(/not an adaptive study result/);
    expect(() => inspectTi86AdaptiveResultQueue(queue, { index: 2 })).toThrow(/out of range/);
  });
});
