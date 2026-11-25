// passageRail.js — pure view rules for the Learn path (the row of lettered tokens under the score and
// the drill) and the passage board. Spec: ops:docs/superpowers/specs/2026-11-23-piano-learn-rail-path-design.md
import { passageProgress } from '../../../../../../../shared/music/learnCoach.mjs';

/** The narrowest token a child can reliably tap, the size it has when there is room, and the link between two. */
export const TOKEN_MIN_PX = 44;
export const TOKEN_MAX_PX = 56;
export const LINK_PX = 12;
/** The coach's next unit is drawn this much larger than the rest. */
export const NEXT_BUMP_PX = 12;
/** The path's height (rem); the board stops at its top edge. */
export const PATH_REM = 6.75;

// A passage's first certificate is stored as `silver` and shown as BRONZE; Silver is the join (the piece
// played through, 2026-11-23). `joined` is a join's own state, drawn as the silver coin.
export const STATE_WORDS = Object.freeze({ todo: 'Not started', learning: 'Partway', silver: 'Bronze', joined: 'Silver', gold: 'Gold' });

/** Passage index to its letter: A…Z, then AA, AB… */
export function letterOf(index) {
  let n = Math.max(0, Math.floor(index)); let out = '';
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return out;
}

const printedStart = (segment) => {
  const printed = segment.printedMeasures?.[0];
  return printed == null || printed === '' ? String(segment.inMeasure + 1) : String(printed);
};
const barsOf = (segment) => segment.barLabel ?? `Bars ${segment.inMeasure + 1}–${segment.outMeasure + 1}`;
const lowerBars = (label) => label.charAt(0).toLowerCase() + label.slice(1);

/** One passage as the path and the board draw it. */
export function passageTile(segment, index = null) {
  const progress = passageProgress(segment);
  const bars = barsOf(segment);
  // Steps are counted on any passage that is under way and not yet Bronze.
  const underway = (progress.state === 'todo' || progress.state === 'learning') && progress.steps.done > 0;
  const detail = underway ? `${progress.state === 'learning' ? 'Partway' : 'Started'}, ${progress.steps.done} of ${progress.steps.total} steps` : STATE_WORDS[progress.state];
  const letter = index == null ? null : letterOf(index);
  return { id: segment.id, kind: 'passage', letter, startLabel: printedStart(segment), bars, barCount: Math.max(1, segment.outMeasure - segment.inMeasure + 1),
    state: progress.state, steps: progress.steps, underway, detail, label: letter ? `${letter}, ${lowerBars(bars)}, ${detail}` : `${bars}, ${detail}` };
}

/**
 * The size of every token in a path this wide, or `compact` when a long piece cannot give each one
 * a 44px target (the path then becomes a lettered strip whose tap opens the board). A width of 0
 * (not measured yet, or a test DOM) is room enough.
 */
export function pathLayout(tokenCount, width) {
  if (!(tokenCount > 0) || !(width > 0)) return { size: TOKEN_MAX_PX, compact: false };
  const size = Math.floor((width - (tokenCount - 1) * LINK_PX - NEXT_BUMP_PX) / tokenCount);
  return size >= TOKEN_MIN_PX ? { size: Math.min(TOKEN_MAX_PX, size), compact: false } : { size: TOKEN_MIN_PX, compact: true };
}

/** The coach rail's coins (PassagePath `variant="rail"`): a tighter link, no larger next token, about 44px. */
export const RAIL_LINK_PX = 6;
export const RAIL_TOKEN_MAX_PX = 44;
export const RAIL_TOKEN_MIN_PX = 38;
export function railLayout(tokenCount, width) {
  if (!(tokenCount > 0) || !(width > 0)) return { size: RAIL_TOKEN_MAX_PX, compact: false };
  const size = Math.floor((width - (tokenCount - 1) * RAIL_LINK_PX) / tokenCount);
  return size >= RAIL_TOKEN_MIN_PX ? { size: Math.min(RAIL_TOKEN_MAX_PX, size), compact: false } : { size: RAIL_TOKEN_MIN_PX, compact: true };
}

/** Whether every token keeps a usable touch target in a path this wide. */
export function railFits(tokenCount, width) { return !pathLayout(tokenCount, width).compact; }

