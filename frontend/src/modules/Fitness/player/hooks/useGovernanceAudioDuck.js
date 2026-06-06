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
  const audioRef = useRef(null);
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
      audioRef.current = audio;
      audio.addEventListener('ended', restore);
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // Audio construction/playback failed — restore immediately so we never
      // leave the video ducked with no SFX to end it.
      restore();
      return undefined;
    }

    return () => {
      if (audio) audio.removeEventListener('ended', restore);
      // If the duck is still active when this effect tears down (unmount or a
      // new token arriving mid-SFX), restore the video volume.
      if (duckedMediaRef.current) restore();
    };
  }, [audioDuck, mediaElement, videoVolume]);
}

export default useGovernanceAudioDuck;
