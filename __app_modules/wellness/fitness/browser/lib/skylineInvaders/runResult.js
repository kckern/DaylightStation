// The record a finished Skyline Invaders round is saved as. Pure.
import { invadersBonus, levelOutcome } from './scoring.js';

const round2 = (value) => Math.round(value * 100) / 100;

// run.status is the game's own vocabulary: completed (passed), failed (the
// timer ran out below the pass threshold), abandoned (ended early). The
// embedded gaming-result/v1 block only knows completed / abandoned, so a failed
// round is a completed session with a `loss` outcome there.
const RESULT_STATUS = Object.freeze({ completed: 'completed', failed: 'completed', abandoned: 'abandoned' });
const RESULT_OUTCOME = Object.freeze({ completed: 'completed', failed: 'loss', abandoned: 'abandoned' });

/**
 * @param {object} args
 * @param {boolean} args.ended true when the round ran to its timer; false when it was ended early
 * @param {object} args.state the final engine state
 */
export function buildSkylineInvadersRun({ runId, level, riderId, partnerId, fitnessSessionId, matEquipmentId, startedAt, endedAt, state, ended }) {
  const outcome = levelOutcome(state, level);
  const status = !ended ? 'abandoned' : outcome.passed ? 'completed' : 'failed';
  const stars = status === 'completed' ? outcome.stars : 0;
  const metrics = {
    duration_s: round2(state.time), score: state.score, kills: state.kills, stars,
    base_hp: outcome.baseHpPct, shots_fired: state.shotsFired, hits: state.hits,
    best_combo: state.bestCombo || 0, nukes: state.nukes || 0, boosts_used: state.boost?.used || 0,
  };
  return {
    schema: 'skyline-invaders-run/v1',
    run: {
      id: runId, level_id: level.id, started_at: startedAt, ended_at: endedAt, status,
      ...metrics, reward_rings: invadersBonus(stars),
      ...(fitnessSessionId ? { fitness_session_id: fitnessSessionId } : {}),
      ...(matEquipmentId ? { mat_equipment_id: matEquipmentId } : {}),
      ...(partnerId ? { partner_id: partnerId } : {}),
    },
    rider: { user_id: riderId },
    result: {
      schema: 'gaming-result/v1', experience_id: 'skyline-invaders', status: RESULT_STATUS[status],
      started_at: startedAt, ended_at: endedAt,
      participants: [{ id: riderId }, ...(partnerId ? [{ id: partnerId }] : [])],
      outcome: { kind: RESULT_OUTCOME[status], score: state.score, winner_ids: status === 'completed' ? [riderId] : [] },
      metrics,
    },
  };
}
