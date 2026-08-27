/**
 * GateVerdictContext — how a governor that lives OUTSIDE the player subtree gets a
 * word in.
 *
 * `useMediaGate` takes the verdicts its own caller knows about as a prop. That
 * covers the lesson's checkpoint gate, which is rendered right beside the player.
 * It does NOT cover a governor mounted above the whole app — a household screen-time
 * rule, a bedtime lock — which has no path to the player's props and must not be
 * threaded through every intermediate component to get one.
 *
 * Such a governor wraps the tree in a `GateVerdictProvider` instead, and every
 * `useMediaGate` below it picks the verdict up. Providers NEST: an inner provider
 * appends to whatever the outer ones contributed rather than replacing it, so a
 * lesson-scoped provider can never shadow the household rule above it.
 *
 * ## Order is meaning
 *
 * `resolvePause` names the FIRST blocking gate in array order, and that id is what
 * overlays and logs show. Outer contributions therefore come FIRST: when the
 * household lock and a comprehension checkpoint both refuse, the kid is told about
 * the household lock — the one answering questions will not clear. Reversing this
 * would show a checkpoint the kid can pass and still leave playback dead.
 *
 * ## Why the value is keyed on a SIGNATURE and not on array identity
 *
 * A provider written the obvious way (`verdicts={[{ blocked, id }]}`) builds a new
 * array of new objects every render. Passing that straight through as the context
 * value re-renders every consumer in the subtree on each of the provider's own
 * renders, for a value that did not change. This house has already paid for that
 * shape once — an inline object literal on the player remounted it in a loop and
 * opened 495 Plex transcode sessions.
 *
 * So the value is memoized on a signature over the three fields `resolvePause`
 * actually consumes (`blocked`, `id`, `seekCeiling`). Two verdict arrays with equal
 * fields ARE the same verdict as far as every consumer is concerned.
 *
 * The consequence to know: when the fields match, consumers keep the PREVIOUS
 * verdict objects. That is invisible while `blocked`/`id`/`seekCeiling` are the whole
 * contract, and wrong the moment a verdict carries something else a consumer reads —
 * an overlay payload, a question id. So if `GateVerdict` grows a field ANY consumer
 * reads, add it to `signature()` in the same commit.
 */

import { createContext, useContext, useMemo } from 'react';

/** Shared frozen empty: the no-provider default must not be a fresh array per read. */
const EMPTY = Object.freeze([]);

const GateVerdictContext = createContext(EMPTY);

/** Exactly the fields `pauseArbiter.resolvePause` reads off a `GateVerdict`. */
const signature = (list) => list
  .map((v) => `${v?.id ?? ''}~${v?.blocked ? 1 : 0}~${Number.isFinite(v?.seekCeiling) ? v.seekCeiling : ''}`)
  .join('|');

/**
 * @param {object} props
 * @param {import('./pauseArbiter.js').GateVerdict[]} [props.verdicts] this level's
 *   contribution. Non-arrays (a governor still loading) are treated as no contribution.
 */
export function GateVerdictProvider({ verdicts, children }) {
  const outer = useContext(GateVerdictContext);
  const mine = Array.isArray(verdicts) ? verdicts : EMPTY;
  const key = `${signature(outer)}#${signature(mine)}`;

  // `key` is the whole dependency on purpose — see the header. `outer` and `mine` are
  // read through it, and any change either can make is a change to the signature.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(
    () => (outer.length || mine.length ? Object.freeze([...outer, ...mine]) : EMPTY),
    [key]
  );

  return <GateVerdictContext.Provider value={value}>{children}</GateVerdictContext.Provider>;
}

/**
 * @returns {import('./pauseArbiter.js').GateVerdict[]} contributions from every
 *   provider above this point, outermost first. `[]` with no provider — a player
 *   outside any governed tree is the normal case, not an error.
 */
export const useContributedVerdicts = () => useContext(GateVerdictContext);

export default GateVerdictContext;
