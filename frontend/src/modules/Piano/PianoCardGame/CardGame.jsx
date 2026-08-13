import { useMemo } from 'react';
import GamingRuntime from '../../Gaming/runtime/GamingRuntime.jsx';
import { createPianoChordProvider } from '../challenge/provider/createPianoChordProvider.jsx';
import { usePianoMidi, usePianoMidiNotes } from '../PianoKiosk/PianoMidiContext.jsx';

/** Card Game composition adapter; Pokémon content/rules stay in YAML and Piano owns challenge grading. */
export function resolveCardGameUserId(currentUser, queryUserId = null) {
  return queryUserId
    || (typeof currentUser === 'string' ? currentUser : currentUser?.user_id || currentUser?.userId || currentUser?.id)
    || 'guest';
}

export function CardGame({ currentUser = null, onDeactivate = null }) {
  // The explicit user query mirrors GamingApp, letting readiness checks use
  // the supported guest identity without changing normal kiosk identity.
  const queryUserId = useMemo(() => new URLSearchParams(window.location.search).get('user'), []);
  const userId = resolveCardGameUserId(currentUser, queryUserId);
  const displayName = currentUser?.display_name || currentUser?.name || currentUser?.first_name || userId;
  const participants = useMemo(
    () => [{ user_id: userId, display_name: displayName, role: 'player' }],
    [displayName, userId],
  );
  const providers = useMemo(
    () => [createPianoChordProvider({ useNotes: usePianoMidiNotes, useConnection: usePianoMidi })],
    [],
  );
  return (
    <GamingRuntime
      gameId="card-game"
      participants={participants}
      providers={providers}
      onClose={onDeactivate}
    />
  );
}

export default CardGame;
