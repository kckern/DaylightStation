/**
 * What the lobby says about where a player stands in this round.
 *
 * A child beat the same opponent six times and did not advance, and no screen
 * told him why — so he decided the ladder was broken. Four of those six wins
 * had leant on the analysis engine and did not count. Every part of that was
 * working as designed; none of it was ever said out loud.
 *
 * Two rows and one sentence, and the split between them is the whole point.
 * The ROWS are cumulative — they only ever grow, because a trophy is something
 * you earned and keep. The SENTENCE carries the gate, which is recent form and
 * therefore allowed to fall. Drawing the gate as trophies would take a trophy
 * back after a bad afternoon, which is the lost ground the ladder refuses.
 *
 * The practice row is never an apology. Those were real wins, and they are
 * named for what they were rather than for what they failed to be.
 */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The two rows, in order. `filled` is how many markers to draw.
 *
 * A row with nothing in it is still returned — an empty Match wins row is the
 * clearest possible statement of what there is to do, and a row that appears
 * only once you have one is a row nobody can aim at.
 */
export function standingRows(standing) {
  if (!standing) return [];
  return [
    {
      key: 'counted',
      label: 'Match wins',
      filled: Math.max(0, Number(standing.counted) || 0),
      note: 'won on your own',
    },
    {
      key: 'practice',
      label: 'Practice wins',
      filled: Math.max(0, Number(standing.practice) || 0),
      note: 'matches where you used help',
    },
  ];
}

/**
 * The one line that states the requirement, in tournament words.
 *
 * Opponents wait in the ring and a player goes through to the next round;
 * nothing here is unlocked. `nextName` is the opponent after this one, which
 * the caller reads from the roster — `roundStanding` deliberately carries no
 * names.
 */
export function gateSentence(standing, { nextName = null } = {}) {
  if (!standing) return null;
  if (standing.atTop) return 'You have beaten everyone. There is no one left in the ring.';

  const through = nextName ? `through to ${nextName}` : 'through to the next round';
  if (standing.promotes) return `You're ${through}.`;

  const { gateWins = 0, gateWindow = 7, remaining = 0 } = standing;
  const form = gateWins === 0
    ? `None of your last ${gateWindow} matches count yet.`
    : `Right now: ${gateWins} of your last ${gateWindow} count.`;
  return `${form} ${plural(remaining, 'more win', 'more wins')} on your own and you're ${through}.`;
}

/** The heading: which round this is, and who is standing in it. */
export function roundHeading(standing, { opponentName = null } = {}) {
  if (!standing) return null;
  const round = `Round ${standing.round}`;
  return opponentName ? `${round} — ${opponentName}` : round;
}

export default { standingRows, gateSentence, roundHeading };
