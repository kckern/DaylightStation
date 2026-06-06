import { useEffect, useRef } from 'react';
import { DaylightMediaPath } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'governance-audio-duck' });
  return _logger;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Start a duck+SFX session: lower the video volume (never raise it), play the
 * cue's sound effect on its own independent audio element, and restore the video
 * volume when the SFX ends. Returns a session handle that owns its own lifecycle.
 *
 * The SFX plays through a dedicated `Audio` element — a separate track from the
 * `<video>`. The only thing we ever touch on the video is its `.volume`, and only
 * ever downward; the SFX volume is independent and untouched.
 */
function startSession({ mediaElement, videoVolume, audioDuck }) {
  if (!audioDuck || !mediaElement || typeof mediaElement.volume !== 'number') return null;

  // The duck is relative to the viewer's intended level. Prefer the persistent
  // volumeRef so a duck already in flight can't become the new base (which would
  // compound into silence).
  const viewerLevel = Number.isFinite(videoVolume?.volumeRef?.current)
    ? videoVolume.volumeRef.current
    : mediaElement.volume;
  const duckLevel = clamp01(viewerLevel * audioDuck.duckTo);

  // MONOTONIC: a duck may only LOWER the video volume, never raise it. If the
  // target isn't below the current level, leave the volume alone.
  if (duckLevel < mediaElement.volume) {
    mediaElement.volume = duckLevel;
  }

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    if (mediaElement && typeof mediaElement.volume === 'number') {
      // Restore to the viewer's CURRENT intended level (honors a change they made
      // mid-duck), clamped to [0,1]. A duck only ever gives volume back — it can
      // never push the video louder than the viewer asked for.
      const live = Number.isFinite(videoVolume?.volumeRef?.current)
        ? videoVolume.volumeRef.current
        : viewerLevel;
      mediaElement.volume = clamp01(live);
    }
    logger().info('fitness.audio_duck.end', { cueId: audioDuck.cueId, token: audioDuck.token });
  };

  logger().info('fitness.audio_duck.start', {
    cueId: audioDuck.cueId,
    token: audioDuck.token,
    duckTo: audioDuck.duckTo,
    level: mediaElement.volume
  });

  const onEnded = () => restore();
  let audio = null;
  try {
    audio = new Audio(DaylightMediaPath(`/media/${audioDuck.sound}`));
    audio.addEventListener('ended', onEnded);
    const p = audio.play();
    // Autoplay rejection is async — if it were swallowed, the SFX 'ended' event
    // would never fire and the video would stay ducked forever. Restore on
    // rejection so the duck can never get stuck.
    if (p && typeof p.catch === 'function') p.catch(() => restore());
  } catch {
    // Synchronous Audio construction/play failure — restore immediately so we
    // never leave the video ducked with no SFX to end it.
    restore();
  }

  return { token: audioDuck.token, audio, onEnded, restore };
}

/**
 * Stop a session: detach the SFX, halt and release it (no orphaned decode), and
 * restore the video volume if this session hadn't already restored. Idempotent.
 */
function stopSession(session) {
  if (!session) return;
  const { audio, onEnded, restore } = session;
  if (audio) {
    audio.removeEventListener('ended', onEnded);
    try { audio.pause(); } catch { /* element may already be released */ }
    audio.src = '';
  }
  restore?.();
}

/**
 * Plays a one-shot SFX and ducks the video's audio (without pausing) when the
 * GovernanceEngine emits an `audioDuck` descriptor, restoring the volume when the
 * SFX ends.
 *
 * The effect reacts to `audioDuck.token` ONLY — never the descriptor object. The
 * engine rebuilds `audioDuck` (and the whole composed governance state) as a
 * fresh object on every evaluation tick, so depending on the object identity tore
 * the session down on every tick: it cut the SFX mid-play (`audio.pause()`) and
 * snapped the video volume back up (`restore()`) in the same callback — which is
 * why the volume jump appeared perfectly timed to the SFX cut. Keying on the
 * stable `token` lets each cue play through to its natural end.
 *
 * @param {object}  params
 * @param {HTMLMediaElement|{volume:number}|null} params.mediaElement - the video element to duck
 * @param {{ volumeRef: { current: number } }|null} params.videoVolume - live persistent volume
 * @param {{ cueId:string, sound:string, duckTo:number, token:string }|null} params.audioDuck
 */
export function useGovernanceAudioDuck({ mediaElement, videoVolume, audioDuck }) {
  // Latest inputs, read by the token effect without depending on their identity.
  const latestRef = useRef({ mediaElement, videoVolume, audioDuck });
  // Keep it current after every commit. Declared BEFORE the token effect so, on a
  // commit where the token changes, this runs first and the token effect reads
  // fresh values.
  useEffect(() => {
    latestRef.current = { mediaElement, videoVolume, audioDuck };
  });

  const sessionRef = useRef(null);
  const token = audioDuck?.token || null;

  // Fire exactly once per distinct token. A new token = a genuinely new cue, so
  // stop any previous session first (back-to-back cues) before starting the next.
  // Deliberately NO cleanup on token change: when the cue clears (token → null)
  // we let the in-flight SFX finish and restore on its own 'ended'. Final
  // teardown is the unmount-only effect below.
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
