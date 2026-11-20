/**
 * Render budget for a Bluetooth search (2026-11-20).
 *
 * The garage satellite sends a `bt.scan.progress` `nearby` snapshot about once
 * a second while a search runs. That state lives in FitnessBluetoothHost's own
 * context, so 30 s of searching must re-render the Bluetooth consumer, not the
 * provider or its useFitnessContext consumers (live HR charts among them).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

let messageHandler = null;
const sent = [];
vi.mock("../../../../../frontend/src/services/WebSocketService.js", () => ({
  wsService: {
    subscribe: (_topics, cb) => { messageHandler = cb; return () => {}; },
    onStatusChange: (_cb) => () => {},
    send: (msg) => { sent.push(msg); },
  },
}));

vi.mock("../../../../../frontend/src/lib/logging/Logger.js", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() };
  l.child = () => l;
  const getLogger = () => l;
  return { default: getLogger, getLogger };
});

import { FitnessProvider, useFitnessContext } from "./FitnessContext.jsx";
import { useFitnessBluetoothState } from "./FitnessBluetoothContext.jsx";

const MINIMAL_CONFIG = { users: { primary: [] }, plex: {}, sensors: {} };

describe('FitnessProvider — a Bluetooth search does not re-render the fitness tree', () => {
  beforeEach(() => {
    messageHandler = null;
    sent.length = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('30 s of 1 Hz nearby snapshots: provider and context consumers stay put, the screen sees each one', async () => {
    const counts = { ctx: 0, bt: 0, lastHeard: 0, inventory: undefined };
    let bt = null;
    function CtxProbe() {
      const c = useFitnessContext();
      counts.ctx += 1;
      counts.inventory = c.btInventory;
      return null;
    }
    function BtProbe() {
      bt = useFitnessBluetoothState();
      counts.bt += 1;
      counts.lastHeard = bt?.bluetooth?.scan?.devices?.length ?? 0;
      return null;
    }
    await act(async () => {
      render(
        <FitnessProvider fitnessConfiguration={MINIMAL_CONFIG} kioskMode={false}>
          <CtxProbe />
          <BtProbe />
        </FitnessProvider>
      );
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(messageHandler).toBeTypeOf('function');
    await act(async () => { vi.advanceTimersByTime(1000); });

    // Control: 30 idle seconds (the provider has its own periodic renders).
    window.__fitnessRenderStats?.();
    const idle0 = counts.ctx;
    for (let s = 0; s < 30; s += 1) await act(async () => { vi.advanceTimersByTime(1000); });
    const idle = { provider: (window.__fitnessRenderStats?.() || {}).renderCount ?? 0, ctx: counts.ctx - idle0 };

    let requestId;
    await act(async () => { requestId = bt.bluetooth.startScan(); });
    await act(async () => { messageHandler({ topic: 'bt.scan.progress', requestId, phase: 'scanning', durationMs: 60000 }); });
    window.__fitnessRenderStats?.();
    const base = { ctx: counts.ctx, bt: counts.bt };

    for (let s = 0; s < 30; s += 1) {
      await act(async () => {
        messageHandler({
          topic: 'bt.scan.progress', requestId, phase: 'nearby',
          devices: Array.from({ length: 1 + (s % 4) }, (_, i) => ({ address: `AA:BB:CC:00:00:0${i}`, name: `D${i}`, kind: 'keyboard', rssi: -50 - s })),
        });
        vi.advanceTimersByTime(1000);
      });
    }

    const stats = window.__fitnessRenderStats?.() || {};
    const ctxRenders = counts.ctx - base.ctx;
    const btRenders = counts.bt - base.bt;
    process.stdout.write(`[bt-scan-budget] ${JSON.stringify({ providerRenders: stats.renderCount, forceUpdates: stats.forceUpdateCount, ctxRenders, btRenders, idle })}\n`);
    // The search reached the Bluetooth consumer every second…
    expect(btRenders).toBeGreaterThanOrEqual(30);
    expect(counts.lastHeard).toBe(2); // s = 29 → 1 + (29 % 4)
    // …and nothing else: the provider renders no more than it does idle
    // (before the split it rendered once more per snapshot, ~30 more).
    expect(stats.renderCount ?? 0).toBeLessThanOrEqual(idle.provider + 2);
    expect(ctxRenders).toBeLessThanOrEqual(idle.ctx + 2);
    expect(sent.some((m) => m.topic === 'bt.scan.request')).toBe(true);
  });

  it('the inventory still reaches the main context', async () => {
    let inv;
    function CtxProbe() { inv = useFitnessContext().btInventory; return null; }
    await act(async () => {
      render(<FitnessProvider fitnessConfiguration={MINIMAL_CONFIG} kioskMode={false}><CtxProbe /></FitnessProvider>);
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { messageHandler({ topic: 'bt_inventory', devices: [{ address: 'AA:BB:CC:11:22:33' }] }); });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(inv).toEqual([{ address: 'AA:BB:CC:11:22:33' }]);
  });
});
