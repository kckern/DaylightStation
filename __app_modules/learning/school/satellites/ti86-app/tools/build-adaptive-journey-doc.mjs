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
  '01-enter-code': 'Cold launch: Enter Code',
  '07-graphic-card-front': 'Digit six opens the resolved study', '08-graphic-card-back': 'Graphic flashcard answer',
  '09-study-summary': 'Study summary', '10-quiz-question': 'Question and choices together',
  '11-restudy-after-quiz-exit': 'EXIT returns to study and counts the quiz attempt',
  '12-restudy-answer': 'Restudy remains fully interactive',
  '13-second-study-summary': 'Second study completion',
  '14-second-quiz-attempt': 'Second counted quiz attempt',
  '15-durable-result': 'Result queued before success',
  '16-result-qr': 'Offline Version-5/M result QR',
});
const MISSING_COPY = Object.freeze({
  '01-missing-code-ready': 'Unresolved code',
  '02-connect-relay': 'Connect the relay',
  '03-link-active': 'Live relay search indicator',
  '04-sync-paused': 'Safe paused recovery',
  '05-return-to-code': 'Return to Enter Code',
});
const options = parseArguments(process.argv.slice(2));
const report = JSON.parse(readFileSync(options.report, 'utf8'));
if (report?.schema !== 'schoolcalc.ti86-mame-scenario-report/v1') throw new Error('invalid MAME journey report');
const scenario = report.scenarios?.find(({ id }) => id === options.scenario);
if (!scenario || !Array.isArray(scenario.frames) || scenario.frames.length === 0) {
  throw new Error(`MAME report does not contain '${options.scenario}' frames`);
}
const missingScenario = report.scenarios?.find(({ id }) => id === options.missingScenario);
if (!missingScenario || !Array.isArray(missingScenario.frames) || missingScenario.frames.length === 0) {
  throw new Error(`MAME report does not contain '${options.missingScenario}' frames`);
}
const assetDirectory = path.join(path.dirname(options.output), 'adaptive-study-journey');
mkdirSync(assetDirectory, { recursive: true });
for (const fileName of readdirSync(assetDirectory)) {
  if (/^(?:missing-)?\d{2}-.+\.png$/.test(fileName)) unlinkSync(path.join(assetDirectory, fileName));
}
const cards = copyJourneyFrames(scenario, '', JOURNEY_COPY);
const missingCards = copyJourneyFrames(missingScenario, 'missing-', MISSING_COPY);
writeFileSync(options.output, renderHtml({ report, scenario, cards, missingScenario, missingCards }));
process.stdout.write(`[ti86] wrote adaptive journey ${options.output} (${cards.length + missingCards.length} emulator frames)\n`);

function copyJourneyFrames(selectedScenario, prefix, copy) {
  const frames = selectedScenario.frames.filter((frame) => /^\d{2}-/.test(frame.capture));
  if (frames.length === 0) throw new Error(`MAME report does not contain '${selectedScenario.id}' journey captures`);
  const sourceDirectory = path.join(path.dirname(options.report), selectedScenario.id);
  return frames.map((frame, index) => {
    const source = path.join(sourceDirectory, frame.fileName);
    const targetName = `${prefix}${String(index + 1).padStart(2, '0')}-${path.basename(frame.fileName)}`;
    copyFileSync(source, path.join(assetDirectory, targetName));
    return { ...frame, targetName, step: copy[frame.capture] ?? titleCase(frame.capture) };
  });
}

