export const PAUSE_REASON = Object.freeze({
  GOVERNANCE: 'PAUSED_GOVERNANCE',
  BUFFERING: 'PAUSED_BUFFERING',
  USER: 'PAUSED_USER',
  PLAYING: 'PLAYING'
});

const truthy = (value) => Boolean(value);

export const resolvePause = ({ governance = {}, resilience = {}, user = {} } = {}) => {
  const governancePaused = truthy(
    governance.blocked
    ?? governance.paused
    ?? governance.locked
    ?? governance.videoLocked
  );
  if (governancePaused) {
    return { paused: true, reason: PAUSE_REASON.GOVERNANCE };
  }

  const resiliencePaused = truthy(
    resilience.requiresPause
    ?? resilience.buffering
    ?? resilience.stalled
    ?? resilience.waiting
  );
  if (resiliencePaused) {
    return { paused: true, reason: PAUSE_REASON.BUFFERING };
  }

  const userPaused = truthy(user.paused ?? user.pauseIntent === 'user');
  if (userPaused) {
    return { paused: true, reason: PAUSE_REASON.USER };
  }

  return { paused: false, reason: PAUSE_REASON.PLAYING };
};

export default resolvePause;
