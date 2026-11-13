// @vitest-environment node
// A video finished in the living room tells the tablet, so its board moves
// and the child is told the questions come next.
import { it, expect, vi } from 'vitest';
import { RecordMediaCompletion } from './RecordMediaCompletion.mjs';

const at = '2026-11-13T17:00:00.000Z';
const unit = { unitId: 'sci.01', title: 'How plants drink' };

function fixture({ realtime = { mediaLessonCompleted: vi.fn() } } = {}) {
  const events = [
    { type: 'created', at, sessionId: 's1', learnerId: 'learner_a', unitId: 'sci.01', studyDay: '2026-11-13' },
    { type: 'media_dispatched', at, sessionId: 's1', dispatchId: 'd1', target: 'tv', contentId: 'plex:1' },
  ];
  events.forEach((e, i) => { e.seq = i + 1; });
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const uc = new RecordMediaCompletion({
    curriculum: { getUnit: async () => unit },
    sessions: { readEvents: async () => events, appendEvent: async (_, e) => { events.push({ ...e, seq: events.length + 1 }); } },
    clock: () => new Date('2026-11-13T17:20:00.000Z'), logger, realtime,
  });
  return { uc, realtime, logger };
}

it('a finished video tells the tablet once, naming the lesson', async () => {
  const f = fixture();
  expect((await f.uc.execute({ sessionId: 's1' })).status).toBe('completed');
  expect(f.realtime.mediaLessonCompleted).toHaveBeenCalledTimes(1);
  expect(f.realtime.mediaLessonCompleted.mock.calls[0][0]).toMatchObject({
    learnerId: 'learner_a', sessionId: 's1', unitId: 'sci.01', title: 'How plants drink', studyDay: '2026-11-13',
  });
  expect((await f.uc.execute({ sessionId: 's1' })).status).toBe('already_completed');
  expect(f.realtime.mediaLessonCompleted).toHaveBeenCalledTimes(1);
});

it('a broken announcement never loses the completion', async () => {
  const f = fixture({ realtime: { mediaLessonCompleted: vi.fn(() => { throw new Error('bus down'); }) } });
  expect((await f.uc.execute({ sessionId: 's1' })).status).toBe('completed');
  expect(f.logger.warn).toHaveBeenCalledWith('school.media.broadcast-failed', expect.objectContaining({ sessionId: 's1' }));
});
