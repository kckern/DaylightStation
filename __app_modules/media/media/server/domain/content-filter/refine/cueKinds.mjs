/**
 * What kind of evidence a cue needs, and how to recognise its word.
 *
 *   speech      a single tagged word (VidAngel mute with a censored-word label)
 *   speech-line something said, described in prose ("A man talks about ...")
 *   visual      something shown
 *   credits     opening/closing credits
 *   sound       a non-speech sound ("Gunfire can be heard")
 *
 * `initialKind` is a guess from fields alone. Labels in prose under a
 * language category are ambiguous (said vs shown on a sign); those return
 * `needsRouting: true` and the refiner asks the decision model.
 */

const PROSE = /\s/;

/** A label that names one word (possibly censored: "G*d", "b*tthead", "Irish bug"). */
export function isWordLabel(label) {
  const l = String(label || '').trim();
  return !!l && (!PROSE.test(l) || l.length <= 14) && !/[.!?]$/.test(l) && l.split(/\s+/).length <= 2;
}

export function initialKind(cue) {
  const cat = String(cue.category || '');
  const label = String(cue.label || '').trim();
  if (cat.startsWith('credits/')) return { kind: 'credits', needsRouting: false };
  if (cue.type === 'mute' && isWordLabel(label)) return { kind: 'speech', needsRouting: false };
  if (/\b(heard|sound of|sounds? (of|can))\b/i.test(label) && cue.type === 'mute') return { kind: 'sound', needsRouting: false };
  if (cue.type === 'mute') return { kind: 'speech-line', needsRouting: true };
  if (cat.startsWith('language/')) return { kind: isWordLabel(label) ? 'speech' : 'speech-line', needsRouting: !isWordLabel(label) };
  return { kind: 'visual', needsRouting: false };
}

// Spoken forms per category leaf. Compounds count for each part (goddammit is god and damn).
const FORMS = {
  god: ['god', 'gods', "god's", 'goddamn', 'goddamnit', 'goddammit', 'godsakes', 'godawful'],
  damn: ['damn', 'damned', 'damnit', 'dammit', 'goddamn', 'goddamnit', 'goddammit'],
  hell: ['hell', "hell's", 'hellhole'],
  shit: ['shit', 'shits', 'shitty', 'bullshit', 'shitload', 'shithead'],
  jesus: ['jesus', 'jeez', 'geez', 'jeezus'],
  christ: ['christ', "christ's", 'christsakes'],
  ass: ['ass', 'asses', 'asshole', 'assholes', 'jackass', 'smartass', 'dumbass'],
  bastard: ['bastard', 'bastards'],
  bitch: ['bitch', 'bitches', 'bitchin', "bitchin'", 'bitching'],
  screw: ['screw', 'screwed', 'screwing', 'screwin', 'screwball'],
  fuck: ['fuck', 'fucking', 'fuckin', 'fucked', 'fucker', 'motherfucker'],
};

function normWord(w) {
  return String(w || '').toLowerCase().replace(/[^a-z']/g, '').replace(/^'+|'+$/g, '');
}

/**
 * A matcher for the tagged word, or null when the cue is not a single word.
 * Uses the category leaf when known, else the label with '*' as one letter.
 * @returns {((word: string) => boolean)|null}
 */
export function wordMatcher(cue) {
  const label = String(cue.label || '').trim();
  if (!isWordLabel(label)) return null;
  const leaf = String(cue.category || '').split('/').pop();
  let forms = FORMS[leaf];
  if (!forms) {
    const rx = new RegExp(`^${label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '*' ? '*' : `\\${c}`)).replace(/\*/g, '[a-z]')}$`);
    const key = Object.keys(FORMS).find((k) => rx.test(k));
    if (key) forms = FORMS[key];
  }
  if (forms) {
    const set = new Set(forms);
    return (w) => set.has(normWord(w));
  }
  // Unknown word: the label itself (multi-word labels match their first word), '*' = any letters
  const first = label.toLowerCase().split(/\s+/)[0];
  const rx = new RegExp(`^${first.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z]+')}s?$`);
  return (w) => rx.test(normWord(w));
}
