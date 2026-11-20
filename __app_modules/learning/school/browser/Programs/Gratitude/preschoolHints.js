/**
 * The four picture hints on the preschool Ask screen, and which of them a
 * subject already belongs to. Keyword matching is enough here: it only decides
 * which pictures to show and which icon sits beside a subject, never credit.
 */
export const PRESCHOOL_HINTS = Object.freeze([
  { id: 'family', label: 'Family', icon: 'family', example: 'What about Mom?', words: /\b(mom|mommy|mother|mum|dad|daddy|father|sister|brother|family|grandma|grandpa|granny|baby|aunt|uncle|cousin)\b|엄마|아빠|가족|할머니|할아버지|누나|언니|오빠|동생/i },
  { id: 'food', label: 'Food', icon: 'food', example: 'What about a yummy food?', words: /\b(cookies?|cake|pancakes?|food|eat|eating|ate|pizza|ice cream|candy|apples?|snacks?|dinner|lunch|breakfast|treats?|bread|noodles?|rice|fruit)\b|과자|케이크|먹었/i },
  { id: 'toys', label: 'Toys', icon: 'toys', example: 'What about a favorite toy?', words: /\b(toys?|lego|legos|games?|dolls?|cars?|trucks?|blocks|puzzles?|teddy|stuffed|trains?)\b|장난감|레고|인형/i },
  { id: 'outside', label: 'Outside', icon: 'outside', example: 'What about playing outside?', words: /\b(outside|park|playground|sun|sunny|snow|rain|trees?|swings?|slide|walk|bike|beach|garden|flowers?)\b|밖에|공원|놀이터/i },
]);

/** The hint a subject belongs to, or null. */
export function hintFor(subject) {
  const text = String(subject ?? '');
  return PRESCHOOL_HINTS.find((hint) => hint.words.test(text)) ?? null;
}

/** Hints whose category none of the given subjects already covers. */
export function unusedHints(subjects = []) {
  const used = new Set(subjects.map((subject) => hintFor(subject)?.id).filter(Boolean));
  return PRESCHOOL_HINTS.filter((hint) => !used.has(hint.id));
}

/** "Tuesday" for a study day (YYYY-MM-DD). */
export function weekdayOf(studyDay) {
  const at = Date.parse(`${studyDay}T12:00:00Z`);
  return Number.isFinite(at) ? new Date(at).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }) : null;
}

/** What the blue screen says aloud. */
export function steerLine(steer) {
  const used = steer?.used;
  const hint = unusedHints([...(steer?.recent ?? []), ...(used ? [used.subject] : [])])[0] ?? null;
  const day = used ? weekdayOf(used.studyDay) : null;
  const first = used
    ? `You said ${String(used.subject).toLowerCase()}${day ? ` on ${day}` : ''}. What's something different?`
    : 'Tell me something new.';
  return hint ? `${first} ${hint.example}` : first;
}
