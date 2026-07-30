// PlayResponseService.resume.test.mjs
//
// Regression coverage for the karaoke resume bug's core defect: even when a
// caller correctly requested resume:false, PlayResponseService.toPlayResponse
// would still rewrite a Plex stream mediaUrl with `?offset=<playhead>` if
// watch state carried a stored playhead — the client seeks to 0 but the
// backend hands Plex an offset, so the real transcode starts mid-track.
// `resume: false` must suppress BOTH resume_position/resume_percent AND the
// offset rewrite. Absent the option (the default, used everywhere outside
// karaoke), existing resume behavior for normal content must be unchanged.
import { describe, it, expect } from 'vitest';
import { PlayResponseService } from '#apps/content/services/PlayResponseService.mjs';

function makeService() {
  return new PlayResponseService({ mediaProgressMemory: null });
}

function makeItem(overrides = {}) {
  return {
    id: 'plex:662039',
    title: 'Test Song',
    mediaType: 'video',
    mediaUrl: '/proxy/plex/stream/662039',
    duration: 200,
    resumable: true,
    metadata: {},
    ...overrides,
  };
}

function makeWatchState(overrides = {}) {
  return { contentId: 'plex:662039', playhead: 90, duration: 200, ...overrides };
}

describe('PlayResponseService.toPlayResponse — resume override', () => {
  it('resume:false suppresses resume_position/resume_percent even with a stored in-progress playhead', () => {
    const service = makeService();
    const response = service.toPlayResponse(makeItem(), makeWatchState(), { resume: false });

    expect(response.resume_position).toBeUndefined();
    expect(response.resume_percent).toBeUndefined();
  });

  it('resume:false suppresses the Plex stream offset= rewrite (the actual mid-track-start bug)', () => {
    const service = makeService();
    const response = service.toPlayResponse(makeItem(), makeWatchState(), { resume: false });

    expect(response.mediaUrl).toBe('/proxy/plex/stream/662039');
    expect(response.mediaUrl).not.toContain('offset=');
  });

  it('regression: default (no resume option) still resumes normal content with an in-progress playhead', () => {
    const service = makeService();
    const response = service.toPlayResponse(makeItem(), makeWatchState(), {});

    expect(response.resume_position).toBe(90);
    expect(response.mediaUrl).toBe('/proxy/plex/stream/662039?offset=90');
  });
});
