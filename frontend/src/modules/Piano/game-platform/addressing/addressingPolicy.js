/**
 * addressingPolicy — the one shape a host hands a board game so the game can
 * work out how hard the reading should be.
 *
 * IT DESCRIBES THE PLAYER, NOT THE SCREEN. The same child, on the same game,
 * must meet the same map from keys to squares whether they are at the piano
 * kiosk or at the office display. That was not true: the kiosk built this
 * object inline and the office host mounted the same lazy game component
 * without it. Every board game defaults the prop to `null`, so the office fell
 * all the way through to the built-in default — which for chess is `chords` —
 * while the kiosk resolved the learner's standing and got staff cards. One
 * player, one game, two vocabularies, decided by which room they walked into.
 *
 * The shape was duplicated at one call site and missing at the other, which is
 * how it drifted; it is built here now so a third host has something to reach
 * for and a test has something to point at.
 *
 * @param {object|null} config the household's `gameAddressing` block
 * @param {string|null} learnerId whose standing decides the rung. A null
 *   learner (nobody picked yet, a guest) is a real answer, not a missing one:
 *   the games read it as "no standing", which is the bottom of the ladder.
 * @param {number} completedGames how many board games they have finished
 *   today — the ladder's only input (see `managedAddressing.js`).
 */
export function addressingPolicyFor({ config = null, learnerId = null, completedGames = 0 } = {}) {
  return {
    config: config ?? null,
    learnerId: learnerId ?? null,
    completedGames: Number.isInteger(completedGames) ? completedGames : 0,
  };
}

export default addressingPolicyFor;
