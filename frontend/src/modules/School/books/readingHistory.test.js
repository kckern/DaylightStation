import { describe, expect, it } from 'vitest';
import { lastFinish } from './readingHistory.js';

describe('v2 finish history', () => {
  it('shows the effective finish date and explicit recording time, ignoring later progress', () => {
    expect(lastFinish({ status: 'finished', finishedOn: '2026-09-05', entries: [
      { kind: 'finished', on: '2026-09-05', at: '2026-09-07T18:00:00Z', recordedAt: '2026-09-07T18:00:00Z' },
      { kind: 'progress', on: '2026-09-07', at: '2026-09-07T19:00:00Z' },
    ], projection: { status: 'finished', lastAt: '2026-09-07T19:00:00Z' } }))
      .toEqual({ day: '2026-09-05', recordedAt: '2026-09-07T18:00:00Z' });
  });
  it('does not invent recording precision from a migrated effective instant', () => {
    expect(lastFinish({ finishedOn: '2026-09-05', entries: [
      { kind: 'finished', on: '2026-09-05', at: '2026-09-05T12:00:00Z' },
    ] })).toEqual({ day: '2026-09-05', recordedAt: null });
  });
});
