import { useState, useEffect, useRef } from 'react';

export const useWebcamStream = (selectedVideoDevice, selectedAudioDevice) => {
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let localStream = null;

    const startStream = async () => {
      // If no devices selected yet, wait
      if (!selectedVideoDevice && !selectedAudioDevice) return;

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
                height: { ideal: 720 },
              }
            : true,
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
        console.warn("Error accessing selected devices, falling back to defaults:", err);
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
