import { useMemo } from 'react';
import GamingRuntime from '../modules/Gaming/runtime/GamingRuntime.jsx';
import { createPianoChordProvider } from '../modules/Piano/challenge/provider/createPianoChordProvider.jsx';
import { PianoMidiProvider, usePianoMidi, usePianoMidiNotes } from '../modules/Piano/PianoKiosk/PianoMidiContext.jsx';

export default function GamingApp({ clear = null }) {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const userId = query.get('user') || 'guest';
  const gameId = query.get('game') || 'scale-clash';
  const participants = useMemo(() => [{ user_id: userId, role: 'player' }], [userId]);
  const providers = useMemo(() => [createPianoChordProvider({ useNotes: usePianoMidiNotes, useConnection: usePianoMidi })], []);
  return (
    <PianoMidiProvider>
      <GamingRuntime
        gameId={gameId}
        participants={participants}
        providers={providers}
        onClose={clear}
      />
    </PianoMidiProvider>
  );
}
