/**
 * The first game, taught one step at a time.
 *
 * The addressing model is the hardest thing about this screen: a player does
 * not click a piece, they spell its square on the piano, twice. The standing
 * prompt already says so, but a first-timer reads it as a sentence rather than
 * as an instruction with stages — and by the time they have picked a piece up
 * the prompt has already moved on.
 *
 * So this is a progression, not a tour: each step is keyed to a state the
 * selection machine really reaches, and it advances only when the player
 * actually reaches it. Nothing is ever waited on and nothing blocks input.
 *
 * Shown once per player. A child who has picked a piece up and moved it does
 * not need to be told again, and a coach-mark that returns every session is one
 * they learn to ignore.
 */

export const ONBOARDING_STEPS = Object.freeze(['find', 'arm', 'lift', 'land', 'done']);

/**
 * Which step the player is on, from the game itself.
 *
 * Derived rather than advanced by hand: a stored cursor would drift out of step
 * with the board the first time a player did something out of order, and the
 * state that matters is always readable from the game.
 */
export function onboardingStep({ history = [], origin = null, hoveredChord = null, armed = false }) {
  // One completed move is the whole lesson: they have picked a piece up and put
  // it down somewhere legal.
  if (history.length > 0) return 'done';
  if (origin) return 'land';
  if (armed) return 'lift';
  if (hoveredChord) return 'arm';
  return 'find';
}

/**
 * What to say at each step, in the vocabulary actually in use.
 *
 * `reading` switches chords for notes — the same split the standing prompt
 * makes, because a player being taught in one vocabulary and prompted in
 * another has been given two different games to learn.
 */
export function onboardingCopy(step, { reading = false } = {}) {
  switch (step) {
    case 'find':
      return {
        title: 'Every square has a name',
        body: reading
          ? 'Play any two notes. The board lights up the square they name.'
          : 'Play any chord. The board lights up the square it names.',
      };
    case 'arm':
      return {
        title: 'That is the square',
        body: reading
          ? 'Play those two notes again to pick the piece up.'
          : 'Play that chord again to pick the piece up.',
      };
    case 'lift':
      return {
        title: 'Once more, quickly',
        body: 'The second play has to land before the bar runs out.',
      };
    case 'land':
      return {
        title: 'Now say where it goes',
        body: reading
          ? 'Play the two notes of the square you want. The marked squares are the legal ones.'
          : 'Play the chord of the square you want. The marked squares are the legal ones.',
      };
    default:
      return null;
  }
}

/** Whether the walkthrough should be on screen at all. */
export function shouldOnboard({ seen, gameOver = false, playerTurn = true, step }) {
  if (seen) return false;
  if (gameOver) return false;
  // Never during the opponent's turn: every step asks the player to do
  // something they are not currently allowed to do.
  if (!playerTurn) return false;
  return step !== 'done';
}

export default { ONBOARDING_STEPS, onboardingStep, onboardingCopy, shouldOnboard };
