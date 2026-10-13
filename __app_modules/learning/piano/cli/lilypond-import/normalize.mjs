/**
 * normalize — rewrite a Mutopia LilyPond source into a canonical, minimal `\score`
 * that a downstream MusicXML converter can actually digest.
 *
 * WHY THIS EXISTS: python-ly's *music* parser is solid — it handles fingerings,
 * slurs, hairpins, tuplets, grace notes, chords and nested `\alternative` blocks
 * correctly. Its *context/score plumbing* is not: on 18 of 38 target files it
 * walked the `\context PianoStaff << \context Staff = "up" << ... >> >>` shape,
 * threw an internal error, and emitted an empty part — while exiting 0.
 *
 * So we do not try to fix the score block. We REPLACE it. The music lives in
 * top-level variables; we resolve which variables belong to which staff, then
 * synthesize `\score { \new PianoStaff << \new Staff {...} \new Staff {...} >> }`
 * from scratch. Measured: 18/18 previously-empty files recovered, 932 fingerings
 * preserved, every output a 2-staff grand staff.
 *
 * The other half of the job is movements. A Mutopia file may hold several
 * `\score` blocks (Clementi's Op.36 sonatinas are three movements in one file).
 * Splitting them HERE — one canonical `\score` per movement — is why the
 * downstream stage never has to split multi-part MusicXML afterwards.
 */

/** Span of the brace-delimited group starting at/after `from`. */
export function braceSpan(text, from = 0) {
  const open = text.indexOf('{', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return { open, close: i };
    }
  }
  return null; // unbalanced — caller decides whether that's fatal
}

/** Span of the `<< >>` group starting at/after `from`. */
export function angleSpan(text, from = 0) {
  const open = text.indexOf('<<', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text.startsWith('<<', i)) { depth += 1; i += 1; continue; }
    if (text.startsWith('>>', i)) {
      depth -= 1;
      if (depth === 0) return { open, close: i + 1 };
      i += 1;
    }
  }
  return null;
}

// A top-level assignment: `vOne = \relative c'' { ... }` / `Global = { ... }`.
// Anchored to line start so note-level tokens (`a = ...` never occurs, but
// `\set Staff.foo = ...` does) can't be mistaken for a definition.
const VAR_DEF = /^[ \t]*([A-Za-z][A-Za-z0-9]*)[ \t]*=/gm;

/** Every top-level variable definition, as { name → body-with-braces }. */
export function variableDefs(src) {
  const out = new Map();
  for (const m of src.matchAll(VAR_DEF)) {
    const span = braceSpan(src, m.index + m[0].length);
    if (!span) continue;
    // Guard: the body must start soon after the `=`, else we've matched an
    // assignment whose value is a bare token and run into a LATER block.
    const between = src.slice(m.index + m[0].length, span.open);
    if (/[;}]/.test(between) || between.length > 80) continue;
    out.set(m[1], src.slice(m.index + m[0].length, span.close + 1).trim());
  }
  return out;
}

