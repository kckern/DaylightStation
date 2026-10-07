import { describe, expect, it } from 'vitest';
import { buildSkylineGliderRun, skylineGliderBonus } from './runResult.js';

describe('Skyline Glider terminal result', () => {
  it('awards ten completion rings plus unique collectibles, capped at thirty', () => {
    expect(skylineGliderBonus(['a', 'a', 'b'])).toBe(12);
    expect(skylineGliderBonus(Array.from({ length: 40 }, (_, i) => `c${i}`))).toBe(30);
  });
  it('builds the durable run and gaming-result/v1 projection', () => {
    const record = buildSkylineGliderRun({ runId: 'abc', course: { id: 'mountain-pass', version: 1 }, riderId: 'dad', startedAt: '2026-10-06T17:00:00.000Z', endedAt: '2026-10-06T17:05:00.000Z', state: { courseTime: 300, collisions: 2, restarts: 1, collectedIds: ['a', 'a', 'b'] }, status: 'completed' });
    expect(record).toMatchObject({ schema: 'skyline-glider-run/v1', run: { id: 'abc', status: 'completed', reward_rings: 12 }, rider: { user_id: 'dad' }, collectibles: ['a', 'b'], result: { schema: 'gaming-result/v1', experience_id: 'skyline-glider', status: 'completed' } });
    expect(record.result.outcome).toMatchObject({ kind: 'completed', score: 2 });
  });
  it('does not award an abandoned flight', () => {
    const record = buildSkylineGliderRun({ runId: 'abc', course: { id: 'mountain-pass', version: 1 }, riderId: 'dad', startedAt: '2026-10-06T17:00:00.000Z', endedAt: '2026-10-06T17:01:00.000Z', state: { courseTime: 60, collisions: 0, restarts: 0, collectedIds: ['a'] }, status: 'abandoned' });
    expect(record.run.reward_rings).toBe(0);
    expect(record.result.status).toBe('abandoned');
  });
  it('adds optional session, equipment, and calibration identity without changing the v1 schema', () => {
    const record = buildSkylineGliderRun({ runId: 'abc', course: { id: 'mountain-pass', version: 2 }, riderId: 'test-rider', fitnessSessionId: 'fs-1', equipmentId: 'niceday', calibration: { lowRpm: 30, highRpm: 100 }, startedAt: '2026-10-07T18:00:00Z', endedAt: '2026-10-07T18:05:00Z', state: { courseTime: 300, collisions: 0, restarts: 0, collectedIds: [] }, status: 'completed' });
    expect(record).toMatchObject({ schema: 'skyline-glider-run/v1', run: { fitness_session_id: 'fs-1', equipment_id: 'niceday', calibration: { low_rpm: 30, high_rpm: 100 } } });
  });
});
