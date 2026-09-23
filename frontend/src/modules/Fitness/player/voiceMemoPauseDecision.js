/**
 * Decision for FitnessPlayer's external-pause effect (voice memo, emergency,
 * module pause requests via FitnessContext.videoPlayerPaused).
 *
 * `videoPlayerPaused` is both a pause REQUEST and a mirror of the element's
 * state (the governance enforcer writes `paused || locked` every tick). So a
 * true value on its own is not a request: after a manual pause it stays true
 * until the first tick after the next play press. Only a false -> true
 * TRANSITION is treated as a request to pause. A new media element (resilience
 * remount) or a governance change while the flag is already true does nothing.
 *
 * Resume is unchanged from the original effect: when the flag is false, resume
 * only an element we paused, only if governance is clear (a locked governance
 * owns the resume), and forget our pause either way.
 *
 * @param {object} s
 * @param {boolean} s.prevRequested  videoPlayerPaused at the previous decision
 * @param {boolean} s.requested      videoPlayerPaused now
 * @param {boolean} s.hasElement     a media element is attached
 * @param {boolean} s.elementPaused  the element's native paused state
 * @param {boolean} s.wePausedIt     this effect paused the element and has not resumed it
 * @param {boolean} s.governanceLocked  governance is holding the video paused
 * @returns {{ action: 'pause'|'resume'|'none', wePausedIt: boolean }}
 */
export function decideVoiceMemoPause({
  prevRequested,
  requested,
  hasElement,
  elementPaused,
  wePausedIt,
  governanceLocked,
}) {
  if (requested) {
    if (!prevRequested && hasElement && !elementPaused) {
      return { action: 'pause', wePausedIt: true };
    }
    return { action: 'none', wePausedIt: Boolean(wePausedIt) };
  }
  if (wePausedIt && hasElement) {
    if (!governanceLocked && elementPaused) {
      return { action: 'resume', wePausedIt: false };
    }
    return { action: 'none', wePausedIt: false };
  }
  return { action: 'none', wePausedIt: Boolean(wePausedIt) };
}

export default decideVoiceMemoPause;
