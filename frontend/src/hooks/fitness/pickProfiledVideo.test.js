// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { pickProfiledVideo, PROBE_IGNORE_ATTR } from './videoFpsSample.js';

// 2026-10-01: the session-detail recap thumbnail (a muted looping <video>) was
// the only video on an idle home screen, so the profiler's querySelector
// fallback reported it as "playing" all night and the deploy gate stayed shut.
describe('pickProfiledVideo', () => {
  const page = (html) => { document.body.innerHTML = html; return document; };

  it('prefers the element the fitness player registered', () => {
    const doc = page('<video id="thumb"></video>');
    const registered = document.createElement('video');
    expect(pickProfiledVideo(doc, registered)).toBe(registered);
  });

  it('skips videos marked as decorative', () => {
    const doc = page(`<video id="thumb" ${PROBE_IGNORE_ATTR}="ignore"></video>`);
    expect(pickProfiledVideo(doc, null)).toBeNull();
  });

  it('still falls back to an unmarked video (e.g. a dance party)', () => {
    const doc = page(`<video id="thumb" ${PROBE_IGNORE_ATTR}="ignore"></video><video id="party"></video>`);
    expect(pickProfiledVideo(doc, null).id).toBe('party');
  });
});
