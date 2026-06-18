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

// Like shuffleOrder, but guarantees the first track isn't `avoidFirst` — used when
// re-shuffling at the cycle wrap so a song can't play twice back-to-back across the
// boundary (the one quick-repeat a per-cycle permutation otherwise allows). With <2
// tracks there's nothing to avoid, so it degrades to a plain shuffle.
export function shuffleOrderAvoiding(len, avoidFirst) {
  const order = shuffleOrder(len);
  if (len > 1 && order[0] === avoidFirst) {
    // Swap the head with the next slot (always a different track here).
    [order[0], order[1]] = [order[1], order[0]];
  }
  return order;
}
