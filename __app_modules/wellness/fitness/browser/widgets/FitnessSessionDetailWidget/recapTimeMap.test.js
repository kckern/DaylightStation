import { describe, it, expect } from 'vitest';
import { recapSpeedup, elapsedMsFromX, xFromElapsedMs, videoTimeFromElapsedMs, elapsedMsFromVideoTime } from './recapTimeMap.js';
import { headerFromDetail } from './sessionHeader.js';

const axis = { effectiveTicks: 458, intervalMs: 5000, sessionStartMs: 0, getSeries: () => [], roster: [] };
const WIDTH = 845; // pane width at the garage geometry

describe('recap time map', () => {
  it('uses the stored speedup, else derives it from length and frames (real recap 20261015060031)', () => {
    expect(recapSpeedup({ speedup: 10, fps: 10, frameCount: 1 }, 1)).toBe(10);
    expect(recapSpeedup({ fps: 10, frameCount: 2276 }, 2276 * 1000)).toBeCloseTo(10, 6);
    expect(recapSpeedup({ fps: 10, frameCount: 2612 }, 2613 * 1000)).toBeCloseTo(10.004, 3);
    expect(recapSpeedup({ fps: 10 }, 1000)).toBeNull();
  });

  it('round-trips pane x ↔ elapsed time on the shared axis', () => {
    for (const ms of [0, 60_000, 19 * 60_000, 38 * 60_000]) {
      const x = xFromElapsedMs(ms, axis, WIDTH);
      expect(elapsedMsFromX(x, axis, WIDTH)).toBeCloseTo(ms, 3);
    }
    expect(elapsedMsFromX(5, axis, WIDTH)).toBeNull(); // left margin, not the plot
  });

  it('maps elapsed time to recap seconds at 1 video second per 10 session seconds, clamped', () => {
    expect(videoTimeFromElapsedMs(19 * 60_000, 10, 228)).toBeCloseTo(114, 6);
    expect(elapsedMsFromVideoTime(114, 10)).toBe(1_140_000);
    expect(videoTimeFromElapsedMs(40 * 60_000, 10, 228)).toBeCloseTo(227.95, 6); // past the end
    expect(videoTimeFromElapsedMs(-5, 10, 228)).toBe(0);
  });

  it("derives an older recap's speedup from the session strings, whatever the browser timezone", () => {
    const header = headerFromDetail({
      sessionId: '20261015060031',
      session: { start: '2026-10-15 06:00:31.281', end: '2026-10-15 06:38:27.281' },
      endTime: Date.parse('2026-10-15T13:38:27.281Z'), // epoch, as the API also ships it
      timelapse: { status: 'ready', videoPath: 'media/video/fitness/x.mp4', fps: 10, frameCount: 2276 },
      summary: {}, participants: {},
    }, null);
    expect(header.recapSpeedup).toBeCloseTo(10, 6);
  });
});
