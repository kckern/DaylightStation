import { useEffect, useRef } from 'react';
import { DaylightMediaPath } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'governance-audio-duck' });
  return _logger;
}

/**
 * Plays a one-shot SFX and ducks the video's audio (without pausing) when the
 * GovernanceEngine emits an `audioDuck` descriptor. The duck lasts only while
 * the SFX plays — volume is restored on the SFX `ended` event (or on unmount).
 *
 * Dedupes by `audioDuck.token`: each distinct token fires exactly once, so a
 * descriptor that persists across the whole threshold window only ducks once.
 *
 * @param {object}  params
 * @param {HTMLMediaElement|{volume:number}|null} params.mediaElement - the video element to duck
 * @param {{ volumeRef: { current: number } }|null} params.videoVolume - live persistent volume
 * @param {{ cueId:string, sound:string, duckTo:number, token:string }|null} params.audioDuck
 */
export function useGovernanceAudioDuck({ mediaElement, videoVolume, audioDuck }) {
  const firedTokenRef = useRef(null);
  const duckedMediaRef = useRef(null);

  useEffect(() => {
    const token = audioDuck?.token || null;
    if (!token || token === firedTokenRef.current) return;
    if (!mediaElement || typeof mediaElement.volume !== 'number') return;

    firedTokenRef.current = token;

    const baseLevel = Number.isFinite(videoVolume?.volumeRef?.current)
      ? videoVolume.volumeRef.current
      : mediaElement.volume;
    const duckLevel = Math.max(0, Math.min(1, baseLevel * audioDuck.duckTo));

    mediaElement.volume = duckLevel;
    duckedMediaRef.current = mediaElement;

    logger().info('fitness.audio_duck.start', {
      cueId: audioDuck.cueId,
      token,
      duckTo: audioDuck.duckTo,
      level: duckLevel
    });

    const restore = () => {
      const media = duckedMediaRef.current;
      if (media && typeof media.volume === 'number') {
        const live = Number.isFinite(videoVolume?.volumeRef?.current)
          ? videoVolume.volumeRef.current
          : media.volume;
        media.volume = live;
      }
      duckedMediaRef.current = null;
      logger().info('fitness.audio_duck.end', { cueId: audioDuck.cueId, token });
    };

    let audio = null;
    try {
      audio = new Audio(DaylightMediaPath(`/media/${audioDuck.sound}`));
      audio.addEventListener('ended', restore);
      const p = audio.play();
      // Autoplay rejection is async — if it were swallowed, the SFX 'ended'
      // event would never fire and the video would stay ducked forever.
      // Restore on rejection so the duck can never get stuck.
      if (p && typeof p.catch === 'function') p.catch(() => restore());
    } catch {
      // Synchronous Audio construction/play failure — restore immediately so we
      // never leave the video ducked with no SFX to end it.
      restore();
      return undefined;
    }

    return () => {
      if (audio) {
        audio.removeEventListener('ended', restore);
        // Stop and release the SFX so a new token doesn't leave the previous
        // instance decoding in the background (orphaned stream).
        audio.pause();
        audio.src = '';
      }
      // duckedMediaRef doubles as the "already restored" sentinel — restore()
      // nulls it, so this won't double-restore after a natural 'ended'.
      if (duckedMediaRef.current) restore();
    };
  }, [audioDuck, mediaElement, videoVolume]);
}

export default useGovernanceAudioDuck;
