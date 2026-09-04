import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';

let messageHandler = null;
vi.mock('../services/WebSocketService', () => ({
  wsService: {
    subscribe: (_topics, callback) => { messageHandler = callback; return () => {}; },
    onStatusChange: () => () => {},
  },
}));

vi.mock('../lib/logging/Logger.js', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() };
  logger.child = () => logger;
  const getLogger = () => logger;
  return { default: getLogger, getLogger };
});

import { FitnessProvider, useFitnessContext } from './FitnessContext.jsx';
import FitnessUsersList from '../modules/Fitness/player/panels/FitnessUsers.jsx';

const MINIMAL_CONFIG = { users: { primary: [] }, plex: {}, sensors: {} };

describe('FitnessProvider pressure-mat websocket contract', () => {
  beforeEach(() => { messageHandler = null; });

  it('updates the live counter and emits distinct step/stomp app events', async () => {
    const events = [];
    let latestContext = null;
    function Probe() {
      const context = useFitnessContext();
      const { subscribeToAppEvent } = context;
      latestContext = context;
      useEffect(() => {
        const unStep = subscribeToAppEvent('pressure-mat:step', (event) => events.push(event));
        const unStomp = subscribeToAppEvent('pressure-mat:stomp', (event) => events.push(event));
        return () => { unStep(); unStomp(); };
      }, [subscribeToAppEvent]);
      return null;
    }

    await act(async () => {
      render(<FitnessProvider fitnessConfiguration={MINIMAL_CONFIG}><Probe /></FitnessProvider>);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(messageHandler).toBeTypeOf('function');

    await act(async () => {
      messageHandler({ topic: 'pressure-mat', id: 'garage-step-mat', type: 'presence', event: 'pressed', occupied: true, steps: 8, stomps: 1, deltaV: .3 });
      messageHandler({ topic: 'pressure-mat', id: 'garage-step-mat', type: 'presence', event: 'stomped', occupied: true, steps: 8, stomps: 2, deltaV: .7 });
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    expect(events.map((event) => event.type)).toEqual(['pressure-mat:step', 'pressure-mat:stomp']);
    expect(latestContext.pressureMatState['garage-step-mat']).toMatchObject({ steps: 8, stomps: 2, event: 'stomped' });
  });

  it('publishes an unconfigured mat activity during an active session', async () => {
    let latestContext = null;
    function Probe() {
      latestContext = useFitnessContext();
      return null;
    }

    await act(async () => {
      render(<FitnessProvider fitnessConfiguration={MINIMAL_CONFIG}><Probe /></FitnessProvider>);
      await Promise.resolve();
      await Promise.resolve();
    });
    latestContext.fitnessSessionInstance.sessionId = '20260903140000';

    await act(async () => {
      messageHandler({
        topic: 'pressure-mat', id: 'garage-step-mat', type: 'presence', event: 'pressed',
        occupied: true, steps: 9, stomps: 7, deltaV: .3,
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    expect(latestContext.pressureMatActivities['garage-step-mat']).toMatchObject({
      equipmentId: 'garage-step-mat',
      seenThisSession: true,
      sessionSteps: 1,
    });
  });

  it('shows exactly one real card from websocket events without a tap or assignment', async () => {
    let context;
    function LiveSidebar() { context = useFitnessContext(); return <FitnessUsersList />; }
    const { rerender } = render(<FitnessProvider fitnessConfiguration={MINIMAL_CONFIG}><LiveSidebar /></FitnessProvider>);
    await waitFor(() => expect(messageHandler).toBeTypeOf('function'));
    expect(screen.queryByRole('button', { name: /step mat:/i })).toBeNull();
    context.fitnessSessionInstance.sessionId = '20260904144124';
    await act(async () => {
      messageHandler({ topic: 'pressure-mat', id: 'mat-1', type: 'presence', event: 'pressed', steps: 101, stomps: 8 });
      messageHandler({ topic: 'pressure-mat', id: 'mat-1', type: 'presence', event: 'stomped', steps: 101, stomps: 9 });
      await new Promise(resolve => setTimeout(resolve, 300));
    });
    expect(screen.getAllByRole('button', { name: /step mat: 4 steps per minute, 1 steps, 1 stomps/i })).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      rerender(<FitnessProvider fitnessConfiguration={{ ...MINIMAL_CONFIG, equipment: [{ id: 'step_mat', type: 'pressure_mat', pressure_mat: 'mat-1' }] }}><LiveSidebar /></FitnessProvider>);
    });
    await act(async () => {
      messageHandler({ topic: 'pressure-mat', id: 'mat-1', type: 'presence', event: 'pressed', steps: 102, stomps: 9 });
      await new Promise(resolve => setTimeout(resolve, 300));
    });
    expect(screen.getAllByRole('button', { name: /step mat: 8 steps per minute, 2 steps, 1 stomps/i })).toHaveLength(1);
    expect(context.pressureMatActivities.step_mat.sessionSteps).toBe(2);
  });
});
