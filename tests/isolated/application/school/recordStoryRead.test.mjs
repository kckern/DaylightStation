import { describe, it, expect } from 'vitest';
import { RecordStoryRead } from '#apps/school/usecases/RecordStoryRead.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };

describe('RecordStoryRead', () => {
  it('appends a read stamped with the current study day', async () => {
    const appended = [];
    const useCase = new RecordStoryRead({
      readingLog: { append: async (row) => { appended.push(row); return row; } },
      timezone: 'America/Los_Angeles',
      clock: () => new Date('2026-08-27T01:30:00.000Z'),
      logger: silent,
    });
    await useCase.execute({ learnerId: 'learner-c', title: 'The Jungle Book', contentId: 'plex:620681', tagUid: '04215172cc2a81', location: 'livingroom' });
    expect(appended[0]).toMatchObject({ learnerId: 'learner-c', studyDay: '2026-08-26', title: 'The Jungle Book' });
  });

  it('refuses a read with no learner', async () => {
    const useCase = new RecordStoryRead({ readingLog: { append: async () => {} }, logger: silent });
    await expect(useCase.execute({ title: 'x' })).rejects.toThrow(/learnerId/);
  });

  it('broadcasts a story-read acknowledgement when a bus is wired', async () => {
    const sent = [];
    const useCase = new RecordStoryRead({
      readingLog: { append: async (r) => r },
      eventBus: { broadcast: (topic, payload) => sent.push({ topic, payload }) },
      timezone: 'America/Los_Angeles', clock: () => new Date('2026-08-26T18:00:00.000Z'), logger: silent,
    });
    await useCase.execute({ learnerId: 'learner-c', title: 'The Jungle Book' });
    expect(sent[0].topic).toBe('school');
    expect(sent[0].payload).toMatchObject({ event: 'story-read', learnerId: 'learner-c', title: 'The Jungle Book' });
  });

  it('still records the read when the broadcast throws', async () => {
    const useCase = new RecordStoryRead({
      readingLog: { append: async (r) => r },
      eventBus: { broadcast: () => { throw new Error('bus down'); } },
      timezone: 'America/Los_Angeles', clock: () => new Date('2026-08-26T18:00:00.000Z'), logger: silent,
    });
    await expect(useCase.execute({ learnerId: 'learner-c', title: 'x' })).resolves.toMatchObject({ learnerId: 'learner-c' });
  });
});
