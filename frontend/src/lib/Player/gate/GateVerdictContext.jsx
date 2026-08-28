/* eslint-disable react-refresh/only-export-components -- the provider and the consumer
   hook that reads it are one context module; splitting them would put two halves of a
   single contract in two files. Same call as FeedPlayerContext.jsx. */

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
 * The consequence, and it is sharp: when the signature fields match, consumers keep
 * the PREVIOUS verdict OBJECTS. A provider flipping a `questionId` q1 -> q2 -> q3 with
 * `blocked`/`id`/`seekCeiling` unchanged hands every consumer `q1` three times.
 *
 * Worse, the two channels behave DIFFERENTLY. The same verdict object passed through
 * `useMediaGate`'s own `verdicts` prop stays live, because the hook stabilizes its
 * OUTPUT (the decision) rather than its inputs. So an identical payload is fresh via
 * the prop and stale via the provider, with no error and nothing failing.
 *
 * A comment is not enough to hold that, so `warnOnExtraFields` below says it out loud
 * in dev the first time a verdict carries a field this module cannot track. If
 * `GateVerdict` grows a field ANY consumer reads, add it to `signature()` and to
 * `SIGNED_FIELDS` in the same commit.
 */

import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import getLogger from '../../logging/Logger.js';

// Lazy module logger: `getLogger()` at import time binds before the app configures the
// logger (CLAUDE.md, "Module-Level Loggers").
let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ app: 'player', component: 'gate-verdicts' });
  return _logger;
}

/** Shared frozen empty: the no-provider default must not be a fresh array per read. */
const EMPTY = Object.freeze([]);

const GateVerdictContext = createContext(EMPTY);

/**
 * The fields the signature covers — i.e. exactly what a consumer may rely on being
 * fresh. Anything else on a verdict is frozen at the last signature change.
 */
const SIGNED_FIELDS = new Set(['blocked', 'id', 'seekCeiling']);

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

  // Read through a ref so the dev check below depends only on `key` — it must not
  // resubscribe on the identity churn this whole module exists to absorb.
  const mineRef = useRef(mine);
  mineRef.current = mine;
  const warnedRef = useRef(null);

  // DEV-only, once per offending field name per provider. See the header: an untracked
  // field on a verdict goes silently stale here while the same field passed through
  // `useMediaGate`'s `verdicts` prop stays live, and nothing else would ever say so.
  useEffect(() => {
    if (!import.meta.env?.DEV) return;
    const extras = [];
    mineRef.current.forEach((verdict) => {
      Object.keys(verdict || {}).forEach((field) => {
        if (SIGNED_FIELDS.has(field)) return;
        if (!warnedRef.current) warnedRef.current = new Set();
        if (warnedRef.current.has(field)) return;
        warnedRef.current.add(field);
        extras.push(field);
      });
    });
    if (!extras.length) return;
    logger().warn('gate.verdict-untracked-fields', {
      fields: extras,
      ids: mineRef.current.map((v) => v?.id ?? null),
      detail: 'not covered by the context signature — consumers will read a STALE value '
        + 'once the signed fields stop changing. Add it to signature()/SIGNED_FIELDS, '
        + 'or pass it through useMediaGate\'s own `verdicts` prop, which stays live.'
    });
  }, [key]);

  // `key` is the whole dependency on purpose — see the header. `outer` and `mine` are
  // read through it, and any change either can make is a change to the signature.
  // Listing them as well would defeat the memo: both are fresh objects every render,
  // which is the churn this file exists to absorb.
  const value = useMemo(
    () => (outer.length || mine.length ? Object.freeze([...outer, ...mine]) : EMPTY),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
