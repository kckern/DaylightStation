#!/usr/bin/env node
// analyze.cli.mjs — offline analysis of an effect-audit run.
//
// Usage: node cli/piano-effect-audit/analyze.cli.mjs <runId>
//
// Reads media/logs/piano/effect-audit/<runId>/{manifest.json,*.webm} from inside
// the daylight-station container, decodes each clip with ffmpeg, computes
// reverb/chorus/timbre metrics, and writes report/verdict.md + report/metrics.json.

import { execSync } from 'child_process';
import { rms, tailEnergyDb, decayTimeMs } from './metrics.mjs';
import { verdict } from './verdict.mjs';

const CONTAINER = 'daylight-station';
const APP = '/usr/src/app';
const SR = 48000;

const runId = process.argv[2];
if (!runId) { console.error('usage: analyze.cli.mjs <runId>'); process.exit(1); }
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) { console.error('bad runId'); process.exit(1); }

const runRel = `media/logs/piano/effect-audit/${runId}`;

function exec(cmd) { return execSync(cmd, { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }); }
function execBin(cmd) { return execSync(cmd, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }); }
function inContainer(shCmd) { return exec(`sudo docker exec ${CONTAINER} sh -c ${JSON.stringify(shCmd)}`); }

// 1. Read manifest.
const manifest = JSON.parse(inContainer(`cat ${APP}/${runRel}/manifest.json`));
const noteOffMs = manifest.stimulus?.noteOffAtMs ?? 400;
const measureFromMs = noteOffMs + 30; // start tail measurement just after release

// 2. Decode a clip to Float32Array via ffmpeg (stdout f32le).
function decode(label) {
  const buf = execBin(
    `sudo docker exec ${CONTAINER} ffmpeg -v error -i ${APP}/${runRel}/${label}.webm -ac 1 -ar ${SR} -f f32le -`,
  );
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
}

// 3. Spectral centroid + spread over the sustain (note_on..note_off), via ffmpeg.
function spectral(label) {
  // aspectralstats prints per-frame metadata; average centroid + spread.
  let out = '';
  try {
    out = inContainer(
      `ffmpeg -v error -i ${APP}/${runRel}/${label}.webm -af aspectralstats=measure=centroid+spread,ametadata=print:file=- -f null - 2>&1`,
    );
  } catch (e) { out = ''; }
  const grab = (key) => {
    const vals = [...out.matchAll(new RegExp(`aspectralstats\\.[0-9]+\\.${key}=([0-9.]+)`, 'g'))].map((mm) => Number(mm[1]));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };
  return { centroid: grab('centroid'), spread: grab('spread') };
}

// 4. Per-clip metrics.
const clips = [];
for (const c of manifest.clips) {
  const samples = decode(c.label);
  const sp = spectral(c.label);
  const metrics = {
    tailDb: round(tailEnergyDb(samples, SR, measureFromMs)),
    decayMs: round(decayTimeMs(samples, SR, measureFromMs, 20) ?? 0),
    centroid: round(sp.centroid),
    spread: round(sp.spread),
    onsetDb: round(20 * Math.log10(rms(samples, Math.floor((manifest.stimulus.noteOnAtMs / 1000) * SR), Math.floor(((manifest.stimulus.noteOnAtMs + 200) / 1000) * SR)) + 1e-9)),
  };
  clips.push({ label: c.label, group: c.group, metrics });
  console.log(`${c.label.padEnd(34)} tail=${metrics.tailDb}dB decay=${metrics.decayMs}ms centroid=${metrics.centroid}Hz spread=${metrics.spread}Hz`);
}

// 5. Verdict + report.
const v = verdict(clips);
const md = renderMarkdown(runId, manifest, clips, v);
const metricsJson = JSON.stringify({ runId, clips, verdict: v }, null, 2);

// Write report files into the run folder (inside container; node user owns it).
writeInContainer(`${runRel}/report/metrics.json`, metricsJson);
writeInContainer(`${runRel}/report/verdict.md`, md);

console.log('\n' + md);
console.log(`\nReport written to ${runRel}/report/`);

function round(x) { return x == null ? 0 : Math.round(x * 10) / 10; }

function writeInContainer(rel, content) {
  const b64 = Buffer.from(content).toString('base64');
  inContainer(`mkdir -p ${APP}/${rel.split('/').slice(0, -1).join('/')} && printf '%s' '${b64}' | base64 -d > ${APP}/${rel}`);
}

function renderMarkdown(rid, man, cs, vv) {
  const row = (c) => `| ${c.label} | ${c.group} | ${c.metrics.tailDb} | ${c.metrics.decayMs} | ${c.metrics.centroid} | ${c.metrics.spread} |`;
  return [
    `# Piano Effect Audit — ${rid}`,
    '',
    `Device: ${man.device}  ·  clips: ${cs.length}  ·  note-off at ${man.stimulus.noteOffAtMs}ms`,
    '',
    '## Verdict',
    '',
    `- **Reverb on/off:** ${vv.reverbOnOff.effective ? 'EFFECTIVE' : 'IGNORED'} (Δtail ${vv.reverbOnOff.deltaDb} dB)`,
    `- **Reverb depth (CC 91):** ${vv.reverbDepth.effective ? 'EFFECTIVE' : 'IGNORED'} (Δtail ${vv.reverbDepth.deltaDb} dB)`,
    `- **Reverb type (CC 80):** ${vv.reverbType.effective ? 'EFFECTIVE' : 'IGNORED'} (decay spread ${vv.reverbType.spreadMs} ms)`,
    `- **Chorus (CC 93):** ${vv.chorus.effective ? 'EFFECTIVE' : 'IGNORED'} (Δtail ${vv.chorus.deltaDb} dB, Δspread ${vv.chorus.spreadHz} Hz)`,
    `- **Instrument control (rig check):** ${vv.instrument.detectable ? 'DETECTABLE' : 'NOT DETECTABLE'} (centroid spread ${vv.instrument.centroidSpreadHz} Hz)`,
    '',
    '## Recommendations',
    '',
    ...vv.recommendations.map((r) => `- ${r}`),
    '',
    '## Per-clip metrics',
    '',
    '| clip | group | tailDb | decayMs | centroidHz | spreadHz |',
    '|------|-------|--------|---------|-----------|----------|',
    ...cs.map(row),
    '',
  ].join('\n');
}
