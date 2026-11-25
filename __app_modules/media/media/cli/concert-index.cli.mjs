#!/usr/bin/env node

/**
 * Concert index CLI: where the music and the talk are inside a concert video.
 *
 * A televised concert is a run of songs, readings and introductions with
 * applause between them. This tool reads the audio and subtitles for evidence
 * of that structure. It does NOT write a sidecar: the evidence is for a
 * person or agent to judge.
 *
 * Subcommands: clips. Run with --help.
 *
 * @module cli/concert-index
 */

import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}: ${String(r.stderr).slice(-800)}`);
  return r;
}

const USAGE = `concert-index: where the music and the talk are inside a concert video

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
      out: { type: 'string' }, at: { type: 'string' }, pad: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (f.help || !cmd) { console.log(USAGE); return; }

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
