import { useMemo } from 'react';
import GamingRuntime from "../../../__capabilities/gaming/browser/platform/runtime/GamingRuntime.jsx";
import { GAMING_PRESENTERS } from "../composition/gaming/presenterRegistry.js";

export default function GamingApp({ clear = null }) {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const userId = query.get('user') || 'guest';
  const gameId = query.get('game');
  const surfaceId = query.get('surface') || 'developer';
  const participants = useMemo(() => [{ user_id: userId, role: 'player' }], [userId]);
  return (
    <GamingRuntime gameId={gameId} surfaceId={surfaceId} participants={participants} presenters={GAMING_PRESENTERS} onClose={clear} />
  );
}
