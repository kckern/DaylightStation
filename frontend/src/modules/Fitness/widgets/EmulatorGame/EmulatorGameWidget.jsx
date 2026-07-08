import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DaylightAPI, DaylightMediaPath } from '../../../../lib/api.mjs';
import getLogger from '../../../../lib/logging/Logger.js';
import { isKioskEnv } from '@/lib/kioskEnv.js';
import { EmulatorConsole } from '../../../Emulator/EmulatorConsole.jsx';
import { ArcadeShell } from '../../../Emulator/ui/ArcadeShell.jsx';
import { PlayerSelect } from '../../../Emulator/ui/PlayerSelect.jsx';
import { EmulatorToasts } from '../../../Emulator/ui/EmulatorToasts.jsx';
import { buildEjsControls } from '../../../Emulator/input/buildEjsControls.js';
import { createSaveClient } from '../../../Emulator/core/saveClient.js';
import { supportsSave, freshLaunch, loadLaunch } from '../../../Emulator/core/launchModel.js';
import { buildFitnessGameGate } from './fitnessGameGate.js';
import { useIdentity } from '../../identity/IdentityProvider';
import UnlockPrompt from '../../player/overlays/UnlockPrompt.jsx';

const ENGINE_PATH = '/api/v1/emulator/engine/';
const DEFAULT_AUTOSAVE_SECONDS = 15;
const DEFAULT_IDLE_RELOCK_MINUTES = 10;

/**
 * Class for the portaled fullscreen wrapper. The running emulator is rendered via
 * createPortal to document.body, so it escapes the `.fitness-app-container.kiosk-ui`
 * cursor-hide scope. Tagging the wrapper with `kiosk-ui` lets EmulatorConsole.scss
 * re-apply the cursor-hide rule there.
 */
export function fullscreenClass(isKiosk) {
  return `fitness-emulator-fullscreen${isKiosk ? ' kiosk-ui' : ''}`;
}

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
 * Browse (open) → admin-gate the FIRST launch of a session → boot fresh +
 * anonymous → optional post-launch identity (load a saver, or claim to save).
 * The console + engine lifecycle lives in EmulatorConsole; this widget owns
 * the session unlock, identity surface, and save decisions.
 */
