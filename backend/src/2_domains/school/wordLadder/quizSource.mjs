/**
 * The printed Friday quiz (design "Printed Friday quiz"): a
 * `school.document-source/v1` quiz with one question per deck word. Its
 * `itemId` IS the word id, so a scanned row's attempt names the word the
 * fold demotes. Text only; answer + 3 authored decoys; alternating
 * term→gloss / gloss→term by index. Deterministic from the seed. Every
 * language-bearing string (topics, instructions, the language's name in the
 * stem) comes from the lexicon.
 */
import { hashString, seededShuffle } from './checkItem.mjs';
import { quizDocumentIdFor } from './quizId.mjs';

export function buildWordQuizSource({ deck, lexicon, seed }) {
  if (!deck?.id || !Array.isArray(deck.words) || deck.words.length === 0) throw new Error('a quiz needs a deck with words');
  const entries = lexicon?.entries;
  if (!(entries instanceof Map)) throw new Error('a quiz needs a validated lexicon');
  const missing = deck.words.filter((wordId) => !entries.has(wordId));
  if (missing.length) throw new Error(`words not in the lexicon: ${missing.join(', ')}`);
  const blocks = deck.words.map((wordId, index) => {
    const entry = entries.get(wordId);
    const termToGloss = index % 2 === 0;
    const answer = termToGloss ? entry.gloss : entry.term;
    const decoys = (termToGloss ? entry.decoys.gloss : entry.decoys.term).slice(0, 3);
    return {
      type: 'question',
      itemId: wordId,
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
        { type: 'omr_response', itemId: wordId, choices: 1 + decoys.length, layout: 'compact' },
      ],
      choices: seededShuffle([answer, ...decoys], hashString(`${seed}|${wordId}`)),
      answer,
    };
  });
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
