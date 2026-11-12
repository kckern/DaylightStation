import { describe, it, expect, vi } from 'vitest';
import { createLessonSittingJudge } from './lesson-good-faith.mjs';
import { sittingGoodFaithState } from '../../portable/practice/sittingGoodFaith.mjs';

const state = sittingGoodFaithState({ events: [], lessonSec: 60, watchedSec: 60 });

describe('createLessonSittingJudge', () => {
  it('follows videos.practice.good_faith_model on every call', async () => {
    let on = false;
    const configService = { getHouseholdAppConfig: () => ({ videos: { practice: { good_faith_model: on } } }) };
    const gw = { evaluate: vi.fn(async () => ({ answers: { goodFaith: { score: 0, probabilities: [1, 0, 0, 0, 0, 0] } } })) };
    const judge = createLessonSittingJudge({ decisionGateway: gw, configService, logger: { info() {}, warn() {} } });
    expect(await judge.judge({ userId: 'u', sittingId: 'a', state })).toMatchObject({ source: 'disabled' });
    on = true;
    expect(await judge.judge({ userId: 'u', sittingId: 'b', state })).toMatchObject({ source: 'model', score: 0 });
    expect(gw.evaluate).toHaveBeenCalledTimes(1);
  });
});
