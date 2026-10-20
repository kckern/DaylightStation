import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createArcadeGameSessionReporter } from "./arcadeGameSessionReporter.js";
import { createPortal } from 'react-dom';
import { DaylightAPI, DaylightMediaPath } from "../../../../../../frontend/src/lib/api.mjs";
import getLogger from "../../../../../../frontend/src/lib/logging/Logger.js";
import { isKioskEnv, isLocalDevHost } from '@/lib/kioskEnv.js';
import { EmulatorConsole } from "../../../../../games/emulator/browser/EmulatorConsole.jsx";
import { ArcadeShell } from "../../../../../games/emulator/browser/ui/ArcadeShell.jsx";
import { PlayerPanel } from "../../../../../games/emulator/browser/ui/PlayerPanel.jsx";
import { EmulatorToasts } from "../../../../../games/emulator/browser/ui/EmulatorToasts.jsx";
import { buildEjsControls } from "../../../../../games/emulator/browser/input/buildEjsControls.js";
import { createSaveClient } from "../../../../../games/emulator/browser/core/saveClient.js";
import { supportsSave, freshLaunch, loadLaunch } from "../../../../../games/emulator/browser/core/launchModel.js";
import { loadEmulatorShaders } from "../../../../../games/emulator/browser/shaders/emulatorShaders.js";
import { buildFitnessGameGate } from "./fitnessGameGate.js";
import { useIdentity } from "../../identity/useIdentity.js";
import UnlockPrompt from "../../player/overlays/UnlockPrompt.jsx";
import { fullscreenClass } from "./emulatorGameWidgetLayout.js";
import { wsService } from "../../../../../../frontend/src/services/WebSocketService.js";
import { formatClock, useArcadeGameBudget } from "./useArcadeGameBudget.js";
import { findDirectLaunchGame } from "./directLaunch.js";

