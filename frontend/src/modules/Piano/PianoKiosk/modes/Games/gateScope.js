/**
 * Who the match gate stands in front of.
 *
 * Pure config addressing, deliberately NOT inside `GameGate.jsx`: `Games.jsx`
 * has to answer "does the gate apply here?" BEFORE it decides whether to mount
 * the gate at all, and every spec that renders `Games` mocks the gate away. A
 * helper living in the mocked module is a helper the host cannot use.
 */

/**
 * Flatten a household `gameGate` block for ONE child: the top level is the
 * default for everybody, `users.{learnerId}` is that child's optional override,
 * merged key-over-key on top of it.
 *
 * This is the only shape that lets the gate be rolled out to one child — or
 * switched off for one — without moving the household's settings around. A
 * child with no entry gets the top level unchanged, which is why the default
 * has to be a real configuration rather than a placeholder.
 *
 * `users` itself is stripped from the result: it is addressing, not settings,
 * and leaving it in would let `resolveGateConfig` see a key it has no rule for.
 * `Object.hasOwn` because a learner slug reaches this from the roster and
 * `users.constructor` must not resolve to a function.
 */
export function gateConfigForLearner(raw, learnerId) {
  const base = raw && typeof raw === 'object' ? raw : {};
  const { users, ...defaults } = base;
  const table = users && typeof users === 'object' ? users : null;
  const override = table && learnerId && Object.hasOwn(table, learnerId) ? table[learnerId] : null;
  return override && typeof override === 'object' ? { ...defaults, ...override } : defaults;
}

/**
 * Does the gate stand in front of THIS child on THIS game?
 *
 * `games` is an optional allowlist of game ids. Absent (or not an array) means
 * every game, which is the whole-household answer; present means exactly those.
 * It exists so a household can put the gate in front of one game first and
 * watch it work before it stands in front of all nine.
 */
export function gateAppliesTo(raw, { learnerId, gameId }) {
  const forLearner = gateConfigForLearner(raw, learnerId);
  if (forLearner.enabled !== true) return false;
  const { games } = forLearner;
  if (!Array.isArray(games)) return true;
  return games.includes(gameId);
}
