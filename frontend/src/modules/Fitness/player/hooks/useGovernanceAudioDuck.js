import { useEffect, useRef } from 'react';
import { DaylightMediaPath } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';
import { getCueAudioElement, isCueAudioUnlocked } from './audioCuePlayer.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'governance-audio-duck' });
  return _logger;
}

/**
 * Play a one-shot cue SFX on the shared cue audio element — no ducking, no
 * session. Used for fire-and-forget chimes (e.g. the fingerprint-unlock success
 * sound) from anywhere in the fitness UI, routed through the same element +
 * autoplay-unlock plumbing the governance duck uses. The caller should have
 * primed the element via a user gesture (see audioCuePlayer.primeCueAudio /
 * installCueAudioUnlock) or the play may be autoplay-rejected (logged, not thrown).
 *
 * @param {{ sound: string, volume?: number }} cue - `sound` is a media-relative path
 * @returns {boolean} true if play was attempted
 */
export function playCueOnce({ sound, volume } = {}) {
  if (!sound) return false;
  const audio = getCueAudioElement();
  if (!audio) { logger().warn('fitness.cue.no_element', { sound }); return false; }
  try {
    audio.src = DaylightMediaPath(`/media/${sound}`);
    const v = Number(volume);
    audio.volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
    audio.currentTime = 0;
    audio.muted = false;
    logger().info('fitness.cue.play', { sound, unlocked: isCueAudioUnlocked() });
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch((err) => {
      logger().warn('fitness.cue.play_rejected', { sound, name: err?.name ?? null, message: err?.message ?? null });
    });
    return true;
  } catch (err) {
    logger().warn('fitness.cue.play_threw', { sound, message: err?.message ?? null });
    return false;
  }
}

/**
 * Start a duck+SFX session: lower the video via the volume system's setDuck()
 * (the single authority for the ducked level), play the cue's SFX on its own
 * independent audio element, and lift the duck when the SFX ends.
 */
function startSession({ videoVolume, audioDuck }) {
  if (!audioDuck || typeof videoVolume?.setDuck !== 'function') return null;

  videoVolume.setDuck(audioDuck.duckTo);
  logger().info('fitness.audio_duck.start', {
    cueId: audioDuck.cueId, token: audioDuck.token, duckTo: audioDuck.duckTo,
    sound: audioDuck.sound, unlocked: isCueAudioUnlocked(),
  });

  // Declared above the closures below so the dependency is lexically clear; the
  // closures still run after this is assigned in the try block.
  let audio = null;

  let lifted = false;
  const lift = (reason = 'unknown') => {
    if (lifted) return;
    lifted = true;
    videoVolume.setDuck(1);
    logger().info('fitness.audio_duck.end', { cueId: audioDuck.cueId, token: audioDuck.token, reason });
  };

  const onEnded = () => lift('ended');
  const onError = () => {
    const mediaErr = audio?.error;
    const code = mediaErr?.code ?? null;
    const aborted = code === 1; // MEDIA_ERR_ABORTED — superseded load, not a real cue failure
    logger().warn('fitness.audio_duck.error', {
      cueId: audioDuck.cueId, token: audioDuck.token,
      code, message: mediaErr?.message ?? null, aborted,
    });
    if (!aborted) lift('error');
  };
  try {
    audio = getCueAudioElement();
    if (!audio) { lift('no_element'); return null; }
    audio.src = DaylightMediaPath(`/media/${audioDuck.sound}`);
    const vol = Number(audioDuck.volume);
    audio.volume = Number.isFinite(vol) ? Math.max(0, Math.min(1, vol)) : 1;
    audio.currentTime = 0;
    audio.muted = false;
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    const p = audio.play();
    // Autoplay rejection is async; lift so the duck can't get stuck if the SFX
    // never produces an 'ended' event. Log the reason so on-device failures are
    // visible (the reason is otherwise swallowed silently).
    if (p && typeof p.catch === 'function') p.catch((err) => {
      logger().warn('fitness.audio_duck.play_rejected', {
        cueId: audioDuck.cueId, token: audioDuck.token,
        name: err?.name ?? null, message: err?.message ?? null,
      });
      lift('rejected');
    });
  } catch (err) {
    logger().warn('fitness.audio_duck.play_threw', {
      cueId: audioDuck.cueId, token: audioDuck.token, message: err?.message ?? null,
    });
    lift('threw');
  }
  return { token: audioDuck.token, audio, onEnded, onError, lift };
}

/** Stop a session: detach + release the SFX, and lift the duck. Idempotent. */
function stopSession(session, reason = 'stopped') {
  if (!session) return;
  const { audio, onEnded, onError, lift } = session;
  if (audio) {
    audio.removeEventListener('ended', onEnded);
    if (onError) audio.removeEventListener('error', onError);
    // Do NOT clear src — the element is shared/reused; clearing it fires a
    // spurious 'error' (aborted load) on the next consumer.
    try { audio.pause(); } catch { /* already released */ }
  }
  lift?.(reason);
}

/**
 * Plays a one-shot SFX and ducks the video (via the volume system) when the
 * GovernanceEngine emits an `audioDuck` descriptor, lifting the duck when the SFX
 * ends. Reacts to `audioDuck.token` ONLY — the engine rebuilds the descriptor
 * object every tick, so keying on the object would tear the session down each
 * tick (cutting the SFX and bouncing the volume).
 *
 * @param {object} params
 * @param {{ setDuck:(m:number)=>void, volumeRef?:{current:number} }|null} params.videoVolume
 * @param {{ cueId:string, sound:string, duckTo:number, volume?:number, token:string }|null} params.audioDuck
 */
export function useGovernanceAudioDuck({ videoVolume, audioDuck }) {
  const latestRef = useRef({ videoVolume, audioDuck });
  useEffect(() => { latestRef.current = { videoVolume, audioDuck }; });

  const sessionRef = useRef(null);
  const token = audioDuck?.token || null;

  useEffect(() => {
    if (!token) return;
    stopSession(sessionRef.current, 'superseded');
    sessionRef.current = startSession(latestRef.current);
  }, [token]);

  useEffect(() => () => {
    stopSession(sessionRef.current, 'unmount');
    sessionRef.current = null;
  }, []);
}

export default useGovernanceAudioDuck;
