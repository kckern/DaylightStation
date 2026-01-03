import { useState, useEffect, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

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

        if (videoRef.current) {
          videoRef.current.srcObject = localStream;
        }
      } catch (err) {
        getLogger().warn('input.webcam.access_error_fallback', { error: err.message || err });
        try {
          // Fallback to any available device
          localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          setStream(localStream);
          setError(null);
          
          if (videoRef.current) {
            videoRef.current.srcObject = localStream;
          }
        } catch (fallbackErr) {
          console.error("Error accessing default devices:", fallbackErr);
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
