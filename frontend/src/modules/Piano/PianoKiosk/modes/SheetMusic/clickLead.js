// clickLead.js — how many ms EARLY an anchored metronome click is played, so the
// beat the child hears lands on the grading clock's beat.
//
// Precedence:
//   1. config  — `timing.clickLeadMs` (per-piano `pianos.{id}.timing.clickLeadMs`
//                over shared, resolved by resolvePianoConfig). Written by the
//                grown-up tap-along calibration; it holds whatever latency the
//                browser does NOT know about (Bluetooth A2DP, MIDI input lag).
//   2. browser — (outputLatency + baseLatency) × 1000, when > 0 — but ONLY for a
//                context without getOutputTimestamp(). When that method exists
//                the scheduler's epoch → audio mapping already reads the output
//                clock (clickScheduler.js epochToContextMap), so the browser's
//                latency is already applied and adding it again would play the
//                click early by twice that amount.
//   3. none    — 0.
//
// A calibration measured with leadMs 0 through the same mapping yields exactly
// the residual the config value should hold, whichever mapping the device uses.

import getLogger from '../../../../../lib/logging/Logger.js';

const toMs = (seconds) => (Number.isFinite(Number(seconds)) && Number(seconds) > 0 ? Number(seconds) * 1000 : 0);
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * @param {object|null} pianoConfig resolved piano config (resolvePianoConfig)
 * @param {AudioContext|null} audioContext
 * @returns {{ leadMs: number, source: 'config'|'browser'|'none', outputLatencyMs: number|null, baseLatencyMs: number|null }}
 */
export function resolveClickLead(pianoConfig, audioContext) {
  const outputLatencyMs = audioContext && 'outputLatency' in audioContext ? round1(toMs(audioContext.outputLatency)) : null;
  const baseLatencyMs = audioContext && 'baseLatency' in audioContext ? round1(toMs(audioContext.baseLatency)) : null;
  const measured = { outputLatencyMs, baseLatencyMs };

  const configured = pianoConfig?.timing?.clickLeadMs;
  if (configured !== null && configured !== undefined && configured !== '' && Number.isFinite(Number(configured))) {
    return { leadMs: Number(configured), source: 'config', ...measured };
  }

  const outputTimestampApplies = typeof audioContext?.getOutputTimestamp === 'function';
  const browserMs = (outputLatencyMs || 0) + (baseLatencyMs || 0);
  if (!outputTimestampApplies && browserMs > 0) {
    return { leadMs: round1(browserMs), source: 'browser', ...measured };
  }
  return { leadMs: 0, source: 'none', ...measured };
}

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-metronome-click' });
  return _logger;
}

/**
 * Log one anchored click run. Call once per run, when the anchored grid starts.
 * @param {{ leadMs:number, source:string, outputLatencyMs?:number|null, baseLatencyMs?:number|null }} lead
 * @param {{ anchorMs:number, [key:string]:any }} context extra fields (anchorMs required; exerciseId, bpm… welcome)
 */
export function logClickAnchored(lead, { anchorMs, ...extra } = {}) {
  const data = {
    leadMs: lead?.leadMs ?? 0,
    source: lead?.source ?? 'none',
    outputLatencyMs: lead?.outputLatencyMs ?? null,
    baseLatencyMs: lead?.baseLatencyMs ?? null,
    anchorMs: Number.isFinite(anchorMs) ? anchorMs : null,
    ...extra,
  };
  logger().info('piano.click.anchored', data);
  return data;
}
