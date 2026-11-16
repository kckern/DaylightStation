import { PartyGamesParticipantConsumer } from './application/participants/PartyGamesParticipantConsumer.mjs';
export { PartyGamesParticipantConsumer };

// Composition supplies the existing Gaming application and artifact stores.
export function createPartyGamesParticipantConsumer({ definitions, clueHistory, manifestStore, gamingApplication }) {
  if (!gamingApplication) throw new Error('Gaming application is required');
  return new PartyGamesParticipantConsumer({ definitions, clueHistory, manifestStore, executionPort: {
    createReserved: request => gamingApplication.createReserved(request),
    resume: (sessionId, viewer) => gamingApplication.resumeSession(sessionId, viewer),
    inspect: (sessionId, viewer) => gamingApplication.inspectSession(sessionId, viewer),
  } });
}

/** Resolve a definition and surface through the Gaming owner before declaring participation. */
export function createPartyGamesTargetResolver({ gamingApplication, householdId }) {
  if (!gamingApplication?.getLaunchDescriptor || !householdId) throw new Error('Gaming authority and household are required');
  return async ({ path, viewer }) => {
    if (!viewer?.participant_id || viewer.householdId !== householdId || viewer.role !== 'host') {
      throw Object.assign(new Error('Household host authority required'), {code:'authorization_denied'});
    }
    if (typeof path !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(path)) {
      throw Object.assign(new Error('Invalid Party Games definition'), {code:'invalid_target'});
    }
    const descriptor = await gamingApplication.getLaunchDescriptor(path, {surfaceId:'party-games',authorityMode:'remote'});
    if (descriptor?.definition_id !== path || descriptor.surface?.id !== 'party-games') {
      throw Object.assign(new Error('Party Games target unavailable'), {code:'invalid_target'});
    }
    return {kind:'app',appId:'party-games',definitionId:path,surfaceId:'party-games',participantConsumer:{id:'party-games',version:1}};
  };
}
