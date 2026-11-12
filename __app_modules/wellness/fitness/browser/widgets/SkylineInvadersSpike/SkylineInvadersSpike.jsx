/**
 * Skyline Invaders — Phase 0 hardware spike.
 *
 * A self-guided measurement script for the garage: pose throughput, the aim
 * signal, and pressure-mat firing. One person runs it alone from the TV; every
 * step, input and number is logged under `skyline_invaders.spike.*` so the run
 * can be reconstructed from the log store. Not a game.
 *
 * Pose frames arrive through `registerMoveDetector` / `processPoses` and stay in
 * refs. The only component that subscribes to PoseContext is <PoseBridge>, which
 * renders nothing: PoseContext's value changes on every inference, so any
 * consumer re-renders at ~30 Hz no matter which field it reads.
 */

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import getLogger, { flushLogs } from '@/lib/logging/Logger.js';
import { useFitnessContext } from "../../context/FitnessContext.jsx";
import PoseContext, { PoseProvider } from "../../context/PoseContext.jsx";
import { getPoseDetectorService } from "../../domain/pose/PoseDetectorService.js";
import FitnessWebcam from "../../components/FitnessWebcam.jsx";
import { BLAZEPOSE_CONNECTIONS } from "../../lib/pose/poseConnections.js";
import {
  DEFAULT_AIM_CONFIG, KP, computeAim, createAimHistory, createAimSmoother,
  latchAfter, latchBefore, wristsAboveHead, wristsAboveShoulders,
} from "../../lib/skylineInvaders/aim.js";
import { frameCheck } from "../../lib/skylineInvaders/framing.js";
import { compactPayload, pressRate, PRESS_LATENCY_NOTE } from "../../lib/skylineInvaders/matMetrics.js";
import { createFrameMeter, createPoseMeter, POSE_FPS_GATE } from "../../lib/skylineInvaders/poseMetrics.js";
import { MODEL_A, MODEL_B, buildScript, chooseModel, classifyKey, parseDirector, redoTarget } from "../../lib/skylineInvaders/spikeScript.js";
import { createStepCollector } from "../../lib/skylineInvaders/stepCollector.js";
import { buildSummary } from "../../lib/skylineInvaders/summary.js";
import { round } from "../../lib/skylineInvaders/stats.js";
import "./SkylineInvadersSpike.scss";

const EVENT_PREFIX = 'skyline_invaders.spike.';
const DETECTOR_ID = 'skyline-invaders-spike';
const SMOOTHER_TAU_MS = 120;
const GESTURE_HOLD_MS = 2000;
const INPUT_DEBOUNCE_MS = 700;
const LATCH_AFTER_MS = 450;
const DIRECTOR_URL = '/__director.json';
const DIRECTOR_POLL_MS = 2000;
const DIRECTOR_BANNER_MS = 20000;
const DIRECTOR_SEEN_KEY = 'skylineInvadersSpike.directorSeen';
// The backend admits a burst of 30 and then 3 per minute of any one event name
// from one client (ingestRateLimiter.mjs). Anything that recurs faster than
// every 20 s is therefore batched into one event per 20 s.
const BATCH_PERIOD_S = 20;
const BATCH_MAX_RECORDS = 60;
const VIDEO_CONSTRAINTS = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' };
const LOAD_ELEMENTS = 60;

const now = () => performance.now();
const errorText = (err) => (err ? `${err.name ? `${err.name}: ` : ''}${err.message || String(err)}` : null);

function makeSessionId() {
  let rand = '';
  try {
    const bytes = new Uint8Array(3);
    window.crypto.getRandomValues(bytes);
    rand = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch { rand = Math.floor(Math.random() * 0xffffff).toString(16); }
  return `sis-${Date.now().toString(36)}-${rand}`;
}

function webglRenderer() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '') || null;
  } catch { return null; }
}

/** Spike logger: one session id and the current step on every event. */
function createSpikeLog() {
  const base = getLogger().child({ app: 'fitness', component: DETECTOR_ID });
  const sid = makeSessionId();
  const t0 = now();
  const state = { step: null, subject: null };
  const emit = (level, name, data = {}) => base[level](`${EVENT_PREFIX}${name}`, {
    sid, step: state.step, ...(state.subject ? { subject: state.subject } : {}), tS: round((now() - t0) / 1000, 1), ...data,
  });
  return {
    sid, t0, state,
    info: (name, data) => emit('info', name, data),
    warn: (name, data) => emit('warn', name, data),
    error: (name, data) => emit('error', name, data),
  };
}

/** The only PoseContext consumer. Renders nothing; re-renders are free. */
function PoseBridge({ bridgeRef, onPoses, onStatus }) {
  const ctx = useContext(PoseContext);
  bridgeRef.current = ctx;
  const { registerMoveDetector, unregisterMoveDetector, isLoading, isInitialized, isDetecting, error } = ctx;
  useEffect(() => {
    registerMoveDetector({ id: DETECTOR_ID, processPoses: (poses) => { onPoses(poses); return null; } });
    return () => unregisterMoveDetector(DETECTOR_ID);
  }, [registerMoveDetector, unregisterMoveDetector, onPoses]);
  useEffect(() => { onStatus({ isLoading, isInitialized, isDetecting, error }); }, [onStatus, isLoading, isInitialized, isDetecting, error]);
  return null;
}

/**
 * Stand-in for the game scene: a requestAnimationFrame loop that re-renders
 * LOAD_ELEMENTS moving SVG elements through React state every frame, the way
 * the SVG flight scene is driven.
 */
function SyntheticLoad({ onFrame }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const frame = (ts) => { onFrame(now()); setT(ts); raf = requestAnimationFrame(frame); };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [onFrame]);
  const items = [];
  for (let i = 0; i < LOAD_ELEMENTS; i += 1) {
    const phase = t / 1000 + i * 0.37;
    const x = 500 + 470 * Math.sin(phase * (0.6 + (i % 5) * 0.11));
    const y = ((i * 53 + t * (0.04 + (i % 7) * 0.012)) % 300);
    items.push(i % 3 === 0
      ? <circle key={i} cx={x} cy={y} r={6 + (i % 4)} />
      : <rect key={i} width="16" height="10" transform={`translate(${x} ${y}) rotate(${(phase * 40) % 360})`} />);
  }
  return <svg className="sis-load" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">{items}</svg>;
}

class SpikeErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) {
    this.props.log.error('render_error', { error: errorText(error), stack: error?.stack || null, componentStack: info?.componentStack || null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="sis sis--fatal">
        <h1>The test page crashed</h1>
        <p className="sis-fatal-text">{errorText(this.state.error)}</p>
        <button type="button" className="sis-btn sis-btn--next" onClick={() => this.setState({ error: null })}>START OVER</button>
      </div>
    );
  }
}

const fmt = (v, digits = 1, unit = '') => (v == null ? '—' : `${Number(v).toFixed(digits)}${unit}`);

function ResultsPanel({ summary }) {
  if (!summary) return null;
  const poseRow = (model, kind) => {
    const p = summary.pose?.[model]?.[kind];
    return (
      <tr key={`${model}-${kind}`}>
        <th>{model} {kind === 'load' ? '+ game load' : 'alone'}</th>
        <td className={p ? (p.meetsGate ? 'ok' : 'bad') : ''}>{fmt(p?.fps)} fps</td>
        <td>{fmt(p?.minWindowFps)} worst 5 s</td>
        <td>{fmt(p?.latencyP50Ms, 0)} / {fmt(p?.latencyP95Ms, 0)} ms</td>
      </tr>
    );
  };
  const holdRow = (subject, key, label) => {
    const h = summary.aim?.[subject]?.[key];
    return (
      <tr key={`${subject}-${key}`}>
        <th>{subject} {label}</th>
        <td>aim {fmt(h?.mean, 3)}</td>
        <td>jitter sd {fmt(h?.sdRaw, 4)} (smoothed {fmt(h?.sdSmoothed, 4)})</td>
        <td>lost {fmt(h?.lostPct, 0)}%</td>
      </tr>
    );
  };
  const { drill, free, relay, latch } = summary.mat || {};
  return (
    <div className="sis-results">
      <table>
        <caption>Pose: frames per second (gate {summary.fpsGate}), inference p50 / p95. Backend: {summary.backend || '—'}</caption>
        <tbody>{[MODEL_A, MODEL_B].flatMap((m) => [poseRow(m, 'baseline'), poseRow(m, 'load')])}</tbody>
      </table>
      <table>
        <caption>Aim while holding still (0 = screen left, 1 = screen right)</caption>
        <tbody>
          {['adult', 'kid'].flatMap((s) => [holdRow(s, 'holdLeft', 'left'), holdRow(s, 'holdCenter', 'center'), holdRow(s, 'holdRight', 'right')])}
        </tbody>
      </table>
      <table>
        <caption>Mat</caption>
        <tbody>
          <tr><th>speed drill</th><td>{drill ? `${drill.presses} presses` : '—'}</td><td>{fmt(drill?.perSec, 2)} per s</td><td>median gap {fmt(drill?.intervalP50Ms, 0)} ms</td></tr>
          <tr><th>aim and fire</th><td>{free ? `${free.presses} presses` : '—'}</td><td>{fmt(free?.perSec, 2)} per s</td><td>median gap {fmt(free?.intervalP50Ms, 0)} ms</td></tr>
          <tr><th>aim moved before a press</th><td>100 ms: {fmt(latch?.rawThrowAbsP50?.ms100, 3)}</td><td>200 ms: {fmt(latch?.rawThrowAbsP50?.ms200, 3)}</td><td>400 ms: {fmt(latch?.rawThrowAbsP50?.ms400, 3)} (median)</td></tr>
          <tr><th>delivery delay above fastest</th><td>p50 {fmt(relay?.deliveryExcessP50Ms, 0)} ms</td><td>p95 {fmt(relay?.deliveryExcessP95Ms, 0)} ms</td><td>server→screen p50 {fmt(relay?.backendToAppP50Ms, 0)} ms (includes clock offset)</td></tr>
        </tbody>
      </table>
      <p className="sis-note">{PRESS_LATENCY_NOTE}</p>
      <p className="sis-note">Steps measured: {summary.stepsMeasured} of {summary.stepsTotal}{summary.stepsMissing ? ` · missing: ${summary.stepsMissing}` : ''} · session {summary.sid}</p>
    </div>
  );
}

