/**
 * Subtitle word matching for the content filter.
 *
 * Pure rules shared by every SRT producer (`srt-mutes`, `srt-review`): parse
 * an SRT, compile the household word list (`bad-words.yml` shape), find the
 * listed words in subtitle lines, and turn a hit into the mute cue the
 * override stores. One matcher means one cue id per spoken word, so a
 * grown-up's `cueOverrides.<id>` survives a re-import.
 */

/** Severity scale of the filter EDL, lowest first. */
export const SEVERITY_LEVELS = Object.freeze(['low', 'medium', 'high']);

/**
 * Word-list tier -> cue severity. A tier names the most permissive setting at
 * which the word is still filtered, so "tolerant" words are the harshest.
 */
export const TIER_SEVERITY = Object.freeze({ tolerant: 'high', moderate: 'medium', strict: 'low' });

const srtTimeToSec = (t) => {
  const m = String(t || '').trim().match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
  if (!m) return null;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
};

/** Parse an SRT string into [{ start, end, text }] (tags stripped, lowercased). */
export function parseSrt(text) {
  const blocks = String(text || '').replace(/\r\n/g, '\n').split(/\n\s*\n/);
  const out = [];
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim() !== '');
    const tline = lines.find((l) => l.includes('-->'));
    if (!tline) continue;
    const [a, c] = tline.split('-->');
    const start = srtTimeToSec(a);
    const end = srtTimeToSec(c);
    if (start == null) continue;
    const body = lines.slice(lines.indexOf(tline) + 1).join(' ')
      .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').toLowerCase().trim();
    out.push({ start, end, text: body });
  }
  return out;
}

/**
 * Compile a `bad-words.yml` document into lookup tables.
 * Later leaves win when two leaves claim the same form.
 * @returns {{ byForm: Map<string,string>, leaves: Object<string,{group,tier,severity}>, groups: string[] }}
 */
export function compileWordList(doc) {
  const words = doc?.words;
  if (!words || typeof words !== 'object') throw new Error('word list has no `words` map');
  const byForm = new Map();
  const leaves = {};
  for (const [leaf, def] of Object.entries(words)) {
    const group = def?.group;
    if (!group) continue;
    leaves[leaf] = { group, tier: def.tier ?? null, severity: TIER_SEVERITY[def.tier] ?? 'medium' };
    const forms = Array.isArray(def.forms) && def.forms.length ? def.forms : [leaf];
    for (const form of forms) byForm.set(String(form).toLowerCase(), leaf);
  }
  const groups = [...new Set(Object.values(leaves).map((l) => l.group))];
  return { byForm, leaves, groups };
}

/** Speech-rate estimate: a caption's START tracks speech onset, its END does not. */
const SECS_PER_WORD = 0.33;

const normToken = (tok) => tok.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Find listed words in parsed SRT lines. Word i of a line is placed at
 * start + i*0.33s, never past the caption end. Every listed word gets its own
 * hit, even when two land at the same instant: collapsing them would let a
 * grown-up's disable of one (a prayer's "god") unmute the other ("hell").
 *
 * The id is `srt<line start ms>_<token index>`. It depends on the SRT alone,
 * so it is stable while the SRT is unchanged and survives word-list edits;
 * `cueOverrides.<id>` keeps pointing at the same spoken word. Only true
 * duplicates (a repeated subtitle block: same start, index and token) are dropped.
 */
export function findWordHits(lines, wordList) {
  const hits = [];
  const seen = new Set();
  lines.forEach((line, lineIndex) => {
    const cap = Number.isFinite(line.end) ? line.end : Infinity;
    const startMs = Math.round(line.start * 1000);
    String(line.text || '').split(/\s+/).filter(Boolean).forEach((tok, i) => {
      const token = normToken(tok);
      const leaf = wordList.byForm.get(token);
      if (!leaf) return;
      const key = `${startMs}_${i}_${token}`;
      if (seen.has(key)) return;
      seen.add(key);
      const t = Math.min(line.start + i * SECS_PER_WORD, cap);
      const { group, severity } = wordList.leaves[leaf];
      hits.push({
        cueId: `srt${startMs}_${i}`, lineIndex, token, leaf, group,
        category: `language/${group}/${leaf}`, severity,
        in: Number(t.toFixed(2)), out: Number((t + 0.05).toFixed(2)),
      });
    });
  });
  return hits;
}

/** The local-time mute addCue for one hit (the resolver widens the point). */
export function hitToMuteCue(hit) {
  return {
    id: hit.cueId, effect: 'mute', category: hit.category, channel: 'audio', severity: hit.severity,
    in: hit.in, out: hit.out, label: hit.leaf, source: 'srt', precision: 'srt-line',
  };
}

/** A subtitle line with its neighbours, for judging a word in context. */
export function lineContext(lines, index) {
  return {
    line: lines[index]?.text ?? '',
    before: lines[index - 1]?.text ?? '',
    after: lines[index + 1]?.text ?? '',
  };
}

/**
 * Category leaf -> spoken word stems (what the SRT/transcript contains), used to
 * snap a mute cue onto its word. A stem matches as a word prefix (`\b<stem>`),
 * so `goddam` covers goddamn, goddamned, goddammit and goddamnit.
 */
const SPOKEN_STEMS = Object.freeze({
  fuck: ['fuck', 'fuckin', 'fucking', 'fucked', 'motherfuck'],
  shit: ['shit', 'bullshit', 'shitty'],
  ass: ['ass', 'asshole', 'dumbass', 'jackass', 'badass'],
  damn: ['damn', 'dammit', 'damnit', 'goddamn'],
  hell: ['hell'],
  bitch: ['bitch'],
  god: ['god', 'goddamn', 'goddamnit'],
  goddamn: ['goddam'],
  jesus: ['jesus'],
  christ: ['christ'],
  bastard: ['bastard'],
  nigger: ['nigg'],
});

/** Spoken stems for a cue category (by its leaf), or null when none are known. */
export function spokenStemsFor(category) {
  return SPOKEN_STEMS[String(category || '').split('/').pop()] ?? null;
}
