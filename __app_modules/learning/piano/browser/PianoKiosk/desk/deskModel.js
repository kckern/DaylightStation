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
 * One card per child with something to show, newest first. A child's piece in
 * progress always wins; the server only offers pieces with a step earned, so a
 * piece someone merely opened never displaces their course.
 */
export function stripCards({ pieces, courses }) {
  const ids = [...new Set([...(pieces ?? []).map((p) => p.userId), ...(courses ?? []).map((c) => c.userId)])];
  return ids.flatMap((userId) => {
    const deskPlayer = pieces?.find((p) => p.userId === userId);
    const coursePlayer = courses?.find((c) => c.userId === userId);
    const piece = deskPlayer?.piece ?? null;
    const course = coursePlayer?.courses?.[0] ?? null;
    if (!piece && !course) return [];
    const pieceAt = piece?.practicedAt ?? '';
    const courseAt = course?.lastPlayedAt ?? coursePlayer?.lastPlayedAt ?? '';
    const name = deskPlayer?.name ?? coursePlayer?.name ?? userId;
    return piece
      ? [{ userId, name, kind: 'piece', at: pieceAt, piece, focus: pieceFocus(piece) }]
      : [{ userId, name, kind: 'course', at: courseAt, course }];
  }).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export const pieceCount = (piece) => `${piece.silver} of ${piece.total} Silver`;
