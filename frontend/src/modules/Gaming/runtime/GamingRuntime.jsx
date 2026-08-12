import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { CardBattleView } from '../views/CardBattleView.jsx';
import { PokemonJourneyHub } from '../views/PokemonJourneyHub.jsx';
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
  resumeSessionId: requestedResumeSessionId = null,
  onClose,
  onChangePartner,
}) {
  const viewerId = participants[0]?.user_id || participants[0]?.id || 'guest';
  const api = useMemo(() => createGamingApi(), []);
  const storageKey = `gaming:${gameId}:${viewerId}:active-session`;
  const resumeSessionId = useMemo(
    () => requestedResumeSessionId || window.localStorage.getItem(storageKey),
    [requestedResumeSessionId, storageKey],
  );
  // `sessionLog` routes every gaming.* event to media/logs/gaming/*.jsonl, so a
  // session that misbehaved can be read back whole instead of being chased
  // through container logs. Built once: a fresh sessionLog child opens a new
  // session file, so this must not be recreated per render.
  const logger = useMemo(() => getChildLogger({ app: 'gaming', game: gameId, sessionLog: true }), [gameId]);
  const controller = useMemo(() => new GamingController({
    api,
    providerRegistry: createProviderRegistry(providers),
    gameId,
    participants,
    viewerId,
    resumeSessionId,
    setup,
    logger,
  }), [api, gameId, logger, participants, providers, resumeSessionId, setup, viewerId]);
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
      logger.warn('gaming.journey.meta-refresh-failed', { userId: viewerId, error: error.message });
    }
  }, [api, gameId, logger, viewerId]);

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
        onSelectRecruit={(id) => controller.selectRecruit(id)}
        onSelectPartner={(id) => controller.selectPartner(id)}
        onStartGym={() => controller.startGym()}
        onRestart={(partnerId) => controller.restart(partnerId)}
        onChangePartner={onChangePartner}
        onAbort={() => controller.abortChallenge()}
        onSaveExit={() => controller.suspend().finally(() => onClose?.())}
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
  const [bootstrap, setBootstrap] = useState({ phase: 'loading', definition: null, progress: null, leaderboard: null, activeSession: null, error: null });
  const [launch, setLaunch] = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const loaded = await api.getDefinition(gameId);
        let progress = null;
        let leaderboard = null;
        let activeSession = null;
        if (loaded.definition?.view_id === JOURNEY_VIEW) {
          const active = await api.getActiveSession(gameId, viewerId);
          [progress, leaderboard] = await Promise.all([
            api.getProgress(gameId, viewerId),
            api.getLeaderboard(gameId, viewerId),
          ]);
          activeSession = active.active_session || null;
        }
        if (live) setBootstrap({ phase: 'ready', definition: loaded.definition, progress, leaderboard, activeSession, error: null });
      } catch (error) {
        if (live) setBootstrap({ phase: 'error', definition: null, progress: null, leaderboard: null, activeSession: null, error });
      }
    })();
    return () => { live = false; };
  }, [api, gameId, viewerId]);

  const isJourney = bootstrap.definition?.view_id === JOURNEY_VIEW;
  const setup = useMemo(() => (launch?.partnerId ? { partner_id: launch.partnerId } : {}), [launch]);
  if (bootstrap.phase === 'loading') return <main className="gaming-shell gaming-loading">Opening Card Game…</main>;
  if (bootstrap.phase === 'error') {
    return <main className="gaming-shell gaming-error"><h1>Game unavailable</h1><p>{bootstrap.error?.message}</p></main>;
  }
  if (isJourney && !launch) {
    return (
      <PokemonJourneyHub
        definition={bootstrap.definition}
        progress={bootstrap.progress}
        leaderboard={bootstrap.leaderboard}
        userId={viewerId}
        onStart={(partnerId) => setLaunch({ partnerId, resumeSessionId: null })}
        onResume={() => {
          const active = bootstrap.activeSession;
          if (active) setLaunch({ partnerId: active.state?.partner_id, resumeSessionId: active.session_id });
        }}
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
      resumeSessionId={launch?.resumeSessionId || null}
      bootstrapMeta={{ progress: bootstrap.progress, leaderboard: bootstrap.leaderboard }}
      onChangePartner={isJourney ? () => setLaunch(null) : null}
      onClose={isJourney ? () => setLaunch(null) : onClose}
    />
  );
}
