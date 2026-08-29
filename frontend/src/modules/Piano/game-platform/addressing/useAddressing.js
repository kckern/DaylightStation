import { useMemo } from 'react';
import { resolveAddressing } from './resolveAddressing.js';
import { schemeFor } from './buildScheme.js';

/**
 * The addressing a game should be using, right now.
 *
 * One hook, so a game does not have to know the order of the layers, when the
 * seed matters, or how to turn a resolved config into a scheme. It returns the
 * two arrays a game actually consumes — `x` (files/columns) and `y`
 * (ranks/rows) — plus the resolved dimensions, so a rail can print what
 * vocabulary it is in without re-deriving it.
 *
 * The seed only reaches the builder when the cadence says the map moves. A
 * sequential board must produce the SAME scheme every game and every turn, or
 * anything keyed on the scheme id sees a re-deal that never happened.
 *
 *   never      → seed 0, forever
 *   each_game  → the game's seed, which changes on restart
 *   each_turn  → the game's seed advanced by the ply
 *
 * `overrides` maps a native game's explicit config fields onto the common
 * addressing dimensions.
 */
export function useAddressing({
  config = null,
  user = null,
  axisSize = 8,
  seed = 0,
  ply = 0,
  overrides = null,
  managed = null,
} = {}) {
  const resolved = useMemo(() => resolveAddressing({
    game: { ...(overrides || {}), ...(config || {}) },
    user: managed || user,
    ladder: config?.addressing?.ladder ?? null,
    axisSize,
  }), [config, user, managed, axisSize, overrides]);

  const dealSeed = resolved.shuffle === 'each_turn'
    ? (((seed >>> 0) + ply) >>> 0)
    : resolved.shuffle === 'each_game' ? (seed >>> 0) : 0;

  const built = useMemo(
    () => schemeFor(resolved, { size: axisSize, seed: dealSeed }),
    [resolved, axisSize, dealSeed],
  );

  return {
    addressing: resolved,
    scheme: built.scheme,
    valid: built.valid,
    errors: built.errors,
    source: built.source,
    x: built.scheme.roots,
    y: built.scheme.qualities,
    dealSeed,
  };
}

export default useAddressing;