export default function EmulatorGameWidget({ fitnessContext, onClose, config, onMount }) {
  const logger = useMemo(() => getLogger().child({ component: 'fitness-emulator' }), []);
  const { registerIdentify, registerAdmin, clearUnlock, unlockState, unlockedUser } = useIdentity();

  const [library, setLibrary] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('arcade'); // 'arcade' | 'admin' | 'identify' | 'playing'
  const [arcadeUnlocked, setArcadeUnlocked] = useState(false);
  const [pendingGame, setPendingGame] = useState(null);
  const [launch, setLaunch] = useState(null);
  const [savers, setSavers] = useState([]);
  const [playerSelectOpen, setPlayerSelectOpen] = useState(false);
  const [selectMessage, setSelectMessage] = useState(null);
  const [claimConflict, setClaimConflict] = useState(null);

  const saveClient = useMemo(() => createSaveClient(), []);
  const zonesOrder = useMemo(() => Object.keys(fitnessContext?.zones || {}), [fitnessContext]);
  const getActivePlayerId = fitnessContext?.getActivePlayerId
    || (() => fitnessContext?.fitnessSessionInstance?.roster?.[0]?.userId ?? null);
  const getUserVitals = fitnessContext?.getUserVitals || (() => null);

  const settings = library?.settings || {};
  const autosaveSeconds = Number.isFinite(Number(settings.autosaveSeconds)) ? Number(settings.autosaveSeconds) : DEFAULT_AUTOSAVE_SECONDS;
  const idleRelockMinutes = Number.isFinite(Number(settings.idleRelockMinutes)) ? Number(settings.idleRelockMinutes) : DEFAULT_IDLE_RELOCK_MINUTES;
  const adminGate = settings.adminGate !== false;

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
        settings: lib?.settings || {},
      });
      logger.info('fitness-emulator.library-loaded', { games: (lib?.games || []).length, consoles: (lib?.consoles || []).length });
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

  // Hand the gamepad to EmulatorJS only while a game is up.
  useEffect(() => {
    window.__emulatorCapturingGamepad = view === 'playing';
    return () => { window.__emulatorCapturingGamepad = false; };
  }, [view]);

  // Idle re-lock: while sitting at the unlocked grid, re-lock after N minutes.
  useEffect(() => {
    if (!arcadeUnlocked || view !== 'arcade' || !idleRelockMinutes) return undefined;
    const id = setTimeout(() => {
      setArcadeUnlocked(false);
      logger.info('fitness-emulator.relock', {});
    }, idleRelockMinutes * 60 * 1000);
    return () => clearTimeout(id);
  }, [arcadeUnlocked, view, idleRelockMinutes, logger]);

  // Resolve a person card (name + avatar) for a userId.
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

  // Build the per-user save/resume contract (snapshot-preferred via saveClient).
  const buildPersistence = useCallback((game, { userId, persist }) => {
    const ctx = { system: game.system, gameId: game.id, user: userId, saveMode: game.saveMode };
    return {
      saveMode: game.saveMode,
      persist: !!persist,
      userId: userId || null,
      loadResume: () => (userId ? saveClient.loadResume(ctx) : Promise.resolve({ status: 'absent' })),
      saveResume: (captured) => (persist && userId ? saveClient.persistResume({ ...ctx, captured }) : Promise.resolve({ status: 'skipped' })),
      clearResume: () => (userId ? saveClient.clearResume(ctx) : Promise.resolve({ status: 'skipped' })),
    };
  }, [saveClient]);

  const buildLaunchContext = useCallback((game, { userId, persist }) => {
    const controls = buildEjsControls(library?.input?.keyboard || {}, resolveControllerGamepad(library?.input?.controllers));
    const gate = buildFitnessGameGate({ game, zonesOrder, getActivePlayerId, getUserVitals });
    const engineConfig = {
      pathtodata: ENGINE_PATH,
      core: game.core || library?.systems?.[game.system]?.core || game.system || 'gb',
      controls,
    };
    return { game, engineConfig, gate, persistence: buildPersistence(game, { userId, persist }) };
  }, [library, zonesOrder, getActivePlayerId, getUserVitals, buildPersistence]);

  // Commit a launch. `remountKey` forces a fresh console mount (the load path).
  const startGame = useCallback((game, decision, { remountKey } = {}) => {
    const ctx = buildLaunchContext(game, decision);
    setLaunch({
      ...ctx,
      userId: decision.userId,
      person: resolvePersonCard(decision.userId),
      startedAt: Date.now(),
      key: remountKey ?? `${game.id}:${decision.userId || 'anon'}:${Date.now()}`,
    });
    setView('playing');
    logger.info('fitness-emulator.launch', { game: game.id, action: decision.action, persist: decision.persist, user: decision.userId || null });
  }, [buildLaunchContext, resolvePersonCard, logger]);

  // Fetch savers + open the transient identity surface (save-enabled, kiosk only).
  const openIdentitySurface = useCallback((game) => {
    if (!supportsSave(game.saveMode) || !isKioskEnv()) return;
    DaylightAPI(`api/v1/emulator/saves/${game.system}/${game.id}`).then((r) => {
      const users = Array.isArray(r?.users) ? r.users : [];
      setSavers(users.map((uid) => resolvePersonCard(uid)).filter(Boolean));
      setPlayerSelectOpen(true);
      logger.info('fitness-emulator.savers-loaded', { game: game.id, count: users.length });
    }).catch((e) => {
      setSavers([]);
      setPlayerSelectOpen(true);
      logger.warn('fitness-emulator.savers-failed', { error: e.message });
    });
  }, [resolvePersonCard, logger]);

  // Launch a game fresh + anonymous, then surface identity for save games.
  const launchFresh = useCallback((game) => {
    setSelectMessage(null);
    setClaimConflict(null);
    startGame(game, freshLaunch());
    openIdentitySurface(game);
  }, [startGame, openIdentitySurface]);

  // Game tapped → admin gate ONCE per session, then launch.
  const handleSelectGame = useCallback((game) => {
    if (arcadeUnlocked || !adminGate || !isKioskEnv()) { launchFresh(game); return; }
    setPendingGame(game);
    setView('admin');
    registerAdmin('emulator').then((verdict) => {
      setPendingGame(null);
      if (verdict?.matched) {
        setArcadeUnlocked(true);
        launchFresh(game);
      } else {
        setView('arcade');
      }
    });
  }, [arcadeUnlocked, adminGate, registerAdmin, launchFresh]);

  const cancelGate = useCallback(() => {
    setView(launch ? 'playing' : 'arcade');
    clearUnlock();
  }, [clearUnlock, launch]);

  // Flip the running session to persist under userId (post-mount; no remount).
  const activateSave = useCallback((userId) => {
    setClaimConflict(null);
    setPlayerSelectOpen(false);
    setSelectMessage(null);
    setLaunch((prev) => (prev
      ? { ...prev, userId, person: resolvePersonCard(userId), persistence: buildPersistence(prev.game, { userId, persist: true }) }
      : prev));
    logger.info('fitness-emulator.claim', { user: userId });
  }, [buildPersistence, resolvePersonCard, logger]);

  // Load a saver's existing save: verify it IS them, then remount as that user.
  const handleLoadSaver = useCallback((userId) => {
    const game = launch?.game;
    if (!game) return;
    const name = resolvePersonCard(userId)?.name || userId;
    setPendingGame(game);
    setView('identify');
    registerIdentify(`Continue as ${name}`).then((verdict) => {
      setPendingGame(null);
      setView('playing');
      if (verdict?.matched && String(verdict.userId).toLowerCase() === String(userId).toLowerCase()) {
        setPlayerSelectOpen(false);
        setSelectMessage(null);
        startGame(game, loadLaunch(userId), { remountKey: `${game.id}:${userId}:${Date.now()}` });
      } else if (verdict?.matched) {
        setSelectMessage(`That's not ${name}.`);
      }
    });
  }, [launch, registerIdentify, resolvePersonCard, startGame]);

  // "Save my game": identify whoever scans → claim (warn if they already have a save).
  const handleClaim = useCallback(() => {
    const game = launch?.game;
    if (!game) return;
    setPendingGame(game);
    setView('identify');
    registerIdentify('Save my game').then((verdict) => {
      setPendingGame(null);
      setView('playing');
      if (!verdict?.matched) return;
      const uid = verdict.userId;
      if (savers.some((s) => String(s.userId).toLowerCase() === String(uid).toLowerCase())) {
        setClaimConflict(resolvePersonCard(uid));
      } else {
        activateSave(uid);
      }
    });
  }, [launch, registerIdentify, savers, resolvePersonCard, activateSave]);

  const handleExitGame = useCallback(() => {
    setLaunch(null);
    setView('arcade');
    setPlayerSelectOpen(false);
    setSavers([]);
    setSelectMessage(null);
    setClaimConflict(null);
  }, []);

  if (error) return <div className="fitness-emulator__error">Video games unavailable: {error}</div>;
  if (!library) return <div className="fitness-emulator__loading">Loading…</div>;

  const anonymousSaveGame = view === 'playing' && launch && supportsSave(launch.game.saveMode) && !launch.userId;

  return (
    <>
      {/* Connect/disconnect toasts for known controllers (BlueZ bt_inventory
          feed); self-portals to <body> so it shows over arcade + in-game. */}
      <EmulatorToasts
        btInventory={fitnessContext?.btInventory}
        controllers={library.input?.controllers || []}
      />
      <ArcadeShell
        consoles={library.consoles}
        games={library.games}
        onSelectGame={handleSelectGame}
        onExit={onClose}
        resolveMediaUrl={(p) => DaylightMediaPath(p)}
        inputEnabled={view === 'arcade'}
        controllers={library.input?.controllers || []}
        btInventory={fitnessContext?.btInventory}
        controllerPairing={fitnessContext?.controllerPairing}
        onPairController={fitnessContext?.pairController}
        onForgetController={fitnessContext?.forgetController}
      />
      <UnlockPrompt
        open={view === 'admin' || view === 'identify'}
        state={unlockState}
        lockLabel={pendingGame
          ? (view === 'admin' ? `Admin unlock — ${pendingGame.title || pendingGame.id}` : `Verify — ${pendingGame.title || pendingGame.id}`)
          : null}
        unlockedUser={unlockedUser}
        onCancel={cancelGate}
      />
      {view !== 'arcade' && launch && createPortal(
        <div className={fullscreenClass(isKioskEnv())}>

          <EmulatorConsole
            key={launch.key}
            game={launch.game}
            engineConfig={launch.engineConfig}
            governanceGate={launch.gate}
            identity={{ getActivePlayerId: () => launch.userId }}
            persistence={launch.persistence}
            autosaveSeconds={autosaveSeconds}
            nowPlaying={launch.person}
            playStartedAt={launch.startedAt}
            resolveMediaUrl={(p) => DaylightMediaPath(p)}
            showInputActivity={settings.inputActivityLed !== false}
            onExit={handleExitGame}
          />
          {anonymousSaveGame && (
            <PlayerSelect
              visible={playerSelectOpen}
              savers={savers}
              message={selectMessage}
              onLoad={handleLoadSaver}
              onClaim={handleClaim}
              onDismiss={() => setPlayerSelectOpen(false)}
              onReopen={() => setPlayerSelectOpen(true)}
            />
          )}
          {claimConflict && (
            <div className="fitness-emulator-claim-conflict" role="alertdialog" aria-label="Overwrite save">
              <div className="fitness-emulator-claim-conflict__card">
                <p>This replaces {claimConflict.name}&apos;s saved game. Continue?</p>
                <div className="fitness-emulator-claim-conflict__actions">
                  <button type="button" onClick={() => setClaimConflict(null)}>Cancel</button>
                  <button type="button" onClick={() => activateSave(claimConflict.userId)}>Overwrite</button>
                </div>
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