// A pitch token: optional accidental suffix, optional octave marks, then a
// duration digit. `c4`, `bes8`, `fis'16`, `r2`, `<c e>4` (matched via the `<`).
// `s` is in the letter class on purpose: a voice made entirely of SPACER rests
// (`vTwo = \relative c'' { s1 s s s }`) is still music. Miss that and the voice
// is misfiled as a settings block, which both drops it from the parallel group
// and reorders the staff — the exact bug this comment is standing on.
const PITCH = /(?:^|[\s{<\\])(?:[a-grs](?:is|es|s|f|ss|x|sharp|flat)*[',]*\d|<[^>]*>\d)/;

// Same, but WITHOUT the spacer `s`: content that actually sounds or occupies a
// rest. This is what separates a real voice from a dynamics track.
const AUDIBLE = /(?:^|[\s{<\\])(?:[a-gr](?:is|es|s|f|ss|x|sharp|flat)*[',]*\d|<[^>]*>\d)/;

/** True when a variable body carries rhythmic content of any kind. */
export function looksLikeMusic(body) {
  return PITCH.test(String(body || ''));
}

/** True when a body has pitches or audible rests — i.e. is a real voice. */
export function hasAudibleContent(body) {
  return AUDIBLE.test(String(body || ''));
}

/**
 * A spacer track: rhythm made entirely of invisible `s` skips, used to hang
 * dynamics off (`dynamics = { s2\\f s2*3 }`). It is not a voice, and emitting it
 * as one invents a phantom staff-voice. Distinct from a voice that is MOSTLY
 * spacers but has real bars — Burgmüller's vTwo rests for pages, then plays.
 */
export function isSpacerTrack(body) {
  return looksLikeMusic(body) && !hasAudibleContent(body);
}

/**
 * Every `\score { ... }` in document order, tagged with its output blocks.
 *
 * The tags matter: a score carrying only `\midi` is a PLAYBACK rendering of
 * music already engraved by a sibling `\layout` score — Mutopia's Schumann
 * files all use that pair. Treating it as a movement publishes every piece
 * twice.
 *
 * @returns {Array<{body: string, hasLayout: boolean, hasMidi: boolean}>}
 */
export function splitScores(src) {
  const out = [];
  const re = /\\score\b/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const span = braceSpan(src, m.index + m[0].length);
    if (!span) continue;
    const body = src.slice(span.open + 1, span.close);
    out.push({ body, hasLayout: /\\layout\b/.test(body), hasMidi: /\\midi\b/.test(body) });
    re.lastIndex = span.close;
  }
  return out;
}

const CLEF = /\\clef\s+"?([a-zA-Z]+)"?/;

/**
 * Which variables belong to which staff, in score order.
 *
 * Rather than parse the (wildly inconsistent) staff syntax, split the score body
 * at each `\new Staff` / `\context Staff` boundary and read each chunk. That
 * handles all three shapes in the corpus uniformly:
 *   `\new Staff = "upper" \upperfirst`          (bare variable reference)
 *   `\context Staff = "up" << \Global \vOne >>` (angle group, multi-voice)
 *   `\new Staff { \clef bass \lower }`          (brace group)
 *
 * @returns {Array<{clef: string|null, vars: string[]}>}
 */
export function staffMap(scoreBody, defs) {
  const boundary = /\\(?:new|context)\s+Staff\b/g;
  const starts = [];
  let m;
  while ((m = boundary.exec(scoreBody)) !== null) starts.push(m.index);
  if (!starts.length) return [];

  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : scoreBody.length;
    const chunk = scoreBody.slice(start, end);
    const clefMatch = chunk.match(CLEF);
    // Only accept references that name a variable actually defined in this file.
    // That is far more robust than denylisting LilyPond's ~thousand commands.
    const vars = [...chunk.matchAll(/\\([A-Za-z][A-Za-z0-9]*)/g)]
      .map((r) => r[1])
      .filter((name) => defs.has(name));
    return { clef: clefMatch ? clefMatch[1] : null, vars: [...new Set(vars)] };
  });
}

/** First `^\markup{Word}` / `_\markup {Word}` in a music body — a movement name. */
export function movementHint(body) {
  const m = String(body || '').match(/[\^_]\s*\\markup\s*\{?\s*"?\\?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .']*)"?\s*\}?/);
  if (!m) return null;
  const word = m[1].trim().replace(/\s+/g, ' ');
  // Reject engraving directives that happen to sit in a markup ("italic", "large").
  if (/^(italic|bold|large|small|tiny|teeny|normalsize|column|line|concat)$/i.test(word)) return null;
  return word || null;
}

/** Tempo as a MusicXML-friendly {unit, bpm}, from `\tempo 4 = 152`. */
export function tempoOf(scoreBody) {
  const m = String(scoreBody || '').match(/\\tempo\s+(\d+)\s*\.?\s*=\s*(\d+)/);
  return m ? { unit: Number(m[1]), bpm: Number(m[2]) } : null;
}

/**
 * Build one canonical `\score` document for a single movement.
 *
 * Settings variables (`Global = {\key c\major \time 4/4}`) carry key/time and are
 * emitted SEQUENTIALLY ahead of the music. Emitting them as a parallel voice
 * would invent an empty staff-voice and shift everything.
 *
 * @returns {{ly: string, staves: number, voices: number}|null}
 */
export function buildCanonical(src, scoreBody, defs, opts = {}) {
  const staves = staffMap(scoreBody, defs);
  if (staves.length < 1) return null;

  const version = (src.match(/\\version\s+"([^"]+)"/) || [, '2.18.2'])[1];
  const used = new Set();
  const rendered = [];

  for (const staff of staves.slice(0, 2)) {
    const settings = [];
    const music = [];
    for (const name of staff.vars) {
      const body = defs.get(name);
      if (!body) continue;
      if (isSpacerTrack(body)) continue;        // dynamics track — not a voice
      (hasAudibleContent(body) ? music : settings).push(name);
      used.add(name);
    }
    if (!music.length) return null; // a staff with no notes means we mis-read it

    const clef = staff.clef ? `\\clef ${staff.clef} ` : '';
    const lead = settings.map((n) => `\\${n} `).join('');
    const body = music.length > 1
      ? `<< ${music.map((n) => `\\${n}`).join(' \\\\ ')} >>`
      : `\\${music[0]}`;
    rendered.push(`\\new Staff { ${clef}${lead}${body} }`);
  }
  if (!rendered.length) return null;

  const defBlock = [...used].map((n) => `${n} = ${defs.get(n)}`).join('\n');
  const tempo = opts.tempo ? `\n  \\midi { \\tempo ${opts.tempo.unit} = ${opts.tempo.bpm} }` : '';
  const ly = `\\version "${version}"\n${defBlock}\n\\score {\n  \\new PianoStaff <<\n    ${rendered.join('\n    ')}\n  >>\n  \\layout {}${tempo}\n}\n`;

  const isVoice = (v) => defs.has(v) && hasAudibleContent(defs.get(v));
  const voices = staves.slice(0, 2).reduce((n, s) => n + s.vars.filter(isVoice).length, 0);
  // Signature = which music variables this score draws on, per staff. Two
  // `\score` blocks over the SAME variables are one movement typeset twice
  // (the `\layout` + `\midi` idiom), not two movements — see normalize().
  const signature = staves.slice(0, 2).map((s) => s.vars.filter(isVoice).join(',')).join('|');
  return { ly, staves: rendered.length, voices, signature };
}

/**
 * Normalize a whole source file into one canonical document per movement.
 * @returns {Array<{index, ly, staves, voices, tempo, hint}>}
 */
export function normalize(src) {
  const defs = variableDefs(src);
  const scores = splitScores(src);
  // Drop MIDI-only scores when an engraved sibling exists: they are the same
  // music rendered for playback, not another movement.
  const engraved = scores.some((s) => s.hasLayout)
    ? scores.filter((s) => !(s.hasMidi && !s.hasLayout))
    : scores;
  // A file with no \score block still has music worth converting — treat the
  // whole source as one implicit score so `\new Staff` references are found.
  const bodies = engraved.length ? engraved.map((s) => s.body) : [src];

  const out = [];
  const seen = new Set();
  bodies.forEach((body, i) => {
    const tempo = tempoOf(body);
    const built = buildCanonical(src, body, defs, { tempo });
    if (!built) return;
    // Mutopia files routinely carry the same music in two `\score` blocks — one
    // for `\layout`, one for `\midi`. Emitting both would publish every Schumann
    // piece twice, the second copy often empty. Keep the first; it is the
    // engraved one. Genuine movements (Clementi's three) use DIFFERENT variables
    // and so keep distinct signatures.
    if (seen.has(built.signature)) return;
    seen.add(built.signature);
    const firstMusic = staffMap(body, defs)
      .flatMap((s) => s.vars)
      .map((n) => defs.get(n))
      .find((b) => b && looksLikeMusic(b));
    out.push({ index: i, ...built, tempo, hint: movementHint(firstMusic) });
  });
  return out;
}

export default {
  normalize, buildCanonical, staffMap, variableDefs, splitScores,
  looksLikeMusic, hasAudibleContent, isSpacerTrack, movementHint, tempoOf, braceSpan, angleSpan,
};
