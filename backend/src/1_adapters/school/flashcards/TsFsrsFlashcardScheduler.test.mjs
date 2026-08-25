import { describe, expect, it } from 'vitest';
import { TsFsrsFlashcardScheduler } from './TsFsrsFlashcardScheduler.mjs';

const profile = { id: 'default', revision: 'default:1', parameters: { requestRetention: 0.9, maximumIntervalDays: 36500, enableShortTerm: true, learningSteps: ['1m', '10m'], relearningSteps: ['10m'] } };

describe('TsFsrsFlashcardScheduler', () => {
  it('keeps ts-fsrs details behind a stable School progress DTO', () => {
    const scheduler = new TsFsrsFlashcardScheduler(); const now = new Date('2026-08-24T12:00:00.000Z');
    const initial = scheduler.initial({ now, profile });
    const rated = scheduler.rate({ progress: initial, rating: 'good', now, profile });
    expect(rated.progress).toMatchObject({ state: 'learning', scheduler: { engine: 'ts-fsrs@5.4.1/fsrs-6', profileId: 'default', profileRevision: 'default:1' } });
    expect(scheduler.preview({ progress: rated.progress, now, profile })).toEqual(expect.arrayContaining([expect.objectContaining({ rating: 'again', intervalDays: expect.any(Number) })]));
  });
});
