#!/usr/bin/env node

/**
 * Concert index CLI: where the music and the talk are inside a concert video.
 *
 * A televised concert is a run of songs, readings and introductions with
 * applause between them. This tool reads the audio and subtitles for evidence
 * of that structure. It does NOT write a sidecar: the evidence is for a
 * person or agent to judge.
 *
 * Subcommands: chapters, classify, evidence, clips. Run with --help.
 *
 * @module cli/concert-index
 */

import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* -------------------------------------------------------------------------- */
/* Chapters                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `ffprobe -show_chapters -of json` output (object or text) to chapters in
 * time order: `{index, start, end, title}`, seconds, `index` from 1. A chapter
 * without a `title` tag has title null.
 */
export function parseChapters(json) {
  const probe = typeof json === 'string' ? JSON.parse(json) : (json ?? {});
  return (probe.chapters ?? [])
    .map((c) => ({ start: Number(c.start_time), end: Number(c.end_time), title: c.tags?.title ?? null }))
    .sort((a, b) => a.start - b.start)
    .map((c, k) => ({ index: k + 1, ...c }));
}

/**
 * The chapters `evidence` works on: raw ffprobe output, the `chapters`
 * subcommand's list, or a list the caller built with real titles
 * (`[{title, start, end}]`, `index` optional). Every chapter needs a numeric
 * start before its end.
 */
export function chapterList(input) {
  const list = Array.isArray(input) ? input : parseChapters(input);
  return list.map((c, k) => {
    const start = Number(c.start);
    const end = Number(c.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(start < end)) {
      throw new Error(`chapter ${k + 1} (${JSON.stringify(c.title ?? null)}) needs numeric start < end`);
    }
    return { ...c, index: c.index ?? k + 1, start, end };
  });
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
/* Music and talk, second by second                                           */
/* -------------------------------------------------------------------------- */

/** AudioSet classes that count as music. Bells alone count: handbell pieces have no "Music" score to speak of. */
export const MUSIC_CLASSES = ['Music', 'Singing', 'Choir', 'Bell', 'Church bell', 'Jingle bell', 'Orchestra'];

/** Centred running median over `windowS` samples, the window shrinking at the edges. */
function medianSmooth(xs, windowS) {
  const half = Math.floor(windowS / 2);
  return xs.map((_, i) => {
    const w = xs.slice(Math.max(0, i - half), i + half + 1).sort((a, b) => a - b);
    const m = Math.floor(w.length / 2);
    return w.length % 2 ? w[m] : (w[m - 1] + w[m]) / 2;
  });
}

/**
 * One label per second from per-second class scores (`audio-events.py`):
 * 'music', 'narration' (speech over music), 'speech' or 'gap'. Music is the
 * best of the MUSIC_CLASSES present. Both signals are median-smoothed first,
 * so a cough or a one-second dropout does not split a piece.
 *
 * Applause scores as 'gap'. These broadcasts mix it low, under every
 * threshold here, and that is what lets a gap stand in for it.
 */
export function labelSeconds(classes, { music = 0.3, speech = 0.3, narration = 0.12, smoothS = 5 } = {}) {
  const present = MUSIC_CLASSES.filter((c) => Array.isArray(classes[c]));
  const n = Math.max(0, ...Object.values(classes).map((a) => (Array.isArray(a) ? a.length : 0)));
  const musicish = Array.from({ length: n }, (_, i) => Math.max(0, ...present.map((c) => classes[c][i] ?? 0)));
  const talk = Array.from({ length: n }, (_, i) => classes.Speech?.[i] ?? 0);
  const m = medianSmooth(musicish, smoothS);
  const t = medianSmooth(talk, smoothS);
  return m.map((mv, i) => {
    if (mv >= music) return t[i] >= narration ? 'narration' : 'music';
    return t[i] >= speech ? 'speech' : 'gap';
  });
}

function mergeEqual(runs) {
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.label === r.label) last.end = r.end;
    else out.push({ ...r });
  }
  return out;
}

