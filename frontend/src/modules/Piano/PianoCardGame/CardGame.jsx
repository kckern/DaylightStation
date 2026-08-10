import { useMemo } from 'react';
import GamingRuntime from '../../Gaming/runtime/GamingRuntime.jsx';
import { createPianoChordProvider } from '../challenge/provider/createPianoChordProvider.jsx';
import { usePianoMidi, usePianoMidiNotes } from '../PianoKiosk/PianoMidiContext.jsx';

/** Thin Piano Games composition adapter; game content and rules come from YAML. */
export function CardGame({ currentUser = null, onDeactivate = null }) {
  const userId = currentUser?.user_id || currentUser?.id || 'guest';
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
