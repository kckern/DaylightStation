// passageRail.js — pure view rules for the Learn passage rail and board.
import { passageProgress } from '../../../../../../../shared/music/learnCoach.mjs';

/** The narrowest tile a child can reliably tap, plus the gap beside it. */
export const TILE_MIN_PX = 44;
export const TILE_GAP_PX = 4;

export const STATE_WORDS = Object.freeze({ todo: 'Not started', learning: 'Partway', silver: 'Silver', gold: 'Gold' });

const printedStart = (segment) => {
  const printed = segment.printedMeasures?.[0];
  return printed == null || printed === '' ? String(segment.inMeasure + 1) : String(printed);
};
const barsOf = (segment) => segment.barLabel ?? `Bars ${segment.inMeasure + 1}–${segment.outMeasure + 1}`;
const lowerBars = (label) => label.charAt(0).toLowerCase() + label.slice(1);

/** One passage as the rail and the board draw it. */
export function passageTile(segment) {
  const progress = passageProgress(segment);
  const bars = barsOf(segment);
  // Steps are counted on any passage that is under way and not yet Silver, tomato or flower.
  const underway = (progress.state === 'todo' || progress.state === 'learning') && progress.steps.done > 0;
  const detail = underway ? `${progress.state === 'learning' ? 'Partway' : 'Started'}, ${progress.steps.done} of ${progress.steps.total} steps` : STATE_WORDS[progress.state];
  return { id: segment.id, startLabel: printedStart(segment), bars, barCount: Math.max(1, segment.outMeasure - segment.inMeasure + 1),
    state: progress.state, steps: progress.steps, underway, detail, label: `${bars}, ${detail}` };
}

/**
 * What the rail shows: every passage, the one the button opens, and the count.
 * With nothing selected the button follows the coach's recommendation; when the
 * whole piece is Silver it offers Gold.
 */
export function railModel({ segments = [], projection, selectedId = null }) {
  const tiles = segments.map(passageTile);
  const byId = (id) => tiles.find((tile) => tile.id === id) ?? null;
  const piece = projection?.piece ?? { total: tiles.length, silver: 0, gold: 0 };
  const allSilver = piece.total > 0 && piece.silver >= piece.total;
  const allGold = piece.total > 0 && piece.gold >= piece.total;
  const selected = byId(selectedId);
  const target = selected ? { tile: selected, kind: 'selected' }
    : byId(projection?.recommended?.passageId) ? { tile: byId(projection.recommended.passageId), kind: 'next' }
      : byId(piece.nextGoldPassageId) ? { tile: byId(piece.nextGoldPassageId), kind: 'gold' }
        : tiles[0] ? { tile: tiles[0], kind: 'again' } : null;
  const lap = allSilver ? 'gold' : 'silver';
  const done = lap === 'gold' ? piece.gold : piece.silver;
  return {
    tiles, selectedId: selected?.id ?? null, outlinedId: target?.tile.id ?? null,
    target: target ? { passageId: target.tile.id, kind: target.kind } : null,
    buttonLabel: !target ? null : target.kind === 'gold' ? `Go for Gold: ${lowerBars(target.tile.bars)}` : `Practice ${lowerBars(target.tile.bars)}`,
    count: { level: lap, done, total: piece.total, text: `${done}/${piece.total}`,
      label: `${done} of ${piece.total} ${lap === 'gold' ? 'Gold' : 'Silver'}` },
    goals: [{ level: 'silver', label: 'All Silver', done: piece.silver, total: piece.total, reached: allSilver },
      { level: 'gold', label: 'All Gold', done: piece.gold, total: piece.total, reached: allGold }],
  };
}

/**
 * How many cards across the passage board. Rows hold up to seven cards (eight
 * on a long piece), and the cards are shared evenly between the rows: twelve
 * passages are six and six, never seven and five with blank cells.
 */
export function boardColumns(count) {
  if (!(count > 0)) return 1;
  const rows = Math.ceil(count / (count > 21 ? 8 : 7));
  return Math.ceil(count / rows);
}

/** Whether every tile keeps a usable touch target in a track this wide. */
export function railFits(tileCount, trackWidth) {
  if (!(tileCount > 0) || !(trackWidth > 0)) return true;
  return tileCount * TILE_MIN_PX + (tileCount - 1) * TILE_GAP_PX <= trackWidth;
}

/**
 * Whether a gem is really on offer for finishing a piece: the economy is live,
 * this player is one of its learners, and a `piano-piece` rule is on the Gem
 * Board and not switched off for them. Anything unreadable means no.
 */
export function pieceGemOffered(board, userId) {
  if (!board || board.mode !== 'live' || !userId || userId === 'guest') return false;
  if (!(board.learners ?? []).some((learner) => learner.learnerId === userId)) return false;
  return (board.categories ?? []).some((row) => (row.parts ?? []).some((part) => {
    if (part.activity !== 'piano-piece') return false;
    const cell = board.cells?.[row.id]?.[userId];
    const mine = (cell?.parts ?? []).find((item) => item.ruleId === part.ruleId);
    return Boolean(cell) && (mine?.state ?? cell.state) !== 'disabled';
  }));
}
