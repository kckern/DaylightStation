import { createContext, createElement, useContext, useMemo } from 'react';

/**
 * PlaybackSurfaceContext — how the person in front of this Player can act.
 *
 * The Player cannot tell a garage touch screen from a living-room D-pad from
 * an office keypad, and its held card used to offer the same buttons on all of
 * them. The host says which it is:
 *
 *   'touch'   tap targets (fitness, portal, piano tablet)
 *   'pointer' mouse/touch web app with its own transport (MediaApp, admin) — the default
 *   'remote'  D-pad + OK (living room)
 *   'numpad'  dedicated function keys, no OK or arrows (office keypad)
 *   'none'    nobody can press anything here — the Player acts on its own
 *
 * Screens declare it in their config (`input.type`); apps provide it.
 */
export const PLAYBACK_INPUTS = ['touch', 'pointer', 'remote', 'numpad', 'none'];
const DEFAULT_SURFACE = Object.freeze({ input: 'pointer' });

const PlaybackSurfaceContext = createContext(DEFAULT_SURFACE);

/** A screen config's `input.type` as a playback input. An undeclared screen has no input. */
export function inputFromScreenType(type) {
  const t = typeof type === 'string' ? type.trim().toLowerCase() : '';
  if (t === 'touch') return 'touch';
  if (t === 'remote' || t === 'gamepad' || t === 'keyboard') return 'remote';
  if (t === 'numpad') return 'numpad';
  return 'none';
}

export function PlaybackSurfaceProvider({ input, children }) {
  const value = useMemo(
    () => ({ input: PLAYBACK_INPUTS.includes(input) ? input : DEFAULT_SURFACE.input }),
    [input],
  );
  return createElement(PlaybackSurfaceContext.Provider, { value }, children);
}

export function usePlaybackSurface() {
  return useContext(PlaybackSurfaceContext);
}
