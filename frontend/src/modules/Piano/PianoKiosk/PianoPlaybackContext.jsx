import { createContext, useState, useMemo, useCallback } from 'react';

export const Ctx = createContext({
  playing: false, setPlaying: () => {},
  videoActive: false, setVideoActive: () => {},
  playerLocks: [], claimPlayerLock: () => () => {},
});

export function PianoPlaybackProvider({ children }) {
  // `playing` = media is actively un-paused (drives the inactivity keep-alive).
  const [playing, setPlayingState] = useState(false);
  // `videoActive` = a video lecture player is MOUNTED, regardless of play/pause.
  // Player switching + the "who's playing?" re-prompt gate on this so a user
  // can't be changed (and mis-credited) mid-lesson, even while the video is paused.
  const [videoActive, setVideoActiveState] = useState(false);
  // Anything else that must not have the player changed underneath it holds a
  // named lock. A lesson is not the only such thing — a game in progress credits
  // its result to whoever started it, so switching players mid-game either
  // mis-credits the record or silently plays on the wrong child's settings. A
  // list rather than a flag so two claimants cannot release each other's lock.
  const [playerLocks, setPlayerLocks] = useState([]);
  const claimPlayerLock = useCallback((reason) => {
    const token = { reason };
    setPlayerLocks((locks) => [...locks, token]);
    return () => setPlayerLocks((locks) => locks.filter((entry) => entry !== token));
  }, []);
  const setPlaying = useCallback((v) => setPlayingState(!!v), []);
  const setVideoActive = useCallback((v) => setVideoActiveState(!!v), []);
  const value = useMemo(
    () => ({ playing, setPlaying, videoActive, setVideoActive, playerLocks, claimPlayerLock }),
    [playing, setPlaying, videoActive, setVideoActive, playerLocks, claimPlayerLock],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export default Ctx;
