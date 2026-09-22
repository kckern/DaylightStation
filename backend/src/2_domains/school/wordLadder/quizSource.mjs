/**
 * The printed Friday quiz (design "Printed Friday quiz"): a
 * `school.document-source/v1` quiz with one question per deck word. Its
 * `itemId` IS the word id, so a scanned row's attempt names the word the
 * fold demotes. Text only; answer + 3 authored decoys; alternating
 * Korean→English / English→Korean by index. Deterministic from the seed.
 */
import { hashString, seededShuffle } from './checkItem.mjs';
import { quizDocumentIdFor } from './quizId.mjs';

export const QUIZ_INSTRUCTIONS = 'Not sure of a word? Open Korean words on the Portal and review the cards, then come back.';

export function buildWordQuizSource({ deck, lexicon, seed }) {
  if (!deck?.id || !Array.isArray(deck.words) || deck.words.length === 0) throw new Error('a quiz needs a deck with words');
  const missing = deck.words.filter((wordId) => !lexicon.has(wordId));
  if (missing.length) throw new Error(`words not in the lexicon: ${missing.join(', ')}`);
  const blocks = deck.words.map((wordId, index) => {
    const entry = lexicon.get(wordId);
    const koreanToEnglish = index % 2 === 0;
    const answer = koreanToEnglish ? entry.english : entry.korean;
    const decoys = (koreanToEnglish ? entry.decoys.english : entry.decoys.korean).slice(0, 3);
    return {
      type: 'question',
      itemId: wordId,
      number: index + 1,
      omr: true,
      fillAfter: true,
      // The omr_response child is what prints the lettered choices (Ⓐ text …)
      // beside the card's bubbles; without it the sheet shows the stem only.
      blocks: [
        { type: 'rich_text', md: koreanToEnglish ? `What does **${entry.korean}** mean?` : `Which is **${entry.english}** in Korean?` },
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
    topics: ['korean', 'vocabulary'],
    seed,
    target: ['letter'],
    archetype: 'quiz',
    title: `${deck.title} Quiz`,
    header: { instructions: QUIZ_INSTRUCTIONS },
    fit: { policy: 'flow', typeScale: 'young' },
    blocks,
  };
}
