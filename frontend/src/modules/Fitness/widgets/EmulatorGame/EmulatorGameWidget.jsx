import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DaylightAPI, DaylightMediaPath } from '../../../../lib/api.mjs';
import getLogger from '../../../../lib/logging/Logger.js';
import { isKioskEnv } from '@/lib/kioskEnv.js';
import { EmulatorConsole } from '../../../Emulator/EmulatorConsole.jsx';
import { ArcadeShell } from '../../../Emulator/ui/ArcadeShell.jsx';
import { buildEjsControls } from '../../../Emulator/input/buildEjsControls.js';
import { createSaveClient } from '../../../Emulator/core/saveClient.js';
import { resolveLaunch, requiresIdentity } from '../../../Emulator/core/launchModel.js';
import { buildFitnessGameGate } from './fitnessGameGate.js';
import { useIdentity } from '../../identity/IdentityProvider';
import UnlockPrompt from '../../player/overlays/UnlockPrompt.jsx';

// Absolute path so EmulatorJS's `${pathtodata}loader.js` resolves from the origin root.
const ENGINE_PATH = '/api/v1/emulator/engine/';

/**
 * Resolve the per-controller gamepad value2 override (special mappings live in
 * input.yml under each controller). Prefer a controller whose `match` regex hits
 * a connected pad; else the first controller defining an override.
 */
function resolveControllerGamepad(controllers) {
  const list = Array.isArray(controllers) ? controllers : [];
  const pads = (typeof navigator !== 'undefined' && navigator.getGamepads)
    ? Array.from(navigator.getGamepads()).filter(Boolean)
    : [];
  for (const c of list) {
    if (!c?.gamepad) continue;
    let re = null;
    try { re = c.match ? new RegExp(c.match, 'i') : null; } catch { re = null; }
    if (re && pads.some((p) => re.test(p.id))) return c.gamepad;
  }
  return list.find((c) => c?.gamepad)?.gamepad || {};
}

/**
 * EmulatorGameWidget — the "Video Games" arcade shell host.
 *
 * Views: 'arcade' (console tabs + game grid) → 'identify' (fingerprint up front
 * for save-enabled games) → 'playing' (governed console with per-user save).
 * The console + engine lifecycle lives in EmulatorConsole; this widget owns
 * selection, identity, and the save/resume decision.
 */
