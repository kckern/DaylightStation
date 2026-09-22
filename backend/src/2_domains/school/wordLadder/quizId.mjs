/**
 * The printed word-ladder quiz's document id for a deck. One naming rule,
 * shared by the paper fold (which matches scanned `bankId`s against it) and
 * the quiz source that prints the document.
 */
export function quizDocumentIdFor(deckId) {
  return `${deckId}-quiz`;
}
