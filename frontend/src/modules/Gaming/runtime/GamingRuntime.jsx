import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { CardBattleView } from '../views/CardBattleView.jsx';
import { PokemonJourneyLobby } from '../views/PokemonJourneyLobby.jsx';
import { PokemonJourneyView } from '../views/PokemonJourneyView.jsx';
import { createGamingApi } from './gamingApi.js';
import { GamingController } from './GamingController.js';
import { createProviderRegistry } from './providerRegistry.js';

const JOURNEY_VIEW = 'pokemon-practice-journey-v1';

function SessionRuntime({
  gameId,
  participants,
  providers,
  setup,
  bootstrapMeta,
  onClose,
  onChangePartner,
}) {
  const viewerId = participants[0]?.user_id || participants[0]?.id || 'guest';
  const api = useMemo(() => createGamingApi(), []);
  const storageKey = `gaming:${gameId}:${viewerId}:active-session`;
  const resumeSessionId = useMemo(() => window.localStorage.getItem(storageKey), [storageKey]);
  const controller = useMemo(() => new GamingController({
    api,
    providerRegistry: createProviderRegistry(providers),
    gameId,
    participants,
    viewerId,
    resumeSessionId,
    setup,
    logger: getChildLogger({ app: 'gaming', game: gameId }),
  }), [api, gameId, participants, providers, resumeSessionId, setup, viewerId]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [meta, setMeta] = useState(bootstrapMeta);

  const refreshMeta = useCallback(async () => {
    try {
      const [progress, leaderboard] = await Promise.all([
        api.getProgress(gameId, viewerId),
        api.getLeaderboard(gameId, viewerId),
      ]);
      setMeta({ progress, leaderboard });
    } catch (error) {
      getChildLogger({ app: 'gaming', game: gameId }).warn('gaming.journey.meta-refresh-failed', {
        userId: viewerId, error: error.message,
      });
    }
  }, [api, gameId, viewerId]);

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

  const metaRefreshKey = snapshot.session?.definition?.view_id === JOURNEY_VIEW
    ? `${snapshot.session?.state?.phase}:${snapshot.session?.state?.completed_encounters?.length}:${snapshot.session?.status}`
    : null;
  useEffect(() => {
    if (metaRefreshKey) refreshMeta();
  }, [metaRefreshKey, refreshMeta]);

  if (snapshot.phase === 'loading') return <main className="gaming-shell gaming-loading">Preparing journey…</main>;
  if (snapshot.phase === 'error' && !snapshot.session) {
    return <main className="gaming-shell gaming-error"><h1>Journey unavailable</h1><p>{snapshot.error?.message}</p></main>;
  }
  const viewId = snapshot.session?.definition?.view_id;
  if (viewId === JOURNEY_VIEW) {
    return (
      <PokemonJourneyView
        session={snapshot.session}
        providerRuntime={snapshot.providerRuntime}
        combatResult={snapshot.combatResult}
        error={snapshot.error}
        progress={meta?.progress || null}
        leaderboard={meta?.leaderboard || null}
        onChoose={(id) => controller.chooseAction(id)}
        onContinue={() => controller.continueEncounter()}
        onRetry={() => controller.retryEncounter()}
        onRestart={(partnerId) => controller.restart(partnerId)}
        onChangePartner={onChangePartner}
        onAbort={() => controller.abortChallenge()}
        onClose={() => controller.close().finally(() => onClose?.())}
      />
    );
  }
  return (
    <CardBattleView
      session={snapshot.session}
      providerRuntime={snapshot.providerRuntime}
      combatResult={snapshot.combatResult}
      error={snapshot.error}
      onChoose={(id) => controller.chooseAction(id)}
      onEndTurn={() => controller.endTurn()}
      onRestart={(upgradeId) => controller.restart(upgradeId)}
      onAbort={() => controller.abortChallenge()}
      onClose={() => controller.close().finally(() => onClose?.())}
    />
  );
}

export default function GamingRuntime({ gameId = 'scale-clash', participants = [], providers = [], onClose = null }) {
  const viewerId = participants[0]?.user_id || participants[0]?.id || 'guest';
  const api = useMemo(() => createGamingApi(), []);
  const [bootstrap, setBootstrap] = useState({ phase: 'loading', definition: null, progress: null, leaderboard: null, error: null });
  const [partnerId, setPartnerId] = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const loaded = await api.getDefinition(gameId);
        let progress = null;
        let leaderboard = null;
        if (loaded.definition?.view_id === JOURNEY_VIEW) {
          [progress, leaderboard] = await Promise.all([
            api.getProgress(gameId, viewerId),
            api.getLeaderboard(gameId, viewerId),
          ]);
        }
        if (live) setBootstrap({ phase: 'ready', definition: loaded.definition, progress, leaderboard, error: null });
      } catch (error) {
        if (live) setBootstrap({ phase: 'error', definition: null, progress: null, leaderboard: null, error });
      }
    })();
    return () => { live = false; };
  }, [api, gameId, viewerId]);

  const isJourney = bootstrap.definition?.view_id === JOURNEY_VIEW;
  const setup = useMemo(() => (partnerId ? { partner_id: partnerId } : {}), [partnerId]);
  if (bootstrap.phase === 'loading') return <main className="gaming-shell gaming-loading">Opening Scale Stadium…</main>;
  if (bootstrap.phase === 'error') {
    return <main className="gaming-shell gaming-error"><h1>Game unavailable</h1><p>{bootstrap.error?.message}</p></main>;
  }
  if (isJourney && !partnerId) {
    return (
      <PokemonJourneyLobby
        definition={bootstrap.definition}
        progress={bootstrap.progress}
        leaderboard={bootstrap.leaderboard}
        userId={viewerId}
        onSelect={setPartnerId}
        onClose={onClose}
      />
    );
  }
  return (
    <SessionRuntime
      gameId={gameId}
      participants={participants}
      providers={providers}
      setup={setup}
      bootstrapMeta={{ progress: bootstrap.progress, leaderboard: bootstrap.leaderboard }}
      onChangePartner={isJourney ? () => setPartnerId(null) : null}
      onClose={onClose}
    />
  );
}
