import { PartyGamesParticipantConsumer } from './application/participants/PartyGamesParticipantConsumer.mjs';
export { PartyGamesParticipantConsumer };

// Composition supplies the existing Gaming application and artifact stores.
export function createPartyGamesParticipantConsumer({ definitions, clueHistory, manifestStore, gamingApplication }) {
  if (!gamingApplication) throw new Error('Gaming application is required');
  return new PartyGamesParticipantConsumer({ definitions, clueHistory, manifestStore, executionPort: {
    createReserved: request => gamingApplication.createReserved(request),
    resume: (sessionId, viewer) => gamingApplication.resumeSession(sessionId, viewer),
  } });
}
