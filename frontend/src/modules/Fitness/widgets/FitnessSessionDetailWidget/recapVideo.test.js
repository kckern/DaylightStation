import { describe, it, expect } from 'vitest';
import { deriveRecap } from './recapVideo.js';

describe('deriveRecap', () => {
  it('ready with a url when status ready + videoPath', () => {
    const r = deriveRecap({ status: 'ready', videoPath: 'media/video/fitness/x.mp4' });
    expect(r.ready).toBe(true);
    expect(r.processing).toBe(false);
    expect(r.url).toContain('video/fitness/x.mp4');
  });
  it('processing flag with no url', () => {
    const r = deriveRecap({ status: 'processing' });
    expect(r.ready).toBe(false);
    expect(r.processing).toBe(true);
    expect(r.url).toBe(null);
  });
  it('failed/skipped/ready-without-path/absent → not ready, no url', () => {
    for (const t of [{ status: 'failed' }, { status: 'skipped' }, { status: 'ready' }, null, undefined]) {
      const r = deriveRecap(t);
      expect(r.ready).toBe(false);
      expect(r.url).toBe(null);
    }
  });
});