const ENGINE_PATH = '/api/v1/emulator/engine/';
const DEFAULT_AUTOSAVE_SECONDS = 15;
const DEFAULT_IDLE_RELOCK_MINUTES = 10;

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
export default function EmulatorGameWidget({ fitnessContext, deviceId = null, onClose, config, onMount }) {
  const logger = useMemo(() => getLogger().child({ component: 'fitness-emulator' }), []);
  const { registerIdentify, registerAdmin, clearUnlock, unlockState, unlockedUser } = useIdentity();

  const [library, setLibrary] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('arcade'); // 'arcade' | 'admin' | 'identify' | 'playing'
  const [arcadeUnlocked, setArcadeUnlocked] = useState(false);
  const [pendingGame, setPendingGame] = useState(null);
  const [launch, setLaunch] = useState(null);
  const [savers, setSavers] = useState([]);
  const [selectMessage, setSelectMessage] = useState(null);
  const [claimConflict, setClaimConflict] = useState(null);
  // Bumped to (re)open the game menu after a fingerprint step that ends in a
  // question or a cancel, so the choice is never left hidden behind play.
  const [menuOpenNonce, setMenuOpenNonce] = useState(0);
  const reopenMenu = useCallback(() => setMenuOpenNonce((n) => n + 1), []);
  // Arcade-level notice (e.g. "<Game> is <owner>'s game"), auto-clears.
  const [notice, setNotice] = useState(null);

  const saveClient = useMemo(() => createSaveClient(), []);
  const getActivePlayerId = useMemo(
    () => fitnessContext?.getActivePlayerId
      || (() => fitnessContext?.fitnessSessionInstance?.roster?.[0]?.userId ?? null),
    [fitnessContext?.getActivePlayerId, fitnessContext?.fitnessSessionInstance],
  );

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

  // Report play to the household meter.
  //
  // This surface knows its own lifecycle exactly, so it reports rather than
  // being watched from outside — the same observations the inferred source
  // produces, differing only in stated confidence.
  //
  // Device identity comes from the Fitness app's persisted ?device= binding.
  // Keep the old config key as a compatibility fallback for embedded callers.
  const meterDeviceId = deviceId ?? config?.meterDeviceId ?? null;
  const subscribeToPlay = useCallback(
    (topic, handler) => wsService.subscribe(topic, handler),
    [],
  );
  const arcadeGameBudget = useArcadeGameBudget({ deviceId: meterDeviceId, subscribe: subscribeToPlay });
  const reporterRef = useRef(null);
  useEffect(() => {
    if (!meterDeviceId) return undefined;
    const reporter = createArcadeGameSessionReporter({
      deviceId: meterDeviceId,
      post: (body) => DaylightAPI('api/v1/arcade-game-sessions/observations', body),
      getControllers: () => {
        try {
          return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
            ? Array.from(navigator.getGamepads() || []).filter(Boolean).length
            : null;
        } catch { return null; }
      },
      logger,
    });
    reporterRef.current = reporter;
    return () => {
      reporter.ended();
      if (reporterRef.current === reporter) reporterRef.current = null;
    };
  }, [meterDeviceId, logger]);

  const launchKey = launch?.key ?? null;
  useEffect(() => {
    const reporter = reporterRef.current;
    const game = launch?.game;
    if (!reporter || !launchKey || !game) return undefined;
    const consoleEntry = library?.consoles?.find((entry) => entry?.system === game.system);
    reporter.started({
      state: 'paused', // loaded now; EmulatorConsole confirms first rendered play below
      userId: launch.userId ?? null,
      loadId: launchKey,
      loadedAt: new Date(launch.startedAt).toISOString(),
      content: {
        contentId: `arcade:${game.system}/${game.id}`,
        title: game.title ?? null,
        console: game.system ?? null,
        consoleLabel: consoleEntry?.label ?? null,
      },
    });
    return () => { reporter.ended(); };
    // Identity changes preserve launchKey and are reported by the next effect.
  }, [launchKey, library?.consoles, meterDeviceId]);

  useEffect(() => {
    if (launchKey && launch?.userId) reporterRef.current?.updateIdentity(launch.userId);
  }, [launchKey, launch?.userId]);

  const handleArcadeGameSessionStateChange = useCallback((state) => {
    if (state === 'playing') reporterRef.current?.resumed();
    else reporterRef.current?.paused();
  }, []);

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
    // Economy: coin-metered spend is OFF by default. When config.economy.enabled
    // is on, the spender is whoever the identity surface unlocked (the
    // spend-authorization scan) else the active fitness player. buildFitnessGameGate
    // falls back to the free-play open gate when economy is off or no spender resolves.
    const economyEnabled = config?.economy?.enabled === true;
    const spenderId = unlockedUser?.userId
      || (typeof getActivePlayerId === 'function' ? getActivePlayerId() : null);
    const gate = buildFitnessGameGate({
      economyEnabled,
      getActivePlayerId: () => spenderId,
      action: config?.economy?.action || 'arcade-play',
      api: config?.economy?.api,
      settleIntervalSec: config?.economy?.settleIntervalSec,
    });
    const engineConfig = {
      pathtodata: ENGINE_PATH,
      core: game.core || library?.systems?.[game.system]?.core || game.system || 'gb',
      controls,
      // Our own picture-shader presets, registered with EmulatorJS at boot so a
      // manifest's presentation.ejs_shader can name one (the Game Boys' Harlequin
      // dot matrix). EmulatorJS's built-ins stay available alongside.
      shaders: loadEmulatorShaders,
    };
    return { game, engineConfig, gate, persistence: buildPersistence(game, { userId, persist }) };
  }, [library, getActivePlayerId, buildPersistence, config, unlockedUser]);

  // Commit a launch. `remountKey` forces a fresh console mount (the load path).
  const startGame = useCallback((game, decision, { remountKey } = {}) => {
    const ctx = buildLaunchContext(game, decision);
    // Ask "continue / save as me / just play" before any progress exists:
    // only where a fingerprint can answer (kiosk), only for a shared save
    // game, only when nobody's save is loaded. Never for owned games.
    const askAtLaunch = isKioskEnv() && supportsSave(game.saveMode) && !game.saveOwner && !decision.userId;
    setLaunch({
      ...ctx,
      userId: decision.userId,
      person: resolvePersonCard(decision.userId),
      startedAt: Date.now(),
      askAtLaunch,
      key: remountKey ?? `${game.id}:${decision.userId || 'anon'}:${Date.now()}`,
    });
    setView('playing');
    logger.info('fitness-emulator.launch', { game: game.id, action: decision.action, persist: decision.persist, user: decision.userId || null, askAtLaunch });
  }, [buildLaunchContext, resolvePersonCard, logger]);

  // Fetch who already has a save for this game — the menu's "Continue as" row
  // (save-enabled, kiosk only: the fingerprint reader lives there).
  const loadSavers = useCallback((game) => {
    if (!supportsSave(game.saveMode) || !isKioskEnv()) return;
    DaylightAPI(`api/v1/emulator/saves/${game.system}/${game.id}`).then((r) => {
      const users = Array.isArray(r?.users) ? r.users : [];
      setSavers(users.map((uid) => resolvePersonCard(uid)).filter(Boolean));
      logger.info('fitness-emulator.savers-loaded', { game: game.id, count: users.length });
    }).catch((e) => {
      setSavers([]);
      logger.warn('fitness-emulator.savers-failed', { error: e.message });
    });
  }, [resolvePersonCard, logger]);

  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  // A game with a save owner is ONE person's: verify it is them, then boot
  // straight into their save. Anyone else (or a cancelled scan) goes back to
  // the arcade with nothing loaded or written — the save API refuses other
  // writers too, so this is not the only line of defense.
  const launchOwned = useCallback((game) => {
    const owner = game.saveOwner;
    const ownerCard = resolvePersonCard(owner);
    const title = game.title || game.id;
    // The fingerprint prompt only exists on the garage kiosk (UnlockPrompt is
    // kiosk-bound). Off-kiosk a scan request would wait invisibly — and a later
    // garage touch would launch the game in THIS browser — so say where it plays.
    if (!isKioskEnv()) {
      logger.info('fitness-emulator.owned-launch.off-kiosk', { game: game.id, owner });
      setNotice(`${title} is ${ownerCard?.name || owner}'s game — play it at the garage.`);
      return;
    }
    setPendingGame(game);
    setView('identify');
    logger.info('fitness-emulator.owned-launch.verify', { game: game.id, owner });
    registerIdentify(`${title} — ${ownerCard?.name || owner}'s game`).then((verdict) => {
      setPendingGame(null);
      if (verdict?.matched && String(verdict.userId).toLowerCase() === String(owner).toLowerCase()) {
        logger.info('fitness-emulator.owned-launch.match', { game: game.id, owner });
        setSelectMessage(null);
        setClaimConflict(null);
        startGame(game, loadLaunch(owner));
        return;
      }
      setView('arcade');
      if (verdict?.matched) {
        logger.warn('fitness-emulator.owned-launch.mismatch', { game: game.id, owner, user: verdict.userId });
        setNotice(`${title} is ${ownerCard?.name || owner}'s game.`);
      } else {
        logger.info('fitness-emulator.owned-launch.cancel', { game: game.id, owner });
      }
    });
  }, [registerIdentify, resolvePersonCard, startGame, logger]);

  // Launch a game: an owned save game verifies its owner first; anything else
  // boots fresh + anonymous, with saving opt-in from the game menu.
  const launchFresh = useCallback((game) => {
    setSelectMessage(null);
    setClaimConflict(null);
    setSavers([]);
    if (game.saveOwner && supportsSave(game.saveMode)) { launchOwned(game); return; }
    startGame(game, freshLaunch());
    loadSavers(game);
  }, [startGame, loadSavers, launchOwned]);

  // Game tapped → admin gate ONCE per session, then launch.
  //
  // THE GATE IS NOT A KIOSK FEATURE. It used to apply only where isKioskEnv()
  // was true — the garage Firefox — so any other browser in the house opened
  // games with no approval. A developer's localhost is the one exemption, and a
  // gate turned off in settings.yml says so on every launch it lets through:
  // on 2026-09-12 a test override left `adminGate: false` in the live file and
  // the arcade stayed open for a day with nothing in the log to show it.
  const handleSelectGame = useCallback((game) => {
    if (arcadeUnlocked) { launchFresh(game); return; }
    if (!adminGate) {
      logger.warn('fitness-emulator.admin-gate-skipped', { game: game.id, reason: 'config-disabled' });
      launchFresh(game);
      return;
    }
    if (isLocalDevHost()) {
      logger.debug('fitness-emulator.admin-gate-skipped', { game: game.id, reason: 'dev-host' });
      launchFresh(game);
      return;
    }
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
  }, [arcadeUnlocked, adminGate, registerAdmin, launchFresh, logger]);

  // Deep link /fitness/games/:system/:game — a testing door. It launches the
  // game once, straight past the admin gate, and says so at warn on every use:
  // a bypass that is not in the log is how the arcade stayed open for a day.
  const directLaunch = config?.directLaunch || null;
  const directLaunchDoneRef = useRef(false);
  useEffect(() => {
    if (!library || !directLaunch || directLaunchDoneRef.current) return;
    directLaunchDoneRef.current = true;
    if (!directLaunch.game) return; // /fitness/games/:system alone just opens the arcade
    const game = findDirectLaunchGame(library.games, directLaunch);
    if (!game) {
      logger.error('fitness-emulator.direct-launch.not-found', { system: directLaunch.system, game: directLaunch.game });
      return;
    }
    logger.warn('fitness-emulator.direct-launch', { game: game.id, system: game.system, bypassed: ['admin-gate'] });
    launchFresh(game);
  }, [library, directLaunch, launchFresh, logger]);

  const cancelGate = useCallback(() => {
    setView(launch ? 'playing' : 'arcade');
    clearUnlock();
  }, [clearUnlock, launch]);

  // Flip the running session to persist under userId (post-mount; no remount).
  const activateSave = useCallback((userId) => {
    setClaimConflict(null);
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
        setSelectMessage(null);
        startGame(game, loadLaunch(userId), { remountKey: `${game.id}:${userId}:${Date.now()}` });
        return;
      }
      if (verdict?.matched) setSelectMessage(`That's not ${name}.`);
      logger.info('fitness-emulator.load-saver.reask', { game: game.id, user: userId, matched: !!verdict?.matched });
      reopenMenu();
    });
  }, [launch, registerIdentify, resolvePersonCard, startGame, reopenMenu, logger]);

  // "Save my game": identify whoever scans → claim (warn if they already have a save).
  const handleClaim = useCallback(() => {
    const game = launch?.game;
    if (!game) return;
    setPendingGame(game);
    setView('identify');
    registerIdentify('Save my game').then((verdict) => {
      setPendingGame(null);
      setView('playing');
      if (!verdict?.matched) {
        logger.info('fitness-emulator.claim.reask', { game: game.id, reason: 'no-match' });
        reopenMenu();
        return;
      }
      const uid = verdict.userId;
      if (savers.some((s) => String(s.userId).toLowerCase() === String(uid).toLowerCase())) {
        setClaimConflict(resolvePersonCard(uid));
        logger.info('fitness-emulator.claim.reask', { game: game.id, reason: 'conflict', user: uid });
        reopenMenu();
      } else {
        activateSave(uid);
      }
    });
  }, [launch, registerIdentify, savers, resolvePersonCard, activateSave, reopenMenu, logger]);

  const handleExitGame = useCallback(() => {
    setLaunch(null);
    setView('arcade');
    setSavers([]);
    setSelectMessage(null);
    setClaimConflict(null);
  }, []);

  // Coin-metered economy lifecycle. The coin gate is INERT until start(); the open
  // (free-play) gate has no start/stop. Drive the active gate's async lifecycle
  // here and surface its live coin balance to the console overlay. Keyed on the
  // gate identity so a post-mount claim (which keeps the same gate) never restarts
  // metering. stop() is idempotent and runs exactly once on teardown/exit.
  const activeGate = launch?.gate || null;
  const [coins, setCoins] = useState(null);
  useEffect(() => {
    if (!activeGate || activeGate.mode !== 'coin-metered') {
      setCoins(null);
      return undefined;
    }
    const unsub = typeof activeGate.onChange === 'function'
      ? activeGate.onChange((s) => setCoins(s?.coins ?? null))
      : null;
    try { setCoins(activeGate.getStatus?.()?.coins ?? null); } catch { setCoins(null); }
    if (typeof activeGate.start === 'function') {
      logger.info('fitness-emulator.coin-gate-start', {});
      Promise.resolve(activeGate.start())
        .catch((e) => logger.warn('fitness-emulator.coin-gate-start-failed', { error: e && e.message }));
    }
    return () => {
      if (typeof unsub === 'function') unsub();
      if (typeof activeGate.stop === 'function') {
        logger.info('fitness-emulator.coin-gate-stop', {});
        Promise.resolve(activeGate.stop())
          .catch((e) => logger.warn('fitness-emulator.coin-gate-stop-failed', { error: e && e.message }));
      }
    };
  }, [activeGate, logger]);

  // Session overlay data: the coin placeholder (only while a coin gate is
  // live) plus nothing else here — player/system_label/timer are passed as
  // their own props below so EmulatorConsole can merge them consistently
  // whether they come from this widget or a future non-Fitness host.
  const overlayData = useMemo(() => (
    activeGate?.mode === 'coin-metered' && coins != null
      ? { 'session.coins': coins }
      : undefined
  ), [activeGate, coins]);

  // Pre-formatted for the session badge — clock TEXT plus urgency/staleness,
  // computed once here from the same useArcadeGameBudget derivation the deleted
  // box used, never recomputed inside EmulatorConsole.
  const sessionTimer = useMemo(() => (
    arcadeGameBudget.visible
      ? {
        text: formatClock(arcadeGameBudget.ms), urgency: arcadeGameBudget.urgency ?? null, stale: arcadeGameBudget.stale,
        label: arcadeGameBudget.stale ? 'offline' : arcadeGameBudget.label,
      }
      : null
  ), [arcadeGameBudget.visible, arcadeGameBudget.ms, arcadeGameBudget.urgency, arcadeGameBudget.stale, arcadeGameBudget.label]);

  if (error) return <div className="fitness-emulator__error">Video games unavailable: {error}</div>;
  if (!library) return <div className="fitness-emulator__loading">Loading…</div>;

  // The game menu's Player section — only for save games. Load/claim close the
  // menu first so the fingerprint prompt is not hidden behind the sheet.
  const saveGame = launch && supportsSave(launch.game.saveMode);
  const ownedGame = saveGame && !!launch.game.saveOwner;
  const menuSection = saveGame
    ? ({ closeMenu }) => (
      <PlayerPanel
        current={launch.userId ? launch.person : null}
        locked={ownedGame}
        savers={savers}
        message={selectMessage}
        conflict={claimConflict}
        onLoad={(uid) => { closeMenu(); handleLoadSaver(uid); }}
        onClaim={() => { closeMenu(); handleClaim(); }}
        onConfirmOverwrite={(uid) => activateSave(uid)}
        onCancelOverwrite={() => setClaimConflict(null)}
        canIdentify={isKioskEnv()}
        onJustPlay={() => { logger.info('fitness-emulator.just-play', { game: launch.game.id }); closeMenu(); }}
      />
    )
    : null;

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
        systems={library.systems}
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
      {notice && createPortal(
        <div className="fitness-emulator-notice" role="status">{notice}</div>,
        document.body,
      )}
      <UnlockPrompt
        open={view === 'admin' || view === 'identify'}
        state={unlockState}
        lockLabel={pendingGame
          ? (view === 'admin'
            ? `Admin unlock — ${pendingGame.title || pendingGame.id}`
            : pendingGame.saveOwner && !launch
              ? `${pendingGame.title || pendingGame.id} — ${resolvePersonCard(pendingGame.saveOwner)?.name || pendingGame.saveOwner}'s game`
              : `Verify — ${pendingGame.title || pendingGame.id}`)
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
            overlayData={overlayData}
            autosaveSeconds={autosaveSeconds}
            nowPlaying={launch.person}
            systemLabel={arcadeGameBudget.systemLabel}
            sessionTimer={sessionTimer}
            sessionOverlayConfig={arcadeGameBudget.overlayConfig}
            resolveMediaUrl={(p) => DaylightMediaPath(p)}
            showInputActivity={settings.inputActivityLed !== false}
            onArcadeGameSessionStateChange={handleArcadeGameSessionStateChange}
            onExit={handleExitGame}
            menuSection={menuSection}
            menuAttention={saveGame && !launch.userId}
            menuInitiallyOpen={!!launch.askAtLaunch}
            menuOpenRequest={menuOpenNonce}
            holdPaused={view === 'identify'}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
