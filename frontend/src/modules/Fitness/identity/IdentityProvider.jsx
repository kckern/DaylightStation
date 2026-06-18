import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { DaylightMediaPath } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';
import { useFitness } from '@/context/FitnessContext.jsx';
import { wsService } from '@/services/WebSocketService.js';
import useEmergencyLockdown, {
  PHASE_NORMAL, PHASE_TRIGGERING, PHASE_LOCKED,
} from '@/modules/Fitness/hooks/useEmergencyLockdown.js';
import { playCueOnce } from '@/modules/Fitness/player/hooks/useGovernanceAudioDuck.js';
import { primeCueAudio } from '@/modules/Fitness/player/hooks/audioCuePlayer.js';

let _logger;
const logger = () => (_logger ??= getLogger().child({ component: 'identity-manager' }));

const IDENTITY_TOPIC = 'fitness.identity.detected';

// Ported from useUnlock.js (retired in a later task). Both sound path and volume
// are config-driven (fitness.yml → unlock.{sound,volume}); these are fallbacks.
const DEFAULT_UNLOCK_SOUND = 'apps/fitness/ux/unlock.mp3';
const DEFAULT_UNLOCK_VOLUME = 0.15;
// Safety cap on the success-screen hold: if the chime never reports completion
// (silent/autoplay-rejected device), resolve the verdict anyway after this.
const SUCCESS_HOLD_CAP_MS = 6000;

const IdentityContext = createContext(null);

/**
 * Frontend router for `fitness.identity.detected`. Single owner of the emergency
 * hook, plus an unlock sub-API. Routes each enriched identity event by app context
 * (is an unlock modal open? what is the emergency phase?). Replaces both the old
 * per-request useUnlock POST flow and the old fitness.emergency.detected trigger.
 */
