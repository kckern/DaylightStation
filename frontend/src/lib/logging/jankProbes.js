// jankProbes.js
//
// Lightweight, always-cheap probes that characterize WHY the frame rate is low
// on the piano tablet (SM-T590). fps alone can't tell a main-thread JS storm
// apart from a compositor/GPU stall — and on this device the two need opposite
// fixes. These probes make the distinction observable:
//
//   • loopLag  — event-loop delay (a fixed-cadence timer's actual vs expected
//     gap). HIGH while fps is low  ⇒ the main thread is saturated (JS/render
//     storm; fixable in a component). NEAR-ZERO while fps is low ⇒ the event
//     loop is healthy but frames aren't presenting — a compositor/GPU stall
//     (the reload-surviving latch; a JS fix can't help it).
//   • longTasks — PerformanceObserver('longtask'): main-thread blocks >50ms,
//     with count / total / max per reporting window. Corroborates loopLag.
//   • slowEvents — PerformanceObserver('event'): input→render latencies over a
//     threshold. This is the "static menus feel unresponsive" symptom, measured.
//   • renders — components report per-commit so a re-render storm is attributable
//     to a specific component (NoteWaterfall, PianoKeyboard, …) instead of a
//     vague app-wide fps drop.
//
// Everything is accumulated between reads; readJankProbes()/readRenderRegistry()
// return the window's stats and reset, so each perf.diagnostics snapshot carries
// the delta since the previous one. All observers are feature-detected and never
// throw — telemetry must never be the thing that breaks the render loop.

import { record, intern, KIND } from './inputRecorder.js';

let loopTimer = null;
let loopExpectedMs = 250;
let loopLastTs = 0;
let loopLagMaxMs = 0;
let loopLagLastMs = 0;

let ltObserver = null;
let ltCount = 0;
let ltTotalMs = 0;
let ltMaxMs = 0;

let evObserver = null;
let evCount = 0;
let evMaxMs = 0;

const renderReg = new Map(); // name -> { count, nodes }

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/**
 * Component render report. Called in a component's post-commit effect — must be
 * dirt cheap (it runs on every commit of a hot component). `extra.nodes` records
 * the number of DOM nodes that render produced (e.g. waterfall notes) so a snap
 * shows both re-render frequency AND payload size.
 */
export function reportRender(name, extra) {
  let r = renderReg.get(name);
  if (!r) { r = { count: 0, nodes: 0 }; renderReg.set(name, r); }
  r.count += 1;
  if (extra && typeof extra.nodes === 'number') r.nodes = extra.nodes;
  // Mirror the commit into the zero-alloc input recorder ring so a render storm
  // is attributable in the same timeline as MIDI / touch / UI-intent events.
  // intern caches the name (no new string), so this stays allocation-light.
  record(KIND.RENDER, intern(name), extra?.nodes | 0, 0, 0);
}

/** Read + reset the per-component render counters. Returns null when nothing reported. */
export function readRenderRegistry() {
  if (renderReg.size === 0) return null;
  const out = {};
  for (const [k, v] of renderReg) {
    out[k] = { count: v.count, nodes: v.nodes };
    v.count = 0; // keep last-known nodes; reset the per-window commit count
  }
  return out;
}

/** Read + reset the loop-lag / long-task / slow-event accumulators for one window. */
export function readJankProbes() {
  const out = {
    loopLag: { curMs: +loopLagLastMs.toFixed(1), maxMs: +loopLagMaxMs.toFixed(1) },
    longTasks: { count: ltCount, totalMs: +ltTotalMs.toFixed(1), maxMs: +ltMaxMs.toFixed(1) },
    slowEvents: { count: evCount, maxMs: +evMaxMs.toFixed(1) },
  };
  loopLagMaxMs = 0;
  ltCount = 0; ltTotalMs = 0; ltMaxMs = 0;
  evCount = 0; evMaxMs = 0;
  return out;
}

/**
 * Start the probes. Idempotent-safe: stops any prior instance first. Started by
 * the Logger's diagnostics lifecycle so it lives exactly as long as diagnostics.
 */
export function startJankProbes({ expectedMs = 250 } = {}) {
  stopJankProbes();
  loopExpectedMs = expectedMs;
  loopLastTs = nowMs();
  loopLagLastMs = 0;
  loopLagMaxMs = 0;

  if (typeof setInterval === 'function') {
    loopTimer = setInterval(() => {
      const t = nowMs();
      const lag = Math.max(0, (t - loopLastTs) - loopExpectedMs);
      loopLastTs = t;
      loopLagLastMs = lag;
      if (lag > loopLagMaxMs) loopLagMaxMs = lag;
    }, loopExpectedMs);
    if (loopTimer && typeof loopTimer.unref === 'function') loopTimer.unref();
  }

  if (typeof PerformanceObserver === 'function') {
    try {
      ltObserver = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          ltCount += 1;
          ltTotalMs += e.duration;
          if (e.duration > ltMaxMs) ltMaxMs = e.duration;
        }
      });
      ltObserver.observe({ type: 'longtask', buffered: true });
    } catch { ltObserver = null; }

    try {
      evObserver = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          evCount += 1;
          if (e.duration > evMaxMs) evMaxMs = e.duration;
        }
      });
      // durationThreshold is the event's full input→next-paint latency; 104ms is
      // ~6 dropped frames — a genuinely "felt" unresponsive tap, not micro-jank.
      evObserver.observe({ type: 'event', durationThreshold: 104, buffered: true });
    } catch { evObserver = null; }
  }
}

/** Tear down probes and clear all state. */
export function stopJankProbes() {
  if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
  if (ltObserver) { try { ltObserver.disconnect(); } catch { /* ignore */ } ltObserver = null; }
  if (evObserver) { try { evObserver.disconnect(); } catch { /* ignore */ } evObserver = null; }
  ltCount = 0; ltTotalMs = 0; ltMaxMs = 0;
  evCount = 0; evMaxMs = 0;
  loopLagMaxMs = 0; loopLagLastMs = 0;
  renderReg.clear();
}
