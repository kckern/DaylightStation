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