export function IdentityProvider({ children }) {
  const emergency = useEmergencyLockdown();

  const { fitnessConfiguration, userCollections } = useFitness();

  // Unlock state surface.
  const [activeLock, setActiveLock] = useState(null);
  const [unlockState, setUnlockState] = useState('idle'); // 'idle'|'scanning'|'granted'|'denied'
  const [unlockedUser, setUnlockedUser] = useState(null);

  // Refs read inside the (stable) WS handler to avoid stale closures.
  const activeLockRef = useRef(null);
  const verdictResolverRef = useRef(null);
  const emergencyRef = useRef(emergency);
  emergencyRef.current = emergency;

  // Config-driven chime sound/volume, held in refs so the async match closure reads
  // live values (fitness.yml → unlock.{sound,volume}; root sometimes wrapped .fitness).
  const soundRef = useRef(DEFAULT_UNLOCK_SOUND);
  const volumeRef = useRef(DEFAULT_UNLOCK_VOLUME);
  const cfgRoot = fitnessConfiguration?.fitness || fitnessConfiguration || {};
  const cfgSound = cfgRoot?.unlock?.sound;
  soundRef.current = (typeof cfgSound === 'string' && cfgSound.trim()) ? cfgSound.trim() : DEFAULT_UNLOCK_SOUND;
  const cfgVolume = Number(cfgRoot?.unlock?.volume);
  volumeRef.current = Number.isFinite(cfgVolume) ? cfgVolume : DEFAULT_UNLOCK_VOLUME;

  // Roster SSOT for resolving a matched userId → display name (same source the
  // participant grid uses). Held in a ref so the async match closure reads live.
  const rosterRef = useRef([]);
  rosterRef.current = Array.isArray(userCollections?.all) ? userCollections.all : [];

  // Resolve a matched userId → { name, avatarSrc } using the roster (slug/id/name
  // match) + avatar-by-slug convention. Ported from useUnlock.js.
  const resolvePerson = useCallback((userId) => {
    const match = rosterRef.current.find((u) => {
      const keys = [u?.id, u?.slug, u?.name].filter(Boolean).map((s) => String(s).toLowerCase());
      return userId && keys.includes(String(userId).toLowerCase());
    });
    const name = match?.displayName || match?.name || match?.title || userId || null;
    const avatarSrc = userId ? DaylightMediaPath(`/static/img/users/${userId}`) : null;
    return { userId: userId || null, name, avatarSrc };
  }, []);

  const resolveVerdict = useCallback((verdict) => {
    const resolve = verdictResolverRef.current;
    verdictResolverRef.current = null;
    if (resolve) resolve(verdict);
  }, []);

  // Single stable handler for every identity event — reads activeLock/phase/emergency
  // from refs so the WS subscription can be installed once (handler identity stable).
  const handleIdentity = useCallback((msg) => {
    if (!msg || msg.topic !== IDENTITY_TOPIC) return;
    const lock = activeLockRef.current;

    // (1) A modal is open: only the active lock's authorization matters.
    if (lock) {
      const authorized = msg.matched === true
        && Array.isArray(msg.authz?.locks)
        && msg.authz.locks.includes(lock);

      if (!authorized) {
        setUnlockState('denied');
        logger().info('unlock-denied', { lock, userId: msg.userId ?? null });
        // Do NOT resolve — a wrong finger shouldn't close the modal.
        return;
      }

      const person = resolvePerson(msg.userId);
      logger().info('unlock-granted', { lock, userId: msg.userId ?? null });
      setUnlockState('granted');
      setUnlockedUser(person);

      // Hold the "Access Granted" confirmation while the chime plays, then resolve.
      // Resolves on chime end, on a silent/rejected device, or after the safety cap.
      let done = false;
      let capTimer = null;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(capTimer);
        resolveVerdict({ matched: true, userId: msg.userId });
      };
      const played = playCueOnce({ sound: soundRef.current, volume: volumeRef.current, onDone: finish });
      if (!played) { finish(); return; }
      capTimer = setTimeout(finish, SUCCESS_HOLD_CAP_MS);
      return;
    }

    // (2) No modal open: only emergency-authorized matches matter.
    if (!msg.matched || !msg.authz?.emergency) return;
    const phase = emergencyRef.current?.phase;
    if (phase === PHASE_NORMAL) {
      logger().info('emergency-ceremony-start', { userId: msg.userId ?? null });
      emergencyRef.current?.triggerCeremony?.();
    } else if (phase === PHASE_TRIGGERING) {
      logger().info('emergency-ceremony-abort', { userId: msg.userId ?? null });
      emergencyRef.current?.abort?.();
    } else if (phase === PHASE_LOCKED) {
      // Release is press-and-hold UI driven — a scan does nothing here.
    }
  }, [resolvePerson, resolveVerdict]);

  // Subscribe once. handleIdentity is stable (deps are stable callbacks).
  useEffect(() => {
    const unsub = wsService.subscribe([IDENTITY_TOPIC], handleIdentity);
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [handleIdentity]);

  const registerUnlock = useCallback((lock) => {
    // Called from a user gesture in consumers — prime the cue element now so the
    // async success chime can play later.
    primeCueAudio('unlock-request');
    activeLockRef.current = lock;
    setActiveLock(lock);
    setUnlockState('scanning');
    setUnlockedUser(null);
    logger().info('unlock-registered', { lock });
    return new Promise((resolve) => { verdictResolverRef.current = resolve; });
  }, []);

  const clearUnlock = useCallback(() => {
    activeLockRef.current = null;
    setActiveLock(null);
    setUnlockedUser(null);
    setUnlockState('idle');
    resolveVerdict({ matched: false, reason: 'cancelled' });
  }, [resolveVerdict]);

  const value = useMemo(() => ({
    // Emergency pass-through (single owner).
    phase: emergency.phase,
    lockedUntil: emergency.lockedUntil,
    lockedBy: emergency.lockedBy,
    commit: emergency.commit,
    abort: emergency.abort,
    release: emergency.release,
    // Unlock sub-API.
    registerUnlock,
    clearUnlock,
    activeLock,
    unlockState,
    unlockedUser,
  }), [
    emergency.phase, emergency.lockedUntil, emergency.lockedBy,
    emergency.commit, emergency.abort, emergency.release,
    registerUnlock, clearUnlock, activeLock, unlockState, unlockedUser,
  ]);

  return (
    <IdentityContext.Provider value={value}>
      {children}
    </IdentityContext.Provider>
  );
}

export function useIdentity() {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error('useIdentity must be used within an IdentityProvider');
  return ctx;
}

export default IdentityProvider;
