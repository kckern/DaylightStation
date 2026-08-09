import { useMemo } from 'react';
import GamingRuntime from '../modules/Gaming/runtime/GamingRuntime.jsx';
import { createPianoChordProvider } from '../modules/Piano/challenge/provider/createPianoChordProvider.jsx';
import { PianoMidiProvider, usePianoMidiNotes } from '../modules/Piano/PianoKiosk/PianoMidiContext.jsx';

export default function GamingApp({ clear = null }) {
  const userId = useMemo(() => new URLSearchParams(window.location.search).get('user') || 'guest', []);
  const participants = useMemo(() => [{ user_id: userId, role: 'player' }], [userId]);
  const providers = useMemo(() => [createPianoChordProvider({ useNotes: usePianoMidiNotes })], []);
  return (
    <PianoMidiProvider>
      <GamingRuntime
        gameId="scale-clash"
        participants={participants}
        providers={providers}
        onClose={clear}
      />
    </PianoMidiProvider>
  );
}
