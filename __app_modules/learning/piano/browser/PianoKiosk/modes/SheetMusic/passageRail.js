// passageRail.js — pure view rules for the Learn passage rail and board.
import { passageProgress } from '../../../../../../../shared/music/learnCoach.mjs';

/** The narrowest tile a child can reliably tap, plus the gap beside it. */
export const TILE_MIN_PX = 44;
export const TILE_GAP_PX = 4;

// A passage's first certificate is stored as `silver` and shown as BRONZE; Silver is the join (the piece
// played through, 2026-11-23). `joined` is a join's own state, drawn as the silver coin.
export const STATE_WORDS = Object.freeze({ todo: 'Not started', learning: 'Partway', silver: 'Bronze', joined: 'Silver', gold: 'Gold' });

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

/** One join as the rail draws it: a bridge over the tiles it joins (`from`..`to`, tile indexes). */
function bridgeOf(join, tiles, joins) {
  const first = tiles.findIndex((tile) => tile.id === join.memberPassages[0]);
  const last = tiles.findIndex((tile) => tile.id === join.memberPassages.at(-1));
  const depth = (item) => (item.kind === 'join' ? 1 + Math.max(...item.members.map((id) => { const member = joins.find((other) => other.id === id); return member ? depth(member) : 0; })) : 0);
  const state = join.certification?.silver ? 'joined' : 'todo';
  const bars = barsOf(join);
  return { id: join.id, depth: depth(join), from: first, to: last, state, final: join.final === true, bars,
    label: `Join ${lowerBars(bars)}, ${state === 'joined' ? 'Silver' : 'not played through yet'}` };
}

/**
 * What the rail shows: every passage, the joins over them as bridges, the one the button opens, and
 * the count. With nothing selected the button follows the coach's recommendation (a passage or a
 * join); when the whole piece is played through it offers Gold.
 */
export function railModel({ segments = [], projection, selectedId = null }) {
  const passages = segments.filter((segment) => segment.kind !== 'join');
  const joins = segments.filter((segment) => segment.kind === 'join');
  const tiles = passages.map(passageTile);
  const bridges = joins.map((join) => bridgeOf(join, tiles, joins));
  const byId = (id) => tiles.find((tile) => tile.id === id) ?? null;
  const bridgeById = (id) => bridges.find((bridge) => bridge.id === id) ?? null;
  const piece = projection?.piece ?? { total: tiles.length, silver: 0, gold: 0 };
  const joinTotals = piece.joins ?? { total: bridges.length, silver: bridges.filter((bridge) => bridge.state === 'joined').length };
  const allBronze = piece.total > 0 && piece.silver >= piece.total;
  const pieceSilver = piece.pieceSilver ?? (allBronze && joinTotals.total === 0);
  const allGold = piece.polishReady ?? (piece.total > 0 && piece.gold >= piece.total);
  const picked = byId(selectedId) ?? bridgeById(selectedId);
  const recommended = projection?.recommended?.passageId;
  const target = picked ? { item: picked, kind: 'selected' }
    : (byId(recommended) ?? bridgeById(recommended)) ? { item: byId(recommended) ?? bridgeById(recommended), kind: 'next' }
      : byId(piece.nextGoldPassageId) ? { item: byId(piece.nextGoldPassageId), kind: 'gold' }
        : tiles[0] ? { item: tiles[0], kind: 'again' } : null;
  const lap = !allBronze ? 'silver' : !pieceSilver ? 'joined' : 'gold';
  const done = lap === 'gold' ? piece.gold : lap === 'joined' ? joinTotals.silver : piece.silver;
  const total = lap === 'joined' ? joinTotals.total : piece.total;
  const lapWord = lap === 'gold' ? 'Gold' : lap === 'joined' ? 'joins' : 'Bronze';
  const buttonFor = (found) => (!found ? null : found.item.kind === undefined && bridgeById(found.item.id)
    ? `Play ${lowerBars(found.item.bars)} together`
    : found.kind === 'gold' ? `Go for Gold: ${lowerBars(found.item.bars)}` : `Practice ${lowerBars(found.item.bars)}`);
  // Each level of joins is one more 1.3rem strip under the tiles; the rail and the board's bottom edge follow it.
  const railRem = 4 + 1.3 * Math.max(0, ...bridges.map((bridge) => bridge.depth));
  return {
    tiles, bridges, railRem, selectedId: picked?.id ?? null, outlinedId: target?.item.id ?? null,
    target: target ? { passageId: target.item.id, kind: target.kind } : null,
    buttonLabel: buttonFor(target),
    count: { level: lap, done, total, text: `${done}/${total}`, label: `${done} of ${total} ${lapWord}` },
    goals: [{ level: 'silver', label: 'All Bronze', done: piece.silver, total: piece.total, reached: allBronze },
      ...(joinTotals.total > 0 ? [{ level: 'joined', label: 'Piece Silver', done: joinTotals.silver, total: joinTotals.total, reached: pieceSilver }] : []),
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
