export function skylineGliderBonus(collectedIds = []) {
  return Math.min(30, 10 + new Set(collectedIds).size);
}

export function buildSkylineGliderRun({ runId, course, riderId, fitnessSessionId, equipmentId, calibration, startedAt, endedAt, state, status }) {
  const collectibles = [...new Set(state.collectedIds || [])];
  const completed = status === 'completed';
  const rewardRings = completed ? skylineGliderBonus(collectibles) : 0;
  return {
    schema: 'skyline-glider-run/v1',
    run: {
      id: runId, course_id: course.id, course_version: course.version,
      started_at: startedAt, ended_at: endedAt, status,
      duration_s: Math.round(state.courseTime * 100) / 100,
      collisions: state.collisions, restarts: state.restarts, reward_rings: rewardRings,
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
      outcome: { kind: completed ? 'completed' : 'abandoned', score: collectibles.length, winner_ids: completed ? [riderId] : [] },
      metrics: { duration_s: Math.round(state.courseTime * 100) / 100, collisions: state.collisions, restarts: state.restarts, collectibles: collectibles.length },
    },
  };
}
