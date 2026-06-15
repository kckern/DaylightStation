// playlist.js — pure helpers for ArtMode background music. No DOM.

// Map a /api/v1/queue response into ambient tracks, dropping anything unplayable.
export function toTracks(queueResponse) {
  const items = queueResponse?.items;
  if (!Array.isArray(items)) return [];
  return items
    .filter((it) => it && it.mediaUrl)
    .map((it) => ({
      mediaUrl: it.mediaUrl,
      title: it.title || '',
      artist: it.artist || it.grandparentTitle || '',
    }));
}

// Next position in a wrapping playlist; 0 when the list is empty.
export function advanceIndex(i, len) {
  if (!(len > 0)) return 0;
  return (i + 1) % len;
}

// A shuffled [0..len-1] (Fisher–Yates); [] for non-positive length.
export function shuffleOrder(len) {
  if (!(len > 0)) return [];
  const a = Array.from({ length: len }, (_, i) => i);
  for (let i = len - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
