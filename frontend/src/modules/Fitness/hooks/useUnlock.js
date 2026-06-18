import { useCallback, useRef, useState } from 'react';
import { DaylightAPI, DaylightMediaPath } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';
import { useFitness } from '@/context/FitnessContext.jsx';
import { playCueOnce } from '@/modules/Fitness/player/hooks/useGovernanceAudioDuck.js';
import { primeCueAudio } from '@/modules/Fitness/player/hooks/audioCuePlayer.js';

let _logger;
const logger = () => (_logger ??= getLogger().child({ component: 'unlock' }));

const UNLOCK_PATH = 'api/v1/fitness/unlock';
// Success chime played on every matched scan, via the shared cue-audio element
// (same plumbing as the governance duck). See useGovernanceAudioDuck.playCueOnce.
// Both the sound path and volume are config-driven (fitness.yml → unlock.{sound,volume});
// these are only the fallbacks used when config omits them.
const DEFAULT_UNLOCK_SOUND = 'apps/fitness/ux/unlock.mp3';
// Chime volume when config omits `unlock.volume`. playCueOnce clamps to [0,1].
// Kept low — the garage speakers are loud and the chime is a confirmation, not an
// alert. The deployed fitness.yml sets unlock.volume explicitly; this is the floor.
const DEFAULT_UNLOCK_VOLUME = 0.15;
// Safety cap on the success-screen hold: the prompt shows the "Access Granted"
// confirmation while the chime plays, then proceeds. If the chime never reports
// completion (silent/autoplay-rejected device), proceed anyway after this.
const SUCCESS_HOLD_CAP_MS = 6000;

/**
 * Drives a fingerprint-unlock request against POST /api/v1/fitness/unlock.
 *
 * The backend round-trip can take ~15s while the user places a finger on the
 * garage reader. Callers branch on the resolved `{ matched }` flag — requestUnlock
 * never rejects, so try/catch is unnecessary at the call site.
 *
 * @returns {{
 *   requestUnlock: (lockName: string) => Promise<{matched: boolean, userId?: string, reason?: string}>,
 *   state: 'idle' | 'scanning' | 'granted' | 'denied',
 *   activeLock: string | null,
 *   unlockedUser: { userId: string | null, name: string | null, avatarSrc: string | null } | null,
 *   reset: () => void
 * }}
 *
 * On a match, `requestUnlock` resolves only AFTER the success chime finishes (or a
 * safety cap), so the prompt can hold an "Access Granted" confirmation in between.
 */
export function useUnlock() {
  const [state, setState] = useState('idle');
  const [activeLock, setActiveLock] = useState(null);
  // The recognized person on a match — drives the success-screen avatar + name.
  const [unlockedUser, setUnlockedUser] = useState(null);

  // Track the in-flight request so overlapping calls can be ignored without
  // relying on the async `state` value (which may not have flushed yet).
  const inFlightRef = useRef(null);

  // Resolve the unlock-chime sound + volume from fitness config
  // (fitness.yml → unlock.{sound,volume}). The config root is sometimes wrapped
  // under `.fitness`. Held in refs so the success chime (fired from an async
  // closure with [] deps) reads the live values without a stale closure.
  const { fitnessConfiguration, userCollections } = useFitness();
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

  const requestUnlock = useCallback((lockName) => {
    // Guard against overlapping requests: ignore a new call while one is in
    // flight and return a resolved {matched:false, reason:'busy'}.
    if (inFlightRef.current) {
      logger().warn('unlock.busy', { lock: lockName });
      return Promise.resolve({ matched: false, reason: 'busy' });
    }

    logger().info('unlock.requested', { lock: lockName });
    // requestUnlock is invoked from the unlock control's pointerdown handler, so
    // this runs inside a user gesture — prime the shared cue element now so the
    // success chime can play later (the async match resolves outside any gesture,
    // and the menu has no FitnessPlayer to install the gesture-unlock listener).
    primeCueAudio('unlock-request');
    setState('scanning');
    setActiveLock(lockName);
    logger().debug('unlock.scanning', { lock: lockName });

    const promise = (async () => {
      try {
        const res = await DaylightAPI(UNLOCK_PATH, { lock: lockName });
        if (res && res.matched) {
          const userId = res.userId;
          logger().info('unlock.granted', { lock: lockName, userId });

          // Resolve the recognized person for the success screen: name from the
          // roster (slug/id/name match), avatar by slug convention (the panel uses
          // the same /static/img/users/<id> path, with a generic fallback img).
          const match = rosterRef.current.find((u) => {
            const keys = [u?.id, u?.slug, u?.name].filter(Boolean).map((s) => String(s).toLowerCase());
            return userId && keys.includes(String(userId).toLowerCase());
          });
          const name = match?.displayName || match?.name || match?.title || userId || null;
          const avatarSrc = userId ? DaylightMediaPath(`/static/img/users/${userId}`) : null;
          setUnlockedUser({ userId: userId || null, name, avatarSrc });
          setState('granted');

          // Hold the prompt on the "Access Granted" confirmation while the chime
          // plays, then resolve so the caller proceeds. Resolves on chime end, on
          // a silent/rejected device, or after the safety cap — never hangs.
          await new Promise((resolve) => {
            let done = false;
            let capTimer = null;
            const finish = () => { if (done) return; done = true; clearTimeout(capTimer); resolve(); };
            const played = playCueOnce({ sound: soundRef.current, volume: volumeRef.current, onDone: finish });
            if (!played) { finish(); return; }
            capTimer = setTimeout(finish, SUCCESS_HOLD_CAP_MS);
          });

          return { matched: true, userId };
        }
        const reason = res?.reason;
        logger().info('unlock.denied', { lock: lockName, reason });
        setState('denied');
        return { matched: false, reason };
      } catch (err) {
        // Non-2xx responses throw from DaylightAPI; treat any failure as denied.
        logger().info('unlock.denied', { lock: lockName, reason: 'error', error: err?.message });
        setState('denied');
        return { matched: false, reason: 'error' };
      } finally {
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = promise;
    return promise;
  }, []);

  const reset = useCallback(() => {
    logger().debug('unlock.reset');
    setState('idle');
    setActiveLock(null);
    setUnlockedUser(null);
  }, []);

  return { requestUnlock, state, activeLock, unlockedUser, reset };
}

export default useUnlock;
