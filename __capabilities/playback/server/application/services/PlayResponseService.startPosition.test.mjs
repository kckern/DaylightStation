// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { PlayResponseService } from './PlayResponseService.mjs';

/** startPositionFor must agree with the resume_position /play hands the Player. */
describe('PlayResponseService.startPositionFor', () => {
  const svc = new PlayResponseService({ mediaProgressMemory: null, now: () => Date.parse('2026-11-21T12:00:00Z') });
  const item = (resumable) => ({ id: 'plex:1', resumable, mediaUrl: '/x', mediaType: 'dash_video', duration: 6000 });
  it.each([
    ['in progress', true, { contentId: 'plex:1', playhead: 600, duration: 6000 }],
    ['not resumable', false, { contentId: 'plex:1', playhead: 600, duration: 6000 }],
    ['watched', true, { contentId: 'plex:1', playhead: 5950, duration: 6000 }],
    ['never played', true, null],
    ['no duration', true, { contentId: 'plex:1', playhead: 600, duration: 0 }],
  ])('matches the play response (%s)', (_label, resumable, watchState) => {
    const response = svc.toPlayResponse(item(resumable), watchState);
    expect(svc.startPositionFor(item(resumable), watchState)).toBe(response.resume_position ?? 0);
  });
  it('is the playhead for a title in progress', () => {
    expect(svc.startPositionFor(item(true), { contentId: 'plex:1', playhead: 600, duration: 6000 })).toBe(600);
  });
});
