// deskModel.js — pure view rules for the piano home desk.

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

/** What the desk shows for the active player. */
export function deskView({ players, courses, currentUser }) {
  const player = players?.find((item) => item.userId === currentUser) ?? null;
  const piece = player?.piece ?? null;
  const course = courses?.find((item) => item.userId === currentUser)?.courses?.[0] ?? null;
  if (!piece) return { player, piece: null, course, focus: null, action: null };
  const byId = (id) => piece.passages.find((passage) => passage.id === id) ?? null;
  const focus = byId(piece.next?.passageId) ?? byId(piece.nextGoldPassageId) ?? piece.passages[0] ?? null;
  const action = piece.next
    ? { label: piece.practicedAt ? 'Continue' : 'Start', detail: piece.next.label }
    : { label: 'Go for Gold', detail: 'Your whole piece is Silver.' };
  return { player, piece, course, focus, action };
}

export const pieceCount = (piece) => `${piece.silver} of ${piece.total} passages Silver, ${piece.gold} Gold`;
