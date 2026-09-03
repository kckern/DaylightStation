// challengeEventPayload.js — challenge log-event shaping for
// FitnessPlayerOverlay.jsx, split out so Fast Refresh can hot-reload the
// overlay component on its own.

export const normalizeChallengeStatusForLogging = (status) => {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (normalized === 'success') return 'success';
  if (normalized === 'failed' || normalized === 'fail') return 'failed';
  if (normalized === 'pending' || normalized === 'active' || normalized === 'running') return 'pending';
  return normalized || 'pending';
};

export const resolveChallengeIdentity = (challenge) => {
  if (!challenge) return null;
  return challenge.id || challenge.selectionLabel || challenge.zone || challenge.zoneLabel || null;
};

export const buildChallengeEventPayload = (challenge, statusOverride = null) => {
  if (!challenge) return null;
  return {
    challengeId: resolveChallengeIdentity(challenge),
    status: statusOverride || normalizeChallengeStatusForLogging(challenge.status),
    title: challenge.zoneLabel || challenge.zone || challenge.title || '',
    type: challenge.type || null,
    zoneId: challenge.zone || null,
    zoneLabel: challenge.zoneLabel || null,
    selectionLabel: challenge.selectionLabel || null,
    requiredCount: Number.isFinite(challenge.requiredCount) ? challenge.requiredCount : null,
    actualCount: Number.isFinite(challenge.actualCount) ? challenge.actualCount : null,
    missingUsers: Array.isArray(challenge.missingUsers) ? challenge.missingUsers.filter(Boolean) : [],
    metUsers: Array.isArray(challenge.metUsers) ? challenge.metUsers.filter(Boolean) : [],
    equipmentId: challenge.equipment || challenge.equipmentId || null,
    metric: challenge.metric || null,
    target: Number.isFinite(challenge.target) ? challenge.target : null,
    startCount: Number.isFinite(challenge.startCount) ? challenge.startCount : null,
    assignedUserId: challenge.assignedUserId || null,
    stepsPerMinute: Number.isFinite(challenge.stepsPerMinute) ? challenge.stepsPerMinute : null,
    sensorOnline: typeof challenge.sensorOnline === 'boolean' ? challenge.sensorOnline : null,
    reward: challenge.reward || null,
    totalSeconds: Number.isFinite(challenge.totalSeconds)
      ? Math.max(0, Math.round(challenge.totalSeconds))
      : (Number.isFinite(challenge.timeLimitSeconds) ? Math.max(0, Math.round(challenge.timeLimitSeconds)) : null)
  };
};
