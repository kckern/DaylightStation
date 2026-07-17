/**
 * Vibration render-throttle regression (Stage 2a of the 2026-07-17 fitness
 * re-architecture).
 *
 * Bug: raw Zigbee vibration packets arrive per-sensor at high frequency, and
 * handleVibrationEvent used a `setVibrationState` useState setter that
 * re-rendered the ENTIRE provider on every packet, bypassing batchedForceUpdate's
 * 250ms throttle. During a workout this was a primary driver of the ~12
 * FitnessChart renders/sec that starved the Firefox tab.
 *
 * Fix: vibration state moved to a ref, published via batchedForceUpdate. This
 * test drives a burst of vibration packets (each in its own task, the way WS
 * messages actually arrive) and asserts a consumer re-renders far fewer times
 * than the packet count — i.e. the throttle is now in force.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

// Capture the WS message + status subscribers so the test can drive them.
let messageHandler = null;
let statusHandler = null;
vi.mock('../services/WebSocketService', () => ({
  wsService: {
    subscribe: (_topics, cb) => { messageHandler = cb; return () => {}; },
    onStatusChange: (cb) => { statusHandler = cb; return () => {}; },
  },
}));

vi.mock('../lib/logging/Logger.js', () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() };
  l.child = () => l;
  const getLogger = () => l;
  return { default: getLogger, getLogger };
});

import { FitnessProvider, useFitnessContext } from './FitnessContext.jsx';

const MINIMAL_CONFIG = { users: { primary: [] }, plex: {}, sensors: {} };

function vibrationPacket(equipmentId, on) {
  return {
    topic: 'vibration',
    equipmentId,
    equipmentName: equipmentId,
    data: { vibration: on, x_axis: on ? 900 : 0, y_axis: 0, z_axis: 0 },
  };
}

describe('FitnessProvider — vibration packets are render-throttled', () => {
  beforeEach(() => { messageHandler = null; statusHandler = null; });

  it('re-renders a consumer far fewer times than the number of vibration packets', async () => {
    const renders = { count: 0 };
    function Probe() {
      useFitnessContext();
      renders.count += 1;
      return null;
    }

    await act(async () => {
      render(
        <FitnessProvider fitnessConfiguration={MINIMAL_CONFIG} kioskMode={false}>
          <Probe />
        </FitnessProvider>
      );
    });

    // Wait for the dynamic import('../services/WebSocketService') to resolve and
    // register the subscriber.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(messageHandler).toBeTypeOf('function');

    const baseline = renders.count;

    // Fire 40 vibration packets, each in its own macrotask (how WS messages
    // actually arrive — separate ticks, not one synchronous React batch).
    for (let i = 0; i < 40; i += 1) {
      await act(async () => {
        messageHandler(vibrationPacket('rack-1', i % 2 === 0));
        await new Promise((r) => setTimeout(r, 5));
      });
    }
    // Let any trailing throttled RAF/timeout flush.
    await act(async () => { await new Promise((r) => setTimeout(r, 350)); });

    const rendersFromVibration = renders.count - baseline;
    // 40 packets within ~200ms. Throttle ceiling is ~4/sec (250ms), so this must
    // be a small number — an order of magnitude under the packet count. The old
    // per-packet setState produced ~40.
    expect(rendersFromVibration).toBeLessThanOrEqual(8);
  });
});