/**
 * What the path shows. Passages are lettered tokens, one row, left to right. A join appears only
 * once both its halves are certified, and only the next one: a socket between its halves ("A+B").
 * An earned join folds its members into one coin named for its span ("A–B"; the whole piece "All").
 * Once the piece is played through (Piece Silver) the path opens out again for Gold: passages are
 * back on their own, joined by silver links, and a Gold join folds them into a gold coin.
 * The primary action is on the token: the coach's next unit is drawn larger; the play disc sits on
 * the target (the selected unit, else the next); `caption` names its task in child words.
 * `lap` ('silver' | 'gold') forces a lap's drawing (a ceremony holds the Silver path while it lands).
 */
export function railModel({ segments = [], projection, selectedId = null, polish = null, lap: forcedLap = null, stepDown = null }) {
  const passages = segments.filter((segment) => segment.kind !== 'join');
  const joins = segments.filter((segment) => segment.kind === 'join');
  const tiles = passages.map((segment, index) => passageTile(segment, index));
  const indexOf = new Map(passages.map((segment, index) => [segment.id, index]));
  const unitById = new Map(segments.map((segment) => [segment.id, segment]));
  const isJoin = (unit) => unit?.kind === 'join';
  const cert = (unit) => unit?.certification ?? {};
  const piece = projection?.piece ?? { total: tiles.length, silver: tiles.filter((tile) => tile.state === 'silver' || tile.state === 'gold').length,
    gold: tiles.filter((tile) => tile.state === 'gold').length };
  const joinTotals = piece.joins ?? { total: joins.length, silver: joins.filter((join) => cert(join).silver).length };
  const allBronze = piece.total > 0 && piece.silver >= piece.total;
  const pieceSilver = piece.pieceSilver ?? (allBronze && joinTotals.total === 0);
  const allGold = piece.polishReady ?? (piece.total > 0 && piece.gold >= piece.total);
  const lap = forcedLap ?? (pieceSilver && tiles.length > 1 ? 'gold' : 'silver');

  // Which passages a unit covers (indexes), and its name on a token.
  const span = (unit) => (isJoin(unit) ? [indexOf.get(unit.memberPassages[0]), indexOf.get(unit.memberPassages.at(-1))] : [indexOf.get(unit.id), indexOf.get(unit.id)]);
  const nameOf = (unit) => {
    if (!isJoin(unit)) return letterOf(indexOf.get(unit.id));
    const [from, to] = span(unit);
    return unit.final && to - from + 1 > 2 ? 'All' : `${letterOf(from)}–${letterOf(to)}`;
  };
  const halves = (join) => join.members.map((id) => unitById.get(id)).filter(Boolean);
  const pairOf = (join) => (join.final && join.memberPassages.length > 2 ? 'All'
    : halves(join).every((half) => !isJoin(half)) ? halves(join).map(nameOf).join('+') : nameOf(join));
  const covers = (outer, inner) => { const [a, b] = span(outer); const [c, d] = span(inner); return a <= c && d <= b; };
  const certified = (unit) => Boolean(lap === 'gold' ? cert(unit).gold : cert(unit).silver);
  const earned = (join) => certified(join);
  const available = (join) => !earned(join) && halves(join).every(certified) && (lap === 'silver' || !join.final);

  // The target: the selected unit, else the coach's next, else the next Gold, else the first passage again.
  const picked = selectedId != null ? unitById.get(selectedId) ?? null : null;
  const recommended = unitById.get(projection?.recommended?.passageId) ?? null;
  const nextGold = unitById.get(piece.nextGoldPassageId) ?? null;
  const next = recommended ?? nextGold;
  const target = picked ? { unit: picked, kind: 'selected' } : recommended ? { unit: recommended, kind: 'next' }
    : nextGold ? { unit: nextGold, kind: 'gold' } : passages[0] ? { unit: passages[0], kind: 'again' } : null;

  // The coach's lap (2026-11-23 night): no join is offered while a passage is still short of Bronze.
  const coachLap = projection?.lap ?? (!allBronze ? 'bronze' : !pieceSilver && joinTotals.total > 0 ? 'silver' : !allGold ? 'gold' : 'diamond');
  // The one join drawn as a socket: the target join while it is not earned, else the next available.
  const nextJoin = coachLap === 'bronze' ? null : (isJoin(next) && available(next) ? next : null) ?? joins.find(available) ?? null;
  const socket = target && isJoin(target.unit) && !earned(target.unit) ? target.unit : nextJoin;
  // Earned joins fold into one coin, except one around the target or the socket (that would hide it).
  const strictlyAround = (outer, inner) => inner && outer.id !== inner.id && covers(outer, inner);
  const foldable = joins.filter((join) => earned(join) && !strictlyAround(join, target?.unit) && !strictlyAround(join, socket));
  const folded = foldable.filter((join) => !foldable.some((other) => other.id !== join.id && covers(other, join)));

  // The seam after passage k belongs to exactly one join (the one whose left half ends there).
  const seamJoin = (k) => joins.find((join) => span(halves(join)[0] ?? join)[1] === k) ?? null;
  const tokenOf = (unit) => {
    const [from, to] = span(unit);
    if (!isJoin(unit)) return { ...tiles[from], from, to };
    const state = cert(unit).gold ? 'gold' : cert(unit).silver ? 'joined' : 'socket';
    const name = state === 'socket' ? pairOf(unit) : nameOf(unit);
    const bars = barsOf(unit);
    const detail = state === 'socket' ? (lap === 'gold' ? 'not in time yet' : 'not played through yet') : STATE_WORDS[state];
    return { id: unit.id, kind: state === 'socket' ? 'socket' : 'join', letter: name, bars, state, final: unit.final === true, from, to, ring: lap === 'gold' ? 'gold' : 'silver',
      steps: { done: 0, total: 0 }, underway: false, detail, label: `${name}, ${lowerBars(bars)}, ${detail}` };
  };
  const tokens = [];
  for (let at = 0; at < passages.length;) {
    const fold = folded.find((join) => span(join)[0] === at);
    const token = tokenOf(fold ?? passages[at]);
    tokens.push(token);
    at = token.to + 1;
    if (socket && span(halves(socket)[0] ?? socket)[1] === token.to) tokens.push(tokenOf(socket));
  }
  // Each token's link to the one before it: the socket's two sides, a silver link across a seam whose
  // join is played through, or the plain path.
  tokens.forEach((token, index) => {
    if (index === 0) return;
    const before = tokens[index - 1];
    token.link = token.kind === 'socket' || before.kind === 'socket' ? 'socket' : cert(seamJoin(before.to)).silver ? 'joined' : 'plain';
  });

  // The task, in a child's words.
  const goldOpen = (unit) => Boolean(projection?.gold?.[unit.id]);
  const captionFor = (found) => {
    if (!found) return null;
    const { unit, kind } = found;
    const name = nameOf(unit);
    if (isJoin(unit)) {
      if (!cert(unit).silver) return unit.final ? 'Play it all' : `Play ${halves(unit).map(nameOf).join(' and ')} together`;
      if (!cert(unit).gold && (kind === 'gold' || goldOpen(unit))) return `${name} in time`;
      return unit.final ? 'Play it all again' : `Play ${name} again`;
    }
    if (!cert(unit).silver) return `Learn ${name}`;
    if (!cert(unit).gold && (kind === 'gold' || goldOpen(unit))) return `${name} in time`;
    return `Play ${name} again`;
  };
  // A step down (a join missed twice in one half) practises that half first: the caption names it, and its
  // token wears the ring of the unit being worked on.
  const stepUnit = stepDown ? unitById.get(stepDown) ?? null : null;
  const caption = stepUnit && target && covers(target.unit, stepUnit) && target.unit.id !== stepUnit.id
    ? `Play ${nameOf(stepUnit)} first` : captionFor(target);
  const targetId = target?.unit.id ?? null;
  // The token that holds the target: itself, or the fold around it.
  const holder = (id) => tokens.find((token) => token.id === id) ?? (unitById.get(id) ? tokens.find((token) => covers(unitById.get(token.id), unitById.get(id))) : null) ?? null;
  const targetToken = targetId ? holder(targetId) : null;
  const nextToken = next ? holder(next.id) : null;
  const pickedToken = picked ? holder(picked.id) : null;
  for (const token of tokens) {
    token.isTarget = token === targetToken;
    token.isNext = token === nextToken;
    token.isSelected = token === pickedToken;
    token.isStepDown = Boolean(stepUnit) && unitById.has(token.id) && covers(stepUnit, unitById.get(token.id));
    token.aria = token.isTarget && caption ? `${caption}, ${lowerBars(token.id === targetId ? barsOf(target.unit) : token.bars)}` : token.label;
  }

  // The board: every passage, every join played through (silver), and the socket, in play order.
  const cards = segments.filter((unit) => !isJoin(unit) || cert(unit).silver || unit.id === socket?.id).map(tokenOf)
    .map((card) => ({ ...card, isTarget: card.id === targetId }));

  const ladder = levelLadder({ lap: coachLap, progress: projection?.lapProgress, piece, joinTotals, polish });
  return {
    tiles, tokens, cards, lap, caption, railRem: PATH_REM, ladder,
    // Every unit's name on the path (A, A–B, All), for the words around it.
    names: unitNames(segments),
    selectedId: picked?.id ?? null, outlinedId: targetId, nextId: next?.id ?? null,
    target: target ? { passageId: targetId, kind: target.kind } : null,
    count: { level: ladder.current, done: ladder.done, total: ladder.total, text: `${ladder.done}/${ladder.total}`, label: ladder.text },
  };
}

