import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-fullscreen' });
  return _logger;
}

/**
 * Full screen — the header steps aside, and whatever is on screen gets the room
 * back. Two states, never one pretending to be both:
 *
 * KIOSK FULL SCREEN is how this tablet is set up. One toggle in the header,
 * remembered per device in localStorage, so it survives the reload every deploy
 * causes. It applies to every screen that has not claimed its own.
 *
 * BOARD-GAME FULL SCREEN belongs to a board game while it is on screen
 * (`useBoardGameFullscreen`). A board game ENTERS it on arrival — the board is
 * the whole point of the screen and a header over it is space taken from the
 * squares — and the player can step out of it with the toggle beside the
 * settings gear. That choice is the game's, not the tablet's: it is not written
 * to storage, and the next time a board game opens it is full screen again. A
 * rematch remounting the same game within a moment keeps the choice, so leaving
 * full screen once does not have to be repeated after every game.
 *
 * While a board game holds its claim, `fullscreen` answers for the board game
 * and the kiosk's remembered state is untouched underneath; when the game
 * leaves, the kiosk's answer comes back. Every consumer reads one `fullscreen`
 * and does not need to know which of the two it came from (`mode` says, for the
 * log and for anyone who does).
 *
 * ONE BUTTON AT A TIME. The toggle lives in the header while there is a header,
 * and floats in the corner while there is not — unless the surface on screen
 * hosts it itself (`useHostedFullscreenToggle`), which a board game does beside
 * its settings gear. Hosting suppresses the kiosk's own copy.
 */
export const FULLSCREEN_STORAGE_KEY = 'piano.fullscreen';

/**
 * How long a released board-game claim is remembered for the same game. A
 * rematch unmounts and remounts the board in one commit; a player walking back
 * to the menu and choosing the game again takes seconds.
 */
export const BOARD_FULLSCREEN_RESUME_MS = 2000;

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
  mode: 'kiosk',
  surface: null,
  hosted: false,
  toggle: () => {},
  setFullscreen: () => {},
  hostToggle: () => () => {},
  claimBoardGame: () => () => {},
});

const PianoFullscreenContext = createContext(INERT);

/**
 * @param {Storage|null} [storage] - defaults to window.localStorage; pass null
 *   for an unremembered session
 */
export function PianoFullscreenProvider({ children, storage }) {
  const store = storage === undefined ? defaultStore() : storage;
  const [kiosk, setKiosk] = useState(() => readFullscreen(store));
  const [claim, setClaim] = useState(null);
  const [hosts, setHosts] = useState(0);
  const kioskRef = useRef(kiosk);
  const claimRef = useRef(null);
  const releasedRef = useRef(null);

  useEffect(() => {
    if (kioskRef.current) logger().info('piano.fullscreen.restore', { fullscreen: true });
    // Mount-only: this reports the remembered state, not later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setFullscreen = useCallback((value, source = 'unknown') => {
    const next = Boolean(value);
    const held = claimRef.current;
    if (held) {
      if (next === held.fullscreen) return;
      const updated = { ...held, fullscreen: next };
      claimRef.current = updated;
      setClaim(updated);
      logger().info('piano.fullscreen.change', {
        fullscreen: next, source, mode: 'board-game', surface: held.id,
      });
      return;
    }
    if (next === kioskRef.current) return;
    kioskRef.current = next;
    writeFullscreen(next, store);
    setKiosk(next);
    logger().info('piano.fullscreen.change', { fullscreen: next, source, mode: 'kiosk' });
  }, [store]);

  const toggle = useCallback((source) => {
    const held = claimRef.current;
    setFullscreen(!(held ? held.fullscreen : kioskRef.current), source);
  }, [setFullscreen]);

  const hostToggle = useCallback(() => {
    setHosts((count) => count + 1);
    return () => setHosts((count) => count - 1);
  }, []);

  const claimBoardGame = useCallback((id, { enter = true } = {}) => {
    const released = releasedRef.current;
    const resumed = Boolean(released && released.id === id
      && Date.now() - released.at < BOARD_FULLSCREEN_RESUME_MS);
    const held = { id, fullscreen: resumed ? released.fullscreen : Boolean(enter), since: Date.now() };
    claimRef.current = held;
    setClaim(held);
    logger().info('piano.fullscreen.board.enter', {
      surface: id, fullscreen: held.fullscreen, enter: Boolean(enter), resumed, kioskFullscreen: kioskRef.current,
    });
    return () => {
      const current = claimRef.current;
      // A newer claim already replaced this one; it is not this release's to undo.
      if (!current || current.since !== held.since || current.id !== id) return;
      releasedRef.current = { id, fullscreen: current.fullscreen, at: Date.now() };
      claimRef.current = null;
      setClaim(null);
      logger().info('piano.fullscreen.board.exit', {
        surface: id, fullscreen: current.fullscreen, heldMs: Date.now() - held.since, kioskFullscreen: kioskRef.current,
      });
    };
  }, []);

  const value = useMemo(() => ({
    available: true,
    fullscreen: claim ? claim.fullscreen : kiosk,
    mode: claim ? 'board-game' : 'kiosk',
    surface: claim?.id ?? null,
    hosted: hosts > 0,
    toggle,
    setFullscreen,
    hostToggle,
    claimBoardGame,
  }), [claim, kiosk, hosts, toggle, setFullscreen, hostToggle, claimBoardGame]);

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

/**
 * A board game on screen owns full screen for as long as it is mounted.
 *
 * @param {string} gameId
 * @param {{enter?: boolean}} [options] - `enter`: arrive in full screen (the
 *   household config's `boardGameFullscreen.enterOnOpen`, on unless set off)
 */
// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its Provider/Context, like useHostedFullscreenToggle beside it
export function useBoardGameFullscreen(gameId, { enter = true } = {}) {
  const { available, claimBoardGame } = usePianoFullscreen();
  const active = available && Boolean(gameId);
  useEffect(
    () => (active ? claimBoardGame(gameId, { enter }) : undefined),
    [active, gameId, enter, claimBoardGame],
  );
}

export default PianoFullscreenProvider;
