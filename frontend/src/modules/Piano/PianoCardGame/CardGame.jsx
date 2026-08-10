import { useMemo } from 'react';
import GamingRuntime from '../../Gaming/runtime/GamingRuntime.jsx';
import { createPianoChordProvider } from '../challenge/provider/createPianoChordProvider.jsx';
import { usePianoMidi, usePianoMidiNotes } from '../PianoKiosk/PianoMidiContext.jsx';

/** Scale Stadium composition adapter; Pokémon content/rules stay in YAML and Piano owns challenge grading. */
export function CardGame({ currentUser = null, onDeactivate = null }) {
  // The explicit user query mirrors GamingApp, letting readiness checks use
  // the supported guest identity without changing normal kiosk identity.
  const queryUserId = useMemo(() => new URLSearchParams(window.location.search).get('user'), []);
  const userId = queryUserId || currentUser?.user_id || currentUser?.id || 'guest';
  const participants = useMemo(() => [{ user_id: userId, role: 'player' }], [userId]);
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
