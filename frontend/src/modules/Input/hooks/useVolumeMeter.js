import { useState, useEffect, useRef } from 'react';

export const useVolumeMeter = (selectedAudioDevice) => {
  const [volume, setVolume] = useState(0);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const animationIdRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    const startMeter = async () => {
      if (!selectedAudioDevice) return;

      try {
        // Create a separate audio-only stream for analysis
        // This avoids interfering with the main video/audio stream used for display/recording
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: selectedAudioDevice } },
        });
        streamRef.current = stream;

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioContextClass();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;

        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        audioContextRef.current = audioContext;
        analyserRef.current = analyser;
        dataArrayRef.current = new Uint8Array(analyser.fftSize);

        const analyzeVolume = () => {
          if (!analyserRef.current) return;
          
          analyserRef.current.getByteTimeDomainData(dataArrayRef.current);
          let sumSquares = 0;
          for (let i = 0; i < dataArrayRef.current.length; i++) {
            const val = (dataArrayRef.current[i] - 128) / 128; // center around zero
            sumSquares += val * val;
          }
          const rms = Math.sqrt(sumSquares / dataArrayRef.current.length);
          setVolume(rms);

          animationIdRef.current = requestAnimationFrame(analyzeVolume);
        };
        analyzeVolume();

      } catch (error) {
        console.error("Error starting volume meter:", error);
      }
    };

    // Cleanup previous context
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }

    startMeter();

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, [selectedAudioDevice]);

  return { volume };
};
