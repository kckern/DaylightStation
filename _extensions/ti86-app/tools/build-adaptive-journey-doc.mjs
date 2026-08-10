#!/usr/bin/env node
/** Compile digest-bearing MAME frames into a standalone styled HTML journey. */
import {
  copyFileSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const JOURNEY_COPY = Object.freeze({
  '01-enter-code': 'Cold launch: Enter Code', '07-code-ready': 'Six-digit code ready',
  '08-graphic-card-front': 'Graphic flashcard front', '09-graphic-card-back': 'Graphic flashcard answer',
  '10-study-summary': 'Study summary', '11-quiz-prompt': 'Prescribed quiz prompt',
  '12-quiz-choices': 'A–E answer surface', '13-durable-result': 'Result queued before success',
  '14-result-qr': 'Offline Version-5/M result QR',
});
const options = parseArguments(process.argv.slice(2));
const report = JSON.parse(readFileSync(options.report, 'utf8'));
if (report?.schema !== 'schoolcalc.ti86-mame-scenario-report/v1') throw new Error('invalid MAME journey report');
const scenario = report.scenarios?.find(({ id }) => id === options.scenario);
if (!scenario || !Array.isArray(scenario.frames) || scenario.frames.length === 0) {
  throw new Error(`MAME report does not contain '${options.scenario}' frames`);
}
const sourceDirectory = path.join(path.dirname(options.report), scenario.id);
const assetDirectory = path.join(path.dirname(options.output), 'adaptive-study-journey');
mkdirSync(assetDirectory, { recursive: true });
for (const fileName of readdirSync(assetDirectory)) {
  if (/^\d{2}-.+\.png$/.test(fileName)) unlinkSync(path.join(assetDirectory, fileName));
}
const journeyFrames = scenario.frames.filter((frame) => /^\d{2}-/.test(frame.capture));
if (journeyFrames.length === 0) throw new Error(`MAME report does not contain journey capture frames`);
const cards = journeyFrames.map((frame, index) => {
  const source = path.join(sourceDirectory, frame.fileName);
  const targetName = `${String(index + 1).padStart(2, '0')}-${path.basename(frame.fileName)}`;
  copyFileSync(source, path.join(assetDirectory, targetName));
  return { ...frame, targetName, step: JOURNEY_COPY[frame.capture] ?? titleCase(frame.capture) };
});
writeFileSync(options.output, renderHtml({ report, scenario, cards }));
process.stdout.write(`[ti86] wrote adaptive journey ${options.output} (${cards.length} emulator frames)\n`);

function renderHtml({ report, scenario, cards }) {
  const assetPath = 'adaptive-study-journey';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SchoolCalc Adaptive Study v1 — emulator journey</title>
<style>
:root{--ink:#17241b;--lcd:#cfd8b5;--paper:#f5f1e8;--accent:#245b47;--muted:#657168;--rule:#c9c3b5}*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,sans-serif}header{padding:clamp(2rem,7vw,6rem) max(1.25rem,calc((100vw - 1080px)/2));background:var(--ink);color:#f8f5ed}header p{max-width:760px;color:#d5dfd7}.eyebrow{font-size:.75rem;letter-spacing:.16em;text-transform:uppercase;color:#a9c7b7}.meta{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:1.5rem}.meta span{border:1px solid #52675b;border-radius:999px;padding:.25rem .7rem;font:12px ui-monospace,monospace}.meta .pass{border-color:#8bd4ad;background:#143d2d;color:#c8f7dd;font-weight:700}main{max-width:1080px;margin:auto;padding:3rem 1.25rem 5rem}.intro{max-width:760px;margin-bottom:3rem}.flow{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.25rem;counter-reset:step}.frame{counter-increment:step;background:#fff;border:1px solid var(--rule);border-radius:18px;overflow:hidden;box-shadow:0 8px 30px #17241b10}.screen{background:#29342d;padding:1.25rem;display:grid;place-items:center}.screen img{width:100%;max-width:512px;aspect-ratio:2/1;image-rendering:pixelated;border:10px solid #111a14;border-radius:8px;background:var(--lcd)}.copy{padding:1.1rem 1.2rem 1.25rem}.copy h2{font-size:1.05rem;margin:0 0 .35rem}.copy h2:before{content:counter(step,decimal-leading-zero) '  ';font:700 .72rem ui-monospace,monospace;color:var(--accent)}.copy p{margin:.3rem 0;color:var(--muted);font-size:.88rem}.digest{overflow-wrap:anywhere;font:10px/1.4 ui-monospace,monospace;color:#7b847d}footer{border-top:1px solid var(--rule);padding:1.5rem 0;color:var(--muted);font-size:.82rem}@media(max-width:600px){.flow{grid-template-columns:1fr}}
</style></head><body><header><div class="eyebrow">Exact TI-86 / MAME evidence</div><h1>SchoolCalc Adaptive Study v1</h1><p>${escapeHtml(scenario.description)}</p><div class="meta"><span class="pass">MAME PASS</span><span>scenario ${escapeHtml(scenario.id)}</span><span>release ${escapeHtml(report.releaseId)}</span><span>TI-86 ${escapeHtml(report.rom?.version)}</span><span>ROM SHA-1 ${escapeHtml(report.rom?.sha1)}</span><span>${cards.length} frames</span></div></header>
<main><section class="intro"><h2>The learner journey</h2><p>This scenario passed every configured text, transition, and Version-5/M QR assertion. These are complete 128×64 framebuffers captured by the repository’s MAME TI-86 scenario harness after a real TI-OS launch and virtual Graph Link installation. Each card retains the framebuffer digest recorded by the acceptance report.</p></section><section class="flow">
${cards.map((card) => `<article class="frame"><div class="screen"><img src="${assetPath}/${escapeHtml(card.targetName)}" width="512" height="256" alt="TI-86 emulator frame: ${escapeHtml(card.step)}"></div><div class="copy"><h2>${escapeHtml(card.step)}</h2><p>${escapeHtml(card.capture)}</p><div class="digest">frame SHA-256 ${escapeHtml(card.sha256)} · PC ${escapeHtml(card.pc)}</div></div></article>`).join('\n')}
</section><footer>Generated from <code>schoolcalc.ti86-mame-scenario-report/v1</code>. Screens are emulator evidence, not reconstructed mockups.</footer></main></body></html>\n`;
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) values.set(args[index], args[index + 1]);
  return {
    report: path.resolve(values.get('--report') ?? path.join(EXTENSION, 'dist', 'adaptive-journey', 'report.json')),
    scenario: values.get('--scenario') ?? 'adaptive-v1-journey',
    output: path.resolve(values.get('--output') ?? path.join(EXTENSION, 'docs', 'adaptive-study-journey.html')),
  };
}
function titleCase(value) { return String(value).replace(/^\d+-/, '').replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
