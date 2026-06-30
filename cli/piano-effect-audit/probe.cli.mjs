#!/usr/bin/env node
// probe.cli.mjs — analyze an effect-PROBE run: which reverb/chorus command works?
//
// Usage: node cli/piano-effect-audit/probe.cli.mjs <runId>
//
// Each candidate has a `<id>-dry` and `<id>-wet` clip (same note). A candidate
// WORKS if its wet clip has a louder/longer post-strike tail than its dry clip —
// that message sequence is the one the MDG-400 actually honors for reverb/chorus.

import { execSync } from 'child_process';
import { findPeak, windowDb, decayTimeMs } from './metrics.mjs';

const CONTAINER = 'daylight-station';
const APP = '/usr/src/app';
const SR = 48000;
const TAIL_FROM_MS = 400;
const TAIL_TO_MS = 1400;
const WORKS_TAIL_DB = 3;    // wet tail must beat dry by >=3 dB
const WORKS_DECAY_MS = 150; // ...or ring >=150 ms longer

const runId = process.argv[2];
if (!runId) { console.error('usage: probe.cli.mjs <runId>'); process.exit(1); }
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) { console.error('bad runId'); process.exit(1); }

const runRel = `media/logs/piano/effect-probe/${runId}`;
const altRel = `media/logs/piano/effect-audit/${runId}`; // uploads land under effect-audit/

function exec(cmd) { return execSync(cmd, { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }); }
function execBin(cmd) { return execSync(cmd, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }); }
function inContainer(shCmd) { return exec(`sudo docker exec ${CONTAINER} sh -c ${JSON.stringify(shCmd)}`); }
function round(x) { return x == null ? 0 : Math.round(x * 10) / 10; }

// Uploads use the shared /effect-audit/:runId endpoint, so clips live there.
const rel = altRel;
const manifest = JSON.parse(inContainer(`cat ${APP}/${rel}/manifest.json`));

function decode(label) {
  const buf = execBin(`sudo docker exec ${CONTAINER} ffmpeg -v error -i ${APP}/${rel}/${label}.webm -ac 1 -ar ${SR} -f f32le -`);
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
}

function measure(label) {
  const s = decode(label);
  const peak = findPeak(s, SR);
  const p = peak.peakAtMs;
  return {
    peakDb: round(peak.peakDb),
    tailDb: round(windowDb(s, SR, p + TAIL_FROM_MS, p + TAIL_TO_MS)),
    decayMs: round(decayTimeMs(s, SR, Math.max(0, p - 50), 20) ?? 0),
  };
}

// Group clips by candidate+phase, averaging reps. A note that didn't sound shows
// as a deep-silence tail (<-120 dB); drop those reps as failed captures so one
// dropped BLE note can't fake a huge Δ.
const VALID_PEAK_DB = -45; // a real struck note peaks well above this
const byCand = new Map();
for (const c of manifest.clips) {
  const m = measure(c.label);
  const key = c.candidate;
  const rec = byCand.get(key) || { id: key, kind: c.kind, dry: [], wet: [] };
  if (m.peakDb >= VALID_PEAK_DB) rec[c.phase].push(m); // keep only clips where the note sounded
  byCand.set(key, rec);
}
const mean = (arr, f) => (arr.length ? arr.reduce((a, x) => a + f(x), 0) / arr.length : NaN);

const rows = [];
for (const [, m] of byCand) {
  const nDry = m.dry.length; const nWet = m.wet.length;
  if (!nDry || !nWet) { console.log(`${m.id.padEnd(20)} ${m.kind.padEnd(7)} SKIP (valid dry=${nDry} wet=${nWet})`); continue; }
  const dryTail = round(mean(m.dry, (x) => x.tailDb));
  const wetTail = round(mean(m.wet, (x) => x.tailDb));
  const dryDecay = round(mean(m.dry, (x) => x.decayMs));
  const wetDecay = round(mean(m.wet, (x) => x.decayMs));
  const dTail = round(wetTail - dryTail);
  const dDecay = round(wetDecay - dryDecay);
  const works = dTail >= WORKS_TAIL_DB || dDecay >= WORKS_DECAY_MS;
  rows.push({ id: m.id, kind: m.kind, dTail, dDecay, dryTail, wetTail, dryDecay, wetDecay, nDry, nWet, works });
  console.log(`${m.id.padEnd(20)} ${m.kind.padEnd(7)} dry=${dryTail}dB(${nDry}) wet=${wetTail}dB(${nWet})  Δtail=${dTail}dB  Δdecay=${dDecay}ms  ${works ? '*** WORKS ***' : ''}`);
}

rows.sort((a, b) => (b.dTail + b.dDecay / 50) - (a.dTail + a.dDecay / 50));
const winners = rows.filter((r) => r.works);

const md = [
  `# Piano Effect Probe — ${runId}`,
  '',
  `SysEx access: ${manifest.sysex ? 'GRANTED' : 'DENIED'}${manifest.skipped?.length ? ` · skipped (no sysex): ${manifest.skipped.join(', ')}` : ''}`,
  `Candidates with a dry+wet pair: ${rows.length}`,
  '',
  '## Result',
  '',
  winners.length
    ? winners.map((w) => `- **${w.id}** (${w.kind}) WORKS — wet tail +${w.dTail} dB, decay +${w.dDecay} ms over dry.`).join('\n')
    : '- No candidate produced a measurable reverb/chorus tail. None of the tested commands are honored (or the engine applies effects only to a non-speaker output).',
  '',
  '## All candidates (ranked by wet−dry tail gain)',
  '',
  '| candidate | kind | Δtail dB | Δdecay ms | dry→wet tail | works |',
  '|-----------|------|----------|-----------|--------------|-------|',
  ...rows.map((r) => `| ${r.id} | ${r.kind} | ${r.dTail} | ${r.dDecay} | ${r.dryTail}→${r.wetTail} | ${r.works ? 'YES' : 'no'} |`),
  '',
].join('\n');

const b64 = Buffer.from(md).toString('base64');
inContainer(`mkdir -p ${APP}/${rel}/report && printf '%s' '${b64}' | base64 -d > ${APP}/${rel}/report/probe.md`);
console.log('\n' + md);
console.log(`\nReport: ${rel}/report/probe.md`);
