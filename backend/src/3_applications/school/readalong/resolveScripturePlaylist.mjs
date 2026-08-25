/**
 * Turn an authored scripture reference into the generic read-along playlist
 * consumed by the School worksheet feature.  The player deliberately works at
 * chapter granularity: the available recordings are chapter files, while the
 * text renderer still retains individual verse ids.
 */
import { lookupReference, generateReference } from 'scripture-guide';

const chapterOf = (verseId) => generateReference(Number(verseId)).replace(/:\d+(?:[-–].*)?$/, '');

/**
 * @param {string} reading e.g. "Psalms 70–72; 77"
 * @returns {{title: string, parts: Array<{id:string, contentId:string, title:string}>}|null}
 */
export function resolveScripturePlaylist(reading) {
  if (typeof reading !== 'string' || !reading.trim()) return null;
  let selected;
  try { selected = lookupReference(reading); } catch { return null; }
  if (!Array.isArray(selected?.verse_ids) || selected.verse_ids.length === 0) return null;

  const chapters = [];
  for (const verseId of selected.verse_ids) {
    let chapter;
    try { chapter = chapterOf(verseId); } catch { return null; }
    if (!chapters.includes(chapter)) chapters.push(chapter);
  }
  const parts = chapters.map((chapter) => {
    const chapterRef = lookupReference(chapter);
    const firstVerseId = chapterRef?.verse_ids?.[0];
    if (!firstVerseId) return null;
    return {
      id: `scripture:ot:nirv:${firstVerseId}`,
      contentId: `readalong:scripture/ot/nirv/${firstVerseId}`,
      title: chapter,
    };
  });
  return parts.every(Boolean) ? { title: reading, parts } : null;
}

export default resolveScripturePlaylist;
