/**
 * The printed OMR quiz (design "Printed Friday quiz" / spec §8 Printed quiz):
 * a `school.document-source/v1` quiz with one question per row. Its `itemId`
 * IS the word id, so a scanned row's attempt names the word the fold
 * demotes. Text only; answer + 3 authored decoys; alternating term→gloss /
 * gloss→term by index. Deterministic from the seed. Every language-bearing
 * string (topics, instructions, the language's name in the stem) comes from
 * the lexicon.
 *
 * Two builders share one row shape (`questionBlock`):
 *  - `buildWordQuizSource` — every word in one deck (legacy per-deck id).
 *  - `buildLearnerQuizSource` — only words a learner has been introduced to,
 *    across every deck in a package, addressed to that learner (per-learner id).
 */
import { hashString, seededShuffle } from './checkItem.mjs';
import { isUnsettled } from './mastery.mjs';
import { deckDirOf, isoWeekOf, learnerQuizDocumentId, quizDocumentIdFor } from './quizId.mjs';

/** One question row for `entry` at `index` (alternates term→gloss / gloss→term). Pure. */
function questionBlock(entry, index, lexicon, seed) {
  const termToGloss = index % 2 === 0;
  const answer = termToGloss ? entry.gloss : entry.term;
  const decoys = (termToGloss ? entry.decoys.gloss : entry.decoys.term).slice(0, 3);
  return {
    type: 'question',
    itemId: entry.id,
    number: index + 1,
    omr: true,
    fillAfter: true,
    // The omr_response child is what prints the lettered choices (Ⓐ text …)
    // beside the card's bubbles; without it the sheet shows the stem only.
    blocks: [
      {
        type: 'rich_text',
        md: termToGloss ? `What does **${entry.term}** mean?` : `Which is **${entry.gloss}** in ${lexicon.language.name}?`,
      },
      { type: 'omr_response', itemId: entry.id, choices: 1 + decoys.length, layout: 'compact' },
    ],
    choices: seededShuffle([answer, ...decoys], hashString(`${seed}|${entry.id}`)),
    answer,
  };
}

export function buildWordQuizSource({ deck, lexicon, seed }) {
  if (!deck?.id || !Array.isArray(deck.words) || deck.words.length === 0) throw new Error('a quiz needs a deck with words');
  const entries = lexicon?.entries;
  if (!(entries instanceof Map)) throw new Error('a quiz needs a validated lexicon');
  const missing = deck.words.filter((wordId) => !entries.has(wordId));
  if (missing.length) throw new Error(`words not in the lexicon: ${missing.join(', ')}`);
  const blocks = deck.words.map((wordId, index) => questionBlock(entries.get(wordId), index, lexicon, seed));
  return {
    schema: 'school.document-source/v1',
    id: quizDocumentIdFor(deck.id),
    subject: deck.id.split('/')[0],
    topics: [...lexicon.quiz.topics],
    seed,
    target: ['letter'],
    archetype: 'quiz',
    title: `${deck.title} Quiz`,
    header: { instructions: lexicon.quiz.instructions },
    fit: { policy: 'flow', typeScale: 'young' },
    blocks,
  };
}

/**
 * The per-learner weekly quiz (spec §8 Printed quiz): only words the learner
 * has been introduced to — this ISO week's introductions first (deck order),
 * then other unsettled words, then a seeded sample of mastered words, up to
 * `rowLimit`. Pure: the caller passes the study day, nothing reads a clock.
 */
export function buildLearnerQuizSource({
  status, lexicon, decks, learnerId, day, seed, rowLimit = 20, title = null,
}) {
  const entries = lexicon?.entries;
  if (!(entries instanceof Map)) throw new Error('a quiz needs a validated lexicon');
  if (!Array.isArray(decks) || decks.length === 0) throw new Error('a quiz needs at least one deck');
  const deckDir = deckDirOf(decks[0].id);
  const isoWeek = isoWeekOf(day);

  const ids = [];
  for (const deck of decks) {
    for (const wordId of deck?.words ?? []) if (entries.has(wordId) && !ids.includes(wordId)) ids.push(wordId);
  }

  const introducedThisWeek = [];
  const unsettled = [];
  const mastered = [];
  for (const wordId of ids) {
    const word = status?.words?.[wordId];
    if (!word || word.state === 'new') continue;
    if (typeof word.introducedDay === 'string' && isoWeekOf(word.introducedDay) === isoWeek) introducedThisWeek.push(wordId);
    else if (isUnsettled(word)) unsettled.push(wordId);
    else if (word.state === 'mastered') mastered.push(wordId);
  }
  const remaining = Math.max(0, rowLimit - introducedThisWeek.length - unsettled.length);
  const sampledMastered = seededShuffle(mastered, hashString(`${seed}|mastered`)).slice(0, remaining);
  const selected = [...introducedThisWeek, ...unsettled, ...sampledMastered].slice(0, rowLimit);
  if (!selected.length) throw new Error('no introduced words to quiz');

  const blocks = selected.map((wordId, index) => questionBlock(entries.get(wordId), index, lexicon, seed));
  return {
    schema: 'school.document-source/v1',
    id: learnerQuizDocumentId({ deckDir, pkg: lexicon.package, learnerId, isoWeek }),
    subject: deckDir.split('/')[0],
    topics: [...lexicon.quiz.topics],
    seed,
    target: ['letter'],
    archetype: 'quiz',
    title: title ?? `${lexicon.program.title} — week ${isoWeek}`,
    header: { instructions: lexicon.quiz.instructions },
    fit: { policy: 'flow', typeScale: 'young' },
    blocks,
  };
}
