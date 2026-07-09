// cli/curriculum/normalizePlan.mjs — pure normalization planning (no I/O).

// A "part" is a trailing integer after an optional en/em/hyphen dash separator,
// OR a bare trailing integer preceded by a space. "2-5-1" and leading "5 Jazz…"
// are safe because we only strip a SPACE-separated trailing integer.
export function baseCourseAndPart(course) {
  const s = String(course || '').trim();
  const dash = s.match(/^(.*\S)\s+[–—-]\s+(\d+)$/);   // "Name – 2"
  if (dash) return { base: dash[1].trim(), part: Number(dash[2]) };
  const bare = s.match(/^(.*\S)\s+(\d+)$/);            // "Name 2"
  if (bare) return { base: bare[1].trim(), part: Number(bare[2]) };
  return { base: s, part: null };
}

const isExercise = (base) => /exercise/i.test(base);

function voicingGroup(base) {
  if (/Rootless/i.test(base)) return 'Rootless Voicings';
  if (/Drop 2/i.test(base)) return 'Drop 2 Voicings';
  if (/Quartal/i.test(base)) return 'Quartal Voicings';
  return 'Block Chords';                       // matched /Block Chords/ by caller
}

// oldSeason + base (part already stripped) → target placement.
export function classify(oldSeason, base) {
  const s = Number(oldSeason);
  // ---- Practice (new season 0) ----
  if (s === 0) return { lane: 'practice', newSeason: 0, seasonName: 'Practice', group: 'How to Practice', treatment: null };
  if (s === 5) return { lane: 'practice', newSeason: 0, seasonName: 'Practice', group: 'Scales', treatment: null };
  if (s === 9) {
    const group = /two-hand|coordination/i.test(base) ? 'Two-Hand Coordination' : 'Chord & Voicing Exercises';
    return { lane: 'practice', newSeason: 0, seasonName: 'Practice', group, treatment: null };
  }
  if (s === 8) {
    if (isExercise(base)) return { lane: 'practice', newSeason: 0, seasonName: 'Practice', group: 'Rhythm Exercises', treatment: null };
    return { lane: 'lessons', newSeason: 6, seasonName: 'Comping & Rhythm', group: 'Rhythm Essentials', treatment: null };
  }
  // ---- Lessons ----
  if (s === 1) return { lane: 'lessons', newSeason: 1, seasonName: 'Soloing', group: 'Pop Soloing', treatment: null };
  if (s === 2) return { lane: 'lessons', newSeason: 1, seasonName: 'Soloing', group: '2-5-1 Soloing', treatment: null };
  if (s === 3) return { lane: 'lessons', newSeason: 2, seasonName: 'Improvisation', group: null, treatment: null };
  if (s === 4) {
    if (/Play Piano Lead Sheets/i.test(base)) return { lane: 'lessons', newSeason: 5, seasonName: 'Lead Sheet Application', group: null, treatment: null };
    if (/Rootless|Drop 2|Quartal|Block Chords/i.test(base)) return { lane: 'lessons', newSeason: 3, seasonName: 'Chord Voicings', group: voicingGroup(base), treatment: null };
    return { lane: 'lessons', newSeason: 4, seasonName: 'Chord Theory & Color', group: null, treatment: null };
  }
  if (s === 6) return { lane: 'lessons', newSeason: 6, seasonName: 'Comping & Rhythm', group: 'Comping', treatment: null };
  if (s === 7) return { lane: 'lessons', newSeason: 7, seasonName: 'Intros, Endings & Fills', group: null, treatment: null };
  // ---- Repertoire (new season 8) ----
  if (s === 10) return { lane: 'repertoire', newSeason: 8, seasonName: 'Song Library', group: null, treatment: 'tutorial' };
  if (s === 11) return { lane: 'repertoire', newSeason: 8, seasonName: 'Song Library', group: null, treatment: 'challenge' };
  if (s === 12) return { lane: 'repertoire', newSeason: 8, seasonName: 'Song Library', group: null, treatment: 'accompaniment' };
  throw new Error(`classify: unmapped old season ${oldSeason}`);
}

// Non-song challenge markers: a challenge whose base is a skill/progression, not a song title.
const SKILL_CHALLENGE = /\b(improvisation|soloing|progression|\d+-lesson|smooth jazz|bossa nova soloing)\b/i;

// Style tokens sometimes suffixed onto a repertoire course name.
const STYLE_SUFFIX = /\s*[–—-]\s*(Jazz Ballad|Jazz Swing|Jazz Waltz|Bossa Nova|Rhumba|Bolero|Stride|Slow Gospel Blues|Slow Blues|Gospel|Blues|Funk|Latin|Pop|Cocktail Jazz|Swing|Ballad|Waltz)\s*$/i;

function stripRole(base) {
  let c = String(base || '');
  c = c.replace(/\s*[–—-]?\s*(Challenge|Accompaniment Patterns?|Accompaniment)\s*$/i, '').trim();
  return c;
}

export function songFields(base, styles = []) {
  const raw = String(base || '');
  if (SKILL_CHALLENGE.test(raw)) return { song: null, songKey: null, skillChallenge: true };
  let display = stripRole(raw);
  // strip a trailing style token (either a known style or one present in this ep's styles)
  const styleAlt = (styles || []).map((s) => s.replace(/s$/i, '')).filter(Boolean);
  const dynamic = styleAlt.length ? new RegExp(`\\s*[–—-]\\s*(${styleAlt.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})s?\\s*$`, 'i') : null;
  display = display.replace(STYLE_SUFFIX, '').trim();
  if (dynamic) display = display.replace(dynamic, '').trim();
  const songKey = display.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
  return { song: display || null, songKey: songKey || null, skillChallenge: false };
}
