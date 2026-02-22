import { useState, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useMediaControls' });
  return _logger;
}

/**
 * Controls mute/unmute for audio and video tracks on a MediaStream.
 *
 * @param {MediaStream|null} stream - The local media stream
 * @returns {{ audioMuted: boolean, videoMuted: boolean, toggleAudio: function, toggleVideo: function }}
 */
export default function useMediaControls(stream) {
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);

  const toggleAudio = useCallback(() => {
    if (!stream) return;
    const newMuted = !audioMuted;
    stream.getAudioTracks().forEach(track => { track.enabled = !newMuted; });
    setAudioMuted(newMuted);
    logger().info('audio-toggle', { muted: newMuted });
    return newMuted;
  }, [stream, audioMuted]);

  const toggleVideo = useCallback(() => {
    if (!stream) return;
    const newMuted = !videoMuted;
    stream.getVideoTracks().forEach(track => { track.enabled = !newMuted; });
    setVideoMuted(newMuted);
    logger().info('video-toggle', { muted: newMuted });
    return newMuted;
  }, [stream, videoMuted]);

  const reset = useCallback(() => {
    if (stream) {
      stream.getAudioTracks().forEach(track => { track.enabled = true; });
      stream.getVideoTracks().forEach(track => { track.enabled = true; });
    }
    setAudioMuted(false);
    setVideoMuted(false);
  }, [stream]);

  return { audioMuted, videoMuted, toggleAudio, toggleVideo, reset };
}
