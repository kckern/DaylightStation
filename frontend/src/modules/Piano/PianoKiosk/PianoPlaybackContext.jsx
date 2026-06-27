import { createContext, useContext, useState, useMemo, useCallback } from 'react';

const Ctx = createContext({
  playing: false, setPlaying: () => {},
  videoActive: false, setVideoActive: () => {},
});

export function PianoPlaybackProvider({ children }) {
  // `playing` = media is actively un-paused (drives the inactivity keep-alive).
  const [playing, setPlayingState] = useState(false);
  // `videoActive` = a video lecture player is MOUNTED, regardless of play/pause.
  // Player switching + the "who's playing?" re-prompt gate on this so a user
  // can't be changed (and mis-credited) mid-lesson, even while the video is paused.
  const [videoActive, setVideoActiveState] = useState(false);
  const setPlaying = useCallback((v) => setPlayingState(!!v), []);
  const setVideoActive = useCallback((v) => setVideoActiveState(!!v), []);
  const value = useMemo(
    () => ({ playing, setPlaying, videoActive, setVideoActive }),
    [playing, setPlaying, videoActive, setVideoActive],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePianoPlayback = () => useContext(Ctx);

export default Ctx;