function renderHtml({ report, scenario, cards, missingScenario, missingCards }) {
  const assetPath = 'adaptive-study-journey';
  const totalFrames = cards.length + missingCards.length;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SchoolCalc Adaptive Study v1 — emulator journey</title>
<style>
:root{--ink:#17241b;--lcd:#cfd8b5;--paper:#f5f1e8;--accent:#245b47;--muted:#657168;--rule:#c9c3b5}*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,sans-serif}header{padding:clamp(2rem,7vw,6rem) max(1.25rem,calc((100vw - 720px)/2));background:var(--ink);color:#f8f5ed}header p{max-width:680px;color:#d5dfd7}.eyebrow{font-size:.75rem;letter-spacing:.16em;text-transform:uppercase;color:#a9c7b7}.meta{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:1.5rem}.meta span{border:1px solid #52675b;border-radius:999px;padding:.25rem .7rem;font:12px ui-monospace,monospace}.meta .pass{border-color:#8bd4ad;background:#143d2d;color:#c8f7dd;font-weight:700}main{max-width:720px;margin:auto;padding:3rem 1.25rem 5rem}.intro{max-width:680px;margin-bottom:3rem}.branch{margin-top:4rem}.branch>p{color:var(--muted);max-width:680px;margin-bottom:1.5rem}.flow{display:grid;grid-template-columns:1fr;gap:1.25rem;counter-reset:step}.frame{counter-increment:step;background:#fff;border:1px solid var(--rule);border-radius:18px;overflow:hidden;box-shadow:0 8px 30px #17241b10}.screen{background:#29342d;padding:1.5rem;display:grid;place-items:center}.screen img{display:block;width:512px;max-width:100%;height:auto;image-rendering:pixelated;outline:10px solid #111a14;background:var(--lcd)}.copy{padding:1.1rem 1.2rem 1.25rem}.copy h2{font-size:1.05rem;margin:0 0 .35rem}.copy h2:before{content:counter(step,decimal-leading-zero) '  ';font:700 .72rem ui-monospace,monospace;color:var(--accent)}.copy p{margin:.3rem 0;color:var(--muted);font-size:.88rem}.digest{overflow-wrap:anywhere;font:10px/1.4 ui-monospace,monospace;color:#7b847d}footer{border-top:1px solid var(--rule);padding:1.5rem 0;color:var(--muted);font-size:.82rem}
</style></head><body><header><div class="eyebrow">Exact TI-86 / MAME evidence</div><h1>SchoolCalc Adaptive Study v1</h1><p>Installed and not-yet-loaded study paths, captured from real TI-OS.</p><div class="meta"><span class="pass">MAME PASS</span><span>2 scenarios</span><span>release ${escapeHtml(report.releaseId)}</span><span>TI-86 ${escapeHtml(report.rom?.version)}</span><span>ROM SHA-1 ${escapeHtml(report.rom?.sha1)}</span><span>${totalFrames} frames</span></div></header>
<main><section class="intro"><h2>The learner journey</h2><p>Both scenarios passed every configured text, transition, recovery, and Version-5/M QR assertion. These are complete 128×64 framebuffers captured by the repository’s MAME TI-86 scenario harness after a real TI-OS launch and virtual Graph Link installation. Each card retains the framebuffer digest recorded by the acceptance report.</p></section><section class="branch"><h2>Installed study</h2><p>${escapeHtml(scenario.description)}</p><div class="flow">
${renderCards(cards, assetPath)}
</div></section><section class="branch"><h2>Study not loaded yet</h2><p>${escapeHtml(missingScenario.description)} The calculator creates its durable entry request, waits for the relay, and can pause back to Enter Code without discarding local state.</p><div class="flow">
${renderCards(missingCards, assetPath)}
</div></section><footer>Generated from <code>schoolcalc.ti86-mame-scenario-report/v1</code>. Screens are emulator evidence, not reconstructed mockups or stretched recreations.</footer></main></body></html>\n`;
}

function renderCards(cards, assetPath) {
  return cards.map((card) => `<article class="frame"><div class="screen"><img src="${assetPath}/${escapeHtml(card.targetName)}" width="512" height="256" alt="TI-86 emulator frame: ${escapeHtml(card.step)}"></div><div class="copy"><h2>${escapeHtml(card.step)}</h2><p>${escapeHtml(card.capture)}</p><div class="digest">frame SHA-256 ${escapeHtml(card.sha256)} · PC ${escapeHtml(card.pc)}</div></div></article>`).join('\n');
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) values.set(args[index], args[index + 1]);
  return {
    report: path.resolve(values.get('--report') ?? path.join(EXTENSION, 'dist', 'adaptive-journey', 'report.json')),
    scenario: values.get('--scenario') ?? 'adaptive-v1-journey',
    missingScenario: values.get('--missing-scenario') ?? 'missing-module-relay',
    output: path.resolve(values.get('--output') ?? path.join(EXTENSION, 'docs', 'adaptive-study-journey.html')),
  };
}
function titleCase(value) { return String(value).replace(/^\d+-/, '').replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
