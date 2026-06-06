import { useEffect, useRef } from 'react';
import { DaylightMediaPath } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'governance-audio-duck' });
  return _logger;
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
  });

  let lifted = false;
  const lift = () => {
    if (lifted) return;
    lifted = true;
    videoVolume.setDuck(1);
    logger().info('fitness.audio_duck.end', { cueId: audioDuck.cueId, token: audioDuck.token });
  };

  const onEnded = () => lift();
  let audio = null;
  try {
    audio = new Audio(DaylightMediaPath(`/media/${audioDuck.sound}`));
    audio.addEventListener('ended', onEnded);
    const p = audio.play();
    // Autoplay rejection is async; lift so the duck can't get stuck if the SFX
    // never produces an 'ended' event.
    if (p && typeof p.catch === 'function') p.catch(() => lift());
  } catch {
    lift();
  }
  return { token: audioDuck.token, audio, onEnded, lift };
}

/** Stop a session: detach + release the SFX, and lift the duck. Idempotent. */
function stopSession(session) {
  if (!session) return;
  const { audio, onEnded, lift } = session;
  if (audio) {
    audio.removeEventListener('ended', onEnded);
    try { audio.pause(); } catch { /* already released */ }
    audio.src = '';
  }
  lift?.();
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
 * @param {{ cueId:string, sound:string, duckTo:number, token:string }|null} params.audioDuck
 */
export function useGovernanceAudioDuck({ videoVolume, audioDuck }) {
  const latestRef = useRef({ videoVolume, audioDuck });
  useEffect(() => { latestRef.current = { videoVolume, audioDuck }; });

  const sessionRef = useRef(null);
  const token = audioDuck?.token || null;

  useEffect(() => {
    if (!token) return;
    stopSession(sessionRef.current);
    sessionRef.current = startSession(latestRef.current);
  }, [token]);

  useEffect(() => () => {
    stopSession(sessionRef.current);
    sessionRef.current = null;
  }, []);
}

export default useGovernanceAudioDuck;
