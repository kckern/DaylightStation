import { onboardingCopy, onboardingStep, shouldOnboard } from './chessOnboarding.js';
import { opponentMood, opponentStatus } from './opponentViewModel.js';
import { REJECTION_MESSAGES, isPlayerTurn } from './chessGameState.js';

const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export function promptFor(state, rejection, hoveredChord = null, reading = false, takebackArmed = false) {
  if (state.status?.game_over) {
    if (state.status.outcome === 'checkmate') {
      return state.status.winner === state.playerColor ? 'Checkmate. You win.' : 'Checkmate. Your opponent wins.';
    }
    return `Draw — ${state.status.outcome.replace(/_/g, ' ')}.`;
  }
  if (rejection) return REJECTION_MESSAGES[rejection.reason] ?? 'Try another chord.';
  if (takebackArmed) return 'Play the octave again to take your move back.';
  if (!isPlayerTurn(state)) return 'Your opponent is thinking.';
  if (state.status?.check) return 'You are in check. Play a chord to answer it.';
  if (state.origin) {
    return reading
      ? 'Now play the two notes of the square to move to.'
      : 'Now play the chord of the square to move to.';
  }
  if (hoveredChord) return `Play ${hoveredChord} again to pick that piece up.`;
  return reading
    ? "Play a piece's two notes twice to pick it up."
    : "Play a piece's chord twice to pick it up.";
}

export function safeBoardTheme(theme) {
  const parsed = typeof theme === 'string'
    ? theme.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/)
    : null;
  if (!parsed) return theme ?? null;
  const [, hue, saturation, lightness] = parsed;
  const safeLightness = Math.min(52, Math.max(26, Number(lightness)));
  const safeSaturation = Math.min(46, Math.max(14, Number(saturation)));
  return `hsl(${hue} ${safeSaturation}% ${safeLightness}%)`;
}

/** Derive every sentence and semantic state consumed by the two side rails. */
export function buildChessRailViewModel({
  game,
  playerColor,
  opponent,
  opponentThinking,
  finishedResult,
  cursor,
  cursorChord,
  movableSources,
  armed,
  introSeen,
  reading,
  takebackArmed,
}) {
  const playerTurn = isPlayerTurn(game);
  const pickupChord = !game.origin && cursor && movableSources.includes(cursor)
    ? cursorChord?.symbol ?? null
    : null;
  const step = onboardingStep({
    history: game.history,
    origin: game.origin,
    hoveredChord: pickupChord,
    armed: Boolean(armed?.square),
  });
  const showOnboarding = shouldOnboard({
    seen: introSeen,
    gameOver: !!game.status?.game_over,
    playerTurn,
    step,
  });
  const lastOpponentMove = [...game.history].reverse()
    .find((entry) => entry.color !== playerColor) ?? null;
  const lastMove = game.history.at(-1);
  const turnColour = game.status?.turn === 'w' ? 'White' : 'Black';

  return {
    boardTheme: safeBoardTheme(opponent?.theme),
    mood: opponentMood({
      thinking: opponentThinking,
      gameOver: !!game.status?.game_over,
      result: finishedResult,
      tookPiece: !!lastMove?.captured && lastMove.color !== playerColor,
      lostPiece: !!lastMove?.captured && lastMove.color === playerColor,
      givingCheck: !!game.status?.check && game.status.turn === playerColor,
    }),
    opponentLine: opponentStatus({
      thinking: opponentThinking,
      lastMove: lastOpponentMove?.san ?? null,
      lastCapture: lastOpponentMove?.captured ? PIECE_NAMES[lastOpponentMove.captured] : null,
      gameOver: !!game.status?.game_over,
      result: finishedResult,
    }),
    pickupChord,
    onboardStep: step,
    onboardCopy: showOnboarding ? onboardingCopy(step, { reading }) : null,
    prompt: promptFor(game, game.rejection, pickupChord, reading, takebackArmed),
    pickupDeadline: pickupChord && armed?.square === cursor ? armed.at : null,
    turnColour,
    turnLabel: game.status?.turn === playerColor ? `Yours (${turnColour})` : `Theirs (${turnColour})`,
  };
}

export default buildChessRailViewModel;
