import { useState, useEffect, useRef } from 'react';

const amplifiers = new WeakMap();

export const useMediaAmplifier = (mediaElement) => {
  const [boostLevel, setBoostLevel] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('daylight-media-boost');
      return saved ? parseFloat(saved) : 1;
    }
    return 1;
  });
  const amplifierRef = useRef(null);

  useEffect(() => {
    if (!mediaElement) return;

    // Initialize AudioContext if not already done for this element
    if (!amplifiers.has(mediaElement)) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      
      const context = new Context();
      let source;
      try {
        source = context.createMediaElementSource(mediaElement);
      } catch (e) {
        console.error("Failed to create MediaElementSource", e);
        return;
      }
      const gainNode = context.createGain();
      
      source.connect(gainNode);
      gainNode.connect(context.destination);
      
      const amp = {
        context,
        source,
        gainNode,
        boost: boostLevel // Use initialized state
      };
      
      amplifiers.set(mediaElement, amp);
    }

    amplifierRef.current = amplifiers.get(mediaElement);
    // Ensure the ref matches state (in case we just mounted with a saved value)
    amplifierRef.current.boost = boostLevel;

    // Function to sync gain based on volume and boost
    const syncGain = () => {
        if (amplifierRef.current) {
            const volume = mediaElement.muted ? 0 : mediaElement.volume;
            const totalGain = volume * amplifierRef.current.boost;
            
            // Smooth transition
            const currentTime = amplifierRef.current.context.currentTime;
            try {
                amplifierRef.current.gainNode.gain.cancelScheduledValues(currentTime);
                amplifierRef.current.gainNode.gain.setTargetAtTime(totalGain, currentTime, 0.1);
            } catch (e) {
                amplifierRef.current.gainNode.gain.value = totalGain;
            }
        }
    };

    // Initial sync
    syncGain();

    // Listen for volume changes on the media element
    mediaElement.addEventListener('volumechange', syncGain);
    
    // Also listen for play events to resume context if suspended (browser policy)
    const handlePlay = () => {
        if (amplifierRef.current?.context.state === 'suspended') {
            amplifierRef.current.context.resume();
        }
    };
    mediaElement.addEventListener('play', handlePlay);

    return () => {
        mediaElement.removeEventListener('volumechange', syncGain);
        mediaElement.removeEventListener('play', handlePlay);
    };

  }, [mediaElement]); // Removed boostLevel from dependency to avoid re-creating listeners

  // Effect to handle boost level changes separately
  useEffect(() => {
    if (amplifierRef.current) {
        amplifierRef.current.boost = boostLevel;
        // Trigger sync
        if (mediaElement) {
            mediaElement.dispatchEvent(new Event('volumechange'));
        }
    }
    if (typeof window !== 'undefined') {
        window.localStorage.setItem('daylight-media-boost', boostLevel);
    }
  }, [boostLevel, mediaElement]);

  const setBoost = (level) => {
    setBoostLevel(level);
  };

  return {
    boostLevel,
    setBoost
  };
};