/**
 * Per-second labels to runs `[{label, start, end}]` (seconds). A run shorter
 * than `minRunS` is absorbed into the run before it (an opening one into the
 * run after), then equal neighbours merge again.
 */
export function runsFrom(labels, { minRunS = 4 } = {}) {
  const absorbed = [];
  for (const r of mergeEqual(labels.map((label, i) => ({ label, start: i, end: i + 1 })))) {
    const last = absorbed[absorbed.length - 1];
    if (last && r.end - r.start < minRunS) last.end = r.end;
    else absorbed.push({ ...r });
  }
  if (absorbed.length > 1 && absorbed[0].end - absorbed[0].start < minRunS) {
    absorbed[1].start = absorbed[0].start;
    absorbed.shift();
  }
  return mergeEqual(absorbed);
}

const isMusic = (r) => r.label === 'music' || r.label === 'narration';

/**
 * A music run cut by a chapter edge with less than this left inside is the
 * neighbouring piece's tail or head, not this chapter's music.
 */
export const EDGE_TRIM_S = 10;
const span = (r) => r.end - r.start;

/**
 * Where the music and the talk are inside one native chapter.
 *
 * Runs are cut to [chapter.start, chapter.end); a piece of a run shorter than
 * `minClipS` left by the cut is dropped (chapter marks fall a fraction of a
 * second off the per-second grid). A music or narration run that the cut
 * leaves with less than `edgeTrimS` inside is dropped too: it belongs to the
 * piece in the neighbouring chapter. Returns:
 *
 * - `performances`: maximal stretches of music/narration whose internal gaps
 *   are each shorter than `gapMergeS`. Speech ends a performance. Two or more
 *   mean a medley, a story with songs in it, or interwoven songs; they are
 *   NOT merged, because that is for whoever reads the evidence to decide.
 * - `speech`: speech runs, `position` 'before' the first performance,
 *   'between' two, or 'after' the last (usually the introduction to the NEXT
 *   chapter's piece). In a chapter with no performance, all are 'before'.
 * - `gaps`: gap runs of at least `gapMergeS`, usually applause.
 * - `music`: [first performance start, last performance end], or null.
 */
