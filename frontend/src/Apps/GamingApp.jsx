import { useMemo } from 'react';
import GamingRuntime from '../modules/Gaming/platform/runtime/GamingRuntime.jsx';

export default function GamingApp({ clear = null }) {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const userId = query.get('user') || 'guest';
  const gameId = query.get('game');
  const participants = useMemo(() => [{ user_id: userId, role: 'player' }], [userId]);
  return (
    <GamingRuntime gameId={gameId} participants={participants} onClose={clear} />
  );
}
