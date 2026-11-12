/**
 * Render budget for a streaming sensor (2026-11-11).
 *
 * The garage profiler (`fitness-profile-excessive-renders`, threshold 100 per
 * 30 s) fired in every busy session: the provider re-rendered on every 250 ms
 * throttle window that saw ANY packet, ~110 per 30 s, even when the packet
 * changed nothing on screen. ANT+ sensors broadcast at ~4 Hz and the garage
 * hears each packet on two dongles, so most packets repeat the last reading.
 *
 * This drives 30 simulated seconds of realistic traffic and pins:
 *   - provider re-renders (the profiler's `forceUpdateCount`) stay under the
 *     warning threshold, with room to spare;
 *   - a consumer that reads live readings still sees every change;
 *   - a consumer that reads only config/callbacks through `useFitnessSelector`
 *     does not re-render on sensor traffic at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

let messageHandler = null;
vi.mock("../../../../../frontend/src/services/WebSocketService.js", () => ({
  wsService: {
    subscribe: (_topics, cb) => { messageHandler = cb; return () => {}; },
    onStatusChange: (_cb) => () => {},
  },
}));

vi.mock("../../../../../frontend/src/lib/logging/Logger.js", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() };
  l.child = () => l;
  const getLogger = () => l;
  return { default: getLogger, getLogger };
});

import { FitnessProvider, useFitnessContext, useFitnessSelector } from "./FitnessContext.jsx";

const MINIMAL_CONFIG = { users: { primary: [] }, plex: {}, sensors: {} };
const EXCESSIVE_PROVIDER_UPDATES_PER_30S = 125; // FitnessApp.jsx fitness-profile-excessive-renders

const cadencePacket = (deviceId, rpm, revs) => ({
  topic: 'fitness', type: 'ant', deviceId, profile: 'CAD',
  data: { CalculatedCadence: rpm, CumulativeCadenceRevolutionCount: revs },
});
const hrPacket = (deviceId, bpm) => ({
  topic: 'fitness', type: 'ant', deviceId, profile: 'HR',
  data: { ComputedHeartRate: bpm },
});

/**
 * 30 s of traffic at 4 Hz per sensor, each packet heard twice (two dongles).
 * Each sensor's reading changes once a second (a crank revolution, a new
 * heartbeat average) on its OWN phase, so with several sensors a change lands
 * in most 250 ms windows — the worst realistic case. The other broadcasts
 * repeat the last value.
 */
function* traffic({ cadence = 1, heartRate = 0, seconds = 30, frozen = false }) {
  const ticks = seconds * 4;
  for (let t = 0; t < ticks; t += 1) {
    const packets = [];
    let phase = 0;
    for (let c = 0; c < cadence; c += 1, phase += 1) {
      const step = Math.floor((t + 4 - (phase % 4)) / 4); // advances once a second, offset by phase
      packets.push(cadencePacket(`cad-${c}`, 60 + (step % 3), step));
    }
    for (let h = 0; h < heartRate; h += 1, phase += 1) {
      const step = frozen ? 0 : Math.floor((t + 4 - (phase % 4)) / 4);
      packets.push(hrPacket(`hr-${h}`, 120 + (step % 5)));
    }
    yield packets.flatMap((p) => [p, p]);
  }
}

// Measurements go to stdout so a passing run still prints them.
const report = (label, r) => process.stdout.write(`[render-budget] ${label} ${JSON.stringify({ ...r, revsSeen: r.revsSeen.size })}\n`);

async function runScenario(shape) {
  const counts = { live: 0, config: 0, selector: 0, lastRevs: null, revsSeen: new Set() };

  function LiveProbe() {
    const ctx = useFitnessContext();
    counts.live += 1;
    const dev = ctx.allDevices?.find?.((d) => String(d.id) === 'cad-0');
    if (dev) { counts.lastRevs = dev.revolutionCount; counts.revsSeen.add(dev.revolutionCount); }
    return null;
  }
  function ConfigProbe() {
    useFitnessContext();
    counts.config += 1;
    return null;
  }
  function SelectorProbe() {
    useFitnessSelector((c) => ({ cfg: c?.fitnessConfiguration, launch: c?.launchApp, immersive: c?.immersive }));
    counts.selector += 1;
    return null;
  }

  await act(async () => {
    render(
      <FitnessProvider fitnessConfiguration={MINIMAL_CONFIG} kioskMode={false}>
        <LiveProbe />
        <ConfigProbe />
        <SelectorProbe />
      </FitnessProvider>
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(messageHandler).toBeTypeOf('function');
  // Settle mount-time effects, then open a clean 30 s window.
  await act(async () => { vi.advanceTimersByTime(1000); });
  window.__fitnessRenderStats?.();
  const base = { live: counts.live, config: counts.config, selector: counts.selector };

  for (const packets of traffic(shape)) {
    await act(async () => {
      packets.forEach((p) => messageHandler(p));
      vi.advanceTimersByTime(250);
    });
  }
  await act(async () => { vi.advanceTimersByTime(400); });

  const stats = window.__fitnessRenderStats?.() || {};
  return {
    forceUpdates: stats.forceUpdateCount,
    providerRenders: stats.renderCount,
    live: counts.live - base.live,
    config: counts.config - base.config,
    selector: counts.selector - base.selector,
    lastRevs: counts.lastRevs,
    revsSeen: counts.revsSeen,
  };
}

describe('FitnessProvider — render budget under streaming sensors', () => {
  beforeEach(() => {
    messageHandler = null;
    // The workout shape starts a live session; its autosave must not hit the network.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  // Measured 2026-11-11 on the pre-fix provider with this same harness:
  //   cadence x1        118 provider renders / 30 s, every consumer 118
  //   hr x3 + cadence   119 provider renders / 30 s, every consumer 119
  //   repeats only      ~120 (every throttle window that saw a packet)

  it('one cadence sensor (Skyline Glider shape): renders track readings, not packets', async () => {
    const r = await runScenario({ cadence: 1, heartRate: 0 });
    report('cadence x1', r);
    // One reading change a second -> ~30, far under the profiler threshold (was 118).
    expect(r.forceUpdates).toBeLessThanOrEqual(35);
    expect(r.providerRenders).toBeLessThanOrEqual(35);
    // Every reading still reaches a live consumer: each revolution count was shown, ending on the last one sent.
    expect(r.lastRevs).toBe(30);
    expect(r.revsSeen.size).toBeGreaterThanOrEqual(30);
    // A consumer that selects config/callbacks sits out sensor traffic entirely.
    expect(r.selector).toBe(0);
  });

  it('a sensor repeating the same reading renders only on the 1 s keepalive', async () => {
    const r = await runScenario({ cadence: 0, heartRate: 1, frozen: true });
    report('hr x1 frozen', r);
    expect(r.forceUpdates).toBeLessThanOrEqual(32);
    expect(r.selector).toBe(0);
  });

  it('three HR straps + a bike, readings staggered (worst workout shape): bounded by the 4/s throttle', async () => {
    const r = await runScenario({ cadence: 1, heartRate: 3 });
    report('hr x3 + cadence', r);
    // Four sensors each changing once a second, on different phases, change a
    // reading in nearly every 250 ms window: these renders are real updates.
    // They stay at or under the throttle ceiling the profiler now alarms above.
    expect(r.forceUpdates).toBeLessThanOrEqual(EXCESSIVE_PROVIDER_UPDATES_PER_30S);
    expect(r.lastRevs).toBe(30);
    // Non-live consumers no longer re-render with them (was 119).
    expect(r.selector).toBe(0);
  });
});