export function refineChapter(chapter, runs, { gapMergeS = 15, minClipS = 2, edgeTrimS = EDGE_TRIM_S } = {}) {
  const clipped = runs
    .map((r) => ({
      label: r.label,
      start: Math.max(r.start, chapter.start),
      end: Math.min(r.end, chapter.end),
      cut: r.start < chapter.start || r.end > chapter.end,
    }))
    .filter((r) => span(r) >= minClipS && !(r.cut && isMusic(r) && span(r) < edgeTrimS))
    .map(({ cut, ...r }) => r);

  const performances = [];
  let cur = null;
  let gapBefore = null;
  const close = () => {
    if (!cur) return;
    const sound = cur.runs.filter(isMusic);
    const total = sound.reduce((a, r) => a + span(r), 0);
    const narr = sound.filter((r) => r.label === 'narration').reduce((a, r) => a + span(r), 0);
    performances.push({ start: cur.start, end: cur.end, narrationShare: total ? Number((narr / total).toFixed(3)) : 0 });
    cur = null;
  };
  for (const r of clipped) {
    if (isMusic(r)) {
      if (cur && gapBefore && span(gapBefore) >= gapMergeS) close();
      if (!cur) cur = { start: r.start, end: r.end, runs: [] };
      cur.runs.push(r);
      cur.end = r.end;
      gapBefore = null;
    } else if (r.label === 'gap') {
      gapBefore = r;
    } else {
      close();
      gapBefore = null;
    }
  }
  close();

  const first = performances[0];
  const last = performances[performances.length - 1];
  const position = (r) => {
    if (!first || r.end <= first.start) return 'before';
    return r.start >= last.end ? 'after' : 'between';
  };
  return {
    performances,
    speech: clipped.filter((r) => r.label === 'speech').map((r) => ({ start: r.start, end: r.end, position: position(r) })),
    gaps: clipped.filter((r) => r.label === 'gap' && span(r) >= gapMergeS).map((r) => ({ start: r.start, end: r.end })),
    music: first ? [first.start, last.end] : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Evidence                                                                   */
/* -------------------------------------------------------------------------- */

/** Subtitle text whose cue midpoint falls in [start, end). */
function textIn(cues, start, end) {
  return cues
    .filter((c) => { const mid = (c.start + c.end) / 2; return mid >= start && mid < end; })
    .map((c) => c.text)
    .join(' ');
}

/**
 * Refine every chapter against the per-second class scores and attach the
 * subtitle text inside each performance and each speech run.
 *
 * @param {object} o
 * @param {Array} o.chapters anything chapterList accepts
 * @param {Record<string, number[]>} o.classes per-second scores by AudioSet class
 * @param {number} [o.seconds] length of the scores (defaults to the longest series)
 * @param {Array<{start:number,end:number,text:string}>} [o.cues] subtitle cues
 */
export function chapterEvidence({ chapters, classes, seconds, cues = [] }) {
  const labels = labelSeconds(classes);
  const runs = runsFrom(labels);
  return {
    seconds: seconds ?? labels.length,
    chapters: chapterList(chapters).map((c) => {
      const r = refineChapter(c, runs);
      return {
        index: c.index,
        title: c.title ?? null,
        start: c.start,
        end: c.end,
        music: r.music,
        performances: r.performances.map((p) => ({ ...p, text: textIn(cues, p.start, p.end) })),
        speech: r.speech.map((p) => ({ ...p, text: textIn(cues, p.start, p.end) })),
        gaps: r.gaps,
      };
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                   */
/* -------------------------------------------------------------------------- */

const STOP = new Set(('a an and the of to in on is it for with be we you i he she they '
  + 'our his her my me us oh o this that all are as at by from not but so ye thy thee').split(' '));

/** Content words: lowercased, accents and apostrophes (straight or curly) gone, 3+ letters, no stop words. */
export function words(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2018\u2019]/g, '')
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

/* -------------------------------------------------------------------------- */
/* CLI shell: all the I/O, so everything above stays unit-testable            */
/* -------------------------------------------------------------------------- */

/** `--name value` as a number; `fallback` when the flag is absent; an error naming the flag otherwise. */
export function numberFlag(name, value, fallback) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (String(value).trim() === '' || !Number.isFinite(n)) throw new Error(`--${name} must be a number, got "${value}"`);
  return n;
}

/** "120, 305.5" -> [120, 305.5]. An empty or non-numeric entry is an error, never a silent 0. */
export function parseAt(value) {
  return String(value).split(',').map((raw, k) => {
    const s = raw.trim();
    const n = Number(s);
    if (s === '' || !Number.isFinite(n)) throw new Error(`--at entry ${k + 1} is not a number: "${raw}"`);
    return n;
  });
}

/**
 * A 360p clip centred on `at`. The seek stays fractional so the boundary is
 * centred, and the name carries a tenth of a second so two close boundaries
 * do not overwrite each other's clip.
 */
export function clipArgs(media, at, pad, outDir) {
  const name = `clip-${at.toFixed(1).padStart(6, '0')}.mp4`;
  const ss = Number(Math.max(0, at - pad).toFixed(3));
  return [
    '-v', 'error', '-y', '-ss', String(ss), '-i', media, '-t', String(pad * 2),
    '-vf', 'scale=-2:360', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
    '-c:a', 'aac', '-b:a', '128k', path.join(outDir, name),
  ];
}

/** The sound-event script beside this module (PEP 723 header, so `uv run --script` installs its deps). */
const AUDIO_EVENTS_PY = fileURLToPath(new URL('./audio-events.py', import.meta.url));

/**
 * How `classify` runs the sound-event script: `uv run --script` by default,
 * or `<python> <script>` when an interpreter that already has its
 * dependencies is given.
 */
export function classifyArgs({ script, media, outDir, python }) {
  const out = path.join(outDir, 'events.json');
  return python
    ? { cmd: python, args: [script, media, out] }
    : { cmd: 'uv', args: ['run', '--script', script, media, out] };
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}: ${String(r.stderr).slice(-800)}`);
  return r;
}

const USAGE = `concert-index: where the music and the talk are inside a concert video

  chapters <media> [--out chapters.json]
      List the file's native chapter markers as [{index, start, end, title}].
  classify <media> --out <dir> [--python <bin>]
      Score every second for music, speech, applause and the like (PANNs);
      write <dir>/events.json. Runs audio-events.py with uv, or with <bin>.
  evidence --chapters <chapters.json> --classified <dir> [--srt <file>] [--out evidence.json]
      Inside each chapter: the music span, its performances, speech runs
      (before/between/after the music) and long gaps, with subtitle text.
      --chapters takes the chapters output or any [{title, start, end}] list.
  clips <media> --at 120,305.5 [--pad 6] --out <dir>
      Cut a 360p review clip centred on each boundary.`;

/** Run one subcommand. Errors print as one message with a --help hint and set exit code 1. */
export async function runCliEntry(argv = process.argv.slice(2)) {
  try {
    await dispatch(argv);
  } catch (err) {
    console.error(`concert-index: ${err.message}\nRun with --help for usage.`);
    process.exitCode = 1;
  }
}

async function dispatch(argv) {
  const { values: f, positionals: [cmd, media] } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string' }, at: { type: 'string' }, pad: { type: 'string' }, python: { type: 'string' },
      chapters: { type: 'string' }, classified: { type: 'string' }, srt: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const emit = (obj) => {
    const text = `${JSON.stringify(obj, null, 2)}\n`;
    if (f.out) writeFileSync(f.out, text);
    else process.stdout.write(text);
  };

  if (f.help || !cmd) { console.log(USAGE); return; }

  if (cmd === 'chapters') {
    if (!media) throw new Error('chapters needs <media>');
    emit(parseChapters(run('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', media]).stdout));
    return;
  }

  if (cmd === 'classify') {
    if (!media || !f.out) throw new Error('classify needs <media> and --out');
    mkdirSync(f.out, { recursive: true });
    const { cmd: bin, args } = classifyArgs({ script: AUDIO_EVENTS_PY, media, outDir: f.out, python: f.python });
    const r = spawnSync(bin, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`${bin} exited ${r.status} running audio-events.py`);
    console.log(`classified ${media} -> ${path.join(f.out, 'events.json')}`);
    return;
  }

  if (cmd === 'evidence') {
    if (!f.chapters || !f.classified) throw new Error('evidence needs --chapters and --classified');
    const events = JSON.parse(readFileSync(path.join(f.classified, 'events.json'), 'utf8'));
    if (!events.classes) throw new Error(`${path.join(f.classified, 'events.json')} has no "classes"; run classify`);
    emit(chapterEvidence({
      chapters: JSON.parse(readFileSync(f.chapters, 'utf8')),
      classes: events.classes,
      seconds: events.seconds,
      cues: f.srt ? parseSrt(readFileSync(f.srt, 'utf8')) : [],
    }));
    return;
  }

  if (cmd === 'clips') {
    if (!media || !f.at || !f.out) throw new Error('clips needs <media>, --at and --out');
    const ats = parseAt(f.at);
    const pad = numberFlag('pad', f.pad, 6);
    mkdirSync(f.out, { recursive: true });
    for (const at of ats) run('ffmpeg', clipArgs(media, at, pad, f.out));
    console.log(`clips -> ${f.out}`);
    return;
  }

  throw new Error(`unknown subcommand: ${cmd}\n\n${USAGE}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) { await runCliEntry(); }
