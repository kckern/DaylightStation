import { useCallback, useRef } from 'react';

const useAudioFeedback = ({
  volume = 0.5,
  sounds = {}
} = {}) => {
  const audioCache = useRef({});

  const play = useCallback((soundName) => {
    const src = sounds[soundName];
    if (!src) return;

    let audio = audioCache.current[soundName];
    
    if (!audio) {
      audio = new Audio(src);
      audioCache.current[soundName] = audio;
    }

    audio.volume = volume;
    audio.currentTime = 0;
    audio.play().catch(err => console.warn('Audio playback failed:', err));
  }, [sounds, volume]);

  const playClick = useCallback(() => play('click'), [play]);
  const playSuccess = useCallback(() => play('success'), [play]);
  const playError = useCallback(() => play('error'), [play]);
  const playCount = useCallback(() => play('count'), [play]);

  return {
    play,
    playClick,
    playSuccess,
    playError,
    playCount
  };
};

export default useAudioFeedback;
