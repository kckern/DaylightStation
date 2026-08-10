import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { CardBattleView } from '../views/CardBattleView.jsx';
import { createGamingApi } from './gamingApi.js';
import { GamingController } from './GamingController.js';
import { createProviderRegistry } from './providerRegistry.js';

export default function GamingRuntime({ gameId = 'scale-clash', participants = [], providers = [], onClose = null }) {
  const viewerId = participants[0]?.user_id || participants[0]?.id || 'guest';
  const storageKey = `gaming:${gameId}:${viewerId}:active-session`;
  const resumeSessionId = useMemo(() => window.localStorage.getItem(storageKey), [storageKey]);
  const controller = useMemo(() => new GamingController({
    api: createGamingApi(),
    providerRegistry: createProviderRegistry(providers),
    gameId,
    participants,
    viewerId,
    resumeSessionId,
    logger: getChildLogger({ app: 'gaming', game: gameId }),
  }), [gameId, participants, providers, viewerId, resumeSessionId]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(() => {
    controller.start();
    return () => controller.dispose();
  }, [controller]);

  useEffect(() => {
    const session = snapshot.session;
    if (!session) return;
    if (session.status === 'active') window.localStorage.setItem(storageKey, session.session_id);
    else window.localStorage.removeItem(storageKey);
  }, [snapshot.session, storageKey]);

  if (snapshot.phase === 'loading') return <main className="gaming-shell gaming-loading">Preparing battle…</main>;
  if (snapshot.phase === 'error' && !snapshot.session) {
    return <main className="gaming-shell gaming-error"><h1>Battle unavailable</h1><p>{snapshot.error?.message}</p></main>;
  }
  return (
    <CardBattleView
      session={snapshot.session}
      providerRuntime={snapshot.providerRuntime}
      combatResult={snapshot.combatResult}
      error={snapshot.error}
      onChoose={(id) => controller.chooseAction(id)}
      onAbort={() => controller.abortChallenge()}
      onClose={onClose}
    />
  );
}
