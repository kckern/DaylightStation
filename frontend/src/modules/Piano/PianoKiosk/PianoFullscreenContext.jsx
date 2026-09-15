import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-fullscreen' });
  return _logger;
}

/**
 * Kiosk full screen — the header steps aside, and whatever is on screen gets
 * the room back.
 *
 * A capability of the KIOSK, not of any one surface: one state, one button, and
 * every screen reads the same answer. What a surface does with the room is its
 * own business (a board game slims its keyboard and grows its rim; the menu
 * simply has more height), but none of them owns whether the kiosk is in full
 * screen, and none of them can disagree about it.
 *
 * ONE BUTTON AT A TIME. The toggle lives in the header while there is a header,
 * and floats in the corner while there is not — unless the surface on screen
 * hosts it itself (`useHostedFullscreenToggle`), which a board game does beside
 * its settings gear, where the player's hands already go. Hosting suppresses the
 * kiosk's own copy, so there is never a second button saying the same thing.
 *
 * Remembered per device, in localStorage: it is how this tablet is set up, not a
 * fact about the player, and it survives the reload every deploy causes.
 */
export const FULLSCREEN_STORAGE_KEY = 'piano.fullscreen';

function defaultStore() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Never throws — a blocked store reads as "not full screen". */
export function readFullscreen(store = defaultStore()) {
  try {
    return store?.getItem(FULLSCREEN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Never throws — a blocked store only loses the memory, not the toggle. */
export function writeFullscreen(value, store = defaultStore()) {
  try {
    if (value) store?.setItem(FULLSCREEN_STORAGE_KEY, 'true');
    else store?.removeItem(FULLSCREEN_STORAGE_KEY);
  } catch {
    // The state still changes for this session.
  }
}

/**
 * Outside the kiosk (the office wall screen mounts the same games, tests render
 * components bare) there is no header to hide: full screen is unavailable, and
 * every consumer reads that as "draw nothing extra".
 */
const INERT = Object.freeze({
  available: false,
  fullscreen: false,
  hosted: false,
  toggle: () => {},
  setFullscreen: () => {},
  hostToggle: () => () => {},
});

const PianoFullscreenContext = createContext(INERT);

/**
 * @param {Storage|null} [storage] - defaults to window.localStorage; pass null
 *   for an unremembered session
 */
export function PianoFullscreenProvider({ children, storage }) {
  const store = storage === undefined ? defaultStore() : storage;
  const [fullscreen, setState] = useState(() => readFullscreen(store));
  const [hosts, setHosts] = useState(0);
  const current = useRef(fullscreen);

  useEffect(() => {
    if (current.current) logger().info('piano.fullscreen.restore', { fullscreen: true });
    // Mount-only: this reports the remembered state, not later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setFullscreen = useCallback((value, source = 'unknown') => {
    const next = Boolean(value);
    if (next === current.current) return;
    current.current = next;
    writeFullscreen(next, store);
    setState(next);
    logger().info('piano.fullscreen.change', { fullscreen: next, source });
  }, [store]);

  const toggle = useCallback((source) => setFullscreen(!current.current, source), [setFullscreen]);

  const hostToggle = useCallback(() => {
    setHosts((count) => count + 1);
    return () => setHosts((count) => count - 1);
  }, []);

  const value = useMemo(() => ({
    available: true,
    fullscreen,
    hosted: hosts > 0,
    toggle,
    setFullscreen,
    hostToggle,
  }), [fullscreen, hosts, toggle, setFullscreen, hostToggle]);

  return <PianoFullscreenContext.Provider value={value}>{children}</PianoFullscreenContext.Provider>;
}

export function usePianoFullscreen() {
  return useContext(PianoFullscreenContext);
}

/**
 * A surface that draws the toggle itself calls this for as long as it does, so
 * the kiosk withdraws its own copy. Returns whether the surface should draw it:
 * false outside the kiosk, where there is nothing to toggle.
 */
export function useHostedFullscreenToggle(enabled) {
  const { available, hostToggle } = usePianoFullscreen();
  const active = Boolean(enabled) && available;
  useEffect(() => (active ? hostToggle() : undefined), [active, hostToggle]);
  return active;
}

export default PianoFullscreenProvider;
