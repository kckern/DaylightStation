// deskModel.js — pure view rules for the progress strip above the home menu.
import { polishStone } from '../modes/SheetMusic/polishAwards.js';

export const passageBars = (passage) => (passage ? `Bars ${passage.start + 1}–${passage.end + 1}` : '');

const decode = (text) => text.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
const firstTag = (xml, pattern) => { const match = pattern.exec(xml); return match ? decode(match[1]) : null; };

/** The title and composer printed on a MusicXML score, when it names them. */
export function scoreHeading(xml) {
  const text = String(xml || '');
  return {
    title: firstTag(text, /<work-title>([^<]+)<\/work-title>/) ?? firstTag(text, /<movement-title>([^<]+)<\/movement-title>/),
    composer: firstTag(text, /<creator[^>]*type="composer"[^>]*>([^<]+)<\/creator>/),
  };
}

/** "just now" / "Nm ago" / "Nh ago" / "Nd ago". */
export function relativeTime(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const mins = Math.floor(Math.max(0, now - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

/** The passage a piece card points at, and what its button would do. */
/** An all-Gold piece's next step is a whole-piece Polish run, not a passage. */
export const piecePolishing = (piece) => piece?.total > 0 && piece.gold >= piece.total;

export function pieceFocus(piece) {
  const byId = (id) => piece.passages.find((passage) => passage.id === id) ?? null;
  return byId(piece.next?.passageId) ?? byId(piece.nextGoldPassageId) ?? piece.passages[0] ?? null;
}

/**
 * Up to two cards per child: the piece they are learning and their video
 * course, side by side. Children are ordered by their latest activity. The
 * server only offers pieces with a step earned, so a piece someone merely
 * opened never gets a card.
 */
export function stripCards({ pieces, courses }) {
  const ids = [...new Set([...(pieces ?? []).map((p) => p.userId), ...(courses ?? []).map((c) => c.userId)])];
  return ids.map((userId) => {
    const deskPlayer = pieces?.find((p) => p.userId === userId);
    const coursePlayer = courses?.find((c) => c.userId === userId);
    const piece = deskPlayer?.piece ?? null;
    const course = coursePlayer?.courses?.[0] ?? null;
    const name = deskPlayer?.name ?? coursePlayer?.name ?? userId;
    const cards = [];
    if (piece) cards.push({ key: `${userId}:piece`, userId, name, kind: 'piece', at: piece.practicedAt ?? '', piece, focus: piecePolishing(piece) ? null : pieceFocus(piece) });
    if (course) cards.push({ key: `${userId}:course`, userId, name, kind: 'course', at: course.lastPlayedAt ?? coursePlayer?.lastPlayedAt ?? '', course });
    return { latest: cards.map((card) => String(card.at)).sort().at(-1) ?? '', cards };
  }).filter((child) => child.cards.length)
    .sort((x, y) => y.latest.localeCompare(x.latest))
    .flatMap((child) => child.cards);
}

/** The strip's cards grouped by child: one avatar and name heads each child, over one card. */
export function stripGroups(sources) {
  const groups = [];
  for (const card of stripCards(sources)) {
    const group = groups.at(-1);
    if (group?.userId === card.userId) group.cards.push(card);
    else groups.push({ userId: card.userId, name: card.name, cards: [card] });
  }
  return groups;
}

/**
 * The one card a child's panel shows: the activity chosen on its tabs when the
 * child has it, else the most recent one (a tie keeps the piece).
 */
export function shownCard(group, chosenKind) {
  const cards = group?.cards ?? [];
  const chosen = chosenKind ? cards.find((card) => card.kind === chosenKind) : null;
  if (chosen) return chosen;
  return cards.reduce((best, card) => (best && String(best.at) >= String(card.at) ? best : card), null);
}

/** A tomato nobody has started yet sits back, unless it is the one up next. */
export const passageFaded = (passage, isCurrent) => !isCurrent && passage?.state === 'todo' && !(passage?.steps?.done > 0);

const LESSON_PREFIX = /^lesson\s+(\d+)\s*[|:–—-]\s*/i;

/** A lesson title without its leading "Lesson 51 |" / "Lesson 12:"; the next-step line carries the number. */
export const lessonTitle = (title) => {
  const text = String(title ?? '').trim();
  return text.replace(LESSON_PREFIX, '').trim() || text;
};

/**
 * Why a piece card is on the strip, as its badge: Silver next, Gold next, then
 * the Polish goal once the piece is all Gold (Polish next, Diamond next after
 * the gem, Diamond after the diamond). Course cards have no badge: the next
 * episode's still says which lesson is next.
 */
export function cardBadge(card) {
  const { silver, gold, total, polish } = card.piece;
  if (total > 0 && gold >= total) {
    if (polish?.diamond === true) return { level: 'diamond', label: 'Diamond' };
    if (polish?.gem === true) return { level: 'diamond', label: 'Diamond next' };
    return { level: 'gold', label: 'Polish next' };
  }
  if (total > 0 && silver >= total) return { level: 'gold', label: 'Gold next' };
  return { level: 'silver', label: 'Silver next' };
}

/**
 * The next lesson's number: the one printed in its title when there is one (the
 * server's position counts graded lessons only), else its place in the course.
 */
export function lessonNumber(course) {
  if (!course?.next) return '';
  const title = String(course.next.title ?? '').trim();
  // The number the title prints, with a separator ("Lesson 51 | …") or alone ("Lesson 3").
  const printed = (LESSON_PREFIX.exec(title) ?? /^lesson\s+(\d+)$/i.exec(title))?.[1];
  const position = printed ?? course.next.position ?? (Number.isFinite(course.completed) ? course.completed + 1 : null);
  return position ? String(position) : '';
}

/** The line under a card's title: the bars up next, or "Lesson 51". */
export function nextStep(card) {
  if (card.kind === 'piece') return piecePolishing(card.piece) ? 'Whole piece' : passageBars(card.focus);
  const number = lessonNumber(card.course);
  return number ? `Lesson ${number}` : '';
}

/**
 * What to do in those bars: the coach's next skill ("Settle into a beat"), from
 * the desk's `piece.next`. Nothing while polishing: the card opens Polish, not that skill.
 */
export const nextSkill = (card) => (card.kind === 'piece' && !piecePolishing(card.piece) ? String(card.piece?.next?.label ?? '').trim() : '');

/**
 * The card a swipe brings in: a swipe left shows the next card, right the one
 * before, wrapping like a carousel. Null when the child has only one card.
 */
export function swipeTarget(cards, kind, direction) {
  const list = cards ?? [];
  if (list.length < 2) return null;
  const at = Math.max(0, list.findIndex((card) => card.kind === kind));
  const step = direction === 'left' ? 1 : -1;
  return list[(at + step + list.length) % list.length];
}

/**
 * The right column is 176px wide at a 292px panel (four children): 292 - 2 border
 * - 16 padding - 88 poster - 10 gap. GAP is the map's CSS gap.
 */
const COLUMN = 176;
/** The count stacked beside one row of coins: 40px and an 8px gap. */
const BESIDE = 48;
const GAP = 2;

/**
 * The ways a piece's coins can sit at the bottom of the column, each with the
 * largest coin its height allows. A 150px card leaves 40px under a two-line
 * title, the bars and the skill line; a 170px (tall) card leaves 62px.
 *  - one row with the count stacked beside it: up to 36px, in 128px of width;
 *  - one row under the count line (16px): up to 24px, the full width;
 *  - two rows under the count (tall card): up to 22px;
 *  - three rows under the count (tall card): up to 14px.
 */
const LAYOUTS = [
  { rows: 1, width: COLUMN - BESIDE, most: 36, countBeside: true },
  { rows: 1, width: COLUMN, most: 24, countBeside: false },
  { rows: 2, width: COLUMN, most: 22, countBeside: false },
  { rows: 3, width: COLUMN, most: 14, countBeside: false },
];

/** More rows (which make every card on the strip tall) must win coins this much bigger (px). */
const MORE_ROWS_GAIN = 3;

/**
 * How a piece's coins are laid out. Among one-row arrangements the biggest coin
 * wins; more rows win only when their coin is at least 3px bigger, so eight
 * passages stay on one row (20px) and nine take two. A coin is never bigger than
 * the one a piece with one passage fewer gets, so a longer piece never gets
 * bigger coins: nine passages on two rows keep eight's 20px. Three rows keep coins
 * at 12px or more up to 36 passages; past that they shrink further rather than
 * hiding passages. `extra` slots (a Polish stone) take one more column, beside
 * every row.
 */
export function coinLayout(count, extra = 0) {
  const n = Math.max(1, count);
  let best = null;
  for (const layout of LAYOUTS) {
    const columns = Math.ceil(n / layout.rows);
    const slots = columns + extra;
    const size = Math.min(layout.most, Math.floor((layout.width - (slots - 1) * GAP) / slots));
    const wins = !best || (layout.rows === best.rows ? size > best.size : size >= best.size + MORE_ROWS_GAIN);
    if (wins) best = { rows: layout.rows, columns, size, countBeside: layout.countBeside };
  }
  if (n > 1) best.size = Math.min(best.size, coinLayout(n - 1, extra).size);
  return best;
}

/** Coins across a piece's map, its rows, and the coin size in px. */
export const mapColumns = (count, extra = 0) => coinLayout(count, extra).columns;
export const mapRows = (count, extra = 0) => coinLayout(count, extra).rows;
export const coinSize = (count, extra = 0) => coinLayout(count, extra).size;

export const pieceCount = (piece) => `${piece.silver} of ${piece.total} Silver`;

/** A piece card's name for a screen reader: the Silver count, and the Polish stone when it holds one. */
export const pieceLabel = (name, piece) => {
  const stone = polishStone(piece.polish);
  return `${name}: ${pieceCount(piece)}${stone ? `, ${stone.label}` : ''}`;
};
