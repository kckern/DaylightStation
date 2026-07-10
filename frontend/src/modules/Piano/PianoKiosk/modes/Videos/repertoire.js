// repertoire.js — pure helpers for the song-first Repertoire lane.
// A repertoire item carries piano.song (catalog identity), piano.treatment
// (tutorial|challenge|accompaniment) and optionally piano.skillChallenge
// (non-song challenge → Skill Challenges shelf, never the song catalog).

export const TREATMENTS = [
  { key: 'tutorial', chip: 'Tutorial', action: 'Learn it' },
  { key: 'challenge', chip: 'Challenge', action: 'Master it' },
  { key: 'accompaniment', chip: 'Accompaniment', action: 'Comp it' },
];

export function partitionSongs(items) {
  const songs = new Map();
  const shelf = new Map();
  const shelfOrder = [];
  for (const it of items || []) {
    const p = it?.piano || {};
    if (p.skillChallenge) {
      const key = p.course || it.title || 'Challenge';
      if (!shelf.has(key)) { shelf.set(key, []); shelfOrder.push(key); }
      shelf.get(key).push(it);
      continue;
    }
    // Case-insensitive catalog identity: the index carries per-course casing
    // ("Fly Me To The Moon" vs "Fly Me to the Moon"); variants must merge into
    // one card. First-seen casing wins as the display title.
    const title = p.song || p.course || it.title || 'Song';
    const key = title.toLowerCase();
    if (!songs.has(key)) songs.set(key, { title, treatments: {}, count: 0 });
    const rec = songs.get(key);
    const t = p.treatment || 'tutorial';
    (rec.treatments[t] ||= []).push(it);
    rec.count += 1;
  }
  return {
    songs: [...songs.values()].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase())),
    skillChallenges: shelfOrder.map((k) => ({ title: k, lessons: shelf.get(k) })),
  };
}

export function availableTreatments(song) {
  return TREATMENTS.filter((t) => (song?.treatments?.[t.key] || []).length > 0);
}