/** Every unit's name on the path, by id: passages by letter (A), joins by span (A–B), the whole of a longer piece `All`. */
export function unitNames(segments = []) {
  const passages = segments.filter((unit) => unit.kind !== 'join');
  const indexOf = new Map(passages.map((unit, index) => [unit.id, index]));
  return Object.fromEntries(segments.flatMap((unit) => {
    if (unit.kind !== 'join') return [[unit.id, letterOf(indexOf.get(unit.id))]];
    const from = indexOf.get(unit.memberPassages?.[0]); const to = indexOf.get(unit.memberPassages?.at(-1));
    if (from == null || to == null) return [];
    return [[unit.id, unit.final && to - from + 1 > 2 ? 'All' : `${letterOf(from)}–${letterOf(to)}`]];
  }));
}

/** The levels of a piece, in order, and the coin each is drawn with (a passage's Bronze is stored `silver`). */
export const LEVELS = Object.freeze([
  Object.freeze({ level: 'bronze', word: 'Bronze', coin: 'silver' }), Object.freeze({ level: 'silver', word: 'Silver', coin: 'joined' }),
  Object.freeze({ level: 'gold', word: 'Gold', coin: 'gold' }), Object.freeze({ level: 'diamond', word: 'Diamond', coin: 'diamond' }),
]);

