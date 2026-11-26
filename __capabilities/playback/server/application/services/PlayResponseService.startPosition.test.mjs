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
  // A book 3 minutes in (the phone's Continue listening) resumes; a film that far in is a peek.
  it('resumes audio from 30 s in, video only past the 3-minute peek floor', () => {
    const book = { id: 'plex:727120', resumable: true, mediaUrl: '/x', mediaType: 'audio', duration: 17800 };
    const film = { ...book, mediaType: 'dash_video' };
    const at = { contentId: 'plex:727120', playhead: 178, duration: 17800 };
    expect(svc.toPlayResponse(book, at).resume_position).toBe(178);
    expect(svc.startPositionFor(book, at)).toBe(178);
    expect(svc.toPlayResponse(film, at).resume_position ?? 0).toBe(0);
    expect(svc.startPositionFor(book, { ...at, playhead: 12 })).toBe(0);
  });
  it('never puts a server-side offset on an audio stream (the player seeks; its clock stays true)', () => {
    const book = { id: 'plex:727120', resumable: true, mediaUrl: '/api/v1/proxy/plex/stream/727120', mediaType: 'audio', duration: 17800 };
    const film = { ...book, mediaType: 'dash_video' };
    const at = { contentId: 'plex:727120', playhead: 404, duration: 17800 };
    expect(svc.toPlayResponse(book, at).mediaUrl).toBe('/api/v1/proxy/plex/stream/727120');
    expect(svc.toPlayResponse(book, at).resume_position).toBe(404);
    expect(svc.toPlayResponse(film, at).mediaUrl).toBe('/api/v1/proxy/plex/stream/727120?offset=404');
  });
});
