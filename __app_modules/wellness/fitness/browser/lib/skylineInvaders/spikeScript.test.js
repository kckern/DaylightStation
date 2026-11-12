import { describe, it, expect } from 'vitest';
import { buildScript, chooseModel, classifyKey, parseDirector, redoTarget } from './spikeScript.js';
import { createStepCollector } from './stepCollector.js';
import { buildSummary } from './summary.js';
import { computeAim, KP, latchBefore, createAimHistory } from './aim.js';

describe('script', () => {
  const steps = buildScript();
  it('has unique stable ids in the agreed order', () => {
    const ids = steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('framing');
    expect(ids.indexOf('t1.full.baseline')).toBeLessThan(ids.indexOf('t1.lite.load'));
    expect(ids.indexOf('t2.adult.turn_away')).toBeLessThan(ids.indexOf('kid.intro'));
    expect(ids.indexOf('t2.kid.turn_away')).toBeLessThan(ids.indexOf('t3.drill'));
    expect(ids[ids.length - 1]).toBe('results');
  });
  it('tags every aim step with its subject and never enables the gesture on timed steps', () => {
    steps.filter((s) => s.id.startsWith('t2.')).forEach((s) => expect(['adult', 'kid']).toContain(s.subject));
    steps.filter((s) => s.kind === 'timed').forEach((s) => expect(s.gesture).toBe(false));
  });
  it('redo restarts a timed step and steps back from a wait screen', () => {
    const drill = steps.findIndex((s) => s.id === 't3.drill');
    expect(redoTarget(steps, drill)).toBe(drill);
    expect(redoTarget(steps, drill - 1)).toBe(drill - 2);
    expect(redoTarget(steps, 0)).toBe(0);
  });
});

describe('classifyKey', () => {
  it('never advances on the OS-bound digits', () => {
    ['1', '2', '3', '4', '5', '6'].forEach((key) => expect(classifyKey({ key, code: `Digit${key}` }).action).toBe('ignored'));
    expect(classifyKey({ key: 'End', code: 'Numpad1' })).toEqual({ action: 'ignored', reason: 'os_bound_digit' });
  });
  it('treats other keys as next and Escape/Backspace as redo', () => {
    expect(classifyKey({ key: ' ', code: 'Space' }).action).toBe('next');
    expect(classifyKey({ key: '7', code: 'Digit7' }).action).toBe('next');
    expect(classifyKey({ key: 'Escape' }).action).toBe('redo');
    expect(classifyKey({ key: 'Backspace' }).action).toBe('redo');
  });
  it('ignores repeats, modifiers, combos and function keys', () => {
    expect(classifyKey({ key: 'a', repeat: true }).reason).toBe('auto_repeat');
    expect(classifyKey({ key: 'Shift' }).reason).toBe('modifier_key');
    expect(classifyKey({ key: 'r', ctrlKey: true }).reason).toBe('modifier_combo');
    expect(classifyKey({ key: 'F5' }).reason).toBe('function_key');
  });
});

describe('director', () => {
  const ids = ['framing', 't3.drill'];
  it('accepts a new message and rejects a seen or empty one', () => {
    expect(parseDirector({ id: 7, text: ' hi ' }, null, ids)).toMatchObject({ id: '7', text: 'hi', command: null });
    expect(parseDirector({ id: 7, text: 'hi' }, '7', ids)).toBeNull();
    expect(parseDirector({ text: 'no id' }, null, ids)).toBeNull();
    expect(parseDirector('<html>', null, ids)).toBeNull();
    expect(parseDirector({ id: 8 }, null, ids)).toBeNull();
  });
  it('honors goto only for a known step', () => {
    expect(parseDirector({ id: 1, command: 'goto', step: 't3.drill' }, null, ids)).toMatchObject({ command: 'goto', step: 't3.drill' });
    expect(parseDirector({ id: 2, command: 'goto', step: 'nope' }, null, ids)).toMatchObject({ command: null, rejected: 'goto' });
    expect(parseDirector({ id: 3, command: 'restart_step' }, null, ids).command).toBe('restart_step');
  });
});

it('chooses the model from fps under load', () => {
  expect(chooseModel(24, 29).model).toBe('full');
  expect(chooseModel(14, 27)).toEqual({ model: 'lite', reason: 'only_lite_meets_gate' });
  expect(chooseModel(null, 27).model).toBe('full');
  expect(chooseModel(12, 15).model).toBe('lite');
});

