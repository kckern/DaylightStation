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

/** A tomato nobody has started yet sits back, unless it is the one up next. */
export const passageFaded = (passage, isCurrent) => !isCurrent && passage?.state === 'todo' && !(passage?.steps?.done > 0);

/**
 * How many icons across a piece's map. Up to eight sit in one row; a longer
 * piece takes two rows, so four cards share the strip with icons at full size.
 */
export const mapColumns = (count) => (count > 8 ? Math.ceil(count / 2) : Math.max(1, count));

export const pieceCount = (piece) => `${piece.silver} of ${piece.total} Silver`;
