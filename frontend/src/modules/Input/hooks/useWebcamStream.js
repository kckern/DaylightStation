import { useState, useEffect, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useWebcamStream' });
  return _logger;
}

export const useWebcamStream = (selectedVideoDevice, selectedAudioDevice) => {
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let localStream = null;

    const startStream = async () => {
      try {
        // Stop existing tracks
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }

        const constraints = {
          video: selectedVideoDevice
            ? {
                deviceId: { exact: selectedVideoDevice },
                width: { ideal: 1280 },
                height: { ideal: 720 }
              }
            : {
                width: { ideal: 1280 },
                height: { ideal: 720 }
              },
          audio: selectedAudioDevice
            ? { deviceId: { exact: selectedAudioDevice } }
            : true,
        };

        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        setStream(localStream);
        setError(null);

        const tracks = localStream.getTracks();
        logger().info('stream-acquired', {
          tracks: tracks.map(t => ({
            kind: t.kind,
            label: t.label,
            enabled: t.enabled,
            muted: t.muted,
            readyState: t.readyState,
          })),
          videoDevice: selectedVideoDevice?.slice(0, 8),
          audioDevice: selectedAudioDevice?.slice(0, 8),
        });

        if (videoRef.current) {
          // Give the video element only video tracks so the muted attribute
          // doesn't kill audio data for AudioContext on Android WebView
          videoRef.current.srcObject = new MediaStream(localStream.getVideoTracks());
        }
      } catch (err) {
        logger().warn('input.webcam.access_error_fallback', { error: err.message || err });
        try {
          // Fallback to any available device
          localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          setStream(localStream);
          setError(null);

          const fbTracks = localStream.getTracks();
          logger().info('stream-acquired-fallback', {
            tracks: fbTracks.map(t => ({
              kind: t.kind,
              label: t.label,
              enabled: t.enabled,
              muted: t.muted,
              readyState: t.readyState,
            })),
          });

          if (videoRef.current) {
            videoRef.current.srcObject = new MediaStream(localStream.getVideoTracks());
          }
        } catch (fallbackErr) {
          logger().error('webcam.access-error-final', { error: fallbackErr.message });
          setError(fallbackErr);
        }
      }
    };

    startStream();

    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [selectedVideoDevice, selectedAudioDevice]);

  return { videoRef, stream, error };
};
