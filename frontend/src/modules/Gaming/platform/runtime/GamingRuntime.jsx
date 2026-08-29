import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getChildLogger } from '../../../../lib/logging/singleton.js';
import { createGamingApi } from './gamingApi.js';
import { GamingController } from './GamingController.js';
import { createProviderRegistry } from './providerRegistry.js';

const EMPTY_PRESENTERS = Object.freeze({});

function SessionRuntime({ gameId, surfaceId, launchDescriptor, participants, providers, presenters, resumeSessionId = null, onClose }) {
  const viewerId = participants[0]?.user_id || participants[0]?.id || 'guest';
  const api = useMemo(() => createGamingApi(), []);
  const storageKey = `gaming:${gameId}:${viewerId}:active-session`;
  const storedSessionId = useMemo(
    () => resumeSessionId || window.localStorage.getItem(storageKey),
    [resumeSessionId, storageKey],
  );
  const logger = useMemo(() => getChildLogger({ app: 'gaming', game: gameId, sessionLog: true }), [gameId]);
  const controller = useMemo(() => new GamingController({
    api,
    providerRegistry: createProviderRegistry(providers),
    gameId,
    surfaceId,
    participants,
    viewerId,
    resumeSessionId: storedSessionId,
    logger,
  }), [api, gameId, logger, participants, providers, storedSessionId, surfaceId, viewerId]);
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

  if (snapshot.phase === 'loading') return <main className="gaming-shell gaming-loading">Preparing game…</main>;
  if (snapshot.phase === 'error' && !snapshot.session) {
    return <main className="gaming-shell gaming-error"><h1>Game unavailable</h1><p>{snapshot.error?.message}</p></main>;
  }
  const Surface = presenters[launchDescriptor.presenter_id];
  if (!Surface) {
    return <main className="gaming-shell gaming-error"><h1>Unsupported game presenter</h1><p>{launchDescriptor.presenter_id}</p></main>;
  }
  return (
    <Surface
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

export default function GamingRuntime({ gameId, surfaceId, authorityMode = null, participants = [], providers = [], presenters = EMPTY_PRESENTERS, onClose = null }) {
  const api = useMemo(() => createGamingApi(), []);
  const [bootstrap, setBootstrap] = useState({ phase: 'loading', launchDescriptor: null, error: null });

  useEffect(() => {
    let live = true;
    if (!gameId || !surfaceId) return undefined;
    api.getLaunchDescriptor(gameId, surfaceId, authorityMode)
      .then((descriptor) => {
        if (!presenters[descriptor.presenter_id]) throw new Error(`Unsupported mounted presenter: ${descriptor.presenter_id || 'missing'}`);
        if (live) setBootstrap({ phase: 'ready', launchDescriptor: descriptor, error: null });
      })
      .catch((error) => {
        if (live) setBootstrap({ phase: 'error', launchDescriptor: null, error });
      });
    return () => { live = false; };
  }, [api, authorityMode, gameId, presenters, surfaceId]);

  if (!gameId) return <main className="gaming-shell gaming-error"><h1>Game unavailable</h1><p>No mounted game was selected.</p></main>;
  if (!surfaceId) return <main className="gaming-shell gaming-error"><h1>Game unavailable</h1><p>No launch surface was selected.</p></main>;
  if (bootstrap.phase === 'loading') return <main className="gaming-shell gaming-loading">Opening game…</main>;
  if (bootstrap.phase === 'error') {
    return <main className="gaming-shell gaming-error"><h1>Game unavailable</h1><p>{bootstrap.error?.message}</p></main>;
  }
  return <SessionRuntime gameId={gameId} surfaceId={surfaceId} launchDescriptor={bootstrap.launchDescriptor} participants={participants} providers={providers} presenters={presenters} onClose={onClose} />;
}
