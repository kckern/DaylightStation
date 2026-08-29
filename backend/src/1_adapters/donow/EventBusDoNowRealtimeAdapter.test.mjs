import { describe, expect, it, vi } from 'vitest';
import { EventBusDoNowRealtimeAdapter } from './EventBusDoNowRealtimeAdapter.mjs';

const build = () => {
  const eventBus = { subscribe: vi.fn(() => vi.fn()), broadcast: vi.fn() };
  return { eventBus, adapter: new EventBusDoNowRealtimeAdapter({ eventBus }) };
};

describe('EventBusDoNowRealtimeAdapter wire compatibility', () => {
  it('maps activity observations to the legacy topics', () => {
    const { adapter, eventBus } = build();
    const midi = vi.fn();
    const playback = vi.fn();
    adapter.observeMidiActivity(midi);
    adapter.observePlaybackActivity(playback);
    expect(eventBus.subscribe).toHaveBeenNthCalledWith(1, 'midi', midi);
    expect(eventBus.subscribe).toHaveBeenNthCalledWith(2, 'playback.log', playback);
  });

  it('preserves the immediate and approved DoNow completion envelopes', () => {
    const { adapter, eventBus } = build();
    adapter.publishDispatchCompleted({ ref: 'r1', surface: 'portal', requestedBy: 'api' });
    expect(eventBus.broadcast).toHaveBeenNthCalledWith(1, 'donow', {
      type: 'donow.dispatched', ref: 'r1', surface: 'portal', requestedBy: 'api',
    });
    adapter.publishDispatchCompleted({ ref: 'r2', surface: 'portal', requestedBy: 'school-scan', approvalId: 'a1' });
    expect(eventBus.broadcast).toHaveBeenNthCalledWith(2, 'donow', {
      type: 'donow.dispatched', ref: 'r2', surface: 'portal', requestedBy: 'school-scan',
      approved: true, approvalId: 'a1',
    });
  });

  it('preserves all launch topics and exact envelopes', () => {
    const { adapter, eventBus } = build();
    adapter.launchFitness({ learnerId: 'u1', episodeId: 'plex:1' });
    adapter.launchSchool({ learnerId: 'u1', target: { kind: 'program', program: 'pe' } });
    adapter.launchPiano({ deviceId: 'piano-1', contentId: 'hymn:12' });
    adapter.launchPianoCourseLesson({
      deviceId: 'piano-1', learnerId: 'u1', courseId: 'plex:c', lessonId: 'plex:l',
    });
    expect(eventBus.broadcast.mock.calls).toEqual([
      ['fitness', { type: 'fitness.launch', learnerId: 'u1', episodeId: 'plex:1' }],
      ['school', { type: 'school.launch', learnerId: 'u1', target: { kind: 'program', program: 'pe' } }],
      ['kiosk.launch', { topic: 'kiosk.launch', deviceId: 'piano-1', contentId: 'hymn:12', type: 'piano.launch' }],
      ['kiosk.launch', {
        topic: 'kiosk.launch', deviceId: 'piano-1', type: 'piano.course-lesson.launch',
        learnerId: 'u1', courseId: 'plex:c', courseTitle: null, unitId: null,
        unitTitle: null, lessonId: 'plex:l', lessonTitle: null,
      }],
    ]);
  });
});