export default function EmulatorGameWidget({ fitnessContext, onClose, config, onMount }) {
  const logger = useMemo(() => getLogger().child({ component: 'fitness-emulator' }), []);
  const { registerIdentify, clearUnlock, unlockState, unlockedUser } = useIdentity();

  const [library, setLibrary] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('arcade'); // 'arcade' | 'identify' | 'playing'
  const [pendingGame, setPendingGame] = useState(null); // game awaiting identity
  const [launch, setLaunch] = useState(null); // { game, engineConfig, gate, persistence, person, startedAt }

  const saveClient = useMemo(() => createSaveClient(), []);
  const zonesOrder = useMemo(() => Object.keys(fitnessContext?.zones || {}), [fitnessContext]);
  const getActivePlayerId = fitnessContext?.getActivePlayerId
    || (() => fitnessContext?.fitnessSessionInstance?.roster?.[0]?.userId ?? null);
  const getUserVitals = fitnessContext?.getUserVitals || (() => null);

  // --- Load the library once ---
  useEffect(() => {
    let alive = true;
    DaylightAPI('api/v1/emulator/library').then((lib) => {
      if (!alive) return;
      setLibrary({
        games: lib?.games || [],
        consoles: lib?.consoles || [],
        systems: lib?.systems || {},
        input: lib?.input || {},
      });
      logger.info('fitness-emulator.library-loaded', {
        games: (lib?.games || []).length,
        consoles: (lib?.consoles || []).length,
      });
      onMount?.();
    }).catch((e) => {
      if (!alive) return;
      setError(e.message);
      logger.error('fitness-emulator.load-failed', { error: e.message });
      onMount?.();
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hand the gamepad to EmulatorJS only while a game is up; the arcade shell uses
  // the pad for grid navigation otherwise.
  useEffect(() => {
    window.__emulatorCapturingGamepad = view === 'playing';
    return () => { window.__emulatorCapturingGamepad = false; };
  }, [view]);

  // Build the engine config, governance gate, and per-user persistence contract.
  const buildLaunchContext = useCallback((game, { userId, persist }) => {
    const controls = buildEjsControls(library?.input?.keyboard || {}, resolveControllerGamepad(library?.input?.controllers));
    const gate = buildFitnessGameGate({ game, zonesOrder, getActivePlayerId, getUserVitals });
    const engineConfig = {
      pathtodata: ENGINE_PATH,
      core: library?.systems?.[game.system]?.core || game.system || 'gb',
      controls,
    };
    const ctx = { system: game.system, gameId: game.id, user: userId, saveMode: game.saveMode };
    const persistence = {
      saveMode: game.saveMode,
      persist: !!persist,
      userId: userId || null,
      loadResume: () => (userId ? saveClient.loadResume(ctx) : Promise.resolve(null)),
      saveResume: (body) => (persist && userId ? saveClient.persist({ ...ctx, body }) : Promise.resolve(false)),
      clearResume: () => (userId ? saveClient.clear(ctx) : Promise.resolve(false)),
    };
    return { game, engineConfig, gate, persistence };
  }, [library, zonesOrder, getActivePlayerId, getUserVitals, saveClient]);

  // Resolve the person card (name + avatar) for the now-playing overlay.
  const resolvePersonCard = useCallback((userId) => {
    if (!userId) return null;
    const roster = fitnessContext?.userCollections?.all || [];
    const match = roster.find((u) => [u?.id, u?.slug, u?.name].filter(Boolean)
      .map((s) => String(s).toLowerCase()).includes(String(userId).toLowerCase()));
    return {
      userId,
      name: match?.displayName || match?.name || match?.title || userId,
      avatarSrc: DaylightMediaPath(`/static/img/users/${userId}`),
    };
  }, [fitnessContext]);

  // Commit a launch: build context, capture start time, switch to 'playing'.
  const startGame = useCallback((game, decision) => {
    const ctx = buildLaunchContext(game, decision);
    setLaunch({
      ...ctx,
      userId: decision.userId,
      person: resolvePersonCard(decision.userId),
      startedAt: Date.now(),
    });
    setView('playing');
    logger.info('fitness-emulator.launch', { game: game.id, action: decision.action, persist: decision.persist });
  }, [buildLaunchContext, resolvePersonCard, logger]);

  // Game tapped in the shell.
  const handleSelectGame = useCallback((game) => {
    if (!requiresIdentity(game.saveMode) || !isKioskEnv()) {
      // No-save game, or dev/off-kiosk: boot fresh & anonymous (no persistence).
      startGame(game, resolveLaunch({ saveMode: 'none' }));
      return;
    }
    // Save-enabled on kiosk: fingerprint up front.
    setPendingGame(game);
    setView('identify');
    registerIdentify(game.title || game.id).then(async (verdict) => {
      setPendingGame(null);
      if (!verdict?.matched || !verdict.userId) {
        // Cancelled / unrecognized → cold start (plays, never persists).
        startGame(game, resolveLaunch({ saveMode: game.saveMode, userId: null }));
        return;
      }
      const resume = await saveClient.loadResume({ system: game.system, gameId: game.id, user: verdict.userId, saveMode: game.saveMode });
      startGame(game, resolveLaunch({ saveMode: game.saveMode, userId: verdict.userId, hasSave: !!resume }));
    });
  }, [registerIdentify, saveClient, startGame]);

  const cancelIdentify = useCallback(() => {
    setView('arcade');
    clearUnlock(); // resolves the registerIdentify promise with matched:false
  }, [clearUnlock]);

  const handleExitGame = useCallback(() => {
    setLaunch(null);
    setView('arcade');
  }, []);

  if (error) return <div className="fitness-emulator__error">Video games unavailable: {error}</div>;
  if (!library) return <div className="fitness-emulator__loading">Loading…</div>;

  if (view === 'playing' && launch) {
    return (
      <EmulatorConsole
        game={launch.game}
        engineConfig={launch.engineConfig}
        governanceGate={launch.gate}
        identity={{ getActivePlayerId: () => launch.userId }}
        persistence={launch.persistence}
        nowPlaying={launch.person}
        playStartedAt={launch.startedAt}
        resolveMediaUrl={(p) => DaylightMediaPath(p)}
        onExit={handleExitGame}
      />
    );
  }

  return (
    <>
      <ArcadeShell
        consoles={library.consoles}
        games={library.games}
        onSelectGame={handleSelectGame}
        onExit={onClose}
        resolveMediaUrl={(p) => DaylightMediaPath(p)}
        inputEnabled={view === 'arcade'}
      />
      <UnlockPrompt
        open={view === 'identify'}
        state={unlockState}
        lockLabel={pendingGame ? `Play as yourself — ${pendingGame.title || pendingGame.id}` : null}
        unlockedUser={unlockedUser}
        onCancel={cancelIdentify}
      />
    </>
  );
}
