// Data-integrity test for the singalong content tree (hymns + primary songs).
//
// Every one of the nine defect classes found in the 2026-08-16 audit
// (docs/_wip/audits/2026-08-16-singalong-yaml-format-audit.md) was a malformed
// `verses` block that the app renders without complaint: `SingalongAdapter`
// passes `metadata.verses` straight through, and `SingalongScroller` does
// `data.map(stanza => stanza.map(line => <p>{line}</p>))`. A null line paints an
// empty <p>, a nested array paints a run-on blob, and a stray `###` or `[Chorus]`
// paints itself. Nothing throws, so nothing surfaces until someone reads the wall.
//
// Stanza count is also a timing input, not just layout — the scroller derives
// `yStartTime` from `verses.length`, so a song collapsed into one stanza scrolls
// several times too slow. That makes "is this really one stanza?" a correctness
// question, which is why EMPTY_BY_DESIGN below is an explicit allowlist rather
// than a blanket "empty is fine".
//
// Contract: verses is Array<Array<non-empty trimmed string>>, free of importer
// markers.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

/** Resolve the data dir the same way the rest of the test infra does. */
function getDataPath() {
  if (process.env.DAYLIGHT_DATA_PATH) return process.env.DAYLIGHT_DATA_PATH;
  if (process.env.DAYLIGHT_BASE_PATH) return path.join(process.env.DAYLIGHT_BASE_PATH, 'data');
  const envFile = path.join(process.cwd(), '.env');
  if (fs.existsSync(envFile)) {
    const match = fs.readFileSync(envFile, 'utf8').match(/DAYLIGHT_BASE_PATH=(.+)/);
    if (match) return path.join(match[1].trim(), 'data');
  }
  return null;
}

// Children's Songbook 288-299 is the quiet-music section: piano arrangements
// with no text. `verses: []` is correct for these and only these.
const EMPTY_BY_DESIGN = new Set([
  'primary/0288-impromptu.yml',
  'primary/0289-to-a-wild-rose.yml',
  'primary/0290-each-sunday-morning.yml',
  'primary/0291-in-quietude.yml',
  'primary/0293-loving-shepherd.yml',
  'primary/0294-andante.yml',
  'primary/0295-o-rest-in-the-lord.yml',
  'primary/0296-air-from-orpheus.yml',
  'primary/0297-supplication.yml',
  'primary/0298-prelude-in-f.yml',
  'primary/0299-distant-bells.yml',
]);

const dataPath = getDataPath();
const root = dataPath && path.join(dataPath, 'content', 'singalong');

function collect() {
  const out = [];
  for (const coll of fs.readdirSync(root)) {
    const dir = path.join(root, coll);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.yml') || file === 'manifest.yml') continue;
      out.push({ id: `${coll}/${file}`, file, full: path.join(dir, file) });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

describe('singalong content tree stored shape', () => {
  it('resolves the data tree (DAYLIGHT_BASE_PATH / DAYLIGHT_DATA_PATH / .env)', () => {
    expect(dataPath, 'no data path — set DAYLIGHT_BASE_PATH or DAYLIGHT_DATA_PATH').toBeTruthy();
    expect(fs.existsSync(root), `singalong tree not found at ${root}`).toBe(true);
  });

  it('every song file parses and matches the verses contract', () => {
    const problems = [];
    const files = collect();
    expect(files.length).toBeGreaterThan(500); // guard against an empty/half-synced tree

    for (const { id, file, full } of files) {
      const flag = (msg) => problems.push(`${id}: ${msg}`);

      // A Dropbox conflicted copy still matches the adapter's /^0*(\d+)/ lookup,
      // so it surfaces as a duplicate of the song it shadows.
      if (/ conflicted copy /.test(file)) { flag('Dropbox conflicted copy'); continue; }

      let doc;
      try {
        doc = yaml.load(fs.readFileSync(full, 'utf8'));
      } catch (err) { flag(`parse error: ${err.message}`); continue; }

      if (!doc?.title) flag('missing title');

      // hymn/ uses hymn_num, primary/ uses song_number; both must agree with
      // the filename prefix, which is what the adapter actually looks up by.
      const numKey = Object.keys(doc || {}).find((k) => /num/.test(k));
      if (!numKey) flag('missing number key (hymn_num / song_number)');
      else if (doc[numKey] !== parseInt(file.slice(0, 4), 10)) {
        flag(`${numKey}=${doc[numKey]} does not match filename prefix ${file.slice(0, 4)}`);
      }

      const verses = doc?.verses;
      if (verses === null || verses === undefined) {
        flag('verses is null — whole block commented out?');
        continue;
      }
      if (!Array.isArray(verses)) { flag(`verses is ${typeof verses}, expected array`); continue; }
      if (verses.length === 0) {
        if (!EMPTY_BY_DESIGN.has(id)) flag('verses is empty and not in EMPTY_BY_DESIGN');
        continue;
      }

      verses.forEach((stanza, s) => {
        const at = `stanza ${s + 1}`;
        if (!Array.isArray(stanza)) { flag(`${at} is ${typeof stanza}, expected array`); return; }
        if (stanza.length === 0) { flag(`${at} is empty`); return; }
        stanza.forEach((line, l) => {
          const where = `${at} line ${l + 1}`;
          if (line === null) {
            // `- # text` parses as a null item; the convention is `#  - text`.
            flag(`${where} is null — "- #" pseudo-comment instead of "#  -"?`);
          } else if (Array.isArray(line)) {
            // A trailing `- #` line has no scalar value, so YAML absorbs the next
            // indented block as its value and a real verse disappears in here.
            flag(`${where} is a nested array — a verse was swallowed by a "- #" line`);
          } else if (typeof line !== 'string') {
            flag(`${where} is ${typeof line}, expected string`);
          } else {
            if (!line.trim()) flag(`${where} is blank`);
            if (line !== line.trim()) flag(`${where} has untrimmed whitespace: ${JSON.stringify(line)}`);
            if (line.includes('###')) flag(`${where} has an unsplit "###" stanza terminator`);
            if (/^\s*\[.*\]\s*$/.test(line)) flag(`${where} is a bare marker: ${JSON.stringify(line)}`);
            if (/<[a-z/]|&[a-z]+;|&#/i.test(line)) flag(`${where} contains HTML: ${JSON.stringify(line)}`);
          }
        });
      });
    }

    expect(problems, `${problems.length} malformed singalong file(s):\n  ${problems.join('\n  ')}`)
      .toEqual([]);
  });
});