function SpikeInner({ log, onMount }) {
  const fitness = useFitnessContext();
  const subscribeToAppEvent = fitness?.subscribeToAppEvent;
  const matState = fitness?.pressureMatState;

  const steps = useMemo(() => buildScript(), []);
  const [stepIdx, setStepIdx] = useState(0);
  const [loadOn, setLoadOn] = useState(false);
  const [ui, setUi] = useState({});
  const [banner, setBanner] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [summary, setSummary] = useState(null);

  const bridgeRef = useRef(null);
  const webcamRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const markerRef = useRef(null);
  const smoothMarkerRef = useRef(null);
  const traceRef = useRef(null);

  // Everything the measurement loop touches lives here, outside React state.
  const S = useRef(null);
  if (!S.current) {
    S.current = {
      idx: -1, phase: 'idle', token: 0, leadT0: 0, changedT: 0,
      collector: null, attempts: {}, results: {}, chosen: null,
      actualModel: MODEL_A, switching: false, load: false,
      live: null, meter: createPoseMeter(), loadMeter: createFrameMeter(),
      smoother: createAimSmoother({ tauMs: SMOOTHER_TAU_MS }), history: createAimHistory({ horizonMs: 3000 }), lastX: null,
      gesture: { armed: false, since: null },
      mats: {}, activeMat: null, lastMatT: null, lastPress: null, pressTimes: [], recent: [], pending: [],
      pressBatch: [], rawBatch: [], ticks: [], lastTickS: -1, lastBatchS: 0, lastHeartbeatS: -BATCH_PERIOD_S / 2,
      pose: { isLoading: false, isInitialized: false, isDetecting: false, error: null }, modelT0: null, modelReadyLogged: false,
      camera: null, summaryCount: 0, unloaded: false,
    };
  }

  // ---- logging helpers -----------------------------------------------------

  const flushBatches = useCallback((why) => {
    const s = S.current;
    if (s.pressBatch.length) log.info('mat.presses', { why, count: s.pressBatch.length, pressesJson: JSON.stringify(s.pressBatch.splice(0)) });
    if (s.rawBatch.length) log.info('mat.raw', { why, count: s.rawBatch.length, eventsJson: JSON.stringify(s.rawBatch.splice(0)) });
  }, [log]);

  const flushTicks = useCallback((why) => {
    const s = S.current;
    if (!s.ticks.length) return;
    const ticks = s.ticks.splice(0);
    log.info('tick_batch', { why, count: ticks.length, fromS: ticks[0].t, toS: ticks[ticks.length - 1].t, ticksJson: JSON.stringify(ticks) });
  }, [log]);

  const sessionInfo = useCallback(() => {
    const s = S.current;
    return {
      sid: log.sid,
      durationS: round((now() - log.t0) / 1000, 0),
      backend: s.live?.backend ?? null,
      modelOrder: `${MODEL_A},${MODEL_B}`,
      modelForAimAndMat: s.chosen?.model ?? null,
      modelChoiceReason: s.chosen?.reason ?? null,
      cameraWidth: s.camera?.width ?? null,
      cameraHeight: s.camera?.height ?? null,
      cameraFrameRate: s.camera?.frameRate ?? null,
      matId: s.activeMat,
      matIdsSeen: Object.keys(s.mats).join(','),
      rearmsSeen: Object.values(s.mats).reduce((acc, m) => acc + (m.rearmsSeen || 0), 0),
      aimConfig: DEFAULT_AIM_CONFIG,
      smootherTauMs: SMOOTHER_TAU_MS,
      poseFpsCap: 30,
    };
  }, [log]);

  const currentSummary = useCallback((complete) => buildSummary({
    session: sessionInfo(), steps, results: S.current.results, complete,
  }), [sessionInfo, steps]);

  // ---- script engine -------------------------------------------------------

  const finalizePress = useCallback((record) => {
    const s = S.current;
    if (record.after) return;
    const t = now();
    record.after = { x: latchAfter(s.history, record.t, t, 'x'), xs: latchAfter(s.history, record.t, t, 'xs') };
    s.pending = s.pending.filter((p) => p !== record);
    s.pressBatch.push({ ...record, t: round(record.t - log.t0, 0) });
    if (s.pressBatch.length >= BATCH_MAX_RECORDS) flushBatches('full');
  }, [flushBatches, log]);

  const endStep = useCallback((reason, outcome) => {
    const s = S.current;
    const step = steps[s.idx];
    if (!step) return;
    [...s.pending].forEach(finalizePress);
    const t = now();
    const measured = s.collector && (s.phase === 'wait' || s.phase === 'measure');
    const numbers = measured ? s.collector.result(t, { load: !!step.load, drill: !!step.drill }) : null;
    const entry = {
      outcome, reason, attempts: s.attempts[step.id] || 1, numbers,
      model: s.actualModel, backend: s.live?.backend ?? null, load: !!step.load,
    };
    // A finished measurement is never replaced by a later skipped or redone one.
    if (outcome === 'end' || s.results[step.id]?.outcome !== 'end') s.results[step.id] = entry;
    log.info('step_end', {
      index: s.idx, kind: step.kind, phaseAtEnd: s.phase, outcome, reason, attempt: entry.attempts,
      model: entry.model, backend: entry.backend, load: entry.load,
      plannedS: step.durationS ?? null, numbers,
    });
    flushBatches('step_end');
    s.collector = null;
    s.phase = 'idle';
  }, [steps, finalizePress, flushBatches, log]);

  const switchModel = useCallback(async (target) => {
    const s = S.current;
    const from = s.actualModel;
    const t0 = now();
    s.switching = true;
    log.info('model.load_start', { model: target, from, cause: 'step' });
    try {
      await bridgeRef.current.updateConfig({ modelType: target });
      s.actualModel = target;
      log.info('model.ready', { model: target, ms: round(now() - t0, 0), cause: 'step' });
    } catch (err) {
      log.error('model.fail', { model: target, ms: round(now() - t0, 0), error: errorText(err), stack: err?.stack || null });
      try {
        // The service keeps the old detector but now reports the new model name
        // and is stopped. Put the name back and restart on what really runs.
        await bridgeRef.current.updateConfig({ modelType: from });
        await bridgeRef.current.startDetection();
        log.warn('model.reverted', { model: from, wanted: target });
      } catch (revertErr) {
        log.error('model.revert_failed', { model: from, error: errorText(revertErr), stack: revertErr?.stack || null });
      }
    } finally {
      s.smoother.reset();
      s.switching = false;
    }
  }, [log]);

  const startStep = useCallback(async (index, reason) => {
    const s = S.current;
    const step = steps[index];
    if (!step) return;
    const token = s.token + 1;
    s.token = token;
    s.idx = index;
    s.phase = 'prep';
    s.changedT = now();
    s.gesture = { armed: false, since: null };
    s.attempts[step.id] = (s.attempts[step.id] || 0) + 1;
    log.state.step = step.id;
    log.state.subject = step.subject || null;
    setStepIdx(index);

    if (step.model === 'auto' && !s.chosen) {
      const fpsOf = (id) => (s.results[id]?.outcome === 'end' ? s.results[id].numbers?.pose?.fps ?? null : null);
      s.chosen = chooseModel(fpsOf(`t1.${MODEL_A}.load`), fpsOf(`t1.${MODEL_B}.load`));
      log.info('model.chosen', { ...s.chosen, fullLoadFps: fpsOf(`t1.${MODEL_A}.load`), liteLoadFps: fpsOf(`t1.${MODEL_B}.load`), gate: POSE_FPS_GATE });
    }
    const wanted = step.model === 'auto' ? s.chosen.model : step.model || s.actualModel;
    s.load = !!step.load;
    setLoadOn(s.load);
    log.info('step_start', {
      index, kind: step.kind, reason, attempt: s.attempts[step.id], title: step.title,
      plannedS: step.durationS ?? null, leadS: step.leadS ?? null, settleS: step.settleS ?? null,
      modelWanted: wanted, modelNow: s.actualModel, load: s.load, gestureEnabled: !!step.gesture,
    });

    // A director jump can land while the previous step's model is still loading.
    while (s.switching) await new Promise((resolve) => { setTimeout(resolve, 100); });
    if (s.token !== token) return;
    if (wanted !== s.actualModel && s.pose.isInitialized) {
      s.phase = 'switching';
      await switchModel(wanted);
      if (s.token !== token) return; // another step started while the model loaded
    }
    s.changedT = now();
    if (step.panel === 'results') {
      s.phase = 'done'; // left on screen indefinitely: nothing more to collect
    } else if (step.kind === 'wait') {
      s.collector = createStepCollector();
      s.collector.start(now());
      s.phase = 'wait';
    } else {
      s.leadT0 = now();
      s.phase = 'lead';
    }
    if (step.id === 'results') {
      const result = currentSummary(true);
      s.summaryCount += 1;
      log.info('summary', { ...result, summaryCount: s.summaryCount });
      flushTicks('summary');
      setSummary(result);
    }
  }, [steps, switchModel, currentSummary, flushTicks, log]);

  const goTo = useCallback((index, reason, outcome) => {
    endStep(reason, outcome);
    startStep(index, reason);
  }, [endStep, startStep]);

  /** Any control input. Returns what it did, and logs it either way. */
  const handleInput = useCallback((source, action, detail = {}) => {
    const s = S.current;
    const step = steps[s.idx];
    let result = action;
    let why = detail.reason || source;
    if (action === 'ignored') result = 'ignored';
    else if (!step) { result = 'ignored'; why = 'no_step'; }
    else if (s.phase === 'prep' || s.phase === 'switching') { result = 'ignored'; why = 'model_loading'; }
    else if (now() - s.changedT < INPUT_DEBOUNCE_MS) { result = 'ignored'; why = 'debounce'; }
    else if (action === 'next' && s.idx >= steps.length - 1) { result = 'ignored'; why = 'last_step'; }
    log.info('input', { source, ...detail, action: result, reason: why, phase: s.phase });
    if (result === 'next') goTo(s.idx + 1, source, step.kind === 'wait' ? 'end' : 'skip');
    else if (result === 'redo') goTo(redoTarget(steps, s.idx), source, 'redo');
    return result;
  }, [steps, goTo, log]);

  // ---- pose frames ---------------------------------------------------------

  const draw = useCallback((pose, sample, step) => {
    const s = S.current;
    const marker = markerRef.current;
    if (marker) {
      const x = sample.aim.aimX ?? s.lastX;
      marker.setAttribute('transform', `translate(${(x ?? 0.5) * 1000} 0)`);
      marker.setAttribute('class', sample.aim.lost ? 'sis-cannon is-lost' : 'sis-cannon');
      if (smoothMarkerRef.current && sample.xs != null) smoothMarkerRef.current.setAttribute('cx', sample.xs * 1000);
      if (traceRef.current) {
        const points = s.history.between(sample.t - 1500, sample.t)
          .filter((p) => p.x != null)
          .map((p) => `${round(p.x * 1000, 0)},${round(96 - ((sample.t - p.t) / 1500) * 90, 0)}`);
        traceRef.current.setAttribute('points', points.join(' '));
      }
    }
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video?.videoWidth) return;
    if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (!step?.skeleton || !pose) return;
    const k = pose.keypoints;
    g.lineWidth = 4;
    g.strokeStyle = '#7fd4ff';
    BLAZEPOSE_CONNECTIONS.forEach(([a, b]) => {
      if ((k[a]?.score ?? 0) < 0.3 || (k[b]?.score ?? 0) < 0.3) return;
      g.beginPath(); g.moveTo(k[a].x, k[a].y); g.lineTo(k[b].x, k[b].y); g.stroke();
    });
    [[KP.nose, sample.frame.head], [KP.leftWrist, sample.frame.leftWrist], [KP.rightWrist, sample.frame.rightWrist]].forEach(([i, inside]) => {
      if (!k[i] || !Number.isFinite(k[i].x)) return;
      g.fillStyle = inside ? '#3ddc84' : '#ff5a4f';
      g.beginPath(); g.arc(k[i].x, k[i].y, 12, 0, Math.PI * 2); g.fill();
    });
  }, []);

  const onPoses = useCallback((poses) => {
    const s = S.current;
    const t = now();
    const service = getPoseDetectorService().getState();
    const pose = poses?.[0] || null;
    const video = videoRef.current;
    const aim = computeAim(pose);
    const xs = s.smoother.push(aim.aimX, t);
    if (aim.aimX != null) s.lastX = aim.aimX;
    const sample = {
      t,
      latencyMs: service.metrics?.latencyMs ?? null,
      backend: service.backend ?? null,
      hasPose: !!pose,
      aim,
      xs,
      frame: frameCheck(pose, video?.videoWidth || 0, video?.videoHeight || 0),
      armsUp: wristsAboveShoulders(pose),
    };
    s.history.push({ t, x: s.lastX, xs, lost: aim.lost });
    s.meter.add(t, sample.latencyMs, sample.hasPose);
    s.live = sample;
    const step = steps[s.idx];
    if (s.collector && !s.switching && (s.phase === 'wait' || s.phase === 'measure')) s.collector.pose(sample);

    // Both wrists above the head, held: "next". Must first be seen down, so
    // arms still raised from the previous step do not trigger it.
    if (step?.gesture && (s.phase === 'wait' || s.phase === 'measure')) {
      const above = wristsAboveHead(pose);
      if (above === false) s.gesture = { armed: true, since: null };
      else if (above === true && s.gesture.armed) {
        if (s.gesture.since == null) s.gesture.since = t;
        else if (t - s.gesture.since >= GESTURE_HOLD_MS) {
          s.gesture = { armed: false, since: null };
          handleInput('gesture', 'next', { heldMs: GESTURE_HOLD_MS });
        }
      } else s.gesture.since = null;
    }
    draw(pose, sample, step);
  }, [steps, handleInput, draw]);

  const onPoseStatus = useCallback((status) => {
    const s = S.current;
    const before = s.pose;
    s.pose = status;
    if (status.isInitialized && !s.modelReadyLogged && s.modelT0 != null) {
      s.modelReadyLogged = true;
      const service = getPoseDetectorService().getState();
      log.info('model.ready', { model: s.actualModel, backend: service.backend, ms: round(now() - s.modelT0, 0), cause: 'initial' });
      log.info('session_env', { backend: service.backend, model: s.actualModel, camera: s.camera, temporalSmoothing: false, blazeposeSmoothing: true });
    }
    const poseErrorText = errorText(status.error);
    if (poseErrorText && status.error !== before.error) s.poseErrors = (s.poseErrors || 0) + 1;
    if (poseErrorText && poseErrorText !== s.poseErrorText) {
      s.poseErrorText = poseErrorText;
      log.error(s.modelReadyLogged ? 'pose.error' : 'model.fail', {
        model: s.actualModel, error: poseErrorText, stack: status.error?.stack || null,
        ms: s.modelT0 != null ? round(now() - s.modelT0, 0) : null, cause: s.modelReadyLogged ? 'runtime' : 'initial',
      });
    }
  }, [log]);

  // ---- camera --------------------------------------------------------------

  const handleStreamReady = useCallback((stream) => {
    const s = S.current;
    const video = webcamRef.current?.getVideoElement?.() || null;
    videoRef.current = video;
    const track = stream?.getVideoTracks?.()[0];
    const settings = track?.getSettings?.() || {};
    s.camera = {
      width: settings.width ?? null, height: settings.height ?? null, frameRate: settings.frameRate ?? null,
      deviceId: settings.deviceId ?? null, label: track?.label ?? null,
    };
    s.cameraErrorText = null;
    setCameraError(null);
    log.info('camera.ready', s.camera);
    if (!video || !bridgeRef.current) return;
    bridgeRef.current.setVideoSource(video);
    if (s.modelT0 == null) {
      s.modelT0 = now();
      log.info('model.load_start', { model: s.actualModel, cause: 'initial' });
    }
    bridgeRef.current.startDetection();
  }, [log]);

  const handleCameraError = useCallback((err) => {
    const s = S.current;
    const text = errorText(err) || 'Camera unavailable';
    if (s.cameraErrorText !== text) log.error('camera.error', { error: text, name: err?.name || null, constraint: err?.constraint || null });
    s.cameraErrorText = text;
    setCameraError(text);
  }, [log]);

  // ---- mat -----------------------------------------------------------------

  const onMat = useCallback((type, event) => {
    const s = S.current;
    const t = now();
    const wallMs = Date.now();
    const payload = event?.payload || {};
    const matId = payload.id ?? event?.source ?? 'unknown';
    s.lastMatT = t;
    s.rawBatch.push({ type, t: round(t - log.t0, 0), wallMs, source: event?.source ?? null, emittedAt: event?.timestamp ?? null, payload: compactPayload(payload) });
    if (s.rawBatch.length >= BATCH_MAX_RECORDS) flushBatches('full');
    const known = s.mats[matId] || (s.mats[matId] = { rearmCount: null, rearmsSeen: 0 });
    // The first mat to report a press is the shooter's mat for this run.
    if (!s.activeMat && type === 'step') s.activeMat = matId;
    if (!known.announced) {
      known.announced = true;
      log.info('mat.seen', {
        matId, active: s.activeMat === matId, firmwareBuild: payload.firmwareBuild ?? null, protocolVersion: payload.protocolVersion ?? null,
        bootCount: payload.bootCount ?? null, hasDeviceTs: Number.isFinite(payload.deviceTs) && payload.deviceTs > 0, hasReceivedAt: !!payload.receivedAt,
      });
    }
    const active = matId === s.activeMat;
    const collecting = s.collector && (s.phase === 'wait' || s.phase === 'measure');

    if (type === 'step') {
      const receivedAtMs = Date.parse(payload.receivedAt || '');
      const deviceTs = Number.isFinite(payload.deviceTs) && payload.deviceTs > 0 ? payload.deviceTs : null;
      const prev = active ? s.lastPress : null;
      const record = {
        t, wallMs, matId, deviceTs, bootCount: payload.bootCount ?? null,
        receivedAtMs: Number.isFinite(receivedAtMs) ? receivedAtMs : null,
        intervalMs: prev ? round(t - prev.t, 0) : null,
        deviceIntervalMs: prev && deviceTs != null && prev.deviceTs != null && prev.bootCount === (payload.bootCount ?? null) ? deviceTs - prev.deviceTs : null,
        backendToAppMs: Number.isFinite(receivedAtMs) ? wallMs - receivedAtMs : null,
        stomp: false,
        aimLost: s.live ? s.live.aim.lost : true,
        latch: { x: latchBefore(s.history, t, 'x'), xs: latchBefore(s.history, t, 'xs') },
        after: null,
        step: steps[s.idx]?.id ?? null,
      };
      if (active) {
        s.lastPress = record;
        s.pressTimes.push(t);
        s.recent = [...s.recent.slice(-5), record];
      }
      if (collecting) s.collector.press(record, { activeMat: active });
      s.pending.push(record);
      setTimeout(() => finalizePress(record), LATCH_AFTER_MS);
    } else if (type === 'stomp') {
      if (active && s.lastPress && t - s.lastPress.t < 1500) s.lastPress.stomp = true;
      if (collecting && active) s.collector.stomp();
    } else if (type === 'released' && collecting && active) {
      s.collector.release({ t, pressDurationMs: payload.pressDurationMs ?? null });
    }
  }, [steps, finalizePress, flushBatches, log]);

  useEffect(() => {
    if (!subscribeToAppEvent) {
      log.warn('mat.unavailable', { reason: 'no_app_event_bus' });
      return undefined;
    }
    const stops = [
      subscribeToAppEvent('pressure-mat:step', (event) => onMat('step', event)),
      subscribeToAppEvent('pressure-mat:stomp', (event) => onMat('stomp', event)),
      subscribeToAppEvent('pressure-mat:released', (event) => onMat('released', event)),
    ];
    log.info('mat.subscribed', { events: 'pressure-mat:step,pressure-mat:stomp,pressure-mat:released' });
    return () => stops.forEach((stop) => stop?.());
  }, [subscribeToAppEvent, onMat, log]);

  // The detector re-arming is not an app event; it shows up as rearmCount
  // rising on the mat's state (carried by the 1 Hz relay readings).
  useEffect(() => {
    const s = S.current;
    Object.entries(matState || {}).forEach(([matId, reading]) => {
      const known = s.mats[matId] || (s.mats[matId] = { rearmCount: null, rearmsSeen: 0 });
      known.latest = reading;
      const count = reading?.rearmCount;
      if (count == null) return;
      if (known.rearmCount != null && count > known.rearmCount) {
        known.rearmsSeen += count - known.rearmCount;
        log.info('mat.rearmed', { matId, rearmCount: count, rearmsSeen: known.rearmsSeen, detectionState: reading.detectionState ?? null, occupied: !!reading.occupied });
        s.rawBatch.push({ type: 'rearmed', t: round(now() - log.t0, 0), wallMs: Date.now(), source: matId, payload: compactPayload(reading) });
        if (s.collector && (matId === s.activeMat || !s.activeMat)) s.collector.rearm();
      }
      known.rearmCount = count;
    });
  }, [matState, log]);

  // ---- lifecycle: mount, timers, inputs, director, errors -------------------

  const onLoadFrame = useCallback((t) => {
    const s = S.current;
    s.loadMeter.add(t);
    if (s.collector && s.phase === 'measure') s.collector.loadFrame(t);
  }, []);

  useEffect(() => {
    onMount?.();
    S.current.unloaded = false;
    log.info('session_start', {
      userAgent: navigator.userAgent, screenWidth: window.screen?.width ?? null, screenHeight: window.screen?.height ?? null,
      innerWidth: window.innerWidth, innerHeight: window.innerHeight, devicePixelRatio: window.devicePixelRatio ?? null,
      webglRenderer: webglRenderer(), hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      model: MODEL_A, configuredBackend: /Firefox/i.test(navigator.userAgent) ? 'wasm' : 'webgl',
      url: `${window.location.pathname}${window.location.search}`, visibility: document.visibilityState,
      stepIds: steps.map((step) => step.id).join(','),
    });
    log.info('camera.request', { constraints: VIDEO_CONSTRAINTS, via: 'FitnessWebcam' });
    startStep(0, 'mount');

    const unload = (name) => {
      const s = S.current;
      if (s.unloaded) return;
      s.unloaded = true;
      [...s.pending].forEach(finalizePress);
      flushBatches(name);
      flushTicks(name);
      log.info(name, { phase: s.phase, index: s.idx, summarySent: s.summaryCount > 0, summary: currentSummary(false) });
      flushLogs({ timeoutMs: 400 });
    };
    const onError = (e) => log.error('error', { message: e.message || null, filename: e.filename || null, line: e.lineno ?? null, column: e.colno ?? null, stack: e.error?.stack || null });
    const onRejection = (e) => log.error('unhandled_rejection', { message: errorText(e.reason) || String(e.reason), stack: e.reason?.stack || null });
    const onVisibility = () => log.info('visibility', { state: document.visibilityState });
    const onPageHide = () => unload('pagehide');
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      unload('unmounted');
    };
    // Mount once: every callback here reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keys: any key is "next" except the OS-bound digits; Escape/Backspace redo.
  useEffect(() => {
    const onKey = (e) => {
      const verdict = classifyKey({ key: e.key, code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey });
      // Keys the script owns never reach the fitness app or the browser.
      if (verdict.action !== 'ignored') { e.preventDefault(); e.stopPropagation(); }
      if (e.repeat) return; // a held key is one input, logged once
      handleInput('key', verdict.action, { key: e.key, code: e.code, reason: verdict.reason });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [handleInput]);

  // Engine clock: phase changes, readouts, 1 Hz ticks, heartbeat.
  useEffect(() => {
    let calls = 0;
    const timer = setInterval(() => {
      const s = S.current;
      const t = now();
      const step = steps[s.idx];
      calls += 1;
      if (step?.kind === 'timed') {
        if (s.phase === 'lead' && t >= s.leadT0 + step.leadS * 1000) {
          s.collector = createStepCollector({ settleMs: (step.settleS || 0) * 1000 });
          s.collector.start(t);
          s.phase = 'measure';
          log.info('step_measure_start', { index: s.idx, model: s.actualModel, load: s.load });
        } else if (s.phase === 'measure' && t >= s.collector.startedAt + step.durationS * 1000) {
          goTo(s.idx + 1, 'timer', 'end');
        }
      }

      const live = s.meter.live(t, 1000);
      const live5 = s.meter.live(t, 5000);
      const fresh = s.live && t - s.live.t < 1000 ? s.live : null;
      const matIds = Object.keys(s.mats);
      const matKey = s.activeMat ?? (matIds.length === 1 ? matIds[0] : null);
      const mat = s.mats[matKey]?.latest || null;
      const elapsedS = (t - log.t0) / 1000;

      const second = Math.floor(elapsedS);
      if (second !== s.lastTickS) {
        s.lastTickS = second;
        s.loadMeter.trim(t);
        s.ticks.push({
          t: second, step: step?.id ?? null, phase: s.phase, fps: live.fps, infMs: live.latencyP50,
          model: s.actualModel, backend: fresh?.backend ?? null, pose: fresh ? (fresh.hasPose ? 1 : 0) : null,
          x: round(fresh?.aim.aimX, 3), xs: round(fresh ? fresh.xs : null, 3), lost: fresh ? (fresh.aim.lost ? 1 : 0) : null,
          ls: round(fresh?.aim.arms.left.score, 2), rs: round(fresh?.aim.arms.right.score, 2),
          la: fresh?.aim.arms.left.state ?? null, ra: fresh?.aim.arms.right.state ?? null,
          lDeg: round(fresh?.aim.arms.left.angleDeg, 0), rDeg: round(fresh?.aim.arms.right.angleDeg, 0),
          wrists: fresh ? (fresh.frame.leftWrist && fresh.frame.rightWrist ? 1 : 0) : null, head: fresh ? (fresh.frame.head ? 1 : 0) : null,
          matOcc: mat ? (mat.occupied ? 1 : 0) : null, matState: mat?.detectionState ?? null, presses: s.pressTimes.length,
          load: s.load ? 1 : 0, loadFps: s.load ? s.loadMeter.live(t, 1000) : null,
        });
        if (second - s.lastBatchS >= BATCH_PERIOD_S) {
          s.lastBatchS = second;
          flushTicks('timer');
          flushBatches('timer');
        }
        if (second - s.lastHeartbeatS >= BATCH_PERIOD_S) {
          s.lastHeartbeatS = second;
          log.info('heartbeat', {
            index: s.idx, phase: s.phase, elapsedS: second, fps: live.fps, infMs: live.latencyP50, posePresent: !!fresh?.hasPose,
            lastMatEventAgeS: s.lastMatT != null ? round((t - s.lastMatT) / 1000, 1) : null, presses: s.pressTimes.length,
            model: s.actualModel, load: s.load, visibility: document.visibilityState,
          });
        }
      }

      if (calls % 2) return;
      const cur = steps[s.idx];
      let remainingS = null;
      if (s.phase === 'lead') remainingS = Math.max(0, Math.ceil((s.leadT0 + cur.leadS * 1000 - t) / 1000));
      else if (s.phase === 'measure') remainingS = Math.max(0, Math.ceil((s.collector.startedAt + cur.durationS * 1000 - t) / 1000));
      setUi({
        phase: s.phase, remainingS,
        progress: s.phase === 'measure' ? Math.min(1, (t - s.collector.startedAt) / (cur.durationS * 1000)) : 0,
        fps: live.fps, latencyP50: live5.latencyP50, latencyP95: live5.latencyP95,
        model: s.actualModel, backend: fresh?.backend ?? null, load: s.load, loadFps: s.load ? s.loadMeter.live(t, 1000) : null,
        poseStatus: s.pose, hasPose: !!fresh?.hasPose, aimX: fresh?.aim.aimX ?? null, lost: fresh ? fresh.aim.lost : true,
        left: fresh?.aim.arms.left ?? null, right: fresh?.aim.arms.right ?? null, frame: fresh?.frame ?? null,
        gesture: s.gesture.since != null ? Math.min(1, (t - s.gesture.since) / GESTURE_HOLD_MS) : 0,
        matId: matKey, matOccupied: mat ? !!mat.occupied : null, matDetection: mat?.detectionState ?? null,
        rearms: Object.values(s.mats).reduce((acc, m) => acc + (m.rearmsSeen || 0), 0),
        presses: s.pressTimes.length, stepPresses: s.collector?.presses.length ?? 0,
        rate10: pressRate(s.pressTimes, t, 10000), recent: s.recent,
        hasDeviceTs: s.recent.some((r) => r.deviceTs != null), hasBackendTs: s.recent.some((r) => r.receivedAtMs != null),
      });
    }, 100);
    return () => clearInterval(timer);
  }, [steps, goTo, flushTicks, flushBatches, log]);

  // Director channel: a file the coordinator drops next to the page.
  useEffect(() => {
    let lastSeen = null;
    try { lastSeen = window.localStorage.getItem(DIRECTOR_SEEN_KEY); } catch { /* storage blocked */ }
    let bannerTimer = null;
    let stopped = false;
    const stepIds = steps.map((step) => step.id);
    const poll = async () => {
      try {
        const res = await fetch(DIRECTOR_URL, { cache: 'no-store' });
        if (!res.ok) return;
        const message = parseDirector(await res.json(), lastSeen, stepIds);
        if (!message || stopped) return;
        lastSeen = message.id;
        try { window.localStorage.setItem(DIRECTOR_SEEN_KEY, message.id); } catch { /* storage blocked */ }
        log.info('director_seen', { id: message.id, hasText: !!message.text, text: message.text, command: message.command, targetStep: message.step, rejectedCommand: message.rejected });
        if (message.text) {
          setBanner(message.text);
          clearTimeout(bannerTimer);
          bannerTimer = setTimeout(() => setBanner(null), DIRECTOR_BANNER_MS);
        }
        const s = S.current;
        if (message.command === 'goto') goTo(stepIds.indexOf(message.step), 'director', 'skip');
        else if (message.command === 'restart_step') goTo(s.idx, 'director', 'redo');
      } catch { /* 404, offline or not JSON: nothing to show */ }
    };
    const timer = setInterval(poll, DIRECTOR_POLL_MS);
    poll();
    return () => { stopped = true; clearInterval(timer); clearTimeout(bannerTimer); };
  }, [steps, goTo, log]);

  // ---- render --------------------------------------------------------------

  const step = steps[stepIdx];
  const stepCount = steps.length;
  const poseLoading = ui.poseStatus && !ui.poseStatus.isInitialized && !ui.poseStatus.error;
  const framingWarning = step.panel === 'framing' && ui.hasPose && ui.frame && !ui.frame.ok
    ? `Out of frame: ${[!ui.frame.head && 'head', !ui.frame.shoulders && 'shoulders'].filter(Boolean).join(', ')}`
    : null;
  const armCell = (label, arm) => (
    <div className={`sis-tile ${arm?.state === 'ok' ? '' : 'is-warn'}`}>
      <span className="sis-tile-label">{label}</span>
      <span className="sis-tile-value">{fmt(arm?.score, 2)}</span>
      <span className="sis-tile-sub">{arm ? arm.state.replace('_', ' ') : 'no pose'}{arm?.angleDeg != null ? ` · ${fmt(arm.angleDeg, 0)}°` : ''}</span>
    </div>
  );

  return (
    <div className={`sis sis--${step.panel}`}>
      <PoseBridge bridgeRef={bridgeRef} onPoses={onPoses} onStatus={onPoseStatus} />

      <header className="sis-top">
        <span className="sis-step">Step {stepIdx + 1} / {stepCount} · {step.id}</span>
        <span className={`sis-stat ${ui.fps != null && ui.fps < POSE_FPS_GATE ? 'is-bad' : ''}`}>{fmt(ui.fps, 0)} fps</span>
        <span className="sis-stat">{fmt(ui.latencyP50, 0)} / {fmt(ui.latencyP95, 0)} ms p50/p95</span>
        <span className="sis-stat">{ui.model || '—'} · {ui.backend || '—'}</span>
        <span className="sis-stat">game load {ui.load ? `ON ${fmt(ui.loadFps, 0)} fps` : 'off'}</span>
      </header>

      <main className="sis-main">
        <section className="sis-prompt">
          <h1>{step.title}</h1>
          <p>{step.text}</p>
          {ui.phase === 'switching' || ui.phase === 'prep' ? <div className="sis-count sis-count--text">Loading model…</div> : null}
          {ui.phase === 'lead' ? <div className="sis-count"><small>get ready</small>{ui.remainingS}</div> : null}
          {ui.phase === 'measure' ? <div className="sis-count is-live"><small>measuring</small>{ui.remainingS}</div> : null}
          {ui.phase === 'measure' ? <div className="sis-progress"><span style={{ width: `${(ui.progress || 0) * 100}%` }} /></div> : null}
          {poseLoading ? <p className="sis-warn">Loading the vision model…</p> : null}
          {ui.poseStatus?.error ? <p className="sis-error">Vision model error: {errorText(ui.poseStatus.error)}</p> : null}
          {cameraError ? <p className="sis-error">Camera error: {cameraError}</p> : null}
          {framingWarning ? <p className="sis-error">{framingWarning}</p> : null}
          {step.panel === 'framing' && ui.hasPose && ui.frame?.ok ? <p className="sis-good">Framing looks good.</p> : null}
          {step.kind === 'wait' && step.id !== 'results' ? (
            <p className="sis-how">Press any key (not 1–6), tap NEXT{step.gesture ? ', or hold both hands above your head for 2 seconds' : ''}.</p>
          ) : null}
          {step.gesture && ui.gesture > 0 ? <div className="sis-progress sis-progress--gesture"><span style={{ width: `${ui.gesture * 100}%` }} /></div> : null}
        </section>

        <section className="sis-side">
          <div className="sis-camera">
            <FitnessWebcam
              ref={webcamRef}
              onStreamReady={handleStreamReady}
              onError={handleCameraError}
              videoConstraints={VIDEO_CONSTRAINTS}
              audioConstraints={false}
              videoStyle={{ objectFit: 'contain', transform: 'scaleX(-1)' }}
            />
            <canvas ref={canvasRef} className="sis-skeleton" />
          </div>
          {step.panel === 'results' ? null : (
            <div className="sis-tiles">
              <div className={`sis-tile ${ui.lost ? 'is-warn' : ''}`}>
                <span className="sis-tile-label">aim</span>
                <span className="sis-tile-value">{ui.lost ? 'LOST' : fmt(ui.aimX, 2)}</span>
                <span className="sis-tile-sub">{ui.hasPose ? '0 left · 1 right' : 'step into view'}</span>
              </div>
              {armCell('left arm', ui.left)}
              {armCell('right arm', ui.right)}
            </div>
          )}
        </section>
      </main>

      {step.panel === 'mat' || step.test === 't3' ? (
        <section className="sis-mat">
          <div className="sis-tile"><span className="sis-tile-label">presses this step</span><span className="sis-tile-value">{ui.stepPresses ?? 0}</span><span className="sis-tile-sub">{ui.presses ?? 0} total</span></div>
          <div className="sis-tile"><span className="sis-tile-label">presses / s</span><span className="sis-tile-value">{fmt(ui.rate10, 2)}</span><span className="sis-tile-sub">count in last 10 s ÷ 10</span></div>
          <div className={`sis-tile ${ui.matId ? '' : 'is-warn'}`}><span className="sis-tile-label">mat</span><span className="sis-tile-value sis-tile-value--small">{ui.matId || 'none seen'}</span><span className="sis-tile-sub">{ui.matDetection || '—'} · {ui.matOccupied == null ? '—' : ui.matOccupied ? 'occupied' : 'empty'} · rearmed {ui.rearms ?? 0}×</span></div>
          <ol className="sis-presses">
            {(ui.recent || []).slice().reverse().map((r) => (
              <li key={r.t}>
                <b>{r.intervalMs != null ? `${r.intervalMs} ms` : 'first'}</b>
                {r.stomp ? ' · stomp' : ''}
                {r.latch?.x?.throw?.[200] != null ? ` · aim moved ${fmt(Math.abs(r.latch.x.throw[200]), 3)} in 200 ms` : ' · no aim'}
                {r.backendToAppMs != null ? ` · server→screen ${r.backendToAppMs} ms*` : ''}
              </li>
            ))}
          </ol>
          <p className="sis-note">
            Press→screen delay cannot be measured: the mat only reports its own uptime clock
            {ui.hasDeviceTs ? ' (used for delivery jitter)' : ''}.
            {ui.hasBackendTs ? ' *Server→screen includes the clock difference between the two machines.' : ''}
          </p>
        </section>
      ) : null}

      {step.panel === 'results' ? <ResultsPanel summary={summary} /> : (
        <section className="sis-aim">
          {loadOn ? <SyntheticLoad onFrame={onLoadFrame} /> : null}
          <svg className="sis-track" viewBox="0 0 1000 100" preserveAspectRatio="none">
            <line x1="0" y1="96" x2="1000" y2="96" className="sis-track-line" />
            <line x1="500" y1="0" x2="500" y2="100" className="sis-track-mid" />
            <polyline ref={traceRef} className="sis-trace" points="" />
            <circle ref={smoothMarkerRef} className="sis-smooth" cx="500" cy="96" r="5" />
            <g ref={markerRef} className="sis-cannon is-lost" transform="translate(500 0)">
              <rect x="-14" y="70" width="28" height="26" />
              <rect x="-4" y="52" width="8" height="20" />
            </g>
          </svg>
        </section>
      )}

      <footer className="sis-foot">
        <button type="button" className="sis-btn" onClick={(e) => handleInput('touch', 'redo', { pointerType: e.nativeEvent?.pointerType || null, button: 'redo' })}>REDO</button>
        {stepIdx < steps.length - 1 ? (
          <button type="button" className="sis-btn sis-btn--next" onClick={(e) => handleInput('touch', 'next', { pointerType: e.nativeEvent?.pointerType || null, button: 'next' })}>
            {step.kind === 'wait' ? 'NEXT' : 'SKIP'}
          </button>
        ) : null}
      </footer>

      {banner ? <div className="sis-banner" role="alert">{banner}</div> : null}
    </div>
  );
}

export default function SkylineInvadersSpike(props) {
  const log = useMemo(() => createSpikeLog(), []);
  return (
    <SpikeErrorBoundary log={log}>
      <PoseProvider autoStart={false} initialConfig={{ modelType: MODEL_A, temporalSmoothing: false }}>
        <SpikeInner {...props} log={log} />
      </PoseProvider>
    </SpikeErrorBoundary>
  );
}
