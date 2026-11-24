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

import {
  parseSilences, candidateBoundaries, parseAstats, zipFrames, applauseRuns, rejectApplauseCandidates,
} from './segment-timings.cli.mjs';

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

/* -------------------------------------------------------------------------- */
/* Matching                                                                   */
/* -------------------------------------------------------------------------- */

const STOP = new Set(('a an and the of to in on is it for with be we you i he she they '
  + 'our his her my me us oh o this that all are as at by from not but so ye thy thee').split(' '));

/** Content words: lowercased, accents and apostrophes gone, 3+ letters, no stop words. */
export function words(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Share of the reference's distinct content words that were heard. 0..1. */
export function lyricOverlap(heard, reference) {
  const h = new Set(words(heard));
  const ref = new Set(words(reference));
  if (!h.size || !ref.size) return 0;
  let hit = 0;
  for (const w of ref) if (h.has(w)) hit += 1;
  return hit / ref.size;
}

const round = (v, places) => Number(v.toFixed(places));

/**
 * Every track, best first. `lyric` is null where the track has no incipit
 * (instrumentals, bell pieces), so "no evidence" never reads as "no match".
 * `title` catches spoken introductions ("...and now, Sleigh Ride").
 * `durationRatio` is a tiebreaker only: concert edits differ from the album.
 */
export function rankTracks(section, tracks) {
  const len = section.end - section.start;
  return tracks
    .map((t) => ({
      n: t.n,
      title: t.title,
      lyric: t.incipit ? round(lyricOverlap(section.text, t.incipit), 3) : null,
      titleHit: round(lyricOverlap(section.text, t.title), 3),
      durationRatio: t.length ? round(len / t.length, 2) : null,
    }))
    .sort((a, b) => ((b.lyric ?? -1) - (a.lyric ?? -1)) || (b.titleHit - a.titleHit));
}

/* -------------------------------------------------------------------------- */
/* Evidence                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The whole pure pipeline. Inputs are the raw text the `measure` subcommand
 * saves, so evidence can be rebuilt with different thresholds without
 * decoding the video again.
 */
export function buildEvidence({ durationS, silenceLog, rmsText, hfText, cues, tracks = [], minGapS = 20 }) {
  const frames = zipFrames(parseAstats(rmsText), parseAstats(hfText));
  const applause = applauseRuns(frames);
  const candidates = rejectApplauseCandidates(
    candidateBoundaries(parseSilences(silenceLog), { minGapS }),
    applause,
  );
  const sections = attachCues(sectionsFrom({ candidates, applause, durationS }), cues)
    .map((s, k) => ({ n: k + 1, ...s, ranks: rankTracks(s, tracks).slice(0, 3) }));
  return { durationS, applause, sections };
}
