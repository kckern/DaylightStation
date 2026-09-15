import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useBuzzers } from '../interaction/useBuzzers.js';
import { GuessingMusic } from '../effects/GuessingMusic.js';
import { AudioCueEngine } from '../effects/AudioCueEngine.js';

// Adapts Party Games hardware/effects to the environment-neutral capability
// ports consumed by experiences. Experiences never import this environment.
export default function PartyGamesExperience({ component: Experience, seats, buzzerBindings, config, ...props }) {
  const buzzListeners = useRef(new Set());
  const audio = useMemo(
    () => new AudioCueEngine({ pack: config?.sounds?.pack, mute: config?.defaults?.mute }),
    [config?.defaults?.mute, config?.sounds?.pack],
  );
  const music = useMemo(() => new GuessingMusic(), []);
  const onBuzz = useCallback((teamId) => {
    for (const listener of buzzListeners.current) listener(teamId);
  }, []);
  const { arbiter, locked, arm, disarm } = useBuzzers({ teams: seats, onLock: onBuzz });
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    if (buzzerBindings) arbiter.restore({ slotToTeam: buzzerBindings });
  }, [arbiter, buzzerBindings]);

  useEffect(() => () => {
    music.stop();
    audio.stopChannel('music');
    audio.stopChannel('sfx');
    audio.stopChannel('clue-media');
  }, [audio, music]);

  const subscribe = useCallback((listener) => {
    buzzListeners.current.add(listener);
    return () => buzzListeners.current.delete(listener);
  }, []);
  const gamingServices = useMemo(() => ({
    audio,
    music,
    buzzers: {
      get locked() { return lockedRef.current; },
      arm,
      disarm,
      subscribe,
    },
  }), [audio, music, arm, disarm, subscribe]);

  return <Experience {...props} seats={seats} config={config} gamingServices={gamingServices} />;
}
