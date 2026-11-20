// deskModel.js — pure view rules for the progress strip above the home menu.

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
    if (piece) cards.push({ key: `${userId}:piece`, userId, name, kind: 'piece', at: piece.practicedAt ?? '', piece, focus: pieceFocus(piece) });
    if (course) cards.push({ key: `${userId}:course`, userId, name, kind: 'course', at: course.lastPlayedAt ?? coursePlayer?.lastPlayedAt ?? '', course });
    return { latest: cards.map((card) => String(card.at)).sort().at(-1) ?? '', cards };
  }).filter((child) => child.cards.length)
    .sort((x, y) => y.latest.localeCompare(x.latest))
    .flatMap((child) => child.cards);
}

/** The strip's cards grouped by child, so one avatar and name heads each child's cards. */
export function stripGroups(sources) {
  const groups = [];
  for (const card of stripCards(sources)) {
    const group = groups.at(-1);
    if (group?.userId === card.userId) group.cards.push(card);
    else groups.push({ userId: card.userId, name: card.name, cards: [card] });
  }
  return groups;
}

/** A tomato nobody has started yet sits back, unless it is the one up next. */
export const passageFaded = (passage, isCurrent) => !isCurrent && passage?.state === 'todo' && !(passage?.steps?.done > 0);

const LESSON_PREFIX = /^lesson\s+(\d+)\s*[|:–—-]\s*/i;

/** A lesson title without its leading "Lesson 51 |" / "Lesson 12:"; the next-step line carries the number. */
export const lessonTitle = (title) => {
  const text = String(title ?? '').trim();
  return text.replace(LESSON_PREFIX, '').trim() || text;
};

/** Why a card is on the strip, as its badge: Silver next, Gold next, All Gold, or Next lesson. */
export function cardBadge(card) {
  if (card.kind === 'course') return { level: 'lesson', label: 'Next lesson' };
  const { silver, gold, total } = card.piece;
  if (total > 0 && gold >= total) return { level: 'gold', label: 'All Gold' };
  if (total > 0 && silver >= total) return { level: 'gold', label: 'Gold next' };
  return { level: 'silver', label: 'Silver next' };
}

/**
 * The line under a card's title: the bars up next, or the next lesson's number —
 * the one printed in its title when there is one (the server's position counts
 * graded lessons only), else its place in the course.
 */
export function nextStep(card) {
  if (card.kind === 'piece') return passageBars(card.focus);
  const { course } = card;
  if (!course.next) return '';
  const printed = LESSON_PREFIX.exec(String(course.next.title ?? '').trim())?.[1];
  const position = printed ?? course.next.position ?? (Number.isFinite(course.completed) ? course.completed + 1 : null);
  return position ? `Lesson ${position}` : '';
}

/** The card's inner width in px, which the coin row fills, and the gap between coins. */
const ROW = 175;
const GAP = 2;

/** Coins across a piece's map: one row up to fourteen, else two equal rows. */
export const mapColumns = (count) => (count > 14 ? Math.ceil(count / 2) : Math.max(1, count));
export const mapRows = (count) => (count > 14 ? 2 : 1);

/** Coin size in px: the row fills the card, never above 20px. */
export const coinSize = (count) => {
  const columns = mapColumns(count);
  return Math.min(20, Math.floor((ROW - (columns - 1) * GAP) / columns));
};

export const pieceCount = (piece) => `${piece.silver} of ${piece.total} Silver`;
