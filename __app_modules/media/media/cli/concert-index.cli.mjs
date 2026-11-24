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

import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

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
 * A section runs from where the music resumes to where the applause after it
 * begins. Every applause run's end is a start, because the silences that
 * bracket applause are rejected as candidates (they sit within its padding),
 * and without this every piece after the first applause would vanish.
 *
 * @param {object} o
 * @param {number[]} o.candidates where music resumes (seconds), applause-filtered
 * @param {Array<{start:number,end:number}>} [o.applause] applause runs
 * @param {number} o.durationS file duration
 */
export function sectionsFrom({ candidates, applause = [], durationS }) {
  const inside = (s) => applause.find((r) => r.start <= s && s < r.end);
  const starts = [0, ...candidates, ...applause.map((r) => r.end)]
    .map((s) => inside(s)?.end ?? s)
    .filter((s) => s >= 0 && s < durationS)
    .sort((a, b) => a - b)
    .filter((s, i, all) => i === 0 || s !== all[i - 1]);
  return starts
    .map((start, k) => {
      const next = k + 1 < starts.length ? starts[k + 1] : durationS;
      const clap = applause.find((r) => r.start > start && r.start < next);
      return { start, end: clap ? clap.start : next, applauseAfter: Boolean(clap) };
    })
    .filter((s) => s.end > s.start);
}

/**
 * A cue whose midpoint falls inside a section is that section's `text`. A cue
 * in the gap before it (the applause after the previous piece) is its
 * `intro`: a narrator speaking over the last of the clapping is introducing
 * what comes next. The first section's intro is anything before it starts.
 */
