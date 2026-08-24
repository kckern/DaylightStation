import { INITIAL_FEN } from '@shared-gaming/rulesets/chess/index.mjs';

/**
 * The chess curriculum — structure now, content later.
 *
 * Every lesson below is a real entry with a real starting position, and every
 * one is marked `status: 'outline'`. That is the honest state of this file: the
 * shape of the course is decided, the teaching is not written. A lesson becomes
 * `status: 'ready'` when its `steps` are authored, and only ready lessons are
 * offered as work — an outline lesson still renders, but says what it is.
 *
 * Lesson kinds:
 *   demonstration — a position and a line to play through; the student watches
 *   drill         — a position with a task; the student answers on the board
 *   play          — a full game against the opponent, optionally from a position
 */

export const LESSON_KINDS = Object.freeze({
  demonstration: { label: 'Watch', hint: 'Play through a line' },
  drill: { label: 'Try', hint: 'Find the move' },
  play: { label: 'Play', hint: 'A full game' },
});

/** Only the piece being taught, so a first lesson is not a wall of 32 pieces. */
const BARE_BOARD = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';

export const CHESS_UNITS = Object.freeze([
  {
    id: 'board',
    title: 'The board',
    summary: 'Squares, files, ranks, and how to name them.',
    lessons: [
      { id: 'board-squares', title: 'Sixty-four squares', kind: 'demonstration', fen: BARE_BOARD, summary: 'Light and dark, and why the right-hand corner is always light.' },
      { id: 'board-names', title: 'Naming a square', kind: 'drill', fen: BARE_BOARD, summary: 'Files are letters, ranks are numbers. Find the square you are asked for.' },
      { id: 'board-setup', title: 'Setting up', kind: 'demonstration', fen: INITIAL_FEN, summary: 'Where each piece starts, and the queen on her own colour.' },
    ],
  },
  {
    id: 'pieces',
    title: 'The pieces',
    summary: 'How each piece moves and what it is worth.',
    lessons: [
      { id: 'piece-rook', title: 'The rook', kind: 'demonstration', fen: '4k3/8/8/8/3R4/8/8/4K3 w - - 0 1', summary: 'Straight lines, as far as it likes.' },
      { id: 'piece-bishop', title: 'The bishop', kind: 'demonstration', fen: '4k3/8/8/8/3B4/8/8/4K3 w - - 0 1', summary: 'Diagonals only — and it never leaves its colour.' },
      { id: 'piece-queen', title: 'The queen', kind: 'demonstration', fen: '4k3/8/8/8/3Q4/8/8/4K3 w - - 0 1', summary: 'Rook and bishop at once, the strongest piece.' },
      { id: 'piece-knight', title: 'The knight', kind: 'demonstration', fen: '4k3/8/8/8/3N4/8/8/4K3 w - - 0 1', summary: 'An L-shape, and the only piece that jumps.' },
      { id: 'piece-pawn', title: 'The pawn', kind: 'demonstration', fen: '4k3/8/8/8/8/8/3P4/4K3 w - - 0 1', summary: 'Forward to move, diagonally to take. It never goes back.' },
      { id: 'piece-king', title: 'The king', kind: 'demonstration', fen: BARE_BOARD, summary: 'One square any way — and the piece the whole game is about.' },
      { id: 'piece-values', title: 'What pieces are worth', kind: 'drill', fen: INITIAL_FEN, summary: 'Pawn 1, knight and bishop 3, rook 5, queen 9.' },
    ],
  },
  {
    id: 'special',
    title: 'Special moves',
    summary: 'The three moves that break the usual rules.',
    lessons: [
      { id: 'special-castling', title: 'Castling', kind: 'demonstration', fen: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1', summary: 'Two pieces, one move — tuck the king away.' },
      { id: 'special-promotion', title: 'Promotion', kind: 'drill', fen: '8/3P3k/8/8/8/8/8/4K3 w - - 0 1', summary: 'A pawn that reaches the end becomes whatever you choose.' },
      { id: 'special-en-passant', title: 'En passant', kind: 'demonstration', fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2', summary: 'The capture that only exists for one move.' },
    ],
  },
  {
    id: 'check',
    title: 'Check and checkmate',
    summary: 'Attacking the king, and ending the game.',
    lessons: [
      { id: 'check-what', title: 'What check means', kind: 'demonstration', fen: '4k3/8/8/8/8/8/8/4KR2 w - - 0 1', summary: 'The king is attacked and must be saved at once.' },
      { id: 'check-three-answers', title: 'Three ways out', kind: 'drill', fen: '4k3/8/8/8/8/8/4R3/4K3 b - - 0 1', summary: 'Move away, block, or capture the attacker.' },
      { id: 'check-mate-in-one', title: 'Mate in one', kind: 'drill', fen: '6k1/5ppp/8/8/8/8/8/R3K2R w KQ - 0 1', summary: 'Find the move that ends it.' },
      { id: 'check-stalemate', title: 'Stalemate', kind: 'demonstration', fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', summary: 'No legal move and not in check — a draw, not a win.' },
    ],
  },
  {
    id: 'openings',
    title: 'Starting a game',
    summary: 'The first few moves and the ideas behind them.',
    lessons: [
      { id: 'opening-centre', title: 'Take the centre', kind: 'demonstration', fen: INITIAL_FEN, summary: 'Pieces in the middle reach more squares.' },
      { id: 'opening-develop', title: 'Bring pieces out', kind: 'demonstration', fen: INITIAL_FEN, summary: 'Knights and bishops first, and not the same piece twice.' },
      { id: 'opening-king-safety', title: 'Make the king safe', kind: 'demonstration', fen: INITIAL_FEN, summary: 'Castle early, before the position opens.' },
    ],
  },
  {
    id: 'tactics',
    title: 'Tactics',
    summary: 'Short, forcing patterns that win material.',
    lessons: [
      { id: 'tactic-fork', title: 'The fork', kind: 'drill', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', summary: 'One piece attacking two.' },
      { id: 'tactic-pin', title: 'The pin', kind: 'drill', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', summary: 'A piece that cannot move without exposing a better one.' },
      { id: 'tactic-skewer', title: 'The skewer', kind: 'drill', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', summary: 'A pin, but the valuable piece is in front.' },
      { id: 'tactic-discovered', title: 'Discovered attack', kind: 'drill', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', summary: 'Move one piece, and another one strikes.' },
    ],
  },
  {
    id: 'endgame',
    title: 'Endgames',
    summary: 'Finishing a won position.',
    lessons: [
      { id: 'endgame-two-rooks', title: 'Two rooks', kind: 'drill', fen: '4k3/8/8/8/8/8/8/R3K2R w - - 0 1', summary: 'The staircase — the first checkmate to learn.' },
      { id: 'endgame-queen', title: 'Queen and king', kind: 'drill', fen: '4k3/8/8/8/8/8/8/3QK3 w - - 0 1', summary: 'Shrink the box, then deliver mate.' },
      { id: 'endgame-pawn', title: 'Pushing a pawn home', kind: 'drill', fen: '4k3/8/8/8/8/4K3/4P3/8 w - - 0 1', summary: 'The king leads, the pawn follows.' },
    ],
  },
  {
    id: 'play',
    title: 'Play a game',
    summary: 'Put it together against an opponent.',
    lessons: [
      { id: 'play-beginner', title: 'Play the beginner', kind: 'play', fen: INITIAL_FEN, difficulty: 'beginner', summary: 'A gentle opponent that leaves material hanging.' },
      { id: 'play-learner', title: 'Play the learner', kind: 'play', fen: INITIAL_FEN, difficulty: 'learner', summary: 'Takes what you leave, and defends what it can.' },
      { id: 'play-steady', title: 'Play the steady', kind: 'play', fen: INITIAL_FEN, difficulty: 'steady', summary: 'Looks further ahead. Beat this one and you have learned something.' },
    ],
  },
]);

/** Every lesson is an outline until its teaching steps are written. */
export function lessonStatus(lesson) {
  return Array.isArray(lesson.steps) && lesson.steps.length ? 'ready' : 'outline';
}

export function allLessons() {
  return CHESS_UNITS.flatMap((unit) => unit.lessons.map((lesson) => ({ ...lesson, unitId: unit.id, unitTitle: unit.title })));
}

export function findLesson(lessonId) {
  return allLessons().find((lesson) => lesson.id === lessonId) ?? null;
}

export function findUnit(unitId) {
  return CHESS_UNITS.find((unit) => unit.id === unitId) ?? null;
}

/** Course-wide counts, so the shelf can say how much is actually written. */
export function curriculumProgress() {
  const lessons = allLessons();
  const ready = lessons.filter((lesson) => lessonStatus(lesson) === 'ready').length;
  return { units: CHESS_UNITS.length, lessons: lessons.length, ready, outline: lessons.length - ready };
}
