import { scoresAsTarget } from "./weapons.js";

export function skylineGliderBonus(collectedIds = []) {
  return Math.min(30, 10 + new Set(collectedIds).size);
}

/** Weapon kills of scored targets (see scoresAsTarget); crash breakage never counts. */
export function countTargets(state, course) {
  const entities = new Map((course?.entities || []).map((entity) => [entity.id, entity]));
  return Object.entries(state.destroyedBy || {}).filter(([id, by]) => ['laser', 'bomb', 'missile'].includes(by)
    && (!entities.has(id) || scoresAsTarget(entities.get(id)))).length;
}

export function buildSkylineGliderRun({ runId, course, riderId, fitnessSessionId, equipmentId, calibration, startedAt, endedAt, state, status }) {
  const collectibles = [...new Set(state.collectedIds || [])];
  const completed = status === 'completed';
  const rewardRings = completed ? skylineGliderBonus(collectibles) : 0;
  // `targets` counts the final run-through (rolled back with the checkpoint, like
  // collectibles); shot and bomb counters are cumulative, like collisions.
  const targets = countTargets(state, course);
  const shotsFired = state.shotsFired || 0;
  const bombsDropped = state.bombsDropped || 0;
  return {
    schema: 'skyline-glider-run/v1',
    run: {
      id: runId, course_id: course.id, course_version: course.version,
      started_at: startedAt, ended_at: endedAt, status,
      duration_s: Math.round(state.courseTime * 100) / 100,
      collisions: state.collisions, restarts: state.restarts, reward_rings: rewardRings,
      targets, shots_fired: shotsFired, bombs_dropped: bombsDropped,
      missiles_fired: state.missilesFired || 0, boosts_used: state.boostsUsed || 0,
      ...(fitnessSessionId ? { fitness_session_id: fitnessSessionId } : {}),
      ...(equipmentId ? { equipment_id: equipmentId } : {}),
      ...(calibration ? { calibration: { low_rpm: calibration.lowRpm, high_rpm: calibration.highRpm } } : {}),
    },
    rider: { user_id: riderId },
    collectibles,
    result: {
      schema: 'gaming-result/v1', experience_id: 'skyline-glider', status,
      started_at: startedAt, ended_at: endedAt,
      participants: [{ id: riderId }],
      outcome: { kind: completed ? 'completed' : 'abandoned', score: collectibles.length + targets, winner_ids: completed ? [riderId] : [] },
      metrics: { duration_s: Math.round(state.courseTime * 100) / 100, collisions: state.collisions, restarts: state.restarts, collectibles: collectibles.length, targets, shots_fired: shotsFired, bombs_dropped: bombsDropped, missiles_fired:state.missilesFired||0,boosts_used:state.boostsUsed||0 },
    },
  };
}
