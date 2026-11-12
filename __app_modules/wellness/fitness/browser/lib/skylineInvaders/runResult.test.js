import { describe, expect, it } from 'vitest';
import { buildSkylineInvadersRun } from './runResult.js';

const level = { id: 'invaders-1-1', pass: { kills: 10, base_hp_min: 50 } };
const state = { time: 180, kills: 12, score: 340, bestCombo: 6, shotsFired: 40, hits: 14, nukes: 1, base: { hp: 80, maxHp: 100 }, boost: { used: 2 } };
const args = (over = {}) => ({ runId: 'run-1', level, riderId: 'kid', partnerId: 'dad', fitnessSessionId: 'fs-1', matEquipmentId: 'step-mat', startedAt: '2026-11-11T17:00:00.000Z', endedAt: '2026-11-11T17:03:00.000Z', state, ended: true, ...over });

// The values gaming-result/v1 allows (__capabilities/gaming/portable/experience/result.mjs).
const RESULT_STATUSES = ['completed', 'abandoned'];
const RESULT_OUTCOMES = ['win', 'loss', 'draw', 'completed', 'abandoned'];

describe('buildSkylineInvadersRun', () => {
  it('records a passed round with stars and rings', () => {
    const record = buildSkylineInvadersRun(args());
    expect(record).toMatchObject({
      schema: 'skyline-invaders-run/v1',
      run: { id: 'run-1', level_id: 'invaders-1-1', status: 'completed', started_at: '2026-11-11T17:00:00.000Z', ended_at: '2026-11-11T17:03:00.000Z', duration_s: 180, score: 340, kills: 12, stars: 2, base_hp: 80, shots_fired: 40, hits: 14, best_combo: 6, nukes: 1, boosts_used: 2, reward_rings: 20, fitness_session_id: 'fs-1', mat_equipment_id: 'step-mat', partner_id: 'dad' },
      rider: { user_id: 'kid' },
      result: { schema: 'gaming-result/v1', experience_id: 'skyline-invaders', status: 'completed', participants: [{ id: 'kid' }, { id: 'dad' }], outcome: { kind: 'completed', score: 340, winner_ids: ['kid'] }, metrics: { kills: 12, stars: 2 } },
    });
  });
  it('a round that ran out below the pass threshold is failed, with no rings', () => {
    const record = buildSkylineInvadersRun(args({ state: { ...state, kills: 3 } }));
    expect(record.run).toMatchObject({ status: 'failed', stars: 0, reward_rings: 0 });
    // Played to the end and lost: the shared result contract has no "failed".
    expect(record.result).toMatchObject({ status: 'completed', outcome: { kind: 'loss', winner_ids: [] } });
  });
  it('a round ended early is abandoned whatever the score', () => {
    const record = buildSkylineInvadersRun(args({ ended: false }));
    expect(record.run).toMatchObject({ status: 'abandoned', stars: 0, reward_rings: 0 });
    expect(record.result).toMatchObject({ status: 'abandoned', outcome: { kind: 'abandoned', winner_ids: [] } });
  });
  it('only ever writes result values the shared gaming result contract allows', () => {
    for (const over of [{}, { state: { ...state, kills: 3 } }, { ended: false }]) {
      const { result } = buildSkylineInvadersRun(args(over));
      expect(RESULT_STATUSES).toContain(result.status);
      expect(RESULT_OUTCOMES).toContain(result.outcome.kind);
    }
  });
  it('omits optional ids that are missing', () => {
    const record = buildSkylineInvadersRun(args({ partnerId: null, fitnessSessionId: null, matEquipmentId: null }));
    expect(record.run).not.toHaveProperty('partner_id');
    expect(record.run).not.toHaveProperty('fitness_session_id');
    expect(record.run).not.toHaveProperty('mat_equipment_id');
    expect(record.result.participants).toEqual([{ id: 'kid' }]);
  });
  it('rounds the duration and tolerates a state without the optional counters', () => {
    const bare = { time: 61.23456, kills: 0, score: 0, shotsFired: 0, hits: 0, base: { hp: 100, maxHp: 100 } };
    expect(buildSkylineInvadersRun(args({ state: bare })).run).toMatchObject({ duration_s: 61.23, best_combo: 0, nukes: 0, boosts_used: 0 });
  });
});