export function attachCues(sections, cues) {
  const mid = (c) => (c.start + c.end) / 2;
  return sections.map((s, k) => {
    const gapStart = k > 0 ? sections[k - 1].end : -Infinity;
    const mine = cues.filter((c) => mid(c) >= s.start && mid(c) < s.end);
    const intro = cues.filter((c) => mid(c) >= gapStart && mid(c) < s.start);
    return {
      ...s,
      cues: mine.map((c) => c.i),
      text: mine.map((c) => c.text).join(' '),
      introCues: intro.map((c) => c.i),
      intro: intro.map((c) => c.text).join(' '),
    };
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
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
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
 * Every track, best first. `lyric` scores the section's own text against the
 * incipit, and is null where the track has none (instrumentals, bell pieces),
 * so "no evidence" never reads as "no match". `titleHit` scores the intro and
 * the text against the title, to catch "...and now, Sleigh Ride".
 * `score` is the better of the two, so an announced instrumental (no
 * incipit, title heard) is not pushed out of the top few by a lyric miss.
 * Ties go to lyric evidence, then album order. `durationRatio` is shown for
 * judgement only: concert edits differ from the album.
 */
export function rankTracks(section, tracks) {
  const len = section.end - section.start;
  const heard = `${section.intro ?? ''} ${section.text ?? ''}`;
  return tracks
    .map((t) => {
      const lyric = t.incipit ? round(lyricOverlap(section.text, t.incipit), 3) : null;
      const titleHit = round(lyricOverlap(heard, t.title), 3);
      return {
        listing: t.listing ?? null,
        n: t.n,
        title: t.title,
        score: Math.max(lyric ?? 0, titleHit),
        lyric,
        titleHit,
        durationRatio: t.length ? round(len / t.length, 2) : null,
      };
    })
    // Array.prototype.sort is stable, so equal rows keep album order.
    .sort((a, b) => (b.score - a.score) || ((b.lyric ?? -1) - (a.lyric ?? -1)));
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

/* -------------------------------------------------------------------------- */
/* CLI shell: all the I/O, so everything above stays unit-testable            */
/* -------------------------------------------------------------------------- */

const UNQUOTABLE = /[,:;'[\]\\]/;

/**
 * One decode, three outputs: per-second full-band RMS (8 kHz), per-second
 * >9 kHz RMS (32 kHz), and silencedetect on stderr. The two level passes are
 * the recipe in __docs/reference/player/surround/classical/README.md, joined
 * with asplit so a 3 GB file crosses the network once instead of three times.
 */
export function measureGraph(outDir, { noiseDb = -40, minSilenceS = 0.8 } = {}) {
  if (UNQUOTABLE.test(outDir)) throw new Error(`output dir has characters a filtergraph cannot hold: ${outDir}`);
  const stats = 'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level';
  return [
    '[0:a]asplit=3[a][b][c]',
    `[a]aresample=8000,asetnsamples=8000,${stats}:file=${outDir}/rms.txt,anullsink`,
    `[b]aresample=32000,highpass=f=9000,asetnsamples=32000,${stats}:file=${outDir}/hf.txt,anullsink`,
    `[c]silencedetect=noise=${noiseDb}dB:d=${minSilenceS}[out]`,
  ].join(';');
}

export function clipArgs(media, at, pad, outDir) {
  const name = `clip-${String(Math.round(at)).padStart(4, '0')}.mp4`;
  return [
    '-v', 'error', '-y', '-ss', String(Math.max(0, Math.round(at - pad))), '-i', media, '-t', String(pad * 2),
    '-vf', 'scale=-2:360', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
    '-c:a', 'aac', '-b:a', '128k', path.join(outDir, name),
  ];
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}: ${String(r.stderr).slice(-800)}`);
  return r;
}

function durationOf(media) {
  return Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', media]).stdout.trim());
}

const USAGE = `concert-index: evidence for a concert video's programme

  track-listing --page "<Wikipedia title>" [--out tracks.json]
      Fetch the article's wikitext and print every {{Track listing}} track.
  measure <media> --out <dir> [--noise -40] [--min-silence 0.8]
      Decode the audio once; write rms.txt, hf.txt, silence.txt, duration.json.
  evidence --measured <dir> --srt <file> [--tracks tracks.json] [--min-gap 20] [--out evidence.json]
      Build sections from measured audio, attach subtitles, rank tracks.
  clips <media> --at 120,305.5 [--pad 6] --out <dir>
      Cut a 360p review clip centred on each boundary.`;

export async function runCliEntry(argv = process.argv.slice(2)) {
  const { values: f, positionals: [cmd, media] } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      page: { type: 'string' }, out: { type: 'string' }, noise: { type: 'string' },
      'min-silence': { type: 'string' }, measured: { type: 'string' }, srt: { type: 'string' },
      tracks: { type: 'string' }, 'min-gap': { type: 'string' }, at: { type: 'string' },
      pad: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    },
  });
  const emit = (obj) => {
    const text = `${JSON.stringify(obj, null, 2)}\n`;
    if (f.out && cmd !== 'measure' && cmd !== 'clips') writeFileSync(f.out, text);
    else process.stdout.write(text);
  };

  if (f.help || !cmd) { console.log(USAGE); return; }

  if (cmd === 'track-listing') {
    if (!f.page) throw new Error('--page is required');
    const url = 'https://en.wikipedia.org/w/api.php?action=parse&prop=wikitext&format=json&formatversion=2&redirects=1'
      + `&page=${encodeURIComponent(f.page)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'concert-index/0.1' } });
    if (!res.ok) throw new Error(`Wikipedia answered ${res.status} for ${f.page}`);
    const body = await res.json();
    if (body.error) throw new Error(`Wikipedia: ${body.error.info}`);
    emit({ page: f.page, tracks: parseTrackListing(body.parse.wikitext) });
    return;
  }

  if (cmd === 'measure') {
    if (!media || !f.out) throw new Error('measure needs <media> and --out');
    mkdirSync(f.out, { recursive: true });
    const graph = measureGraph(f.out, {
      noiseDb: f.noise ? Number(f.noise) : -40,
      minSilenceS: f['min-silence'] ? Number(f['min-silence']) : 0.8,
    });
    const r = run('ffmpeg', ['-hide_banner', '-nostats', '-vn', '-i', media, '-filter_complex', graph, '-map', '[out]', '-f', 'null', '-']);
    const silence = String(r.stderr).split('\n').filter((l) => l.includes('silencedetect')).join('\n');
    writeFileSync(path.join(f.out, 'silence.txt'), `${silence}\n`);
    writeFileSync(path.join(f.out, 'duration.json'), JSON.stringify({ media, durationS: durationOf(media) }));
    console.log(`measured ${media} -> ${f.out}`);
    return;
  }

  if (cmd === 'evidence') {
    if (!f.measured || !f.srt) throw new Error('evidence needs --measured and --srt');
    const read = (name) => readFileSync(path.join(f.measured, name), 'utf8');
    const { durationS } = JSON.parse(read('duration.json'));
    const tracks = f.tracks ? (JSON.parse(readFileSync(f.tracks, 'utf8')).tracks ?? []) : [];
    emit(buildEvidence({
      durationS,
      silenceLog: read('silence.txt'),
      rmsText: read('rms.txt'),
      hfText: read('hf.txt'),
      cues: parseSrt(readFileSync(f.srt, 'utf8')),
      tracks,
      minGapS: f['min-gap'] ? Number(f['min-gap']) : 20,
    }));
    return;
  }

  if (cmd === 'clips') {
    if (!media || !f.at || !f.out) throw new Error('clips needs <media>, --at and --out');
    mkdirSync(f.out, { recursive: true });
    const pad = f.pad ? Number(f.pad) : 6;
    for (const at of f.at.split(',').map(Number).filter(Number.isFinite)) run('ffmpeg', clipArgs(media, at, pad, f.out));
    console.log(`clips -> ${f.out}`);
    return;
  }

  throw new Error(`unknown subcommand: ${cmd}\n\n${USAGE}`);
}

if (import.meta.url === `file://${process.argv[1]}`) { await runCliEntry(); }