/**
 * The one level ladder (Bronze → Silver → Gold → Diamond) the path and the board both draw: the lap the
 * child is on with its count ("Bronze · 2 of 3"), the levels before it earned, the ones after it to come.
 * A piece with no joins (one passage, or an authored ladder) has no Silver rung. Diamond is earned in
 * Polish (`polish.diamond`). `lap` and `progress` are the coach's (`projection.lap`, `lapProgress`).
 */
export function levelLadder({ lap = 'bronze', progress = null, piece = {}, joinTotals = { total: 0, silver: 0 }, polish = null }) {
  const levels = LEVELS.filter((item) => item.level !== 'silver' || joinTotals.total > 0);
  const diamond = polish?.diamond === true;
  const current = diamond ? 'diamond' : levels.some((item) => item.level === lap) ? lap : 'gold';
  const at = levels.findIndex((item) => item.level === current);
  const fallback = current === 'bronze' ? { done: piece.silver ?? 0, total: piece.total ?? 0 }
    : current === 'silver' ? { done: joinTotals.silver ?? 0, total: joinTotals.total ?? 0 }
      : current === 'gold' ? { done: piece.gold ?? 0, total: piece.total ?? 0 } : { done: diamond ? 1 : 0, total: 1 };
  const { done, total } = current === 'diamond' ? { done: diamond ? 1 : 0, total: 1 } : progress ?? fallback;
  const word = levels[at].word;
  const text = current === 'diamond' ? (diamond ? 'Diamond · earned' : 'Diamond · in Polish') : `${word} · ${done} of ${total}`;
  return { current, done, total, text, word,
    // A gem is paid for the piece played through, the piece all Gold, and the diamond; never for a Bronze lap.
    gemLevel: current !== 'bronze' && !diamond,
    levels: levels.map((item, index) => ({ ...item, state: index < at || (diamond && index === at) ? 'earned' : index === at ? 'current' : 'later' })) };
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
