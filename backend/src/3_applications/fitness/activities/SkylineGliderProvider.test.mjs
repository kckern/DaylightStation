import { describe, expect, it } from 'vitest';
import { SkylineGliderProvider } from './SkylineGliderProvider.mjs';

describe('SkylineGliderProvider', () => {
  it('projects overlapping runs into fitness session activities', async () => {
    const run = { run: { id: 'run-1', course_id: 'mountain-pass', started_at: '2026-10-06T17:00:00.000Z', ended_at: '2026-10-06T17:05:00.000Z', status: 'completed', duration_s: 300 }, rider: { user_id: 'dad' }, collectibles: ['a', 'b'] };
    const provider = new SkylineGliderProvider({ runService: { listByDate: async () => [run] } });
    const items = await provider.loadOverlapping(Date.parse('2026-10-06T16:59:00Z'), Date.parse('2026-10-06T17:06:00Z'), '2026-10-06', 'home');
    expect(items).toEqual([{ startMs: Date.parse(run.run.started_at), endMs: Date.parse(run.run.ended_at), participants: ['dad'], meta: { runId: 'run-1', courseId: 'mountain-pass', status: 'completed', durationS: 300, collectibles: 2 } }]);
  });
});
