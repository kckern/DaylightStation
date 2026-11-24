#!/usr/bin/env node

/**
 * Concert index CLI: turn one concert video into evidence for its programme.
 *
 * A televised concert is a run of songs, readings and introductions with
 * applause between them. This finds the audio sections (silence and applause
 * bound them), attaches the subtitle text that falls inside each, and ranks
 * which expected track each section is. It does NOT write a sidecar: the
 * evidence is for a person or agent to judge, because album order, cut
 * numbers and attacca medleys make a blind assignment wrong often enough to
 * matter.
 *
 * Subcommands: track-listing, measure, evidence, clips. Run with --help.
 *
 * @module cli/concert-index
 */

/* -------------------------------------------------------------------------- */
/* Track listings                                                             */
/* -------------------------------------------------------------------------- */

/** "5:31" -> 331, "1:02:03" -> 3723, anything else -> null. */
export function mmss(s) {
  const parts = String(s ?? '').trim().split(':');
  if (parts.length < 2) return null;
  const nums = parts.map(Number);
  if (nums.some((p) => !Number.isFinite(p))) return null;
  return nums.reduce((acc, p) => acc * 60 + p, 0);
}

/** Wiki markup to plain text: links keep their label, refs and templates go. */
export function stripWiki(s) {
  return String(s ?? '')
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[\s\S]*?<\/ref>/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const LISTING = /\{\{\s*Track listing([\s\S]*?)\n\s*\}\}/gi;
const FIELD = /^\s*\|\s*([a-z_]+?)(\d*)\s*=\s*(.*)$/i;

/**
 * Every `{{Track listing}}` block in an article's wikitext. An album article
 * often has two (CD and DVD), and they differ, so each track keeps the
 * listing's `headline`.
 *
 * @returns {Array<{listing:string|null, n:number, title:string, length:number|null, performers:string|null}>}
 */
export function parseTrackListing(wikitext) {
  const out = [];
  for (const block of String(wikitext ?? '').matchAll(LISTING)) {
    const fields = {};
    for (const line of block[1].split('\n')) {
      const f = FIELD.exec(line);
      if (f) fields[`${f[1].toLowerCase()}${f[2]}`] = f[3];
    }
    const listing = stripWiki(fields.headline) || null;
    for (let n = 1; fields[`title${n}`] !== undefined; n += 1) {
      const performers = stripWiki(fields[`extra${n}`]);
      out.push({
        listing,
        n,
        title: stripWiki(fields[`title${n}`]),
        length: mmss(fields[`length${n}`]),
        performers: performers || null,
      });
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Subtitles                                                                  */
/* -------------------------------------------------------------------------- */

const TS = /(\d+):(\d{2}):(\d{2})[,.](\d{3})/;

/** "00:01:03,160" -> 63.16 */
export function srtTime(s) {
  const m = TS.exec(String(s ?? ''));
  if (!m) return null;
  // Integer milliseconds first, one division last: 105 + 0.439 in floats is
  // 105.43900000000001, which breaks exact comparisons downstream.
  const ms = ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
  return ms / 1000;
}

/**
 * SubRip to cues. The concerts' subtitles are machine transcriptions: speech
 * is clean, sung lyrics are mangled. Both are kept verbatim; judging which is
 * which happens downstream.
 */
export function parseSrt(text) {
  const out = [];
  for (const block of String(text ?? '').replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.trim().split('\n');
    const k = lines.findIndex((l) => l.includes('-->'));
    if (k < 0) continue;
    const [a, b] = lines[k].split('-->');
    const start = srtTime(a);
    const end = srtTime(b);
    if (start === null || end === null) continue;
    out.push({ i: out.length + 1, start, end, text: lines.slice(k + 1).join(' ').trim() });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} o
 * @param {number[]} o.candidates where music resumes (seconds), applause-filtered
 * @param {Array<{start:number,end:number}>} [o.applause] applause runs
 * @param {number} o.durationS file duration
 */
export function sectionsFrom({ candidates, applause = [], durationS }) {
  const starts = [0, ...candidates.filter((c) => c > 0 && c < durationS)]
    .sort((a, b) => a - b)
    .filter((s, i, all) => i === 0 || s !== all[i - 1]);
  return starts.map((start, k) => {
    const next = k + 1 < starts.length ? starts[k + 1] : durationS;
    const clap = applause.find((r) => r.start > start && r.start < next);
    return { start, end: clap ? clap.start : next, applauseAfter: Boolean(clap) };
  });
}

/**
 * A cue belongs to the section whose territory (its start up to the NEXT
 * section's start) holds the cue's midpoint. Applause gaps are part of the
 * preceding section's territory, because a narrator often speaks over the
 * last of the clapping to introduce what comes next.
 */
export function attachCues(sections, cues) {
  return sections.map((s, k) => {
    const next = k + 1 < sections.length ? sections[k + 1].start : Infinity;
    const mine = cues.filter((c) => {
      const mid = (c.start + c.end) / 2;
      return mid >= s.start && mid < next;
    });
    return { ...s, cues: mine.map((c) => c.i), text: mine.map((c) => c.text).join(' ') };
  });
}
