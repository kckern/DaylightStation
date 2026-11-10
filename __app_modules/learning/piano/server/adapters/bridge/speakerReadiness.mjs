/**
 * Can the speaker ladder actually work if the piano's speaker drops right now?
 * Answers with the broken links, in the vocabulary composePianoSpeakerPush words.
 * An unreachable bridge is NOT a problem here — the supervisor's down episode owns it.
 *
 * @returns {() => Promise<string[]>}
 */
export function createSpeakerReadinessCheck({ actions, haGateway, plugEntity = null } = {}) {
  return async function checkReady() {
    const problems = [];
    const { present } = await actions.probeEndpoints();
    if (present === false) problems.push('bridge-endpoints-missing');
    // Without an HA gateway there are no plug rungs at all, whatever the entity says.
    if (!plugEntity || typeof haGateway?.getState !== 'function') problems.push('no-plug-configured');
    else {
      const state = (await haGateway.getState(plugEntity))?.state;
      if (!state || state === 'unavailable' || state === 'unknown') problems.push('plug-unavailable');
    }
    return problems;
  };
}

export default createSpeakerReadinessCheck;
