export const EBOOK_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function partitionEbookCandidates(candidates) {
  const eligible = [];
  const uncached = [];
  for (const candidate of candidates) {
    if (!candidate.book.media?.ebookFormat && !candidate.book.media?.ebookFile) continue;
    (candidate.cached ? eligible : uncached).push(candidate.book);
  }
  return { eligible, uncached };
}

export function rankRotatingEbooks(books, rotation = {}, nowMs, cooldownMs = EBOOK_COOLDOWN_MS) {
  const activeBooks = structuredClone(rotation.books || {});
  for (const [id, entry] of Object.entries(activeBooks)) {
    if (nowMs - new Date(entry.lastServed).getTime() >= cooldownMs) delete activeBooks[id];
  }
  const ranked = books.map(book => {
    const entry = activeBooks[book.id];
    return {
      book,
      lastServed: entry ? new Date(entry.lastServed).getTime() : 0,
      inCooldown: entry ? nowMs - new Date(entry.lastServed).getTime() < cooldownMs : false,
      isLastBook: book.id === rotation.lastBookId,
    };
  }).sort((a, b) => {
    if (a.inCooldown !== b.inCooldown) return a.inCooldown ? 1 : -1;
    if (a.isLastBook !== b.isLastBook) return a.isLastBook ? 1 : -1;
    return a.lastServed - b.lastServed;
  });
  return { ranked, activeBooks };
}

export function chooseEbookChapter(chapters, servedChapterIds = [], randomValue) {
  const served = new Set(servedChapterIds);
  const unserved = chapters.filter(chapter => !served.has(chapter.id));
  const available = unserved.length ? unserved : chapters;
  return available[Math.floor(randomValue * available.length)];
}

export function recordEbookSelection(rotation, activeBooks, bookId, chapterId, servedAt) {
  const books = structuredClone(activeBooks);
  const previous = books[bookId];
  books[bookId] = previous
    ? { ...previous, lastServed: servedAt, servedChapters: [...(previous.servedChapters || []), chapterId] }
    : { lastServed: servedAt, servedChapters: [chapterId] };
  return { ...rotation, lastBookId: bookId, books };
}