describe('collector and summary', () => {
  const pose = (deg) => {
    const keypoints = Array.from({ length: 33 }, () => ({ x: 320, y: 300, score: 0.9 }));
    const rad = (deg * Math.PI) / 180;
    keypoints[KP.nose] = { x: 320, y: 140, score: 0.9 };
    keypoints[KP.leftShoulder] = { x: 360, y: 200, score: 0.9 };
    keypoints[KP.rightShoulder] = { x: 280, y: 200, score: 0.9 };
    keypoints[KP.leftWrist] = { x: 360 - 120 * Math.sin(rad), y: 200 - 120 * Math.cos(rad), score: 0.9 };
    keypoints[KP.rightWrist] = { x: 280 - 120 * Math.sin(rad), y: 200 - 120 * Math.cos(rad), score: 0.9 };
    return { keypoints };
  };

  it('reduces a hold step to jitter numbers, skipping the settle time', () => {
    const c = createStepCollector({ settleMs: 2000 });
    c.start(0);
    for (let t = 0; t <= 10000; t += 40) {
      // Moving into place for 2 s, then holding at +30 deg with +/-1.2 deg wobble.
      const deg = t < 2000 ? -30 + (60 * t) / 2000 : 30 + (t % 80 ? 1.2 : -1.2);
      const aim = computeAim(pose(deg));
      c.pose({ t, latencyMs: 25, hasPose: true, aim, xs: aim.aimX, frame: { head: true, leftWrist: true, rightWrist: true, ok: true }, armsUp: true });
    }
    const n = c.result(10000);
    expect(n.pose.fps).toBeCloseTo(25.1, 1);
    expect(n.aim.aimX.mean).toBeCloseTo(0.75, 2);
    expect(n.aim.sdRaw).toBeCloseTo(0.01, 3);
    expect(n.aim.peakToPeak).toBeCloseTo(0.02, 3);
    expect(n.aim.lostPct).toBe(0);
    expect(n.aim.left.okPct).toBe(100);
    expect(n.frame.okPct).toBe(100);
    expect(n.mat).toMatchObject({ presses: 0, rearms: 0 });
    expect(n.mat.relay).toBeUndefined();
  });

  it('reports loss episodes and mat presses with latch numbers', () => {
    const c = createStepCollector();
    const history = createAimHistory();
    c.start(0);
    for (let t = 0; t <= 5000; t += 50) {
      const aim = t >= 2000 && t < 3000 ? computeAim(null) : computeAim(pose(0.02 * t - 50));
      history.push({ t, x: aim.aimX, xs: aim.aimX, lost: aim.lost });
      c.pose({ t, latencyMs: 30, hasPose: !aim.lost, aim, xs: aim.aimX, frame: {}, armsUp: null });
    }
    [1000, 1800, 4000].forEach((t, i) => c.press({
      t, wallMs: t, deviceTs: 7000 + t - (i === 2 ? 30 : 0), receivedAtMs: t - 5, bootCount: 1, aimLost: false,
      latch: { x: latchBefore(history, t, 'x'), xs: latchBefore(history, t, 'xs') }, after: null,
    }));
    c.stomp();
    c.release({ t: 1500, pressDurationMs: 500 });
    c.rearm();
    const n = c.result(5000, { drill: true });
    expect(n.aim.lost).toEqual({ count: 1, longestMs: 1000, firstLostAtMs: 2000 });
    expect(n.aim.lostPct).toBeCloseTo(19.8, 1);
    expect(n.mat).toMatchObject({ presses: 3, stomps: 1, releases: 1, rearms: 1, perSec: 0.6 });
    expect(n.mat.intervalMs.max).toBe(2200);
    expect(n.mat.drill.presses).toBe(3);
    expect(n.mat.relay.deliveryExcessMs.max).toBe(30);
    // 0.02 deg/ms over 200 ms = 4 deg = 4/120 of the aim range.
    expect(n.mat.latch.raw.throwAbs[200].p50).toBeCloseTo(4 / 120, 3);
    expect(n.mat.latch.presses).toBe(3);

    const steps = buildScript();
    const summary = buildSummary({
      session: { sid: 'sis-test' }, steps, complete: false,
      results: { 't3.drill': { outcome: 'end', attempts: 1, numbers: n }, 't3.free': { outcome: 'skip', attempts: 2, numbers: n } },
    });
    expect(summary.sid).toBe('sis-test');
    expect(summary.stepsMeasured).toBe(1);
    expect(summary.stepsMissing).toContain('t3.free');
    expect(summary.mat.drill.presses).toBe(3);
    expect(summary.mat.free).toBeNull();
    expect(summary.mat.relay.absoluteLatencyMs).toBeNull();
    expect(summary.mat.relay.from).toBe('t3.drill');
    expect(summary.pose.full.load).toBeNull();
    expect(summary.aim.kid.holdLeft).toBeNull();
    expect(summary.stepOutcomes.t3_free).toBe('skipx2');
    expect(JSON.parse(summary.detailJson)['t3.drill'].numbers.mat.presses).toBe(3);
  });
});
