import { createContext, useContext, useState, useMemo, useCallback } from 'react';

const Ctx = createContext({ playing: false, setPlaying: () => {} });

export function PianoPlaybackProvider({ children }) {
  const [playing, setPlayingState] = useState(false);
  const setPlaying = useCallback((v) => setPlayingState(!!v), []);
  const value = useMemo(() => ({ playing, setPlaying }), [playing, setPlaying]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePianoPlayback = () => useContext(Ctx);

export default Ctx;
