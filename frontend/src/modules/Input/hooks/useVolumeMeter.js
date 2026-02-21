import { useState, useEffect, useRef } from 'react';

export const useVolumeMeter = (stream) => {
  const [volume, setVolume] = useState(0);
  const audioContextRef = useRef(null);
  const animationIdRef = useRef(null);

  useEffect(() => {
    if (!stream) return;

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContextClass();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    audioContextRef.current = audioContext;
    const dataArray = new Uint8Array(analyser.fftSize);

    const analyzeVolume = () => {
      analyser.getByteTimeDomainData(dataArray);
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const val = (dataArray[i] - 128) / 128;
        sumSquares += val * val;
      }
      const rms = Math.sqrt(sumSquares / dataArray.length);
      setVolume(rms);
      animationIdRef.current = requestAnimationFrame(analyzeVolume);
    };
    analyzeVolume();

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      audioContext.close();
    };
  }, [stream]);

  return { volume };
};
