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

// A scan that lands within this window of an unlock/identify modal being active
// is leftover unlock context (e.g. a game-unlock admin fingerprint arriving a beat
// after its modal closed), NOT the emergency gesture — don't open the ceremony.
export const UNLOCK_COOLDOWN_MS = 4000;

// An admin scan can arrive a beat BEFORE its unlock modal registers (finger
// already down as the user taps a game). Delay opening the emergency ceremony
// this long; if a registerUnlock lands in the window, the scan was an unlock,
// not an emergency.
export const CEREMONY_DEBOUNCE_MS = 400;

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
  const [unlockState, setUnlockState] = useState('idle'); // 'idle'|'scanning'|'granted'|'denied'|'unauthorized'
  const [unlockedUser, setUnlockedUser] = useState(null);

  // Refs read inside the (stable) WS handler to avoid stale closures.
  const activeLockRef = useRef(null);
  // Timestamp of the most recent unlock/identify modal activity. A scan within
  // UNLOCK_COOLDOWN_MS of this is leftover unlock context, not the emergency gesture.
  const lastUnlockActivityRef = useRef(0);
  // Armed-but-not-yet-fired ceremony open (debounced by CEREMONY_DEBOUNCE_MS so an
  // imminent unlock can cancel it). Null when nothing is armed.
  const pendingCeremonyTimerRef = useRef(null);
  // identifyOnly: resolve on ANY recognized finger (no per-lock authz check).
  // Used by surfaces that only need to KNOW who scanned — e.g. the emulator
  // save-game identity prompt — rather than gate on a permission.
  const identifyOnlyRef = useRef(false);
  // adminOnly: resolve ONLY on authz.admin === true (e.g. the emulator arcade
  // unlock gate that requires a parent's finger regardless of per-lock perms).
  const adminOnlyRef = useRef(false);
  const verdictResolverRef = useRef(null);
  // A decided-but-not-yet-resolved grant (during the "Access Granted" chime
  // hold). If a cancel/tap lands in that window, clearUnlock must honor THIS
  // grant rather than downgrade it to a cancellation — otherwise a successful
  // (often retry) unlock launches anonymous. See IdentityProvider.test.jsx.
  const pendingGrantRef = useRef(null);
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
      lastUnlockActivityRef.current = Date.now();
      const recognized = msg.matched === true;
      const authorized = recognized
        && (identifyOnlyRef.current
          || (adminOnlyRef.current
            ? msg.authz?.admin === true
            : (Array.isArray(msg.authz?.locks) && msg.authz.locks.includes(lock))));

      if (!authorized) {
        if (recognized) {
          // Recognized, but this person isn't permitted for this lock (e.g. a
          // known non-admin at an admin-only surface). Show who it was so the
          // prompt can say "recognized, but not allowed" rather than "unknown".
          setUnlockedUser(resolvePerson(msg.userId));
          setUnlockState('unauthorized');
          logger().info('unlock-unauthorized', { lock, userId: msg.userId ?? null });
        } else {
          setUnlockState('denied');
          logger().info('unlock-denied', { lock });
        }
        // Do NOT resolve — a wrong finger shouldn't close the modal; an admin
        // can still scan and be granted.
        return;
      }

      const person = resolvePerson(msg.userId);
      logger().info('unlock-granted', { lock, userId: msg.userId ?? null });
      setUnlockState('granted');
      setUnlockedUser(person);

      // Commit the grant: from here the outcome is decided. A cancel during the
      // hold (below) must resolve THIS, not a cancellation.
      const grantVerdict = { matched: true, userId: msg.userId };
      pendingGrantRef.current = grantVerdict;

      // Hold the "Access Granted" confirmation while the chime plays, then resolve.
      // Resolves on chime end, on a silent/rejected device, or after the safety cap.
      let done = false;
      let capTimer = null;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(capTimer);
        pendingGrantRef.current = null;
        resolveVerdict(grantVerdict);
      };
      const played = playCueOnce({ sound: soundRef.current, volume: volumeRef.current, onDone: finish });
      if (!played) { finish(); return; }
      capTimer = setTimeout(finish, SUCCESS_HOLD_CAP_MS);
      return;
    }

    // (2) No modal open: only admins drive the emergency state machine. Admin IS
    // the emergency authority — there is no separate emergency flag.
    if (!msg.matched || !msg.authz?.admin) return;
    const phase = emergencyRef.current?.phase;
    if (phase === PHASE_NORMAL) {
      if (Date.now() - lastUnlockActivityRef.current < UNLOCK_COOLDOWN_MS) {
        logger().info('emergency-ceremony-suppressed', { userId: msg.userId ?? null, reason: 'unlock-cooldown' });
        return;
      }
      if (pendingCeremonyTimerRef.current) return; // already armed; don't stack
      const armedUserId = msg.userId ?? null;
      logger().info('emergency-ceremony-armed', { userId: armedUserId, debounceMs: CEREMONY_DEBOUNCE_MS });
      pendingCeremonyTimerRef.current = setTimeout(() => {
        pendingCeremonyTimerRef.current = null;
        // A modal opened during the debounce → the scan was an unlock, not an emergency.
        if (activeLockRef.current) {
          logger().info('emergency-ceremony-cancelled', { userId: armedUserId, reason: 'unlock-opened' });
          return;
        }
        if (emergencyRef.current?.phase !== PHASE_NORMAL) return;
        logger().info('emergency-ceremony-start', { userId: armedUserId });
        emergencyRef.current?.triggerCeremony?.();
      }, CEREMONY_DEBOUNCE_MS);
    } else if (phase === PHASE_TRIGGERING) {
      logger().info('emergency-ceremony-abort', { userId: msg.userId ?? null });
      emergencyRef.current?.abort?.();
    } else if (phase === PHASE_LOCKED) {
      // An admin scan releases the lockdown immediately — even ahead of the
      // scheduled lockedUntil. We're already past the `msg.authz.admin` guard
      // above, and the relay just stamped a pending detection that /release
      // consumes, so release() succeeds without a second scan. The press-and-hold
      // path remains as a manual fallback.
      logger().info('emergency-release-scan', { userId: msg.userId ?? null });
      emergencyRef.current?.release?.();
    }
  }, [resolvePerson, resolveVerdict]);

  // Subscribe once. handleIdentity is stable (deps are stable callbacks).
  useEffect(() => {
    const unsub = wsService.subscribe([IDENTITY_TOPIC], handleIdentity);
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [handleIdentity]);

  // Clear any armed ceremony timer on unmount to avoid leaks/act warnings.
  useEffect(() => () => {
    if (pendingCeremonyTimerRef.current) clearTimeout(pendingCeremonyTimerRef.current);
  }, []);

  const registerUnlock = useCallback((lock, { identifyOnly = false, adminOnly = false } = {}) => {
    // Called from a user gesture in consumers — prime the cue element now so the
    // async success chime can play later.
    primeCueAudio('unlock-request');
    activeLockRef.current = lock;
    lastUnlockActivityRef.current = Date.now();
    // A modal is opening → the earlier admin scan was for this unlock, not an
    // emergency. Cancel any armed (debounced) ceremony open.
    if (pendingCeremonyTimerRef.current) {
      clearTimeout(pendingCeremonyTimerRef.current);
      pendingCeremonyTimerRef.current = null;
      logger().info('emergency-ceremony-cancelled', { reason: 'unlock-registered' });
    }
    identifyOnlyRef.current = !!identifyOnly;
    adminOnlyRef.current = !!adminOnly;
    pendingGrantRef.current = null; // fresh attempt — no decided grant yet
    setActiveLock(lock);
    setUnlockState('scanning');
    setUnlockedUser(null);
    logger().info('unlock-registered', { lock, identifyOnly: !!identifyOnly, adminOnly: !!adminOnly });
    return new Promise((resolve) => { verdictResolverRef.current = resolve; });
  }, []);

  // Sugar for "just tell me who scanned" — any recognized finger resolves with a
  // userId; no authorization gate. `lock` is a synthetic key (prompt label only).
  const registerIdentify = useCallback(
    (lock = 'identify') => registerUnlock(lock, { identifyOnly: true }),
    [registerUnlock],
  );

  // Sugar for "require an admin finger" — authorizes on authz.admin regardless of
  // per-lock permissions. Used by the emulator arcade unlock gate.
  const registerAdmin = useCallback(
    (lock = 'admin') => registerUnlock(lock, { adminOnly: true }),
    [registerUnlock],
  );

  const clearUnlock = useCallback(() => {
    lastUnlockActivityRef.current = Date.now();
    activeLockRef.current = null;
    identifyOnlyRef.current = false;
    adminOnlyRef.current = false;
    setActiveLock(null);
    setUnlockedUser(null);
    setUnlockState('idle');
    // Honor a grant that was already decided (a tap during the success-hold);
    // only a cancel with NO decided grant resolves as a true cancellation.
    const pendingGrant = pendingGrantRef.current;
    pendingGrantRef.current = null;
    resolveVerdict(pendingGrant || { matched: false, reason: 'cancelled' });
  }, [resolveVerdict]);

  const value = useMemo(() => ({
    // Emergency pass-through (single owner).
    phase: emergency.phase,
    lockedUntil: emergency.lockedUntil,
    lockedBy: emergency.lockedBy,
    commit: emergency.commit,
    abort: emergency.abort,
    release: emergency.release,
    dismissCeremony: emergency.dismissCeremony,
    // Unlock sub-API.
    registerUnlock,
    registerIdentify,
    registerAdmin,
    clearUnlock,
    activeLock,
    unlockState,
    unlockedUser,
  }), [
    emergency.phase, emergency.lockedUntil, emergency.lockedBy,
    emergency.commit, emergency.abort, emergency.release, emergency.dismissCeremony,
    registerUnlock, registerIdentify, registerAdmin, clearUnlock, activeLock, unlockState, unlockedUser,
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
